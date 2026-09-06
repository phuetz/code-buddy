import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runScoreboardCommand } from '../../src/commands/council-scoreboard.js';
import { ModelScoreboard, type OutcomeRecord } from '../../src/fleet/model-scoreboard.js';

let tempDir: string;

function record(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    at: '2026-09-04T00:00:00.000Z',
    taskType: 'redaction-fr',
    model: 'gpt-5.6-luna',
    provider: 'chatgpt',
    won: true,
    quality: 0.93,
    latencyMs: 100,
    costUsd: 0,
    ...overrides,
  };
}

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('council scoreboard command', () => {
  it('imports valid JSONL once and deduplicates the same identity on replay', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'score1-scoreboard-'));
    const source = path.join(tempDir, 'bench.jsonl');
    const target = path.join(tempDir, 'ledger.jsonl');
    fs.writeFileSync(source, `${JSON.stringify(record())}\n${JSON.stringify(record())}\n`, 'utf8');
    const scoreboard = new ModelScoreboard(target);
    const output: string[] = [];

    expect(runScoreboardCommand(['import', source], (line) => output.push(line), scoreboard)).toBe(true);
    expect(scoreboard.runCount('redaction-fr', 'gpt-5.6-luna')).toBe(1);
    expect(output[0]).toContain('1 ajouté(s)');
    expect(output[0]).toContain('1 doublon(s)');

    expect(runScoreboardCommand(['import', source], (line) => output.push(line), scoreboard)).toBe(true);
    expect(scoreboard.runCount('redaction-fr', 'gpt-5.6-luna')).toBe(1);
    expect(output[1]).toContain('2 doublon(s)');
  });

  it('prints the best measured model for a task type', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'score1-best-'));
    const scoreboard = new ModelScoreboard(path.join(tempDir, 'ledger.jsonl'));
    scoreboard.importRecords([
      record({ model: 'gpt-5.6-luna', quality: 0.93, won: true }),
      record({ model: 'gemini-3.8-flash-high', provider: 'agy-cli', quality: 0.73, won: false }),
    ]);
    const output: string[] = [];

    expect(runScoreboardCommand(['best', '--task', 'redaction-fr'], (line) => output.push(line), scoreboard)).toBe(true);
    expect(output.join('\n')).toContain('gpt-5.6-luna');
    expect(output.join('\n')).toContain('provider chatgpt');
  });

  it('rejects malformed benchmark lines while retaining valid ones', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'score1-invalid-'));
    const source = path.join(tempDir, 'bench.jsonl');
    const scoreboard = new ModelScoreboard(path.join(tempDir, 'ledger.jsonl'));
    fs.writeFileSync(source, `${JSON.stringify(record())}\nnot-json\n`, 'utf8');
    const output: string[] = [];

    expect(runScoreboardCommand(['import', source], (line) => output.push(line), scoreboard)).toBe(false);
    expect(scoreboard.runCount('redaction-fr', 'gpt-5.6-luna')).toBe(1);
    expect(output.join('\n')).toContain('1 ligne(s) rejetée(s)');
  });
});
