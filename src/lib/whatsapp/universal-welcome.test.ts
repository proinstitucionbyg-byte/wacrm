import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ send: vi.fn(), human: vi.fn(), delivery: vi.fn(), dispatch: vi.fn() }))
vi.mock('@/lib/automations/meta-send', () => ({ engineSendText: h.send }))
vi.mock('@/lib/automations/delivery-reference', () => ({ readDeliveryReference: h.delivery }))
vi.mock('@/lib/ai/explicit-human-request', () => ({ handleExplicitHumanRequest: h.human }))
vi.mock('./inbound-dispatch', () => ({ dispatchInboundThroughCrm: h.dispatch }))
import { gateNewNumberWelcome, drainNewNumberWelcomes, NEW_NUMBER_WELCOME_TEXT, NEW_NUMBER_WELCOME_DELAY_MS, welcomeCanRun } from './universal-welcome'

function database(reservation: object, due: object[] = [],handoff=false) {
  const writes: object[] = []
  const db = { rpc: vi.fn().mockResolvedValue({ data: reservation, error: null }),
    from: vi.fn((table: string) => {
      let value: object | object[] | null = table === 'whatsapp_support_routes'?{enabled:true,automatic_sales_handoff:handoff}:table === 'conversations' ? { automation_enabled: true, last_human_message_at: null } : due
      const q: Record<string, unknown> = {}
      for (const name of ['select', 'eq', 'neq', 'in', 'lt', 'lte', 'limit']) q[name] = () => q
      q.update = (patch: object) => { writes.push(patch); value = 'state' in patch&&patch.state==='routing'?{id:'claim'}:null; return q }
      q.single = q.maybeSingle = () => Promise.resolve({ data: value, error: null })
      q.then = (resolve: (r: object) => unknown) => Promise.resolve(resolve({ data: value, error: null }))
      return q
    }) }
  return { db: db as never, writes, rpc: db.rpc }
}
const base = { channel: 'session' as const, accountId: 'account', userId: 'owner', contactId: 'contact',
  conversationId: 'chat', messageId: 'source', contentText: 'Hola', isFirstInboundMessage: true,
  inboundAt: '2026-11-18T10:00:00Z', contactCreated: true, hasConfirmedAdOrigin: false,
  conversation: { automation_enabled: true, ai_enabled: true, last_human_message_at: null } }
beforeEach(() => { vi.clearAllMocks(); h.human.mockResolvedValue(false); h.send.mockResolvedValue({ whatsapp_message_id: 'waweb-job:test' }) })

