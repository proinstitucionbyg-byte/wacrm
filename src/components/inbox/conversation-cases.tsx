'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
type Case = {
  id: string;
  reason: string;
  solution: string;
  status: 'open' | 'resolved';
  version: number;
  created_at: string;
};
export function ConversationCases({
  conversationId,
}: {
  conversationId: string;
}) {
  const { user } = useAuth();
  const [rows, setRows] = useState<Case[]>([]),
    [editing, setEditing] = useState<Case | null>(null),
    [reason, setReason] = useState(''),
    [solution, setSolution] = useState(''),
    [status, setStatus] = useState<'open' | 'resolved'>('open'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [canEdit, setCanEdit] = useState(false),
    [generation, setGeneration] = useState(0);
  useEffect(() => {
    let active = true;
    void createClient()
      .from('conversation_cases')
      .select('id,reason,solution,status,version,created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (active) {
          setRows(data ?? []);
          setError(error ? 'No se pudieron cargar los casos.' : '');
        }
      });
    if (user)
      void createClient()
        .rpc('has_member_permission', {
          p_user_id: user.id,
          p_module: 'inbox',
          p_action: 'send',
        })
        .then(({ data, error }) => {
          if (active) setCanEdit(!error && data === true);
        });
    return () => {
      active = false;
    };
  }, [conversationId, user, generation]);
  function edit(row: Case | null) {
    setEditing(row);
    setReason(row?.reason ?? '');
    setSolution(row?.solution ?? '');
    setStatus(row?.status ?? 'open');
    setError('');
  }
  async function save() {
    setBusy(true);
    setError('');
    const { error } = await createClient().rpc('save_conversation_case', {
      p_conversation: conversationId,
      p_reason: reason,
      p_solution: solution,
      p_status: status,
      p_id: editing?.id ?? null,
      p_version: editing?.version ?? null,
    });
    if (error)
      setError(
        error.code === '40001'
          ? 'Otra persona actualizó este caso. Vuelve a abrirlo.'
          : 'No se pudo guardar. Comprueba tus permisos y los datos.'
      );
    else {
      edit(null);
      setGeneration((value) => value + 1);
    }
    setBusy(false);
  }
  return (
    <details className="mt-4 border-t pt-4">
      <summary className="cursor-pointer text-xs font-semibold uppercase">
        Quejas y soluciones
      </summary>
      <p className="text-muted-foreground mt-2 text-xs">
        Registra solo casos reales. Un mensaje sin respuesta no se cuenta
        automáticamente como queja.
      </p>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <article
            key={row.id}
            className="space-y-1 rounded-lg border p-2 text-xs"
          >
            <strong className="break-words">{row.reason}</strong>
            <p>{row.status === 'resolved' ? 'RESUELTO' : 'PENDIENTE'}</p>
            <p className="break-words whitespace-pre-wrap">
              {row.solution || 'Sin solución registrada'}
            </p>
            {canEdit && (
              <Button size="sm" variant="ghost" onClick={() => edit(row)}>
                Editar caso
              </Button>
            )}
          </article>
        ))}
      </div>
      {canEdit && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold">
            {editing ? 'EDITAR CASO' : 'REGISTRAR CASO'}
          </p>
          <input
            className="bg-background w-full rounded border p-2 text-xs"
            aria-label="Motivo de la queja"
            placeholder="Motivo de la queja"
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <textarea
            className="bg-background w-full rounded border p-2 text-xs"
            aria-label="Solución aplicada"
            placeholder="Solución aplicada o gestión pendiente"
            maxLength={2000}
            rows={3}
            value={solution}
            onChange={(e) => setSolution(e.target.value)}
          />
          <select
            className="bg-background w-full rounded border p-2 text-xs"
            aria-label="Estado del caso"
            value={status}
            onChange={(e) => setStatus(e.target.value as 'open' | 'resolved')}
          >
            <option value="open">Pendiente</option>
            <option value="resolved">Resuelto</option>
          </select>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={
                busy ||
                !reason.trim() ||
                (status === 'resolved' && !solution.trim())
              }
              onClick={save}
            >
              {busy ? 'Guardando…' : 'Guardar caso'}
            </Button>
            {editing && (
              <Button size="sm" variant="outline" onClick={() => edit(null)}>
                Cancelar
              </Button>
            )}
          </div>
        </div>
      )}
      {error && (
        <p className="text-destructive mt-2 text-xs" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
