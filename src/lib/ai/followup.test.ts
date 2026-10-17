import { describe, expect, it } from 'vitest'
import { canFollowUpAfterLastMessage, isSavedAutomationMessage } from './followup'
import { INITIAL_GREETING_ID, RETURN_GREETING_ID } from '@/lib/automations/greeting-continuity'

describe('idle follow-up eligibility', () => {
  it('continues after an unanswered AI question', () => {
    expect(canFollowUpAfterLastMessage('bot', '¿Qué curso te interesa?')).toBe(true)
  })

  it('does not interrupt a human or follow a statement', () => {
    expect(canFollowUpAfterLastMessage('agent', '¿Qué curso te interesa?')).toBe(false)
    expect(canFollowUpAfterLastMessage('bot', 'Gracias por escribirnos.')).toBe(false)
  })

  it('recognizes the final question of a linked block without depending on its start time', () => {
    expect(isSavedAutomationMessage('wamid.final', [{
      automation_id: 'nutrition',
      steps_executed: [{ detail: 'waiting 2 hours' },
        { detail: 'interactive sent via Meta (wamid.final)' }],
    }])).toBe(true)
  })

  it('keeps the follow-up available after greetings and unrelated or missing evidence', () => {
    for (const id of [INITIAL_GREETING_ID, RETURN_GREETING_ID]) {
      expect(isSavedAutomationMessage('wamid.greeting', [{ automation_id: id,
        steps_executed: [{ detail: 'interactive sent via Meta (wamid.greeting)' }] }])).toBe(false)
    }
    expect(isSavedAutomationMessage('wamid.new', [{ automation_id: 'nutrition',
      steps_executed: [{ detail: 'interactive sent via Meta (wamid.old)' }] }])).toBe(false)
    expect(isSavedAutomationMessage(null, [])).toBe(false)
  })
})
