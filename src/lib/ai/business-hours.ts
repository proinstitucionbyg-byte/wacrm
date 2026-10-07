// ============================================================
// Business hours + customer-facing handoff notices.
// Hours are in Peru time (UTC-5, no daylight saving).
// Edit SCHEDULE, SCHEDULE_TEXT and the texts below to change them.
// ============================================================

interface DaySchedule {
  /** Opening time, minutes after midnight. */
  open: number
  /** Closing time, minutes after midnight. */
  close: number
}

/** 0 = Sunday ... 6 = Saturday. null = closed all day. */
const SCHEDULE: Array<DaySchedule | null> = [
  null, // domingo
  { open: 10 * 60, close: 22 * 60 }, // lunes
  { open: 10 * 60, close: 22 * 60 }, // martes
  { open: 10 * 60, close: 22 * 60 }, // miércoles
  { open: 10 * 60, close: 22 * 60 }, // jueves
  { open: 10 * 60, close: 22 * 60 }, // viernes
  { open: 8 * 60, close: 13 * 60 }, // sábado
]

const DAY_NAMES = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
]

/** Human-readable schedule used in customer messages. */
export const SCHEDULE_TEXT =
  'lunes a viernes de 10:00 a. m. a 10:00 p. m. y sábados de 8:00 a. m. a 1:00 p. m. (los domingos no atendemos)'

const LIMA_OFFSET_MS = -5 * 60 * 60 * 1000

function limaClock(now: number): { day: number; minutes: number } {
  const d = new Date(now + LIMA_OFFSET_MS)
  return {
    day: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  }
}

function formatTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  const suffix = h < 12 ? 'a. m.' : 'p. m.'
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

/** Adds a final period only when the text does not already end with one
 *  (avoids "a. m.." when the text ends in "a. m."). */
function ensurePeriod(s: string): string {
  return s.endsWith('.') ? s : `${s}.`
}

/** True when the team is inside working hours (Peru time). */
export function isOpenNow(now: number = Date.now()): boolean {
  const { day, minutes } = limaClock(now)
  const today = SCHEDULE[day]
  if (!today) return false
  return minutes >= today.open && minutes < today.close
}

/** e.g. "hoy a las 10:00 a. m.", "mañana a las 10:00 a. m.", "el lunes a las 10:00 a. m." */
export function nextOpeningText(now: number = Date.now()): string {
  const { day, minutes } = limaClock(now)
  for (let offset = 0; offset <= 7; offset++) {
    const idx = (day + offset) % 7
    const sched = SCHEDULE[idx]
    if (!sched) continue
    if (offset === 0 && minutes >= sched.open) continue
    const when =
      offset === 0 ? 'hoy' : offset === 1 ? 'mañana' : `el ${DAY_NAMES[idx]}`
    return `${when} a las ${formatTime(sched.open)}`
  }
  return 'en nuestro próximo horario de atención'
}

/** Short availability note injected into the AI's instructions. */
export function scheduleContext(now: number = Date.now()): string {
  const open = isOpenNow(now)
  return (
    `Team availability (Peru time): ${SCHEDULE_TEXT}. ` +
    (open
      ? 'Right now the team is within working hours.'
      : `Right now the team is OUTSIDE working hours; the next opening is ${nextOpeningText(now)}.`)
  )
}

const AREA_LABELS: Record<string, string> = {
  ventas: 'ventas',
  fidelizacion: 'fidelización',
  egresados: 'egresados',
}

const KEEP_HELPING =
  ' Mientras tanto, si quieres, puedo seguir ayudándote por aquí.'

/**
 * Message the customer receives the first time the AI hands the
 * conversation to a person. Sent once per handoff. `delicate` gives a
 * softer version (no smiley, no rush) for bereavement, illness, etc.
 */
export function buildHandoffNotice(args: {
  area: string
  agentConnected: boolean
  delicate?: boolean
  now?: number
}): string {
  const now = args.now ?? Date.now()
  const label = AREA_LABELS[args.area] ?? args.area

  if (args.delicate) {
    const when = args.agentConnected
      ? 'Una asesora te escribirá en unos minutos.'
      : isOpenNow(now)
        ? 'Una asesora te escribirá apenas se libere.'
        : `Una asesora te atenderá ${ensurePeriod(nextOpeningText(now))}`
    return `Tu caso ya quedó derivado con prioridad a nuestro equipo de ${label} 🤍 ${when} Cuando te sientas con ánimo, puedes contarnos por aquí los detalles, sin ninguna prisa.`
  }

  if (args.agentConnected) {
    return `Gracias por escribirnos 😊 Ya derivé tu consulta con nuestro equipo de ${label}. En unos minutos te atenderán por este mismo chat.${KEEP_HELPING}`
  }

  if (isOpenNow(now)) {
    return `Gracias por escribirnos 😊 Ya derivé tu consulta con nuestro equipo de ${label}. En este momento nuestros asesores están atendiendo otras consultas; te escribirán apenas se libere uno. Nuestro horario es ${SCHEDULE_TEXT}.${KEEP_HELPING}`
  }

  return `Gracias por escribirnos 😊 Tu caso ya quedó registrado y derivado a nuestro equipo de ${label}. Ahora estamos fuera de horario: te atenderán ${ensurePeriod(nextOpeningText(now))} Nuestro horario es ${SCHEDULE_TEXT}.${KEEP_HELPING}`
}

/** Short reassurance when a customer asks again after being handed off. */
export function buildWaitingReminder(now: number = Date.now()): string {
  if (isOpenNow(now)) {
    return `Tu caso ya está derivado con nuestro equipo y te escribirán apenas se libere un asesor. Nuestro horario es ${SCHEDULE_TEXT}.`
  }
  return `Tu caso ya está derivado con nuestro equipo. Ahora estamos fuera de horario: te atenderán ${ensurePeriod(nextOpeningText(now))} Nuestro horario es ${SCHEDULE_TEXT}.`
}