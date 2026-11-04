import { z } from 'zod';
import { campaignSettingsSchema, previewCampaign } from './campaign-preview';
import { limaInputToISO } from './recipient-list';
import { CENTRAL_SPREADSHEET_ID, COMMUNICATION_HEADERS } from './central-source';
export { CENTRAL_SPREADSHEET_ID, COMMUNICATION_HEADERS } from './central-source';

// Verified against the native master on 27/10/2026. No file is read or written here.
const cell = z.union([z.string().max(8000), z.number().finite(), z.boolean(), z.null()]);
export const centralCampaignSchema = z.object({
  source: z.literal('central-sheet'),
  spreadsheet_id: z.literal(CENTRAL_SPREADSHEET_ID),
  sheet_name: z.literal('COMUNICACIONES'),
  text_mode: z.literal('literal'),
  headers: z.array(z.string().max(100)).min(17).max(64),
  rows: z.array(z.array(cell).max(64)).max(5000),
  campaign: campaignSettingsSchema.omit({ template: true }),
}).refine(v => Date.parse(v.campaign.expires_at) > Date.parse(v.campaign.run_at), {
  message: 'El vencimiento debe ser posterior al inicio.', path: ['campaign', 'expires_at'],
});

const clean = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

/** Accept Sheets serial dates or unambiguous wall-clock dates in Lima. */
export function centralDateTime(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 36526 || value >= 73416 || Number.isInteger(value)) {
      throw new Error('Falta una fecha y hora válidas.');
    }
    return new Date(Math.round((value - 25569) * 86400000) + 5 * 3600000).toISOString();
  }
  const text = clean(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    const date = z.string().datetime({ offset: true }).safeParse(text);
    if (date.success) return new Date(text).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return limaInputToISO(text);
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})$/.exec(text);
  if (match) return limaInputToISO(`${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}T${match[4].padStart(2,'0')}:${match[5]}`);
  throw new Error('Falta una fecha y hora válidas.');
}

type Input = z.infer<typeof centralCampaignSchema>;
type Recipient = Parameters<typeof previewCampaign>[0]['recipients'][number];
type SourceRow = { source_row: number; communication_id: string };
type Row = ReturnType<typeof previewCampaign>['rows'][number] & SourceRow;

