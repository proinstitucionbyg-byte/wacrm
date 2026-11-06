import{readFileSync}from'node:fs';import{createContext,runInContext}from'node:vm';import{it,expect}from'vitest';
it('hides by stable ID after sorting and restores only rows hidden by this sync',()=>{
 const c=createContext({console,Map,Set,JSON});runInContext(readFileSync('output/sales-workbook-2026-10/VENTAS_BASE_CRM_SYNC.gs','utf8'),c);
 const hidden:number[]=[],shown:number[]=[];const props=new Map([['SALES_HIDDEN_IDS:general','["returning"]']]);
 const sheet={getLastRow:()=>5,getRange:(_r:number,col:number)=>({getDisplayValues:()=>col===17?[['returning'],['fidelity'],['unknown']]:[['1'],['2'],['3']]}),hideRows:(r:number)=>hidden.push(r),showRows:(r:number)=>shown.push(r)};
 c.syncSalesVisibility_(sheet,[{id:'fidelity',commercial_exclusion:'OTRA AREA'},{id:'returning',commercial_exclusion:''}],{getProperty:(k:string)=>props.get(k),setProperty:(k:string,v:string)=>props.set(k,v)},'general');
 expect(hidden).toEqual([4]);expect(shown).toEqual([3]);expect(props.get('SALES_HIDDEN_IDS:general')).toBe('["fidelity"]');
 expect(c.salesLeadsForAdviser_({active_for_sales:true,user_id:'agent'},[{id:'fidelity',assigned_adviser_id:'agent',commercial_exclusion:'OTRA AREA'},{id:'active',assigned_adviser_id:'agent'}]).map((r:{id:string})=>r.id)).toEqual(['active']);
});
