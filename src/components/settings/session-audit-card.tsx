'use client';

import { useCallback, useEffect, useState } from 'react';
import { MapPin, RefreshCw } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { locationConsentKey, locationDeclinedKey } from '@/lib/presence/location-consent';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface SessionRow {
  session_id: string;
  user_id: string;
  first_seen_at: string;
  last_seen_at: string;
  user_agent: string | null;
  reported_ip: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  location_seen_at: string | null;
  location_declined_at: string | null;
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString('es-PE');
}

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Dispositivo desconocido';
  const system = /Android|iPhone|iPad|Windows|Macintosh|Linux/i.exec(userAgent)?.[0] ?? 'Otro equipo';
  const browser = /Edg\/|Firefox\/|Chrome\/|Safari\//.exec(userAgent)?.[0]?.replace('/', '') ?? 'Navegador';
  return `${system} · ${browser}`;
}

export function LocationSharingCard() {
  const { user } = useAuth();
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (user) setSharing(localStorage.getItem(locationConsentKey(user.id)) === 'yes');
  }, [user]);

  const enable = () => {
    if (!user) return;
    if (!navigator.geolocation) {
      setMessage('Este dispositivo no permite compartir ubicación.');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      () => {
        localStorage.setItem(locationConsentKey(user.id), 'yes');
        sessionStorage.removeItem(locationDeclinedKey(user.id));
        window.dispatchEvent(new Event('wacrm-location-enabled'));
        setSharing(true);
        setBusy(false);
        setMessage('Ubicación compartida mientras esta sesión del CRM esté abierta.');
      },
      (locationError) => {
        setBusy(false);
        if (locationError.code === locationError.PERMISSION_DENIED) {
          sessionStorage.setItem(locationDeclinedKey(user.id), 'yes');
          window.dispatchEvent(new Event('wacrm-location-declined'));
          setMessage('No se autorizó la ubicación. Puedes seguir usando el CRM.');
        } else {
          setMessage('No se pudo obtener la ubicación. Puedes volver a intentarlo.');
        }
      },
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  };

  const disable = () => {
    if (!user) return;
    localStorage.removeItem(locationConsentKey(user.id));
    sessionStorage.setItem(locationDeclinedKey(user.id), 'yes');
    window.dispatchEvent(new Event('wacrm-location-disabled'));
    window.dispatchEvent(new Event('wacrm-location-declined'));
    setSharing(false);
    setMessage('Dejaste de compartir la ubicación. La última ubicación registrada conserva su fecha.');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MapPin className="size-4 text-primary" /> Ubicación de esta sesión</CardTitle>
        <CardDescription>
          El navegador pedirá tu permiso. Solo se registra la ubicación mientras esta pestaña está abierta; el CRM no puede localizar un equipo apagado o robado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button type="button" variant="outline" onClick={sharing ? disable : enable} disabled={busy}>
          {sharing ? 'Dejar de compartir ubicación' : busy ? 'Esperando permiso…' : 'Compartir ubicación en esta sesión'}
        </Button>
        {message && <p className="text-sm text-muted-foreground" role="status">{message}</p>}
      </CardContent>
    </Card>
  );
}

export function SessionAuditCard() {
  const { isOwner } = useAuth();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [members, setMembers] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    if (!isOwner) return;
    setLoading(true);
    try {
      const [sessionResponse, memberResponse] = await Promise.all([
        fetch('/api/account/security/sessions', { cache: 'no-store' }),
        fetch('/api/account/members', { cache: 'no-store' }),
      ]);
      if (!sessionResponse.ok || !memberResponse.ok) throw new Error('No se pudo cargar la actividad');
      const sessionPayload = await sessionResponse.json();
      const memberPayload = await memberResponse.json();
      setSessions(sessionPayload.sessions ?? []);
      setMembers(Object.fromEntries((memberPayload.members ?? []).map((member: { user_id: string; full_name: string; email: string | null }) =>
        [member.user_id, member.full_name || member.email || member.user_id])));
      setNow(Date.now());
      setError('');
    } catch {
      setError('No se pudo consultar el registro de sesiones.');
    } finally {
      setLoading(false);
    }
  }, [isOwner]);

  useEffect(() => {
    if (!isOwner) return;
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [isOwner, load]);

  if (!isOwner) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Accesos del equipo</CardTitle>
            <CardDescription>Solo el CEO ve este registro. «Activo» significa que el CRM informó actividad durante los últimos 75 segundos.</CardDescription>
          </div>
          <Button type="button" variant="outline" size="icon" onClick={() => void load()} disabled={loading} aria-label="Actualizar sesiones">
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {!error && sessions.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay accesos registrados desde esta versión.</p>}
        {sessions.map((session) => {
          const active = now - new Date(session.last_seen_at).getTime() < 75_000;
          return (
            <div key={session.session_id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-foreground">{members[session.user_id] ?? 'Cuenta del equipo'}</strong>
                <span className={active ? 'text-emerald-600' : 'text-muted-foreground'}>{active ? 'CRM activo' : 'Sin actividad reciente'}</span>
              </div>
              <p className="mt-1 text-muted-foreground" title={session.user_agent ?? undefined}>{deviceLabel(session.user_agent)}</p>
              <p>Primer acceso registrado: {dateTime(session.first_seen_at)}</p>
              <p>Última actividad: {dateTime(session.last_seen_at)}</p>
              <p>IP informada por la conexión: {session.reported_ip ?? 'No disponible'}</p>
              {session.location_seen_at && session.latitude !== null && session.longitude !== null ? (
                <p>Última ubicación compartida: {session.latitude.toFixed(5)}, {session.longitude.toFixed(5)}
                  {session.accuracy_m !== null ? ` (precisión estimada ±${Math.round(session.accuracy_m)} m)` : ''}
                  {' · '}{dateTime(session.location_seen_at)}
                  {' · '}<a
                    href={`https://www.google.com/maps?q=${encodeURIComponent(`${session.latitude},${session.longitude}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline underline-offset-2"
                  >Ver última ubicación en Google Maps</a>
                </p>
              ) : <p className={session.location_declined_at ? 'text-amber-600' : undefined}>Ubicación precisa: {session.location_declined_at ? 'rechazada; el CEO fue avisado' : 'aún no compartida'}</p>}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
