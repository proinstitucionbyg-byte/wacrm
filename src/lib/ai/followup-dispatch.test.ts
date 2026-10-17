import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  conv: {} as Record<string, unknown>, last: {} as Record<string, unknown>,
  customer: {} as Record<string, unknown>, pending: [] as unknown[],
  text: vi.fn(), interactive: vi.fn(), context: vi.fn(), candidates: vi.fn(),
}))
vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({ from: (table: string) => {
  let update = false
  const filters: Array<[string,unknown]> = []
  const result = () => ({error:null,data: table === 'conversations' ? (update ? {id:'chat'} : [h.conv])
    : table === 'messages' ? (filters.some(([key,value]) => key === 'sender_type' && value === 'customer') ? h.customer : h.last)
    : table === 'automation_pending_executions' ? null : []})
  const chain = {
    select: () => chain, update: () => { update = true; return chain },
    eq: (key:string,value:unknown) => {filters.push([key,value]); return chain},
    lt: () => chain, gt: () => chain, gte: () => chain, neq: () => chain,
    is: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: async () => table === 'automation_pending_executions'
      ? {data:h.pending[0] ?? null,error:null} : result(),
    then: (resolve:(value:unknown)=>unknown) => Promise.resolve(result()).then(resolve),
  }
  return chain
} }) }))
vi.mock('./config', () => ({loadAiConfig:async()=>({autoReplyEnabled:true})}))
vi.mock('./context', () => ({buildConversationContext:h.context}))
vi.mock('./automation-match', () => ({findCandidateAutomations:h.candidates}))
vi.mock('@/lib/automations/engine', () => ({runAutomationById:vi.fn()}))
vi.mock('@/lib/automations/meta-send', () => ({engineSendInteractive:h.interactive}))
vi.mock('@/lib/flows/meta-send', () => ({engineSendText:h.text}))

import { runIdleFollowups, IDLE_FOLLOWUP_TEXT } from './followup'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-17T20:00:00Z'))
  h.conv = {id:'chat',account_id:'account',user_id:'owner',contact_id:'contact',
    last_message_at:'2026-10-17T19:40:02Z',followup_sent_at:'2026-10-17T19:40:00Z',last_human_message_at:null}
  h.customer = {sender_type:'customer',content_text:'Necesito ayuda',created_at:'2026-10-17T19:00:00Z'}
  h.last = {sender_type:'bot',content_type:'interactive',content_text:'¿Quieres que retomemos la conversación? Pulsa continuar y te ayudamos a elegir el área.',
    status:'sent',created_at:'2026-10-17T19:40:02Z'}
  h.pending = []
  h.context.mockResolvedValue([{role:'user',content:'Necesito ayuda'}])
  h.candidates.mockResolvedValue([])
  h.text.mockResolvedValue({whatsapp_message_id:'fallback'})
  h.interactive.mockResolvedValue({whatsapp_message_id:'button'})
})

describe('idle follow-up dispatch', () => {
  it('does not repeat a follow-up when our outgoing updated the conversation time', async () => {
    expect(await runIdleFollowups()).toBe(0)
    expect(h.interactive).not.toHaveBeenCalled()
    expect(h.text).not.toHaveBeenCalled()
  })
  it('sends plain text instead of repeating a failed button', async () => {
    h.last.status = 'failed'
    expect(await runIdleFollowups()).toBe(1)
    expect(h.text).toHaveBeenCalledWith(expect.objectContaining({text:IDLE_FOLLOWUP_TEXT,conversationId:'chat'}))
    expect(h.interactive).not.toHaveBeenCalled()
  })
  it('also falls back once when Meta rejects the button immediately', async () => {
    h.conv.followup_sent_at = null
    h.last = {...h.customer}
    h.interactive.mockRejectedValueOnce(new Error('Meta rejected interactive message'))
    expect(await runIdleFollowups()).toBe(1)
    expect(h.text).toHaveBeenCalledTimes(1)
  })
  it('does not retry a text fallback that already failed before insertion', async () => {
    h.last.status = 'failed'
    h.conv.followup_sent_at = '2026-10-17T19:41:00Z'
    expect(await runIdleFollowups()).toBe(0)
    expect(h.text).not.toHaveBeenCalled()
    expect(h.interactive).not.toHaveBeenCalled()
  })
  it.each(['VENTAS','FIDELIZACION'])('resumes %s after adviser inactivity using only five messages', async area => {
    h.conv.ai_handoff_area = area
    h.conv.followup_sent_at = '2026-10-17T19:10:00Z'
    h.conv.last_human_message_at = '2026-10-17T19:40:00Z'
    h.last = {sender_type:'agent',content_type:'text',content_text:'Te ayudamos por aquí.',created_at:'2026-10-17T19:40:00Z'}
    expect(await runIdleFollowups()).toBe(1)
    expect(h.context).toHaveBeenCalledWith(expect.anything(),'chat',5)
    expect(h.interactive).toHaveBeenCalledTimes(1)
  })
  it('does not resume before ten minutes or interrupt a scheduled pause', async () => {
    h.conv.last_human_message_at = '2026-10-17T19:51:00Z'
    h.conv.followup_sent_at = null
    expect(await runIdleFollowups()).toBe(0)
    h.conv.last_human_message_at = null
    h.pending = [{id:'scheduled'}]
    expect(await runIdleFollowups()).toBe(0)
    expect(h.interactive).not.toHaveBeenCalled()
  })
})
