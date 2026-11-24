import { z } from 'zod';
import {campaignPhone} from './campaign-phone';
export function normalizeCampaignPhone(value:string):string|null {
  return campaignPhone(value)?.phone??null;
}

const route = z.discriminatedUnion('channel', [
  z.object({channel:z.literal('whatsapp_support'),line_key:z.string().regex(/^WA-[A-Za-z0-9_-]{1,60}$/)}).strict(),
  z.object({channel:z.literal('sms'),line_key:z.string().regex(/^SMS-[A-Za-z0-9_-]{1,60}$/)}).strict(),
]);
const campaignMediaSchema=z.object({
  kind:z.enum(['image','audio','video','document']),
  url:z.string().max(4096).refine(value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&(!u.port||u.port==='443')&&u.pathname.startsWith('/storage/v1/object/public/');}catch{return false;}},'Usa un archivo del almacenamiento autorizado.'),
  caption:z.string().max(4000).optional(),
  filename:z.string().min(1).max(200).refine(v=>!/[\\/\r\n\0]/.test(v)&&!['.','..'].includes(v)).optional(),
}).strict();
export const campaignSequenceSchema=z.array(z.object({body:z.string().trim().min(1).max(4000),media:campaignMediaSchema.optional(),delay_seconds:z.number().int().min(0).max(86400).default(0)}).strict()).min(1).max(20)
 .refine(steps=>steps[0].delay_seconds===0,'El primer paso no lleva espera.');
