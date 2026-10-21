import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  runAutomation: vi.fn(),
  engineSendText: vi.fn(),
  routeArea: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string; name?: string }[],
    pendingSequence: [] as Array<{automation_id:string;context:Record<string,unknown>}>,
    paymentReview: null as {status:string} | null,
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/automations/engine', () => ({ runAutomationById: h.runAutomation }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'payment_reviews') {
        const chain = {select:()=>chain,eq:()=>chain,in:()=>chain,gte:()=>chain,order:()=>chain,limit:()=>chain,
          maybeSingle:async()=>({data:h.state.paymentReview,error:null})}
        return chain
      }
      if (table === 'enrollment_drafts') {
        const chain = {select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:null,error:null})}
        return chain
      }
      if (table === 'enrollment_document_deliveries') {
        const chain = {select:()=>chain,eq:()=>chain,then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve)}
        return chain
      }
      if (table === 'automation_pending_executions') {
        const chain = { select:()=>chain,eq:()=>chain,in:()=>chain,
          limit:async()=>({data:h.state.pendingSequence,error:null}) }
        return chain
      }
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          const mutation = {
            eq: () => mutation,
            is: () => mutation,
            select: () => mutation,
            maybeSingle: () => Promise.resolve({ data: h.state.claim ? { id: 'conv-1' } : null, error: null }),
            then: (resolve: (value: unknown) => unknown) => Promise.resolve({error:null}).then(resolve),
          }
          return mutation
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))
vi.mock('./handoff-routing', () => ({
  routeConversationToArea: h.routeArea,
  explicitlyRequestedArea: (text: string) => /area academica/i.test(text) ? 'fidelizacion' : null,
}))

