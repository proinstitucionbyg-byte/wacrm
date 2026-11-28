export const COMMERCIAL_SCHEDULE_VERSION = 'lima-2026-11-28-v2'
export const COMMERCIAL_TIMEZONE = 'America/Lima'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const lima = new Intl.DateTimeFormat('en-CA', {timeZone:COMMERCIAL_TIMEZONE, year:'numeric',month:'2-digit',day:'2-digit'})

function dayStart(at:number) {
  const parts = Object.fromEntries(lima.formatToParts(at).map(p=>[p.type,p.value]))
  return Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),5)
}

/** Silent leads only. Requested materials keep their own response waits. */
export function nextCommercialBand(earliest:number):number {
  const day=dayStart(earliest), hour=(earliest-day)/HOUR
  if(hour<8)return day+8*HOUR
  if(hour<9)return earliest
  if(hour<12)return day+12*HOUR
  if(hour<14)return earliest
  if(hour<17)return day+17*HOUR
  if(hour<23)return earliest
  return day+DAY+8*HOUR
}

/** Schedule the owner's saved course, without replacing/reordering its blocks. */
export function planSavedCourseWait(args:{now:number;lastCustomerAt:string;waitMs:number;initial:boolean;interactive:boolean}):string {
  const earliest=args.now+args.waitMs
  // First material and explicit student interaction are independent of bands.
  if(args.initial||args.interactive)return new Date(earliest).toISOString()
  return new Date(nextCommercialBand(earliest)).toISOString()
}

/** Pure calendar calculation. No AI, network, timers or sending side effects. */
export function planCommercialWait(args:{now:number; lastCustomerAt:string; startedAt:string;
  position:number; remainingWaits:number; minimumMinutes?:number}):
  {runAt:string|null; deadline:string|null; reason:string; prioritizeEssential:boolean} {
  const last = Date.parse(args.lastCustomerAt), started = Date.parse(args.startedAt)
  if (!Number.isFinite(last) || !Number.isFinite(started) || last > args.now + MINUTE)
    return {runAt:null,deadline:null,reason:'Ventana de atención no verificable',prioritizeEssential:false}
  const deadline = last + 24*HOUR - MINUTE
  // A late or explicitly restarted journey never creates a new service window.
  const target = last + 23*HOUR
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
    due=nextCommercialBand(earliest)
    reason=due===earliest?'Seguimiento espaciado':'Horario estratégico de Lima'
  }
  if (due>=deadline) return {runAt:null,deadline:new Date(deadline).toISOString(),reason:'No queda tiempo seguro para el siguiente bloque',prioritizeEssential}
  return {runAt:new Date(due).toISOString(),deadline:new Date(deadline).toISOString(),reason,prioritizeEssential}
}
