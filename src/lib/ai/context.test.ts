import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext } from './context'

/** Minimal fake matching the query chain in buildConversationContext:
 *  from().select().eq().eq().order().limit() → { data, error }. */
function fakeDb(rows: unknown[]): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return chain as unknown as SupabaseClient
}

describe('buildConversationContext', () => {
  it('includes image evidence and recipient comparison as unverified data', async () => {
    const result = await buildConversationContext(fakeDb([{ sender_type: 'customer', content_type: 'image', content_text: 'Mi pago', image_analysis: { status: 'pending_review', category: 'payment_receipt', fields: { amount: '19.90' }, recipient_check: { expected: 'LUIS BRAYAN PALACIOS CARHUAPOMA', status: 'exact_match' } } }]), 'conv-1')
    expect(result[0].role).toBe('user')
    expect(result[0].content).toContain('Mi pago')
    expect(result[0].content).toContain('19.90')
    expect(result[0].content).toContain('LUIS BRAYAN PALACIOS CARHUAPOMA')
    expect(result[0].content).toContain('Esta comparación no aprueba el pago')
  })
  it('retains a manual-review instruction if image analysis fails', async () => {
    const result = await buildConversationContext(fakeDb([{ sender_type: 'customer', content_type: 'image', image_analysis: { status: 'failed', failure_reason: 'provider_error' } }]), 'conv-1')
    expect(result[0].content).toContain('Una asesora debe revisar')
  })
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      { sender_type: 'customer', content_text: 'third' },
      { sender_type: 'agent', content_text: 'second' },
      { sender_type: 'customer', content_text: 'first' },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_text: 'auto reply' }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: '   ' },
        { sender_type: 'customer', content_text: null },
        { sender_type: 'customer', content_text: 'real' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })
})
