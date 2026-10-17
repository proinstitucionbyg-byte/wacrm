import { describe, expect, it } from 'vitest'
import { alreadyFollowedUp, canFollowUpAfterLastMessage, isSavedAutomationMessage, needsIdleTextFallback } from './followup'
import { INITIAL_GREETING_ID, RETURN_GREETING_ID } from '@/lib/automations/greeting-continuity'
import { HUMAN_PAUSE_MS } from './human-pause'

describe('idle follow-up eligibility', () => {
  it('does not treat our own newer outgoing message as a new customer turn', () => {
    expect(alreadyFollowedUp('2026-10-17T12:22:47Z','2026-10-17T12:33:01Z')).toBe(true)
    expect(alreadyFollowedUp('2026-10-17T12:40:00Z','2026-10-17T12:33:01Z')).toBe(false)
    expect(alreadyFollowedUp('2026-10-17T12:22:47Z',null)).toBe(false)
  })
  it('replaces only a failed idle button with text, never an unrelated automation', () => {
    const last = {sender_type:'bot',content_type:'interactive',status:'failed',content_text:'¿Quieres que retomemos la conversación? Pulsa continuar y te ayudamos a elegir el área.'}
    expect(needsIdleTextFallback(last)).toBe(true)
    expect(needsIdleTextFallback({...last,status:'delivered'})).toBe(false)
    expect(needsIdleTextFallback({...last,content_type:'text'})).toBe(false)
    expect(needsIdleTextFallback({...last,content_text:'Selecciona tu curso'})).toBe(false)
  })
  it('continues after an unanswered AI question', () => {
    expect(canFollowUpAfterLastMessage('bot', '¿Qué curso te interesa?')).toBe(true)
  })

  it('resumes after adviser inactivity using the shared ten-minute window', () => {
    expect(HUMAN_PAUSE_MS).toBe(10 * 60 * 1000)
    expect(canFollowUpAfterLastMessage('agent', '¿Qué curso te interesa?')).toBe(true)
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
