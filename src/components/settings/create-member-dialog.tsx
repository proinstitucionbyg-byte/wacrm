'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { MEMBER_PRESETS, type MemberPreset } from '@/lib/account/member-presets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
export function CreateMemberDialog({onClose,onCreated}:{onClose:()=>void;onCreated:()=>void}) {
  const {accountRole}=useAuth();
  const [name,setName]=useState(''),[nickname,setNickname]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState('');
  const [preset,setPreset]=useState<MemberPreset>('ventas');
  const [saving,setSaving]=useState(false);
  async function submit(e:React.FormEvent) {
    e.preventDefault();
    if(password!==confirmation){toast.error('Las claves no coinciden');return;}
    setSaving(true);
    try {
      const res=await fetch('/api/account/members/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,nickname,email,password,preset})});
      const body=await res.json();
      if(!res.ok){toast.error(body.error||'No se pudo crear la cuenta');return;}
      toast.success('Cuenta creada con los permisos del perfil seleccionado');onCreated();onClose();
    }catch{toast.error('No se pudo conectar con el servidor');}
    finally{setPassword('');setConfirmation('');setSaving(false);}
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!saving)onClose();}}><DialogContent>
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader><DialogTitle>CREAR ASESORA O MIEMBRO</DialogTitle><DialogDescription>Elige sus datos y accesos. El porcentaje de ventas se asigna despues en AREAS, CARGOS Y REPARTO.</DialogDescription></DialogHeader>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="new-member-name">NOMBRE</Label><Input id="new-member-name" value={name} onChange={e=>setName(e.target.value)} maxLength={120} required disabled={saving}/></div>
        <div className="space-y-1"><Label htmlFor="new-member-nickname">APODO PARA PRESENTARSE</Label><Input id="new-member-nickname" value={nickname} onChange={e=>setNickname(e.target.value)} maxLength={80} required disabled={saving}/></div>
      </div>
      <div className="space-y-1"><Label htmlFor="new-member-email">CORREO</Label><Input id="new-member-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} maxLength={254} required disabled={saving}/></div>
      <div className="space-y-1"><Label htmlFor="new-member-preset">PERFIL DE ACCESO</Label><select id="new-member-preset" value={preset} onChange={e=>setPreset(e.target.value as MemberPreset)} disabled={saving} className="w-full rounded border border-border bg-background p-2 text-sm">
        {Object.entries(MEMBER_PRESETS).filter(([key])=>key!=='administrador'||accountRole==='owner').map(([key,value])=><option key={key} value={key}>{value.label}</option>)}
      </select><p className="text-xs text-muted-foreground">Ventas y fidelizacion: atencion y matriculas. Coordinador: supervision y etiquetas. Administrador: acceso completo. Puedes ajustar los permisos despues.</p></div>
      <div className="space-y-1"><Label htmlFor="new-member-password">CLAVE INICIAL</Label><Input id="new-member-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} required disabled={saving}/></div>
      <div className="space-y-1"><Label htmlFor="new-member-confirm">REPETIR CLAVE</Label><Input id="new-member-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} required disabled={saving}/></div>
      <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>CANCELAR</Button><Button type="submit" disabled={saving}>{saving?'CREANDO...':'CREAR CUENTA'}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
