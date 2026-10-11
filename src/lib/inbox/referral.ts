/** Store only fields actually present in Meta's signed webhook, never infer an ad from chat text. */
export function parseReferral(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of ['source_id', 'source_type', 'ad_id', 'ref', 'source', 'type', 'headline', 'body', 'ctwa_clid']) {
    if (typeof input[key] === 'string' && input[key].trim())
      result[key] = input[key].trim().slice(0, key === 'body' ? 2000 : 500);
  }
  if (typeof input.source_url === 'string') {
    try {
      const url = new URL(input.source_url);
      if (url.protocol === 'https:' && input.source_url.length <= 2000)
        result.source_url = input.source_url;
    } catch { /* Invalid links do not become clickable evidence. */ }
  }
  // A malformed/oversized referral must never prevent the student's message from being saved.
  const bytes = () => new TextEncoder().encode(JSON.stringify(result)).length;
  if (bytes() > 9000) delete result.body;
  return Object.keys(result).length && bytes() <= 9000 ? result : null;
}