/** Uses the existing preview engine. Never fetches Sheets, queues or sends. */
export function previewCentralCampaign(input: Input, now = Date.now()) {
  const positions = new Map(input.headers.map((header, index) => [header.trim(), index]));
  if (positions.size !== input.headers.length || COMMUNICATION_HEADERS.some(h => !positions.has(h))) {
    throw new Error('Las cabeceras de COMUNICACIONES no coinciden con el formato verificado.');
  }
  const recipients: Recipient[] = [], sources: SourceRow[] = [], rejected: Row[] = [];
  const communicationIds = new Set<string>();
  const field = (values: Input['rows'][number], header: typeof COMMUNICATION_HEADERS[number]) => values[positions.get(header)!];
  const managedStudents = new Set<string>(), managedDestinations = new Set<string>();
  for (const values of input.rows) {
    const get = (header: typeof COMMUNICATION_HEADERS[number]) => field(values, header);
    if (clean(get('Campana_ID')) !== input.campaign.campaign_id) continue;
    const state = norm(get('Estado')), attempts = clean(get('Intentos'));
    if ((state && !['PENDIENTE', 'PROGRAMADO'].includes(state)) ||
      (attempts !== '' && attempts !== '0') || clean(get('Fecha envío real')) || clean(get('ID proveedor'))) {
      if (clean(get('Estudiante_ID'))) managedStudents.add(clean(get('Estudiante_ID')));
      if (clean(get('Destino'))) managedDestinations.add(clean(get('Destino')));
    }
  }
  let selected = 0;
  for (const [index, values] of input.rows.entries()) {
    const get = (header: typeof COMMUNICATION_HEADERS[number]) => field(values, header);
    if (clean(get('Campana_ID')) !== input.campaign.campaign_id) continue;
    selected++;
    const source = { source_row: index + 5, communication_id: clean(get('Comunicacion_ID')) };
    const student = clean(get('Estudiante_ID')), destination = clean(get('Destino'));
    const reject = (reason: string, status: 'blocked' | 'duplicate' = 'blocked') => rejected.push({
      ...source, recipient_id: student, destination, status, reason,
    });
    if (!source.communication_id || !student) { reject('Falta el ID de comunicación o de estudiante.'); continue; }
    if (communicationIds.has(source.communication_id)) { reject('Comunicacion_ID repetido en el lote.', 'duplicate'); continue; }
    communicationIds.add(source.communication_id);
    const attempts = get('Intentos');
    if ((clean(attempts) !== '' && clean(attempts) !== '0') ||
      clean(get('Fecha envío real')) || clean(get('ID proveedor'))) {
      reject('Ya tiene un envío o intento registrado: conciliar antes de repetir.'); continue;
    }
    if (!['PENDIENTE', 'PROGRAMADO'].includes(norm(get('Estado')))) {
      reject('La comunicación no está pendiente ni programada.'); continue;
    }
    if (managedStudents.has(student) || managedDestinations.has(destination)) {
      reject('Este alumno o destino ya fue gestionado en la campaña: conciliar antes de repetir.'); continue;
    }
    const rowChannel = norm(get('Canal'));
    const normalizedChannel = rowChannel === 'SMS' ? 'sms'
      : rowChannel === 'WHATSAPP SOPORTE' ? 'whatsapp_support' : null;
    if (!normalizedChannel || normalizedChannel !== input.campaign.channel) {
      reject('El canal de la fila no coincide con el canal seleccionado para esta simulación.'); continue;
    }
    const purpose = norm(get('Finalidad'));
    if (purpose !== (input.campaign.purpose === 'collection' ? 'COBRANZA' : 'AVISO')) {
      reject('La finalidad de la fila no coincide con la campaña.'); continue;
    }
    if (input.campaign.purpose === 'collection') {
      reject('Cobranza pendiente de conciliar con OBLIGACIONES, PAGOS y APLICACIONES PAGO.'); continue;
    }
    let planned: string;
    try { planned = centralDateTime(get('Fecha prevista')); }
    catch { reject('Completa Fecha prevista con fecha y hora de Lima.'); continue; }
    if (Math.abs(Date.parse(planned) - Date.parse(input.campaign.run_at)) > 1000) {
      reject('La fecha prevista no coincide con el inicio de esta campaña.'); continue;
    }
    const permission = get('Consentimiento / permiso');
    recipients.push({
      id: student, destination,
      permission_confirmed: permission === true || norm(permission) === 'SI',
      payment_status: 'unknown', variables: { contenido: clean(get('Texto / plantilla')) },
    });
    sources.push(source);
  }
  const result = recipients.length ? previewCampaign({
    ...input.campaign, template: '{{contenido}}', recipients,
  }, now) : {
    mode: 'simulation' as const, enqueued: false as const,
    totals: { received: 0, ready: 0, blocked: 0, duplicate: 0, deferred: 0 }, rows: [], jobs: [],
  };
  const rows: Row[] = [
    ...rejected, ...result.rows.map((row, index) => ({ ...row, ...sources[index] })),
  ].sort((a, b) => a.source_row - b.source_row);
  return {
    ...result, source: 'central-sheet' as const, read_only: true as const,
    sheet_name: input.sheet_name, ignored: input.rows.length - selected,
    totals: {
      received: selected, ready: result.jobs.length,
      blocked: rows.filter(r => r.status === 'blocked').length,
      duplicate: rows.filter(r => r.status === 'duplicate').length,
      deferred: rows.filter(r => r.status === 'deferred').length,
    }, rows,
  };
}
