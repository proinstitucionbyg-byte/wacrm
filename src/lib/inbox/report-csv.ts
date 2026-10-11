/** Keep user-provided text literal when opened in spreadsheet applications. */
export function quoteReportCell(value: unknown): string {
  const text = String(value ?? '');
  const literal = /^[\s]*[=+@-]/.test(text) ? "'" + text : text;
  return '"' + literal.replaceAll('"', '""') + '"';
}
