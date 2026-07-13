// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OsIntentProofPayload } from '../../../shared/intent-proof-types.js';
import { IntentProofPanel } from './IntentProofPanel.js';

afterEach(cleanup);

const GOAL_ID = 'goal-voice-live';

function populatedPayload(): OsIntentProofPayload {
  return {
    source: 'cowork-session',
    state: {
      goalId: GOAL_ID,
      goal: 'Atteindre des interactions vocales en temps réel',
      status: 'active',
      turnsUsed: 3,
      maxTurns: 10,
      verifyGated: true,
      lastReason: 'Le benchmark p95 doit encore passer sous 500 ms.',
    },
    graph: {
      schemaVersion: 1,
      goalId: GOAL_ID,
      contractRevision: 'contract-1',
      revision: 'revision-1',
      rootNodeId: `${GOAL_ID}:objective`,
      createdAt: '2026-07-10T09:00:00.000Z',
      updatedAt: '2026-07-10T10:00:00.000Z',
      nodes: [
        {
          id: `${GOAL_ID}:objective`,
          kind: 'objective',
          title: 'Atteindre des interactions vocales en temps réel',
          status: 'active',
        },
        {
          id: `${GOAL_ID}:task:T1`,
          kind: 'task',
          title: 'Mesurer la latence',
          sourceId: 'T1',
          status: 'pending',
        },
        {
          id: `${GOAL_ID}:criterion:T1:1`,
          kind: 'criterion',
          title: 'Le benchmark p95 est inférieur à 500 ms',
          sourceId: 'T1',
          status: 'pending',
        },
      ],
      edges: [
        { from: `${GOAL_ID}:objective`, to: `${GOAL_ID}:task:T1`, kind: 'contains' },
        { from: `${GOAL_ID}:task:T1`, to: `${GOAL_ID}:criterion:T1:1`, kind: 'verified_by' },
      ],
    },
    progress: {
      total: 1,
      passed: 1,
      failed: 0,
      unknown: 0,
      unverified: 0,
      coverage: 1,
      criteria: [{
        criterionId: `${GOAL_ID}:criterion:T1:1`,
        title: 'Le benchmark p95 est inférieur à 500 ms',
        sourceId: 'T1',
        status: 'passed',
        assurance: 'deterministic',
        proofIds: ['proof-latency'],
        lastEvidence: 'p95=472ms',
        updatedAt: '2026-07-10T10:00:00.000Z',
      }],
    },
    proofs: [
      {
        schemaVersion: 1,
        id: 'proof-latency',
        goalId: GOAL_ID,
        createdAt: '2026-07-10T10:00:00.000Z',
        turn: 3,
        kind: 'verification',
        status: 'pass',
        assurance: 'deterministic',
        summary: 'Benchmark vocal validé',
        evidence: 'p50=230ms\np95=472ms',
        criterionIds: [`${GOAL_ID}:criterion:T1:1`],
        artifacts: ['reports/voice-latency.json'],
        artifactRefs: [{
          schemaVersion: 1,
          id: 'sha256:voice',
          path: 'reports/voice-latency.json',
          sha256: 'voice',
          sizeBytes: 128,
          mediaType: 'application/json',
          capturedAt: '2026-07-10T10:00:00.000Z',
        }],
        redactionCount: 0,
        chainVersion: 1,
        recordHash: 'record-hash',
      },
    ],
    integrity: { status: 'valid', checked: 1, legacy: 0, errors: [] },
    forgeBranches: [{
      schemaVersion: 1,
      id: 'forge-local',
      goalId: GOAL_ID,
      intentRevision: 'contract-1',
      label: 'Pocket local',
      hypothesis: 'Le chemin local réduit la latence.',
      strategy: 'Pocket TTS en streaming.',
      status: 'selected',
      createdAt: '2026-07-10T09:30:00.000Z',
      updatedAt: '2026-07-10T10:00:00.000Z',
      proofIds: ['proof-latency'],
      criterionIds: [`${GOAL_ID}:criterion:T1:1`],
      artifactHashes: ['voice'],
      metrics: {
        proofCoverage: 1,
        assurance: 1,
        quality: 0.94,
        efficiency: 0.91,
        latencyMs: 472,
        regressions: [],
        score: 0.96,
        eligible: true,
      },
    }],
    outcomes: [{
      schemaVersion: 1,
      id: 'outcome-voice',
      goalId: GOAL_ID,
      intentRevision: 'contract-1',
      goal: 'Atteindre des interactions vocales en temps réel',
      completedAt: '2026-07-10T10:00:00.000Z',
      source: 'buddy-loop',
      trustScore: 1,
      criteria: [{
        criterionId: `${GOAL_ID}:criterion:T1:1`,
        title: 'Le benchmark p95 est inférieur à 500 ms',
        assurance: 'deterministic',
        proofIds: ['proof-latency'],
      }],
      proofIds: ['proof-latency'],
      proofHashes: ['record-hash'],
      artifacts: [],
      lessonCandidateId: 'lc-voice',
    }],
    constitution: {
      schemaVersion: 1,
      goalId: GOAL_ID,
      intentRevision: 'contract-1',
      privacy: 'private-peers',
      maxCostUsd: 2,
      maxLatencyMs: 800,
      requireReversible: true,
      approval: 'on-risk',
      maxRisk: 'high',
      createdAt: '2026-07-10T09:00:00.000Z',
      updatedAt: '2026-07-10T10:00:00.000Z',
    },
    exchangeBids: [{
      bid: {
        schemaVersion: 1,
        id: 'bid-fleet',
        goalId: GOAL_ID,
        intentRevision: 'contract-1',
        label: 'Fleet hybride',
        provider: 'fleet',
        model: 'two-peers',
        origin: 'cowork',
        strategy: 'Deux pairs avec synthèse locale.',
        hypothesis: 'Deux pairs évitent le point de défaillance.',
        evidencePlan: 'Mesurer chaque critère.',
        criterionIds: [`${GOAL_ID}:criterion:T1:1`],
        prediction: { quality: 0.94, latencyMs: 520, costUsd: 0.04 },
        privacy: 'private',
        reversible: true,
        risk: 'high',
        status: 'rehearsed',
        createdAt: '2026-07-10T09:30:00.000Z',
        updatedAt: '2026-07-10T10:00:00.000Z',
        shadowRehearsalId: 'shadow-fleet',
      },
      policy: { allowed: true, requiresApproval: true, violations: [] },
      pareto: true,
      score: 0.94,
      rehearsal: {
        schemaVersion: 1,
        id: 'shadow-fleet',
        goalId: GOAL_ID,
        intentRevision: 'contract-1',
        bidId: 'bid-fleet',
        prediction: { quality: 0.94, latencyMs: 520, costUsd: 0.04 },
        observation: { quality: 0.9, latencyMs: 542, costUsd: 0.04 },
        drift: { quality: 0.04, latency: 0.042, cost: 0, score: 0.035, threshold: 0.1 },
        reversibility: { checkpointTaken: true, rollbackValidated: true, noPersistentSideEffects: true },
        status: 'pass',
        journal: ['Shadow rehearsal started', 'Rollback path verified'],
        createdAt: '2026-07-10T10:00:00.000Z',
      },
      settlement: { constitution: true, shadow: true, proofPlan: true, reversibility: true, readyToAward: true },
    }],
    shadowRehearsals: [{
      schemaVersion: 1,
      id: 'shadow-fleet',
      goalId: GOAL_ID,
      intentRevision: 'contract-1',
      bidId: 'bid-fleet',
      prediction: { quality: 0.94, latencyMs: 520, costUsd: 0.04 },
      observation: { quality: 0.9, latencyMs: 542, costUsd: 0.04 },
      drift: { quality: 0.04, latency: 0.042, cost: 0, score: 0.035, threshold: 0.1 },
      reversibility: { checkpointTaken: true, rollbackValidated: true, noPersistentSideEffects: true },
      status: 'pass',
      journal: ['Shadow rehearsal started', 'Rollback path verified'],
      createdAt: '2026-07-10T10:00:00.000Z',
    }],
    capsules: [],
    ledgerPath: '/tmp/proofs/goal-voice-live.jsonl',
  };
}

