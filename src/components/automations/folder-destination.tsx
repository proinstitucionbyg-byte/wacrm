'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { folderPath, isFolderDescendant, type FolderEntry } from '@/lib/automations/folder-path';

export function FolderDestination({ folders, movingFolderId, currentFolderId, onMove }: {
  folders: FolderEntry[]; movingFolderId?: string; currentFolderId: string | null;
  onMove: (folderId: string | null) => Promise<void>;
}) {
  const [destination, setDestination] = useState(currentFolderId ?? '');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(() => {
    const ancestors = new Set<string>();
    let id = currentFolderId;
    while (id && !ancestors.has(id)) {
      ancestors.add(id);
      id = folders.find(folder => folder.id === id)?.parent_id ?? null;
    }
    return ancestors;
  });
  const options = folders.filter(folder => !movingFolderId || !isFolderDescendant(folders, folder.id, movingFolderId));

  function toggleFolder(id: string) {
    setDestination(id);
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderChildren(parentId: string | null, depth: number, visited: Set<string>): ReactNode {
    return options
      .filter(folder => folder.parent_id === parentId && !visited.has(folder.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(folder => {
        const hasChildren = options.some(child => child.parent_id === folder.id);
        const isExpanded = expanded.has(folder.id);
        const path = folderPath(folders, folder.id);
        return <div key={folder.id}>
          <button
            type="button"
            disabled={busy}
            aria-expanded={hasChildren ? isExpanded : undefined}
            aria-current={destination === folder.id ? 'true' : undefined}
            title={path}
            onClick={() => toggleFolder(folder.id)}
            className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted ${destination === folder.id ? 'bg-primary/10 text-primary' : ''}`}
            style={{ paddingLeft: `${8 + Math.min(depth, 2) * 12}px` }}
          >
            {hasChildren ? (isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />) : <span className="w-4 shrink-0" />}
            <Folder className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{folder.name}</span>
          </button>
          {hasChildren && isExpanded && renderChildren(folder.id, depth + 1, new Set([...visited, folder.id]))}
        </div>;
      });
  }

  return <div className="min-w-0 space-y-3">
    <p className="text-sm">CARPETA DE DESTINO</p>
    <nav aria-label="Carpeta de destino" className="max-h-72 overflow-y-auto rounded-md border border-border p-1">
      <button
        type="button"
        disabled={busy}
        aria-current={destination === '' ? 'true' : undefined}
        onClick={() => setDestination('')}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted ${destination === '' ? 'bg-primary/10 text-primary' : ''}`}
      >
        <Folder className="h-4 w-4 shrink-0" /> PRINCIPAL
      </button>
      {renderChildren(null, 0, new Set())}
    </nav>
    <p className="break-words text-sm text-muted-foreground">Destino: {folderPath(folders, destination || null)}</p>
    <Button disabled={busy || destination === (currentFolderId ?? '')} onClick={async () => { setBusy(true); try { await onMove(destination || null); } finally { setBusy(false); } }}>{busy ? 'MOVIENDO...' : 'MOVER AQUI'}</Button>
  </div>;
}
