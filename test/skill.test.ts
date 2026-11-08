import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { Runtime } from '../src/runtime.js';
import { visibleTools } from '../src/server.js';

// Le skill portable doit lister exactement les outils exposés (tous domaines, écritures activées).
it('skill/opnmcp-rust/SKILL.md liste exactement les outils du serveur', async () => {
  const rt = new Runtime(loadConfig({ OPNSENSE_URL: 'https://x', OPNSENSE_API_KEY: 'k', OPNSENSE_API_SECRET: 's', OPNSENSE_TOOLSETS: 'all', OPNSENSE_ALLOW_WRITES: 'true', OPNSENSE_ALLOW_SENSITIVE: 'true' }));
  const real = new Set(visibleTools(rt).map((t) => t.name));
  await rt.shutdown();
  const md = readFileSync(new URL('../skill/opnmcp-rust/SKILL.md', import.meta.url), 'utf8');
  const rows = [...md.matchAll(/^\| `(opn_\w+)` \|/gm)].map((m) => m[1]);
  const mentioned = new Set(md.match(/\bopn_[a-z0-9_]+\b/g));
  expect(rows.filter((n, i) => rows.indexOf(n) !== i), 'doublons dans le tableau').toEqual([]);
  expect([...real].filter((n) => !rows.includes(n)), 'outils absents du skill').toEqual([]);
  expect([...mentioned].filter((n) => !real.has(n)), 'outils fantômes dans le skill').toEqual([]);
  expect(md).toContain(`${real.size} outils`);
});
