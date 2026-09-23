/**
 * Vrai SagaRunner + vrai saga-store (loadCoreModule, pas une doublure).
 *
 * Sans dist/fleet/saga-store.js, loadCoreModule ne trouve aucun fichier :
 * le journal est « Failed to load fleet/saga-store.js from any candidate [] »
 * puis « saga-store module unavailable », et le runner ne dispatche rien.
 * Le repli CODEBUDDY_ENGINE_TS_FALLBACK ne suffit pas : les sources
 * importent des spécificateurs .js que Node ne réécrit pas vers .ts.
 *
 * La barrière construit donc ces modules (saga-store, task-router,
 * result-aggregator, model-routing) et pose CODEBUDDY_ENGINE_PATH.
 * Pairs et réponses LLM sont synthétiques. Le store écrit sous un
 * CODEBUDDY_HOME temporaire.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadCoreModule } from '../src/main/utils/core-loader';
import { SagaRunner, _resetSagaRunnerLockForTests } from '../src/main/fleet/saga-runner';

const ERREUR = 'fetch failed: connect ECONNREFUSED 127.0.0.1:11434';

interface SagaStepRecord {
  peerId: string;
  provider?: string;
  lane: string;
  role?: string;
  status: string;
  error?: string;
  outcome?: string;
  result?: string;
  retried?: boolean;
  attempts?: Array<{
    status: string;
    error?: string;
    failureDomain?: string;
    providerRequested?: string;
    providerResolved?: string;
  }>;
}

interface SagaRecord {
  id: string;
  status: string;
  finalResult?: string;
  steps: SagaStepRecord[];
}

interface SagaStoreModule {
  getSagaStore: () => {
    create: (input: {
      goal: string;
      plan: Record<string, unknown>;
    }) => Promise<SagaRecord>;
    load: (id: string) => Promise<SagaRecord | null>;
  };
  resetSagaStore: () => void;
  SagaStore: unknown;
}

interface RouterModule {
  TaskRouter: new () => unknown;
}

interface ClassifierModule {
  classifyTaskComplexity: (message: string) => unknown;
}

interface AggregatorModule {
  finaliseFromSingle: (saga: unknown) => string | null;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const enginePath = process.env.CODEBUDDY_ENGINE_PATH ?? path.join(repoRoot, 'dist');

let sagaMod: SagaStoreModule;
const homes: string[] = [];

function lane(peerId: string, model: string, provider: string, role?: string) {
  return {
    peerId,
    model,
    provider,
    ...(role ? { role } : {}),
    score: 0.5,
    breakdown: { match: 0.5, cost: 0.5, load: 1, latency: 1 },
  };
}

function model(id: string, provider: 'openrouter' | 'lemonade', egress: 'cloud' | 'local') {
  return {
    id,
    provider,
    egress,
    contextWindow: 32_768,
    strengths: ['code', 'reasoning'],
    costInputUsdPerMtok: provider === 'lemonade' ? 0 : 1,
    costOutputUsdPerMtok: provider === 'lemonade' ? 0 : 1,
    avgLatencyMs: 200,
  };
}

function robotCapability() {
  return {
    egress: 'local' as const,
    machineLabel: 'robot',
    roles: ['code'],
    maxConcurrency: 4,
    activeRequests: 0,
    models: [
      model('cloud-a', 'openrouter', 'cloud'),
      model('local-b', 'lemonade', 'local'),
    ],
  };
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 8_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`attente dépassée (${timeoutMs} ms)`);
}

beforeAll(async () => {
  const sagaFile = path.join(enginePath, 'fleet', 'saga-store.js');
  if (!existsSync(sagaFile)) {
    throw new Error(
      `saga-store.js introuvable sous ${enginePath}. Sans ce dist, loadCoreModule ` +
        'renvoie null (journal « saga-store module unavailable ») : aucun .js, et le repli .ts est off par défaut.',
    );
  }
  process.env.CODEBUDDY_ENGINE_PATH = enginePath;
  delete process.env.CODEBUDDY_ENGINE_TS_FALLBACK;
  const loaded = await loadCoreModule<SagaStoreModule>('fleet/saga-store.js');
  const router = await loadCoreModule<RouterModule>('fleet/task-router.js');
  const classifier = await loadCoreModule<ClassifierModule>('optimization/model-routing.js');
  const aggregator = await loadCoreModule<AggregatorModule>('fleet/result-aggregator.js');
  console.log('MODULES_REELS ' + JSON.stringify({
    engine: enginePath,
    saga: loaded ? Object.keys(loaded).sort() : null,
    taskRouter: typeof router?.TaskRouter,
    classifier: typeof classifier?.classifyTaskComplexity,
    aggregator: typeof aggregator?.finaliseFromSingle,
  }));
  expect(loaded, 'saga-store chargé par loadCoreModule').not.toBeNull();
  expect(typeof loaded?.getSagaStore, 'getSagaStore').toBe('function');
  expect(typeof loaded?.resetSagaStore, 'resetSagaStore').toBe('function');
  expect(typeof loaded?.SagaStore, 'classe SagaStore').toBe('function');
  expect(typeof router?.TaskRouter, 'TaskRouter réel').toBe('function');
  expect(typeof classifier?.classifyTaskComplexity, 'classifieur réel').toBe('function');
  expect(typeof aggregator?.finaliseFromSingle, 'agrégateur réel').toBe('function');
  sagaMod = loaded as SagaStoreModule;
});

beforeEach(() => {
  const home = mkdtempSync(path.join(tmpdir(), 'saga-econn-'));
  homes.push(home);
  process.env.CODEBUDDY_HOME = home;
  delete process.env.GROK_HOME;
  sagaMod.resetSagaStore();
  _resetSagaRunnerLockForTests();
});

afterEach(() => {
  _resetSagaRunnerLockForTests();
});

describe('SagaRunner réel — ECONNREFUSED et acceptation', () => {
  it('après ACK, ECONNREFUSED ne relance pas un autre fournisseur et laisse l\'issue inconnue', async () => {
    const store = sagaMod.getSagaStore();
    const created = await store.create({
      goal: 'tenir le travail déjà accepté',
      plan: {
        primary: lane('robot', 'cloud-a', 'openrouter'),
        chain: [lane('robot', 'cloud-a', 'openrouter', 'code')],
      },
    });
    const sagaFile = path.join(process.env.CODEBUDDY_HOME ?? '', 'sagas', `${created.id}.json`);
    expect(existsSync(sagaFile), 'le vrai store a persisté la saga').toBe(true);

    const acks: Array<{ peerId: string; provider: string; runId: string }> = [];
    const fleetBridge = {
      peerRequest: async (peerId: string, method: string, params: Record<string, unknown> = {}) => {
        if (method === 'peer.dispatch') {
          const runId = `ack-${acks.length + 1}`;
          const provider = String(params.provider ?? '');
          acks.push({ peerId, provider, runId });
          return { runId, providerRequested: provider, providerResolved: provider };
        }
        if (method === 'peer.dispatchStatus') {
          const runId = String(params.runId ?? '');
          if (runId === 'ack-1') {
            return {
              found: true,
              status: 'failed',
              providerRequested: 'openrouter',
              providerResolved: 'openrouter',
              error: ERREUR,
            };
          }
          return {
            found: true,
            status: 'completed',
            providerRequested: 'lemonade',
            providerResolved: 'lemonade',
            result: 'SECOND_TRAVAIL',
          };
        }
        throw new Error(`méthode non synthétique ${peerId}:${method}`);
      },
      listPeers: () => [{ id: 'robot', capability: robotCapability() }],
    };

    new SagaRunner(fleetBridge as never, () => {}).start(created.id);
    await waitUntil(async () => {
      const current = await store.load(created.id);
      return current?.status === 'failed' || current?.status === 'completed';
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const finalSaga = await store.load(created.id);
    const step = finalSaga?.steps[0];
    const mesure = {
      executions: acks.length,
      providers: acks.map((ack) => ack.provider),
      pairs: acks.map((ack) => ack.peerId),
      sagaStatus: finalSaga?.status ?? null,
      outcome: step?.outcome ?? null,
      stepError: step?.error ?? null,
      retried: step?.retried === true,
      attempts: step?.attempts?.length ?? 0,
      failureDomain: step?.attempts?.[0]?.failureDomain ?? null,
      finalResult: finalSaga?.finalResult ?? null,
    };
    console.log('MESURE_APRES_ACK ' + JSON.stringify(mesure));

    expect(mesure.executions, 'exécutions LLM synthétiques').toBe(1);
    expect(mesure.providers, 'fournisseurs appelés').toEqual(['openrouter']);
    expect(mesure.sagaStatus, 'état final de la saga').toBe('failed');
    expect(mesure.outcome, 'issue après acceptation').toBe('unknown');
    expect(mesure.stepError, 'erreur de step').toBe('dispatch_unknown');
    expect(mesure.retried, 'pas de retry').toBe(false);
    expect(mesure.attempts, 'une seule tentative').toBe(1);
    expect(mesure.failureDomain, 'pas de domaine de repli').toBeNull();
    expect(mesure.finalResult, 'pas de succès synthétisé').toBeNull();
    expect(step?.attempts?.[0]?.error ?? '', 'diagnostic conservé').toContain('ECONNREFUSED');
  });

  it('avant ACK, la même erreur ECONNREFUSED autorise encore la lane de secours', async () => {
    const store = sagaMod.getSagaStore();
    const created = await store.create({
      goal: 'pair jamais atteint',
      plan: {
        primary: lane('peer-a', 'cloud-a', 'openrouter'),
        fallback: lane('peer-b', 'local-b', 'lemonade'),
      },
    });

    const appels: Array<{ peerId: string; method: string; provider?: string }> = [];
    const acks: Array<{ peerId: string; provider: string }> = [];
    const fleetBridge = {
      peerRequest: async (peerId: string, method: string, params: Record<string, unknown> = {}) => {
        appels.push({
          peerId,
          method,
          ...(typeof params.provider === 'string' ? { provider: params.provider } : {}),
        });
        if (method === 'peer.dispatch') {
          if (peerId === 'peer-a') {
            throw new Error(ERREUR);
          }
          acks.push({ peerId, provider: String(params.provider ?? '') });
          return {
            runId: 'ack-secours',
            providerRequested: params.provider,
            providerResolved: params.provider,
          };
        }
        if (method === 'peer.dispatchStatus') {
          return { found: true, status: 'completed', result: 'SECOURS_OK' };
        }
        throw new Error(`méthode non synthétique ${peerId}:${method}`);
      },
      listPeers: () => [],
    };

    new SagaRunner(fleetBridge as never, () => {}).start(created.id);
    await waitUntil(async () => {
      const current = await store.load(created.id);
      const fallback = current?.steps.find((step) => step.lane === 'fallback');
      return fallback?.status === 'completed' || current?.status === 'failed';
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const finalSaga = await store.load(created.id);
    const primary = finalSaga?.steps.find((step) => step.lane === 'primary');
    const fallback = finalSaga?.steps.find((step) => step.lane === 'fallback');
    const mesure = {
      dispatchAttempts: appels.filter((call) => call.method === 'peer.dispatch').length,
      executions: acks.length,
      providersAcceptes: acks.map((ack) => ack.provider),
      pairsAcceptes: acks.map((ack) => ack.peerId),
      primaryStatus: primary?.status ?? null,
      primaryError: primary?.error ?? null,
      fallbackStatus: fallback?.status ?? null,
      fallbackResult: fallback?.result ?? null,
      sagaStatus: finalSaga?.status ?? null,
      finalResult: finalSaga?.finalResult ?? null,
    };
    console.log('MESURE_AVANT_ACK ' + JSON.stringify(mesure));

    expect(mesure.dispatchAttempts, 'le pair primaire a été tenté').toBe(2);
    expect(mesure.executions, 'une seule exécution acceptée').toBe(1);
    expect(mesure.providersAcceptes, 'fournisseur de secours').toEqual(['lemonade']);
    expect(mesure.pairsAcceptes, 'pair de secours').toEqual(['peer-b']);
    expect(mesure.primaryStatus, 'primaire échoué avant exécution').toBe('failed');
    expect(mesure.primaryError, 'erreur primaire').toContain('ECONNREFUSED');
    expect(mesure.fallbackStatus, 'secours exécuté').toBe('completed');
    expect(mesure.fallbackResult, 'résultat du secours').toBe('SECOURS_OK');
    expect(mesure.sagaStatus, 'saga menée par le secours').toBe('completed');
    expect(mesure.finalResult, 'résultat final').toBe('SECOURS_OK');
  });
});
