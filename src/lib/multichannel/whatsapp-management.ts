import {z} from 'zod';
import {whatsappSessionLineKeySchema} from './whatsapp-session-protocol';

export const managementOperation=z.enum(['create','connect','stop','unlink','recover','replace']);
export const managementAction=z.object({action:z.literal('manage_line'),operation:managementOperation,
 worker_id:z.string().uuid(),line_key:whatsappSessionLineKeySchema.optional(),label:z.string().trim().min(1).max(60).optional(),
 expected_phone:z.string().regex(/^\d{7,15}$/).optional()}).strict().refine(v=>v.operation==='create'?!!v.label&&!v.line_key:!!v.line_key)
 .refine(v=>!['unlink','replace'].includes(v.operation)||!!v.expected_phone);

export const managementSnapshotLine=z.object({lineKey:whatsappSessionLineKeySchema,label:z.string().min(1).max(60),
 archived:z.boolean().optional(),
 status:z.enum(['stopped','connecting','awaiting_qr','ready','duplicate_number','wrong_number','storage_error','auth_failure','disconnected','connection_error']),
 linkedPhone:z.string().regex(/^\d{7,15}$/).nullable(),active:z.boolean(),
 qr:z.string().max(200000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).nullable()}).strict();

export const managementHeartbeat=z.object({lines:z.array(managementSnapshotLine).max(20),
 completed:z.object({id:z.string().uuid(),status:z.enum(['done','error']),result:z.string().max(200)}).strict().optional()}).strict();
