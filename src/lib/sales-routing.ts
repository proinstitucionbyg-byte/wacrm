export const TEAM_AREAS = ['SIN AREA', 'VENTAS', 'FIDELIZACION', 'ADMINISTRATIVA', 'FINANZAS'] as const;
export interface SalesMember { user_id: string; area: string; cargo: string; percentage: number }
export function parseSalesRouting(value: unknown): { enabled: boolean; version: number; members: SalesMember[] } | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (typeof body.enabled !== 'boolean' || !Number.isSafeInteger(body.version) || Number(body.version) < 0 || !Array.isArray(body.members) || !body.members.length || body.members.length > 200) return null;
  const members: SalesMember[] = [];
  for (const raw of body.members) {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    if (typeof row.user_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.user_id) || typeof row.area !== 'string' || !TEAM_AREAS.includes(row.area as typeof TEAM_AREAS[number]) || typeof row.cargo !== 'string' || row.cargo.trim().length > 80 || !Number.isInteger(row.percentage) || Number(row.percentage) < 0 || Number(row.percentage) > 100) return null;
    if (Number(row.percentage) > 0 && (row.area !== 'VENTAS' || !row.cargo.trim())) return null;
    members.push({ user_id: row.user_id, area: row.area, cargo: row.cargo.trim(), percentage: Number(row.percentage) });
  }
  if (new Set(members.map((member) => member.user_id)).size !== members.length) return null;
  const total = members.reduce((sum, member) => sum + member.percentage, 0);
  if (total > 100 || (body.enabled && total !== 100)) return null;
  return { enabled: body.enabled, version: Number(body.version), members };
}
