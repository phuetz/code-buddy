import path from 'node:path';
import type { Page } from '@playwright/test';

import type { OsIntentProofPayload } from '../src/shared/intent-proof-types';
import { expect, test } from './fixtures';

async function dismissOnboardingIfPresent(appPage: Page) {
  await appPage.evaluate(async () => {
    localStorage.setItem('cowork.tourSeen', '1');
    await (window as unknown as {
      electronAPI?: { config?: { save?: (config: Record<string, unknown>) => Promise<unknown> } };
    }).electronAPI?.config?.save?.({ onboardingCompleted: true });
  });
  const onboarding = appPage.getByTestId('onboarding-wizard');
  if (await onboarding.isVisible({ timeout: 2000 }).catch(() => false)) {
    await appPage.getByTestId('onboarding-skip').click();
    await expect(onboarding).toBeHidden();
  }
  const tour = appPage.getByTestId('onboarding-tour');
  if (await tour.isVisible({ timeout: 1000 }).catch(() => false)) {
    await tour.getByRole('button', { name: 'Passer', exact: true }).click();
    await expect(tour).toBeHidden();
  }
}

const SESSION_ID = 'mission-control-proof-e2e';
const GOAL_ID = 'goal-mission-control-proof';
const CRITERION_ID = `${GOAL_ID}:criterion:T2:1`;

const SHADOW_REHEARSAL: OsIntentProofPayload['shadowRehearsals'][number] = {
  schemaVersion: 1,
  id: 'shadow-e2e-fleet',
  goalId: GOAL_ID,
  intentRevision: 'e2e-contract',
  bidId: 'bid-e2e-fleet',
  prediction: { quality: 0.94, latencyMs: 520, costUsd: 0.04 },
  observation: { quality: 0.9, latencyMs: 542, costUsd: 0.04 },
  drift: { quality: 0.04, latency: 0.042, cost: 0, score: 0.042, threshold: 0.1 },
  reversibility: { checkpointTaken: true, rollbackValidated: true, noPersistentSideEffects: true },
  status: 'pass',
  journal: ['Shadow démarrée', '1ère réponse reçue', 'Comparaison terminée', 'Dérive calculée (4,2 %)'],
  createdAt: '2026-07-10T10:10:00.000Z',
};

const LOCAL_SHADOW_REHEARSAL: OsIntentProofPayload['shadowRehearsals'][number] = {
  ...SHADOW_REHEARSAL,
  id: 'shadow-e2e-local',
  bidId: 'bid-e2e-local',
  prediction: { quality: 0.91, latencyMs: 310, costUsd: 0 },
  observation: { quality: 0.9, latencyMs: 318, costUsd: 0 },
  drift: { quality: 0.01, latency: 0.026, cost: 0, score: 0.015, threshold: 0.1 },
};

