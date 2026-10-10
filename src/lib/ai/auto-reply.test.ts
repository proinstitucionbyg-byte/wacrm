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
          return { eq: () => Promise.resolve({ error: null }) }
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
  it('answers prices from the sent audio without spending another generation call',async()=>{
    h.buildConversationContext.mockResolvedValue([{role:'assistant',content:'[AUDIO ENVIADO: NUTRICION 19.90]\nMensualidad en 79.90. Primer mes 19.90. Seis meses.'},{role:'user',content:'Cuanto pagare cada mes?'}])
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({text:expect.stringContaining('S/79.90')}))
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.runAutomation).not.toHaveBeenCalled()
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
  it('writes a summary and sends a single handoff notice', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(h.engineSendText).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('equipo de ventas') }))
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
