import { describe, it, expect, beforeEach, vi } from "vitest";

// Shared mock state for the service-role client. Lives in a hoisted block
// so the vi.mock factory below can close over it.
const h = vi.hoisted(() => ({
  state: {
    owned: null as { id: string } | null,
    ownedCustomField: null as { id: string } | null,
    automations: [] as Record<string, unknown>[],
    steps: [] as Record<string, unknown>[],
    stepsByAutomationId: {} as Record<string, Record<string, unknown>[]>,
    logStatus: 'success',
    fromCalls: [] as string[],
    updateCalls: [] as { table: string; filters: [string, string, unknown][] }[],
    upsertCalls: [] as { table: string; payload: unknown }[],
    logAutomationIds: [] as string[],
    latestGreetingAutomationId: null as string | null,
    greetingHistory: [] as { automation_id: string; status: string }[],
    pendingCancels: 0,
    pendingInserts: [] as Record<string, unknown>[],
    pendingRows: [] as Record<string, unknown>[],
    messageStatus: 'sent' as 'sent' | 'delivered' | 'read' | 'failed',
  },
}));

vi.mock("./admin-client", () => {
  const { state } = h;

  function resolve(ops: {
    table: string;
    type: string;
    payload?: unknown;
    filters: [string, string, unknown][];
  }) {
    const { table, type } = ops;
    if (table === "contacts") {
      if (type === "update") {
        state.updateCalls.push({ table, filters: ops.filters });
        return { data: null, error: null };
      }
      // ownership guard / condition read
      return { data: state.owned, error: null };
    }
    if (table === "custom_fields") {
      // account-scoped ownership lookup for a custom field definition
      return { data: state.ownedCustomField, error: null };
    }
    if (table === "contact_custom_values") {
      if (type === "upsert") {
        state.upsertCalls.push({ table, payload: ops.payload });
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
    if (table === "automations") return {
      data: ops.filters.some(([operator, key]) => operator === 'eq' && key === 'id')
        ? state.automations.find((automation) => automation.id === ops.filters.find(
            ([operator, key]) => operator === 'eq' && key === 'id',
          )?.[2]) ?? null
        : state.automations,
      error: null,
    };
    if (table === "automation_logs") {
      if (type === "insert") {
        state.logAutomationIds.push((ops.payload as { automation_id: string }).automation_id);
        return { data: { id: `log${state.logAutomationIds.length}` }, error: null };
      }
      if (type === "update") return { data: null, error: null };
      if (ops.filters.some(([operator, key]) => operator === 'in' && key === 'automation_id')) {
        if (state.greetingHistory.length > 0) {
          const statuses = ops.filters.find(([operator, key]) => operator === 'in' && key === 'status')?.[2] as string[] | undefined;
          const exactStatus = ops.filters.find(([operator, key]) => operator === 'eq' && key === 'status')?.[2];
          return { data: state.greetingHistory.filter((entry) =>
            statuses ? statuses.includes(entry.status) : exactStatus === undefined || entry.status === exactStatus,
          ).slice(0, 1), error: null };
        }
        return { data: state.latestGreetingAutomationId
          ? [{ automation_id: state.latestGreetingAutomationId }] : [], error: null };
      }
      return { data: { steps_executed: [], status: state.logStatus }, error: null };
    }
    if (table === "messages") return { data: { status: state.messageStatus }, error: null };
    if (table === "automation_steps") {
      const automationId = ops.filters.find(
        ([operator, key]) => operator === 'eq' && key === 'automation_id',
      )?.[2];
      const startPosition = ops.filters.find(
        ([operator, key]) => operator === 'gte' && key === 'position',
      )?.[2] as number | undefined;
      const endPosition = ops.filters.find(
        ([operator, key]) => operator === 'lte' && key === 'position',
      )?.[2] as number | undefined;
      const positions = ops.filters.find(
        ([operator, key]) => operator === 'in' && key === 'position',
      )?.[2] as number[] | undefined;
      const candidate = typeof automationId === 'string'
        ? state.stepsByAutomationId[automationId] ?? state.steps : state.steps;
      return {
        data: candidate.filter(step => (startPosition === undefined || Number(step.position) >= startPosition)
          && (endPosition === undefined || Number(step.position) <= endPosition)
          && (!positions || positions.includes(Number(step.position)))),
        error: null,
      };
    }
    if (table === "automation_pending_executions" && type === "insert") {
      state.pendingInserts.push(ops.payload as Record<string, unknown>);
      return { data: null, error: null };
    }
    if (table === "automation_pending_executions" && type === "update") {
      state.pendingCancels++;
      return { data: (ops.payload as { status?: string })?.status === 'running'
        ? { id: ops.filters.find(([, key]) => key === 'id')?.[2] } : null, error: null };
    }
    if (table === "automation_pending_executions") return { data: state.pendingRows, error: null };
    return { data: null, error: null };
  }

  function builder(table: string) {
    const ops = {
      table,
      type: "select",
      payload: undefined as unknown,
      filters: [] as [string, string, unknown][],
    };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((ops.type = "insert"), (ops.payload = p), b),
      update: (p: unknown) => ((ops.type = "update"), (ops.payload = p), b),
      delete: () => ((ops.type = "delete"), b),
      upsert: (p: unknown) => ((ops.type = "upsert"), (ops.payload = p), b),
      eq: (k: string, v: unknown) => (ops.filters.push(["eq", k, v]), b),
      in: (k: string, v: unknown) => (ops.filters.push(["in", k, v]), b),
      gte: (k: string, v: unknown) => (ops.filters.push(['gte', k, v]), b),
      lte: (k: string, v: unknown) => (ops.filters.push(['lte', k, v]), b),
      is: () => b,
      contains: () => b,
      order: () => b,
      limit: () => b,
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(onF, onR),
    };
    return b;
  }

  return {
    supabaseAdmin: () => ({
      from: (t: string) => {
        state.fromCalls.push(t);
        return builder(t);
      },
      rpc: () => Promise.resolve({ error: null }),
    }),
  };
});

vi.mock("./meta-send", () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendTemplate: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendInteractive: vi.fn(async () => ({ whatsapp_message_id: "m1" })),
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: "wamid.image" })),
}));

