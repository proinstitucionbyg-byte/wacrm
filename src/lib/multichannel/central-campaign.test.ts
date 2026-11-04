import { describe, expect, it } from 'vitest';
import {
  CENTRAL_SPREADSHEET_ID, COMMUNICATION_HEADERS, centralCampaignSchema,
  centralDateTime, previewCentralCampaign,
} from './central-campaign';

const now = Date.parse('2026-11-01T12:00:00Z');
function row(changes: Partial<Record<string, string | number | boolean | null>> = {}) {
  const record = {
    Comunicacion_ID: 'COM-1', Estudiante_ID: 'EST-1', Matricula_ID: 'MAT-1',
    Finalidad: 'Aviso', Canal: 'SMS', 'Fecha prevista': '01/11/2026 09:00',
    Destino: 'TEST-alumno-1', 'Consentimiento / permiso': 'Sí',
    'Texto / plantilla': 'Aviso ficticio del curso.', Estado: 'Programado',
    Campana_ID: 'CAMP-1', Intentos: 0, ...changes,
  };
  return COMMUNICATION_HEADERS.map(h => record[h as keyof typeof record] ?? '');
}
function input(rows = [row()]) {
  return centralCampaignSchema.parse({
    source: 'central-sheet', spreadsheet_id: CENTRAL_SPREADSHEET_ID,
    sheet_name: 'COMUNICACIONES', text_mode: 'literal', headers: [...COMMUNICATION_HEADERS], rows,
    campaign: {
      campaign_id: 'CAMP-1', version: 1, purpose: 'notice', line_key: 'TEST-linea-1',
      template: 'No reemplaza el texto final de la comunicación.',
      run_at: '2026-11-01T09:00:00-05:00', expires_at: '2026-11-01T18:00:00-05:00',
      interval_seconds: 20, batch_limit: 100,
    },
  });
}

