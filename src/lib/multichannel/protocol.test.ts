import { describe, expect, it } from 'vitest';
import { simulationJobSchema, workerActionSchema } from './protocol';

const job = {
  channel: 'sms', line_key: 'TEST-linea-1', recipient: 'TEST-alumno-1',
  body: 'Recordatorio de prueba', dedup_key: 'campana-1-alumno-1',
  run_at: '2026-10-25T08:00:00-05:00', expires_at: '2026-10-26T08:00:00-05:00',
};

describe('protocolo multicanal de simulación', () => {
  it('acepta horario explícito de Lima y destinatario ficticio', () => {
    expect(simulationJobSchema.parse(job).priority).toBe(0);
  });
  it('rechaza un teléfono real y una línea real aunque se solicite envío', () => {
    expect(simulationJobSchema.safeParse({ ...job, recipient: '51934215366' }).success).toBe(false);
    expect(simulationJobSchema.safeParse({ ...job, line_key: '51934215366' }).success).toBe(false);
    expect(simulationJobSchema.safeParse({ ...job, channel: 'whatsapp' }).success).toBe(false);
  });
  it('rechaza horarios ambiguos, trabajos ya vencidos al programarse y prioridad ilimitada', () => {
    for (const overrides of [
      { run_at: '25/10/2026 08:00' }, { expires_at: job.run_at }, { priority: 101 },
    ]) expect(simulationJobSchema.safeParse({ ...job, ...overrides }).success).toBe(false);
  });
  it('no permite completar o iniciar sin una reserva identificada', () => {
    expect(workerActionSchema.safeParse({ action: 'complete' }).success).toBe(false);
    expect(workerActionSchema.safeParse({ action: 'claim', account_id: 'otra' }).success).toBe(true);
    // Unknown account_id is stripped: the server derives ownership from the credential.
    expect(workerActionSchema.parse({ action: 'claim', account_id: 'otra' })).toEqual({ action: 'claim' });
  });
});
