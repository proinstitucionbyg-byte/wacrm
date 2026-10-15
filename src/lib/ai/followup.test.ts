import { describe, expect, it } from 'vitest'
import { canFollowUpAfterLastMessage } from './followup'

describe('idle follow-up eligibility', () => {
  it('continues after an unanswered AI question', () => {
    expect(canFollowUpAfterLastMessage('bot', '¿Qué curso te interesa?')).toBe(true)
  })

  it('does not interrupt a human or follow a statement', () => {
    expect(canFollowUpAfterLastMessage('agent', '¿Qué curso te interesa?')).toBe(false)
    expect(canFollowUpAfterLastMessage('bot', 'Gracias por escribirnos.')).toBe(false)
  })
})
