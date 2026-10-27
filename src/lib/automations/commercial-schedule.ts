export const COMMERCIAL_SCHEDULE_VERSION = 'lima-2026-10-27-v1'
export const COMMERCIAL_TIMEZONE = 'America/Lima'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const lima = new Intl.DateTimeFormat('en-CA', {timeZone:COMMERCIAL_TIMEZONE, year:'numeric',month:'2-digit',day:'2-digit'})

function dayStart(at:number) {
  const parts = Object.fromEntries(lima.formatToParts(at).map(p=>[p.type,p.value]))
  return Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),5)
}

/** Pure calendar calculation. No AI, network, timers or sending side effects. */
export function planCommercialWait(args:{now:number; lastCustomerAt:string; startedAt:string;
  position:number; remainingWaits:number; minimumMinutes?:number}):
  {runAt:string|null; deadline:string|null; reason:string; prioritizeEssential:boolean} {
  const last = Date.parse(args.lastCustomerAt), started = Date.parse(args.startedAt)
  if (!Number.isFinite(last) || !Number.isFinite(started) || last > args.now + MINUTE)
    return {runAt:null,deadline:null,reason:'Ventana de atención no verificable',prioritizeEssential:false}
  const deadline = last + 24*HOUR - MINUTE
  const target = Math.max(started,last) + 23*HOUR
  const prioritizeEssential = deadline-args.now < Math.max(1,args.remainingWaits)*20*MINUTE
  if (args.now >= deadline) return {runAt:null,deadline:new Date(deadline).toISOString(),reason:'Ventana de 24 horas vencida',prioritizeEssential}
  let due:number, reason:string
  if (args.position === 2) {
    due=args.now+2*MINUTE;reason='Lectura y audio inicial: 2 minutos'
  } else if (args.position === 53) {
    due=Math.max(args.now+20*MINUTE,target);reason='Cierre comercial próximo a las 23 horas'
  } else {
    const spacing=Math.max(20,args.minimumMinutes??(args.position%2 ? 25:20))*MINUTE
    const earliest=args.now+spacing
    const day=dayStart(earliest), hour=(earliest-day)/HOUR
    if (hour<6) due=day+6*HOUR
    else if (hour<8) due=day+Math.ceil(hour)*HOUR
    else if (hour<11) due=day+11*HOUR
    else if (hour>=14.5 && hour<16) due=day+16*HOUR
    else if (hour>=22) due=day+DAY+6*HOUR
    else due=earliest
    reason=due===earliest?'Seguimiento espaciado':'Horario estratégico de Lima'
    // Night sends are exceptional: only when waiting until morning would
    // make the remaining journey unviable. Never emit a backlog in one batch.
    const remainingBudget=Math.max(1,args.remainingWaits)*20*MINUTE
    if (due+remainingBudget>Math.min(target,deadline) && due>earliest) {
      due=earliest;reason='Continuidad antes del vencimiento; intervalo mínimo respetado'
    }
  }
  if (due>=deadline) return {runAt:null,deadline:new Date(deadline).toISOString(),reason:'No queda tiempo seguro para el siguiente bloque',prioritizeEssential}
  return {runAt:new Date(due).toISOString(),deadline:new Date(deadline).toISOString(),reason,prioritizeEssential}
}