export const liveCampaignSchema=z.object({
  dispatch_mode:z.enum(['sequential','parallel']).default('sequential'),
  distribution:z.array(z.object({from:z.number().int().min(1).max(1000),to:z.number().int().min(1).max(1000),line_key:z.string().regex(/^WA-[A-Za-z0-9_-]{1,60}$/)}).strict()).min(1).max(100).optional(),
  request_id:z.string().uuid(),name:z.string().trim().min(1).max(100),
  purpose:z.enum(['notice','support']),body:z.string().trim().min(1).max(4000),
  sequence:campaignSequenceSchema.optional(),sms_body:z.string().trim().min(1).max(4000).optional(),
  routes:z.array(route).min(1).max(11),
  run_at:z.string().datetime({offset:true}),expires_at:z.string().datetime({offset:true}),
  interval_seconds:z.number().int().min(1).max(86400),
  block_size:z.number().int().min(1).max(1000),block_pause_seconds:z.number().int().min(0).max(604800),
  recipients:z.array(z.object({contact_id:z.string().uuid(),permission_expires_at:z.string().datetime({offset:true}),
    evidence:z.string().trim().min(5).max(1000)}).strict()).min(1).max(1000),
}).strict().superRefine((v,ctx)=>{
  if(v.dispatch_mode==='parallel'&&!v.distribution)ctx.addIssue({code:'custom',path:['distribution'],message:'Elige los rangos para enviar en paralelo.'});
  if(v.distribution){let next=1;for(const part of v.distribution){if(part.from!==next||part.to<part.from||part.to>v.recipients.length||!v.routes.some(r=>r.channel==='whatsapp_support'&&r.line_key===part.line_key))ctx.addIssue({code:'custom',path:['distribution'],message:'Los rangos deben cubrir toda la lista, sin repetir ni saltar posiciones y usando las líneas elegidas.'});next=part.to+1;}if(next!==v.recipients.length+1)ctx.addIssue({code:'custom',path:['distribution'],message:'Falta repartir parte de la lista.'});}
  if(v.sequence&&(v.sequence.length>1||v.sequence.some(s=>s.media))&&v.routes.some(r=>r.channel==='sms')&&!v.sms_body)
    ctx.addIssue({code:'custom',path:['sms_body'],message:'Escribe el texto que se enviará si se necesita el respaldo SMS.'});
  if(v.routes[0].channel!=='whatsapp_support')ctx.addIssue({code:'custom',path:['routes'],message:'Esta campaña requiere WhatsApp como primer canal; programa SMS directo en su transporte.'});
  if(new Set(v.routes.map(r=>r.line_key)).size!==v.routes.length)ctx.addIssue({code:'custom',path:['routes'],message:'Hay líneas repetidas.'});
  if(v.routes.filter(r=>r.channel==='whatsapp_support').length>10||v.routes.some((r,i)=>r.channel==='sms'&&i!==v.routes.length-1))
    ctx.addIssue({code:'custom',path:['routes'],message:'Usa hasta diez WhatsApp y SMS solo como último respaldo.'});
  if(new Set(v.recipients.map(r=>r.contact_id)).size!==v.recipients.length)ctx.addIssue({code:'custom',path:['recipients'],message:'Hay contactos repetidos.'});
  const sequenceWait=(v.sequence??[]).slice(1).reduce((sum,s)=>sum+Math.max(s.delay_seconds,v.interval_seconds),0);
  const laneCounts=new Map<string,number>();let lastOffset=0;
  v.recipients.forEach((_,index)=>{const key=v.distribution?.find(p=>p.from<=index+1&&p.to>=index+1)?.line_key??v.routes[0]?.line_key??'';const lane=laneCounts.get(key)??0;laneCounts.set(key,lane+1);const position=v.dispatch_mode==='parallel'?lane:index;lastOffset=Math.max(lastOffset,position*(v.interval_seconds+sequenceWait)+Math.floor(position/v.block_size)*v.block_pause_seconds+sequenceWait);});
  const last=Date.parse(v.run_at)+lastOffset*1000;
  if(last>=Date.parse(v.expires_at))ctx.addIssue({code:'custom',path:['expires_at'],message:'El último destinatario queda fuera del horario permitido.'});
  if(v.recipients.some(r=>Date.parse(r.permission_expires_at)<=Date.parse(v.expires_at)))
    ctx.addIssue({code:'custom',path:['recipients'],message:'Los permisos deben cubrir toda la campaña.'});
});
export type LiveCampaignInput=z.infer<typeof liveCampaignSchema>;
export function assertCampaignMediaOwnership(plan:Pick<LiveCampaignInput,'sequence'>,accountId:string,storageOrigin:string){
  for(const step of plan.sequence??[]){
    if(!step.media)continue;
    const media=new URL(step.media.url),origin=new URL(storageOrigin).origin;
    if(media.origin!==origin||!['flow-media','chat-media'].some(bucket=>media.pathname.startsWith(`/storage/v1/object/public/${bucket}/account-${accountId}/`)))
      throw Error('El archivo de campaña no pertenece al almacenamiento de esta cuenta.');
  }
}
export function liveCampaignSchedule(value:unknown,now=Date.now()) {
  const plan=liveCampaignSchema.parse(value);
  if(Date.parse(plan.expires_at)<=now)throw Error('La campaña ya venció.');
  const sequenceWait=(plan.sequence??[]).slice(1).reduce((sum,s)=>sum+Math.max(s.delay_seconds,plan.interval_seconds),0);
  const lanes=new Map<string,number>();
  return {plan,jobs:plan.recipients.map((recipient,index)=>{const line=plan.distribution?.find(p=>p.from<=index+1&&p.to>=index+1)?.line_key??plan.routes[0].line_key;const lane=lanes.get(line)??0;lanes.set(line,lane+1);const position=plan.dispatch_mode==='parallel'?lane:index;return {...recipient,line_key:line,
    run_at:new Date(Date.parse(plan.run_at)+(position*(plan.interval_seconds+sequenceWait)+Math.floor(position/plan.block_size)*plan.block_pause_seconds)*1000).toISOString(),
  };})};
}
export const liveCampaignActionSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('create'),campaign:liveCampaignSchema}).strict(),
  z.object({action:z.literal('activate'),campaign_id:z.string().uuid(),review_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  z.object({action:z.literal('pause'),campaign_id:z.string().uuid(),value:z.boolean()}).strict(),
  z.object({action:z.literal('cancel'),campaign_id:z.string().uuid()}).strict(),
]);
