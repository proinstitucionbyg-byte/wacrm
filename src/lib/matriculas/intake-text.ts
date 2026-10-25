/** Normalize list formatting only; preserve the student's values and message IDs. */
export function intakeText(value: string | null | undefined): string {
  const lines = (value ?? '').replace(/\\n/g, '\n').split(/\r?\n/)
    .map(line => line.replace(/^\s*[-*•]\s+/, '').trim());
  const documentLabel = /^(?:DNI|DOCUMENTO(?: DE IDENTIDAD)?|CARN[EÉ] DE EXTRANJER[IÍ]A|PASAPORTE)\s*:?$/i;
  const documentLine = lines.findIndex(line => documentLabel.test(line));
  // A complete name immediately followed by an explicit document label is a
  // structured identity block, including compound surnames such as DE GARCIA.
  if (documentLine === 1 && /^[\p{L}]+(?:[ -][\p{L}]+){2,9}[,.]?$/u.test(lines[0]))
    lines[0] = `Nombre completo: ${lines[0].replace(/[,.]$/, '')}`;
  return lines.map((line, index) => {
    if (documentLabel.test(line) && /^[A-Z0-9]+$/i.test(lines[index + 1] ?? '')
      && /\d/.test(lines[index + 1]))
      return `${line.replace(/:$/, '')}: ${lines[index + 1]}`;
    return line;
  }).join('\n');
}
