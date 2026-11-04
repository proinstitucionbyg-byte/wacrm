import { describe, expect, it } from 'vitest';
import { campaignPreviewSchema, previewCampaign } from './campaign-preview';

const now = Date.parse('2026-11-01T12:00:00Z');
const recipient = (id = 'alumno-1', destination = 'TEST-alumno-1') => ({
  id, destination, permission_confirmed:true, payment_status:'pending' as const,
  variables:{nombre:'Estudiante de prueba',enlace:'https://example.test/curso'},
});
const campaign = (overrides: Record<string, unknown> = {}) => campaignPreviewSchema.parse({
  campaign_id:'campana-1',version:1,purpose:'collection',line_key:'TEST-linea-1',
  template:'Hola {{nombre}}, revisa {{enlace}}.', run_at:'2026-11-01T09:00:00-05:00',
  expires_at:'2026-11-01T18:00:00-05:00',recipients:[recipient()],...overrides,
});
describe('preparación de campañas sin envío', () => {
  it('personaliza, programa en Lima y deja explícito que no se encoló nada', () => {
    const result=previewCampaign(campaign(),now);
    expect(result.enqueued).toBe(false);
    expect(result.jobs[0].body).toBe('Hola Estudiante de prueba, revisa https://example.test/curso.');
    expect(result.jobs[0].run_at).toBe('2026-11-01T14:00:00.000Z');
    expect(result.totals).toEqual({received:1,ready:1,blocked:0,duplicate:0,deferred:0});
  });
  it('conserva el canal elegido en todos los trabajos simulados', () => {
    const result=previewCampaign(campaign({channel:'whatsapp_support'}),now);
    expect(result.jobs[0].channel).toBe('whatsapp_support');
    expect(result.enqueued).toBe(false);
  });
  it('no programa dos filas con el mismo ID ni con el mismo destino', () => {
    const result=previewCampaign(campaign({recipients:[recipient(),recipient('otro'),recipient('alumno-1','TEST-otro')]}),now);
    expect(result.totals.ready).toBe(1); expect(result.totals.duplicate).toBe(2);
  });
  it('mantiene la clave al reordenar filas o cambiar de laptop/línea', () => {
    const a=recipient(), b=recipient('alumno-2','TEST-alumno-2');
    const first=previewCampaign(campaign({recipients:[a,b]}),now);
    const second=previewCampaign(campaign({recipients:[b,a],line_key:'TEST-linea-2'}),now);
    expect(first.jobs[0].dedup_key).toBe(second.jobs[1].dedup_key);
    expect(previewCampaign(campaign({version:2}),now).jobs[0].dedup_key).not.toBe(first.jobs[0].dedup_key);
  });
  it('excluye pagos resueltos y pagos cuyo estado se desconoce', () => {
    for (const payment_status of ['resolved','unknown']) {
      const result=previewCampaign(campaign({recipients:[{...recipient(),payment_status}]}),now);
      expect(result.totals.blocked).toBe(1); expect(result.jobs).toHaveLength(0);
    }
  });
  it('los avisos no dependen del pago, pero siguen exigiendo permiso', () => {
    expect(previewCampaign(campaign({purpose:'notice',recipients:[{...recipient(),payment_status:'unknown'}]}),now).totals.ready).toBe(1);
    expect(previewCampaign(campaign({purpose:'notice',recipients:[{...recipient(),permission_confirmed:false}]}),now).totals.blocked).toBe(1);
  });
  it('bloquea teléfonos reales mientras no exista conexión al celular', () => {
    const result=previewCampaign(campaign({recipients:[recipient('real','51934215366')]}),now);
    expect(result.jobs).toHaveLength(0); expect(result.rows[0].reason).toContain('todavía no habilitada');
  });
  it('no envía textos con variables faltantes, incompletas o demasiado largos', () => {
    for (const template of ['Hola {{dato_faltante}}','Hola {{nombre','{{a}}{{b}}{{c}}']) {
      const variables={a:'a'.repeat(2000),b:'b'.repeat(2000),c:'c'};
      expect(previewCampaign(campaign({template,recipients:[{...recipient(),variables}]}),now).totals.blocked).toBe(1);
    }
  });
  it('no permite variables heredadas del objeto', () => {
    expect(previewCampaign(campaign({template:'{{toString}}'}),now).rows[0].reason).toContain('Faltan variables');
  });
  it('respeta el límite de lote, sin perder los destinatarios que quedan fuera', () => {
    const result=previewCampaign(campaign({batch_limit:1,recipients:[recipient(),recipient('b','TEST-b')]}),now);
    expect(result.totals).toEqual({received:2,ready:1,blocked:0,duplicate:0,deferred:1});
    expect(result.rows).toHaveLength(2);
  });
  it('usa un intervalo entre trabajos y no programa después del vencimiento', () => {
    const result=previewCampaign(campaign({interval_seconds:20,expires_at:'2026-11-01T09:00:30-05:00',
      recipients:[recipient(),recipient('b','TEST-b'),recipient('c','TEST-c')]}),now);
    expect(result.jobs.map(job=>job.run_at)).toEqual(['2026-11-01T14:00:00.000Z','2026-11-01T14:00:20.000Z']);
    expect(result.rows[2].status).toBe('blocked');
    expect(previewCampaign(campaign(),Date.parse('2026-11-02T00:00:00Z')).jobs).toHaveLength(0);
  });
  it('rechaza listas sobredimensionadas y fechas sin zona o intervalos inválidos', () => {
    for (const overrides of [{interval_seconds:0},{run_at:'01/11/2026 09:00'},
      {recipients:Array.from({length:5001},()=>recipient())}]) {
      expect(()=>campaign(overrides)).toThrow();
    }
  });
  it('prepara 5000 destinatarios por lotes de 500 sin truncar los restantes',()=>{
    const recipients=Array.from({length:5000},(_,n)=>recipient(`alumno-${n}`,`TEST-${n}`));
    const result=previewCampaign(campaign({recipients,batch_limit:500}),now);
    expect(result.totals).toEqual({received:5000,ready:500,blocked:0,duplicate:0,deferred:4500});
  });
});