const PAYLOAD: OsIntentProofPayload = {
  source: 'cowork-session',
  state: {
    goalId: GOAL_ID,
    goal: 'Atteindre des interactions vocales en temps réel',
    status: 'active',
    turnsUsed: 5,
    maxTurns: 12,
    verifyGated: true,
    lastVerdict: 'continue',
    lastReason: 'Le chemin local passe; le fallback distant reste à mesurer.',
  },
  graph: {
    schemaVersion: 1,
    goalId: GOAL_ID,
    contractRevision: 'e2e-contract',
    revision: 'e2e-revision',
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
        title: 'Mesurer le pipeline complet',
        sourceId: 'T1',
        status: 'pending',
      },
      {
        id: `${GOAL_ID}:task:T2`,
        kind: 'task',
        title: 'Optimiser Pocket TTS',
        sourceId: 'T2',
        status: 'pending',
      },
      {
        id: `${GOAL_ID}:criterion:T2:1`,
        kind: 'criterion',
        title: 'Le p95 voix-à-voix reste inférieur à 500 ms',
        sourceId: 'T2',
        status: 'pending',
      },
    ],
    edges: [
      { from: `${GOAL_ID}:objective`, to: `${GOAL_ID}:task:T1`, kind: 'contains' },
      { from: `${GOAL_ID}:objective`, to: `${GOAL_ID}:task:T2`, kind: 'contains' },
      { from: `${GOAL_ID}:task:T2`, to: `${GOAL_ID}:task:T1`, kind: 'depends_on' },
      { from: `${GOAL_ID}:task:T2`, to: `${GOAL_ID}:criterion:T2:1`, kind: 'verified_by' },
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
      criterionId: `${GOAL_ID}:criterion:T2:1`,
      title: 'Le p95 voix-à-voix reste inférieur à 500 ms',
      sourceId: 'T2',
      status: 'passed',
      assurance: 'deterministic',
      proofIds: ['proof-e2e-latency'],
    }],
  },
  proofs: [
    {
      schemaVersion: 1,
      id: 'proof-e2e-latency',
      goalId: GOAL_ID,
      createdAt: '2026-07-10T10:00:00.000Z',
      turn: 5,
      kind: 'verification',
      status: 'pass',
      assurance: 'deterministic',
      summary: 'Benchmark Pocket TTS validé',
      evidence: 'p50=228ms\np95=468ms\ninterruptions=0',
      criterionIds: [`${GOAL_ID}:criterion:T2:1`],
      artifacts: ['reports/voice-latency.json'],
      artifactRefs: [{
        schemaVersion: 1,
        id: 'sha256:voice-e2e',
        path: 'reports/voice-latency.json',
        sha256: 'voice-e2e',
        sizeBytes: 256,
        mediaType: 'application/json',
        capturedAt: '2026-07-10T10:00:00.000Z',
      }],
      redactionCount: 0,
      chainVersion: 1,
      recordHash: 'e2e-record-hash',
    },
  ],
  integrity: { status: 'valid', checked: 1, legacy: 0, errors: [] },
  forgeBranches: [{
    schemaVersion: 1,
    id: 'forge-e2e-local',
    goalId: GOAL_ID,
    intentRevision: 'e2e-contract',
    label: 'Pocket local',
    hypothesis: 'Le chemin local minimise la latence.',
    strategy: 'Pocket TTS avec chunks de phrases.',
    status: 'selected',
    createdAt: '2026-07-10T09:30:00.000Z',
    updatedAt: '2026-07-10T10:00:00.000Z',
    proofIds: ['proof-e2e-latency'],
    criterionIds: [`${GOAL_ID}:criterion:T2:1`],
    artifactHashes: ['voice-e2e'],
    metrics: {
      proofCoverage: 1,
      assurance: 1,
      quality: 0.94,
      efficiency: 0.91,
      latencyMs: 468,
      regressions: [],
      score: 0.96,
      eligible: true,
    },
  }],
  outcomes: [{
    schemaVersion: 1,
    id: 'outcome-e2e-voice',
    goalId: GOAL_ID,
    intentRevision: 'e2e-contract',
    goal: 'Atteindre des interactions vocales en temps réel',
    completedAt: '2026-07-10T10:00:00.000Z',
    source: 'buddy-loop',
    trustScore: 1,
    criteria: [{
      criterionId: `${GOAL_ID}:criterion:T2:1`,
      title: 'Le p95 voix-à-voix reste inférieur à 500 ms',
      assurance: 'deterministic',
      proofIds: ['proof-e2e-latency'],
    }],
    proofIds: ['proof-e2e-latency'],
    proofHashes: ['e2e-record-hash'],
    artifacts: [],
    lessonCandidateId: 'lc-e2e-voice',
  }],
  constitution: {
    schemaVersion: 1,
    goalId: GOAL_ID,
    intentRevision: 'e2e-contract',
    privacy: 'private-peers',
    maxCostUsd: 2,
    maxLatencyMs: 800,
    requireReversible: true,
    approval: 'on-risk',
    maxRisk: 'high',
    createdAt: '2026-07-10T09:00:00.000Z',
    updatedAt: '2026-07-10T10:00:00.000Z',
  },
  exchangeBids: [
    {
      bid: {
        schemaVersion: 1,
        id: 'bid-e2e-local',
        goalId: GOAL_ID,
        intentRevision: 'e2e-contract',
        label: 'Pocket local',
        provider: 'vLLM',
        model: 'Gemma 4',
        origin: 'local',
        strategy: 'Pocket TTS avec chunks de phrases.',
        hypothesis: 'Le local réduit le premier audio.',
        evidencePlan: 'Mesurer qualité et latence.',
        criterionIds: [CRITERION_ID],
        prediction: { quality: 0.91, latencyMs: 310, costUsd: 0 },
        privacy: 'local',
        reversible: true,
        risk: 'low',
        status: 'submitted',
        createdAt: '2026-07-10T09:30:00.000Z',
        updatedAt: '2026-07-10T09:30:00.000Z',
      },
      policy: { allowed: true, requiresApproval: false, violations: [] },
      pareto: true,
      score: 0.91,
      rehearsal: LOCAL_SHADOW_REHEARSAL,
      settlement: { constitution: true, shadow: true, proofPlan: false, reversibility: true, readyToAward: false },
    },
    {
      bid: {
        schemaVersion: 1,
        id: 'bid-e2e-cloud',
        goalId: GOAL_ID,
        intentRevision: 'e2e-contract',
        label: 'Nemotron Council',
        provider: 'OpenRouter',
        model: 'Nemotron Ultra',
        origin: 'peer:council',
        strategy: 'Council cloud multi-modèle.',
        hypothesis: 'Le cloud améliore la prosodie.',
        evidencePlan: 'Mesurer qualité et latence.',
        criterionIds: [CRITERION_ID],
        prediction: { quality: 0.96, latencyMs: 680, costUsd: 0 },
        privacy: 'cloud',
        reversible: true,
        risk: 'medium',
        status: 'submitted',
        createdAt: '2026-07-10T09:31:00.000Z',
        updatedAt: '2026-07-10T09:31:00.000Z',
      },
      policy: { allowed: false, requiresApproval: false, violations: ['privacy cloud exceeds private-peers'] },
      pareto: false,
      score: 0,
      rehearsal: null,
      settlement: { constitution: false, shadow: false, proofPlan: true, reversibility: false, readyToAward: false },
    },
    {
      bid: {
        schemaVersion: 1,
        id: 'bid-e2e-fleet',
        goalId: GOAL_ID,
        intentRevision: 'e2e-contract',
        label: 'Fleet hybride',
        provider: '2 pairs',
        model: 'synthèse locale',
        origin: 'peer:fleet',
        strategy: 'Deux pairs avec synthèse locale.',
        hypothesis: 'Deux pairs évitent le point de défaillance.',
        evidencePlan: 'Mesurer chaque critère et attacher les traces.',
        criterionIds: [CRITERION_ID],
        prediction: { quality: 0.94, latencyMs: 520, costUsd: 0.04 },
        privacy: 'private',
        reversible: true,
        risk: 'high',
        status: 'rehearsed',
        createdAt: '2026-07-10T09:32:00.000Z',
        updatedAt: '2026-07-10T10:10:00.000Z',
        shadowRehearsalId: SHADOW_REHEARSAL.id,
      },
      policy: { allowed: true, requiresApproval: true, violations: [] },
      pareto: true,
      score: 0.94,
      rehearsal: SHADOW_REHEARSAL,
      settlement: { constitution: true, shadow: true, proofPlan: true, reversibility: true, readyToAward: true },
    },
  ],
  shadowRehearsals: [SHADOW_REHEARSAL, LOCAL_SHADOW_REHEARSAL],
  capsules: [],
};

