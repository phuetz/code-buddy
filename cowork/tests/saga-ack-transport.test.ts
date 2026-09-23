/**
 * Vrai SagaRunner + vrai saga-store. Après l'ACK, chaque échec de
 * transport ou de réseau que `peer.dispatchStatus` peut porter laisse
 * une seule exécution et une issue `unknown`. Avant l'ACK, la lane de
 * secours part. Un refus sémantique prouvé (pas un transport) garde le
 * repli.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadCoreModule } from '../src/main/utils/core-loader';
import { SagaRunner, _resetSagaRunnerLockForTests } from '../src/main/fleet/saga-runner';

interface SagaStepRecord {
  peerId: string;
  provider?: string;
  lane: string;
  status: string;
  error?: string;
  outcome?: string;
  result?: string;
  retried?: boolean;
  attempts?: Array<{ status: string; error?: string; failureDomain?: string }>;
}

interface SagaRecord {
  id: string;
  status: string;
  finalResult?: string;
  steps: SagaStepRecord[];
}

interface SagaStoreModule {
  getSagaStore: () => {
    create: (input: { goal: string; plan: Record<string, unknown> }) => Promise<SagaRecord>;
    load: (id: string) => Promise<SagaRecord | null>;
  };
  resetSagaStore: () => void;
  SagaStore: unknown;
}

interface RouterModule { TaskRouter: new () => unknown }
interface ClassifierModule { classifyTaskComplexity: (message: string) => unknown }
interface AggregatorModule { finaliseFromSingle: (saga: unknown) => string | null }

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const enginePath = process.env.CODEBUDDY_ENGINE_PATH ?? path.join(repoRoot, 'dist');

/**
 * Textes réellement produits : errno Node (`syscall CODE`), message
 * undici/fetch, repli `mapProviderError`, et erreurs du pont
 * FleetListener / FleetBridge. Les jetons in-flight (REQUEST_TIMEOUT,
 * DISCONNECTED, poll_timeout) ne sont pas ici : ils sont déjà `unknown`
 * sans repli, avant comme après l'ACK.
 */
