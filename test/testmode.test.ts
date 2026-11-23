import { createServer as listen, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createHttpTransport } from '../src/opnsense/transport.js';
import { stats } from '../src/stats.js';
import { argsFor, connectTestMode } from './testmode-helper.js';

// PROOF B (dynamic): every tool is called in test mode while OPNSENSE_URL points at a local sentinel.
// The sentinel must receive 0 connections. Run it again under OS network isolation with `npm run test:isolated`.
let sentinel: Server;
let sentinelUrl = '';
let connections = 0;

beforeAll(async () => {
  sentinel = listen((socket) => {
    connections++;
    socket.destroy();
  });
  await new Promise<void>((resolve) => sentinel.listen(0, '127.0.0.1', resolve));
  const port = (sentinel.address() as { port: number }).port;
  sentinelUrl = `http://127.0.0.1:${port}`;
  // Real-looking process env too: code that reads it (a mutation, a bug) would reach the sentinel.
  process.env.OPNSENSE_URL = sentinelUrl; process.env.OPNSENSE_API_KEY = 'REAL-LOOKING-KEY'; process.env.OPNSENSE_API_SECRET = 'REAL-LOOKING-SECRET';
});

afterAll(() => new Promise<void>((resolve) => sentinel.close(() => resolve())));

describe('test mode: proof B, all tools, sentinel listener', () => {
  it('answers every tool with the [TEST] marker and sends nothing', async () => {
    stats.reset();
    const h = await connectTestMode({ OPNSENSE_URL: sentinelUrl, MCP_TEST_APPROVER: 'approve' });
    const { tools } = await h.client.listTools();
    expect(tools.length).toBe(210);
    const unmarked: string[] = [];
    for (const t of tools) {
      const { data } = await h.call(t.name, argsFor(t as never));
      if (data.test_mode !== true || data.marker !== '[TEST]') unmarked.push(t.name);
    }
    expect(unmarked, 'tools whose answer is not marked').toEqual([]);
    expect(connections, 'connections received by the sentinel').toBe(0);
    const snap = stats.snapshot() as { totals: { real_calls: number; test_calls: number }; network_cuts: { count: number } };
    expect(snap.totals.real_calls).toBe(0);
    expect(snap.totals.test_calls).toBe(210);
    await h.close();
  });

  it('reads no OPNSENSE_* variable in test mode', () => {
    const cfg = loadConfig({ MCP_TEST_MODE: '1' });
    expect(cfg.testMode).toBe(true);
    expect(cfg.instances.get('test')?.url).toBe('http://test.invalid');
    expect(() => loadConfig({ MCP_TEST_MODE: '1', MCP_TEST_APPROVER: 'maybe' })).toThrow(/MCP_TEST_APPROVER/);
    expect(loadConfig({ MCP_TEST_MODE: '1' }).approver).toBe('deny');
  });

  it('keeps the network cut behind a simulated approval: the real transport cannot be created', async () => {
    const h = await connectTestMode({ OPNSENSE_URL: sentinelUrl, MCP_TEST_APPROVER: 'approve' });
    const before = (stats.snapshot() as { network_cuts: { count: number } }).network_cuts.count;
    expect(() => createHttpTransport({ url: sentinelUrl, verifySsl: true }, 4)).toThrow(/TEST_MODE_EGRESS_BLOCKED/);
    const after = (stats.snapshot() as { network_cuts: { count: number; last: string } }).network_cuts;
    expect(after.count).toBe(before + 1);
    expect(connections).toBe(0);
    await h.close();
  });
});

const EXTRA_ARGS: Record<string, Record<string, unknown>> = { opn_kill_states: { address: '192.0.2.1' } };

describe('test mode: simulated admin validation, 4 scenarios per confirming tool', () => {
  it('approve: the mock runs; deny, timeout, absent: nothing runs; nothing real in all four', async () => {
    const results: string[] = [];
    let confirming: string[] = [];
    for (const mode of ['approve', 'deny', 'timeout', 'absent'] as const) {
      const h = await connectTestMode({ OPNSENSE_URL: sentinelUrl, MCP_TEST_APPROVER: mode });
      const { tools } = await h.client.listTools();
      confirming = h.confirming;
      for (const name of h.confirming) {
        const t = tools.find((x) => x.name === name)!;
        const before = stats.mockRequests;
        const { data } = await h.call(name, { ...argsFor(t as never), ...(EXTRA_ARGS[name] ?? {}) });
        const sent = stats.mockRequests - before;
        if (data.test_mode !== true) results.push(`${mode} ${name}: not marked`);
        if (mode === 'approve') {
          // opn_rollback_changes has nothing to undo without a pending change: its own answer, no request.
          if (['user_cancelled', 'confirmation_timeout', 'confirmation_required'].includes(data.error_type) || (sent === 0 && name !== 'opn_rollback_changes')) results.push(`approve ${name}: the mock did not run (${data.error_type ?? 'no request'})`);
        } else {
          const want = { deny: 'user_cancelled', timeout: 'confirmation_timeout', absent: 'confirmation_required' }[mode];
          if (data.error_type !== want) results.push(`${mode} ${name}: error_type ${data.error_type}, wanted ${want}`);
          if (sent !== 0) results.push(`${mode} ${name}: ${sent} request(s) reached the mock`);
          if (mode === 'absent' && !String(data.error).startsWith('ConfirmationRequired')) results.push(`absent ${name}: message is not ConfirmationRequired`);
        }
      }
      await h.close();
    }
    expect(confirming.length).toBeGreaterThan(20);
    expect(results).toEqual([]);
    expect(connections).toBe(0);
    const snap = stats.snapshot() as { simulated_approver: Record<string, number> };
    expect(snap.simulated_approver.approved).toBeGreaterThan(0);
    expect(snap.simulated_approver.denied).toBeGreaterThan(0);
    expect(snap.simulated_approver.timeouts).toBeGreaterThan(0);
    expect(snap.simulated_approver.absent).toBeGreaterThan(0);
  });

  it('defaults to deny, and opn_stats reports it', async () => {
    stats.reset();
    const h = await connectTestMode({ OPNSENSE_URL: sentinelUrl });
    const name = h.confirming[0]!;
    const { tools } = await h.client.listTools();
    const { data } = await h.call(name, argsFor(tools.find((x) => x.name === name) as never));
    expect(data.error_type).toBe('user_cancelled');
    const s = await h.call('opn_stats');
    expect(s.data.test_mode).toBe(true);
    expect(s.data.simulated_approver.denied).toBeGreaterThan(0);
    expect(s.data.per_tool[name].test_calls).toBe(1);
    const listed = tools.find((x) => x.name === 'opn_stats');
    expect(listed?.annotations?.readOnlyHint).toBe(true);
    await h.close();
  });
});
