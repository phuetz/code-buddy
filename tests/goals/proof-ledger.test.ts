import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatProofLedger, ProofLedger } from '../../src/goals/proof-ledger.js';

describe('Proof Ledger', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-ledger-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('appends durable JSONL proofs and redacts credentials', () => {
    const ledger = new ProofLedger('goal-proof', {
      storeDir: dir,
      now: () => new Date('2026-07-10T12:00:00.000Z'),
      idFactory: () => 'fixed',
    });
    const rawSecret = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';

    const record = ledger.append({
      turn: 1,
      kind: 'verification',
      status: 'pass',
      assurance: 'deterministic',
      summary: 'Focused test passed',
      evidence: `npm test exited 0; api_key=${rawSecret}`,
      criterionIds: ['criterion-1', 'criterion-1'],
      artifacts: ['tests/parser.test.ts'],
    });

    expect(record).toMatchObject({
      id: 'proof-fixed',
      goalId: 'goal-proof',
      redactionCount: expect.any(Number),
      criterionIds: ['criterion-1'],
    });
    expect(record?.evidence).not.toContain(rawSecret);
    expect(ledger.list()).toEqual([record]);
    expect(formatProofLedger(ledger.list())).toContain('verification/deterministic');
  });

  it('ignores torn JSONL lines and returns only the requested tail', () => {
    const ledger = new ProofLedger('goal-tail', {
      storeDir: dir,
      idFactory: (() => {
        let id = 0;
        return () => String(++id);
      })(),
    });
    ledger.append({ turn: 1, kind: 'decision', status: 'fail', assurance: 'judge', summary: 'continue' });
    ledger.append({ turn: 2, kind: 'decision', status: 'pass', assurance: 'judge', summary: 'done' });
    fs.appendFileSync(ledger.getFilePath(), '{torn\n');

    expect(ledger.list(1).map((record) => record.summary)).toEqual(['done']);
  });

  it('chains records and detects evidence tampering', () => {
    const ledger = new ProofLedger('goal-chain', {
      storeDir: dir,
      idFactory: (() => {
        let id = 0;
        return () => String(++id);
      })(),
    });
    const first = ledger.append({
      turn: 1,
      kind: 'verification',
      status: 'pass',
      assurance: 'deterministic',
      summary: 'first oracle',
    });
    const second = ledger.append({
      turn: 2,
      kind: 'decision',
      status: 'pass',
      assurance: 'independent',
      summary: 'accepted',
    });

    expect(second?.previousHash).toBe(first?.recordHash);
    expect(ledger.verifyIntegrity()).toMatchObject({ status: 'valid', checked: 2, errors: [] });

    const tampered = fs.readFileSync(ledger.getFilePath(), 'utf8').replace('first oracle', 'optimistic claim');
    fs.writeFileSync(ledger.getFilePath(), tampered);
    expect(ledger.verifyIntegrity()).toMatchObject({ status: 'broken' });
    expect(ledger.verifyIntegrity().errors).toContain('proof-1: record hash mismatch');
  });

  it('attaches granular criteria and content-addressed workspace artifacts', () => {
    const reportsDir = path.join(dir, 'reports');
    fs.mkdirSync(reportsDir);
    fs.writeFileSync(path.join(reportsDir, 'latency.json'), '{"p95":468}');
    const ledger = new ProofLedger('goal-artifacts', {
      storeDir: path.join(dir, 'proofs'),
      artifactRoot: dir,
      now: () => new Date('2026-07-10T12:00:00.000Z'),
      idFactory: () => 'artifact',
    });

    const record = ledger.append({
      turn: 3,
      kind: 'verification',
      status: 'pass',
      assurance: 'deterministic',
      summary: 'voice benchmark passed',
      criterionResults: [
        { criterionId: 'criterion-latency', status: 'passed', evidence: 'p95=468ms' },
      ],
      artifacts: ['reports/latency.json', '../outside.json'],
    });

    expect(record?.criterionIds).toEqual(['criterion-latency']);
    expect(record?.artifactRefs).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^sha256:/),
        path: 'reports/latency.json',
        mediaType: 'application/json',
        sizeBytes: 11,
      }),
    ]);
  });

  it('rejects path-like goal ids', () => {
    expect(() => new ProofLedger('../escape', { storeDir: dir })).toThrow('invalid goal id');
  });
});
