import type { SupabaseClient } from '@supabase/supabase-js';
export interface AcademicModule { course: string; module: string; start_date: string; class_dates: string[]; hour: string }
const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
export function courseKey(text: string): string | null {
  const value = normalize(text);
  const matches = [[/\bNUTRICION\b/, 'NUTRICION Y DIETETICA'], [/\bFARMACIA\b/, 'AUXILIAR DE FARMACIA'], [/\bRECURSOS\b/, 'RECURSOS HUMANOS'], [/\bADMIN\b|\bADMINISTRATIV[AO]\b/, 'ASISTENTE ADMINISTRATIVO'], [/\bEDUCACION\b/, 'AUXILIAR DE EDUCACION INICIAL']] as const;
  const selected = matches.filter(([pattern]) => pattern.test(value));
  return selected.length === 1 ? selected[0][1] : null;
}
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function parseAcademicModules(input: unknown): AcademicModule[] | null {
  if (!Array.isArray(input) || input.length !== 10) return null;
  const output: AcademicModule[] = [];
  for (const row of input) {
    if (!row || typeof row.course !== 'string' || !courseKey(row.course) || typeof row.module !== 'string' || !row.module.trim() || row.module.length > 250 || !isDate(row.start_date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.hour) || !Array.isArray(row.class_dates) || row.class_dates.length !== 8 || row.class_dates.some((day: unknown) => !isDate(day)) || row.class_dates[0] !== row.start_date || new Set(row.class_dates).size !== 8) return null;
    if (row.class_dates.some((day: string, index: number) => index > 0 && day <= row.class_dates[index - 1])) return null;
    output.push({ course: courseKey(row.course)!, module: normalize(row.module), start_date: row.start_date, class_dates: row.class_dates, hour: row.hour });
  }
  const grouped = new Map<string, AcademicModule[]>();
  for (const row of output) grouped.set(row.course, [...(grouped.get(row.course) ?? []), row]);
  if (grouped.size !== 5 || [...grouped.values()].some((rows) => rows.length !== 2 || rows[0].start_date === rows[1].start_date)) return null;
  for (const rows of grouped.values()) { rows.sort((a, b) => a.start_date.localeCompare(b.start_date)); if (rows[0].class_dates[7] >= rows[1].start_date) return null; }
  return output.sort((a, b) => a.course.localeCompare(b.course) || a.start_date.localeCompare(b.start_date));
}
export function academicOffer(rows: AcademicModule[], course: string, now = new Date()) {
  const modules = rows.filter((row) => row.course === courseKey(course)).sort((a, b) => a.start_date.localeCompare(b.start_date));
  const selectedModule = modules.find((row) => now.getTime() < Date.parse(`${row.class_dates[2]}T${row.hour}:00-05:00`));
  if (!selectedModule) return null;
  const offered = selectedModule.class_dates.find((day) => Date.parse(`${day}T${selectedModule.hour}:00-05:00`) > now.getTime());
  return offered ? { ...selectedModule, offered_date: offered } : null;
}
export async function loadAcademicCalendar(db: SupabaseClient, accountId: string): Promise<AcademicModule[]> {
  const { data, error } = await db.from('academic_calendar_snapshots').select('modules,updated_at').eq('account_id', accountId).maybeSingle();
  if (error || !data || Date.now() - Date.parse(data.updated_at) > 30 * 60_000) return [];
  return parseAcademicModules(data.modules) ?? [];
}
export async function academicContext(db: SupabaseClient, accountId: string): Promise<string[]> {
  const rows = await loadAcademicCalendar(db, accountId);
  if (!rows.length) return ['No hay un cuadro de inicios reciente disponible. No inventes fechas; indica que deben confirmarse.'];
  const lines = [...new Set(rows.map((row) => row.course))].map((course) => {
    const offer = academicOffer(rows, course);
    return offer ? `${course}: MODULO ${offer.module}; fecha disponible para incorporarse ${offer.offered_date} ${offer.hour} HORA LIMA.` : `${course}: inicio por confirmar.`;
  });
  return ['CUADRO DE INICIOS OFICIAL, ACTUALIZADO DESDE GOOGLE SHEETS. Al consultar por el inicio, muestra solamente la fecha disponible para incorporarse y el modulo: "Puedes incorporarte el [fecha] a [modulo]". No agregues espontaneamente fechas anteriores, numero de clases transcurridas ni explicaciones sobre el inicio original. No afirmes que esa incorporacion es la primera clase del modulo; si preguntan expresamente por clases anteriores, responde con informacion verificada sin inventar. El registro y cronograma conservan el inicio oficial internamente. Usa las automatizaciones configuradas para promociones, pagos, solicitud de datos y bienvenida; no inventes bloques ni sus contenidos.\n' + lines.join('\n')];
}
