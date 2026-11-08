import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// PROOF A (structural): the real transport is replaced by one that panics, and no network call exists outside the single point.
const { panics, panic } = vi.hoisted(() => {
  const hits: string[] = [];
  return {
    panics: { hits },
    panic: (what: string) => () => {
      hits.push(what);
      throw new Error(`PANIC: ${what}`);
    },
  };
});

vi.mock('../src/opnsense/transport.js', async (orig) => ({ ...(await orig<typeof import('../src/opnsense/transport.js')>()), createHttpTransport: panic('createHttpTransport') }));
vi.mock('node:http', () => {
  const m = { request: panic('http.request'), get: panic('http.get'), Agent: class { constructor() { panic('http.Agent')(); } }, createServer: panic('http.createServer') };
  return { default: m, ...m };
});
vi.mock('node:https', () => {
  const m = { request: panic('https.request'), get: panic('https.get'), Agent: class { constructor() { panic('https.Agent')(); } } };
  return { default: m, ...m };
});

import { argsFor, connectTestMode } from './testmode-helper.js';

const SRC = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const NETWORK_FILE = join(SRC, 'opnsense', 'transport.ts');
const INBOUND_SERVER_FILE = join(SRC, 'http.ts');
const NET_PURE = new Set(['isIP', 'isIPv4', 'isIPv6', 'BlockList', 'AddressInfo']);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Everything that can open a connection or start a process, outside the single network file. */
export function networkViolations(file: string, text: string): string[] {
  if (file === NETWORK_FILE) return [];
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out: string[] = [];
  const mod = /(?:from|import\s*\(|require\s*\()\s*['"](?:node:)?(https?|http2|tls|dns|dgram|child_process|cluster|worker_threads|net)['"]/g;
  for (const m of code.matchAll(mod)) {
    const name = m[1]!;
    if (name === 'http' && file === INBOUND_SERVER_FILE) continue; // inbound MCP server only, see below
    if (name === 'net') {
      const line = code.slice(code.lastIndexOf('\n', m.index) + 1, code.indexOf('\n', m.index));
      const names = [...(/\{([^}]*)\}/.exec(line)?.[1] ?? 'default').split(',')].map((n) => n.trim().replace(/^type\s+/, '')).filter(Boolean);
      if (names.every((n) => NET_PURE.has(n))) continue;
    }
    out.push(`import of node:${name}`);
  }
  if (/\bfetch\s*\(/.test(code)) out.push('fetch(');
  if (/\b(XMLHttpRequest|WebSocket|EventSource)\b/.test(code)) out.push('browser network API');
  if (file === INBOUND_SERVER_FILE && /\bhttps?\.(request|get)\s*\(/.test(code)) out.push('outbound http call in the inbound server');
  return out;
}

describe('test mode: proof A, structural', () => {
  it('no network or process call exists outside the single point (src/opnsense/transport.ts)', () => {
    const found = sources(SRC).flatMap((f) => networkViolations(f, readFileSync(f, 'utf8')).map((v) => `${relative(SRC, f)}: ${v}`));
    expect(found).toEqual([]);
  });

  it('with a panicking transport, node http/https and fetch, all tools still answer and nothing panics', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = panic('fetch') as never;
    try {
      const h = await connectTestMode({ MCP_TEST_APPROVER: 'approve' });
      const { tools } = await h.client.listTools();
      expect(tools.length).toBe(210);
      for (const t of tools) {
        const { data } = await h.call(t.name, argsFor(t as never));
        expect(data.test_mode, t.name).toBe(true);
      }
      await h.close();
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(panics.hits).toEqual([]);
  });
});
