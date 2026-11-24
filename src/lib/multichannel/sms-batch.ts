import {z} from 'zod';
import {smsLineKey} from './sms-protocol';
export const smsBatchSchema=z.object({action:z.literal('enqueue_batch'),request_id:z.string().uuid(),line_key:smsLineKey,purpose:z.enum(['notice','support']),body:z.string().trim().min(1).max(4000),contact_ids:z.array(z.string().uuid()).min(1).max(500),run_at:z.string().datetime({offset:true}),expires_at:z.string().datetime({offset:true}),interval_seconds:z.number().int().min(1).max(86400),block_size:z.number().int().min(1).max(500),block_pause_seconds:z.number().int().min(0).max(604800)}).strict().superRefine((value,ctx)=>{
 if(new Set(value.contact_ids).size!==value.contact_ids.length)ctx.addIssue({code:'custom',message:'Hay contactos repetidos.'});
 const last=value.contact_ids.length-1;
 if(Date.parse(value.run_at)+(last*value.interval_seconds+Math.floor(last/value.block_size)*value.block_pause_seconds)*1000>=Date.parse(value.expires_at))ctx.addIssue({code:'custom',message:'El último SMS queda fuera del horario permitido.'});
});
export function smsBatchPreview(value:unknown){const plan=smsBatchSchema.parse(value);return{plan,jobs:plan.contact_ids.map((contact_id,index)=>({contact_id,run_at:new Date(Date.parse(plan.run_at)+(index*plan.interval_seconds+Math.floor(index/plan.block_size)*plan.block_pause_seconds)*1000).toISOString()}))};}
