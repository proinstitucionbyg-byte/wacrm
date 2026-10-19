import type { ChatMessage } from './types'

// Verified against the institution's CUENTAS BANCARIAS image in CRM storage.
export const YAPE_PLIN_NUMBER = '937467119'
export const PAYMENT_ACCOUNT_DETAILS = {
  interbank: '200-300678464-8',
  bbva: '0011-05210200381966',
  bcp: '19493736306035',
} as const

const holder = 'Luis Brayan Palacios Carhuapoma'
const bankReply = `Estas son las cuentas que figuran en nuestros medios de pago:\nInterbank (corriente): ${PAYMENT_ACCOUNT_DETAILS.interbank}, a nombre de Instituto de Formación y Crecimiento Profesional INSTICRECE.\nBBVA (ahorros): ${PAYMENT_ACCOUNT_DETAILS.bbva}, a nombre de ${holder}.\nBCP (ahorros): ${PAYMENT_ACCOUNT_DETAILS.bcp}, a nombre de ${holder}.\nCuando realices el pago, envíanos el comprobante por aquí. 😊`
const mobileReply = `Puedes pagar por Yape o Plin al ${YAPE_PLIN_NUMBER}, a nombre de ${holder}. Cuando realices el abono, envíanos el comprobante por aquí. 😊`

export function verifiedPaymentReply(messages: ChatMessage[]): string | null {
  const latest = [...messages].reverse().find(message => message.role === 'user')?.content.trim() ?? ''
  const previous = [...messages].reverse().find(message => message.role === 'assistant')?.content ?? ''
  const asksForBank = /(?:cuenta|c[oó]digo|cci|transferencia|interbank|bbva|bcp|datos bancarios)/i.test(latest)
    && /(?:bancari|banco|transferencia|interbank|bbva|bcp|cci|n[uú]mero de cuenta)/i.test(latest)
  if (asksForBank) return bankReply
  const asksForYape = /(?:yape|plin|yapear|plinear)/i.test(latest)
    && /(?:n[uú]mero|celular|d[oó]nde|donde|c[oó]mo|medio|pagar|abonar|yapear|plinear)/i.test(latest)
  const acceptsPaymentOffer = /^(?:s[ií]|claro|ok|dale|por favor|env[ií]ame|comp[aá]rteme)[.!\s😊👍]*$/i.test(latest)
    && /(?:compart|envi).{0,35}(?:medio|n[uú]mero).{0,25}pago/i.test(previous)
  if (asksForYape || acceptsPaymentOffer) return mobileReply
  return null
}

/** Never transmit an AI-invented number when it labels it Yape or Plin. */
export function safePaymentReply(text: string): string {
  if (/interbank|bbva|bcp|cuenta bancaria/i.test(text)) {
    const accounts = [...text.matchAll(/(?:\d[\s.-]*){13,20}/g)]
      .map(match => match[0].replace(/\D/g, ''))
    if (accounts.some(value => !Object.values(PAYMENT_ACCOUNT_DETAILS).some(account => account.replace(/\D/g, '') === value))) return bankReply
  }
  if (/yape|plin/i.test(text)) {
    const digits = [...text.matchAll(/(?:\+?51[\s.-]*)?(?:\d[\s.-]*){9,11}/g)]
      .map(match => match[0].replace(/\D/g, ''))
    if (digits.some(value => value !== YAPE_PLIN_NUMBER && value !== `51${YAPE_PLIN_NUMBER}`)) return mobileReply
  }
  return text
}
