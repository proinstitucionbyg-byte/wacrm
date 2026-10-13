/** Suggest fields from Spanish speech/text. The adviser confirms before saving. */
export function suggestReminder(text: string, now = new Date()): { dueLocal: string; repeatDays: number | null; needsInterval: boolean } {
  const value = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const repeatNumber = value.match(/cada\s+(\d{1,3})\s+(dias?|semanas?)/);
  const repeatDays = repeatNumber ? Number(repeatNumber[1]) * (repeatNumber[2].startsWith('semana') ? 7 : 1)
    : /(?:cada dia|todos los dias|diariamente)/.test(value) ? 1
    : /(?:cada semana|semanalmente|todos los (?:lunes|martes|miercoles|jueves|viernes|sabados|domingos))/.test(value) ? 7 : null;
  const needsInterval = /cada\s+(?:unos|algunos)\s+dias/.test(value) || (repeatDays !== null && repeatDays > 365);
  const target = new Date(now);
  const relative = value.match(/\ben\s+(\d{1,3})\s+(minutos?|horas?|dias?)\b/);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    target.setTime(now.getTime() + amount * (unit.startsWith('minuto') ? 60_000 : unit.startsWith('hora') ? 3_600_000 : 86_400_000));
  } else {
    const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const namedDate = value.match(/\b(?:el\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+(?:de(?:l)?\s+)?(\d{4}))?\b/);
    const numericDate = value.match(/\b(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{4}))?\b/);
    const explicitDate = namedDate ?? numericDate;
    const explicitYear = Boolean(explicitDate?.[3]);
    if (explicitDate) {
      const day = Number(explicitDate[1]);
      const month = namedDate ? months.indexOf(namedDate[2]) : Number(numericDate![2]) - 1;
      target.setFullYear(explicitYear ? Number(explicitDate[3]) : now.getFullYear(), month, day);
      if (month < 0 || month > 11 || target.getMonth() !== month || target.getDate() !== day)
        return { dueLocal: '', repeatDays: repeatDays && repeatDays <= 365 ? repeatDays : null, needsInterval };
    } else if (/\bpasado manana\b/.test(value)) target.setDate(target.getDate() + 2);
    else {
      const morningIsTimeOfDay = /(?:de\s+la\s+|por\s+la\s+)manana/.test(value);
      const tomorrow = /\bmanana\b/.test(value) && (!morningIsTimeOfDay || (value.match(/\bmanana\b/g)?.length ?? 0) > 1);
      if (tomorrow) target.setDate(target.getDate() + 1);
      else {
        const days = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
        const weekday = days.findIndex(day => new RegExp(`\\b${day}s?\\b`).test(value));
        if (weekday >= 0) target.setDate(target.getDate() + ((weekday - target.getDay() + 7) % 7 || 7));
      }
    }
    const clock = value.match(/(?:a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:de\s+la\s+)?(tarde|manana|noche|am|pm|a\.m\.|p\.m\.)/)
      ?? value.match(/(?:a\s+las?\s+)(\d{1,2})(?::(\d{2}))?/)
      ?? value.match(/\b(\d{1,2}):(\d{2})\b/);
    let hour = clock ? Number(clock[1]) : 9;
    const minute = clock?.[2] ? Number(clock[2]) : 0;
    const period = clock?.[3];
    if (period && /^(tarde|noche|pm|p\.m\.)$/.test(period) && hour < 12) hour += 12;
    if (period === 'noche' && hour === 12) hour = 0;
    if (period && /^(manana|am|a\.m\.)$/.test(period) && hour === 12) hour = 0;
    if (hour > 23 || minute > 59 || (clock && hour === 0 && Number(clock[1]) !== 12))
      return { dueLocal: '', repeatDays: repeatDays && repeatDays <= 365 ? repeatDays : null, needsInterval };
    target.setHours(hour, minute, 0, 0);
    if (target.getTime() <= now.getTime()) {
      if (explicitYear) return { dueLocal: '', repeatDays: repeatDays && repeatDays <= 365 ? repeatDays : null, needsInterval };
      if (explicitDate) target.setFullYear(target.getFullYear() + 1);
      else target.setDate(target.getDate() + (/\b(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(value) ? 7 : 1));
    }
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return { dueLocal: `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`,
    repeatDays: repeatDays && repeatDays <= 365 ? repeatDays : null, needsInterval };
}
