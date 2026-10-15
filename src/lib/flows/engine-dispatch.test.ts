import { describe, expect, it, vi } from 'vitest'

const admin = vi.hoisted(() => vi.fn())
vi.mock('./admin-client', () => ({ supabaseAdmin: admin }))

import { dispatchInboundToFlows } from './engine'

describe('Flow inbound idempotency', () => {
  it('checks only existing flow_run columns before ignoring a webhook retry', async () => {
    const selections: Array<[string, string]> = []
    let flowRunReads = 0
    const from = vi.fn((table: string) => {
      const result = table === 'conversations'
        ? { data: { automation_enabled: true }, error: null }
        : table === 'flow_runs'
          ? ++flowRunReads === 1
            ? { data: [{ id: 'run-1', flow_id: 'flow-1' }], error: null }
            : { data: [{ id: 'run-1' }], error: null }
          : { count: 1, error: null }
      const chain = {
        select: (columns: string) => { selections.push([table, columns]); return chain },
        eq: () => chain, order: () => chain, limit: () => chain, in: () => chain, filter: () => chain,
        maybeSingle: async () => result,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
      }
      return chain
    })
    admin.mockReturnValue({ from })

    const result = await dispatchInboundToFlows({
      accountId: 'account', userId: 'owner', contactId: 'contact', conversationId: 'conversation',
      isFirstInboundMessage: false,
      message: { kind: 'text', text: 'Hola', meta_message_id: 'meta-1' },
    })
    expect(result.outcome).toBe('duplicate_inbound_ignored')
    expect(selections.filter(([table]) => table === 'flow_runs')).toEqual([
      ['flow_runs', '*'], ['flow_runs', 'id'],
    ])
  })
})
