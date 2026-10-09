export function commandName(text: string): string | null {
  const match = /^MANDAR\s*\(([^\r\n]{1,160})\)\s*$/i.exec(text.trim());
  return match?.[1].trim() || null;
}
export function isInboxCommand(text: string): boolean {
  return /^MANDAR\b/i.test(text.trim());
}
export function normalizedCommand(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}
export function resolveCommand<T extends { id: string; name: string }>(
  name: string,
  blocks: T[]
): T | null {
  const matches = blocks.filter(
    (block) => normalizedCommand(block.name) === normalizedCommand(name)
  );
  return matches.length === 1 ? matches[0] : null;
}
