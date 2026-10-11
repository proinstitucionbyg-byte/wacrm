'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export function MemberPasswordDialog({ member, onClose }: {
  member: { user_id: string; full_name: string; email: string | null };
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirmation) { toast.error('Las claves no coinciden'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/account/members/${member.user_id}/password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
      });
      const body = await res.json();
      if (!res.ok) { toast.error(body.error || 'No se pudo restablecer la clave'); return; }
      toast.success('Clave restablecida');
      onClose();
    } catch { toast.error('No se pudo conectar con el servidor'); }
    finally { setPassword(''); setConfirmation(''); setSaving(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent>
      <form onSubmit={submit} className="space-y-4">
        <DialogHeader>
          <DialogTitle>RESTABLECER CLAVE</DialogTitle>
          <DialogDescription>Define una nueva clave para {member.full_name || member.email}. La clave anterior dejara de funcionar para iniciar sesion.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2"><Label htmlFor="member-password">NUEVA CLAVE</Label>
          <Input id="member-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={(e) => setPassword(e.target.value)} disabled={saving} />
          <p className="text-xs text-muted-foreground">Entre 12 y 128 caracteres.</p></div>
        <div className="space-y-2"><Label htmlFor="member-password-confirm">REPETIR NUEVA CLAVE</Label>
          <Input id="member-password-confirm" type="password" autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={saving} /></div>
        <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>CANCELAR</Button>
          <Button type="submit" disabled={saving}>{saving ? 'GUARDANDO...' : 'RESTABLECER CLAVE'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
