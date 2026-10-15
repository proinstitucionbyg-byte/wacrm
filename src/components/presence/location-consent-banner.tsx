'use client';

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { locationConsentKey, locationDeclinedKey } from '@/lib/presence/location-consent';

/** Explicit browser consent while the CRM is open; declining never blocks work. */
export function LocationConsentBanner() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    setVisible(localStorage.getItem(locationConsentKey(user.id)) !== 'yes' &&
      sessionStorage.getItem(locationDeclinedKey(user.id)) !== 'yes');
  }, [user]);

  if (!visible) return null;

  const decline = () => {
    if (!user) return;
    sessionStorage.setItem(locationDeclinedKey(user.id), 'yes');
    window.dispatchEvent(new Event('wacrm-location-declined'));
    setVisible(false);
  };

  const enable = () => {
    if (!user) return;
    if (!navigator.geolocation) {
      setError('Este navegador no permite compartir ubicación.');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      () => {
        localStorage.setItem(locationConsentKey(user.id), 'yes');
        sessionStorage.removeItem(locationDeclinedKey(user.id));
        window.dispatchEvent(new Event('wacrm-location-enabled'));
        setBusy(false);
        setVisible(false);
      },
      (locationError) => {
        setBusy(false);
        if (locationError.code === locationError.PERMISSION_DENIED) {
          sessionStorage.setItem(locationDeclinedKey(user.id), 'yes');
          window.dispatchEvent(new Event('wacrm-location-declined'));
          setVisible(false);
        } else {
          setError('No se pudo obtener la ubicación. Puedes volver a intentarlo.');
        }
      },
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted px-3 py-2 text-xs sm:text-sm">
      <MapPin className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">Comparte tu ubicación mientras usas el CRM para registrar desde dónde está activa esta sesión.</span>
      <Button type="button" size="sm" onClick={enable} disabled={busy}>{busy ? 'Esperando permiso…' : 'Compartir ubicación'}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={decline} disabled={busy}>Ahora no</Button>
      {error && <span className="w-full text-destructive">{error}</span>}
    </div>
  );
}