import { resumeDeliveredMessage, resumePendingExecution, runAutomationById, runAutomationsForTrigger, triggerMatches } from "./engine";
import { engineSendInteractive, engineSendMedia } from './meta-send';
import { INITIAL_GREETING_ID, RETURN_GREETING_ID } from './greeting-continuity';
import type { Automation } from "@/types";

const ACCOUNT = "acct-1";

beforeEach(() => {
  vi.clearAllMocks();
  h.state.owned = null;
  h.state.ownedCustomField = null;
  h.state.automations = [];
  h.state.steps = [];
  h.state.stepsByAutomationId = {};
  h.state.logStatus = 'success';
  h.state.fromCalls = [];
  h.state.updateCalls = [];
  h.state.upsertCalls = [];
  h.state.logAutomationIds = [];
  h.state.latestGreetingAutomationId = null;
  h.state.greetingHistory = [];
  h.state.pendingCancels = 0;
  h.state.pendingInserts = [];
  h.state.pendingRows = [];
  h.state.messageStatus = 'sent';
});

describe('WhatsApp delivery order', () => {
  it('resumes the next block immediately when Meta confirms delivery', async () => {
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [
      { id: 'buttons', automation_id: 'a1', step_type: 'send_buttons', position: 1,
        parent_step_id: null, step_config: { kind: 'buttons', body: 'Continua', buttons: [{ id: 'one', title: 'Seguir' }] } },
    ];
    h.state.messageStatus = 'delivered';
    h.state.pendingRows = [{
      id: 'pending', automation_id: 'a1', account_id: ACCOUNT, user_id: 'u1',
      contact_id: 'c1', log_id: 'log1', parent_step_id: null, branch: null,
      next_step_position: 1, context: { conversation_id: 'chat', await_delivery_message_id: 'wamid.text', await_delivery_only: true },
    }];
    await resumeDeliveredMessage('wamid.text', 'chat', ACCOUNT);
    expect(engineSendInteractive).toHaveBeenCalledTimes(1);
  });

  it('does not restart a keyword sequence while its delivery is pending', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [{ ...automationWithUpdateStep(), trigger_type: 'keyword_match',
      trigger_config: { keywords: ['matricularme'] } }];
    h.state.pendingRows = [{ context: { conversation_id: 'chat', await_delivery_message_id: 'wamid.text', await_delivery_only: true } }];
    const matched = await runAutomationsForTrigger({ accountId: ACCOUNT, triggerType: 'keyword_match',
      contactId: 'c1', context: { conversation_id: 'chat', message_text: 'Cómo matricularme' } });
    expect(matched).toBe(true);
    expect(h.state.logAutomationIds).toHaveLength(0);
    expect(h.state.pendingCancels).toBe(0);
  });

  it('does not send a later block until Meta confirms the prior image was delivered', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [
      { id: 'image', automation_id: 'a1', step_type: 'send_media', position: 0,
        parent_step_id: null, step_config: { media_type: 'image', url: 'https://example.org/image.png' } },
      { id: 'buttons', automation_id: 'a1', step_type: 'send_buttons', position: 1,
        parent_step_id: null, step_config: { kind: 'buttons', body: 'Continua', buttons: [{ id: 'one', title: 'Seguir' }] } },
    ];

    await runAutomationById({ accountId: ACCOUNT, automationId: 'a1', contactId: 'c1', conversationId: 'chat' });
    expect(engineSendMedia).toHaveBeenCalledTimes(1);
    expect(engineSendInteractive).not.toHaveBeenCalled();
    expect(h.state.pendingInserts).toHaveLength(1);
    expect(h.state.pendingInserts[0]).toEqual(expect.objectContaining({
      next_step_position: 1,
      context: expect.objectContaining({ await_delivery_message_id: 'wamid.image' }),
    }));

    const pending = {
      id: 'pending', automation_id: 'a1', account_id: ACCOUNT, user_id: 'u1',
      contact_id: 'c1', log_id: 'log1', parent_step_id: null, branch: null,
      next_step_position: 1, context: h.state.pendingInserts[0].context as { conversation_id: string },
    };
    await resumePendingExecution(pending);
    expect(engineSendInteractive).not.toHaveBeenCalled();

    h.state.messageStatus = 'delivered';
    await resumePendingExecution(pending);
    expect(engineSendInteractive).toHaveBeenCalledTimes(1);
  });

  it('continues after media spacing when a delivered webhook is missing', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [
      { id: 'image', automation_id: 'a1', step_type: 'send_media', position: 0,
        parent_step_id: null, step_config: { media_type: 'image', url: 'https://example.org/image.png' } },
      { id: 'buttons', automation_id: 'a1', step_type: 'send_buttons', position: 1,
        parent_step_id: null, step_config: { kind: 'buttons', body: 'Continua', buttons: [{ id: 'one', title: 'Seguir' }] } },
    ];
    await runAutomationById({ accountId: ACCOUNT, automationId: 'a1', contactId: 'c1', conversationId: 'chat' });
    const context = { ...h.state.pendingInserts[0].context as Record<string, unknown>, conversation_id: 'chat',
      await_delivery_started_at: new Date(Date.now() - 120_000).toISOString() };
    await resumePendingExecution({
      id: 'pending', automation_id: 'a1', account_id: ACCOUNT, user_id: 'u1',
      contact_id: 'c1', log_id: 'log1', parent_step_id: null, branch: null,
      next_step_position: 1, context,
    });
    expect(engineSendInteractive).toHaveBeenCalledTimes(1);
  });

  it('keeps the configured wait and holds its next block while delivery is unconfirmed', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [
      { id: 'image', automation_id: 'a1', step_type: 'send_media', position: 0,
        parent_step_id: null, step_config: { media_type: 'image', url: 'https://example.org/image.png' } },
      { id: 'wait', automation_id: 'a1', step_type: 'wait', position: 1,
        parent_step_id: null, step_config: { amount: 1, unit: 'minutes' } },
      { id: 'buttons', automation_id: 'a1', step_type: 'send_buttons', position: 2,
        parent_step_id: null, step_config: { kind: 'buttons', body: 'Continua', buttons: [{ id: 'one', title: 'Seguir' }] } },
    ];
    await runAutomationById({ accountId: ACCOUNT, automationId: 'a1', contactId: 'c1', conversationId: 'chat' });
    expect(h.state.pendingInserts).toHaveLength(1);
    expect(h.state.pendingInserts[0]).toEqual(expect.objectContaining({ next_step_position: 2 }));
    const pending = {
      id: 'pending', automation_id: 'a1', account_id: ACCOUNT, user_id: 'u1',
      contact_id: 'c1', log_id: 'log1', parent_step_id: null, branch: null,
      next_step_position: 2, context: h.state.pendingInserts[0].context as { conversation_id: string },
    };
    expect((pending.context as { await_delivery_only?: boolean }).await_delivery_only).not.toBe(true);
    h.state.pendingRows = [pending];
    h.state.messageStatus = 'delivered';
    await resumeDeliveredMessage('wamid.image', 'chat', ACCOUNT);
    expect(engineSendInteractive).not.toHaveBeenCalled();
    h.state.messageStatus = 'sent';
    await resumePendingExecution(pending);
    expect(engineSendInteractive).not.toHaveBeenCalled();
    h.state.messageStatus = 'delivered';
    await resumePendingExecution(pending);
    expect(engineSendInteractive).toHaveBeenCalledTimes(1);
  });
});

