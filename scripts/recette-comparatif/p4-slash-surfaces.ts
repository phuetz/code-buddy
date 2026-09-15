/**
 * P4 recette — export the REAL slash catalog with per-surface availability and
 * generate the offline wiki from it. No Electron/UI run (cowork deps not installed).
 *
 *   node scripts/recette-comparatif/run-isolated.mjs p4-recette -- \
 *     node node_modules/tsx/dist/cli.mjs scripts/recette-comparatif/p4-slash-surfaces.ts
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { builtinCommands, coworkHeadlessAllowlist, withAvailability } from '../../src/commands/slash/index.js';

const base = process.env.RECETTE_QA_BASE;
if (!base) throw new Error('run through run-isolated.mjs');
const catalog = withAvailability(builtinCommands);
fs.writeFileSync(path.join(base, 'catalog-with-availability.json'), JSON.stringify(catalog, null, 2));
execFileSync(process.execPath, ['scripts/generate-slash-wiki.mjs', '--catalog', path.join(base, 'catalog-with-availability.json'), '--output', path.join(base, 'wiki')], { stdio: 'inherit' });

const cowork = (status: string) => catalog.filter((c) => c.availability.cowork.status === status);
const summary = {
  item: 'P4',
  builtinCount: catalog.length,
  cliAvailable: catalog.filter((c) => c.availability.cli.status === 'available').length,
  coworkAvailable: cowork('available').length,
  coworkUnavailable: cowork('unavailable').length,
  coworkHeadlessAllowlistSize: coworkHeadlessAllowlist().size,
  coworkUnavailableNames: cowork('unavailable').map((c) => c.name),
  wikiPages: fs.readdirSync(path.join(base, 'wiki')).filter((f) => f.endsWith('.md')).length,
};
const pass = summary.cliAvailable === summary.builtinCount && summary.coworkUnavailable > 0 && summary.wikiPages >= summary.builtinCount;
fs.writeFileSync(path.join(base, 'summary.json'), JSON.stringify({ ...summary, pass }, null, 2));
console.log(JSON.stringify({ ...summary, coworkUnavailableNames: `${summary.coworkUnavailableNames.length} names (see summary.json)`, pass }, null, 2));
process.exit(pass ? 0 : 1);
