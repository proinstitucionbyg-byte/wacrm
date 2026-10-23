import { describe, expect, it } from 'vitest'
import { isSalesInquiry } from './attribution'

describe('sales inquiry attribution', () => {
  it.each([
    'Quiero información de Farmacia',
    '¿Cuánto cuesta el curso de Recursos Humanos?',
    'Deseo matricularme en Educación Inicial',
    '🔥 Activar mi promo',
  ])('recognizes a commercial inquiry: %s', (text) => {
    expect(isSalesInquiry(text)).toBe(true)
  })

  it('treats a first-contact greeting as a sales lead but not a later greeting', () => {
    expect(isSalesInquiry('Hola', { firstInbound: true })).toBe(true)
    expect(isSalesInquiry('Hola', { firstInbound: false })).toBe(false)
  })

  it('classifies a click-to-WhatsApp ad referral as commercial', () => {
    expect(isSalesInquiry('Buenas', { hasAdReferral: true })).toBe(true)
  })

  it('does not classify unrelated text as a sales request', () => {
    expect(isSalesInquiry('Ya envié mi documento')).toBe(false)
  })
})