test('Mission Control renders the active-session intent graph and expandable proof', async ({
  electronApp,
  appPage,
}) => {
  const consoleErrors: string[] = [];
  appPage.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await dismissOnboardingIfPresent(appPage);
  const browserWindow = await electronApp.browserWindow(appPage);
  await browserWindow.evaluate((window) => window.setSize(1584, 992));

  await electronApp.evaluate(({ ipcMain }, { payload, expectedSessionId }) => {
    ipcMain.removeHandler('os.intentProof');
    ipcMain.handle('os.intentProof', async (_event, input?: { sessionId?: string }) => {
      if (input?.sessionId !== expectedSessionId) {
        return {
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
        };
      }
      return payload;
    });
    ipcMain.removeHandler('os.intentForgeCreate');
    ipcMain.handle('os.intentForgeCreate', async (_event, input?: { sessionId?: string; label?: string }) => {
      if (input?.sessionId !== expectedSessionId || input.label !== 'Cloud quality') {
        return { ok: false, error: 'unexpected forge input', payload };
      }
      return {
        ok: true,
        payload: {
          ...payload,
          forgeBranches: [...payload.forgeBranches, {
            schemaVersion: 1,
            id: 'forge-e2e-cloud',
            goalId: payload.state.goalId,
            intentRevision: payload.graph.contractRevision,
            label: input.label,
            hypothesis: 'Le cloud améliore la qualité.',
            strategy: 'Synthèse distante préchauffée.',
            status: 'planned',
            createdAt: '2026-07-10T10:05:00.000Z',
            updatedAt: '2026-07-10T10:05:00.000Z',
            proofIds: [],
            criterionIds: [],
            artifactHashes: [],
          }],
        },
      };
    });
    ipcMain.removeHandler('os.intentExchangeRehearse');
    ipcMain.handle('os.intentExchangeRehearse', async (_event, input?: { sessionId?: string; bidId?: string }) => {
      if (input?.sessionId !== expectedSessionId || input.bidId !== 'bid-e2e-fleet') {
        return { ok: false, error: 'unexpected rehearsal input', payload };
      }
      return { ok: true, payload };
    });
    ipcMain.removeHandler('os.intentExchangeAward');
    ipcMain.handle('os.intentExchangeAward', async (_event, input?: { sessionId?: string; bidId?: string; humanApproved?: boolean }) => {
      if (input?.sessionId !== expectedSessionId || input.bidId !== 'bid-e2e-fleet' || input.humanApproved !== true) {
        return { ok: false, error: 'unexpected award input', payload };
      }
      return {
        ok: true,
        payload: {
          ...payload,
          exchangeBids: payload.exchangeBids.map((entry) => entry.bid.id === input.bidId
            ? { ...entry, bid: { ...entry.bid, status: 'awarded', forgeBranchId: 'forge-e2e-awarded' } }
            : entry),
        },
      };
    });
  }, { payload: PAYLOAD, expectedSessionId: SESSION_ID });

  await appPage.evaluate(
    ({ sessionId, createdAt }) => {
      const store = (
        window as unknown as {
          useAppStore?: {
            getState: () => {
              addSession: (session: unknown) => void;
              setActiveSession: (sessionId: string) => void;
              setNewShellEnabled: (enabled: boolean) => void;
              setPrimaryView: (view: string) => void;
              appConfig?: Record<string, unknown> | null;
              setAppConfig: (config: Record<string, unknown>) => void;
            };
          };
        }
      ).useAppStore?.getState();
      if (!store) throw new Error('useAppStore missing');
      store.setAppConfig({
        ...(store.appConfig ?? {}),
        activeConfigSetId: 'local-fast',
        configSets: [
          {
            id: 'local-fast', name: 'Local Fast', provider: 'ollama', customProtocol: 'openai', activeProfileKey: 'ollama',
            profiles: { ollama: { apiKey: '', model: 'qwen3.5:3b' } }, enableThinking: false, updatedAt: '',
          },
          {
            id: 'cloud-measured', name: 'Cloud Measured', provider: 'openrouter', customProtocol: 'openai', activeProfileKey: 'openrouter',
            profiles: { openrouter: { apiKey: '', model: 'gemini-flash' } }, enableThinking: false, updatedAt: '',
          },
        ],
      });
      store.addSession({
        id: 'e2e-measured-runtime',
        title: 'Benchmark Gemini Flash',
        status: 'completed',
        cwd: '/tmp/codebuddy-voice',
        mountedPaths: [],
        allowedTools: [],
        memoryEnabled: false,
        model: 'gemini-flash',
        intelligence: {
          configSetId: 'cloud-measured', profileId: 'openrouter', thinkingLevel: 'minimal', fastMode: true,
          executionLocation: 'cloud', latencyBudgetMs: 700,
          latencyHistory: [120, 140, 130, 125, 135].map((firstTokenMs, index) => ({
            firstTokenMs,
            totalMs: firstTokenMs + 300,
            measuredAt: createdAt - (index + 1) * 1_000,
            configSetId: 'cloud-measured',
            model: 'gemini-flash',
          })),
        },
        createdAt: createdAt - 10_000,
        updatedAt: createdAt - 1_000,
      });
      store.addSession({
        id: sessionId,
        title: 'Mission voix temps réel',
        status: 'idle',
        cwd: '/tmp/codebuddy-voice',
        mountedPaths: [],
        allowedTools: [],
        memoryEnabled: false,
        model: 'local-low-latency',
        intelligence: {
          configSetId: 'local-fast',
          profileId: 'ollama',
          thinkingLevel: 'medium',
          fastMode: false,
          executionLocation: 'local',
          latencyBudgetMs: 900,
          cacheState: 'warm',
          lastLatency: { firstTokenMs: 420, totalMs: 880, measuredAt: createdAt },
          latencyHistory: [
            { firstTokenMs: 510, totalMs: 930, measuredAt: createdAt - 2_000 },
            { firstTokenMs: 640, totalMs: 990, measuredAt: createdAt - 1_000 },
            { firstTokenMs: 420, totalMs: 880, measuredAt: createdAt },
          ],
        },
        createdAt,
        updatedAt: createdAt,
      });
      store.setActiveSession(sessionId);
      store.setNewShellEnabled(true);
      store.setPrimaryView('chat');
    },
    { sessionId: SESSION_ID, createdAt: Date.now() },
  );

  await expect(appPage.getByTestId('session-intelligence-bar')).toBeVisible();
  // Config hydration can finish after the synthetic session is inserted. Apply
  // the deterministic benchmark sets once the header is mounted so this test
  // exercises the same live store update as Settings.
  await appPage.evaluate(() => {
    const store = (window as unknown as { useAppStore?: { getState: () => { appConfig?: Record<string, unknown> | null; setAppConfig: (config: Record<string, unknown>) => void } } }).useAppStore?.getState();
    if (!store) throw new Error('useAppStore missing');
    store.setAppConfig({
      ...(store.appConfig ?? {}),
      activeConfigSetId: 'local-fast',
      configSets: [
        {
          id: 'local-fast', name: 'Local Fast', provider: 'ollama', customProtocol: 'openai', activeProfileKey: 'ollama',
          profiles: { ollama: { apiKey: '', model: 'qwen3.5:3b' } }, enableThinking: false, updatedAt: '',
        },
        {
          id: 'cloud-measured', name: 'Cloud Measured', provider: 'openrouter', customProtocol: 'openai', activeProfileKey: 'openrouter',
          profiles: { openrouter: { apiKey: '', model: 'gemini-flash' } }, enableThinking: false, updatedAt: '',
        },
      ],
    });
  });
  await expect(appPage.getByTestId('session-runtime-profile')).toContainText('Local Fast');
  await expect(appPage.getByTestId('session-latency')).toContainText('420 ms');
  await appPage.getByTestId('session-latency').hover();
  await expect(appPage.getByRole('tooltip')).toContainText('p95 640 ms');
  await expect(appPage.getByTestId('universal-preview-rail')).toBeVisible();
  await expect(appPage.getByTestId('runtime-observatory')).toContainText('Mission voix temps réel');
  await expect(appPage.getByTestId('runtime-observatory')).toContainText('p95 640ms');
  await appPage.screenshot({ path: path.join('/tmp', 'codebuddy-runtime-observatory.png'), fullPage: false });
  await appPage.getByTestId('session-fast-mode').hover();
  await expect(appPage.getByRole('tooltip')).toContainText('p50 mesurée de 130 ms');
  await appPage.getByTestId('session-fast-mode').click();
  await expect(appPage.getByTestId('session-fast-mode')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => appPage.evaluate(() => {
    const state = (window as unknown as { useAppStore?: { getState: () => { sessions: Array<{ id: string; model?: string; intelligence?: { configSetId?: string } }> } } }).useAppStore?.getState();
    const active = state?.sessions.find((session) => session.id === 'mission-control-proof-e2e');
    return { model: active?.model, configSetId: active?.intelligence?.configSetId };
  })).toEqual({ model: 'gemini-flash', configSetId: 'cloud-measured' });
  await expect(appPage.getByTestId('session-intelligence-bar')).toContainText('cloud');
  await expect(appPage.getByTestId('runtime-observatory').getByRole('button').first()).toContainText('p95 —');
  await appPage.screenshot({ path: path.join('/tmp', 'codebuddy-adaptive-fast.png'), fullPage: false });
  await appPage.getByTestId('preview-rail-tab-proofs').click();
  await expect(appPage.getByTestId('proof-aware-preview')).toContainText('Outcome Capsules');
  await appPage.screenshot({ path: path.join('/tmp', 'codebuddy-continuity-fabric.png'), fullPage: false });
  await appPage.evaluate(() => (window as unknown as { useAppStore?: { getState: () => { setPrimaryView: (view: string) => void } } }).useAppStore?.getState().setPrimaryView('os'));

  const panel = appPage.getByTestId('intent-proof-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('intent-objective')).toContainText('interactions vocales en temps réel');
  await expect(panel.getByTestId('intent-criterion-list')).toContainText('p95 voix-à-voix');
  await expect(panel.getByTestId('forge-branch-list')).toContainText('Pocket local');
  await expect(panel.getByTestId('proof-inspector')).toContainText('Intégrité valide');
  await expect(panel.getByTestId('proven-outcome-memory')).toContainText('Outcome prouvé');
  await expect(panel).toContainText('gate indépendant');

  await expect(panel.getByTestId('intent-proof-evidence')).toContainText('p95=468ms');
  await panel.getByTestId('proof-tab-artifacts').click();
  await expect(panel.getByTestId('proof-artifact-list')).toContainText('voice-latency.json');

  await panel.getByTestId('forge-create-toggle').click();
  const forgeForm = panel.getByTestId('forge-create-form');
  await forgeForm.locator('input').nth(0).fill('Cloud quality');
  await forgeForm.locator('input').nth(1).fill('Le cloud améliore la qualité.');
  await forgeForm.locator('input').nth(2).fill('Synthèse distante préchauffée.');
  await forgeForm.getByRole('button', { name: 'Créer' }).click();
  await expect(panel.getByTestId('forge-branch-list')).toContainText('Cloud quality');
  await panel.getByTestId('proof-tab-proof').click();
  await expect(panel.getByTestId('intent-proof-evidence')).toContainText('p95=468ms');

  await appPage.screenshot({
    path: path.join('/tmp', 'codebuddy-mission-control-intent-proof.png'),
    fullPage: false,
  });

  await panel.getByTestId('agent-os-tab-exchange').click();
  await expect(panel.getByTestId('sovereign-exchange-view')).toBeVisible();
  await panel.getByTestId('agent-os-tab-exchange').hover();
  await expect(appPage.getByRole('tooltip')).toContainText('Compare les offres des modèles locaux');
  await panel.getByTestId('agent-os-tab-exchange').focus();
  await expect(appPage.getByRole('tooltip')).toContainText('respecte la Constitution');
  await expect(panel.getByTestId('exchange-bid-list')).toContainText('Nemotron Council');
  await expect(panel.getByTestId('exchange-bid-list')).toContainText('Bloqué par la constitution');
  await expect(panel.getByTestId('settlement-contract')).toContainText('Prêt à attribuer');
  await panel.getByRole('button', { name: 'Répéter en shadow' }).click();
  const rehearsalForm = panel.getByTestId('shadow-rehearsal-form');
  await expect(rehearsalForm).toContainText('Observations mesurées');
  await rehearsalForm.getByRole('button', { name: 'Enregistrer la répétition' }).click();
  await expect(panel.getByTestId('shadow-twin-inspector')).toContainText('4,2 %');

  await appPage.screenshot({
    path: path.join('/tmp', 'codebuddy-sovereign-exchange.png'),
    fullPage: false,
  });

  await panel.getByTestId('exchange-award').click();
  await expect(panel.getByTestId('exchange-bid-list')).toContainText('Attribué');
  await expect(panel.getByTestId('exchange-award')).toContainText('Mission attribuée');

  await appPage.screenshot({
    path: path.join('/tmp', 'codebuddy-sovereign-exchange-awarded.png'),
    fullPage: false,
  });

  await panel.getByTestId('agent-os-tab-capsules').click();
  await expect(panel.getByTestId('outcome-capsule-view')).toBeVisible();
  await expect(panel.getByTestId('outcome-capsule-view')).toContainText('Outcome Capsules');
  await expect(panel.getByTestId('capsule-create-form')).toContainText('Runtimes indépendants requis');
  await expect(panel.getByRole('button', { name: 'Compiler la capsule' })).toBeVisible();
  await appPage.screenshot({
    path: path.join('/tmp', 'codebuddy-outcome-capsules.png'),
    fullPage: false,
  });
  expect(consoleErrors).toEqual([]);
});