import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.pendingSequence = []
  h.state.paymentReview = null
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.runAutomation.mockReset().mockResolvedValue(true)
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.routeArea.mockReset().mockResolvedValue({ agentId: null });
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('corrects a presencial question without calling the model or interrupting the course', async () => {
    h.state.pendingSequence = [{automation_id:'education',context:{conversation_id:'conv-1'}}]
    h.buildConversationContext.mockResolvedValue([{role:'user',content:'¿Es precencial?'}])
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining('cursos son virtuales')}))
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.runAutomation).not.toHaveBeenCalled()
  })
  it('answers an off-script question without replacing the active course sequence', async () => {
    h.state.pendingSequence = [{automation_id:'education',context:{conversation_id:'conv-1'}}]
    h.state.autoResponders = [{id:'other',name:'OTRA INFORMACION'}]
    h.buildConversationContext.mockResolvedValue([{role:'user',content:'¿Puedo estudiar desde mi celular?'}])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.generateReply.mock.calls[0][0].systemPrompt).toContain('siguiente bloque guardado')
    expect(h.runAutomation).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })
  it('answers prices from the sent audio without spending another generation call',async()=>{
    h.buildConversationContext.mockResolvedValue([{role:'assistant',content:'[AUDIO ENVIADO: NUTRICION 19.90]\nMensualidad en 79.90. Primer mes 19.90. Seis meses.'},{role:'user',content:'Cuanto pagare cada mes?'}])
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining('S/79.90')}))
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.runAutomation).not.toHaveBeenCalled()
  })
  it('answers a Yape number request without asking for enrollment data or generating a number',async()=>{
    h.buildConversationContext.mockResolvedValue([{role:'user',content:'Número para yapear'}])
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining('937467119')}))
    expect(h.generateReply).not.toHaveBeenCalled()
  })
  it('does not resend payment accounts after an enrollment payment was validated', async () => {
    h.state.paymentReview = { status: 'validated', id: 'review-1' } as never
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: '¿Cuáles son sus cuentas bancarias?' }])
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('No realices otro pago'),
    }))
    expect(h.engineSendText).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('200-300678464-8') }))
    expect(h.generateReply).not.toHaveBeenCalled()
  })
  it('replaces an account number hallucinated while a paid registration is incomplete', async () => {
    h.state.paymentReview = { status: 'validated', id: 'review-1' } as never
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Mañana enviaré mi documento' }])
    h.generateReply.mockResolvedValue({ text: 'Puedes depositar en la cuenta BCP 19493736306035', handoff: false })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('No realices otro pago'),
    }))
    expect(h.engineSendText).not.toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('19493736306035') }))
  })
  it('continues an enrollment with a received payment without restarting Yape',async()=>{
    h.state.paymentReview = {status:'validated'}
    h.state.autoResponders=[{id:'payment',name:'YAPE O PLIN'}]
    h.buildConversationContext.mockResolvedValue([{role:'user',content:'sigamos con la inscripción'}])
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining('no necesitas volver a pagar')}))
    expect(h.runAutomation).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
  })
  it('blocks a fabricated Yape number in a model reply',async()=>{
    h.generateReply.mockResolvedValue({text:'Yape/Plin: 974 000 000',handoff:false})
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining('937467119')}))
    expect(h.engineSendText).not.toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining('974 000 000')}))
  })
  it('runs the saved course automation without generating or sending replacement text',async()=>{
    h.state.autoResponders=[{id:'nutricion',name:'NUTRICION 19.90'}]
    h.buildConversationContext.mockResolvedValue([{role:'user',content:'Quiero informacion de nutricion'}])
    await dispatchInboundToAiReply(ARGS)
    expect(h.runAutomation).toHaveBeenCalledWith(expect.objectContaining({automationId:'nutricion',conversationId:'conv-1'}))
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.retrieveKnowledge).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
  it('runs the saved enrollment steps when the student asks how to sign up',async()=>{
    h.state.autoResponders=[{id:'payment',name:'YAPE O PLIN'}]
    h.buildConversationContext.mockResolvedValue([{role:'user',content:'¿Cómo hago para inscribirme en el curso?'}])
    await dispatchInboundToAiReply(ARGS)
    expect(h.runAutomation).toHaveBeenCalledWith(expect.objectContaining({automationId:'payment',conversationId:'conv-1'}))
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
  it('does not launch the direct automation when the reply slot is denied',async()=>{
    h.state.claim=false
    h.state.autoResponders=[{id:'nutricion',name:'NUTRICION 19.90'}]
    h.buildConversationContext.mockResolvedValue([{role:'user',content:'Info de nutricion'}])
    await dispatchInboundToAiReply(ARGS)
    expect(h.runAutomation).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
  })
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('requests DNI or carné de extranjería without listing passport as a requested substitute', async () => {
    await dispatchInboundToAiReply(ARGS)
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('NOMBRE COMPLETO, DNI o CARNE DE EXTRANJERIA y CORREO ELECTRONICO')
    expect(systemPrompt).not.toContain('DNI o CARNE DE EXTRANJERIA o PASAPORTE')
  })

  it('does not block AI merely because an unrelated automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello!' }))
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('continues replying when an adviser is assigned but has not paused AI', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_enabled: true,
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      ai_handed_off_at: null,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello!' }))
    expect(h.state.updatePayload).toBeNull()
  })

  it('skips when the assigned human has paused AI on the conversation', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_enabled: false,
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('routes five unresolved identical messages once without calling the model', async () => {
    h.buildConversationContext.mockResolvedValue(Array.from({length:5},()=>[
      {role:'user',content:'Necesito el proceso especial XYZ'},
      {role:'assistant',content:'¿Me puedes explicar tu consulta?'},
    ]).flat().slice(0,-1))
    await dispatchInboundToAiReply(ARGS)
    expect(h.routeArea).toHaveBeenCalledTimes(1)
    expect(h.routeArea).toHaveBeenCalledWith(expect.anything(),'acct-1','conv-1','ventas')
    expect(h.state.updatePayload?.ai_handoff_summary).toContain('[REPETICION_SIN_RESOLVER]')
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.retrieveKnowledge).not.toHaveBeenCalled()
  })

  it('still hands off repeated unresolved messages after the AI reply cap', async () => {
    h.state.conv = { ai_reply_count:99, ai_handoff_area:'FIDELIZACION' }
    h.buildConversationContext.mockResolvedValue(Array.from({length:5},()=>({role:'user',content:'Expediente XYZ'})))
    await dispatchInboundToAiReply(ARGS)
    expect(h.routeArea).toHaveBeenCalledWith(expect.anything(),'acct-1','conv-1','fidelizacion')
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('keeps an existing repetition handoff in fidelity and only reassures on further messages', async () => {
    h.state.conv = {ai_reply_count:99,ai_handed_off_at:new Date().toISOString(),ai_handoff_area:'FIDELIZACION',
      ai_handoff_summary:'[REPETICION_SIN_RESOLVER] Cinco mensajes iguales.'}
    h.buildConversationContext.mockResolvedValue([{role:'user',content:'Sigo esperando'}])
    await dispatchInboundToAiReply(ARGS)
    expect(h.routeArea).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining('llamada o mensaje')}))
  })

  it('does not reassign an unresolved repeated question already handed off', async () => {
    h.state.conv = {ai_reply_count:0,ai_handed_off_at:new Date().toISOString(),ai_handoff_area:'FIDELIZACION'}
    h.buildConversationContext.mockResolvedValue(Array.from({length:5},()=>({role:'user',content:'Expediente XYZ'})))
    await dispatchInboundToAiReply(ARGS)
    expect(h.routeArea).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('does not route if another inbound already claimed the repetition handoff', async () => {
    h.state.claim = false
    h.buildConversationContext.mockResolvedValue(Array.from({length:5},()=>({role:'user',content:'Expediente XYZ'})))
    await dispatchInboundToAiReply(ARGS)
    expect(h.routeArea).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('does not answer the outbound-only service even when its support link changes', async () => {
    h.buildConversationContext.mockResolvedValue([{role:'user',content:'Este número es exclusivo para enviar comunicaciones a nuestros clientes. Para cualquier consulta sobre tu servicio escríbenos a nuestro WhatsApp https://botm.cc/l/nuevo, LucIA te atenderá.'}])
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.routeArea).not.toHaveBeenCalled()
  })

  it('writes a summary and sends a single handoff notice', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('derivé tu consulta a ventas') }))
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload?.ai_handed_off_at).toEqual(expect.any(String))
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled')
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes through the requested area rather than a fallback from another area', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.routeArea).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'conv-1', 'ventas');
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id');
  })
  it('transfers from sales to academic support even after an earlier handoff', async () => {
    h.state.conv = { assigned_agent_id: 'sales', ai_enabled: true, ai_reply_count: 0, ai_handed_off_at: new Date().toISOString(), ai_handoff_area: 'VENTAS' };
    h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'Necesito hablar con el area academica' }]);
    h.routeArea.mockResolvedValue({ agentId: 'fidelity' });
    await dispatchInboundToAiReply(ARGS);
    expect(h.routeArea).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'conv-1', 'fidelizacion');
    expect(h.state.updatePayload).not.toHaveProperty('ai_enabled');
  });
})
