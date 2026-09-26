import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CollectiveKnowledgeGraph } from '../../../../src/memory/collective-knowledge-graph.js';
import { hasTriedExperimentLesson, recordExperimentLesson } from '../../../../src/agent/self-improvement/evolution/experiment-lessons.js';
import { completeFiche } from './experiment-fixture.js';

const roots: string[] = [];
function graph(): { graph: CollectiveKnowledgeGraph; ledger: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dgm-lessons-'));
  roots.push(root);
  const ledger = path.join(root, 'ckg-ledger.jsonl');
  return { graph: new CollectiveKnowledgeGraph({ ledgerPath: ledger, persistentEmbeddingCache: false, agentId: 'test-agent' }), ledger };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('DGM experiment lessons', () => {
  it('records a failed experiment as a lesson linked to article and feature with provenance', () => {
    const { graph: first, ledger } = graph();
    const lesson = recordExperimentLesson(first, {
      experimentId: 'attempt-1', fiche: completeFiche,
      result: { status: 'failed', before: 0.7, after: 0.6, durationMs: 1234, costUsd: 0, notes: ['regression'] },
      provenance: { at: '2026-09-26T10:10:00.000Z', revision: 'abc123', machine: 'qa-node', model: 'offline-fixture', conditions: 'five paired trials' },
    });
    expect(lesson.type).toBe('lesson');
    expect(lesson.relations.map((edge) => edge.target)).toEqual(expect.arrayContaining([
      expect.stringContaining('discovery:collective:arxiv-2605-01664'),
      expect.stringContaining('concept:collective:context-rag'),
    ]));
    expect(lesson.text).toContain('"status":"failed"');
    expect(lesson.text).toContain('"machine":"qa-node"');
    expect(readFileSync(ledger, 'utf8')).toContain('"type":"lesson"');

    const second = new CollectiveKnowledgeGraph({ ledgerPath: ledger, persistentEmbeddingCache: false, agentId: 'second-agent' });
    expect(hasTriedExperimentLesson(second, completeFiche)).toBe(true);
    expect(hasTriedExperimentLesson(second, { ...completeFiche, research: { ...completeFiche.research, method: 'Different method' } })).toBe(false);
  });

  it('keeps distinct failed and successful attempts for the same idea', () => {
    const { graph: memory } = graph();
    const base = {
      fiche: completeFiche,
      provenance: { at: '2026-09-26T10:10:00.000Z', revision: 'abc123', machine: 'qa-node', model: 'offline-fixture', conditions: 'five paired trials' },
    };
    recordExperimentLesson(memory, { ...base, experimentId: 'attempt-1', result: {
      status: 'failed', before: 0.7, after: 0.6, durationMs: 100, costUsd: 0, notes: [],
    } });
    recordExperimentLesson(memory, { ...base, experimentId: 'attempt-2', result: {
      status: 'passed', before: 0.7, after: 0.9, durationMs: 100, costUsd: 0, notes: [],
    } });
    expect(memory.getCurrentEntitiesByNamePrefix('lesson', 'dgm-experiment-')).toHaveLength(2);
  });
});
