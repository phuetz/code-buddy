import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  appendRetryReceipt,
  assertBatchBounded,
  classifyDefects,
  NATIVE_FASHION_CAUSAL_ADJUSTMENTS,
  type GateResult,
  type NativeFashionGate,
  type RetryReceipt,
} from '../../../src/tools/video/native-fashion-defects.js';

const roots: string[] = [];
const gates: NativeFashionGate[] = [
  'identity',
  'anatomy',
  'temporal-stability',
  'outfit',
  'decor-framing',
  'master-properties',
];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function receipt(overrides: Partial<RetryReceipt> = {}): RetryReceipt {
  return {
    attempt: 1,
    batchId: 'fashion-pilot-batch-01',
    sceneId: 'pilot-black-dress-turn',
    candidateSha256: 'a'.repeat(64),
    seed: 42,
    adjustedParameters: [],
    failedGates: ['identity'],
    verdict: 'rejected',
    at: '2026-07-20T09:00:00.000Z',
    ...overrides,
  };
}

describe('native fashion defects and retry receipts', () => {
  it('classifies every failed gate with its deterministic causal adjustment', () => {
    const results: GateResult[] = gates.map((gate) => ({ gate, pass: false, evidence: `${gate} failed` }));
    expect(classifyDefects(results)).toEqual(gates.map((gate) => ({
      gate,
      causalAdjustment: NATIVE_FASHION_CAUSAL_ADJUSTMENTS[gate],
    })));
    expect(classifyDefects(results.map((result) => ({ ...result, pass: true })))).toEqual([]);
    expect(Object.values(NATIVE_FASHION_CAUSAL_ADJUSTMENTS).join(' ')).not.toMatch(/retry identical/iu);
  });

  it('appends valid receipts as JSONL without replacing earlier entries', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-fashion-retries-'));
    roots.push(root);
    const journalPath = path.join(root, 'retry.jsonl');
    await appendRetryReceipt(journalPath, receipt());
    await appendRetryReceipt(journalPath, receipt({
      attempt: 2,
      adjustedParameters: ['strengthen identity LoRA and face conditioning'],
      candidateSha256: 'b'.repeat(64),
    }));
    const lines = (await fs.readFile(journalPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ attempt: 1, candidateSha256: 'a'.repeat(64) });
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({ attempt: 2, candidateSha256: 'b'.repeat(64) });
  });

  it('refuses an identical retry after the first attempt', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-fashion-retries-'));
    roots.push(root);
    await expect(appendRetryReceipt(path.join(root, 'retry.jsonl'), receipt({ attempt: 2 })))
      .rejects.toThrow('identical retry');
  });

  it('refuses promotion while any blocking gate has failed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-fashion-retries-'));
    roots.push(root);
    await expect(appendRetryReceipt(path.join(root, 'retry.jsonl'), receipt({
      failedGates: ['outfit'],
      verdict: 'promoted-to-human-review',
    }))).rejects.toThrow('cannot be promoted');
  });

  it('requires the exhaustion verdict when the batch reaches its bound', () => {
    expect(() => assertBatchBounded([
      receipt({ attempt: 2, adjustedParameters: ['change seed'] }),
      receipt({ attempt: 3, adjustedParameters: ['change temporal engine'], verdict: 'rejected' }),
    ], 3)).toThrow('batch-exhausted');
    expect(() => assertBatchBounded([
      receipt({ attempt: 3, adjustedParameters: ['change temporal engine'], verdict: 'batch-exhausted' }),
    ], 3)).not.toThrow();
    expect(() => assertBatchBounded([
      receipt({
        attempt: 4,
        adjustedParameters: ['record terminal diagnostic'],
        failedGates: [],
        verdict: 'promoted-to-human-review',
      }),
    ], 3)).toThrow('batch-exhausted');
  });
});
