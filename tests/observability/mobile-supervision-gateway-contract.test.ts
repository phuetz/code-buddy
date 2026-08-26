import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildMobileSupervisionGatewayContract,
  renderMobileSupervisionGatewayContract,
} from '../../src/observability/mobile-supervision-gateway-contract.js';
import { RunStore } from '../../src/observability/run-store.js';

let tempDir: string;
let store: RunStore;

describe('mobile supervision gateway contract', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-gateway-contract-'));
    store = new RunStore(tempDir);
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    store.dispose();
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('describes a local-first review-only gateway without remote execution', async () => {
    const runId = store.startRun('Hermes mobile supervision gateway handoff', {
      channel: 'cowork',
      tags: ['mobile', 'gateway'],
    });
    store.saveArtifact(runId, 'summary.md', 'Gateway handoff keeps execution local and exposes only review routes.');
    store.endRun(runId, 'completed');
    await new Promise((resolve) => setTimeout(resolve, 60));

    const contract = await buildMobileSupervisionGatewayContract('mobile gateway handoff', {
      basePath: 'mobile',
      limit: 5,
      sources: ['cowork'],
      store,
    });

    expect(contract).toMatchObject({
      auth: {
        required: true,
        scheme: 'bearer_or_pairing_code',
        ttlSeconds: 900,
      },
      basePath: '/mobile',
      mode: 'contract_only',
      schemaVersion: 1,
      snapshot: {
        mode: 'review_only',
        recallPack: {
          runCount: 1,
        },
      },
      transport: {
        exposure: 'local_first',
        offDeviceTlsRequired: true,
        remoteExecution: 'disabled',
      },
    });
    expect(contract.auth.scopes).toEqual(['mobile:read', 'mobile:draft']);
    expect(contract.endpoints.map((endpoint) => endpoint.path)).toEqual([
      '/mobile/snapshot',
      '/mobile/runs/:runId/artifacts/:artifactPath',
      '/mobile/recall-pack',
      '/mobile/followup-draft',
    ]);
    expect(contract.endpoints.every((endpoint) => endpoint.policy.allowed)).toBe(true);
    expect(contract.endpoints.every((endpoint) => endpoint.sideEffects !== 'none' || !endpoint.localApprovalRequired)).toBe(true);
    expect(contract.endpoints.find((endpoint) => endpoint.action === 'draft_followup_prompt')).toMatchObject({
      localApprovalRequired: true,
      method: 'POST',
      sideEffects: 'draft_only',
    });
    expect(contract.blockedOperations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'execute_tool',
          policy: expect.objectContaining({
            allowed: false,
            requiresLocalOperator: true,
          }),
        }),
        expect.objectContaining({
          action: 'send_email',
          policy: expect.objectContaining({
            allowed: false,
          }),
        }),
      ]),
    );
  });

  it('can omit the embedded snapshot when only the contract shape is needed', async () => {
    const contract = await buildMobileSupervisionGatewayContract('contract only', {
      includeSnapshot: false,
      store,
    });

    expect(contract.snapshot).toBeUndefined();
    expect(contract.endpoints.length).toBeGreaterThan(0);
    expect(contract.blockedOperations.map((operation) => operation.action)).toContain('modify_files');
  });

  it('renders the contract for terminal review', async () => {
    const contract = await buildMobileSupervisionGatewayContract('terminal review', {
      includeSnapshot: false,
      store,
    });

    const rendered = renderMobileSupervisionGatewayContract(contract);

    expect(rendered).toContain('Mobile supervision gateway contract');
    expect(rendered).toContain('remote execution disabled');
    expect(rendered).toContain('GET /api/mobile/snapshot');
    expect(rendered).toContain('Blocked operations:');
  });
});
