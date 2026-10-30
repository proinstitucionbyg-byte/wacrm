import { describe, expect, it, vi } from 'vitest'
import { pauseUnknownFirstInboundForHuman } from './first-inbound-routing'

describe('first inbound from owner-linked WhatsApp Web', () => {
  it('lets a direct question reach the shared CRM routing without requiring an ad keyword', async () => {
    const db = { from: vi.fn() }
    const result = await pauseUnknownFirstInboundForHuman(db as never, {
      accountId: 'account', conversationId: 'conversation', contactId: 'contact', userId: 'owner',
      isFirstInboundMessage: true, channel: 'session', text: '¿Cuánto debo de mi mensualidad?',
      hasConfirmedAdOrigin: false, messageId: 'session-message', receivedAt: '2026-10-29T10:00:00.000Z',
      contactCreated: true,
    })
    expect(result).toBe('continue')
    expect(db.from).not.toHaveBeenCalled()
  })
})
