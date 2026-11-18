import { z } from 'zod';

// Official smb_message_echoes shape: business -> customer, never customer inbound.
const echoSchema = z.object({
  from: z.string().regex(/^\+?\d{7,15}$/),
  to: z.string().regex(/^\+?\d{7,15}$/),
  id: z.string().min(1).max(512), timestamp: z.string().regex(/^\d{1,11}$/),
  type: z.string().min(1).max(32),
  text: z.object({ body: z.string().max(65536) }).optional(),
  image: z.object({ caption: z.string().max(65536).optional() }).optional(),
  video: z.object({ caption: z.string().max(65536).optional() }).optional(),
  document: z.object({ caption: z.string().max(65536).optional() }).optional(),
});

export function parseBusinessAppEcho(value: unknown, businessPhone: string, now = Date.now()) {
  const parsed = echoSchema.safeParse(value);
  const digits = (s: string) => s.replace(/\D/g, '');
  if (!parsed.success || !businessPhone) return null;
  const message = parsed.data;
  if (digits(message.from) !== digits(businessPhone) || digits(message.to) === digits(message.from)) return null;
  const milliseconds = Number(message.timestamp) * 1000;
  if (milliseconds < Date.UTC(2009, 0, 1) || milliseconds > now + 300_000) return null;
  const supported = ['text', 'image', 'video', 'document', 'audio', 'location'];
  const type = supported.includes(message.type) ? message.type : 'text';
  const text = message.type === 'text' ? message.text?.body :
    message.image?.caption ?? message.video?.caption ?? message.document?.caption;
  if (message.type === 'text' && text === undefined) return null;
  return {
    messageId: message.id, recipient: digits(message.to), occurredAt: new Date(milliseconds).toISOString(),
    contentType: type, contentText: text ?? `[WhatsApp Business: ${message.type}]`,
  };
}

export interface BusinessAppEchoDb {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ error: unknown }>;
}

export async function recordBusinessAppEchoes(args: {
  db: BusinessAppEchoDb; enabled: boolean; accountId: string; wabaId: string;
  phoneNumberId: string; businessPhone: string; echoes: unknown[];
}) {
  if (!args.enabled) return;
  for (const value of args.echoes) {
    const echo = parseBusinessAppEcho(value, args.businessPhone);
    if (!echo) continue;
    const { error } = await args.db.rpc('record_whatsapp_business_app_echo', {
      p_account_id: args.accountId, p_waba_id: args.wabaId, p_phone_number_id: args.phoneNumberId,
      p_message_id: echo.messageId, p_recipient: echo.recipient, p_occurred_at: echo.occurredAt,
      p_content_type: echo.contentType, p_content_text: echo.contentText,
    });
    // No provider payload, number, token or message body in logs/errors.
    if (error) throw new Error('No se pudo registrar la atención de WhatsApp Business.');
  }
}
