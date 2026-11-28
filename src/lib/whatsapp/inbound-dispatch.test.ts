import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  auto: vi.fn(), flow: vi.fn(), tag: vi.fn(), first: vi.fn(), deferred: vi.fn(),
  explicit: vi.fn(), billing: vi.fn(), followup: vi.fn(), teacher: vi.fn(),
  sales: vi.fn(), ai: vi.fn(), support: vi.fn(), organic: vi.fn(), welcome: vi.fn(),
}))

vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: h.auto }))
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: h.flow }))
vi.mock('@/lib/sales/attribution', () => ({ tagCommercialInquiry: h.tag }))
vi.mock('./first-inbound-routing', () => ({ pauseUnknownFirstInboundForHuman: h.first }))
vi.mock('./deferred-keyword-openings', () => ({ hasPendingDeferredKeywordOpening: h.deferred }))
vi.mock('./cloud-support', () => ({ routeCloudSupportOpening: h.support }))
vi.mock('./universal-welcome', () => ({ gateNewNumberWelcome: h.welcome }))
vi.mock('./noncampaign-fidelity', () => ({ pauseNoncampaignFidelity: h.organic }))
vi.mock('@/lib/ai/explicit-human-request', () => ({ handleExplicitHumanRequest: h.explicit }))
vi.mock('./billing-runtime', () => ({ gateAutomaticWhatsAppConversation: h.billing }))
vi.mock('@/lib/ai/followup', () => ({ handleIdleFollowupReply: h.followup }))
vi.mock('@/lib/matriculas/teachers', () => ({ handleTeacherInbound: h.teacher }))
vi.mock('@/lib/ai/sales-routing', () => ({ routeInboundSales: h.sales }))
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply: h.ai }))

import { dispatchInboundThroughCrm } from './inbound-dispatch'

const common = {
  db: {from:()=>{const q={select:()=>q,eq:()=>q,single:async()=>({data:{whatsapp_support_line_key:null},error:null})};return q}} as never, accountId: 'account', userId: 'owner', contactId: 'contact',
  conversationId: 'conversation', messageId: 'inbound-session-id', contentText: 'Quiero informes',
  isFirstInboundMessage: false, inboundAt: '2026-10-29T10:00:00.000Z',
  contactCreated: false, hasConfirmedAdOrigin: false,
  conversation: { automation_enabled: true, ai_enabled: false, last_human_message_at: null },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.flow.mockResolvedValue({ consumed: false })
  h.auto.mockResolvedValue(true)
  h.first.mockResolvedValue('continue')
  h.deferred.mockResolvedValue(false)
  h.explicit.mockResolvedValue(false)
  h.billing.mockResolvedValue({ allowed: true })
  h.followup.mockResolvedValue(false)
  h.teacher.mockResolvedValue(false)
  h.support.mockResolvedValue(false)
  h.welcome.mockResolvedValue('legacy')
  h.organic.mockResolvedValue(false)
})

