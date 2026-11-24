'use client';
import {MessageSquare,Plus,Trash2,ArrowUp,ArrowDown} from 'lucide-react';

import {uploadAccountMedia,MEDIA_MAX_BYTES_BY_KIND} from '@/lib/storage/upload-media';

export type CampaignStepDraft={id:string;kind:'text'|'image'|'audio'|'video'|'document';body:string;url?:string;filename?:string;delay_seconds:number};
export const newCampaignStep=():CampaignStepDraft=>({id:crypto.randomUUID(),kind:'text',body:'',delay_seconds:0});
const input='w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
const button='rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40';
const labels={text:'Texto',image:'Imagen',audio:'Audio',video:'Video',document:'Documento'};
const accepted={image:'image/jpeg,image/png,image/webp,image/gif',audio:'audio/ogg,audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/webm,audio/opus',video:'video/mp4,video/webm,video/3gpp',document:'application/pdf,text/plain'};

export function campaignSequencePayload(steps:CampaignStepDraft[]){
 if(steps.some(s=>s.kind!=='text'&&!s.url))throw Error('Carga el archivo de cada paso antes de guardar.');
 return steps.map((s,i)=>({body:s.body.trim()||(s.kind!=='text'?`${labels[s.kind]}: ${s.filename||'Archivo'}`:''),delay_seconds:i===0?0:s.delay_seconds,
  ...(s.kind==='text'?{}:{media:{kind:s.kind,url:s.url!,...(s.kind!=='audio'&&s.body.trim()?{caption:s.body.trim()}:{}),...(s.filename?{filename:s.filename}:{})}})}));
}

export function CampaignSequenceEditor({steps,onChange,busy,onBusy,onError,contentOnly=false}:{steps:CampaignStepDraft[];onChange:(steps:CampaignStepDraft[])=>void;busy:boolean;onBusy:(value:boolean)=>void;onError:(message:string)=>void;contentOnly?:boolean}){
 function update(id:string,patch:Partial<CampaignStepDraft>){onChange(steps.map(s=>s.id===id?{...s,...patch}:s));}
 function move(index:number,direction:number){const result=[...steps];[result[index],result[index+direction]]=[result[index+direction],result[index]];result[0]={...result[0],delay_seconds:0};onChange(result);}
 async function upload(step:CampaignStepDraft,file:File){
  if(step.kind==='text')return;
  if(!accepted[step.kind].split(',').includes(file.type)){onError('El archivo no corresponde al tipo elegido. Usa uno de los formatos indicados.');return;}
  if(!file.size||file.size>MEDIA_MAX_BYTES_BY_KIND[step.kind]){onError(`El archivo debe pesar entre 1 byte y ${MEDIA_MAX_BYTES_BY_KIND[step.kind]/1024/1024} MB.`);return;}
  onBusy(true);onError('');try{const result=await uploadAccountMedia('flow-media',file);update(step.id,{url:result.publicUrl,filename:file.name});}
  catch(error){onError(error instanceof Error?error.message:'No se pudo cargar el archivo.');}finally{onBusy(false);}
 }
 return <div className="space-y-3" aria-label="Secuencia de mensajes">
  <p className="text-xs text-muted-foreground">Cada destinatario recibe estos pasos en orden, por el mismo WhatsApp. Si un envío queda sin confirmar, los siguientes se detienen para revisión.</p>
  {steps.map((step,index)=><fieldset key={step.id} disabled={busy} className="crm-sequence-step space-y-2 rounded-lg border p-3">
   <legend className="px-1 text-sm font-medium"><MessageSquare className="mr-1 inline size-4"/>Paso {index+1} · {labels[step.kind]}</legend>
   {!contentOnly&&<div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={index===0} aria-label={`Subir paso ${index+1}`} onClick={()=>move(index,-1)}><ArrowUp className="size-4"/></button><button type="button" className={button} disabled={index===steps.length-1} aria-label={`Bajar paso ${index+1}`} onClick={()=>move(index,1)}><ArrowDown className="size-4"/></button><button type="button" className={button} disabled={steps.length===1} onClick={()=>onChange(steps.filter(s=>s.id!==step.id).map((s,i)=>i===0?{...s,delay_seconds:0}:s))}><Trash2 className="mr-1 inline size-3.5"/>Quitar paso</button></div>}
   <label className="block text-sm">Tipo de mensaje<select className={input} value={step.kind} onChange={e=>update(step.id,{kind:e.target.value as CampaignStepDraft['kind'],url:undefined,filename:undefined})}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   {step.kind!=='text'&&<><label className="block text-sm">Cargar {labels[step.kind].toLowerCase()}<input className={input} type="file" accept={accepted[step.kind]} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void upload(step,file);}}/></label>{step.url&&<p className="break-all text-xs">Archivo cargado: {step.filename} · <a className="underline" href={step.url} target="_blank" rel="noreferrer">Revisar archivo</a></p>}</>}
   <label className="block text-sm">{step.kind==='text'?'Texto del mensaje':step.kind==='audio'?'Descripción del audio (opcional, no se envía como otro texto)':'Texto que acompaña el archivo (opcional)'}<textarea className={input} rows={3} maxLength={4000} value={step.body} onChange={e=>update(step.id,{body:e.target.value})}/></label>
   {index>0&&<label className="block text-sm">Segundos de espera después del paso anterior<input className={input} disabled={contentOnly} type="number" min={0} max={86400} value={step.delay_seconds} onChange={e=>update(step.id,{delay_seconds:Number(e.target.value)})}/></label>}
  </fieldset>)}
  {!contentOnly&&<button type="button" className={button} disabled={busy||steps.length>=20} onClick={()=>onChange([...steps,newCampaignStep()])}><Plus className="mr-1 inline size-4"/>Añadir mensaje o archivo</button>}<p className="text-xs text-muted-foreground">Hasta 20 pasos. Imagen: 5 MB. Audio, video y documento: 16 MB.</p>
 </div>;
}
