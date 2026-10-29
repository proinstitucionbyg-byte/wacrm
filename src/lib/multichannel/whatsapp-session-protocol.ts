import { z } from 'zod';

export const whatsappSessionLineKeySchema = z.string().regex(/^WA-[A-Za-z0-9_-]{1,60}$/);

export const whatsappSessionInboundSchema = z.object({
  line_key: whatsappSessionLineKeySchema,
  linked_phone: z.string().regex(/^\d{7,15}$/),
  provider_message_id: z.string().min(1).max(1024),
  chat_id: z.string().regex(/^\d{5,20}@(c\.us|lid)$/),
  occurred_at: z.string().datetime({ offset: true }),
  type: z.string().trim().min(1).max(32),
  text: z.string().max(65536).default(''),
}).strict();

export function sessionSenderPhone(chatId: string): string | null {
  const match = /^(\d{5,20})@c\.us$/.exec(chatId);
  return match?.[1] ?? null;
}

export function sessionContentType(type: string): 'text' | 'image' | 'video' | 'document' | 'audio' | 'location' | 'interactive' {
  if (type === 'sticker') return 'image';
  if (type === 'ptt') return 'audio';
  if (['text', 'image', 'video', 'document', 'audio', 'location', 'interactive'].includes(type)) {
    return type as ReturnType<typeof sessionContentType>;
  }
  return 'text';
}
