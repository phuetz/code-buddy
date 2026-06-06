import { describe, expect, it, vi } from 'vitest';
import {
  buildMissionControlSnapshot,
  type CoreProofLedgerModuleLike,
  type CoreRunStoreLike,
} from '../src/main/fleet/mission-control-snapshot';
import type { FleetPeer } from '../src/renderer/types';

describe('buildMissionControlSnapshot', () => {
  it('summarizes local runs, proof ledgers, peer state, and Fleet sagas', () => {
    const run = {
      artifactCount: 1,
      eventCount: 4,
      metadata: { channel: 'cowork', tags: ['fleet'] },
      objective: 'Verify Mission Control proof cards',
      runId: 'run-proof123456',
      startedAt: 1_780_000_000_000,
      status: 'completed' as const,
    };
    const runStore: CoreRunStoreLike = {
      getRun: vi.fn(() => ({ summary: run })),
      listRuns: vi.fn(() => [run]),
    };
    const proofLedger: CoreProofLedgerModuleLike = {
      buildProofLedgerForRun: vi.fn(() => ({
        artifacts: [{ kind: 'summary', name: 'summary.md' }],
        filesChanged: ['src/observability/proof-ledger.ts'],
        privacy: { redactionCount: 1 },
        risks: [],
        status: 'proven',
        tests: {
          failed: 0,
          passed: 2,
          total: 2,
        },
      })),
    };
    const peers: FleetPeer[] = [
      {
        addedAt: 1,
        capability: {
          activeRequests: 1,
          egress: 'lan',
          machineLabel: 'ministar-linux',
          maxConcurrency: 2,
          models: [
            {
              contextWindow: 200_000,
              id: 'gpt-5.4',
              provider: 'chatgpt-oauth',
              strengths: ['code'],
            },
          ],
        },
        id: 'ministar-linux',
        label: 'MiniStar',
        status: 'authenticated',
        url: 'http://ministar:3000',
      },
      {
        addedAt: 2,
        id: 'openhands-lab',
        lastError: 'health probe failed',
        status: 'error',
        url: 'http://openhands:3000',
      },
    ];

    const snapshot = buildMissionControlSnapshot({
      hostname: 'patrice-win',
      now: new Date('2026-06-06T06:45:00.000Z'),
      peers,
      proofLedger,
      runStore,
      sagas: [
        {
          createdAt: 1_780_000_100_000,
          goal: 'Cross-review the Fleet UI',
          id: 'saga-review123456',
          status: 'running',
          steps: [{ peerId: 'ministar-linux', status: 'running' }],
        },
      ],
    });

    expect(snapshot).toMatchObject({
      generatedAt: '2026-06-06T06:45:00.000Z',
      hostname: 'patrice-win',
      summary: {
        activeAgents: 2,
        activeWork: 1,
        agentCount: 3,
        errorAgents: 1,
        needsAttention: 1,
        provenWork: 1,
        workCount: 2,
      },
    });
    expect(snapshot.agents.find((agent) => agent.id === 'ministar-linux')).toMatchObject({
      activeWork: 1,
      status: 'busy',
    });
    expect(snapshot.agents.find((agent) => agent.id === 'openhands-lab')?.actions).toContainEqual(
      expect.objectContaining({
        enabled: true,
        id: 'reconnect',
      }),
    );
    expect(snapshot.work.find((item) => item.id === 'run-proof123456')).toMatchObject({
      filesChanged: ['src/observability/proof-ledger.ts'],
      proof: {
        passedTests: 2,
        redactionCount: 1,
        status: 'proven',
        totalTests: 2,
      },
      source: 'fleet',
    });
    expect(proofLedger.buildProofLedgerForRun).toHaveBeenCalledWith(runStore, 'run-proof123456');
  });

  it('marks completed runs without proof as unknown instead of proven', () => {
    const snapshot = buildMissionControlSnapshot({
      hostname: 'patrice-win',
      peers: [],
      runs: [
        {
          objective: 'No proof yet',
          runId: 'run-no-proof',
          startedAt: 1,
          status: 'completed',
        },
      ],
    });

    expect(snapshot.summary.provenWork).toBe(0);
    expect(snapshot.summary.incompleteProof).toBe(0);
    expect(snapshot.work[0]?.proof.status).toBe('unknown');
  });
});
