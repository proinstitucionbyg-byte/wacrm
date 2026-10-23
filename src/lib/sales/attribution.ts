import type { SupabaseClient } from '@supabase/supabase-js'

const SALES_AREA_TAG = 'AREA VENTAS'
const EXISTING_STUDENT_TAGS = new Set(['AREA FIDELIZACION', 'PAGO VALIDADO'])

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** True for a clear request about courses, enrollment, promotions, or prices. */
export function isSalesInquiry(text: string, options?: { firstInbound?: boolean; hasAdReferral?: boolean }): boolean {
  if (options?.hasAdReferral) return true
  const normalized = normalizeText(text)
  if (/\b(informacion|info|informes?|curso|cursos|estudiar|capacitacion|matricula|inscripcion|inscribirme|promocion|promociones|promo|precio|precios|cuesta|mensualidad|certificado|certificacion|clases|farmacia|nutricion|recursos humanos|asistente administrativo|educacion inicial|auxiliar|me interesa|quiero saber|que cursos|programa de estudio)\b/.test(normalized)) return true
  return options?.firstInbound === true && /^\s*(hola+|holi+|holis|buenas?|buen dia|buenos dias|buenas tardes|buenas noches)\s*[!.😊👋]*\s*$/.test(normalized)
}

/** Applies the sales-area tag without overwriting an existing paid/fidelity classification. */
export async function tagCommercialInquiry(
  db: SupabaseClient,
  input: { accountId: string; contactId: string; userId: string; text: string; firstInbound: boolean; hasAdReferral: boolean },
): Promise<boolean> {
  if (!isSalesInquiry(input.text, { firstInbound: input.firstInbound, hasAdReferral: input.hasAdReferral })) return false

  try {
    const { data: links, error: existingError } = await db
      .from('contact_tags')
      .select('tag_id')
      .eq('contact_id', input.contactId)
    if (existingError) throw existingError

    const linkedTagIds = (links ?? []).map((row) => row.tag_id).filter(Boolean) as string[]
    const { data: existingRows, error: namesError } = linkedTagIds.length
      ? await db.from('tags').select('name').eq('account_id', input.accountId).in('id', linkedTagIds)
      : { data: [], error: null }
    if (namesError) throw namesError

    const existingNames = (existingRows ?? []).map((row) => row.name).filter(Boolean) as string[]
    if (existingNames.some((name) => EXISTING_STUDENT_TAGS.has(name))) return false
    if (existingNames.includes(SALES_AREA_TAG)) return true

    const { data: existingTag, error: tagLookupError } = await db
      .from('tags')
      .select('id')
      .eq('account_id', input.accountId)
      .eq('name', SALES_AREA_TAG)
      .limit(1)
      .maybeSingle()
    if (tagLookupError) throw tagLookupError

    let tagId = existingTag?.id as string | undefined
    if (!tagId) {
      const { data: createdTag, error: createError } = await db.from('tags').insert({
        account_id: input.accountId,
        user_id: input.userId,
        name: SALES_AREA_TAG,
        color: '#0ea5e9',
        kind: 'process',
      }).select('id').single()
      if (createError) throw createError
      tagId = createdTag?.id as string | undefined
    }
    if (!tagId) throw new Error('No se pudo resolver la etiqueta AREA VENTAS')

    const { error: attachError } = await db.from('contact_tags').upsert(
      { contact_id: input.contactId, tag_id: tagId },
      { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
    )
    if (attachError) throw attachError
    return true
  } catch (error) {
    console.error('[sales attribution] could not label commercial inquiry:', error)
    return false
  }
}
