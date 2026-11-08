import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config.js';
import { Runtime } from '../src/runtime.js';
import { createServer, visibleTools } from '../src/server.js';

export interface TestHarness {
  client: Client;
  runtime: Runtime;
  names: string[];
  /** Tools that ask a human first (destructive ones). */
  confirming: string[];
  call: (name: string, args?: Record<string, unknown>) => Promise<{ data: Record<string, any>; isError: boolean }>;
  close: () => Promise<void>;
}

/** A test-mode server. Real-looking OPNSENSE_* variables are passed on purpose: test mode must ignore them. */
export async function connectTestMode(env: Record<string, string> = {}): Promise<TestHarness> {
  const runtime = new Runtime(loadConfig({ MCP_TEST_MODE: '1', OPNSENSE_URL: 'https://203.0.113.10', OPNSENSE_API_KEY: 'REAL-LOOKING-KEY', OPNSENSE_API_SECRET: 'REAL-LOOKING-SECRET', ...env }));
  const server = createServer(runtime);
  const client = new Client({ name: 'testmode', version: '1' }, { capabilities: {} });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const defs = visibleTools(runtime);
  return {
    client,
    runtime,
    names: defs.map((d) => d.name),
    confirming: defs.filter((d) => d.confirmation).map((d) => d.name),
    call: async (name, args = {}) => {
      const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
      let data: Record<string, any>;
      try {
        data = JSON.parse(res.content[0]!.text);
      } catch {
        data = { unparsed: res.content[0]?.text };
      }
      return { data, isError: res.isError === true };
    },
    close: async () => {
      await client.close();
      await server.close();
      await runtime.shutdown();
    },
  };
}

type Schema = { type?: string; enum?: unknown[]; format?: string; items?: Schema; minimum?: number; properties?: Record<string, Schema>; required?: string[] };

const BY_NAME: Record<string, unknown> = {
  uuid: '00000000-0000-4000-8000-000000000000',
  before_uuid: '00000000-0000-4000-8000-000000000001',
  ip: '192.0.2.1',
  address: '192.0.2.1',
  addresses: ['192.0.2.1'],
  hostname: 'host.example.test',
  backup: 'config-1.0.xml',
  newer: 'config-2.0.xml',
  older: 'config-1.0.xml',
  source: '192.0.2.1',
  destination: '192.0.2.2',
  path: 'core/firmware/status',
  network: '192.0.2.0/24',
  gateway: 'GW1',
  categories: ['00000000-0000-4000-8000-000000000002'],
};

function gen(name: string, s: Schema): unknown {
  if (name in BY_NAME && (s.type === 'string' || s.type === 'array')) return BY_NAME[name];
  if (s.enum) return s.enum[0];
  switch (s.type) {
    case 'boolean':
      return true;
    case 'integer':
    case 'number':
      return Math.max(1, s.minimum ?? 1);
    case 'array':
      return [gen(name, s.items ?? { type: 'string' })];
    case 'object':
      return Object.fromEntries((s.required ?? []).map((k) => [k, gen(k, s.properties?.[k] ?? {})]));
    default:
      return 'test_value';
  }
}

/** Valid arguments for a tool, built from its input schema (required fields only). */
export function argsFor(tool: { inputSchema: Schema }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of tool.inputSchema.required ?? []) out[k] = gen(k, tool.inputSchema.properties?.[k] ?? {});
  return out;
}
