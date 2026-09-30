import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOwnedProcess } from './run-owned-process.mjs';
import { measureCatalogStdout } from './replay-oracles.mjs';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const raw = path.join(checkout, '_qa/preuves-p9/reprise-2/raw');
const home = path.join(checkout, '_qa/preuves-p9/home');
mkdirSync(raw, { recursive: true });
const run = await runOwnedProcess(process.execPath, [path.join(checkout, 'dist/cli-boot.js'), 'catalog', 'status', '--json'],
  { cwd: checkout, env: { ...process.env, HOME: home, USERPROFILE: home } });
// Preserve the exact bytes printed by the real CLI, including its formatting.
writeFileSync(path.join(raw, 'catalog-stdout.json'), run.stdout);
writeFileSync(path.join(raw, 'catalog-stderr.log'), run.stderr);
const measured = measureCatalogStdout(run.stdout);
const passed = run.code === 0 && !run.timedOut && measured.featureCount === 338;
writeFileSync(path.join(raw, 'catalog-measurement.json'), JSON.stringify({ derivedFrom: 'catalog-stdout.json', ...measured }, null, 2));
writeFileSync(path.join(raw, 'catalog-results.json'), JSON.stringify([{ id: 'catalog-status', name: 'catalog-status',
  command: 'node scripts/qa/run-p9-catalog-evidence.mjs', input: { args: ['catalog', 'status', '--json'] },
  result: { success: run.code === 0, output: run.stdout }, passed,
  expected: 'JSON CLI intégral : 338 featureId uniques, schemaVersion 1, warnings vide ; mesures dérivées séparées.',
  observations: { run, measured }, summary: 'Sortie brute du CLI conservée intégralement ; agrégats clairement séparés.' }], null, 2));
process.stdout.write(JSON.stringify({ passed, derivedMeasurement: measured }) + '\n');
if (!passed) process.exitCode = 1;
