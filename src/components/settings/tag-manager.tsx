'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus, Tag as TagIcon, Trash2 } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import type { Tag } from '@/types';
import type { InboxTagInput } from '@/lib/inbox/controls';
interface Person {
  user_id: string;
  full_name: string | null;
  nickname: string | null;
  area: string | null;
}
const blank = (): InboxTagInput => ({
  id: null,
  name: '',
  color: '#10b981',
  kind: 'process',
  audience: { users: [], areas: [], roles: [] },
});
export function TagManager() {
  const canManage = useCan('tags.manage');
  const [tags, setTags] = useState<Tag[]>([]),
    [people, setPeople] = useState<Person[]>([]),
    [draft, setDraft] = useState(blank),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState<Tag | null>(null);
  async function load() {
    try {
      const res = await fetch('/api/inbox/tags', { cache: 'no-store' }),
        data = await res.json();
      if (!res.ok) throw Error(data.error);
      setTags(data.tags);
      setPeople(data.members);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'No se pudieron cargar las etiquetas'
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function toggle(key: 'users' | 'areas' | 'roles', value: string) {
    setDraft((d) => ({
      ...d,
      audience: {
        ...d.audience,
        [key]: d.audience[key].includes(value)
          ? d.audience[key].filter((x) => x !== value)
          : [...d.audience[key], value],
      },
    }));
  }
  async function save() {
    setBusy(true);
    try {
      const res = await fetch('/api/inbox/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(draft),
        }),
        data = await res.json();
      if (!res.ok) throw Error(data.error);
      setEditing(false);
      await load();
      toast.success('Etiqueta guardada');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await fetch('/api/inbox/tags', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: deleting.id }),
        }),
        data = await res.json();
      if (!res.ok) throw Error(data.error);
      setDeleting(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo eliminar');
    } finally {
      setBusy(false);
    }
  }
  const areas = [
    ...new Set(
      people
        .map((p) => p.area?.trim().toUpperCase())
        .filter((a): a is string => !!a)
    ),
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <TagIcon className="size-4" />
            ETIQUETAS
          </span>
          {canManage && (
            <Button
              size="sm"
              onClick={() => {
                setDraft(blank());
                setEditing(true);
              }}
            >
              <Plus className="size-4" />
              CREAR
            </Button>
          )}
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          Las etiquetas de trabajo organizan. Las de acceso determinan quién
          puede ver el chat. El CEO conserva la supervisión.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {tags.length === 0 && (
          <p className="text-muted-foreground text-sm">
            No hay etiquetas disponibles.
          </p>
        )}
        {tags.map((tag) => (
          <div
            key={tag.id}
            className="flex items-center justify-between gap-2 rounded-md border p-3"
          >
            <div>
              <span
                className="mr-2 inline-block size-2 rounded-full"
                style={{ backgroundColor: tag.color }}
              />
              {tag.name}
              <p className="text-muted-foreground text-xs">
                {tag.kind === 'access'
                  ? 'ACCESO AL CHAT'
                  : tag.kind === 'system'
                    ? 'ASIGNACION AUTOMATICA'
                    : 'ESTADO DE TRABAJO'}
              </p>
            </div>
            {canManage && tag.kind !== 'system' && (
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={'Editar ' + tag.name}
                  onClick={() => {
                    setDraft({
                      id: tag.id,
                      name: tag.name,
                      color: tag.color,
                      kind: tag.kind === 'access' ? 'access' : 'process',
                      audience: tag.audience ?? blank().audience,
                    });
                    setEditing(true);
                  }}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={'Eliminar ' + tag.name}
                  onClick={() => setDeleting(tag)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            )}
          </div>
        ))}
        <Dialog open={editing} onOpenChange={setEditing}>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {draft.id ? 'EDITAR ETIQUETA' : 'CREAR ETIQUETA'}
              </DialogTitle>
              <DialogDescription>
                Selecciona personas, áreas o responsables autorizados. Puedes
                combinar destinatarios.
              </DialogDescription>
            </DialogHeader>
            <label className="space-y-1 text-sm">
              NOMBRE
              <Input
                value={draft.name}
                maxLength={80}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="text-sm">
              COLOR{' '}
              <input
                type="color"
                value={draft.color}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-sm">
              TIPO
              <select
                className="bg-background w-full rounded-md border p-2"
                value={draft.kind}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    kind: e.target.value as InboxTagInput['kind'],
                  })
                }
              >
                <option value="process">ESTADO DE TRABAJO</option>
                <option value="access">ACCESO AL CHAT</option>
              </select>
            </label>
            <p className="text-muted-foreground text-xs">
              {draft.kind === 'process'
                ? 'Los destinatarios pueden aplicar esta etiqueta; no reciben acceso a chats ajenos. Sin selección queda disponible para todos.'
                : 'Los destinatarios podrán consultar los chats que tengan esta etiqueta.'}
            </p>
            <fieldset className="space-y-2 rounded-md border p-3">
              <legend className="text-sm">PERSONAS</legend>
              {people.map((p) => (
                <label
                  key={p.user_id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={draft.audience.users.includes(p.user_id)}
                    onChange={() => toggle('users', p.user_id)}
                  />
                  {p.nickname || p.full_name || 'SIN APODO'}{' '}
                  <span className="text-muted-foreground">{p.area}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="space-y-2 rounded-md border p-3">
              <legend className="text-sm">AREAS</legend>
              {areas.map((a) => (
                <label key={a} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.audience.areas.includes(a)}
                    onChange={() => toggle('areas', a)}
                  />
                  {a}
                </label>
              ))}
            </fieldset>
            <fieldset className="space-y-2 rounded-md border p-3">
              <legend className="text-sm">SUPERVISION</legend>
              {[
                ['owner', 'CEO'],
                ['admin', 'ADMINISTRACION'],
                ['coordinator', 'COORDINADORES AUTORIZADOS'],
              ].map(([id, label]) => (
                <label key={id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.audience.roles.includes(id)}
                    onChange={() => toggle('roles', id)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <DialogFooter>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                CANCELAR
              </Button>
              <Button disabled={busy || !draft.name.trim()} onClick={save}>
                {busy ? 'GUARDANDO…' : 'GUARDAR'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!deleting}
          onOpenChange={(v) => {
            if (!v) setDeleting(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>ELIMINAR ETIQUETA</DialogTitle>
              <DialogDescription>
                Se retirará {deleting?.name} de todos sus contactos. Esto no
                borra conversaciones.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                CANCELAR
              </Button>
              <Button variant="destructive" disabled={busy} onClick={remove}>
                ELIMINAR
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
