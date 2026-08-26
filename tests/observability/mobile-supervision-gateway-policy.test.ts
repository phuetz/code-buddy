import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  buildMobileSupervisionGatewayContract,
} from '../../src/observability/mobile-supervision-gateway-contract.js';
import {
  buildMobileSupervisionGatewayReviewDraft,
  evaluateMobileSupervisionGatewayRequest,
  renderMobileSupervisionGatewayReviewDraft,
  renderMobileSupervisionGatewayRequestDecision,
} from '../../src/observability/mobile-supervision-gateway-policy.js';
import { RunStore } from '../../src/observability/run-store.js';

describe('mobile supervision gateway policy', () => {
  it('allows read-only contract endpoints', async () => {
    await withTempStore(async (store) => {
      const contract = await buildMobileSupervisionGatewayContract('mobile policy', {
        includeSnapshot: false,
        store,
      });

      const decision = evaluateMobileSupervisionGatewayRequest(contract, {
        action: 'open_artifact',
        method: 'GET',
        path: '/api/mobile/runs/run_123/artifacts/summary.md',
      });

      expect(decision).toMatchObject({
        action: 'open_artifact',
        allowed: true,
        endpointId: 'mobile.artifact.open',
        requiresLocalOperator: false,
        sideEffects: 'none',
      });
    });
  });

  it('requires a local operator for draft-only follow-up prompts', async () => {
    await withTempStore(async (store) => {
      const contract = await buildMobileSupervisionGatewayContract('mobile policy', {
        includeSnapshot: false,
        store,
      });

      const withoutOperator = evaluateMobileSupervisionGatewayRequest(contract, {
        action: 'draft_followup_prompt',
        method: 'POST',
        path: '/api/mobile/followup-draft',
      });
      const withOperator = evaluateMobileSupervisionGatewayRequest(contract, {
        action: 'draft_followup_prompt',
        hasLocalOperator: true,
        method: 'POST',
        path: '/api/mobile/followup-draft',
      });

      expect(withoutOperator).toMatchObject({
        allowed: false,
        endpointId: 'mobile.followup.draft',
        requiresLocalOperator: true,
        sideEffects: 'draft_only',
      });
      expect(withOperator).toMatchObject({
        allowed: true,
        endpointId: 'mobile.followup.draft',
        requiresLocalOperator: true,
        sideEffects: 'draft_only',
      });
    });
  });

  it('blocks dangerous and unknown gateway requests by default', async () => {
    await withTempStore(async (store) => {
      const contract = await buildMobileSupervisionGatewayContract('mobile policy', {
        includeSnapshot: false,
        store,
      });

      const execute = evaluateMobileSupervisionGatewayRequest(contract, {
        action: 'execute_tool',
        method: 'POST',
        path: '/api/mobile/followup-draft',
      });
      const unknown = evaluateMobileSupervisionGatewayRequest(contract, {
        action: 'view_run_summary',
        method: 'POST',
        path: '/api/mobile/snapshot',
      });

      expect(execute).toMatchObject({
        allowed: false,
        requiresLocalOperator: true,
        sideEffects: 'blocked',
      });
      expect(execute.reason).toContain('remote execution');
      expect(unknown).toMatchObject({
        allowed: false,
        requiresLocalOperator: true,
        sideEffects: 'blocked',
      });
      expect(unknown.reason).toContain('No review-only mobile gateway endpoint');
    });
  });

  it('renders request decisions for terminal review', async () => {
    await withTempStore(async (store) => {
      const contract = await buildMobileSupervisionGatewayContract('mobile policy', {
        includeSnapshot: false,
        store,
      });
      const decision = evaluateMobileSupervisionGatewayRequest(contract, {
        action: 'copy_recall_pack',
        method: 'GET',
        path: 'api/mobile/recall-pack',
      });

      const rendered = renderMobileSupervisionGatewayRequestDecision(decision);

      expect(rendered).toContain('Mobile supervision gateway request decision');
      expect(rendered).toContain('Allowed: true');
      expect(rendered).toContain('GET /api/mobile/recall-pack');
    });
  });

  it('builds local-only operator review drafts for draft-only requests', async () => {
    await withTempStore(async (store) => {
      const contract = await buildMobileSupervisionGatewayContract('mobile policy', {
        includeSnapshot: false,
        store,
      });

      const draft = buildMobileSupervisionGatewayReviewDraft('mobile policy', contract, {
        action: 'draft_followup_prompt',
        method: 'POST',
        path: '/api/mobile/followup-draft',
      });

      expect(draft).toMatchObject({
        kind: 'mobile_gateway_review_draft',
        query: 'mobile policy',
        status: 'needs_local_operator',
        operatorActions: ['approve_draft', 'cancel_draft'],
        safety: {
          autoDispatch: false,
          localOnly: true,
          localApprovalRequired: true,
          remoteExecutionDisabled: true,
        },
      });
      expect(draft.draftId).toMatch(/^mobile_gateway_/);
      expect(draft.decision.allowed).toBe(false);
    });
  });

  it('renders blocked review drafts without approving dangerous operations', async () => {
    await withTempStore(async (store) => {
      const contract = await buildMobileSupervisionGatewayContract('mobile policy', {
        includeSnapshot: false,
        store,
      });
      const draft = buildMobileSupervisionGatewayReviewDraft('mobile policy', contract, {
        action: 'execute_tool',
        method: 'POST',
        path: '/api/mobile/followup-draft',
      });

      expect(draft).toMatchObject({
        status: 'blocked',
        operatorActions: ['reject'],
      });
      const rendered = renderMobileSupervisionGatewayReviewDraft(draft);
      expect(rendered).toContain('Mobile supervision gateway review draft');
      expect(rendered).toContain('Status: blocked');
      expect(rendered).toContain('remoteExecutionDisabled=true');
    });
  });
});

async function withTempStore(
  fn: (store: RunStore) => Promise<void>,
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-gateway-policy-'));
  const store = new RunStore(tempDir);
  try {
    await fn(store);
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 60));
    store.dispose();
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
