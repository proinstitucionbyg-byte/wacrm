import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/automations/engine',()=>({runAutomationById:vi.fn()}));
import { billingDay, startEnrollmentSequence } from './sequence';
import { runAutomationById } from '@/lib/automations/engine';
import type { SupabaseClient } from '@supabase/supabase-js';
type Result={data?:unknown;error?:{code?:string;message?:string}|null};
function database(results:Record<string,Result[]>){
  const writes:{table:string;payload:Record<string,unknown>}[]=[];
  const filters:unknown[][]=[];
  return {writes,filters,db:{from(table:string){
    const resolve=()=>Promise.resolve(results[table]?.shift()??{data:null,error:null});
    const chain={select:()=>chain,eq:(...args:unknown[])=>{filters.push([table,...args]);return chain;},contains:()=>chain,
      insert:(payload:Record<string,unknown>)=>{writes.push({table,payload});return chain;},update:(payload:Record<string,unknown>)=>{writes.push({table,payload});return chain;},
      single:resolve,maybeSingle:resolve,then:(fn:(result:Result)=>unknown)=>resolve().then(fn)};
    return chain;
  }} as unknown as SupabaseClient};
}
const complete=()=>({
  enrollment_drafts:[{data:{status:'registered',review_id:'review',conversation_id:'chat',data:{start_date:'2026-10-06'}}}],
  payment_reviews:[{data:{status:'validated'}}],
  enrollment_document_deliveries:[{data:['BOLETA','FICHA','CRONOGRAMA'].map(kind=>({kind,status:'sent'}))}],
  automations:[{data:[{id:'final30',trigger_config:{billing_day:30}},{id:'final15',trigger_config:{billing_day:15}}]}],
  conversations:[{data:{contact_id:'contact'}}],
  enrollment_sequence_runs:[{data:{id:'sequence'}},{error:null}],
});
beforeEach(()=>{vi.mocked(runAutomationById).mockReset().mockResolvedValue(true);});
describe('automatizacion de cierre segun inicio oficial',()=>{
  it.each([[1,30],[9,30],[10,15],[25,15],[26,30],[31,30]])('inicio dia %s usa cobro %s',(day,expected)=>expect(billingDay(`2026-10-${String(day).padStart(2,'0')}`)).toBe(expected));
  it('rechaza fechas imposibles',()=>expect(()=>billingDay('2026-02-30')).toThrow());
});
describe('secuencia protegida de matricula',()=>{
  it.each([['2026-10-06','final30'],['2026-10-15','final15']])('solo inicia despues de validacion y tres PDF: %s',async(date,automationId)=>{
    const responses=complete();responses.enrollment_drafts[0].data.data.start_date=date;
    const state=database(responses);await startEnrollmentSequence(state.db,'account','draft','final');
    expect(runAutomationById).toHaveBeenCalledWith({accountId:'account',automationId,contactId:'contact',conversationId:'chat',sequenceId:'sequence'});
    expect(state.writes.at(-1)?.payload.status).toBe('started');
  });
  it.each(['pending','observation','rejected'])('no inicia con pago %s',async status=>{
    const responses=complete();responses.payment_reviews[0].data.status=status;
    await startEnrollmentSequence(database(responses).db,'account','draft','final');expect(runAutomationById).not.toHaveBeenCalled();
  });
  it.each(['BOLETA','FICHA','CRONOGRAMA'])('espera que %s este enviado',async kind=>{
    const responses=complete();responses.enrollment_document_deliveries[0].data=responses.enrollment_document_deliveries[0].data.filter(d=>d.kind!==kind);
    await startEnrollmentSequence(database(responses).db,'account','draft','final');expect(runAutomationById).not.toHaveBeenCalled();
  });
  it('no duplica la secuencia en reintentos',async()=>{
    const responses:Record<string,Result[]>=complete();responses.enrollment_sequence_runs=[{error:{code:'23505'}}];
    await startEnrollmentSequence(database(responses).db,'account','draft','final');expect(runAutomationById).not.toHaveBeenCalled();
  });
  it('deja un envio fallido para revision y no afirma que se envio',async()=>{
    vi.mocked(runAutomationById).mockResolvedValue(false);const state=database(complete());
    await startEnrollmentSequence(state.db,'account','draft','final');expect(state.writes.at(-1)?.payload.status).toBe('review');
  });
  it('solicita datos al recibir comprobante sin aprobarlo',async()=>{
    const state=database({payment_reviews:[{data:{status:'pending',conversation_id:'chat'}}],automations:[{data:[{id:'receipt',trigger_config:{}}]}],conversations:[{data:{contact_id:'contact'}}],enrollment_sequence_runs:[{data:{id:'sequence'}},{error:null}]});
    await startEnrollmentSequence(state.db,'account','review','receipt');
    expect(runAutomationById).toHaveBeenCalledWith(expect.objectContaining({automationId:'receipt',sequenceId:'sequence'}));
    expect(state.writes.every(w=>w.table==='enrollment_sequence_runs')).toBe(true);
  });
});
