import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const { route } = vi.hoisted(() => ({ route: vi.fn() }));
vi.mock('@/lib/ai/handoff-routing', () => ({ routeConversationToArea: route }));
import { syncPaidEnrollmentHandoff, URGENT_PAID_INTAKE_TAG } from './paid-intake-handoff';

const writes: { table: string; method: string; payload?: unknown }[] = [];
const resultFor: Record<string, unknown> = {};
function dbFixture() {
  const db = {
    from(table: string) {
      const chain: Record<string, (...args: unknown[]) => unknown> = {};
      for (const method of ['select','eq','limit','delete','insert','upsert','update'])
        chain[method] = (...args: unknown[]) => {
          if (['delete','insert','upsert','update'].includes(method)) writes.push({table,method,payload:args[0]});
          return chain;
        };
      chain.maybeSingle = async () => resultFor[table] ?? { data: null, error: null };
      chain.single = async () => resultFor[table] ?? { data: { id: 'urgent-tag' }, error: null };
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resultFor[table] ?? { data: [], error: null }).then(resolve);
      return chain;
    },
  };
  return db as unknown as SupabaseClient;
}

beforeEach(() => {
  writes.length = 0;
  route.mockReset().mockResolvedValue({ agentId: null });
  Object.keys(resultFor).forEach((key) => delete resultFor[key]);
});

describe('handoff de matrícula pagada', () => {
  it('manda a Fidelización y crea etiqueta/notificación urgente si hay datos pendientes', async () => {
    resultFor.conversations = { data: { contact_id: 'contact', user_id: 'owner', ai_handoff_area: 'VENTAS' }, error: null };
    resultFor.tags = { data: [{ id: 'urgent-tag' }], error: null };
    resultFor.profiles = { data: [{ user_id: 'fidelity', account_role: 'agent', area: 'FIDELIZACION' }], error: null };
    await syncPaidEnrollmentHandoff(dbFixture(), 'account', 'conversation', 'draft', {});

    expect(route).toHaveBeenCalledWith(expect.anything(), 'account', 'conversation', 'fidelizacion');
    expect(writes.some((write) => write.table === 'contact_tags' && write.method === 'upsert')).toBe(true);
    const notice = writes.find((write) => write.table === 'notifications')?.payload as Record<string, unknown>[];
    expect(notice[0].title).toContain('URGENTE');
    expect(notice[0].dedup_key).toBe('paid-intake-incomplete:draft');
  });

  it('quita solo la urgencia cuando los requisitos están completos y ya estaba en Fidelización', async () => {
    resultFor.conversations = { data: { contact_id: 'contact', user_id: 'owner', ai_handoff_area: 'FIDELIZACION' }, error: null };
    resultFor.tags = { data: [{ id: 'urgent-tag' }], error: null };
    const data = {
      full_name:'ALUMNO',document_type:'DNI',document_number:'12345678',birth_date:'1990-01-01',
      phone1:'51987654321',email:'a@example.com',course:'NUTRICION Y DIETETICA',start_date:'2026-10-30',
      promotion_id:'PROMO',payment_date:'2026-10-20',amount:'19.90',payment_method:'YAPE',
      identity_confirmed:true,identity_message_ids:['11111111-1111-4111-8111-111111111111'],
      offer_confirmed:true,prices:[19.9,49.9,49.9,49.9,49.9,49.9],
    };
    await syncPaidEnrollmentHandoff(dbFixture(), 'account', 'conversation', 'draft', data);

    expect(route).not.toHaveBeenCalled();
    expect(writes.some((write) => write.table === 'contact_tags' && write.method === 'delete')).toBe(true);
    expect(URGENT_PAID_INTAKE_TAG).toContain('EXPEDIENTE');
  });
});
