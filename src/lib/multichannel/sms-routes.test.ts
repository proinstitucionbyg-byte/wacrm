import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const mocks = vi.hoisted(() => ({ role: vi.fn(), factory: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({ requireRole: mocks.role, toErrorResponse: () => new Response('{}', { status: 403 }) }));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: mocks.factory }));
import { POST as control, GET as list } from '@/app/api/multichannel/sms/control/route';
import { POST as worker } from '@/app/api/multichannel/sms/worker/route';

const id='11111111-1111-4111-8111-111111111111', claim='22222222-2222-4222-8222-222222222222';
const token='wcm_'+'a'.repeat(64),binding={line_key:'SMS-equipo',device_key:'fictional-device'};
const request=(body:unknown,credential=`Bearer ${token}`)=>new Request('https://crm.example.test/api/multichannel/sms/worker',{
  method:'POST',headers:{Authorization:credential,'Content-Type':'application/json'},body:JSON.stringify(body),
});
function authorizeWorker(data:unknown={id:'authenticated-worker'}) {
  const chain={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn()};
  chain.select.mockReturnValue(chain);chain.eq.mockReturnValue(chain);chain.maybeSingle.mockResolvedValue({data,error:null});
  mocks.from.mockReturnValue(chain);return chain;
}
beforeEach(()=>{
  vi.resetAllMocks();vi.stubEnv('MULTICHANNEL_SMS_ENABLED','true');vi.stubEnv('MULTICHANNEL_SIMULATION_ENABLED','');
  mocks.factory.mockReturnValue({from:mocks.from,rpc:mocks.rpc});
  mocks.role.mockResolvedValue({accountId:'session-account',userId:'session-owner'});
  mocks.rpc.mockResolvedValue({data:null,error:null});
});
describe('SMS servidor y permisos',()=>{
  it('no se habilita por activar la simulación',async()=>{
    vi.stubEnv('MULTICHANNEL_SMS_ENABLED','');vi.stubEnv('MULTICHANNEL_SIMULATION_ENABLED','true');
    expect((await worker(request({action:'claim',...binding}))).status).toBe(503);
    expect((await control(request({action:'register_worker',name:'Laptop'}))).status).toBe(503);
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it('administrar requiere propietario y cuenta de sesión',async()=>{
    mocks.role.mockRejectedValue(new Error('not-owner'));
    expect((await control(request({action:'register_worker',name:'Laptop'}))).status).toBe(403);
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it('emite credencial una vez, guarda solo hash y no habilita líneas',async()=>{
    mocks.rpc.mockResolvedValue({data:{id,name:'Laptop'},error:null});
    const response=await control(request({action:'register_worker',name:'Laptop'})),body=await response.json();
    expect(response.status).toBe(201);expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('multichannel_sms_control',{
      p_account_id:'session-account',p_actor_id:'session-owner',p_action:'register_worker',
      p_payload:{name:'Laptop',token_hash:createHash('sha256').update(body.token).digest('hex')},
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(body.token);
  });
  it('no permite cuenta/actor impuestos ni permiso sin evidencia o vigencia',async()=>{
    for(const body of [
      {action:'register_worker',name:'Laptop',account_id:'other'},
      {action:'set_permission',contact_id:id,purpose:'notice',recipient:'+51900000001',granted:true,expires_at:'2020-01-01T00:00:00Z',evidence:'Revisión'},
      {action:'set_permission',contact_id:id,purpose:'notice',recipient:'+51900000001',granted:true,expires_at:'2027-01-01T00:00:00Z',evidence:''},
    ])expect((await control(request(body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('registra permiso explícito y deja que SQL verifique contacto y rol',async()=>{
    const action={action:'set_permission',contact_id:id,purpose:'notice',recipient:'+51900000001',granted:false,
      expires_at:'2027-01-01T00:00:00Z',evidence:'Revocación solicitada'};
    mocks.rpc.mockResolvedValue({data:{saved:true},error:null});
    expect((await control(request(action))).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({p_account_id:'session-account',p_actor_id:'session-owner',p_action:'set_permission'});
  });
  it('una línea real requiere límites explícitos; nunca hereda los de la simulación',async()=>{
    const action={action:'configure_line',...binding,worker_id:id};
    expect((await control(request(action))).status).toBe(400);
    mocks.rpc.mockResolvedValue({data:{line_key:binding.line_key,paused:true,available:false},error:null});
    expect((await control(request({...action,interval_seconds:60,daily_limit:20,limit_note:'Configuración ficticia'}))).status).toBe(200);
  });
  it('no encola cobranza ni teléfonos impuestos desde el cliente',async()=>{
    const action={action:'enqueue',...binding,contact_id:id,purpose:'notice',body:'Aviso',dedup_key:'campana-estudiante',
      run_at:'2027-01-01T00:00:00Z',expires_at:'2027-01-01T01:00:00Z'};
    const {device_key:unused,...valid}=action;expect(unused).toBe(binding.device_key);
    expect((await control(request({...valid,purpose:'collection'}))).status).toBe(400);
    expect((await control(request({...valid,recipient:'+51900000002'}))).status).toBe(400);
    mocks.rpc.mockResolvedValue({data:{id,status:'queued'},error:null});
    expect((await control(request(valid))).status).toBe(201);
    expect(mocks.rpc.mock.calls[0][1].p_payload).not.toHaveProperty('recipient');
  });
  it('duplicados son 409 y errores no revelan datos privados ni llaves',async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:{code:'23505',details:token}});
    expect((await control(request({action:'register_worker',name:'Laptop'}))).status).toBe(409);
    mocks.rpc.mockResolvedValue({data:null,error:{code:'XX',details:token}});
    const response=await control(request({action:'register_worker',name:'Laptop'}));
    expect(response.status).toBe(503);expect(await response.text()).not.toContain(token);
  });
  it('autentica por hash y no acepta un worker o permiso indicados por el cliente',async()=>{
    const chain=authorizeWorker();
    expect((await worker(request({action:'claim',...binding,worker_id:id}))).status).toBe(400);
    const response=await worker(request({action:'claim',...binding}));expect(response.status).toBe(200);
    expect(chain.eq).toHaveBeenCalledWith('token_hash',createHash('sha256').update(token).digest('hex'));
    expect(mocks.rpc).toHaveBeenCalledWith('multichannel_sms_step',{
      p_worker_id:'authenticated-worker',p_action:'claim',p_line_key:binding.line_key,p_device_key:binding.device_key,
      p_job_id:null,p_claim_token:null,p_state:null,p_provider_id:null,p_ready:null,
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('el permiso procede del servidor, no de campos pegados',async()=>{
    authorizeWorker();const body={action:'permit',...binding,job_id:id,claim_token:claim};
    expect((await worker(request({...body,allowed:true,permissionConfirmed:true}))).status).toBe(400);
    mocks.rpc.mockResolvedValue({data:{allowed:false},error:null});
    expect(await (await worker(request(body))).json()).toMatchObject({mode:'sms_live',permit:{allowed:false}});
  });
  it('solo registra estados e ID permitidos; la hora de autoridad no viene de la laptop',async()=>{
    authorizeWorker();const body={action:'record',...binding,job_id:id,claim_token:claim,
      provider_id:'wcm-'+'b'.repeat(64),state:'accepted',checked_at:'2027-01-01T00:00:00Z'};
    expect((await worker(request({...body,state:'simulated'}))).status).toBe(400);
    mocks.rpc.mockResolvedValue({data:{recorded:true,state:'sent'},error:null});
    expect(await (await worker(request(body))).json()).toMatchObject({receipt:{recorded:true,state:'sent'}});
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_checked_at');
  });
  it('rechaza claves inválidas, revocadas y líneas no asignadas',async()=>{
    expect((await worker(request({action:'claim',...binding},'Bearer service-role'))).status).toBe(401);
    authorizeWorker(null);expect((await worker(request({action:'claim',...binding}))).status).toBe(401);
    authorizeWorker();mocks.rpc.mockResolvedValue({data:null,error:{code:'42501',details:token}});
    expect((await worker(request({action:'claim',...binding}))).status).toBe(403);
  });
  it('lista solo SMS de la cuenta, sin hashes ni contenido de evidencias',async()=>{
    const q={select:vi.fn(),eq:vi.fn(),like:vi.fn(),order:vi.fn(),limit:vi.fn()};
    q.select.mockReturnValue(q);q.eq.mockReturnValue(q);q.like.mockReturnValue(q);q.order.mockReturnValue(q);
    q.limit.mockResolvedValue({data:[],error:null});mocks.from.mockReturnValue(q);
    const response=await list();expect(response.status).toBe(200);
    expect(q.eq.mock.calls.filter(([key])=>key==='account_id')).toHaveLength(3);
    expect(q.eq).toHaveBeenCalledWith('mode','sms_live');
    expect(q.select.mock.calls.flat().join(' ')).not.toContain('token_hash');
    expect(q.select.mock.calls.flat().join(' ')).not.toContain('evidence');
  });
});
