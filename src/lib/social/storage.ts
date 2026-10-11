import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SocialChannel } from './meta-api'

export const SOCIAL_MEDIA_BUCKET = 'social-media'
export function socialMediaPath(channel: SocialChannel, accountId: string, conversationId: string, metaId: string) {
  if (![accountId, conversationId].every(id => /^[a-zA-Z0-9-]+$/.test(id)) || !metaId) throw new Error('Identificadores de archivo inválidos.')
  return `${accountId}/${channel}/${conversationId}/${createHash('sha256').update(metaId).digest('hex')}`
}
export async function saveSocialImage(db: SupabaseClient, channel: SocialChannel, accountId: string, conversationId: string, metaId: string, media: { buffer: Buffer; contentType: string }) {
  const mime = media.contentType.split(';')[0].trim().toLowerCase()
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime) || !media.buffer.length || media.buffer.length > 10 * 1024 * 1024) throw new Error('Imagen no permitida.')
  const path = socialMediaPath(channel, accountId, conversationId, metaId)
  const { error } = await db.storage.from(SOCIAL_MEDIA_BUCKET).upload(path, media.buffer, { contentType: mime, upsert: true })
  if (error) throw error
  return path
}
export async function readSocialImage(db: SupabaseClient, channel: SocialChannel, accountId: string, conversationId: string, metaId: string) {
  const { data, error } = await db.storage.from(SOCIAL_MEDIA_BUCKET).download(socialMediaPath(channel, accountId, conversationId, metaId))
  if (error || !data) throw error ?? new Error('Imagen no disponible.')
  return { buffer: Buffer.from(await data.arrayBuffer()), contentType: data.type }
}

export async function saveSocialDocument(db: SupabaseClient, accountId: string, enrollmentId: string, hash: string, buffer: Buffer) {
  if (![accountId, enrollmentId].every(id => /^[a-zA-Z0-9-]+$/.test(id)) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Identificadores de documento inválidos.')
  const path = `${accountId}/enrollments/${enrollmentId}/${hash}.pdf`
  const storage = db.storage.from(SOCIAL_MEDIA_BUCKET)
  const { error } = await storage.upload(path, buffer, { contentType: 'application/pdf', upsert: true })
  if (error) throw error
  // A private link gives Meta time to fetch the file. Instagram customers
  // receive this link because its API cannot send a PDF attachment.
  const signed = await storage.createSignedUrl(path, 7 * 24 * 60 * 60)
  if (signed.error || !signed.data?.signedUrl) throw signed.error ?? new Error('No se creó el enlace del PDF.')
  return { mediaId: path, url: signed.data.signedUrl }
}
