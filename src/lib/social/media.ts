import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

/** Signed social attachment URLs are fetched without any WhatsApp token.
 * Bound memory/time and prohibit redirects and private destinations. */
export async function downloadSocialMedia(url: string, maxBytes = 10 * 1024 * 1024) {
  if (new URL(url).protocol !== 'https:' || !await isDeliverableUrl(url)) throw new Error('URL de archivo no permitida.')
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) })
  if (!response.ok || Number(response.headers.get('content-length')) > maxBytes) throw new Error('Archivo no disponible o demasiado grande.')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Archivo vacío.')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) { await reader.cancel(); throw new Error('Archivo demasiado grande.') }
    chunks.push(value)
  }
  if (!size) throw new Error('Archivo vacío.')
  return { buffer: Buffer.concat(chunks), contentType: response.headers.get('content-type') || 'application/octet-stream' }
}