describe('dispatchInboundThroughCrm', () => {
  it('does not tag sales or run any reply engine for organic fidelity contacts', async () => {
    h.organic.mockResolvedValue(true)
    await dispatchInboundThroughCrm({ ...common, channel: 'session' })
    for (const fn of [h.tag, h.sales, h.flow, h.auto, h.ai, h.support]) expect(fn).not.toHaveBeenCalled()
  })
  it('runs the same stored CRM Flows and automation branches for a session without applying Meta Cloud billing', async () => {
    await dispatchInboundThroughCrm({ ...common, channel: 'session' })
    expect(h.tag).toHaveBeenCalledWith(common.db, expect.objectContaining({
      accountId: 'account', contactId: 'contact', text: 'Quiero informes',
    }))
    expect(h.flow).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account', contactId: 'contact', conversationId: 'conversation',
      message: { kind: 'text', text: 'Quiero informes', meta_message_id: 'inbound-session-id' },
    }))
    expect(h.auto).toHaveBeenCalledWith(expect.objectContaining({
      triggerType: 'new_message_received',
      context: expect.objectContaining({ conversation_id: 'conversation', inbound_message_id: 'inbound-session-id' }),
    }))
    expect(h.billing).not.toHaveBeenCalled()
  })

  it('passes a first session inbound through the same human gate without waiting for a Meta window', async () => {
    await dispatchInboundThroughCrm({ ...common, channel: 'session', isFirstInboundMessage: true })
    expect(h.first).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      channel: 'session', hasConfirmedAdOrigin: false,
    }))
    expect(h.billing).not.toHaveBeenCalled()
  })

  it('keeps Cloud billing checks and passes the channel to the shared first-inbound gate', async () => {
    await dispatchInboundThroughCrm({ ...common, channel: 'cloud', isFirstInboundMessage: true })
    expect(h.billing).toHaveBeenCalledOnce()
    expect(h.first).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      channel: 'cloud', messageId: 'inbound-session-id',
    }))
  })

  it('does not let the AI fallback bypass a denied Cloud billing gate', async () => {
    h.billing.mockResolvedValue({ allowed: false })
    await dispatchInboundThroughCrm({
      ...common,
      channel: 'cloud',
      conversation: { ...common.conversation, ai_enabled: true, automation_enabled: true },
    })
    expect(h.billing).toHaveBeenCalledOnce()
    expect(h.flow).not.toHaveBeenCalled()
    expect(h.auto).not.toHaveBeenCalled()
    expect(h.ai).not.toHaveBeenCalled()
  })

  it('does not let the AI fallback answer while an unknown first Cloud inbound is deferred', async () => {
    h.first.mockResolvedValue('deferred')
    await dispatchInboundThroughCrm({
      ...common,
      channel: 'cloud',
      isFirstInboundMessage: true,
      conversation: { ...common.conversation, ai_enabled: true, automation_enabled: true },
    })
    expect(h.first).toHaveBeenCalledOnce()
    expect(h.billing).not.toHaveBeenCalled()
    expect(h.flow).not.toHaveBeenCalled()
    expect(h.auto).not.toHaveBeenCalled()
    expect(h.ai).not.toHaveBeenCalled()
  })

  it('preserves an existing conversation automation pause for either channel', async () => {
    await dispatchInboundThroughCrm({ ...common, channel: 'session', conversation: { ...common.conversation, automation_enabled: false } })
    expect(h.flow).not.toHaveBeenCalled()
    expect(h.auto).not.toHaveBeenCalled()
  })
})

describe('verified prepared menu continuation',()=>{
 const command={requestId:'command',actorId:'agent',automationId:'source-course'};
 it('routes a verified choice immediately without removing the normal human pause',async()=>{h.organic.mockResolvedValue(true);await dispatchInboundThroughCrm({...common,channel:'session',contentText:'Malla de Farmacia',interactiveReplyId:'btn_1',preparedCommand:command,conversation:{...common.conversation,last_human_message_at:new Date().toISOString()}});expect(h.organic).not.toHaveBeenCalled();expect(h.auto).toHaveBeenCalledWith(expect.objectContaining({triggerType:'keyword_match',context:expect.objectContaining({manual_agent_id:'agent',manual_command_run_id:'command',manual_source_automation_id:'source-course',message_text:'Malla de Farmacia'})}));});
 it('keeps ordinary human attention paused when there is no verified menu command',async()=>{await dispatchInboundThroughCrm({...common,channel:'session',interactiveReplyId:'btn_1',conversation:{...common.conversation,last_human_message_at:new Date().toISOString()}});expect(h.auto).not.toHaveBeenCalled();});
 it('does not reactivate explicitly disabled automation for a verified menu',async()=>{await dispatchInboundThroughCrm({...common,channel:'session',interactiveReplyId:'btn_1',preparedCommand:command,conversation:{...common.conversation,automation_enabled:false}});expect(h.auto).not.toHaveBeenCalled();});
});
