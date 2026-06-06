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
        commands: [
          {
            command: 'npm test -- tests/observability/proof-ledger.test.ts --run',
            durationMs: 640,
            isTest: true,
            sequence: 3,
            success: true,
            toolName: 'shell_exec',
            ts: 1_780_000_000_200,
          },
        ],
        filesChanged: ['src/observability/proof-ledger.ts'],
        privacy: { redactionCount: 1 },
        risks: [],
        status: 'proven',
        tests: {
          commands: [
            {
              command: 'npm test -- tests/observability/proof-ledger.test.ts --run',
              durationMs: 640,
              isTest: true,
              sequence: 3,
              success: true,
              toolName: 'shell_exec',
              ts: 1_780_000_000_200,
            },
          ],
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
      discoveredPeers: [
        {
          label: 'claude-ministar',
          source: 'tailscale',
          url: 'ws://100.64.0.10:3001/ws',
        },
        {
          label: 'already-paired-ministar',
          source: 'manual',
          url: 'http://ministar:3000',
        },
        {
          label: 'duplicate-claude-ministar',
          source: 'manual',
          url: 'ws://100.64.0.10:3001/ws',
        },
      ],
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
        agentCount: 4,
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
    const discoveredAgent = snapshot.agents.find((agent) => agent.label === 'claude-ministar');
    expect(discoveredAgent).toMatchObject({
      activeWork: 0,
      discoverySource: 'tailscale',
      kind: 'fleet-peer',
      machine: 'claude-ministar',
      status: 'unknown',
      statusDetail: 'discovered via Tailscale; not paired yet',
      url: 'ws://100.64.0.10:3001/ws',
    });
    expect(discoveredAgent?.actions).toContainEqual(
      expect.objectContaining({
        enabled: false,
        id: 'refresh',
      }),
    );
    expect(snapshot.agents.some((agent) => agent.label === 'already-paired-ministar')).toBe(false);
    expect(snapshot.agents.some((agent) => agent.label === 'duplicate-claude-ministar')).toBe(false);
    expect(snapshot.work.find((item) => item.id === 'run-proof123456')).toMatchObject({
      filesChanged: ['src/observability/proof-ledger.ts'],
      proof: {
        commandCount: 1,
        lastCommandDurationMs: 640,
        lastCommandStatus: 'passed',
        lastCommandText: 'npm test -- tests/observability/proof-ledger.test.ts --run',
        lastCommandTool: 'shell_exec',
        passedTests: 2,
        redactionCount: 1,
        status: 'proven',
        testCommandCount: 1,
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
