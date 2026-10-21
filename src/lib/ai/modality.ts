/** Answer a direct question about presencial classes without relying on a model guess. */
export function verifiedCourseModalityReply(message: string): string | null {
  if (!/\b(?:presencial(?:es)?|precencial(?:es)?)\b/i.test(message)) return null
  return 'Nuestros cursos son virtuales, con clases en vivo; no dictamos cursos presenciales. 😊 Si deseas, te comparto los horarios del curso que te interesa.'
}
