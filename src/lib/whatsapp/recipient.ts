import { isValidE164, phoneVariants, sanitizePhoneForMeta } from './phone-utils'

/** A BSUID is an opaque recipient, never a phone to sanitize or retry. */
export function resolveWhatsAppRecipient(contact: { phone?: string | null; whatsapp_user_id?: string | null }) {
  const phone = sanitizePhoneForMeta(contact.phone ?? '')
  if (isValidE164(phone)) return { address: phone, variants: phoneVariants(phone), isPhone: true }
  const userId = contact.whatsapp_user_id?.trim() ?? ''
  if (/^[A-Za-z]{2}\.[A-Za-z0-9.]+$/.test(userId)) {
    return { address: userId, variants: [userId], isPhone: false }
  }
  throw new Error('contact has no valid WhatsApp phone or user ID')
}
