import { describe, expect, it } from 'vitest';
import { courseFromMessages, courseInterestFromMessages, type SalesCourseMessage } from './course-interest';

function message(sender_type: string, content_text: string | null, index: number): SalesCourseMessage {
  return {
    sender_type,
    content_text,
    interactive_reply_id: null,
    created_at: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
  };
}

describe('courseFromMessages', () => {
  it('keeps the course found before the ten most recent messages', () => {
    const messages = [message('customer', 'Me interesa Auxiliar de farmacia', 0)];
    for (let index = 1; index <= 12; index += 1) {
      messages.push(message(index % 2 ? 'ai' : 'customer', 'Gracias, quiero más información', index));
    }

    expect(courseFromMessages(messages)).toBe('Auxiliar de farmacia');
  });

  it('uses all customer messages to report multiple course interests', () => {
    const messages = [
      message('customer', '¿Qué tal es Nutrición?', 0),
      message('ai', 'Te comparto los detalles.', 1),
      message('customer', 'También me interesa Educación inicial.', 2),
    ];

    expect(courseFromMessages(messages)).toBe('Varios: Nutrición y dietética, Educación inicial');
    expect(courseInterestFromMessages(messages).details).toBe('Nutrición y dietética, Educación inicial');
  });

  it('ignores course names mentioned only in our own messages', () => {
    expect(courseFromMessages([message('ai', 'Información de Farmacia', 0)])).toBe('');
  });
});
