'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Tag } from '@/types';
import { groupTags } from '@/lib/inbox/tag-groups';
import { cn } from '@/lib/utils';

export function GroupedTags({ tags, selectedIds = [], renderTag }: {
  tags: Tag[];
  selectedIds?: string[];
  renderTag: (tag: Tag) => ReactNode;
}) {
  const groups = useMemo(() => groupTags(tags), [tags]);
  const [open, setOpen] = useState<string | null>(null);
  const id = useId();
  return <div className="space-y-1">
    {groups.map((group, index) => {
      const expanded = open === group.name;
      const selected = group.tags.filter(tag => selectedIds.includes(tag.id)).length;
      return <div key={group.name} className="rounded-md border">
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold"
          aria-expanded={expanded} aria-controls={`${id}-${index}`}
          onClick={() => setOpen(expanded ? null : group.name)}>
          <ChevronDown className={cn('size-4 shrink-0 transition-transform', expanded && 'rotate-180')} />
          <span className="min-w-0 flex-1">{group.name}</span>
          <span className="text-muted-foreground">{selected ? `${selected} / ` : ''}{group.tags.length}</span>
        </button>
        {expanded && <div id={`${id}-${index}`} className="max-h-60 space-y-1 overflow-y-auto border-t p-1">
          {group.tags.map(renderTag)}
        </div>}
      </div>;
    })}
  </div>;
}
