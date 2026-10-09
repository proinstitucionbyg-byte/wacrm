'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePresence } from '@/hooks/use-presence';
import { type TeamMember } from '@/lib/team-chat';
export function TeamMemberProfile({ member }: { member: TeamMember }) {
  const [open, setOpen] = useState(false);
  const { getPresence, getRow } = usePresence();
  const online = getPresence(member.user_id) === 'online';
  const lastSeen = getRow(member.user_id)?.last_seen_at;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hover:bg-muted inline-flex items-center gap-2 rounded px-2 py-1 text-sm"
      >
        <span
          aria-label={online ? 'Conectada' : 'Desconectada'}
          className={`size-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`}
        />
        {member.nickname || member.full_name || 'MIEMBRO DEL EQUIPO'}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>FICHA DEL EQUIPO</DialogTitle>
          </DialogHeader>
          <dl className="grid grid-cols-[8rem_1fr] gap-3 text-sm">
            <dt>NOMBRE</dt>
            <dd>{member.full_name || 'SIN REGISTRAR'}</dd>
            <dt>APODO</dt>
            <dd>{member.nickname || 'SIN REGISTRAR'}</dd>
            <dt>AREA</dt>
            <dd>{member.area || 'SIN ASIGNAR'}</dd>
            <dt>CARGO</dt>
            <dd>{member.cargo || member.account_role}</dd>
            <dt>CUMPLEAÑOS</dt>
            <dd>
              {member.birth_date
                ? member.birth_date.split('-').reverse().join('/')
                : 'SIN REGISTRAR'}
            </dd>
            <dt>CONEXION</dt>
            <dd>
              {online ? 'CONECTADA' : 'DESCONECTADA'}
              {!online && lastSeen && (
                <span className="text-muted-foreground block">
                  Última conexión:{' '}
                  {new Date(lastSeen).toLocaleString('es-PE', {
                    timeZone: 'America/Lima',
                  })}
                </span>
              )}
            </dd>
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
