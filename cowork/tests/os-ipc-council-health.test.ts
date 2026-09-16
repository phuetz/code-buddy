/**
 * os-ipc council health — real test (no mocks beyond electron): reads REAL
 * temp JSONL ledgers shaped exactly like ~/.codebuddy's (verbatim lines from
 * production) and asserts the arena session mapping.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

import { readCouncilHealth, readKnowledgeGraph } from '../src/main/ipc/os-ipc';

const HEALTH_LINES = [
  '{"at":"2026-07-01T22:10:31.900Z","taskType":"french","planMode":"collective","seats":3,"answers":3,"seatSurvival":1,"judgeAlive":1,"stanceDivergence":0.927,"judgeDiscrimination":0.4,"dissentRetention":0.253,"anchorRatio":0.159,"dhi":0.8318528867824643}',
  '{"at":"2026-07-01T22:51:16.126Z","taskType":"code","planMode":"collective","seats":3,"answers":3,"seatSurvival":1,"judgeAlive":1,"stanceDivergence":0.5,"judgeDiscrimination":0.2,"dissentRetention":0.4,"anchorRatio":0.3,"dhi":0.61}',
].join('\n');

const SCOREBOARD_LINES = [
  // Same run as the LAST health line (within the 90s window)
  '{"at":"2026-07-01T22:51:16.125Z","taskType":"code","model":"grok-4-latest","provider":"grok","role":"reviewer","won":false,"quality":0.2,"roleQuality":0.95,"latencyMs":7908,"costUsd":0.0002}',
  '{"at":"2026-07-01T22:51:16.125Z","taskType":"code","model":"gpt-5.5","provider":"chatgpt","role":"member","won":true,"quality":0.9,"roleQuality":0.8,"latencyMs":5120,"costUsd":0}',
  '{"at":"2026-07-01T22:51:16.125Z","taskType":"code","model":"qwen3.6:27b","provider":"ollama","role":"member","won":false,"quality":0.6,"roleQuality":0.5,"latencyMs":9800,"costUsd":0}',
  // A FAILED seat in the same window → excluded
  '{"at":"2026-07-01T22:51:16.125Z","taskType":"code","model":"dead-model","provider":"x","role":"member","won":false,"quality":0,"failed":true}',
  // An OLD run far outside the window → excluded
  '{"at":"2026-07-01T22:10:31.899Z","taskType":"french","model":"gemma4","provider":"ollama","role":"member","won":true,"quality":0.8}',
].join('\n');

function makeLedgerDir(health = HEALTH_LINES, scoreboard = SCOREBOARD_LINES): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-ipc-test-'));
  writeFileSync(join(dir, 'council-deliberation-health.jsonl'), health);
  writeFileSync(join(dir, 'fleet-model-performance.jsonl'), scoreboard);
  return dir;
}

describe('readCouncilHealth', () => {
  it('maps the LAST run to an arena session with its verdicts only', async () => {
    const { session, history } = await readCouncilHealth(20, makeLedgerDir());
    expect(session).not.toBeNull();
    expect(session!.dhi).toBeCloseTo(0.61);
    expect(session!.title).toContain('code');
    expect(session!.title).toContain('3/3');
    // 3 live seats — the failed one and the older run are excluded.
    expect(session!.verdicts).toHaveLength(3);
    const winner = session!.verdicts.find((v) => v.stance === 'approve');
    expect(winner?.model).toBe('gpt-5.5');
    expect(session!.verdicts.find((v) => v.model === 'grok-4-latest')?.stance).toBe('reject'); // 0.2 < 0.5
    expect(session!.verdicts.find((v) => v.model === 'qwen3.6:27b')?.stance).toBe('revise'); // 0.6, not won
    // agentIds unique (keyed in the arena grid)
    expect(new Set(session!.verdicts.map((v) => v.agentId)).size).toBe(3);
    // History oldest → newest
    expect(history.map((h) => h.dhi)).toEqual([0.8318528867824643, 0.61]);
  });

  it('is fail-open: missing files → null session, corrupt lines skipped', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'os-ipc-empty-'));
    expect(await readCouncilHealth(20, empty)).toEqual({ session: null, history: [] });

    const corrupt = makeLedgerDir('{oops\n' + HEALTH_LINES, '{nope\n' + SCOREBOARD_LINES);
    const { session } = await readCouncilHealth(20, corrupt);
    expect(session!.verdicts).toHaveLength(3);
  });

  it('caps the history to the requested limit', async () => {
    const { history } = await readCouncilHealth(1, makeLedgerDir());
    expect(history).toHaveLength(1);
    expect(history[0]!.dhi).toBe(0.61);
  });
});

describe('readKnowledgeGraph', () => {
  // Verbatim shape of the real CKG ledger (~/.codebuddy/collective/ckg-ledger.jsonl)
  const LEDGER = [
    '{"v":1,"kind":"entity","recordedAt":"2026-06-30T07:45:41.050Z","agentId":"hub/code-buddy","id":"discovery:collective:arxiv-1","type":"discovery","name":"arxiv:1","text":"Personalized attention…","confidence":0.7}',
    '{"v":1,"kind":"entity","recordedAt":"2026-06-30T07:46:00.000Z","agentId":"hub/code-buddy","id":"lesson:collective:l1","type":"lesson","name":"toujours gater no-mocks","confidence":0.9}',
    '{"v":1,"kind":"relation","recordedAt":"2026-06-30T07:45:41.846Z","agentId":"hub/code-buddy","sourceId":"discovery:collective:arxiv-1","targetId":"lesson:collective:l1","relType":"related_to","reason":"semantic neighbour"}',
    // Last write wins: same id re-ingested with a new confidence
    '{"v":1,"kind":"entity","recordedAt":"2026-07-01T08:00:00.000Z","agentId":"hub/code-buddy","id":"discovery:collective:arxiv-1","type":"discovery","name":"arxiv:1 v2","confidence":0.8}',
    // Tombstone drops a node
    '{"v":1,"kind":"entity","recordedAt":"2026-07-01T09:00:00.000Z","agentId":"a","id":"fact:collective:f1","type":"fact","name":"périmé","confidence":0.5}',
    '{"v":1,"kind":"tombstone","recordedAt":"2026-07-01T10:00:00.000Z","agentId":"a","id":"fact:collective:f1"}',
    // Unknown kinds/types ignored, corrupt line skipped
    '{"v":1,"kind":"entity","id":"x:1","type":"weird","name":"ignored"}',
    '{broken',
  ].join('\n');

  function ledgerDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ckg-test-'));
    const collective = join(dir, 'collective');
    mkdirSync(collective, { recursive: true });
    writeFileSync(join(collective, 'ckg-ledger.jsonl'), LEDGER);
    return dir;
  }

  it('folds the ledger: last write wins, tombstones drop, relations kept', async () => {
    const g = await readKnowledgeGraph(4000, ledgerDir());
    expect(g.truncated).toBe(false);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['discovery:collective:arxiv-1', 'lesson:collective:l1']);
    const arxiv = g.nodes.find((n) => n.id === 'discovery:collective:arxiv-1')!;
    expect(arxiv.label).toBe('arxiv:1 v2');
    expect(arxiv.confidence).toBe(0.8);
    expect(g.edges).toEqual([{ from: 'discovery:collective:arxiv-1', to: 'lesson:collective:l1', kind: 'related_to' }]);
  });

  it('caps nodes to maxNodes keeping the newest, and filters dangling edges', async () => {
    const g = await readKnowledgeGraph(1, ledgerDir());
    expect(g.truncated).toBe(true);
    expect(g.nodes).toHaveLength(1);
    // arxiv-1 was re-written LAST → it is the newest kept node.
    expect(g.nodes[0]!.id).toBe('discovery:collective:arxiv-1');
    expect(g.edges).toEqual([]); // the lesson end is gone → edge dropped
  });

  it('is fail-open on a missing ledger', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'ckg-empty-'));
    expect(await readKnowledgeGraph(4000, empty)).toEqual({ nodes: [], edges: [], truncated: false });
  });
});
