'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { folderPath, isFolderDescendant, type FolderEntry } from '@/lib/automations/folder-path';

export function FolderDestination({ folders, movingFolderId, currentFolderId, onMove }: {
  folders: FolderEntry[]; movingFolderId?: string; currentFolderId: string | null;
  onMove: (folderId: string | null) => Promise<void>;
}) {
  const [destination, setDestination] = useState(currentFolderId ?? '');
  const [busy, setBusy] = useState(false);
  const options = folders.filter(f => !movingFolderId || !isFolderDescendant(folders, f.id, movingFolderId))
    .sort((a, b) => folderPath(folders, a.id).localeCompare(folderPath(folders, b.id)));
  return <div className="space-y-4">
    <label className="block space-y-2 text-sm"><span>CARPETA DE DESTINO</span>
      <select aria-label="Carpeta de destino" className="w-full min-w-0 rounded-md border border-border bg-background p-3" value={destination} disabled={busy} onChange={e => setDestination(e.target.value)}>
        <option value="">PRINCIPAL</option>
        {options.map(f => <option key={f.id} value={f.id}>{folderPath(folders, f.id)}</option>)}
      </select>
    </label>
    <p className="break-words text-sm text-muted-foreground">{folderPath(folders, destination || null)}</p>
    <Button disabled={busy || destination === (currentFolderId ?? '')} onClick={async () => { setBusy(true); try { await onMove(destination || null); } finally { setBusy(false); } }}>{busy ? 'MOVIENDO...' : 'MOVER AQUI'}</Button>
  </div>;
}