describe('confirmed complete delivery', () => {
  it.each(['partial', 'failed'])('does not confirm %s as complete', async (status) => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.logStatus = status;
    expect(await runAutomationById({
      accountId: ACCOUNT, automationId: 'a1', contactId: 'c1',
      conversationId: 'chat', sequenceId: 'welcome', requireComplete: true,
    })).toBe(false);
  });
  it('confirms a successful block', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    expect(await runAutomationById({
      accountId: ACCOUNT, automationId: 'a1', contactId: 'c1',
      conversationId: 'chat', sequenceId: 'welcome', requireComplete: true,
    })).toBe(true);
  });
  it('preserves existing partial launch behavior without the strict option', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.logStatus = 'partial';
    expect(await runAutomationById({
      accountId: ACCOUNT, automationId: 'a1', contactId: 'c1',
      conversationId: 'chat', sequenceId: 'welcome',
    })).toBe(true);
  });
  it('does not report a failed automation as launched to the idle follow-up', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.logStatus = 'failed';
    expect(await runAutomationById({
      accountId: ACCOUNT, automationId: 'a1', contactId: 'c1',
      conversationId: 'chat',
    })).toBe(false);
  });
});

describe('run_automation chaining', () => {
  it('runs only A3 through A5 and then continues the parent', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep(), { ...automationWithUpdateStep(), id: 'a2' }];
    h.state.stepsByAutomationId = {
      a1: [
        { id: 'link', automation_id: 'a1', step_type: 'run_automation', position: 0,
          parent_step_id: null, step_config: { automation_id: 'a2', start_step: 3, end_step: 5 } },
        { id: 'after', automation_id: 'a1', step_type: 'update_contact_field', position: 1,
          parent_step_id: null, step_config: { field: 'company', value: 'parent' } },
      ],
      a2: Array.from({ length: 6 }, (_, position) => ({
        id: `child${position}`, automation_id: 'a2', step_type: 'update_contact_field',
        position, parent_step_id: null, step_config: { field: 'company', value: `A${position + 1}` },
      })),
    };
    await runAutomationById({ accountId: ACCOUNT, automationId: 'a1', contactId: 'c1', conversationId: 'chat' });
    expect(h.state.logAutomationIds).toEqual(['a1', 'a2']);
    expect(h.state.updateCalls).toHaveLength(4);
  });

  it('keeps the A5 boundary when A3 waits and then resumes the parent', async () => {
    h.state.owned = { id: 'c1' };
    h.state.logStatus = 'partial';
    h.state.automations = [automationWithUpdateStep(), { ...automationWithUpdateStep(), id: 'a2' }];
    h.state.stepsByAutomationId = {
      a1: [
        { id: 'link', automation_id: 'a1', step_type: 'run_automation', position: 0,
          parent_step_id: null, step_config: { automation_id: 'a2', start_step: 3, end_step: 5 } },
        { id: 'after', automation_id: 'a1', step_type: 'update_contact_field', position: 1,
          parent_step_id: null, step_config: { field: 'company', value: 'parent' } },
      ],
      a2: [
        { id: 'before', automation_id: 'a2', step_type: 'update_contact_field', position: 0,
          parent_step_id: null, step_config: { field: 'company', value: 'A1' } },
        { id: 'wait', automation_id: 'a2', step_type: 'wait', position: 2,
          parent_step_id: null, step_config: { amount: 10, unit: 'minutes' } },
        ...[3, 4, 5].map(position => ({ id: `child${position}`, automation_id: 'a2',
          step_type: 'update_contact_field', position, parent_step_id: null,
          step_config: { field: 'company', value: `A${position + 1}` } })),
      ],
    };
    await runAutomationById({ accountId: ACCOUNT, automationId: 'a1', contactId: 'c1', conversationId: 'chat' });
    expect(h.state.pendingInserts).toHaveLength(2);
    const childPending = h.state.pendingInserts[0];
    expect(childPending.context).toEqual(expect.objectContaining({
      automation_step_end_by_id: expect.objectContaining({ a2: 4 }),
    }));
    h.state.logStatus = 'success';
    await resumePendingExecution({
      id: 'child-pending', automation_id: 'a2', account_id: ACCOUNT, user_id: 'u1',
      contact_id: 'c1', log_id: 'log2', parent_step_id: null, branch: null,
      next_step_position: 3, context: childPending.context as { conversation_id: string },
    });
    expect(h.state.updateCalls).toHaveLength(2);
    await resumePendingExecution({
      id: 'parent-pending', automation_id: 'a1', account_id: ACCOUNT, user_id: 'u1',
      contact_id: 'c1', log_id: 'log1', parent_step_id: null, branch: null,
      next_step_position: 1, context: h.state.pendingInserts[1].context as { conversation_id: string },
    });
    expect(h.state.updateCalls).toHaveLength(3);
  });

  it('holds the parent after a linked block schedules its own wait', async () => {
    h.state.owned = { id: 'c1' };
    h.state.logStatus = 'partial';
    h.state.automations = [automationWithUpdateStep(), { ...automationWithUpdateStep(), id: 'a2' }];
    h.state.stepsByAutomationId = {
      a1: [
        { id: 'link', automation_id: 'a1', step_type: 'run_automation', position: 0,
          parent_step_id: null, step_config: { automation_id: 'a2' } },
        { id: 'after', automation_id: 'a1', step_type: 'update_contact_field', position: 1,
          parent_step_id: null, step_config: { field: 'company', value: 'after child' } },
      ],
      a2: [{ id: 'wait', automation_id: 'a2', step_type: 'wait', position: 0,
        parent_step_id: null, step_config: { amount: 10, unit: 'minutes' } }],
    };
    await runAutomationById({ accountId: ACCOUNT, automationId: 'a1', contactId: 'c1', conversationId: 'chat' });
    expect(h.state.pendingInserts).toHaveLength(2);
    expect(h.state.pendingInserts[1]).toEqual(expect.objectContaining({
      automation_id: 'a1', next_step_position: 1,
      context: expect.objectContaining({ await_child_log_id: 'log2' }),
    }));
    expect(h.state.updateCalls).toHaveLength(0);
    h.state.logStatus = 'success';
    await resumePendingExecution({
      id: 'parent-pending', automation_id: 'a1', account_id: ACCOUNT, user_id: 'u1',
      contact_id: 'c1', log_id: 'log1', parent_step_id: null, branch: null,
      next_step_position: 1, context: h.state.pendingInserts[1].context as { conversation_id: string },
    });
    expect(h.state.updateCalls).toHaveLength(1);
  });

  it('runs the selected active automation in the same account', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [
      automationWithUpdateStep(),
      { ...automationWithUpdateStep(), id: 'a2', name: 'Segundo bloque' },
    ];
    h.state.stepsByAutomationId = {
      a1: [{
        id: 'link', automation_id: 'a1', step_type: 'run_automation', position: 0,
        parent_step_id: null, step_config: { automation_id: 'a2' },
      }],
      a2: [{
        id: 'message', automation_id: 'a2', step_type: 'send_message', position: 0,
        parent_step_id: null, step_config: { text: 'Continuacion segura' },
      }],
    };

    expect(await runAutomationById({
      accountId: ACCOUNT,
      automationId: 'a1',
      contactId: 'c1',
      conversationId: 'chat',
    })).toBe(true);
    expect(h.state.logAutomationIds).toEqual(['a1', 'a2']);
  });

  it('blocks a circular link without starting the same automation twice', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [automationWithUpdateStep()];
    h.state.stepsByAutomationId = {
      a1: [{
        id: 'loop', automation_id: 'a1', step_type: 'run_automation', position: 0,
        parent_step_id: null, step_config: { automation_id: 'a1' },
      }],
    };

    await runAutomationById({
      accountId: ACCOUNT,
      automationId: 'a1',
      contactId: 'c1',
      conversationId: 'chat',
    });
    expect(h.state.logAutomationIds).toEqual(['a1']);
  });
});