describe('universal first contact welcome', () => {
  it('waits three minutes after the API welcome is confirmed before changing to Business',async()=>{
    const now=Date.now();h.delivery.mockResolvedValue({status:'accepted',error:false})
    const d=database({},[{id:'event',account_id:'account',conversation_id:'chat',contact_id:'contact',state:'waiting_delivery',message_reference:'cloud-ref',payload:{...base,channel:'cloud',hasConfirmedAdOrigin:true}}],true)
    await drainNewNumberWelcomes(d.db)
    const scheduled=d.writes.find(x=>'run_at' in x) as {run_at:string}
    expect(Date.parse(scheduled.run_at)).toBeGreaterThanOrEqual(now+180000)
    expect(h.dispatch).not.toHaveBeenCalled()
  })
  it('routes the original API question through Business without losing the ad context or sending another welcome',async()=>{
    const d=database({},[{id:'event',account_id:'account',conversation_id:'chat',contact_id:'contact',state:'waiting_route',payload:{...base,channel:'cloud',contentText:'Farmacia',hasConfirmedAdOrigin:true}}],true)
    d.rpc.mockResolvedValue({data:{ready:true},error:null})
    await drainNewNumberWelcomes(d.db)
    expect(d.rpc).toHaveBeenCalledWith('prepare_cloud_business_route',{p_account_id:'account',p_conversation_id:'chat',p_provider_id:'source'})
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({contentText:'Farmacia',hasConfirmedAdOrigin:true,channel:'cloud',welcomeContinuation:true}))
    expect(h.send).not.toHaveBeenCalled()
    expect(d.writes).toContainEqual(expect.objectContaining({state:'done'}))
  })
  it('keeps the original question for review if Business cannot be confirmed',async()=>{
    const d=database({},[{id:'event',account_id:'account',conversation_id:'chat',contact_id:'contact',state:'waiting_route',payload:{...base,channel:'cloud',hasConfirmedAdOrigin:true}}],true)
    d.rpc.mockResolvedValue({data:{ready:false},error:null})
    await drainNewNumberWelcomes(d.db)
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(d.writes).toContainEqual(expect.objectContaining({state:'needs_review',reason:'route_not_confirmed'}))
  })
  it('preserves the exact owner text, including the closing exclamation mark', () => {
    expect(NEW_NUMBER_WELCOME_TEXT).toBe('👋🏻 ¡Bienvenid@ a *INSTICRECE*! 💙 Gracias por comunicarte con nosotros.\n\nEn breve, nuestro equipo se pondrá en contacto contigo para resolver tus consultas y brindarte la asistencia que necesites. 👩🏻‍💻📚\n\n¡Si creces tú, crecemos nosotros!')
    expect(NEW_NUMBER_WELCOME_DELAY_MS).toBe(30_000)
  })
  it.each([false, true])('sends the same immediate welcome for organic/ad origin %s', async ad => {
    const d = database({ enrolled: true, created: true, id: 'event', state: 'sending', body: NEW_NUMBER_WELCOME_TEXT })
    expect(await gateNewNumberWelcome({ ...base, db: d.db, hasConfirmedAdOrigin: ad })).toBe('held')
    expect(h.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: NEW_NUMBER_WELCOME_TEXT, idempotencyKey: 'new-number-welcome:event' }))
    expect(d.writes).toContainEqual(expect.objectContaining({ state: 'waiting_delivery' }))
  })
  it('holds concurrent inbound/retries without sending twice or replacing the source keyword', async () => {
    const d = database({ enrolled: true, created: false, id: 'event', state: 'waiting_route' })
    expect(await gateNewNumberWelcome({ ...base, db: d.db, contentText: 'Farmacia' })).toBe('held')
    expect(h.send).not.toHaveBeenCalled()
    expect(d.writes).toEqual([])
  })
  it('does not greet historical numbers', async () => {
    expect(await gateNewNumberWelcome({ ...base, db: database({ enrolled: false }).db, contactCreated: false })).toBe('legacy')
    expect(h.send).not.toHaveBeenCalled()
  })
  it('continues enrolled contacts without the old organic pause or a second welcome', async () => {
    expect(await gateNewNumberWelcome({ ...base, db: database({ enrolled: true, state: 'done' }).db })).toBe('enrolled')
    expect(h.send).not.toHaveBeenCalled()
  })
  it('respects a manual pause and an adviser taking over', () => {
    expect(welcomeCanRun({ automation_enabled: false })).toBe(false)
    expect(welcomeCanRun({ last_human_message_at: new Date().toISOString() })).toBe(false)
  })
  it('cancels waiting when the user asks for an adviser', async () => {
    h.human.mockResolvedValue(true)
    const d = database({ enrolled: true, created: false, id: 'event', state: 'waiting_route' })
    await gateNewNumberWelcome({ ...base, db: d.db, contentText: 'Quiero una asesora' })
    expect(d.writes).toContainEqual({ state: 'cancelled', reason: 'manual_pause_or_optout' })
    expect(h.send).not.toHaveBeenCalled()
  })
  it('waits thirty seconds after confirmation, never after merely enqueuing', async () => {
    const now = Date.now()
    h.delivery.mockResolvedValue({ status: 'accepted', error: false })
    const d = database({}, [{ id: 'event', account_id: 'account', conversation_id: 'chat', contact_id: 'contact',
      state: 'waiting_delivery', message_reference: 'ref', payload: base }])
    await drainNewNumberWelcomes(d.db)
    const scheduled = d.writes.find(x => 'run_at' in x) as { run_at: string }
    expect(Date.parse(scheduled.run_at)).toBeGreaterThanOrEqual(now + 30_000)
    expect(h.dispatch).not.toHaveBeenCalled()
  })
  it('does not start a course when welcome delivery is uncertain', async () => {
    h.delivery.mockResolvedValue({ status: 'failed', error: false })
    const d = database({}, [{ id: 'event', account_id: 'account', conversation_id: 'chat', contact_id: 'contact', state: 'waiting_delivery', message_reference: 'ref', payload: base }])
    await drainNewNumberWelcomes(d.db)
    expect(d.writes).toContainEqual({ state: 'needs_review', reason: 'welcome_delivery_failed' })
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})
