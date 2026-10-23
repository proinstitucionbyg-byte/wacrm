export type SalesCourseMessage = {
  sender_type: string;
  content_text: string | null;
  interactive_reply_id: string | null;
  created_at: string;
};

export function courseInterestFromMessages(messages: SalesCourseMessage[]): { course: string; details: string } {
  const text = messages
    .filter((message) => message.sender_type === 'customer')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((message) => `${message.interactive_reply_id ?? ''} ${message.content_text ?? ''}`)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const found = new Set<string>();
  if (/nutricion|dietetica/.test(text)) found.add('Nutrición y dietética');
  if (/farmacia/.test(text)) found.add('Auxiliar de farmacia');
  if (/educacion inicial|inicial/.test(text)) found.add('Educación inicial');
  if (/recursos humanos|gestion humana|talento humano/.test(text)) found.add('Recursos humanos');
  if (/asistente administrativo|administracion|administrativo/.test(text)) found.add('Asistente administrativo');
  const courses = [...found];
  if (courses.length === 1) return { course: courses[0], details: '' };
  if (courses.length > 1) return { course: `Varios: ${courses.join(', ')}`, details: courses.join(', ') };
  return { course: '', details: '' };
}

export function courseFromMessages(messages: SalesCourseMessage[]): string {
  return courseInterestFromMessages(messages).course;
}
