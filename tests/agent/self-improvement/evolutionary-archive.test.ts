import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { EvolutionaryArchive } from '../../../src/agent/self-improvement/evolutionary-archive.js';

let workDir: string;
beforeEach(() => {
  workDir = path.join(os.tmpdir(), `archive-test-${randomUUID()}`);
});
afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe('EvolutionaryArchive', () => {
  it('archive en ajout seul - refuse overwriting an entry with a different SHA', () => {
    const archive = new EvolutionaryArchive({ workDir });
    archive.append({
      proposalId: 'p1',
      kind: 'tool',
      targetScenarioId: 's1',
      delta: 1,
      scoreAfter: 1,
      evidence: { pairedWins: 1, pairedLosses: 0, pairedTies: 0, pImprove: 1, artifactSha256: 'sha-a' }
    });

    expect(() => {
      archive.append({
        proposalId: 'p1',
        kind: 'tool',
        targetScenarioId: 's1',
        delta: 1,
        scoreAfter: 1,
        evidence: { pairedWins: 1, pairedLosses: 0, pairedTies: 0, pImprove: 1, artifactSha256: 'sha-b' }
      });
    }).toThrow(/archive fingerprint conflict/);
  });
});