describe('automated inbound guard', () => {
  it('consumes an explicit bot response before loading automations', async () => {
    const matched = await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: 'new_message_received',
      contactId: 'c1',
      context: { message_text: 'Este es un mensaje automatico. No responda a este mensaje.' },
    });

    expect(matched).toBe(true);
    expect(h.state.fromCalls).not.toContain('automations');
    expect(h.state.logAutomationIds).toEqual([]);
  });
});

describe("runAutomationsForTrigger — tenant isolation", () => {
  it("refuses to dispatch when the contact is not in the account (GHSA-63cv-2c49-m5v3)", async () => {
    // Ownership lookup returns nothing — the contact belongs to another tenant.
    h.state.owned = null;
    // If the guard failed, this automation would run an update_contact_field step.
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "victim-contact-uuid",
      context: { message_text: "manual trigger" },
    });

    // Bailed at the guard: never fetched automations, never wrote a contact.
    expect(h.state.fromCalls).toContain("contacts");
    expect(h.state.fromCalls).not.toContain("automations");
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("proceeds past the guard when the contact belongs to the account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = []; // no matching automations; just prove we got past the guard

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.fromCalls).toContain("automations");
  });

  it("scopes the update_contact_field write to the automation's account", async () => {
    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [updateStep()];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.updateCalls).toHaveLength(1);
    const filters = h.state.updateCalls[0].filters;
    expect(filters).toContainEqual(["eq", "id", "c1"]);
    expect(filters).toContainEqual(["eq", "account_id", ACCOUNT]);
  });
});

