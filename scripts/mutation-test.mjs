// Test de mutation du mode test : un appel réseau réel ajouté HORS du point unique (src/opnsense/transport.ts)
// doit faire échouer la preuve A (structurelle) ET la preuve B (sentinelle). Usage : npm run test:mutation
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const work = mkdtempSync(join(tmpdir(), 'osmcp-mutation-'));
for (const f of ['src', 'test', 'package.json', 'tsconfig.json']) cpSync(join(root, f), join(work, f), { recursive: true });
symlinkSync(join(root, 'node_modules'), join(work, 'node_modules'), 'junction');

// La mutation : le backend simulé, hors du point unique, appelle le vrai réseau.
const file = join(work, 'src/opnsense/mock-transport.ts');
const text = readFileSync(file, 'utf8');
writeFileSync(file, text.replace('stats.mockRequests++;', 'stats.mockRequests++;\n      await fetch(process.env.OPNSENSE_URL ?? "http://127.0.0.1:9").catch(() => undefined); // MUTATION'));

const run = (files) => spawnSync('npx', ['vitest', 'run', ...files], { cwd: work, encoding: 'utf8', shell: true });
const A = run(['test/testmode-static.test.ts']);
const B = run(['test/testmode.test.ts']);
const failed = (r) => r.status !== 0 && /FAIL|failed/.test(r.stdout + r.stderr);
const lines = (r) => (r.stdout + r.stderr).split('\n').filter((l) => /FAIL|AssertionError|expected|Tests /.test(l)).slice(0, 6).join('\n');
console.log('--- mutation : fetch() ajouté dans src/opnsense/mock-transport.ts ---');
console.log(`preuve A : ${failed(A) ? 'ÉCHEC (attendu, mutation détectée)' : 'PASSE (mutation NON détectée)'}\n${lines(A)}`);
console.log(`preuve B : ${failed(B) ? 'ÉCHEC (attendu, mutation détectée)' : 'PASSE (mutation NON détectée)'}\n${lines(B)}`);
rmSync(work, { recursive: true, force: true });
process.exit(failed(A) && failed(B) ? 0 : 1);
