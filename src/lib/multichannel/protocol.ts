import { z } from 'zod';

export const simulationLineKeySchema = z.string().regex(/^TEST-[A-Za-z0-9_-]{1,60}$/);

// This first release accepts fictitious recipients only. Connecting a real
// transport is a separate change; simulation must never become a paid fallback.
export const simulationJobSchema = z.object({
  channel: z.enum(['sms', 'whatsapp_support']),
  line_key: simulationLineKeySchema,
  recipient: z.string().regex(/^TEST-[A-Za-z0-9_-]{1,60}$/),
  body: z.string().trim().min(1).max(4000),
  dedup_key: z.string().trim().min(1).max(160),
  priority: z.number().int().min(0).max(100).default(0),
  run_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
}).refine(value => Date.parse(value.expires_at) > Date.parse(value.run_at), {
  message: 'El vencimiento debe ser posterior a la programación.',
  path: ['expires_at'],
});

export const workerActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim') }),
  z.object({
    action: z.enum(['start', 'complete']),
    job_id: z.string().uuid(),
    claim_token: z.string().uuid(),
  }),
]);

export const workerRegistrationSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
