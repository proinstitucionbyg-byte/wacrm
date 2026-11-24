import{z}from'zod';
import{whatsappSessionLineKeySchema}from'./whatsapp-session-protocol';
const groupId=z.string().regex(/^\d{5,25}@g\.us$/),participant=z.string().regex(/^\d{7,20}@(c\.us|lid)$/);
const valueAction=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('message'),value:z.string().trim().min(1).max(4000)}).strict(),
 z.object({operation:z.literal('media'),value:z.object({kind:z.enum(['image','audio','video','document']),url:z.string().url().max(4096),caption:z.string().max(4000).optional(),filename:z.string().min(1).max(200).regex(/^[^\\/\r\n\0]+$/).optional()}).strict()}).strict(),
 z.object({operation:z.literal('subject'),value:z.string().trim().min(1).max(100)}).strict(),
 z.object({operation:z.literal('description'),value:z.string().max(2048)}).strict(),
 ...(['messages_admins_only','info_admins_only','add_members_admins_only']as const).map(operation=>z.object({operation:z.literal(operation),value:z.boolean()}).strict()),
 z.object({operation:z.literal('add'),value:z.array(z.string().regex(/^\d{7,15}@c\.us$/)).min(1).max(50)}).strict(),
 z.object({operation:z.literal('remove'),value:z.array(participant).min(1).max(50)}).strict(),
 z.object({operation:z.literal('picture'),value:z.object({kind:z.literal('image'),url:z.string().url().max(4096)}).strict()}).strict(),
]);
export const groupRequest=z.object({request_id:z.string().uuid(),worker_id:z.string().uuid(),line_key:whatsappSessionLineKeySchema,expected_phone:z.string().regex(/^\d{7,15}$/),
 request:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('list'),offset:z.number().int().min(0).max(50000).default(0),limit:z.number().int().min(1).max(50).default(30),search:z.string().max(100).default('')}).strict(),
  z.object({kind:z.literal('details'),group_id:groupId,include_messages:z.boolean().optional()}).strict(),
  z.object({kind:z.literal('mutate'),group_id:groupId,change:valueAction}).strict(),
 ])}).strict();
export const groupResult=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('list'),total:z.number().int().min(0),offset:z.number().int().min(0),groups:z.array(z.object({id:groupId,name:z.string().max(160),participantsLoaded:z.number().int().min(0)}).strict()).max(50)}).strict(),
 z.object({kind:z.literal('details'),id:groupId,name:z.string().max(160),description:z.string().max(2048),canManage:z.boolean(),messagesRetained:z.boolean(),messages:z.array(z.object({id:z.string().min(1).max(300),author:z.string().max(160),text:z.string().max(4000),type:z.string().max(40),timestamp:z.number().int().nonnegative(),own:z.boolean(),hasMedia:z.boolean()}).strict()).max(40).optional(),participants:z.array(z.object({id:participant,admin:z.boolean(),name:z.string().max(160).optional()}).strict()).max(5000)}).strict(),
 z.object({kind:z.literal('mutation'),state:z.enum(['done','needs_review','already_attempted']),participants:z.array(z.object({id:participant,code:z.number().int().nullable()}).strict()).max(50).optional()}).strict(),
]);
