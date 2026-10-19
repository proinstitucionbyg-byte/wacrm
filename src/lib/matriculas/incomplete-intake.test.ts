import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/automations/engine', () => ({
  runAutomationById: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/ai/handoff-routing', () => ({
  routeConversationToArea: vi.fn(),
}));
vi.mock('./collect', () => ({ collectConversationEnrollments: vi.fn() }));
import {
  incompletePhase,
  incompleteIntakeText,
  missingWrittenFields,
  runIncompleteIntakes,
} from './incomplete-intake';
import { runAutomationById } from '@/lib/automations/engine';
import { collectConversationEnrollments } from './collect';
import type { SupabaseClient } from '@supabase/supabase-js';
const H = 3600000,
  clock = Date.parse('2026-10-11T12:00:00-05:00');
describe('protocolo excepcional de bienvenida', () => {
  it('espera exactamente hasta el plazo de dos horas, sin documentos', () => {
    expect(
      incompletePhase(clock, clock + 1, clock - H, null, false, false)
    ).toBeNull();
    expect(incompletePhase(clock, clock, clock - H, null, false, false)).toBe(
      'provisional'
    );
  });
  it('espera cuatro horas desde la bienvenida real o el check humano', () => {
    expect(
      incompletePhase(
        clock,
        clock - H,
        clock - H,
        clock - 4 * H + 1,
        false,
        false
      )
    ).toBeNull();
    expect(
      incompletePhase(clock, clock - H, clock - H, clock - 4 * H, false, false)
    ).toBe('intake_followup');
  });
  it('prioriza el último aviso a las 23 horas y nunca envía libremente fuera de 24 horas', () => {
    expect(
      incompletePhase(clock, clock + H, clock - 23 * H, null, false, false)
    ).toBe('provisional');
    expect(
      incompletePhase(
        clock,
        clock - H,
        clock - 23 * H,
        clock - 5 * H,
        false,
        false
      )
    ).toBe('intake_lastcall');
    expect(
      incompletePhase(
        clock,
        clock - H,
        clock - 24 * H,
        clock - 5 * H,
        false,
        false
      )
    ).toBeNull();
    expect(
      incompletePhase(clock, clock - H, NaN, null, false, false)
    ).toBeNull();
  });
  it('un nuevo mensaje renueva solo la ventana del canal, no vuelve a enviar seguimientos', () => {
    expect(
      incompletePhase(clock, clock - H, clock - 1, clock - 10 * H, true, true)
    ).toBeNull();
    expect(
      incompletePhase(clock, clock - H, clock - 1, null, false, false)
    ).toBe('provisional');
  });
  it('pide datos escritos y no afirma documentos emitidos ni inventa fechas de pago', () => {
    const text = incompleteIntakeText('provisional', {});
    expect(text).toContain('Todavía necesitamos completar tu registro para emitir');
    expect(text).not.toContain('• DIRECCION');
    expect(text).not.toContain('• DEPARTAMENTO');
    expect(text).not.toContain('• DISTRITO');
    expect(text).toContain('pantallazo');
    expect(text).not.toMatch(/día 15|día 30|inscripción está confirmada/i);
  });
  it('no solicita otra vez los campos completos y exige tutor si es menor', () => {
    const fields = missingWrittenFields({
      full_name: 'ALUMNO',
      document_number: '12345678',
      birth_date: '2020-01-01',
    });
    expect(fields).not.toContain('NOMBRE COMPLETO');
    expect(fields).not.toContain('NUMERO DE DOCUMENTO');
    expect(fields).toContain('DNI DEL TUTOR O PADRES');
  });
  it('no vuelve a pedir el DNI recibido cuando solo falta la revisión interna', () => {
    const text = incompleteIntakeText('intake_followup', {
      identity_message_ids: ['foto-recibida'],
    });
    expect(text).not.toContain('FOTO DEL DOCUMENTO O DATOS COMPLETOS');
  });
});

