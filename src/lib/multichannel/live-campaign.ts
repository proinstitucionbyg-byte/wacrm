import { z } from 'zod';
import {campaignPhone} from './campaign-phone';
export function normalizeCampaignPhone(value:string):string|null {
  return campaignPhone(value)?.phone??null;
}

const route = z.discriminatedUnion('channel', [
  z.object({channel:z.literal('whatsapp_support'),line_key:z.string().regex(/^WA-[A-Za-z0-9_-]{1,60}$/)}).strict(),
  z.object({channel:z.literal('sms'),line_key:z.string().regex(/^SMS-[A-Za-z0-9_-]{1,60}$/)}).strict(),
]);
export const liveCampaignSchema=z.object({
  request_id:z.string().uuid(),name:z.string().trim().min(1).max(100),
  purpose:z.enum(['notice','support']),body:z.string().trim().min(1).max(4000),
  routes:z.array(route).min(1).max(11),
  run_at:z.string().datetime({offset:true}),expires_at:z.string().datetime({offset:true}),
  interval_seconds:z.number().int().min(1).max(86400),
  block_size:z.number().int().min(1).max(1000),block_pause_seconds:z.number().int().min(0).max(604800),
  recipients:z.array(z.object({contact_id:z.string().uuid(),permission_expires_at:z.string().datetime({offset:true}),
    evidence:z.string().trim().min(5).max(1000)}).strict()).min(1).max(1000),
}).strict().superRefine((v,ctx)=>{
  if(v.routes[0].channel!=='whatsapp_support')ctx.addIssue({code:'custom',path:['routes'],message:'Esta campaña requiere WhatsApp como primer canal; programa SMS directo en su transporte.'});
  if(new Set(v.routes.map(r=>r.line_key)).size!==v.routes.length)ctx.addIssue({code:'custom',path:['routes'],message:'Hay líneas repetidas.'});
  if(v.routes.filter(r=>r.channel==='whatsapp_support').length>10||v.routes.some((r,i)=>r.channel==='sms'&&i!==v.routes.length-1))
    ctx.addIssue({code:'custom',path:['routes'],message:'Usa hasta diez WhatsApp y SMS solo como último respaldo.'});
  if(new Set(v.recipients.map(r=>r.contact_id)).size!==v.recipients.length)ctx.addIssue({code:'custom',path:['recipients'],message:'Hay contactos repetidos.'});
  const last=Date.parse(v.run_at)+((v.recipients.length-1)*v.interval_seconds+Math.floor((v.recipients.length-1)/v.block_size)*v.block_pause_seconds)*1000;
  if(last>=Date.parse(v.expires_at))ctx.addIssue({code:'custom',path:['expires_at'],message:'El último destinatario queda fuera del horario permitido.'});
  if(v.recipients.some(r=>Date.parse(r.permission_expires_at)<=Date.parse(v.expires_at)))
    ctx.addIssue({code:'custom',path:['recipients'],message:'Los permisos deben cubrir toda la campaña.'});
});
export type LiveCampaignInput=z.infer<typeof liveCampaignSchema>;
export function liveCampaignSchedule(value:unknown,now=Date.now()) {
  const plan=liveCampaignSchema.parse(value);
  if(Date.parse(plan.expires_at)<=now)throw Error('La campaña ya venció.');
  return {plan,jobs:plan.recipients.map((recipient,index)=>({...recipient,
    run_at:new Date(Date.parse(plan.run_at)+(index*plan.interval_seconds+Math.floor(index/plan.block_size)*plan.block_pause_seconds)*1000).toISOString(),
  }))};
}
export const liveCampaignActionSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('create'),campaign:liveCampaignSchema}).strict(),
  z.object({action:z.literal('activate'),campaign_id:z.string().uuid(),review_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
  z.object({action:z.literal('pause'),campaign_id:z.string().uuid(),value:z.boolean()}).strict(),
  z.object({action:z.literal('cancel'),campaign_id:z.string().uuid()}).strict(),
]);
