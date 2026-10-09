export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseTeamMessage(
  body: unknown
): { id: string; body: string } | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  if (
    typeof value.id !== 'string' ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.body !== 'string'
  )
    return null;
  const text = value.body.replace(/\r\n?/g, '\n').trim();
  if (!text || text.length > 4000) return null;
  return { id: value.id, body: text };
}
export function parseTeamThread(
  body: unknown
): { members: string[]; title: string | null } | null {
  if (!body || typeof body !== 'object') return null;
  const value = body as Record<string, unknown>;
  if (
    !Array.isArray(value.members) ||
    value.members.length < 1 ||
    value.members.length > 19 ||
    value.members.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))
  )
    return null;
  if (
    value.title !== undefined &&
    value.title !== null &&
    typeof value.title !== 'string'
  )
    return null;
  const title =
    typeof value.title === 'string'
      ? value.title.trim().replace(/\s+/g, ' ')
      : null;
  const members = [...new Set(value.members)] as string[];
  if ((title?.length ?? 0) > 120 || (members.length > 1 && !title)) return null;
  return { members, title: title || null };
}
export interface TeamMember {
  user_id: string;
  full_name: string | null;
  account_role: string;
  nickname?: string | null;
  area?: string | null;
  cargo?: string | null;
  birth_date?: string | null;
}
export interface TeamThread {
  id: string;
  kind: 'direct' | 'group';
  title: string | null;
  last_message_at: string;
  team_thread_members: { user_id: string; last_read_at: string | null }[];
  unread: number;
  archived_at?: string | null;
  personally_archived?: boolean;
  can_send?: boolean;
}
export interface TeamMessage {
  id: string;
  sender_id: string | null;
  body: string;
  created_at: string;
}
export function teamThreadTitle(
  thread: TeamThread,
  members: TeamMember[],
  currentUser: string
) {
  if (thread.kind === 'group') return thread.title || 'GRUPO';
  const other = thread.team_thread_members.find(
    (m) => m.user_id !== currentUser
  );
  const person = members.find((m) => m.user_id === other?.user_id);
  return (
    person?.nickname || person?.full_name ||
    'CONVERSACION INTERNA'
  );
}
