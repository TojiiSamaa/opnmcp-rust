// Régénère le tableau d'outils de skill/opnmcp-rust/SKILL.md depuis le vrai tools/list (tous domaines, écritures activées).
// Usage : npm run build && node scripts/gen-skill-table.mjs   (puis npm test vérifie la cohérence)
import { readFileSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../dist/config.js';
import { Runtime } from '../dist/runtime.js';
import { createServer, visibleTools } from '../dist/server.js';

const MARK = '<!-- tools-table -->';
const file = new URL('../skill/opnmcp-rust/SKILL.md', import.meta.url);
const rt = new Runtime(loadConfig({ MCP_TEST_MODE: '1' })); // aucun secret, aucun réseau
const confirming = new Set(visibleTools(rt).filter((d) => d.confirmation).map((d) => d.name));
const domain = Object.fromEntries(visibleTools(rt).map((d) => [d.name, d.domain]));
const server = createServer(rt);
const client = new Client({ name: 'gen', version: '1' }, { capabilities: {} });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(a), client.connect(b)]);
const { tools } = await client.listTools();
await client.close();
await rt.shutdown();

const ph = (k, v) => {
  if (v.enum) return JSON.stringify(v.enum[0]);
  if (v.type === 'boolean') return 'true';
  if (v.type === 'number' || v.type === 'integer') return '10';
  if (v.type === 'array') return '[]';
  if (v.type === 'object') return '{}';
  return k === 'uuid' ? '"<uuid>"' : '"..."';
};
const order = ['system', 'network', 'firewall', 'nat', 'dns', 'dhcp', 'vpn', 'services', 'haproxy', 'diagnostics', 'security', 'api'];
const label = { R: 'lecture', W: 'écriture', D: 'destructif' };
let out = '';
for (const d of order) {
  const ts = tools.filter((t) => domain[t.name] === d);
  out += `\n### ${d} (${ts.length})\n\n| Outil | Accès | Validation admin | Rôle (description du serveur) | Paramètres (* = requis) | Exemple d'appel |\n|---|---|---|---|---|---|\n`;
  for (const t of ts) {
    const acc = t.annotations?.readOnlyHint ? 'R' : t.annotations?.destructiveHint ? 'D' : 'W';
    const req = t.inputSchema.required ?? [];
    const pr = t.inputSchema.properties ?? {};
    const ps = Object.keys(pr).map((k) => `\`${k}\`${req.includes(k) ? '*' : ''}`).join(' ') || 'aucun';
    const ex = `{${req.map((k) => `"${k}": ${ph(k, pr[k])}`).join(', ')}}`;
    const desc = (t.description ?? '').replace(/\s+/g, ' ').split(/(?<=\.)\s/)[0].replace(/\|/g, '\\|');
    out += `| \`${t.name}\` | ${label[acc]} | ${confirming.has(t.name) ? 'oui' : 'non'} | ${desc} | ${ps} | \`${t.name} ${ex.replace(/\|/g, '\\|')}\` |\n`;
  }
}
const md = readFileSync(file, 'utf8');
const head = md.slice(0, md.indexOf(MARK) + MARK.length);
writeFileSync(file, `${head}\n${out}`);
console.log(`${tools.length} outils écrits, dont ${confirming.size} avec validation admin`);
