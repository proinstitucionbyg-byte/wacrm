'use client';
import {useCallback,useEffect,useState} from 'react';
import {Plus,X} from 'lucide-react';
import {createClient} from '@/lib/supabase/client';
import {useCan} from '@/hooks/use-can';
import type {Tag} from '@/types';
import {GroupedTags} from './grouped-tags';
import {toast} from 'sonner';

export function ContactTagsEditor({contactId,conversationId,accountId}:{contactId:string;conversationId?:string;accountId:string|null}){
 const canTag=useCan('inbox.tag'),canManage=useCan('tags.manage');
 const [catalog,setCatalog]=useState<Tag[]>([]),[selected,setSelected]=useState<string[]>([]),[open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{if(!accountId)return;const db=createClient();const [a,b]=await Promise.all([db.from('tags').select('*').eq('account_id',accountId).order('name'),db.from('contact_tags').select('tag_id').eq('contact_id',contactId)]);if(a.error||b.error){toast.error('No se pudieron cargar las etiquetas.');return;}setCatalog(a.data??[]);setSelected((b.data??[]).map(t=>t.tag_id));},[accountId,contactId]);
 useEffect(()=>{void load();const update=()=>void load();window.addEventListener('wacrm:labels-updated',update);return()=>window.removeEventListener('wacrm:labels-updated',update);},[load]);
 async function change(tag:Tag,remove:boolean){if(!conversationId||busy)return;setBusy(true);try{const response=await fetch('/api/inbox/labels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversations:[conversationId],tag:tag.id,remove})});const body=await response.json();if(!response.ok)throw Error(body.error||'No se pudo cambiar la etiqueta.');await load();window.dispatchEvent(new Event('wacrm:labels-updated'));toast.success(remove?'Etiqueta retirada':'Etiqueta agregada');}catch(e){toast.error(e instanceof Error?e.message:'No se pudo cambiar la etiqueta.');}finally{setBusy(false);}}
 const editable=(tag:Tag)=>canTag&&!!conversationId&&(canManage||!tag.kind||tag.kind==='process');
 return <div className="space-y-2" aria-label="Etiquetas del contacto"><div className="flex flex-wrap gap-1">{catalog.filter(t=>selected.includes(t.id)).map(t=><span key={t.id} title={t.name} className="inline-flex h-5 w-20 items-center gap-1 rounded-full px-1.5 text-[9px]" style={{color:t.color,backgroundColor:t.color+'20'}}><span className="min-w-0 flex-1 truncate">{t.name}</span>{editable(t)&&<button type="button" disabled={busy} title={'Quitar '+t.name} aria-label={'Quitar '+t.name} onClick={()=>void change(t,true)} className="shrink-0 disabled:opacity-40"><X className="size-3"/></button>}</span>)}{!selected.length&&<p className="text-xs text-muted-foreground">Sin etiquetas</p>}</div>{canTag&&conversationId&&<button type="button" aria-expanded={open} onClick={()=>setOpen(!open)} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs"><Plus className="size-3"/>{open?'Cerrar etiquetas':'Agregar o quitar'}</button>}{open&&<GroupedTags tags={catalog.filter(t=>editable(t))} selectedIds={selected} renderTag={t=><label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs"><input type="checkbox" disabled={busy} checked={selected.includes(t.id)} onChange={e=>void change(t,!e.target.checked)}/><span style={{color:t.color}}>{t.name}</span></label>}/>}</div>;
}
