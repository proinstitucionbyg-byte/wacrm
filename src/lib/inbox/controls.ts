import { UUID_PATTERN } from '@/lib/team-chat';
export interface TagAudience {
  users: string[];
  areas: string[];
  roles: string[];
}
export interface InboxTagInput {
  id: string | null;
  name: string;
  color: string;
  kind: 'process' | 'access';
  audience: TagAudience;
}
export function parseInboxTag(raw: unknown): InboxTagInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>,
    a = r.audience as TagAudience | undefined;
  if (r.id != null && (typeof r.id !== 'string' || !UUID_PATTERN.test(r.id)))
    return null;
  if (
    typeof r.name !== 'string' ||
    !r.name.trim() ||
    r.name.trim().length > 80 ||
    typeof r.color !== 'string' ||
    !/^#[a-f\d]{6}$/i.test(r.color) ||
    !['process', 'access'].includes(String(r.kind))
  )
    return null;
  if (
    !a ||
    !Array.isArray(a.users) ||
    !Array.isArray(a.areas) ||
    !Array.isArray(a.roles) ||
    a.users.length > 100 ||
    a.areas.length > 30 ||
    a.roles.length > 3
  )
    return null;
  if (
    a.users.some((x) => typeof x !== 'string' || !UUID_PATTERN.test(x)) ||
    a.areas.some((x) => typeof x !== 'string' || !x.trim() || x.length > 80) ||
    a.roles.some((x) => !['owner', 'admin', 'coordinator'].includes(x))
  )
    return null;
  if (
    r.kind === 'access' &&
    a.users.length + a.areas.length + a.roles.length === 0
  )
    return null;
  return {
    id: (r.id as string | null) ?? null,
    name: r.name.trim().toUpperCase(),
    color: r.color,
    kind: r.kind as InboxTagInput['kind'],
    audience: {
      users: [...new Set(a.users)],
      areas: [...new Set(a.areas.map((x) => x.trim().toUpperCase()))],
      roles: [...new Set(a.roles)],
    },
  };
}
export function parseLabelApplication(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    !Array.isArray(r.conversations) ||
    r.conversations.length < 1 ||
    r.conversations.length > 100 ||
    r.conversations.some(
      (x) => typeof x !== 'string' || !UUID_PATTERN.test(x)
    ) ||
    typeof r.tag !== 'string' ||
    !UUID_PATTERN.test(r.tag) ||
    typeof r.remove !== 'boolean'
  )
    return null;
  return {
    conversations: [...new Set(r.conversations)] as string[],
    tag: r.tag,
    remove: r.remove,
  };
}
export function parseTransfer(raw: unknown) {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.conversation !== 'string' ||
    !UUID_PATTERN.test(r.conversation) ||
    (r.agent !== null &&
      (typeof r.agent !== 'string' || !UUID_PATTERN.test(r.agent))) ||
    typeof r.full_history !== 'boolean'
  )
    return null;
  return {
    conversation: r.conversation,
    agent: r.agent as string | null,
    full_history: r.full_history,
  };
}
