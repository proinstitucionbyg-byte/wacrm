import { z } from 'zod';
import { whatsappSessionLineKeySchema } from './whatsapp-session-protocol';

const claim = { job_id: z.string().uuid(), claim_token: z.string().uuid() };

export const whatsappSessionOutboundWorkerSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim'), line_key: whatsappSessionLineKeySchema }).strict(),
  z.object({ action: z.literal('authorize'), line_key: whatsappSessionLineKeySchema, ...claim,
    inbound_provider_message_id: z.string().min(1).max(1024),
    chat_id: z.string().regex(/^\d{7,15}@c\.us$/), body_hash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  z.object({ action: z.literal('record'), line_key: whatsappSessionLineKeySchema, ...claim,
    state: z.enum(['accepted','delivered','read','failed','needs_review','cancelled']),
    provider_message_id: z.string().min(1).max(1024).optional(),
  }).strict().refine(value => !['accepted','delivered','read'].includes(value.state) || !!value.provider_message_id,
    'Se requiere el identificador del mensaje enviado.'),
]);

export type WhatsAppSessionOutboundWorkerAction = z.infer<typeof whatsappSessionOutboundWorkerSchema>;