describe('greeting continuity dispatch', () => {
  const greetings = [INITIAL_GREETING_ID, RETURN_GREETING_ID].map((id) => ({
    id, account_id: ACCOUNT, user_id: 'u1', trigger_type: 'keyword_match',
    trigger_config: { match_type: 'exact', keywords: ['hola'] }, is_active: true,
  }));

  it.each([
    ['2026-10-12T12:01:00.000Z', RETURN_GREETING_ID],
    ['2026-10-12T12:00:00.000Z', INITIAL_GREETING_ID],
  ])('runs only the right existing greeting and preserves pending waits', async (previous, expected) => {
    h.state.owned = { id: 'c1' };
    h.state.automations = greetings;
    await runAutomationsForTrigger({ accountId: ACCOUNT, triggerType: 'keyword_match', contactId: 'c1',
      context: { message_text: 'Hola!', conversation_id: 'chat', previous_inbound_at: previous,
        inbound_at: '2026-10-12T15:00:00.000Z' } });
    expect(h.state.logAutomationIds).toEqual([expected]);
    expect(h.state.pendingCancels).toBe(0);
  });

  it('consumes the third and later generic greetings without repeating the return menu', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = greetings;
    h.state.latestGreetingAutomationId = RETURN_GREETING_ID;
    const matched = await runAutomationsForTrigger({ accountId: ACCOUNT, triggerType: 'keyword_match', contactId: 'c1',
      context: { message_text: 'Hola!', conversation_id: 'chat', previous_inbound_at: '2026-10-12T14:00:00.000Z',
        inbound_at: '2026-10-12T15:00:00.000Z' } });
    expect(matched).toBe(true);
    expect(h.state.logAutomationIds).toEqual([]);
    expect(h.state.pendingCancels).toBe(0);
  });

  it('recognizes the new initial greeting even when a wait left its log partial', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = greetings;
    h.state.greetingHistory = [
      { automation_id: INITIAL_GREETING_ID, status: 'partial' },
      { automation_id: RETURN_GREETING_ID, status: 'success' },
    ];
    await runAutomationsForTrigger({ accountId: ACCOUNT, triggerType: 'keyword_match', contactId: 'c1',
      context: { message_text: 'Hola!', conversation_id: 'chat', previous_inbound_at: '2026-10-12T14:00:00.000Z',
        inbound_at: '2026-10-12T15:00:00.000Z' } });
    expect(h.state.logAutomationIds).toEqual([RETURN_GREETING_ID]);
  });

  it('starts a new cycle after three hours without a customer message', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = greetings;
    h.state.latestGreetingAutomationId = RETURN_GREETING_ID;
    await runAutomationsForTrigger({ accountId: ACCOUNT, triggerType: 'keyword_match', contactId: 'c1',
      context: { message_text: 'Hola!', conversation_id: 'chat', previous_inbound_at: '2026-10-12T12:00:00.000Z',
        inbound_at: '2026-10-12T15:00:00.000Z' } });
    expect(h.state.logAutomationIds).toEqual([INITIAL_GREETING_ID]);
  });
});

