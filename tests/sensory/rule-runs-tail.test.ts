import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// readRuleRuns doit lire un gros journal par la fin (vérif agy 05/09 : un rule-runs.jsonl de
// 100 Mo ne doit pas être chargé entier pour afficher les 20 derniers déclenchements).
describe('readRuleRuns — lecture par la fin d’un gros journal', () => {
  let dir: string;
  const prev = process.env.CODEBUDDY_RULE_RUNS_FILE;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rule-runs-tail-')); });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.CODEBUDDY_RULE_RUNS_FILE; else process.env.CODEBUDDY_RULE_RUNS_FILE = prev;
  });

  it('rend les N derniers, du plus récent au plus ancien, sans charger tout le fichier', async () => {
    const file = join(dir, 'rule-runs.jsonl');
    const pad = 'x'.repeat(200);
    const total = 8000; // ≈ 1,9 Mo > seuil de 1 Mo
    const lines: string[] = [];
    for (let i = 0; i < total; i++) lines.push(JSON.stringify({ ts: i, rule: `r${i}`, ok: true, detail: pad }));
    lines.push('{"torn": tru'); // ligne déchirée finale (écriture en cours)
    writeFileSync(file, lines.join('\n') + '\n');
    process.env.CODEBUDDY_RULE_RUNS_FILE = file;
    const { readRuleRuns } = await import('../../src/sensory/sensory-rules-engine.js');
    const runs = await readRuleRuns(3);
    expect(runs.map((r) => r.rule)).toEqual(['r7999', 'r7998', 'r7997']);
  });

  it('petit fichier : comportement inchangé (lecture entière)', async () => {
    const file = join(dir, 'rule-runs.jsonl');
    writeFileSync(file, [1, 2, 3].map((i) => JSON.stringify({ ts: i, rule: `r${i}`, ok: true })).join('\n') + '\n');
    process.env.CODEBUDDY_RULE_RUNS_FILE = file;
    const { readRuleRuns } = await import('../../src/sensory/sensory-rules-engine.js');
    expect((await readRuleRuns(2)).map((r) => r.rule)).toEqual(['r3', 'r2']);
  });
});