type Result = { data?: unknown; error?: { code?: string } | null };
function fixture(override: Record<string, Result[]> = {}) {
  const writes: { table: string; payload: Record<string, unknown> }[] = [];
  const data: Record<string, Result[]> = {
    incomplete_intake_watches: [
      {
        data: [
          {
            enrollment_id: 'draft',
            account_id: 'account',
            conversation_id: 'chat',
            welcome_due_at: new Date(clock - H).toISOString(),
          },
        ],
      },
      { error: null },
    ],
    enrollment_drafts: [
      { data: { status: 'collecting', data: {}, review_id: 'review' } },
    ],
    payment_reviews: [{ data: { status: 'validated' } }],
    conversations: [{ data: { contact_id: 'student' } }],
    messages: [{ data: [{ created_at: new Date(clock - H).toISOString() }] }],
    profiles: [
      {
        data: [
          { user_id: 'owner', account_role: 'owner' },
          { user_id: 'fidelity', account_role: 'agent', area: 'FIDELIZACION' },
        ],
      },
    ],
    enrollment_sequence_runs: [
      {
        data: [
          {
            id: 'welcome',
            stage: 'provisional',
            status: 'started',
            completed_at: null,
            backup_sent_at: null,
          },
        ],
      },
      { data: { id: 'welcome' } },
      { error: null },
      { error: null },
    ],
    notifications: [{ error: null }],
    automations: [{ data: [{ id: 'block' }] }],
    automation_steps: [
      {
        data: [
          { step_type: 'send_message', parent_step_id: null },
          { step_type: 'send_media', parent_step_id: null },
        ],
      },
    ],
    ...override,
  };
  const filters: unknown[][] = [];
  const db = {
    from(table: string) {
      const result = () =>
        Promise.resolve(data[table]?.shift() ?? { data: null, error: null });
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => {
          filters.push([table, ...args]);
          return chain;
        },
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        contains: () => chain,
        update: (payload: Record<string, unknown>) => {
          writes.push({ table, payload });
          return chain;
        },
        insert: (payload: Record<string, unknown>) => {
          writes.push({ table, payload });
          return chain;
        },
        upsert: (payload: Record<string, unknown>) => {
          writes.push({ table, payload });
          return chain;
        },
        single: result,
        maybeSingle: result,
        then: (fn: (r: Result) => unknown) => result().then(fn),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, writes, filters };
}
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(clock);
  vi.mocked(runAutomationById).mockClear().mockResolvedValue(true);
  vi.mocked(collectConversationEnrollments).mockClear();
});
describe('cola real de registro incompleto', () => {
  it('envía únicamente el bloque interno reservado del pago validado', async () => {
    const state = fixture();
    await runIncompleteIntakes(state.db);
    expect(collectConversationEnrollments).toHaveBeenCalledWith(state.db, 'account', 'chat', 'draft');
    expect(runAutomationById).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'account',
        conversationId: 'chat',
        contactId: 'student',
        automationId: 'block',
        sequenceId: 'welcome',
        requireComplete: true,
      })
    );
    expect(
      state.writes.some(
        (row) =>
          row.table === 'enrollment_sequence_runs' && row.payload.backup_sent_at
      )
    ).toBe(true);
    expect(
      state.writes.some((row) =>
        ['payment_reviews', 'enrollment_drafts'].includes(row.table)
      )
    ).toBe(false);
  });
  it('cierra sin enviar si ya completó el registro', async () => {
    const state = fixture({
      enrollment_drafts: [
        { data: { status: 'registered', review_id: 'review' } },
      ],
    });
    await runIncompleteIntakes(state.db);
    expect(runAutomationById).not.toHaveBeenCalled();
    expect(state.writes.some((row) => row.payload.closed_at)).toBe(true);
  });
  it('nunca envía con comprobante pendiente', async () => {
    await runIncompleteIntakes(
      fixture({ payment_reviews: [{ data: { status: 'pending' } }] }).db
    );
    expect(runAutomationById).not.toHaveBeenCalled();
  });
  it('respeta el check humano y la reserva de otro proceso', async () => {
    await runIncompleteIntakes(
      fixture({
        enrollment_sequence_runs: [
          {
            data: [
              {
                id: 'welcome',
                stage: 'provisional',
                completed_at: new Date(clock - H).toISOString(),
              },
            ],
          },
        ],
      }).db
    );
    expect(runAutomationById).not.toHaveBeenCalled();
    await runIncompleteIntakes(
      fixture({
        enrollment_sequence_runs: [
          { data: [{ id: 'welcome', stage: 'provisional' }] },
          { data: null, error: null },
        ],
      }).db
    );
    expect(runAutomationById).not.toHaveBeenCalled();
  });
  it('no marca enviado un bloque que fue modificado para incluir esperas', async () => {
    await runIncompleteIntakes(
      fixture({
        automation_steps: [
          { data: [{ step_type: 'wait', parent_step_id: null }] },
        ],
      }).db
    );
    expect(runAutomationById).not.toHaveBeenCalled();
  });
  it('un error no afirma bienvenida enviada y no consume correlativos', async () => {
    vi.mocked(runAutomationById).mockResolvedValue(false);
    const state = fixture();
    await runIncompleteIntakes(state.db);
    expect(state.writes.some((row) => row.payload.status === 'review')).toBe(
      true
    );
    expect(state.writes.some((row) => row.payload.backup_sent_at)).toBe(false);
  });
});
