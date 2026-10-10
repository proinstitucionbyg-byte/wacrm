import type { supabaseAdmin } from './admin-client'
import { transcribeSavedAudio } from '@/lib/ai/transcribe'

type Db = ReturnType<typeof supabaseAdmin>
/** Cache is bound to the URL. Sent messages keep their own immutable transcript. */
export async function automationAudioEvidence(args: {
  db: Db; accountId: string; automationId: string; name: string;
  stepId: string; config: Record<string, unknown>; url: string
}): Promise<string | undefined> {
  if (!/promo|informaci[oó]n/i.test(args.name)) return undefined
  let text = args.config.audio_transcript_url === args.url && typeof args.config.audio_transcript === 'string'
    ? args.config.audio_transcript : null
  if (!text) {
    text = await transcribeSavedAudio({ db: args.db, accountId: args.accountId, url: args.url })
    if (!text) return undefined
    // Compare original JSON so a simultaneous editor change is never overwritten.
    await args.db.from('automation_steps').update({ step_config: {
      ...args.config, audio_transcript: text, audio_transcript_url: args.url,
    } }).eq('id', args.stepId).eq('automation_id', args.automationId).eq('step_config', args.config)
  }
  return `[AUDIO ENVIADO: ${args.name}. TRANSCRIPCION AUTOMATICA; NO ES VALIDACION DE PAGO]\n${text}`
}
