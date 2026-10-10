export interface AdviserIntroduction {
  name: string;
  area: string | null;
}

/** An old interaction must not suppress the presentation after a new transfer. */
export function hasContactedSinceAssignment(
  messages: { sender_type: string; sender_id?: string | null; created_at: string }[],
  userId: string | undefined,
  assignedAt?: string | null,
): boolean {
  if (!userId) return false;
  const boundary = assignedAt ? Date.parse(assignedAt) : -Infinity;
  if (Number.isNaN(boundary)) return false;
  return messages.some((message) => message.sender_type === 'agent' && message.sender_id === userId && Date.parse(message.created_at) >= boundary);
}

/** Public-facing identity only; metadata must never grant permissions. */
export function getAdviserNickname(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  const nickname = (metadata as Record<string, unknown>).nickname;
  return typeof nickname === "string" ? nickname.trim().replace(/\s+/g, " ") : "";
}

/** Only the assigned adviser gets a presentation using her saved nickname. */
export function getAdviserIntroduction(
  currentUserId: string | undefined,
  assignedUserId: string | null,
  assignee: { area?: string | null } | undefined,
  nickname: string,
): AdviserIntroduction | null {
  if (!currentUserId || currentUserId !== assignedUserId) return null;
  const name = nickname.trim().replace(/\s+/g, " ");
  if (!name) return null;
  return { name, area: assignee?.area?.trim() || null };
}

/** Deterministic draft: this function never sends a message or calls an AI. */
export function buildAdviserIntroduction(name: string, area: string): string | null {
  const cleanName = name.trim().replace(/\s+/g, " ");
  const cleanArea = area.trim().replace(/\s+/g, " ");
  if (!cleanName || !cleanArea) return null;
  const areaKey = cleanArea.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const labels: Record<string, string> = {
    ventas: "ventas",
    fidelizacion: "fidelización",
    administracion: "administración",
    finanzas: "finanzas",
  };
  return `Hola, ¿qué tal? Soy ${cleanName}, tu asesora de ${labels[areaKey] ?? cleanArea}. A partir de ahora te acompañaré con tu atención. ¿En qué puedo ayudarte?`;
}