describe('overlapping keyword routes', () => {
  it('ignores a blank keyword rather than matching every inbound text', () => {
    const automation = { ...automationWithUpdateStep(), trigger_type: 'keyword_match',
      trigger_config: { keywords: ['', 'farmacia'], match_type: 'contains' } } as Automation;
    expect(triggerMatches(automation, { message_text: 'Quiero nutrición' })).toBe(false);
    expect(triggerMatches(automation, { message_text: 'Quiero farmacia' })).toBe(true);
  });
  it('runs only the most specific block for one inbound message', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [
      { ...automationWithUpdateStep(), id: 'broad', trigger_type: 'keyword_match',
        trigger_config: { keywords: ['super promo'], match_type: 'contains' } },
      { ...automationWithUpdateStep(), id: 'course', trigger_type: 'keyword_match',
        trigger_config: { keywords: ['super promo farmacia'], match_type: 'contains' } },
    ];
    await runAutomationsForTrigger({ accountId: ACCOUNT, triggerType: 'keyword_match', contactId: 'c1',
      context: { message_text: 'Quiero la Super Promo Farmacia', conversation_id: 'chat' } });
    expect(h.state.logAutomationIds).toEqual(['course']);
  });

  it('uses the older block when exact keywords have equal specificity', async () => {
    h.state.owned = { id: 'c1' };
    h.state.automations = [
      { ...automationWithUpdateStep(), id: 'newer', created_at: '2026-10-12', trigger_type: 'keyword_match',
        trigger_config: { keywords: ['quiero inscribirme'], match_type: 'exact' } },
      { ...automationWithUpdateStep(), id: 'older', created_at: '2026-10-10', trigger_type: 'keyword_match',
        trigger_config: { keywords: ['quiero inscribirme'], match_type: 'exact' } },
    ];
    await runAutomationsForTrigger({ accountId: ACCOUNT, triggerType: 'keyword_match', contactId: 'c1',
      context: { message_text: 'Quiero inscribirme', conversation_id: 'chat' } });
    expect(h.state.logAutomationIds).toEqual(['older']);
  });
});

