import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/automations/engine', () => ({ runAutomationById: vi.fn() }));
import { billingDay, startEnrollmentSequence, resumeEnrollmentAfterDocuments } from './sequence';
import { runAutomationById } from '@/lib/automations/engine';
import type { SupabaseClient } from '@supabase/supabase-js';
type Result = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
};
function database(results: Record<string, Result[]>) {
  const writes: { table: string; payload: Record<string, unknown> }[] = [];
  const filters: unknown[][] = [];
  return {
    writes,
    filters,
    db: {
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
      from(table: string) {
        const resolve = () =>
          Promise.resolve(
            results[table]?.shift() ?? { data: null, error: null }
          );
        const chain = {
          select: () => chain,
          eq: (...args: unknown[]) => {
            filters.push([table, ...args]);
            return chain;
          },
          contains: () => chain,
          insert: (payload: Record<string, unknown>) => {
            writes.push({ table, payload });
            return chain;
          },
          update: (payload: Record<string, unknown>) => {
            writes.push({ table, payload });
            return chain;
          },
          upsert: (payload: Record<string, unknown>) => {
            writes.push({ table, payload });
            return chain;
          },
          single: resolve,
          maybeSingle: resolve,
          then: (fn: (result: Result) => unknown) => resolve().then(fn),
        };
        return chain;
      },
    } as unknown as SupabaseClient,
  };
}
const complete = () => ({
  enrollment_drafts: [
    {
      data: {
        status: 'registered',
        review_id: 'review',
        conversation_id: 'chat',
        data: { start_date: '2026-10-06' },
      },
    },
  ],
  payment_reviews: [{ data: { status: 'validated' } }],
  enrollment_document_deliveries: [
    {
      data: ['BOLETA', 'FICHA', 'CRONOGRAMA'].map((kind) => ({
        kind,
        status: 'sent',
      })),
    },
  ],
  automations: [
    {
      data: [
        { id: 'final30', trigger_config: { billing_day: 30 } },
        { id: 'final15', trigger_config: { billing_day: 15 } },
      ],
    },
  ],
  conversations: [{ data: { contact_id: 'contact' } }],
  enrollment_sequence_runs: [{ data: { id: 'sequence' } }, { error: null }],
});
beforeEach(() => {
  vi.mocked(runAutomationById).mockReset().mockResolvedValue(true);
});
describe('automatizacion de cierre segun inicio oficial', () => {
  it.each([
    [1, 30],
    [9, 30],
    [10, 15],
    [25, 15],
    [26, 30],
    [31, 30],
  ])('inicio dia %s usa cobro %s', (day, expected) =>
    expect(billingDay(`2026-10-${String(day).padStart(2, '0')}`)).toBe(expected)
  );
  it('rechaza fechas imposibles', () =>
    expect(() => billingDay('2026-02-30')).toThrow());
});
describe('secuencia protegida de matricula', () => {
  it('avisa al CEO, administración y fidelización si la continuación falla sin repetir PDF', async () => {
    const responses: Record<string, Result[]> = complete();
    responses.automations = [{ data: [] }];
    responses.enrollment_drafts.push({ data: { conversation_id: 'chat' } });
    responses.profiles = [{ data: [
      { user_id: 'ceo', account_role: 'owner' },
      { user_id: 'admin', account_role: 'admin' },
      { user_id: 'fidelity', account_role: 'agent', area: 'fidelizacion' },
      { user_id: 'sales', account_role: 'agent', area: 'ventas' },
    ] }];
    const state = database(responses);
    await resumeEnrollmentAfterDocuments(state.db, 'account', 'draft');
    const notices = state.writes.find(row => row.table === 'notifications')?.payload;
    expect(notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: 'ceo', dedup_key: 'enrollment-final-error:draft' }),
      expect.objectContaining({ user_id: 'admin' }),
      expect.objectContaining({ user_id: 'fidelity', target_url: '/inbox?c=chat' }),
    ]));
    expect(notices).toHaveLength(3);
    expect(state.writes.some(row => row.table === 'enrollment_document_deliveries')).toBe(false);
    expect(runAutomationById).not.toHaveBeenCalled();
  });
  it('no genera una alerta cuando todavía faltan documentos', async () => {
    const responses = complete();
    responses.enrollment_document_deliveries[0].data = [];
    const state = database(responses);
    await resumeEnrollmentAfterDocuments(state.db, 'account', 'draft');
    expect(state.writes).toHaveLength(0);
  });
  it('también alerta si el motor devuelve fallo sin lanzar excepción', async () => {
    vi.mocked(runAutomationById).mockResolvedValue(false);
    const responses: Record<string, Result[]> = complete();
    responses.enrollment_drafts.push({ data: { conversation_id: 'chat' } });
    responses.profiles = [{ data: [{ user_id: 'ceo', account_role: 'owner' }] }];
    const state = database(responses);
    await resumeEnrollmentAfterDocuments(state.db, 'account', 'draft');
    expect(state.writes.some(row => row.table === 'notifications')).toBe(true);
    expect(state.writes.some(row => row.payload.status === 'review')).toBe(true);
  });
  it('un fallo de la alerta no cambia el estado de documentos ya entregados', async () => {
    const responses: Record<string, Result[]> = complete();
    responses.automations = [{ error: { message: 'database unavailable' } }];
    responses.enrollment_drafts.push({ error: { message: 'notification lookup failed' } });
    const state = database(responses);
    await expect(resumeEnrollmentAfterDocuments(state.db, 'account', 'draft')).resolves.toBeUndefined();
    expect(state.writes).toHaveLength(0);
  });
  it('conserva la confirmación documental pero cancela una segunda bienvenida si la excepcional ya se gestionó', async () => {
    const state = database(complete());
    vi.spyOn(state.db, 'rpc').mockResolvedValue({data:true,error:null} as never);
    await startEnrollmentSequence(state.db,'account','draft','final');
    expect(state.writes.find(row=>row.table==='enrollment_sequence_runs'&&row.payload.stage==='final')?.payload.completed_at).toBeTruthy();
    expect(state.writes.at(-1)?.payload.status).toBe('closed');
    expect(runAutomationById).not.toHaveBeenCalled();
  });
  it.each([
    ['2026-10-06', 'final30'],
    ['2026-10-15', 'final15'],
  ])(
    'solo inicia despues de validacion y tres PDF: %s',
    async (date, automationId) => {
      const responses = complete();
      responses.enrollment_drafts[0].data.data.start_date = date;
      const state = database(responses);
      await startEnrollmentSequence(state.db, 'account', 'draft', 'final');
      expect(runAutomationById).toHaveBeenCalledWith({
        accountId: 'account',
        automationId,
        contactId: 'contact',
        conversationId: 'chat',
        sequenceId: 'sequence',
      });
      expect(state.writes.at(-1)?.payload.status).toBe('started');
    }
  );
  it.each(['pending', 'observation', 'rejected'])(
    'no inicia con pago %s',
    async (status) => {
      const responses = complete();
      responses.payment_reviews[0].data.status = status;
      await startEnrollmentSequence(
        database(responses).db,
        'account',
        'draft',
        'final'
      );
      expect(runAutomationById).not.toHaveBeenCalled();
    }
  );
  it.each(['BOLETA', 'FICHA', 'CRONOGRAMA'])(
    'espera que %s este enviado',
    async (kind) => {
      const responses = complete();
      responses.enrollment_document_deliveries[0].data =
        responses.enrollment_document_deliveries[0].data.filter(
          (d) => d.kind !== kind
        );
      await startEnrollmentSequence(
        database(responses).db,
        'account',
        'draft',
        'final'
      );
      expect(runAutomationById).not.toHaveBeenCalled();
    }
  );
  it('no duplica la secuencia en reintentos', async () => {
    const responses: Record<string, Result[]> = complete();
    responses.enrollment_sequence_runs = [{ error: { code: '23505' } }];
    await startEnrollmentSequence(
      database(responses).db,
      'account',
      'draft',
      'final'
    );
    expect(runAutomationById).not.toHaveBeenCalled();
  });
  it('deja un envio fallido para revision y no afirma que se envio', async () => {
    vi.mocked(runAutomationById).mockResolvedValue(false);
    const state = database(complete());
    await startEnrollmentSequence(state.db, 'account', 'draft', 'final');
    expect(state.writes.at(-1)?.payload.status).toBe('review');
  });
  it('solicita datos al recibir comprobante sin aprobarlo', async () => {
    const state = database({
      payment_reviews: [
        { data: { status: 'pending', conversation_id: 'chat' } },
      ],
      automations: [{ data: [{ id: 'receipt', trigger_config: {} }] }],
      conversations: [{ data: { contact_id: 'contact' } }],
      enrollment_sequence_runs: [{ data: { id: 'sequence' } }, { error: null }],
    });
    await startEnrollmentSequence(state.db, 'account', 'review', 'receipt');
    expect(runAutomationById).toHaveBeenCalledWith(
      expect.objectContaining({
        automationId: 'receipt',
        sequenceId: 'sequence',
      })
    );
    expect(
      state.writes.every((w) => w.table === 'enrollment_sequence_runs')
    ).toBe(true);
  });
});
