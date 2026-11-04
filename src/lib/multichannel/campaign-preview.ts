import { createHash } from 'node:crypto';
import { z } from 'zod';
import { simulationJobSchema } from './protocol';

export const campaignSettingsSchema = z.object({
  campaign_id: z.string().trim().min(1).max(100),
  version: z.number().int().positive(),
  purpose: z.enum(['collection', 'notice']),
  channel: z.enum(['sms', 'whatsapp_support']).default('sms'),
  line_key: z.string().regex(/^TEST-[A-Za-z0-9_-]{1,60}$/),
  template: z.string().trim().min(1).max(4000),
  run_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
  interval_seconds: z.number().int().min(1).max(86400).default(20),
  batch_limit: z.number().int().min(1).max(500).default(100),
  priority: z.number().int().min(0).max(100).default(0),
});

export const campaignPreviewSchema = campaignSettingsSchema.extend({
  recipients: z.array(z.object({
    id: z.string().trim().min(1).max(100),
    destination: z.string().trim().min(1).max(80),
    permission_confirmed: z.boolean().default(false),
    payment_status: z.enum(['unknown', 'pending', 'resolved']).default('unknown'),
    variables: z.record(z.string(), z.string().max(2000)).default({}),
  })).min(1).max(5000),
}).refine(value => Date.parse(value.expires_at) > Date.parse(value.run_at), {
  message: 'El vencimiento debe ser posterior al inicio.', path: ['expires_at'],
});

type Campaign = z.infer<typeof campaignPreviewSchema>;
type Status = 'ready' | 'blocked' | 'duplicate' | 'deferred';
type PreviewRow = {
  recipient_id: string; destination: string; status: Status;
  reason: string; run_at?: string; body?: string;
};

/** Pure preparation: never writes to the queue, Sheets, Meta or a phone. */
export function previewCampaign(input: Campaign, now = Date.now()) {
  const rows: PreviewRow[] = [];
  const jobs: z.infer<typeof simulationJobSchema>[] = [];
  const ids = new Set<string>(), destinations = new Set<string>();
  for (const recipient of input.recipients) {
    const row: PreviewRow = {
      recipient_id: recipient.id, destination: recipient.destination,
      status: 'blocked', reason: '',
    };
    rows.push(row);
    if (ids.has(recipient.id) || destinations.has(recipient.destination)) {
      row.status = 'duplicate'; row.reason = 'ID o destino repetido dentro del lote.'; continue;
    }
    ids.add(recipient.id); destinations.add(recipient.destination);
    if (!/^TEST-[A-Za-z0-9_-]{1,60}$/.test(recipient.destination)) {
      row.reason = 'Destino real: conexión al celular todavía no habilitada.'; continue;
    }
    if (!recipient.permission_confirmed) {
      row.reason = 'Falta confirmar permiso de contacto.'; continue;
    }
    if (input.purpose === 'collection' && recipient.payment_status !== 'pending') {
      row.reason = recipient.payment_status === 'resolved'
        ? 'Pago resuelto: excluir de cobranza.' : 'Falta comprobar el estado del pago.';
      continue;
    }
    const missing = new Set<string>();
    const body = input.template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, raw: string) => {
      const key = raw.trim();
      if (!Object.hasOwn(recipient.variables, key) || !recipient.variables[key].trim()) {
        missing.add(key); return '';
      }
      return recipient.variables[key];
    });
    if (missing.size || /\{\{|\}\}/.test(body)) {
      row.reason = missing.size ? `Faltan variables: ${[...missing].join(', ')}.` : 'Variable o marcador incompleto.';
      continue;
    }
    if (jobs.length >= input.batch_limit) {
      row.status = 'deferred'; row.reason = 'Fuera del límite de este lote.'; continue;
    }
    const scheduled = Date.parse(input.run_at) + jobs.length * input.interval_seconds * 1000;
    if (scheduled >= Date.parse(input.expires_at) || Date.parse(input.expires_at) <= now) {
      row.reason = 'El envío quedaría fuera del plazo permitido.'; continue;
    }
    // Stable identity does not depend on row order or laptop/line selection.
    const key = createHash('sha256').update(JSON.stringify([
      input.campaign_id, input.version, recipient.id, recipient.destination,
    ])).digest('hex');
    const job = simulationJobSchema.safeParse({
      channel: input.channel, line_key: input.line_key, recipient: recipient.destination,
      body, dedup_key: `campaign:${key}`, priority: input.priority,
      run_at: new Date(scheduled).toISOString(), expires_at: input.expires_at,
    });
    if (!job.success) { row.reason = 'Texto vacío, demasiado largo o datos de envío inválidos.'; continue; }
    jobs.push(job.data);
    Object.assign(row, {status:'ready', reason:'Listo solo para simulación.', run_at:job.data.run_at, body});
  }
  return {
    mode: 'simulation' as const, enqueued: false as const,
    totals: {
      received: rows.length, ready: jobs.length,
      blocked: rows.filter(row => row.status === 'blocked').length,
      duplicate: rows.filter(row => row.status === 'duplicate').length,
      deferred: rows.filter(row => row.status === 'deferred').length,
    }, rows, jobs,
  };
}
