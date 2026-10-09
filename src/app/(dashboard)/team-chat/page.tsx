'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { TeamMemberProfile } from '@/components/inbox/team-member-profile';
import {
  type TeamMember,
  type TeamMessage,
  type TeamThread,
  teamThreadTitle,
} from '@/lib/team-chat';

async function jsonRequest(url: string, options?: RequestInit) {
  const res = await fetch(url, { cache: 'no-store', ...options });
  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error || 'No se pudo completar la solicitud');
  return data;
}
function TeamConversation({
  thread,
  members,
  userId,
  onRead,
}: {
  thread: TeamThread;
  members: TeamMember[];
  userId: string;
  onRead: () => void;
}) {
  const [messages, setMessages] = useState<TeamMessage[]>([]),
    [body, setBody] = useState(''),
    [error, setError] = useState(''),
    [sending, setSending] = useState(false),
    [older, setOlder] = useState<string | null>(null),
    [loadingOlder, setLoadingOlder] = useState(false);
  const attempt = useRef<{ id: string; body: string } | null>(null),
    bottom = useRef<HTMLDivElement>(null),
    initial = useRef(true);
  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        const data = await jsonRequest(`/api/team-chat/${thread.id}/messages`, {
          signal,
        });
        if (signal.aborted) return;
        setMessages((prev) => {
          const map = new Map<string, TeamMessage>(prev.map((m) => [m.id, m]));
          for (const m of data.messages) map.set(m.id, m);
          return [...map.values()].sort(
            (a, b) =>
              a.created_at.localeCompare(b.created_at) ||
              a.id.localeCompare(b.id)
          );
        });
        if (initial.current) {
          setOlder(data.next);
          initial.current = false;
        }
        if (!document.hidden) {
          await jsonRequest(`/api/team-chat/${thread.id}/read`, {
            method: 'POST',
            signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ through: data.as_of }),
          });
          if (!signal.aborted) onRead();
        }
        setError('');
      } catch (err) {
        if (!signal.aborted)
          setError(
            err instanceof Error ? err.message : 'No se pudo cargar el chat'
          );
      }
    },
    [thread.id, onRead]
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);
  const lastMessageId = messages.at(-1)?.id;
  useEffect(() => {
    if (lastMessageId) bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [lastMessageId]);
  async function loadOlder() {
    if (!older) return;
    setLoadingOlder(true);
    try {
      const data = await jsonRequest(
        `/api/team-chat/${thread.id}/messages?before=${older}`
      );
      setMessages((prev) => [
        ...data.messages,
        ...prev.filter(
          (m) => !data.messages.some((n: TeamMessage) => n.id === m.id)
        ),
      ]);
      setOlder(data.next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar');
    } finally {
      setLoadingOlder(false);
    }
  }
  async function send() {
    if (!body.trim() || sending) return;
    setSending(true);
    const normalized = body.replace(/\r\n?/g, '\n').trim();
    if (!attempt.current || attempt.current.body !== normalized)
      attempt.current = { id: crypto.randomUUID(), body: normalized };
    try {
      const result = await jsonRequest(`/api/team-chat/${thread.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attempt.current),
      });
      setMessages((prev) =>
        prev.some((m) => m.id === result.message.id)
          ? prev
          : [...prev, result.message]
      );
      setBody('');
      attempt.current = null;
      setError('');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo enviar. Puedes reintentar.'
      );
    } finally {
      setSending(false);
    }
  }
  return (
    <section className="border-border bg-card flex min-h-[32rem] flex-col rounded-lg border">
      <header className="border-border border-b p-4">
        <h2 className="font-semibold">
          {teamThreadTitle(thread, members, userId)}
        </h2>
        <div className="flex flex-wrap gap-1">
          {thread.team_thread_members
            .map((p) => members.find((m) => m.user_id === p.user_id))
            .filter((m): m is TeamMember => !!m)
            .map((member) => (
              <TeamMemberProfile key={member.user_id} member={member} />
            ))}
        </div>
        {thread.can_send === false && (
          <p className="text-muted-foreground text-xs">
            {thread.archived_at
              ? 'CONVERSACION ARCHIVADA'
              : 'VISTA DE SUPERVISION · SOLO LECTURA'}
          </p>
        )}
      </header>
      <div
        className="max-h-[55vh] min-h-64 flex-1 space-y-3 overflow-y-auto p-4"
        aria-live="polite"
      >
        {older && (
          <Button variant="outline" disabled={loadingOlder} onClick={loadOlder}>
            Ver mensajes anteriores
          </Button>
        )}
        {messages.length === 0 && (
          <p className="text-muted-foreground text-sm">
            Todavía no hay mensajes. Lo que escribas aquí se enviará solamente a
            los participantes de este chat.
          </p>
        )}
        {messages.map((message) => (
          <article
            key={message.id}
            className={`max-w-[90%] rounded-lg p-3 ${message.sender_id === userId ? 'bg-primary/15 ml-auto' : 'bg-muted'}`}
          >
            <p className="text-xs font-semibold">
              {message.sender_id === userId
                ? 'TU'
                : members.find((m) => m.user_id === message.sender_id)
                    ?.full_name || 'MIEMBRO DEL EQUIPO'}
            </p>
            <p className="text-sm break-words whitespace-pre-wrap">
              {message.body}
            </p>
            <time
              className="text-muted-foreground text-[11px]"
              dateTime={message.created_at}
            >
              {new Date(message.created_at).toLocaleString('es-PE', {
                timeZone: 'America/Lima',
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </time>
          </article>
        ))}
        <div ref={bottom} />
      </div>
      {error && (
        <p role="alert" className="px-4 text-sm text-red-400">
          {error}
        </p>
      )}
      <form
        className="border-border space-y-2 border-t p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor="team-message" className="text-sm">
          Mensaje al equipo
        </label>
        <textarea
          id="team-message"
          value={body}
          maxLength={4000}
          disabled={sending || thread.can_send === false}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send();
            }
          }}
          className="border-border bg-background block min-h-24 w-full resize-y rounded border p-3"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            Enter envía · Shift + Enter agrega una línea
          </span>
          <Button
            type="submit"
            disabled={sending || !body.trim() || thread.can_send === false}
          >
            {sending ? 'Enviando…' : 'Enviar'}
          </Button>
        </div>
      </form>
    </section>
  );
}
function TeamChatContent() {
  const { user } = useAuth();
  const params = useSearchParams();
  const [threads, setThreads] = useState<TeamThread[]>([]),
    [members, setMembers] = useState<TeamMember[]>([]),
    [active, setActive] = useState(params.get('thread') || ''),
    [selected, setSelected] = useState<string[]>([]),
    [title, setTitle] = useState(''),
    [creating, setCreating] = useState(false),
    [error, setError] = useState(''),
    [showNew, setShowNew] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [admin, setAdmin] = useState(false),
    [owner, setOwner] = useState(false);
  const load = useCallback(async () => {
    try {
      const data = await jsonRequest('/api/team-chat');
      setThreads(data.threads);
      setMembers(data.members);
      setAdmin(
        data.members.some(
          (m: TeamMember) =>
            m.user_id === user?.id &&
            ['owner', 'admin'].includes(m.account_role)
        )
      );
      setOwner(
        data.members.some(
          (m: TeamMember) =>
            m.user_id === user?.id && m.account_role === 'owner'
        )
      );
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar');
    }
  }, [user?.id]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);
  const markRead = useCallback(
    () =>
      setThreads((prev) =>
        prev.map((t) => (t.id === active ? { ...t, unread: 0 } : t))
      ),
    [active]
  );
  async function create() {
    setCreating(true);
    try {
      const data = await jsonRequest('/api/team-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members: selected, title: title || null }),
      });
      await load();
      setActive(data.id);
      setShowNew(false);
      setSelected([]);
      setTitle('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear');
    } finally {
      setCreating(false);
    }
  }
  const room = threads.find((t) => t.id === active);
  async function archive(global: boolean, restore: boolean) {
    if (!room) return;
    try {
      await jsonRequest(`/api/team-chat/${room.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ global, restore }),
      });
      await load();
      setActive('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo archivar');
    }
  }
  async function deleteRoom() {
    if (
      !room ||
      !window.confirm(
        `ELIMINAR DEFINITIVAMENTE: ${teamThreadTitle(room, members, user?.id || '')}\nSe borrarán sus mensajes para todo el equipo. Esta acción no se puede deshacer.`
      )
    )
      return;
    try {
      await jsonRequest(`/api/team-chat/${room.id}`, { method: 'DELETE' });
      await load();
      setActive('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo eliminar');
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">CHAT INTERNO</h1>
          <p className="text-muted-foreground text-sm">
            Conversaciones entre los participantes del equipo.
          </p>
        </div>
        <Button onClick={() => setShowNew(!showNew)}>Nueva conversación</Button>
      </div>
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
      {showNew && (
        <section className="border-border space-y-3 rounded border p-4">
          <h2 className="font-semibold">Selecciona a quién escribir</h2>
          <label className="block text-sm">
            Nombre del grupo (obligatorio para varios compañeros)
            <input
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              className="border-border bg-background mt-1 block w-full rounded border p-2"
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {members
              .filter((m) => m.user_id !== user?.id)
              .map((member) => (
                <label key={member.user_id} className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(member.user_id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, member.user_id]
                          : selected.filter((id) => id !== member.user_id)
                      )
                    }
                  />
                  {member.full_name || 'MIEMBRO DEL EQUIPO'}
                </label>
              ))}
          </div>
          <Button
            disabled={
              creating ||
              !selected.length ||
              (selected.length > 1 && !title.trim())
            }
            onClick={create}
          >
            {creating ? 'Creando…' : 'Abrir conversación'}
          </Button>
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setShowArchived(!showArchived);
            setActive('');
          }}
        >
          {showArchived ? 'VER ACTIVAS' : 'VER ARCHIVADAS'}
        </Button>
        {room && (
          <>
            <Button
              variant="outline"
              onClick={() => archive(false, !!room.personally_archived)}
            >
              {room.personally_archived
                ? 'RECUPERAR PARA MI'
                : 'ARCHIVAR PARA MI'}
            </Button>
            {admin && (
              <Button
                variant="outline"
                onClick={() => archive(true, !!room.archived_at)}
              >
                {room.archived_at
                  ? 'RECUPERAR PARA TODOS'
                  : 'ARCHIVAR PARA TODOS'}
              </Button>
            )}
            {owner && (
              <Button variant="destructive" onClick={deleteRoom}>
                ELIMINAR DEFINITIVAMENTE
              </Button>
            )}
          </>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Conversaciones internas" className="space-y-2">
          {threads.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Aún no tienes conversaciones internas.
            </p>
          ) : (
            threads
              .filter(
                (thread) =>
                  showArchived ===
                  !!(thread.archived_at || thread.personally_archived)
              )
              .map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => setActive(thread.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded border p-3 text-left text-sm ${active === thread.id ? 'border-primary bg-primary/10' : 'border-border'}`}
                >
                  <span>
                    {teamThreadTitle(thread, members, user?.id || '')}
                  </span>
                  {thread.unread > 0 && (
                    <span className="bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs">
                      {thread.unread > 99 ? '99+' : thread.unread}
                    </span>
                  )}
                </button>
              ))
          )}
        </nav>
        {room ? (
          <TeamConversation
            key={room.id}
            thread={room}
            members={members}
            userId={user?.id || ''}
            onRead={markRead}
          />
        ) : (
          <div className="border-border text-muted-foreground rounded border border-dashed p-10 text-center">
            Selecciona una conversación o crea una nueva.
          </div>
        )}
      </div>
    </div>
  );
}
export default function TeamChatPage() {
  return (
    <Suspense fallback={<p>Cargando chat…</p>}>
      <TeamChatContent />
    </Suspense>
  );
}
