const norm=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase()
const resolved=new Set(['NO INTERESADO','NO INTERESADO-R','INCORRECTO','FUERA DE SERVICIO','VENTA','VENTA SOLO','SEGUIMIENTO DE VENTAS','CONTACTADO'])
export function salesLeadIndicators(input:{tags:string[];area?:string|null;status?:string|null;activationRequested:boolean;validatedSale:boolean;statusChangedAt?:string|null;activationRequestedAt?:string|null;urgencyRequestedAt?:string|null}){
 const tags=input.tags.map(norm),area=norm(input.area??''),status=norm(input.status??'')
 const outside=(area!==''&&area!=='VENTAS')||tags.includes('AREA FIDELIZACION')
 const active=!outside&&!['INCORRECTO','FUERA DE SERVICIO','VENTA','VENTA SOLO'].includes(status)&&!input.validatedSale
 const laterThanStatus=(date?:string|null)=>!!date&&!!input.statusChangedAt&&Date.parse(date)>Date.parse(input.statusChangedAt)
 const prospect=active&&(!resolved.has(status)||laterThanStatus(input.activationRequestedAt))&&input.activationRequested
 return{commercial_active:active,commercial_stage:prospect?'PROSPECTO A COMPRAR':'',
  attention_status:active&&(!resolved.has(status)||laterThanStatus(input.urgencyRequestedAt))&&tags.includes('ASESOR URGENTE')?'ASESOR URGENTE':'',
  commercial_exclusion:outside?'OTRA AREA':input.validatedSale?'VENTA VALIDADA':active?'':status}
}
export function requestsPromotion(text:string){
 return /\b(?:activa(?:r|mos)?|activar|quiero activar)\b[^\n]{0,30}\bprom(?:o|ocion)\b/i.test(text.normalize('NFD').replace(/[\u0300-\u036f]/g,''))
}
