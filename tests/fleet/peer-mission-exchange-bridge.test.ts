import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetPeerMissionExchangeBridgeForTests,
  wirePeerMissionExchangeBridge,
} from '../../src/fleet/peer-mission-exchange-bridge.js';
import { getGoalManager, resetGoalManagers } from '../../src/goals/goal-manager.js';
import { GoalStore } from '../../src/goals/goal-store.js';
import { getPeerMethodHandler } from '../../src/server/websocket/peer-method-registry.js';

describe('peer Mission Exchange bridge', () => {
  let dir: string;
  let previousHome: string | undefined;
  let previousAllow: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-exchange-'));
    previousHome = process.env.CODEBUDDY_HOME;
    previousAllow = process.env.CODEBUDDY_PEER_EXCHANGE_ALLOW_BIDS;
    process.env.CODEBUDDY_HOME = dir;
    delete process.env.CODEBUDDY_PEER_EXCHANGE_ALLOW_BIDS;
    resetGoalManagers(new GoalStore({ storeDir: path.join(dir, 'goals') }));
    _resetPeerMissionExchangeBridgeForTests();
    wirePeerMissionExchangeBridge();
  });

  afterEach(() => {
    _resetPeerMissionExchangeBridgeForTests();
    resetGoalManagers();
    if (previousHome === undefined) delete process.env.CODEBUDDY_HOME;
    else process.env.CODEBUDDY_HOME = previousHome;
    if (previousAllow === undefined) delete process.env.CODEBUDDY_PEER_EXCHANGE_ALLOW_BIDS;
    else process.env.CODEBUDDY_PEER_EXCHANGE_ALLOW_BIDS = previousAllow;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const context = {
    connectionId: 'peer-connection-1',
    scopes: ['peer:invoke'],
    traceId: 'trace-1',
    depth: 0,
  };

  it('describes only the contract metadata and fails closed for inbound bids', async () => {
    const manager = getGoalManager();
    manager.set('Secret mission objective');
    manager.addSubgoal('criterion one');
    const describe = getPeerMethodHandler('peer.mission-exchange.describe')!;
    const payload = await describe({}, context) as Record<string, unknown>;
    expect(payload).toMatchObject({ active: true, acceptsBids: false });
    expect(JSON.stringify(payload)).not.toContain('Secret mission objective');

    const offer = getPeerMethodHandler('peer.mission-exchange.offer')!;
    await expect(offer({}, context)).rejects.toThrow(/FLEET_BIDS_DISABLED/);
  });

  it('accepts an exact-revision offer when the explicit fleet switch is enabled', async () => {
    const manager = getGoalManager();
    manager.set('Route a mission');
    manager.addSubgoal('criterion one');
    process.env.CODEBUDDY_PEER_EXCHANGE_ALLOW_BIDS = '1';
    const describe = getPeerMethodHandler('peer.mission-exchange.describe')!;
    const contract = await describe({}, context) as {
      goalId: string;
      intentRevision: string;
      criterionIds: string[];
    };
    const offer = getPeerMethodHandler('peer.mission-exchange.offer')!;
    const result = await offer({
      goalId: contract.goalId,
      intentRevision: contract.intentRevision,
      label: 'Remote local model',
      provider: 'vllm',
      model: 'gemma-4',
      strategy: 'Run locally and return proof artifacts',
      hypothesis: 'Local execution reduces latency',
      evidencePlan: 'Measure every criterion',
      criterionIds: contract.criterionIds,
      quality: 0.9,
      latencyMs: 300,
      costUsd: 0,
      privacy: 'local',
      reversible: true,
      risk: 'low',
    }, context) as { bid: { origin: string }; policy: { allowed: boolean } };
    expect(result.bid.origin).toBe('peer:peer-connection-1');
    expect(result.policy.allowed).toBe(true);

    await expect(offer({ ...result, goalId: contract.goalId, intentRevision: 'stale' }, context))
      .rejects.toThrow(/INTENT_REVISION_MISMATCH/);
  });
});
