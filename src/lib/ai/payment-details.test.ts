import { describe, expect, it } from 'vitest'
import { safePaymentReply, verifiedPaymentReply } from './payment-details'

describe('verified payment details', () => {
  it('answers a direct Yape request and acceptance of a payment offer', () => {
    expect(verifiedPaymentReply([{role:'user',content:'Número para yapear'}])).toContain('937467119')
    expect(verifiedPaymentReply([
      {role:'assistant',content:'¿Deseas que te comparta el medio de pago para continuar?'},
      {role:'user',content:'Sí'},
    ])).toContain('937467119')
    expect(verifiedPaymentReply([{role:'user',content:'Sí'}])).toBeNull()
  })
  it('answers bank details exactly from the approved payment image', () => {
    const reply = verifiedPaymentReply([{role:'user',content:'¿Cuáles son sus cuentas bancarias?'}])
    expect(reply).toContain('200-300678464-8')
    expect(reply).toContain('0011-05210200381966')
    expect(reply).toContain('19493736306035')
  })
  it('replaces an invented AI Yape number', () => {
    expect(safePaymentReply('Yape/Plin: 974 000 000')).toContain('937467119')
    expect(safePaymentReply('Yape/Plin: 974 000 000')).not.toContain('974 000 000')
    expect(safePaymentReply('Yape/Plin: 937 467 119')).toBe('Yape/Plin: 937 467 119')
    expect(safePaymentReply('Cuenta BCP 12345678901234')).toContain('19493736306035')
  })
})
