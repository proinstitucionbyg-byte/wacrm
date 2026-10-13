import { describe, expect, it } from 'vitest'
import { isLikelyAutomatedInbound } from './automated-inbound'

describe('isLikelyAutomatedInbound', () => {
  it.each([
    'Este es un mensaje automático. No responda a este mensaje.',
    'Hola, soy el asistente virtual de la universidad.',
    'This is an automated message. Do not reply.',
    'Gracias por comunicarte. Selecciona una opción. Nuestro horario de atención es de lunes a viernes.',
  ])('blocks an explicit automated response: %s', (text) => {
    expect(isLikelyAutomatedInbound(text)).toBe(true)
  })

  it.each([
    'Hola',
    'Quiero información de nutrición',
    '¿Tienen un asistente virtual?',
    'No me respondió la asesora',
    '¿Qué opción debo seleccionar?',
  ])('keeps normal student messages active: %s', (text) => {
    expect(isLikelyAutomatedInbound(text)).toBe(false)
  })
})
