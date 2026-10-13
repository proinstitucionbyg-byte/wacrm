'use client';
import { useCallback, useEffect, useState } from 'react';
interface WelcomeTask {
  id: string;
  stage?: string;
  welcome_due_at: string;
  completed_at: string | null;
  backup_sent_at: string | null;
  status: string;
}
export function EnrollmentWelcomeCheck({
  conversationId,
}: {
  conversationId: string;
}) {
  const [task, setTask] = useState<WelcomeTask | null>(null),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/enrollments/welcome?conversation=${conversationId}`,
        { cache: 'no-store' }
      );
      if (!res.ok) throw Error('No se pudo comprobar la bienvenida.');
      const data = await res.json();
      setTask(Array.isArray(data.tasks) ? (data.tasks[0] ?? null) : null);
      setNow(Date.now());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar.');
    }
  }, [conversationId]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  async function complete(task: WelcomeTask) {
    setBusy(task.id);
    try {
      const res = await fetch('/api/enrollments/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id }),
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo marcar.');
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="contents" data-enrollment-welcome-slot>
      {task && (
        <div
          data-enrollment-welcome-id={task.id}
          className="mx-4 my-2 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm"
        >
          {task.stage === 'provisional' && (
            <div className="mb-3 rounded-lg border border-amber-500 bg-amber-500/15 p-3">
              <strong>
                PAGO VALIDADO · DATOS PENDIENTES · DOCUMENTOS NO EMITIDOS
              </strong>
              <p>
                FIDELIZACIÓN: completar los datos escritos, conservar su
                pantallazo y gestionar el enlace verificado si empieza clases.
                La bienvenida tiene su plazo de dos horas; marcarla no cierra
                los datos pendientes.
              </p>
            </div>
          )}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={!!task.completed_at}
              disabled={
                !!busy ||
                !!task.completed_at ||
                now >= Date.parse(task.welcome_due_at) ||
                task.status !== 'started'
              }
              onChange={() => void complete(task)}
            />
            <span>
              <strong>BIENVENIDA GESTIONADA</strong>
              <br />
              {task.completed_at
                ? 'MARCADA: SE CANCELO LA BIENVENIDA AUTOMATICA DE RESPALDO.'
                : task.backup_sent_at
                  ? 'BIENVENIDA AUTOMATICA ENVIADA.'
                  : `Plazo: ${new Date(task.welcome_due_at).toLocaleString('es-PE', { timeZone: 'America/Lima' })}. Marcar basta para cancelar el respaldo de imagen y audio.`}
            </span>
          </label>
          {task.status === 'review' && (
            <p className="text-destructive">
              REVISAR EL ENVIO INICIAL ANTES DE CONTINUAR.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive px-4 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