describe("update_contact_field — custom fields", () => {
  it("upserts contact_custom_values when the field is account-owned", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "Premium")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // No direct contacts column write for a custom field.
    expect(h.state.updateCalls).toHaveLength(0);
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0].payload).toEqual({
      contact_id: "c1",
      custom_field_id: "cf1",
      value: "Premium",
    });
  });

  it("interpolates {{ vars.* }} into the custom value", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = { id: "cf1" };
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:cf1", "{{ vars.source }}")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: { vars: { source: "WhatsApp Ad" } },
    });

    expect(h.state.upsertCalls).toHaveLength(1);
    expect(
      (h.state.upsertCalls[0].payload as { value: string }).value,
    ).toBe("WhatsApp Ad");
  });

  it("refuses to write a custom field from another account", async () => {
    h.state.owned = { id: "c1" };
    h.state.ownedCustomField = null; // account-scoped lookup finds nothing
    h.state.automations = [automationWithUpdateStep()];
    h.state.steps = [customStep("custom:foreign-cf", "x")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    expect(h.state.upsertCalls).toHaveLength(0);
    expect(h.state.updateCalls).toHaveLength(0);
  });
});

describe("send_webhook — SSRF guard (GHSA-8jqh-598v-rfxc)", () => {
  it("refuses a private / link-local destination and never calls fetch", async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    h.state.owned = { id: "c1" };
    h.state.automations = [automationWithUpdateStep()];
    // Aimed at the cloud metadata endpoint — the classic SSRF target.
    h.state.steps = [webhookStep("http://169.254.169.254/latest/meta-data/")];

    await runAutomationsForTrigger({
      accountId: ACCOUNT,
      triggerType: "new_message_received",
      contactId: "c1",
      context: {},
    });

    // The automation matched and its steps were loaded (so we genuinely
    // reached the send_webhook case)...
    expect(h.state.fromCalls).toContain("automation_steps");
    // ...yet the guard blocked it before any outbound request left the box.
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

function webhookStep(url: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "send_webhook",
    position: 0,
    parent_step_id: null,
    step_config: { url, headers: { "Metadata-Flavor": "Google" }, body_template: "{}" },
  };
}

function automationWithUpdateStep() {
  return {
    id: "a1",
    account_id: ACCOUNT,
    user_id: "u1",
    trigger_type: "new_message_received",
    trigger_config: {},
    is_active: true,
  };
}

function updateStep() {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field: "company", value: "pwned-by-automation" },
  };
}

