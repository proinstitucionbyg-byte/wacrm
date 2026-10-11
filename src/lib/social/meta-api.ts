import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'

export type SocialChannel = 'instagram' | 'messenger'
export function isSocialChannel(channel: unknown): channel is SocialChannel {
  return channel === 'instagram' || channel === 'messenger'
}

export interface SocialMessageInput {
  messageType: string
  text?: string | null
  mediaUrl?: string | null
  filename?: string | null
  interactivePayload?: InteractiveMessagePayload | null
}
export interface SocialMessagePart {
  message: Record<string, unknown>
  contentType: string
  contentText: string | null
  mediaUrl?: string
  interactivePayload?: InteractiveMessagePayload
}

/** Facebook Login credentials belong to one explicitly bound CRM account.
 * Never select the first account or treat a social scoped ID as a phone.
 * See https://developers.facebook.com/docs/messenger-platform/instagram/ . */
export function socialConfiguration(channel: SocialChannel, accountId: string) {
  if (!accountId || process.env.META_CHANNEL_ACCOUNT_ID !== accountId) {
    throw new Error('Vincula META_CHANNEL_ACCOUNT_ID a la cuenta del CRM antes de usar este canal.')
  }
  const assetId = channel === 'instagram'
    ? process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID
    : process.env.MESSENGER_PAGE_ID
  const token = channel === 'instagram'
    ? process.env.INSTAGRAM_ACCESS_TOKEN
    : process.env.MESSENGER_PAGE_ACCESS_TOKEN
  if (!assetId || !/^\d+$/.test(assetId) || !token) {
    throw new Error(`Falta configurar la cuenta y autorización de ${channel}.`)
  }
  return { assetId, token }
}

/** Preserve the stored block content and order. Instagram's Messenger API
 * has no file attachment: documents are sent as their download link.
 * Quick replies carry the original option IDs back to the same flow. */
export function socialMessageParts(channel: SocialChannel, input: SocialMessageInput): SocialMessagePart[] {
  const textPart = (text: string): SocialMessagePart => ({ message: { text }, contentType: 'text', contentText: text })
  if (input.messageType === 'text') {
    if (!input.text?.trim()) throw new Error('El mensaje está vacío.')
    return [textPart(input.text)]
  }
  if (input.messageType === 'interactive') {
    const payload = input.interactivePayload
    if (!payload) throw new Error('Faltan las opciones del mensaje.')
    const options = payload.kind === 'buttons' ? payload.buttons : payload.sections.flatMap(section => section.rows)
    if (!options.length || options.length > 13 || options.some(option => !option.id || !option.title)) {
      throw new Error('Este canal admite entre 1 y 13 opciones con identificadores y títulos.')
    }
    // A WhatsApp list may use 24-character titles and descriptions. Preserve
    // those in the visible text; only the quick-reply label is shortened.
    const listText = payload.kind === 'list' ? payload.sections.map(section =>
      [section.title, ...section.rows.map(row => [row.title, row.description].filter(Boolean).join(': '))].filter(Boolean).join('\n')
    ).join('\n\n') : undefined
    const text = [payload.header, payload.body, listText, payload.footer].filter(Boolean).join('\n\n')
    return [{
      message: { text, quick_replies: options.map(option => ({ content_type: 'text', title: option.title.slice(0, 20), payload: option.id })) },
      contentType: 'interactive', contentText: text, interactivePayload: payload,
    }]
  }
  if (!['image', 'video', 'audio', 'document'].includes(input.messageType)) {
    throw new Error(`El tipo ${input.messageType} no está disponible en ${channel}.`)
  }
  let url: URL
  try { url = new URL(input.mediaUrl ?? '') } catch { throw new Error('El archivo necesita un enlace HTTPS accesible.') }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('El archivo necesita un enlace HTTPS accesible.')
  if (channel === 'instagram' && input.messageType === 'document') {
    return [textPart([input.text, input.filename, input.mediaUrl].filter(Boolean).join('\n'))]
  }
  const attachment: SocialMessagePart = {
    message: { attachment: { type: input.messageType === 'document' ? 'file' : input.messageType, payload: { url: input.mediaUrl } } },
    contentType: input.messageType, contentText: null, mediaUrl: input.mediaUrl!,
  }
  // Social attachments don't accept a WhatsApp caption. Send the original
  // caption as a separate text, retaining its whitespace and line breaks.
  return input.text?.trim() ? [attachment, textPart(input.text)] : [attachment]
}

export async function sendSocialPart(channel: SocialChannel, config: { assetId: string; token: string }, recipientId: string, part: SocialMessagePart): Promise<string> {
  if (!/^\d+$/.test(recipientId) || recipientId === config.assetId) throw new Error('Destinatario de este canal inválido.')
  const version = process.env.META_GRAPH_API_VERSION || 'v23.0'
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('Versión de Meta inválida.')
  const response = await fetch(`https://graph.facebook.com/${version}/${config.assetId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ recipient: { id: recipientId }, ...(channel === 'messenger' ? { messaging_type: 'RESPONSE' } : {}), message: part.message }),
    signal: AbortSignal.timeout(20_000),
  })
  const data = await response.json() as { message_id?: string; error?: { code?: number; error_subcode?: number } }
  if (!response.ok || data.error) {
    // Never log tokens, URLs containing credentials, or the customer's data.
    const code = data.error?.code
    if (code === 190) throw new Error('Meta rechazó la autorización. Renueva la conexión de este canal.')
    if (code === 3 || code === 10 || code === 200) throw new Error('Meta no autoriza enviar desde este canal: revisa sus permisos y acceso de la app.')
    throw new Error(`Meta rechazó el envío de ${channel} (código ${code ?? response.status}).`)
  }
  if (!data.message_id) throw new Error('Meta no devolvió una confirmación de envío.')
  return data.message_id
}
