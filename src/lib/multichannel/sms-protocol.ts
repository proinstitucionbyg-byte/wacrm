import { z } from 'zod';

export const smsLineKey = z.string().regex(/^SMS-[A-Za-z0-9_-]{1,60}$/);
const deviceKey = z.string().trim().min(1).max(160);
const claim = { job_id: z.string().uuid(), claim_token: z.string().uuid() };
const binding = { line_key: smsLineKey, device_key: deviceKey };
const purpose = z.enum(['notice', 'support']); // Collection awaits real balance reconciliation.

export const smsOwnerActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register_worker'), name: z.string().trim().min(1).max(80) }).strict(),
  z.object({ action: z.literal('revoke_worker'), worker_id: z.string().uuid() }).strict(),
  z.object({ action: z.literal('configure_line'), ...binding, worker_id: z.string().uuid(),
    interval_seconds: z.number().int().min(1).max(86400), daily_limit: z.number().int().min(1).max(100000),
    limit_note: z.string().trim().min(5).max(1000),
  }).strict(),
  z.object({ action: z.literal('pause_line'), line_key: smsLineKey, value: z.boolean() }).strict(),
  z.object({ action: z.literal('set_line_availability'), line_key: smsLineKey, value: z.boolean() }).strict(),
  z.object({ action: z.literal('set_permission'), contact_id: z.string().uuid(), purpose,
    recipient: z.string().regex(/^\+[1-9]\d{7,14}$/), granted: z.boolean(),
    expires_at: z.string().datetime({ offset: true }), evidence: z.string().trim().min(5).max(1000),
  }).strict().refine(v => !v.granted || Date.parse(v.expires_at) > Date.now(), 'El permiso debe tener vigencia futura.'),
  z.object({ action: z.literal('enqueue'), line_key: smsLineKey, contact_id: z.string().uuid(), purpose,
    body: z.string().trim().min(1).max(4000), dedup_key: z.string().trim().min(1).max(123),
    priority: z.number().int().min(0).max(100).default(0),
    run_at: z.string().datetime({ offset: true }), expires_at: z.string().datetime({ offset: true }),
  }).strict().refine(v => Date.parse(v.expires_at) > Date.parse(v.run_at), 'Revisa programación y vencimiento.'),
]);

export const smsWorkerActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('identity'), ...binding }).strict(),
  z.object({ action: z.literal('heartbeat'), ...binding, ready: z.boolean() }).strict(),
  z.object({ action: z.literal('claim'), ...binding }).strict(),
  z.object({ action: z.literal('start'), ...binding, ...claim }).strict(),
  z.object({ action: z.literal('permit'), ...binding, ...claim }).strict(),
  z.object({ action: z.literal('record'), ...binding, ...claim,
    state: z.enum(['accepted', 'sent', 'delivered', 'failed', 'needs_review']),
    provider_id: z.string().regex(/^wcm-[a-f0-9]{64}$/),
    checked_at: z.string().datetime({ offset: true }), // Not used as server time.
  }).strict(),
]);