function customStep(field: string, value: string) {
  return {
    id: "s1",
    automation_id: "a1",
    step_type: "update_contact_field",
    position: 0,
    parent_step_id: null,
    step_config: { field, value },
  };
}

describe("triggerMatches — interactive_reply", () => {
  function automation(reply_ids: string[]): Automation {
    return {
      id: "a1",
      account_id: ACCOUNT,
      user_id: "u1",
      name: "menu step",
      trigger_type: "interactive_reply",
      trigger_config: { reply_ids },
      is_active: true,
      execution_count: 0,
      created_at: "",
      updated_at: "",
    };
  }

  it("matches when the tapped id is in reply_ids (exact)", () => {
    expect(
      triggerMatches(automation(["yes", "no"]), { interactive_reply_id: "yes" }),
    ).toBe(true);
  });

  it("does not match a different id", () => {
    expect(
      triggerMatches(automation(["yes"]), { interactive_reply_id: "maybe" }),
    ).toBe(false);
  });

  it("does not match on a substring (exact only)", () => {
    expect(
      triggerMatches(automation(["yes"]), { interactive_reply_id: "yes_please" }),
    ).toBe(false);
  });

  it("does not match when no reply id is present or config is empty", () => {
    expect(triggerMatches(automation(["yes"]), {})).toBe(false);
    expect(triggerMatches(automation([]), { interactive_reply_id: "yes" })).toBe(false);
  });
});
