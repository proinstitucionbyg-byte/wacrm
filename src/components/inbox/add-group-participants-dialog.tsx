'use client';
import {useState} from 'react';
import {UserPlus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {groupParticipantPhones} from './group-management-actions';
export function AddGroupParticipantsDialog({groupName,disabled,onAdd}:{groupName:string;disabled:boolean;onAdd:(phones:string[])=>void}){
 const [open,setOpen]=useState(false),[phones,setPhones]=useState(''),[review,setReview]=useState<string[]>([]),[error,setError]=useState('');
 function close(value:boolean){setOpen(value);if(!value){setReview([]);setPhones('');setError('');}}
 return <><Button type="button" size="sm" variant="outline" disabled={disabled} onClick={()=>setOpen(true)}><UserPlus className="size-4"/>Agregar integrantes</Button>
 <Dialog open={open} onOpenChange={close}><DialogContent className="max-h-[88dvh] overflow-y-auto p-4 sm:max-w-md"><DialogHeader className="pr-6"><DialogTitle>Agregar integrantes</DialogTitle><DialogDescription>Grupo: {groupName}. Revisa los teléfonos antes de confirmar.</DialogDescription></DialogHeader>
 <label className="block space-y-2 text-sm"><span>Teléfonos · uno por línea</span><textarea aria-label="Teléfonos de nuevos integrantes" className="w-full rounded-lg border bg-background p-3 text-base" rows={4} maxLength={3000} disabled={disabled} value={phones} onChange={e=>{setPhones(e.target.value);setReview([]);setError('');}}/></label>
 <p className="text-xs text-muted-foreground">Hasta 50 números. Perú admite 9 dígitos; para otros países incluye el prefijo. Los repetidos se excluyen.</p>
 {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
 {!review.length?<Button type="button" disabled={disabled||!phones.trim()} onClick={()=>{try{setReview(groupParticipantPhones(phones));setError('');}catch(e){setError(e instanceof Error?e.message:'Revisa los teléfonos.');}}}>Revisar teléfonos</Button>:<section className="space-y-3 rounded-lg border p-3"><p className="text-sm font-semibold">Confirmar {review.length} {review.length===1?'integrante':'integrantes'}</p><ul className="max-h-36 overflow-y-auto text-sm">{review.map(id=><li key={id}>+{id.replace('@c.us','')}</li>)}</ul><p className="text-xs text-muted-foreground">WhatsApp puede impedir una incorporación por privacidad u otras restricciones. Verás el resultado de cada número; no se enviarán invitaciones privadas automáticamente.</p><Button type="button" className="w-full" disabled={disabled} onClick={()=>{onAdd(review);close(false);}}>Confirmar y agregar</Button></section>}
 </DialogContent></Dialog></>;
}
