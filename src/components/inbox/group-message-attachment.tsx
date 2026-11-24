'use client';
import {useState} from 'react';
import {uploadAccountMedia,MEDIA_MAX_BYTES_BY_KIND} from '@/lib/storage/upload-media';
type Media={kind:'image'|'audio'|'video'|'document';url:string;filename:string;caption?:string};
export function GroupMessageAttachment({disabled,onBusy,onError,onSend}:{disabled:boolean;onBusy:(busy:boolean)=>void;onError:(message:string)=>void;onSend:(media:Media)=>void}){
 const [media,setMedia]=useState<Media|null>(null),[caption,setCaption]=useState(''),[uploading,setUploading]=useState(false);
 const locked=disabled||uploading;
 async function select(file:File){
  const mime=file.type.toLowerCase().split(';')[0];
  const kind:Media['kind']|null=/^image\/(jpeg|png|webp|gif)$/.test(mime)?'image':/^(audio\/(mpeg|ogg|mp4|aac|wav|webm|opus)|application\/ogg)$/.test(mime)?'audio':/^video\/(mp4|webm|3gpp)$/.test(mime)?'video':/^(application\/(pdf|msword|vnd\.[a-z0-9.+-]+)|text\/plain)$/.test(mime)?'document':null;
  if(!kind||!file.size||file.size>MEDIA_MAX_BYTES_BY_KIND[kind]){onError('Elige una imagen de hasta 5 MB, o un audio, video o documento de hasta 16 MB en formato compatible.');return;}
  setUploading(true);onBusy(true);onError('');setMedia(null);
  try{const result=await uploadAccountMedia('flow-media',file);setMedia({kind,url:result.publicUrl,filename:file.name.replace(/[\\/\r\n\0]/g,'_').slice(0,200)||'archivo'});setCaption('');}
  catch(error){onError(error instanceof Error?error.message:'No se pudo subir el archivo.');}
  finally{setUploading(false);onBusy(false);}
 }
 return <details className="shrink-0 border-t px-3 py-2"><summary className="cursor-pointer text-xs font-semibold">Adjuntar imagen, audio, video o documento</summary><div className="space-y-2 py-2">
 <input aria-label="Archivo para el grupo" type="file" disabled={locked} accept="image/jpeg,image/png,image/webp,image/gif,audio/*,video/mp4,video/webm,video/3gpp,application/ogg,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void select(file);}} className="block max-w-full text-xs"/>
 {uploading&&<p className="text-xs">Subiendo archivo…</p>}
 {media&&<><p className="break-all text-xs">{media.filename}</p>{media.kind==='image'?<img src={media.url} alt="Vista previa del archivo para el grupo" className="max-h-32 max-w-full rounded"/>:media.kind==='audio'?<audio controls src={media.url} className="max-w-full"/>:media.kind==='video'?<video controls src={media.url} className="max-h-40 max-w-full"/>:<a href={media.url} target="_blank" rel="noreferrer" className="text-xs underline">Ver documento</a>}
 {media.kind!=='audio'?<textarea aria-label="Texto del archivo para el grupo" placeholder="Texto opcional del archivo" maxLength={4000} value={caption} onChange={e=>setCaption(e.target.value)} disabled={locked} rows={2} className="w-full rounded border bg-background p-2 text-sm"/>:<p className="text-xs text-muted-foreground">El audio se envía como archivo original. Envía el texto por separado.</p>}
 <div className="flex gap-2"><button type="button" disabled={locked} className="rounded border px-3 py-2 text-xs disabled:opacity-40" onClick={()=>onSend({...media,...(caption?{caption}:{})})}>Enviar archivo al grupo</button><button type="button" disabled={locked} className="text-xs underline" onClick={()=>{setMedia(null);setCaption('');}}>Quitar selección</button></div></>}
 </div></details>;
}
