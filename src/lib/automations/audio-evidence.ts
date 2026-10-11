import type { supabaseAdmin } from './admin-client'
import { transcribeSavedAudio } from '@/lib/ai/transcribe'
import { quotedOfferPrices } from '@/lib/matriculas/offer-prices'

type Db = ReturnType<typeof supabaseAdmin>
/** Cache is bound to the URL. Sent messages keep their own immutable transcript. */
export async function automationAudioEvidence(args: {
  db: Db; accountId: string; automationId: string; name: string;
  stepId: string; config: Record<string, unknown>; url: string; writtenText?: string
}): Promise<string | undefined> {
  if (/malla|bienvenida/i.test(args.name) || !/promo|informaci[oó]n|\d+[.,]\d{2}/i.test(args.name)) return undefined
  // Only successfully sent steps from this execution; never an older promotion.
  const written = args.writtenText?.trim()
  if (written && quotedOfferPrices(written)) {
    return `[OFERTA ENVIADA: ${args.name}. DATOS DEL TEXTO O PIE DE IMAGEN ENVIADOS]\n${written}`
  }
  let text = args.config.audio_transcript_url === args.url && typeof args.config.audio_transcript === 'string'
    ? args.config.audio_transcript : null
  if (!text) {
    text = await transcribeSavedAudio({ db: args.db, accountId: args.accountId, url: args.url })
    if (!text) return undefined
    // Compare original JSON so a simultaneous editor change is never overwritten.
    const { error } = await args.db.from('automation_steps').update({ step_config: {
      ...args.config, audio_transcript: text, audio_transcript_url: args.url,
    } }).eq('id', args.stepId).eq('automation_id', args.automationId).eq('step_config', JSON.stringify(args.config))
    if (error) console.error('[automation audio] transcript cache failed:', error.message)
  }
  return `[AUDIO ENVIADO: ${args.name}. TRANSCRIPCION AUTOMATICA; NO ES VALIDACION DE PAGO]\n${text}`
}
