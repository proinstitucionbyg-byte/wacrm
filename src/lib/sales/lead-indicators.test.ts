import{describe,it,expect}from'vitest';import{salesLeadIndicators,requestsPromotion}from'./lead-indicators'
const base={tags:['AREA VENTAS','ASESOR URGENTE'],area:'VENTAS',status:'',activationRequested:true,validatedSale:false}
describe('compact commercial indicators',()=>{
 it('shows a new urgent request after an older manual contact status',()=>expect(salesLeadIndicators({...base,status:'CONTACTADO',statusChangedAt:'2026-11-05T10:00:00Z',urgencyRequestedAt:'2026-11-05T11:00:00Z'}).attention_status).toBe('ASESOR URGENTE'))
 it('does not restore urgency resolved by a newer manual status',()=>expect(salesLeadIndicators({...base,status:'CONTACTADO',statusChangedAt:'2026-11-05T12:00:00Z',urgencyRequestedAt:'2026-11-05T11:00:00Z'}).attention_status).toBe(''))
 it('shows prospect and urgency separately',()=>expect(salesLeadIndicators(base)).toMatchObject({commercial_active:true,commercial_stage:'PROSPECTO A COMPRAR',attention_status:'ASESOR URGENTE'}))
 it.each(['NO INTERESADO','SEGUIMIENTO DE VENTAS','CONTACTADO'])('a later manual %s resolves the old urgent request',status=>expect(salesLeadIndicators({...base,status}).attention_status).toBe(''))
 it('old sales tags cannot keep a fidelity contact active',()=>expect(salesLeadIndicators({...base,area:'FIDELIZACION'})).toMatchObject({commercial_active:false,commercial_stage:'',attention_status:'',commercial_exclusion:'OTRA AREA'}))
 it('retains a validated sale as history rather than an active prospect',()=>expect(salesLeadIndicators({...base,validatedSale:true})).toMatchObject({commercial_active:false,commercial_exclusion:'VENTA VALIDADA'}))
 it.each(['🔥 Activa tú Promo','Activar Promo','Quiero activar mi promoción'])('recognizes %s',text=>expect(requestsPromotion(text)).toBe(true))
})
