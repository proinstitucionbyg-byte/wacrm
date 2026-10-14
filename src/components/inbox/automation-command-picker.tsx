'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { normalizedCommand } from '@/lib/inbox/commands';

export interface PreparedBlock {
  id: string;
  name: string;
  category: string;
  preview: string;
}

export function AutomationCommandPicker({ open, query, onOpenChange, onPick }: {
  open: boolean;
  query: string;
  onOpenChange: (open: boolean) => void;
  onPick: (block: PreparedBlock) => void;
}) {
  const [blocks, setBlocks] = useState<PreparedBlock[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setSearch(query); }, [query]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    fetch('/api/inbox/commands')
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'No se pudieron cargar las automatizaciones.');
        if (active) setBlocks(data.blocks ?? []);
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Error al cargar.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open]);

  const grouped = useMemo(() => {
    const words = normalizedCommand(search).split(' ').filter(Boolean);
    const matches = blocks.filter((block) => {
      const haystack = normalizedCommand(`${block.name} ${block.category} ${block.preview}`);
      return words.every((word) => haystack.includes(word));
    });
    const categories = new Map<string, PreparedBlock[]>();
    for (const block of matches) {
      const category = block.category || 'Sin carpeta';
      categories.set(category, [...(categories.get(category) ?? []), block]);
    }
    return [...categories.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'));
  }, [blocks, search]);

  if (!open) return null;
  return (
    <div className="absolute bottom-full left-0 z-50 mb-2 w-[min(23rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl" role="dialog" aria-label="Buscar automatización">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-semibold">AUTOMATIZACIONES</span>
        <button type="button" onClick={() => onOpenChange(false)} aria-label="Cerrar automatizaciones" className="rounded p-1 hover:bg-secondary"><X className="h-4 w-4" /></button>
      </div>
      <label className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input aria-label="Buscar automatización" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, carpeta o contenido" className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
      </label>
      <div className="max-h-64 overflow-y-auto p-1">
        {loading && <p className="px-3 py-2 text-xs text-muted-foreground">Cargando…</p>}
        {error && <p className="px-3 py-2 text-xs text-destructive">{error}</p>}
        {!loading && !error && grouped.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">No hay automatizaciones activas que coincidan.</p>}
        {grouped.map(([category, items]) => (
          <div key={category}>
            <p className="sticky top-0 bg-popover px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">{category}</p>
            {items.map((block) => (
              <button key={block.id} type="button" onClick={() => onPick(block)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-secondary focus:bg-secondary focus:outline-none">
                <span className="block truncate text-sm font-medium">{block.name}</span>
                {block.preview && <span className="block truncate text-xs text-muted-foreground">{block.preview}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
