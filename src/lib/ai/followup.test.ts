import { describe, expect, it } from 'vitest'
import { canFollowUpAfterLastMessage } from './followup'

describe('idle follow-up eligibility', () => {
  it('continues after an unanswered AI question', () => {
    expect(canFollowUpAfterLastMessage('bot', '¿Qué curso te interesa?', false)).toBe(true)
  })

  it('does not repeat an automation or interrupt a human', () => {
    expect(canFollowUpAfterLastMessage('bot', '¿Qué curso te interesa?', true)).toBe(false)
    expect(canFollowUpAfterLastMessage('agent', '¿Qué curso te interesa?', false)).toBe(false)
    expect(canFollowUpAfterLastMessage('bot', 'Gracias por escribirnos.', false)).toBe(false)
  })
})
