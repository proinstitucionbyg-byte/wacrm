import{describe,it,expect}from'vitest';
import type{SupabaseClient}from'@supabase/supabase-js';
import{resolveCampaignAudience,importCampaignContacts}from'./campaign-audience';
type Row={id:string;account_id:string;phone:string;phone_normalized:string;name:string};
function fixture(initial:Row[],race=false){
 const rows=structuredClone(initial),inserted:Record<string,unknown>[][]=[];
 const db={from:()=>({
  select:()=>{let account='',field='',variants:string[]=[];const query={eq:(_:string,value:string)=>{account=value;return query;},in:(key:string,values:string[])=>{field=key;variants=values;return query;},limit:async()=>({data:rows.filter(row=>row.account_id===account&&variants.includes(row[field as keyof Row])),error:null})};return query;},
  insert:async(values:Record<string,unknown>[])=>{inserted.push(values);if(race)return{error:{code:'23505'}};rows.push(...values.map((value,index)=>({id:'new-'+index,account_id:String(value.account_id),phone:String(value.phone),phone_normalized:String(value.phone).replace(/\D/g,''),name:String(value.name)})));return{error:null};},
 })};return{db:db as unknown as SupabaseClient,rows,inserted};
}
describe('campaign contact registration',()=>{
 it('uses exact normalized phones in the current account and preserves existing names',async()=>{
  const f=fixture([{id:'old',account_id:'own',phone:'937 467 119',phone_normalized:'937467119',name:'Original'},{id:'foreign',account_id:'other',phone:'+14155552671',phone_normalized:'14155552671',name:'Otro'}]);
  const result=await importCampaignContacts(f.db,'own','actor',[{phone:'+51937467119',name:'No reemplazar'},{phone:'+14155552671',name:'Nuevo'}]);
  expect(result.remaining).toBe(0);expect(f.inserted[0]).toEqual([{account_id:'own',user_id:'actor',phone:'+14155552671',name:'Nuevo'}]);expect(f.rows[0].name).toBe('Original');
  await importCampaignContacts(f.db,'own','actor',[{phone:'+14155552671',name:'Tampoco reemplazar'}]);expect(f.inserted).toHaveLength(1);
 });
 it('does not merge ambiguous records, infer consent or accept invalid numbers',async()=>{
  const f=fixture([{id:'a',account_id:'own',phone:'937467119',phone_normalized:'937467119',name:'A'},{id:'b',account_id:'own',phone:'+51937467119',phone_normalized:'51937467119',name:'B'}]);
  expect((await resolveCampaignAudience(f.db,'own',['+51937467119']))[0].status).toBe('ambiguous');
  await expect(importCampaignContacts(f.db,'own','actor',[{phone:'+51937467119'}])).rejects.toThrow('ambiguos');
  await expect(importCampaignContacts(f.db,'own','actor',[{phone:'invalid'}])).rejects.toThrow('inválidos');expect(f.inserted).toHaveLength(0);
 });
 it('reports remaining unknown contacts after a concurrent conflict instead of claiming success',async()=>{
  const f=fixture([],true);const result=await importCampaignContacts(f.db,'own','actor',[{phone:'+51937467119'}]);
  expect(result.remaining).toBe(1);expect(result.recipients[0].status).toBe('not_found');
 });
});
