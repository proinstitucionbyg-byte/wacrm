'use client';
import { useEffect, useState } from 'react';
import { z } from 'zod';
const payload = z.object({
  members: z.array(
    z.object({
      user_id: z.string().uuid(),
      full_name: z.string().nullable(),
      account_role: z.string(),
    })
  ),
  grants: z.array(
    z.object({
      user_id: z.string().uuid(),
      line_key: z.string(),
      linked_phone: z.string(),
      can_manage: z.boolean(),
    })
  ),
});
const button =
  'rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40';
export function GroupLineAccess({
  lineKey,
  phone,
}: {
  lineKey: string;
  phone: string;
}) {
  const [data, setData] = useState<z.infer<typeof payload> | null>(null),
    [user, setUser] = useState(''),
    [access, setAccess] = useState('view');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/multichannel/whatsapp/groups/access', {
      cache: 'no-store',
      signal: abort.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw Error(body.error || 'No se pudieron consultar los permisos.');
        setData(payload.parse(body));
      })
      .catch((error) => {
        if (!abort.signal.aborted) setMessage(error.message);
      });
    return () => abort.abort();
  }, []);
  async function save() {
    if (busy || !user) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/multichannel/whatsapp/groups/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user,
          line_key: lineKey,
          expected_phone: phone,
          access,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.json();
      if (!response.ok)
        throw Error(body.error || 'No se confirmaron los permisos.');
      setData(
        (current) =>
          current && {
            ...current,
            grants: [
              ...current.grants.filter(
                (g) => g.user_id !== user || g.line_key !== lineKey
              ),
              ...(access === 'none'
                ? []
                : [
                    {
                      user_id: user,
                      line_key: lineKey,
                      linked_phone: phone,
                      can_manage: access === 'manage',
                    },
                  ]),
            ],
          }
      );
      setMessage(
        'Permiso guardado para este número. Las solicitudes pendientes sin permiso se cancelan antes de ejecutarse.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Consulta los permisos antes de repetir.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="border-border rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Permisos de grupos · +{phone}
      </summary>
      <p className="text-muted-foreground my-2 text-sm">
        Solo tú, como CEO, puedes conceder estos accesos. No autorizan eliminar
        conversaciones privadas.
      </p>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Persona con acceso a grupos"
          className={button}
          value={user}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value;
            setUser(next);
            const grant = data?.grants.find(
              (g) =>
                g.user_id === next &&
                g.line_key === lineKey &&
                g.linked_phone === phone
            );
            setAccess(grant ? (grant.can_manage ? 'manage' : 'view') : 'none');
          }}
        >
          <option value="">Elige una persona</option>
          {data?.members
            .filter((m) => m.account_role !== 'owner')
            .map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.full_name || 'Sin nombre'}
              </option>
            ))}
        </select>
        <select
          aria-label="Permiso de grupos"
          className={button}
          value={access}
          disabled={busy || !user}
          onChange={(event) => setAccess(event.target.value)}
        >
          <option value="none">Sin acceso</option>
          <option value="view">Consultar grupos y participantes</option>
          <option value="manage">Consultar y administrar grupos</option>
        </select>
        <button
          className={button}
          disabled={busy || !user}
          onClick={() => void save()}
        >
          Guardar permiso
        </button>
      </div>
      {message && (
        <p role="status" className="mt-2 text-sm">
          {message}
        </p>
      )}
    </details>
  );
}