describe('IntentProofPanel', () => {
  const commonProps = {
    loading: false,
    pendingAction: null,
    actionError: null,
    onRefresh: vi.fn(),
    onForgeCreate: vi.fn(async () => undefined),
    onForgeEvaluate: vi.fn(async () => undefined),
    onForgeSelect: vi.fn(async () => undefined),
    onConstitutionUpdate: vi.fn(async () => undefined),
    onExchangeBid: vi.fn(async () => undefined),
    onExchangeRehearse: vi.fn(async () => undefined),
    onExchangeAward: vi.fn(async () => undefined),
    onExchangeReject: vi.fn(async () => undefined),
    onCapsuleCreate: vi.fn(async () => undefined),
    onCapsuleActivate: vi.fn(async () => undefined),
    onCapsuleRevoke: vi.fn(async () => undefined),
  };

  it('renders the intent contract, Forge winner, proof inspector and proven outcome', () => {
    render(<IntentProofPanel payload={populatedPayload()} {...commonProps} />);

    expect(screen.getByTestId('intent-objective').textContent).toContain('interactions vocales');
    expect(screen.getByTestId('intent-criterion-list').textContent).toContain('p95 est inférieur à 500 ms');
    expect(screen.getByTestId('forge-branch-list').textContent).toContain('Pocket local');
    expect(screen.getByTestId('proof-inspector').textContent).toContain('Intégrité valide');
    expect(screen.getByTestId('intent-proof-evidence').textContent).toContain('p95=472ms');
    expect(screen.getByTestId('proven-outcome-memory').textContent).toContain('Outcome prouvé');

    fireEvent.click(screen.getByTestId('proof-tab-artifacts'));
    expect(screen.getByTestId('proof-artifact-list').textContent).toContain('voice-latency.json');
  });

  it('shows a durable-loop call to action when there is no intent', () => {
    render(
      <IntentProofPanel
        payload={{
          source: 'none',
          state: null,
          graph: null,
          progress: null,
          proofs: [],
          integrity: { status: 'empty', checked: 0, legacy: 0, errors: [] },
          forgeBranches: [],
          outcomes: [],
          constitution: null,
          exchangeBids: [],
          shadowRehearsals: [],
          capsules: [],
        }}
        {...commonProps}
      />,
    );

    expect(screen.getByTestId('intent-proof-empty').textContent).toContain('/loop <objectif>');
  });

  it('runs a manual refresh', () => {
    const onRefresh = vi.fn();
    render(<IntentProofPanel payload={populatedPayload()} {...commonProps} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByTestId('intent-proof-refresh'));

    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('opens the strategy form and submits a new counterfactual branch', () => {
    const onForgeCreate = vi.fn(async () => undefined);
    render(<IntentProofPanel payload={populatedPayload()} {...commonProps} onForgeCreate={onForgeCreate} />);

    fireEvent.click(screen.getByTestId('forge-create-toggle'));
    const form = screen.getByTestId('forge-create-form');
    const inputs = form.querySelectorAll('input');
    fireEvent.change(inputs[0]!, { target: { value: 'Cloud quality' } });
    fireEvent.change(inputs[1]!, { target: { value: 'Le cloud augmente la qualité.' } });
    fireEvent.change(inputs[2]!, { target: { value: 'Synthèse distante préchauffée.' } });
    fireEvent.submit(form);

    expect(onForgeCreate).toHaveBeenCalledWith({
      label: 'Cloud quality',
      hypothesis: 'Le cloud augmente la qualité.',
      strategy: 'Synthèse distante préchauffée.',
    });
  });

  it('opens the sovereign exchange and awards a fully gated bid', () => {
    const onExchangeAward = vi.fn(async () => undefined);
    render(<IntentProofPanel payload={populatedPayload()} {...commonProps} onExchangeAward={onExchangeAward} />);

    fireEvent.click(screen.getByTestId('agent-os-tab-exchange'));
    expect(screen.getByTestId('sovereign-exchange-view').textContent).toContain('Marché des capacités');
    expect(screen.getByTestId('settlement-contract').textContent).toContain('Prêt à attribuer');
    fireEvent.click(screen.getByTestId('exchange-award'));

    expect(onExchangeAward).toHaveBeenCalledWith('bid-fleet');
  });

  it('compiles a proven outcome from the Capsules workspace', () => {
    const onCapsuleCreate = vi.fn(async () => undefined);
    render(<IntentProofPanel payload={populatedPayload()} {...commonProps} onCapsuleCreate={onCapsuleCreate} />);

    fireEvent.click(screen.getByTestId('agent-os-tab-capsules'));
    expect(screen.getByTestId('outcome-capsule-view').textContent).toContain('Outcome Capsules');
    fireEvent.submit(screen.getByTestId('capsule-create-form'));

    expect(onCapsuleCreate).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 'outcome-voice',
      requiredRuntimes: 2,
    }));
  });
});