describe('puente central a la vista previa existente', () => {
  it('prepara una comunicación conservando texto e identidad y sin guardar ni enviar', () => {
    const result = previewCentralCampaign(input(), now);
    expect(result).toMatchObject({read_only:true, enqueued:false, mode:'simulation', ignored:0});
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({body:'Aviso ficticio del curso.', run_at:'2026-11-01T14:00:00.000Z'});
    expect(result.rows[0]).toMatchObject({source_row:5, communication_id:'COM-1', recipient_id:'EST-1', status:'ready'});
  });
  it('prepara WhatsApp de soporte solo si la campaña y la fila declaran el mismo canal', () => {
    const source=input([row({Canal:'WhatsApp soporte'})]);
    source.campaign.channel='whatsapp_support';
    const result=previewCentralCampaign(source,now);
    expect(result.jobs[0].channel).toBe('whatsapp_support');
    expect(result.enqueued).toBe(false);

    const mismatch=input();
    mismatch.campaign.channel='whatsapp_support';
    expect(previewCentralCampaign(mismatch,now).rows[0].reason).toContain('no coincide');
  });
  it('no pierde la correspondencia al filtrar otra campaña o mover columnas', () => {
    const source = input([row({Campana_ID:'OTRA'}), row()]);
    source.headers.reverse(); source.rows.forEach(r => r.reverse());
    const result = previewCentralCampaign(source, now);
    expect(result.ignored).toBe(1); expect(result.totals.received).toBe(1);
    expect(result.rows[0].source_row).toBe(6);
  });
  it('no inventa otra campaña cuando no existen coincidencias', () => {
    const result = previewCentralCampaign(input([row({Campana_ID:'OTRA'})]), now);
    expect(result.jobs).toEqual([]); expect(result.totals.received).toBe(0);
  });
  it('rechaza cabeceras incompletas o ambiguas antes de interpretar filas', () => {
    for (const headers of [[...COMMUNICATION_HEADERS.slice(1)], [...COMMUNICATION_HEADERS, 'Destino']]) {
      expect(() => previewCentralCampaign({...input(), headers}, now)).toThrow('cabeceras');
    }
  });
  it('conserva la clave al reordenar filas o cambiar de línea y detecta duplicados', () => {
    const a = row(), b = row({Comunicacion_ID:'COM-2', Estudiante_ID:'EST-2', Destino:'TEST-alumno-2'});
    const first = previewCentralCampaign(input([a,b]), now);
    const moved = input([b,a]); moved.campaign.line_key = 'TEST-otra';
    expect(first.jobs[0].dedup_key).toBe(previewCentralCampaign(moved, now).jobs[1].dedup_key);
    const repeated = previewCentralCampaign(input([a, a, row({Comunicacion_ID:'COM-3'})]), now);
    expect(repeated.totals).toMatchObject({received:3, ready:1, duplicate:2});
  });
  it('excluye entregas manuales, fechas de envío, IDs del proveedor e intentos inciertos', () => {
    for (const changes of [{Estado:'Enviado manualmente'}, {'Fecha envío real':'01/11/2026'},
      {'ID proveedor':'proveedor-1'}, {Intentos:1}, {Intentos:'desconocido'}]) {
      const result = previewCentralCampaign(input([row(changes)]), now);
      expect(result.jobs).toEqual([]); expect(result.totals.blocked).toBe(1);
    }
  });
  it('no permite una fila nueva para el mismo alumno ya gestionado en la campaña', () => {
    const result = previewCentralCampaign(input([
      row({Estado:'Enviado manualmente'}), row({Comunicacion_ID:'COM-nueva'}),
    ]), now);
    expect(result.jobs).toEqual([]);
  });
  it('no interpreta un estado vacío, otro canal ni un permiso pendiente como autorización', () => {
    for (const changes of [{Estado:''}, {Canal:'WhatsApp'}, {'Consentimiento / permiso':'Pendiente'}, {Estudiante_ID:''}]) {
      expect(previewCentralCampaign(input([row(changes)]), now).jobs).toEqual([]);
    }
  });
  it('mantiene bloqueados los números reales y los marcadores sin resolver', () => {
    for (const changes of [{Destino:'51999999999'}, {'Texto / plantilla':'Hola {{nombre}}'}, {'Texto / plantilla':''}]) {
      expect(previewCentralCampaign(input([row(changes)]), now).jobs).toEqual([]);
    }
  });
  it('no toma una etiqueta o una fila de comunicaciones como saldo pendiente', () => {
    const source = input([row({Finalidad:'Cobranza'})]); source.campaign.purpose = 'collection';
    const result = previewCentralCampaign(source, now);
    expect(result.jobs).toEqual([]); expect(result.rows[0].reason).toContain('conciliar');
  });
  it('bloquea fechas ausentes, diferentes, inexistentes y vencimientos insuficientes', () => {
    for (const value of ['', '02/11/2026 09:00', '31/02/2026 09:00', '01/11/2026']) {
      expect(previewCentralCampaign(input([row({'Fecha prevista':value})]), now).jobs).toEqual([]);
    }
    expect(previewCentralCampaign(input(), Date.parse('2026-11-02T00:00:00Z')).jobs).toEqual([]);
  });
  it('respeta lotes e intervalos sin perder las filas que faltan', () => {
    const source = input([row(), row({Comunicacion_ID:'COM-2', Estudiante_ID:'EST-2', Destino:'TEST-alumno-2'})]);
    source.campaign.batch_limit = 1;
    expect(previewCentralCampaign(source, now).totals).toMatchObject({received:2, ready:1, deferred:1});
    source.campaign.batch_limit = 2;
    expect(previewCentralCampaign(source, now).jobs[1].run_at).toBe('2026-11-01T14:00:20.000Z');
  });
  it('rechaza otras bases, modo ambiguo y vencimiento anterior al inicio', () => {
    for (const changed of [{spreadsheet_id:'otra'}, {text_mode:'plantilla'},
      {campaign:{...input().campaign, expires_at:'2026-11-01T08:00:00-05:00'}}]) {
      expect(centralCampaignSchema.safeParse({...input(), ...changed}).success).toBe(false);
    }
  });
});

describe('fechas de las hojas en Lima', () => {
  it('interpreta fechas numéricas de Sheets, fecha local e ISO con zona', () => {
    expect(centralDateTime(46327.375)).toBe('2026-11-01T14:00:00.000Z');
    expect(centralDateTime('2026-11-01T09:00')).toBe('2026-11-01T14:00:00.000Z');
    expect(centralDateTime('2026-11-01T14:00:00Z')).toBe('2026-11-01T14:00:00.000Z');
  });
  it('rechaza texto ambiguo, serial sin hora e ISO inexistente', () => {
    for (const value of ['11-01-2026', '2026-02-31T09:00:00Z', 46327]) {
      expect(() => centralDateTime(value)).toThrow();
    }
  });
});