const TRANSPORTS: ReadonlyArray<{ id: string; error: string }> = [
  { id: 'EAI_AGAIN', error: 'EAI_AGAIN' },
  { id: 'ENETUNREACH', error: 'ENETUNREACH' },
  { id: 'network unreachable', error: 'network unreachable' },
  { id: 'read ECONNABORTED', error: 'read ECONNABORTED' },
  { id: 'write EPIPE', error: 'write EPIPE' },
  { id: 'connect ECONNREFUSED', error: 'fetch failed: connect ECONNREFUSED 127.0.0.1:11434' },
  { id: 'read ECONNRESET', error: 'read ECONNRESET' },
  { id: 'connect ETIMEDOUT', error: 'connect ETIMEDOUT 10.0.0.1:443' },
  { id: 'getaddrinfo EAI_AGAIN', error: 'getaddrinfo EAI_AGAIN api.example' },
  { id: 'getaddrinfo ENOTFOUND', error: 'getaddrinfo ENOTFOUND api.example' },
  { id: 'connect ENETUNREACH', error: 'connect ENETUNREACH 10.0.0.1:443' },
  { id: 'connect EHOSTUNREACH', error: 'connect EHOSTUNREACH 10.0.0.1:443' },
  { id: 'connect ENETDOWN', error: 'connect ENETDOWN 10.0.0.1:443' },
  { id: 'connect EHOSTDOWN', error: 'connect EHOSTDOWN 10.0.0.1:443' },
  { id: 'connect EADDRNOTAVAIL', error: 'connect EADDRNOTAVAIL 0.0.0.0:443' },
  { id: 'getaddrinfo EAI_FAIL', error: 'getaddrinfo EAI_FAIL api.example' },
  { id: 'getaddrinfo EAI_NONAME', error: 'getaddrinfo EAI_NONAME api.example' },
  { id: 'write EPROTO', error: 'write EPROTO' },
  { id: 'fetch failed', error: 'fetch failed' },
  { id: 'TypeError fetch failed', error: 'TypeError: fetch failed' },
  { id: 'other side closed', error: 'other side closed' },
  { id: 'socket hang up', error: 'socket hang up' },
  { id: 'Connect Timeout Error', error: 'Connect Timeout Error' },
  { id: 'Headers Timeout Error', error: 'Headers Timeout Error' },
  { id: 'Body Timeout Error', error: 'Body Timeout Error' },
  { id: 'Request aborted', error: 'Request aborted' },
  { id: 'operation aborted', error: 'The operation was aborted' },
  { id: 'client destroyed', error: 'The client is destroyed' },
  { id: 'client closed', error: 'The client is closed' },
  { id: 'UND_ERR_SOCKET', error: 'UND_ERR_SOCKET: other side closed' },
  { id: 'UND_ERR_CONNECT_TIMEOUT', error: 'UND_ERR_CONNECT_TIMEOUT' },
  { id: 'UND_ERR_HEADERS_TIMEOUT', error: 'UND_ERR_HEADERS_TIMEOUT' },
  { id: 'UND_ERR_BODY_TIMEOUT', error: 'UND_ERR_BODY_TIMEOUT' },
  { id: 'UND_ERR_ABORTED', error: 'UND_ERR_ABORTED' },
  { id: 'UND_ERR_DESTROYED', error: 'UND_ERR_DESTROYED' },
  { id: 'UND_ERR_CLOSED', error: 'UND_ERR_CLOSED' },
  { id: 'connection refused', error: 'connection refused' },
  { id: 'connection reset', error: 'connection reset' },
  { id: 'connection timed out', error: 'connection timed out' },
  { id: 'connection aborted', error: 'connection aborted' },
  { id: 'connection error', error: 'Connection error.' },
  { id: 'APIConnectionError', error: 'APIConnectionError: Connection error.' },
  { id: 'request timed out', error: 'APIConnectionTimeoutError: Request timed out.' },
  { id: 'network error', error: 'network error' },
  { id: 'socket terminated', error: 'socket terminated' },
  { id: 'socket was closed', error: 'The socket was closed while data was being compressed' },
  { id: 'premature close', error: 'premature close' },
  { id: 'reset before headers', error: 'reset before headers' },
  { id: 'mapProviderError EAI_AGAIN', error: 'CodeBuddy API error: getaddrinfo EAI_AGAIN api.example' },
  { id: 'mapProviderError fetch failed', error: 'CodeBuddy API error: fetch failed — Hint: network error reaching the provider.' },
  { id: 'mapProviderError ECONNABORTED', error: 'CodeBuddy API error: read ECONNABORTED' },
  { id: 'mapProviderError ETIMEDOUT', error: 'CodeBuddy API error: connect ETIMEDOUT — Hint: request timed out.' },
  { id: 'NOT_OPEN', error: 'peer.invoke NOT_OPEN: ws is not in OPEN state' },
  { id: 'WebSocket was closed', error: 'WebSocket was closed before the connection was established' },
  { id: 'WebSocket not connected', error: 'WebSocket not connected' },
  // « peer disconnected » est déjà la classe in-flight DISCONNECTED
  // (\bDISCONNECTED\b) : unknown, sans repli. On ne le reclasse pas.
  { id: 'peer unreachable', error: 'peer unreachable' },
  { id: 'no active listener', error: 'peer robot has no active listener (status=offline)' },
  { id: 'peer not found', error: 'peer not found: robot' },
  { id: 'listener connect timeout', error: 'Fleet listener connect timeout' },
  { id: 'listener auth timeout', error: 'Fleet listener auth timeout (5000ms)' },
  { id: 'closed before authentication', error: 'Connection closed before authentication' },
];

let sagaMod: SagaStoreModule;

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

function model(id: string, provider: 'openrouter' | 'lemonade') {
  return {
    id,
    provider,
    egress: provider === 'lemonade' ? 'local' as const : 'cloud' as const,
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
    models: [model('cloud-a', 'openrouter'), model('local-b', 'lemonade')],
  };
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 8_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`attente dépassée (${timeoutMs} ms)`);
}

