import type {SupabaseClient} from '@supabase/supabase-js';
import {campaignPhone} from './campaign-phone';

export async function resolveCampaignAudience(db:SupabaseClient,accountId:string,phones:string[]){
 const found=new Map<string,{id:string;name:string|null;phone:string;phone_normalized:string}>();
 for(let offset=0;offset<phones.length;offset+=200){
  const variants=phones.slice(offset,offset+200).flatMap(phone=>[phone,phone.slice(1),...(phone.startsWith('+519')&&phone.length===12?[phone.slice(3)]:[])]);
  const [normalized,legacy]=await Promise.all([
   db.from('contacts').select('id,name,phone,phone_normalized').eq('account_id',accountId).in('phone_normalized',variants).limit(1000),
   db.from('contacts').select('id,name,phone,phone_normalized').eq('account_id',accountId).in('phone',variants).limit(1000),
  ]);
  if(normalized.error||legacy.error)throw Error('No se pudo comprobar la lista de contactos.');
  for(const row of [...normalized.data??[],...legacy.data??[]])found.set(row.id,row);
 }
 return phones.map(phone=>{
  const parsed=campaignPhone(phone),matches=[...found.values()].filter(row=>campaignPhone(row.phone_normalized||row.phone)?.phone===phone);
  return {phone,country:parsed?.country??null,status:matches.length===1?'ready':matches.length?'ambiguous':'not_found',...(matches.length===1?{contact_id:matches[0].id,name:matches[0].name}:{})};
 });
}

export async function importCampaignContacts(db:SupabaseClient,accountId:string,userId:string,rows:{phone:string;name?:string}[]){
 const normalized=rows.map(row=>({...row,phone:campaignPhone(row.phone)?.phone}));
 if(normalized.some(row=>!row.phone)||new Set(normalized.map(row=>row.phone)).size!==rows.length)throw Error('Revisa teléfonos inválidos o repetidos.');
 const phones=normalized.map(row=>row.phone as string),existing=await resolveCampaignAudience(db,accountId,phones);
 if(existing.some(row=>row.status==='ambiguous'))throw Error('Hay contactos ambiguos. Revísalos antes de importar.');
 const fresh=normalized.filter(row=>existing.find(value=>value.phone===row.phone)?.status==='not_found');
 if(fresh.length){
  // Insert only missing exact numbers. Never update names, tags or existing identities.
  const inserted=await db.from('contacts').insert(fresh.map(row=>({account_id:accountId,user_id:userId,phone:row.phone,name:row.name?.trim()||row.phone})));
  if(inserted.error&&inserted.error.code!=='23505')throw Error('No se pudo registrar la lista.');
  // A concurrent insert can win the unique constraint. Re-resolve; don't merge.
 }
 const recipients=await resolveCampaignAudience(db,accountId,phones);
 return {recipients,remaining:recipients.filter(row=>row.status!=='ready').length};
}
