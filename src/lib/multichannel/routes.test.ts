import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { CENTRAL_SPREADSHEET_ID, COMMUNICATION_HEADERS } from './central-source';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), from: vi.fn(), rpc: vi.fn(), factory: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: () => new Response('{}', { status: 403 }),
}));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: mocks.factory }));
import { POST as worker } from '@/app/api/multichannel/worker/route';
import { POST as control, GET as listControl } from '@/app/api/multichannel/control/route';
import { POST as preview } from '@/app/api/multichannel/preview/route';

const token = `wcm_${'a'.repeat(64)}`;
const request = (body: unknown, credential = `Bearer ${token}`) => new Request('https://example.test/api/multichannel/worker', {
  method: 'POST', headers: { Authorization: credential, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('MULTICHANNEL_SIMULATION_ENABLED', 'true');
  mocks.factory.mockReturnValue({ from: mocks.from, rpc: mocks.rpc });
  mocks.requireRole.mockResolvedValue({ accountId: 'owner-account' });
});
describe('acceso a la cola multicanal', () => {
  it.each([
    {action:'register_line',line_key:'TEST-linea',channel:'sms'},
    {action:'pause_line',line_key:'TEST-linea',value:true},
    {action:'set_line_availability',line_key:'TEST-linea',value:false},
  ])('deriva de la sesión la cuenta del control $action', async (action) => {
    mocks.rpc.mockResolvedValue({data:{line_key:'TEST-linea',paused:true,available:false},error:null});
    const response = await control(request({...action,account_id:'otra'}));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('multichannel_line_control', {
      p_account_id:'owner-account',p_action:action.action==='register_line'?'register':action.action==='pause_line'?'pause':'availability',
      p_line_key:'TEST-linea',p_channel:action.action==='register_line'?'sms':null,
      p_value:action.action==='register_line'?null:action.value,
    });
  });
  it('rechaza líneas reales y pausas ambiguas antes de consultar la base', async () => {
    for (const action of [
      {action:'register_line',line_key:'+51999999999',channel:'sms'},
      {action:'pause_line',line_key:'TEST-linea',value:'false'},
      {action:'set_line_availability',line_key:'TEST-linea'},
    ]) expect((await control(request(action))).status).toBe(400);
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it('no permite gestionar líneas sin ser propietario ni con simulación deshabilitada', async () => {
    const action = {action:'pause_line',line_key:'TEST-linea',value:false};
    vi.stubEnv('MULTICHANNEL_SIMULATION_ENABLED','');
    expect((await control(request(action))).status).toBe(503);
    vi.stubEnv('MULTICHANNEL_SIMULATION_ENABLED','true');
    mocks.requireRole.mockRejectedValue(new Error('forbidden'));
    expect((await control(request(action))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('devuelve 404 si la línea no pertenece a la cuenta y no la crea al pausar', async () => {
    mocks.rpc.mockResolvedValue({data:null,error:null});
    expect((await control(request({action:'pause_line',line_key:'TEST-ajena',value:true}))).status).toBe(404);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('lista líneas y trabajos solo de la cuenta del propietario, sin caché', async () => {
    const query = {select:vi.fn(),eq:vi.fn(),like:vi.fn(),gte:vi.fn(),lt:vi.fn(),order:vi.fn(),limit:vi.fn(),range:vi.fn()};
    query.select.mockReturnValue(query);query.eq.mockReturnValue(query);query.like.mockReturnValue(query);query.gte.mockReturnValue(query);query.lt.mockReturnValue(query);query.order.mockReturnValue(query);
    query.limit.mockResolvedValue({data:[],error:null});query.range.mockResolvedValue({data:[],error:null});mocks.from.mockReturnValue(query);
    const response = await listControl(new Request('https://example.test/api/multichannel/control'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({mode:'simulation',lines:[],jobs:[]});
    expect(mocks.from).toHaveBeenCalledWith('multichannel_lines');
    expect(query.eq.mock.calls.filter(([key])=>key==='account_id')).toEqual(Array(3).fill(['account_id','owner-account']));
    expect(query.eq).toHaveBeenCalledWith('mode','simulation');
    expect(query.like).toHaveBeenCalledWith('line_key','TEST-%');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('consulta el mes elegido en hora de Lima, solo en la cola TEST de la cuenta', async () => {
    const query={select:vi.fn(),eq:vi.fn(),like:vi.fn(),gte:vi.fn(),lt:vi.fn(),order:vi.fn(),limit:vi.fn(),range:vi.fn()};
    query.select.mockReturnValue(query);query.eq.mockReturnValue(query);query.like.mockReturnValue(query);
    query.gte.mockReturnValue(query);query.lt.mockReturnValue(query);query.order.mockReturnValue(query);
    query.limit.mockResolvedValue({data:[],error:null});
    query.range.mockResolvedValue({data:[],error:null});mocks.from.mockReturnValue(query);
    const response=await listControl(new Request('https://example.test/api/multichannel/control?month=2026-12'));
    const payload=await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({mode:'simulation',calendarMonth:'2026-12',jobs:[]});
    expect(query.eq).toHaveBeenCalledWith('account_id','owner-account');
    expect(query.eq).toHaveBeenCalledWith('mode','simulation');
    expect(query.gte).toHaveBeenCalledWith('run_at','2026-12-01T05:00:00.000Z');
    expect(query.lt).toHaveBeenCalledWith('run_at','2027-01-01T05:00:00.000Z');
    expect(query.order).toHaveBeenCalledWith('run_at',{ascending:true});
    expect(query.order).toHaveBeenCalledWith('id',{ascending:true});
    expect(query.range).toHaveBeenCalledWith(0,500);
    expect(payload).toMatchObject({calendarPage:0,calendarHasMore:false});
  });
  it('pagina calendarios por fecha e ID y anuncia si hay más de 500 trabajos', async () => {
    const query={select:vi.fn(),eq:vi.fn(),like:vi.fn(),gte:vi.fn(),lt:vi.fn(),order:vi.fn(),limit:vi.fn(),range:vi.fn()};
    query.select.mockReturnValue(query);query.eq.mockReturnValue(query);query.like.mockReturnValue(query);
    query.gte.mockReturnValue(query);query.lt.mockReturnValue(query);query.order.mockReturnValue(query);query.range.mockReturnValue(query);
    query.limit.mockResolvedValue({data:[],error:null});
    const rows=Array.from({length:501},(_,i)=>({id:`job-${i}`,run_at:'2026-12-01T12:00:00.000Z'}));
    query.range.mockResolvedValue({data:rows,error:null});mocks.from.mockReturnValue(query);
    const response=await listControl(new Request('https://example.test/api/multichannel/control?month=2026-12&page=1'));
    const payload=await response.json();
    expect(response.status).toBe(200);
    expect(query.range).toHaveBeenCalledWith(500,1000);
    expect(payload.jobs).toHaveLength(500);
    expect(payload.jobs[0].id).toBe('job-0');
    expect(payload.calendarPage).toBe(1);
    expect(payload.calendarHasMore).toBe(true);
  });
  it('rechaza una página de calendario malformada antes de consultar la base', async () => {
    for (const page of ['','-1','1.5','1001','1']) {
      const response=await listControl(new Request(`https://example.test/api/multichannel/control?${page==='1'?'':'month=2026-12&'}page=${page}`));
      expect(response.status).toBe(400);
    }
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it('rechaza un mes inválido antes de consultar la base', async () => {
    const response=await listControl(new Request('https://example.test/api/multichannel/control?month=2026-13'));
    expect(response.status).toBe(400);expect(mocks.factory).not.toHaveBeenCalled();
  });
  const batchJob={channel:'sms',line_key:'TEST-linea',recipient:'TEST-a',body:'Prueba',
    dedup_key:'campana-a',run_at:'2027-01-01T08:00:00-05:00',expires_at:'2027-01-01T09:00:00-05:00'};
  it('guarda un lote en una sola operación, siempre en la cuenta del propietario', async () => {
    const select=vi.fn().mockResolvedValue({data:[{id:'a',status:'queued',mode:'simulation'}],error:null});
    const insert=vi.fn().mockReturnValue({select}); mocks.from.mockReturnValue({insert});
    const response=await control(request({action:'enqueue_batch',jobs:[{...batchJob,account_id:'otra',mode:'live'}]}));
    expect(response.status).toBe(201); expect((await response.json()).enqueued).toBe(1);
    expect(insert).toHaveBeenCalledOnce();
    expect(insert.mock.calls[0][0][0]).toMatchObject({account_id:'owner-account',mode:'simulation'});
  });
  it('rechaza claves repetidas dentro del lote antes de abrir la base', async () => {
    const response=await control(request({action:'enqueue_batch',jobs:[batchJob,batchJob]}));
    expect(response.status).toBe(400); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it('un lote que contiene un trabajo existente no se reintenta fila por fila', async () => {
    const select=vi.fn().mockResolvedValue({data:null,error:{code:'23505'}});
    const insert=vi.fn().mockReturnValue({select}); mocks.from.mockReturnValue({insert});
    const response=await control(request({action:'enqueue_batch',jobs:[batchJob]}));
    expect(response.status).toBe(409); expect(insert).toHaveBeenCalledOnce();
  });
  it('cancela únicamente trabajos de prueba aún en cola y conserva su historial', async () => {
    const query={update:vi.fn(),eq:vi.fn(),select:vi.fn(),maybeSingle:vi.fn()};
    query.update.mockReturnValue(query);query.eq.mockReturnValue(query);query.select.mockReturnValue(query);
    const id='b6ac7d9e-9846-4d93-9cec-5e8d24f93b26';
    query.maybeSingle.mockResolvedValue({data:{id,status:'cancelled'},error:null});mocks.from.mockReturnValue(query);
    const response=await control(request({action:'cancel_job',job_id:id}));
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({cancelled:true,job:{status:'cancelled'}});
    expect(mocks.from).toHaveBeenCalledWith('multichannel_jobs');
    expect(query.update.mock.calls[0][0]).toMatchObject({status:'cancelled'});
    expect(query.eq.mock.calls).toEqual([['id',id],['account_id','owner-account'],['mode','simulation'],['status','queued']]);
  });
  it('no cancela un trabajo que ya fue reclamado por un ejecutor', async () => {
    const query={update:vi.fn(),eq:vi.fn(),select:vi.fn(),maybeSingle:vi.fn()};
    query.update.mockReturnValue(query);query.eq.mockReturnValue(query);query.select.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({data:null,error:null});mocks.from.mockReturnValue(query);
    const response=await control(request({action:'cancel_job',job_id:'b6ac7d9e-9846-4d93-9cec-5e8d24f93b26'}));
    expect(response.status).toBe(409);expect(query.eq).toHaveBeenCalledWith('status','queued');
  });
  it('previsualiza como propietario sin tocar la base ni activar workers', async () => {
    vi.stubEnv('MULTICHANNEL_SIMULATION_ENABLED','');
    const response=await preview(request({campaign_id:'prueba',version:1,purpose:'notice',
      line_key:'TEST-linea',template:'Hola',run_at:'2027-01-01T08:00:00-05:00',
      expires_at:'2027-01-01T09:00:00-05:00',recipients:[{id:'a',destination:'TEST-a',permission_confirmed:true}]}));
    expect(response.status).toBe(200); expect((await response.json()).enqueued).toBe(false);
    expect(mocks.requireRole).toHaveBeenCalledWith('owner');
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it('rechaza una campaña incompleta o una sesión sin permisos', async () => {
    expect((await preview(request({}))).status).toBe(400);
    mocks.requireRole.mockRejectedValue(new Error('forbidden'));
    expect((await preview(request({}))).status).toBe(403);
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it('revisa filas del maestro solo como propietario y sin escribir en la base', async () => {
    const values=Array<string>(17).fill('');
    const fields:Record<string,string>={Comunicacion_ID:'COM-1',Estudiante_ID:'EST-1',Finalidad:'Aviso',Canal:'SMS',
      'Fecha prevista':'2027-01-01T08:00','Destino':'TEST-a','Consentimiento / permiso':'Sí',
      'Texto / plantilla':'Aviso ficticio.',Estado:'Programado',Campana_ID:'CAMP-1'};
    COMMUNICATION_HEADERS.forEach((h,i)=>{values[i]=fields[h]??'';});
    const body={source:'central-sheet',spreadsheet_id:CENTRAL_SPREADSHEET_ID,sheet_name:'COMUNICACIONES',
      text_mode:'literal',headers:[...COMMUNICATION_HEADERS],rows:[values],campaign:{
        campaign_id:'CAMP-1',version:1,purpose:'notice',line_key:'TEST-linea',
        run_at:'2027-01-01T08:00:00-05:00',expires_at:'2027-01-01T09:00:00-05:00'}};
    const response=await preview(request(body));
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({source:'central-sheet',read_only:true,enqueued:false});
    expect(mocks.requireRole).toHaveBeenCalledWith('owner');
    expect(mocks.factory).not.toHaveBeenCalled();
    expect((await preview(request({...body,headers:[...body.headers,'Destino']}))).status).toBe(400);
    expect((await preview(request({...body,spreadsheet_id:'otra'}))).status).toBe(400);
    mocks.requireRole.mockRejectedValue(new Error('forbidden'));
    expect((await preview(request(body))).status).toBe(403);
  });
  it('queda desactivada por defecto, incluso con una credencial de laptop', async () => {
    vi.stubEnv('MULTICHANNEL_SIMULATION_ENABLED', '');
    expect((await worker(request({ action: 'claim' }))).status).toBe(503);
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it('rechaza claves principales, credenciales malformadas y acciones incompletas', async () => {
    expect((await worker(request({ action: 'claim' }, 'Bearer service-role'))).status).toBe(401);
    expect((await worker(request({ action: 'complete' }))).status).toBe(400);
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it('exige propietario antes de registrar laptops o campañas', async () => {
    mocks.requireRole.mockRejectedValue(new Error('forbidden'));
    expect((await control(request({ action: 'register_worker', worker: { name: 'Laptop' } }))).status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('owner');
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it('registra solo el hash y devuelve la credencial una vez sin caché', async () => {
    const single = vi.fn().mockResolvedValue({data:{id:'worker-1',name:'Laptop'},error:null});
    const select = vi.fn().mockReturnValue({single});
    const insert = vi.fn().mockReturnValue({select});
    mocks.from.mockReturnValue({insert});
    const response = await control(request({action:'register_worker',worker:{name:'Laptop'}}));
    const data = await response.json();
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(insert.mock.calls[0][0]).toEqual({account_id:'owner-account',name:'Laptop',
      token_hash:createHash('sha256').update(data.token).digest('hex')});
    expect(JSON.stringify(insert.mock.calls)).not.toContain(data.token);
  });
  it('deriva el worker del hash, ignorando la cuenta o worker que mande el cliente', async () => {
    const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
    chain.maybeSingle.mockResolvedValue({data:{id:'authenticated-worker'},error:null});
    mocks.from.mockReturnValue(chain); mocks.rpc.mockResolvedValue({data:null,error:null});
    const response = await worker(request({action:'claim',worker_id:'intruder',account_id:'other'}));
    expect(response.status).toBe(200);
    expect(chain.eq).toHaveBeenCalledWith('token_hash',createHash('sha256').update(token).digest('hex'));
    expect(chain.eq).toHaveBeenCalledWith('enabled',true);
    expect(mocks.rpc).toHaveBeenCalledWith('multichannel_worker_step',{
      p_worker_id:'authenticated-worker',p_action:'claim',p_job_id:null,p_claim_token:null,
    });
  });
  it('un fallo del servidor no revela credenciales ni confirma envío', async () => {
    mocks.from.mockImplementation(() => {throw new Error(token);});
    const response=await worker(request({action:'claim'}));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(token);
  });
});
