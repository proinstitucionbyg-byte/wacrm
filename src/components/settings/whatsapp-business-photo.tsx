'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

type PublicPhoto = { phone: string; photoUrl: string | null };

export function WhatsAppBusinessPhoto() {
  const [profile, setProfile] = useState<PublicPhoto | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch('/api/whatsapp/business-profile', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setProfile(body); setMessage('Foto consultada directamente en Meta.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo consultar Meta.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function publish() {
    if (!photo || !profile?.phone) return;
    setBusy(true); setMessage('Publicando la foto en WhatsApp API…');
    try {
      const form = new FormData(); form.set('photo', photo); form.set('phone', profile.phone);
      const response = await fetch('/api/whatsapp/business-profile', { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setProfile(body); setPhoto(null);
      setMessage(body.readback ? 'Meta confirmó la publicación. WhatsApp puede tardar en renovar la imagen en otros teléfonos.' : 'Meta aceptó la foto; falta volver a consultar la imagen publicada.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo publicar.'); }
    finally { setBusy(false); }
  }
  return <Card id="foto-publica-whatsapp-api" className="mb-6">
    <CardHeader><CardTitle>Foto pública de WhatsApp API</CardTitle>
      <CardDescription>La imagen que ven los estudiantes en el número principal conectado a Meta.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <p className="font-semibold">{profile?.phone || 'Consultando el número de WhatsApp API…'}</p>
      {profile?.photoUrl && <img src={profile.photoUrl} alt="Foto pública devuelta por Meta" className="size-24 rounded-full object-cover" />}
      <label className="block text-sm" htmlFor="whatsapp-public-photo">Seleccionar nueva foto · PNG o JPG, hasta 5 MB</label>
      <Input id="whatsapp-public-photo" type="file" accept="image/png,image/jpeg" disabled={busy} onChange={event => setPhoto(event.target.files?.[0] ?? null)} />
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || !photo || !profile?.phone} onClick={publish}>Publicar foto en WhatsApp API</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={refresh}>Consultar foto publicada</Button></div>
      <p role="status" className="text-sm text-muted-foreground">{message}</p>
    </CardContent>
  </Card>;
}
