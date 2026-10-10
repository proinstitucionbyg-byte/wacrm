export interface FolderEntry { id: string; name: string; parent_id: string | null }
export function folderPath(folders: FolderEntry[], id: string | null): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = folders.find(item => item.id === id);
    if (!folder) break;
    parts.unshift(folder.name);
    id = folder.parent_id;
  }
  return ['PRINCIPAL', ...parts].join(' / ');
}
export function isFolderDescendant(folders: FolderEntry[], id: string, ancestor: string): boolean {
  const seen = new Set<string>();
  let current: string | null = id;
  while (current && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    current = folders.find(item => item.id === current)?.parent_id ?? null;
  }
  return false;
}
