import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  auto: vi.fn(), flow: vi.fn(), tag: vi.fn(), first: vi.fn(), deferred: vi.fn(),
  explicit: vi.fn(), billing: vi.fn(), followup: vi.fn(), teacher: vi.fn(),
  sales: vi.fn(), ai: vi.fn(),
}))

vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: h.auto }))
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: h.flow }))
vi.mock('@/lib/sales/attribution', () => ({ tagCommercialInquiry: h.tag }))
vi.mock('./first-inbound-routing', () => ({ pauseUnknownFirstInboundForHuman: h.first }))
vi.mock('./deferred-keyword-openings', () => ({ hasPendingDeferredKeywordOpening: h.deferred }))
vi.mock('@/lib/ai/explicit-human-request', () => ({ handleExplicitHumanRequest: h.explicit }))
vi.mock('./billing-runtime', () => ({ gateAutomaticWhatsAppConversation: h.billing }))
vi.mock('@/lib/ai/followup', () => ({ handleIdleFollowupReply: h.followup }))
vi.mock('@/lib/matriculas/teachers', () => ({ handleTeacherInbound: h.teacher }))
vi.mock('@/lib/ai/sales-routing', () => ({ routeInboundSales: h.sales }))
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply: h.ai }))

import { dispatchInboundThroughCrm } from './inbound-dispatch'

const common = {
  db: {} as never, accountId: 'account', userId: 'owner', contactId: 'contact',
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
})

describe('dispatchInboundThroughCrm', () => {
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

  it('preserves an existing conversation automation pause for either channel', async () => {
    await dispatchInboundThroughCrm({ ...common, channel: 'session', conversation: { ...common.conversation, automation_enabled: false } })
    expect(h.flow).not.toHaveBeenCalled()
    expect(h.auto).not.toHaveBeenCalled()
  })
})
