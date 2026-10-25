import type { AutomationStep } from '@/types'

export const COMMERCIAL_CADENCE_VERSION = '2026-10-25-v1'
export interface CommercialCadence {
  version: typeof COMMERCIAL_CADENCE_VERSION
  steps: Array<{ id: string; config?: Record<string, unknown> }>
}

/** Explicitly configured, pinned at launch; never infer a new cadence for an old wait. */
export function readCommercialCadence(value: unknown): CommercialCadence | null {
  if (!value || typeof value !== 'object') return null
  const policy = value as CommercialCadence
  if (policy.version !== COMMERCIAL_CADENCE_VERSION || !Array.isArray(policy.steps)
    || policy.steps.length < 3 || policy.steps.length > 30
    || policy.steps.some(step => !step || typeof step.id !== 'string'
      || (step.config !== undefined && (!step.config || typeof step.config !== 'object' || Array.isArray(step.config))))
    || new Set(policy.steps.map(step => step.id)).size !== policy.steps.length) return null
  return structuredClone(policy)
}

/** Existing UUIDs and positions remain intact for every bounded button return. */
export function applyCommercialCadence(steps: AutomationStep[], policy: CommercialCadence): AutomationStep[] {
  const planned = new Map(policy.steps.map(step => [step.id, step]))
  return steps.filter(step => planned.has(step.id)).map(step => ({
    ...step, step_config: { ...step.step_config, ...planned.get(step.id)?.config },
  }))
}

/** Build against the verified 54/55-step course architecture; fail on structural drift. */
export function buildCommercialCadence(steps: AutomationStep[], nutrition = false): CommercialCadence {
  const roots = steps.filter(step => !step.parent_step_id).sort((a, b) => a.position - b.position)
  if (![54, 55].includes(roots.length)) throw Error('La estructura del curso cambió: revisar antes de aplicar')
  const offset = roots.length === 55 ? 1 : 0
  const at = (position: number, type: string) => {
    const step = roots.find(row => row.position === position)
    if (!step || step.step_type !== type) throw Error(`El bloque ${position} cambió de estructura`)
    return step
  }
  const initial = at(3, 'send_buttons')
  const certification = at(29 + offset, 'send_buttons')
  const evidence = at(42 + offset, 'send_media')
  // The 23-hour scheduler verifies delivery of this actual terminal UUID.
  const benefits = at(53 + offset, 'send_buttons')
  const withHuman = (step: AutomationStep, body: string) => {
    const config = step.step_config as Record<string, unknown>
    const buttons = config.buttons as Array<{ id: string; title: string }>
    if (!Array.isArray(buttons) || buttons.length !== 2) throw Error('Opciones de curso inesperadas')
    return { ...config, body, footer: '', buttons: [...buttons, { id: 'commercial_human', title: '🙋 Hablar con asesor' }] }
  }
  const intro = at(0, 'send_media').step_config as Record<string, unknown>
  const caption = String(intro.caption ?? '')
  const heading = caption.split('\n')[0]
  const monthly = caption.match(/49[.,]90|79[.,]90/g)?.find(price => price !== '19.90')
  if (!monthly) throw Error('No se pudo conservar la mensualidad de la oferta')
  const schedule = caption.match(/🕒[^]*?(?=\n\n💼|\n💼|$)/)?.[0] ?? ''
  const plan: CommercialCadence = { version: COMMERCIAL_CADENCE_VERSION, steps: [
    { id: at(0, 'send_media').id, config: { caption: `${heading}\n\n🔥 *Matrícula + primera mensualidad: S/19.90.*\nDe la 2.ª a la 6.ª mensualidad: S/${monthly}.\n\n💻 Clases virtuales en vivo · 6 meses.\n🎓 Certificación con QR, según los requisitos del programa.\n🎁 Office desde el segundo módulo con esta promoción.\n\n${schedule}\n\nElige qué deseas revisar. Tu matrícula se completa después de validar el pago y registrar tus datos.` } },
    { id: at(1, 'send_media').id },
    { id: initial.id, config: withHuman(initial, 'Puedes revisar la malla, continuar con la promoción o pedir atención humana. También puedes escribir tu duda.') },
    { id: at(4, 'wait').id, config: { unit: 'minutes', amount: 20 } },
    { id: at(5, 'send_media').id }, { id: at(6, 'send_media').id },
    { id: at(28 + offset, 'wait').id, config: { unit: 'minutes', amount: 55 } },
    { id: certification.id, config: withHuman(certification, '¿Qué necesitas aclarar para decidir: horario, pago o certificación? Puedes escribirnos tu duda. La certificación cuenta con QR y requiere cumplir las condiciones del programa.') },
    { id: at(39 + offset, 'wait').id, config: { unit: 'minutes', amount: 225 } },
    { id: evidence.id, ...(nutrition ? { config: { ...at(17, 'send_media').step_config } } : {}) },
    { id: benefits.id, config: withHuman(benefits, 'Te compartimos una muestra de tu formación. Puedes revisar los beneficios, continuar con tu inscripción o pedir ayuda. La malla, clase modelo, regalo y certificación siguen disponibles si los solicitas.') },
  ] }
  if (!readCommercialCadence(plan)) throw Error('Plan comercial inválido')
  return plan
}
