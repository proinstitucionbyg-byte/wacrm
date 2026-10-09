import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  permission: vi.fn(),
  from: vi.fn(),
  single: vi.fn(),
  rpc: vi.fn(),
  blocks: vi.fn(),
  launch: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
}));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: m.permission }));
vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: (e: { status?: number }) =>
    new Response(null, { status: e.status ?? 500 }),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from: m.from }),
}));
vi.mock('@/lib/automations/engine', () => ({ runAutomationById: m.launch }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  RATE_LIMITS: { send: {} },
  rateLimitResponse: vi.fn(),
}));
import { POST } from '@/app/api/inbox/commands/route';
const id = '11111111-1111-4111-8111-111111111111';
const request = (text = 'MANDAR(PROMO)') =>
  new Request('https://crm.test', {
    method: 'POST',
    body: JSON.stringify({ text, conversation: id, request_id: id }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  const chain = {
    select: () => chain,
    eq: m.eq,
    maybeSingle: m.single,
    update: m.update,
  };
  m.eq.mockImplementation(() => chain);
  m.from.mockImplementation((table: string) =>
    table === 'automations'
      ? { select: () => ({ eq: () => ({ eq: m.blocks }) }) }
      : chain
  );
  m.update.mockReturnValue(chain);
  m.single.mockResolvedValue({
    data: { id, contact_id: 'contact', contact: { channel: 'whatsapp' } },
  });
  m.blocks.mockResolvedValue({ data: [{ id, name: 'PROMO' }] });
  m.rpc.mockResolvedValue({ data: true });
  m.launch.mockResolvedValue(true);
  m.permission.mockResolvedValue({
    accountId: 'account',
    userId: 'agent',
    supabase: { from: m.from, rpc: m.rpc },
  });
});
describe('prepared inbox commands', () => {
  it('requires permission before accessing data', async () => {
    m.permission.mockRejectedValue({ status: 403 });
    expect((await POST(request())).status).toBe(403);
    expect(m.from).not.toHaveBeenCalled();
  });
  it('rejects malformed commands before accessing data', async () => {
    expect((await POST(request('MANDAR('))).status).toBe(400);
    expect(m.from).not.toHaveBeenCalled();
  });
  it('rejects an invisible conversation', async () => {
    m.single.mockResolvedValue({ data: null });
    expect((await POST(request())).status).toBe(404);
    expect(m.launch).not.toHaveBeenCalled();
  });
  it('claims the command once and launches with the authenticated adviser', async () => {
    expect((await POST(request())).status).toBe(200);
    expect(m.eq).toHaveBeenCalledWith('account_id', 'account');
    expect(m.rpc).toHaveBeenCalledWith('start_inbox_command', {
      p_id: id,
      p_conversation: id,
      p_automation: id,
    });
    expect(m.launch).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'account', manualAgentId: 'agent' })
    );
  });
  it('does not repeat an already claimed command', async () => {
    m.rpc.mockResolvedValue({ data: false });
    expect((await POST(request())).status).toBe(409);
    expect(m.launch).not.toHaveBeenCalled();
  });
  it('reports a failed block honestly', async () => {
    m.launch.mockResolvedValue(false);
    expect((await POST(request())).status).toBe(502);
    expect(m.update).toHaveBeenCalledWith({ status: 'failed' });
  });
  it('never chooses arbitrarily between two equal names', async () => {
    m.blocks.mockResolvedValue({
      data: [
        { id, name: 'PROMO' },
        { id: 'other', name: 'promo' },
      ],
    });
    expect((await POST(request())).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