beforeAll(async () => {
  const sagaFile = path.join(enginePath, 'fleet', 'saga-store.js');
  if (!existsSync(sagaFile)) {
    throw new Error(`saga-store.js introuvable sous ${enginePath}`);
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
  process.env.CODEBUDDY_HOME = mkdtempSync(path.join(tmpdir(), 'saga-ack-'));
  delete process.env.GROK_HOME;
  sagaMod.resetSagaStore();
  _resetSagaRunnerLockForTests();
});

afterEach(() => {
  _resetSagaRunnerLockForTests();
});

describe('SagaRunner réel — transport après et avant ACK', () => {
  for (const cas of TRANSPORTS) {
    it(`après ACK, « ${cas.id} » : une exécution, issue unknown`, async () => {
      const store = sagaMod.getSagaStore();
      const created = await store.create({
        goal: 'tenir le travail accepté',
        plan: {
          primary: lane('robot', 'cloud-a', 'openrouter'),
          chain: [lane('robot', 'cloud-a', 'openrouter', 'code')],
        },
      });
      const sagaFile = path.join(process.env.CODEBUDDY_HOME ?? '', 'sagas', `${created.id}.json`);
      expect(existsSync(sagaFile), 'le vrai store a persisté la saga').toBe(true);
      const acks: Array<{ provider: string }> = [];
      const fleetBridge = {
        peerRequest: async (_peerId: string, method: string, params: Record<string, unknown> = {}) => {
          if (method === 'peer.dispatch') {
            const provider = String(params.provider ?? '');
            acks.push({ provider });
            return { runId: `ack-${acks.length}`, providerRequested: provider, providerResolved: provider };
          }
          if (method === 'peer.dispatchStatus') {
            const runId = String(params.runId ?? '');
            if (runId === 'ack-1') {
              return {
                found: true,
                status: 'failed',
                providerRequested: 'openrouter',
                providerResolved: 'openrouter',
                error: cas.error,
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
          throw new Error(`méthode non synthétique ${method}`);
        },
        listPeers: () => [{ id: 'robot', capability: robotCapability() }],
      };
      new SagaRunner(fleetBridge as never, () => {}).start(created.id);
      await waitUntil(async () => {
        const current = await store.load(created.id);
        return current?.status === 'failed' || current?.status === 'completed';
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      const finalSaga = await store.load(created.id);
      const step = finalSaga?.steps[0];
      const mesure = {
        executions: acks.length,
        providers: acks.map((ack) => ack.provider),
        sagaStatus: finalSaga?.status ?? null,
        outcome: step?.outcome ?? null,
        stepError: step?.error ?? null,
        retried: step?.retried === true,
        failureDomain: step?.attempts?.[0]?.failureDomain ?? null,
        finalResult: finalSaga?.finalResult ?? null,
      };
      console.log(`MESURE_APRES_ACK[${cas.id}] ` + JSON.stringify(mesure));
      expect(mesure.executions, `après ACK « ${cas.id} » : une seule exécution`).toBe(1);
      expect(mesure.providers, `après ACK « ${cas.id} » : pas de second fournisseur`).toEqual(['openrouter']);
      expect(mesure.outcome, `après ACK « ${cas.id} » : issue inconnue`).toBe('unknown');
      expect(mesure.stepError, `après ACK « ${cas.id} » : dispatch_unknown`).toBe('dispatch_unknown');
      expect(mesure.retried, `après ACK « ${cas.id} » : pas de retry`).toBe(false);
      expect(mesure.failureDomain, `après ACK « ${cas.id} » : pas de domaine de repli`).toBeNull();
      expect(mesure.finalResult, `après ACK « ${cas.id} » : pas de second travail`).toBeNull();
      expect(step?.attempts?.[0]?.error ?? '', `après ACK « ${cas.id} » : diagnostic conservé`).toContain(cas.id.split(' ')[0] === 'mapProviderError' ? 'CodeBuddy API error' : cas.error.slice(0, 12));
    });

    it(`avant ACK, « ${cas.id} » : la lane de secours part`, async () => {
      const store = sagaMod.getSagaStore();
      const created = await store.create({
        goal: 'pair jamais atteint',
        plan: {
          primary: lane('peer-a', 'cloud-a', 'openrouter'),
          fallback: lane('peer-b', 'local-b', 'lemonade'),
        },
      });
      const acks: Array<{ peerId: string; provider: string }> = [];
      const fleetBridge = {
        peerRequest: async (peerId: string, method: string, params: Record<string, unknown> = {}) => {
          if (method === 'peer.dispatch') {
            if (peerId === 'peer-a') throw new Error(cas.error);
            acks.push({ peerId, provider: String(params.provider ?? '') });
            return { runId: 'ack-secours', providerRequested: params.provider, providerResolved: params.provider };
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
      await new Promise((resolve) => setTimeout(resolve, 40));
      const finalSaga = await store.load(created.id);
      const fallback = finalSaga?.steps.find((step) => step.lane === 'fallback');
      const mesure = {
        executions: acks.length,
        providersAcceptes: acks.map((ack) => ack.provider),
        pairsAcceptes: acks.map((ack) => ack.peerId),
        sagaStatus: finalSaga?.status ?? null,
        fallbackResult: fallback?.result ?? null,
      };
      console.log(`MESURE_AVANT_ACK[${cas.id}] ` + JSON.stringify(mesure));
      expect(mesure.executions, `avant ACK « ${cas.id} » : le secours est exécuté`).toBe(1);
      expect(mesure.providersAcceptes, `avant ACK « ${cas.id} » : fournisseur de secours`).toEqual(['lemonade']);
      expect(mesure.pairsAcceptes, `avant ACK « ${cas.id} » : pair de secours`).toEqual(['peer-b']);
      expect(mesure.fallbackResult, `avant ACK « ${cas.id} » : résultat du secours`).toBe('SECOURS_OK');
      expect(mesure.sagaStatus, `avant ACK « ${cas.id} » : saga menée par le secours`).toBe('completed');
    });
  }
});

describe('SagaRunner réel — refus sémantique prouvé, après ACK', () => {
  async function mesureRepli(error: string): Promise<{ executions: number; providers: string[]; outcome: string | null; finalResult: string | null }> {
    const store = sagaMod.getSagaStore();
    const created = await store.create({
      goal: 'refus avant exécution',
      plan: {
        primary: lane('robot', 'cloud-a', 'openrouter'),
        chain: [lane('robot', 'cloud-a', 'openrouter', 'code')],
      },
    });
    const acks: Array<{ provider: string }> = [];
    const fleetBridge = {
      peerRequest: async (_peerId: string, method: string, params: Record<string, unknown> = {}) => {
        if (method === 'peer.dispatch') {
          const provider = String(params.provider ?? '');
          acks.push({ provider });
          return { runId: `ack-${acks.length}`, providerRequested: provider, providerResolved: provider };
        }
        if (method === 'peer.dispatchStatus') {
          if (String(params.runId ?? '') === 'ack-1') {
            return { found: true, status: 'failed', providerRequested: 'openrouter', providerResolved: 'openrouter', error };
          }
          return { found: true, status: 'completed', providerRequested: 'lemonade', providerResolved: 'lemonade', result: 'SECOURS_SEMANTIQUE' };
        }
        throw new Error(`méthode non synthétique ${method}`);
      },
      listPeers: () => [{ id: 'robot', capability: robotCapability() }],
    };
    new SagaRunner(fleetBridge as never, () => {}).start(created.id);
    await waitUntil(async () => {
      const current = await store.load(created.id);
      return current?.status === 'failed' || current?.status === 'completed';
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const finalSaga = await store.load(created.id);
    const step = finalSaga?.steps[0];
    return {
      executions: acks.length,
      providers: acks.map((ack) => ack.provider),
      outcome: step?.outcome ?? null,
      finalResult: finalSaga?.finalResult ?? null,
    };
  }

  it('après ACK, un HTTP 429 prouvé autorise encore le second fournisseur', async () => {
    const mesure = await mesureRepli('HTTP 429 too many requests');
    console.log('MESURE_SEMANTIQUE_429 ' + JSON.stringify(mesure));
    expect(mesure.executions, 'refus 429 : second fournisseur').toBe(2);
    expect(mesure.providers, 'openrouter puis lemonade').toEqual(['openrouter', 'lemonade']);
    expect(mesure.finalResult, 'le secours a abouti').toBe('SECOURS_SEMANTIQUE');
  });

  it('après ACK, « tâche rejetée avant exécution » autorise le repli', async () => {
    const mesure = await mesureRepli('tâche rejetée avant exécution');
    console.log('MESURE_SEMANTIQUE_FORMULE ' + JSON.stringify(mesure));
    expect(mesure.executions, 'formule explicite : second fournisseur').toBe(2);
    expect(mesure.providers, 'openrouter puis lemonade').toEqual(['openrouter', 'lemonade']);
    expect(mesure.finalResult, 'le secours a abouti').toBe('SECOURS_SEMANTIQUE');
  });

  it('après ACK, la formule noyée dans fetch failed n\'est pas une preuve', async () => {
    const mesure = await mesureRepli('fetch failed: tâche rejetée avant exécution');
    console.log('MESURE_FORMULE_DANS_TRANSPORT ' + JSON.stringify(mesure));
    expect(mesure.executions, 'transport d\'abord : une seule exécution').toBe(1);
    expect(mesure.providers, 'pas de second fournisseur').toEqual(['openrouter']);
    expect(mesure.outcome, 'issue inconnue').toBe('unknown');
    expect(mesure.finalResult, 'pas de second travail').toBeNull();
  });
});
