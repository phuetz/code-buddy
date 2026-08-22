/**
 * Fleet P2 — verify the capability registry detects configured
 * providers from env vars, gracefully skips network probes when
 * Ollama / LM Studio are not running, and produces a snapshot the
 * router can consume.
 *
 * The local network probes (Ollama on :11434, LM Studio on :1234)
 * are mocked via `global.fetch` so the test doesn't depend on what's
 * actually running on the machine.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  getLocalCapabilities,
  omnirouteModelsUrl,
  parseAgyModelsOutput,
  resetCapabilityCache,
} from '../../src/fleet/capability-registry';

const originalEnv = { ...process.env };
const originalFetch = global.fetch;
let tempAuthDir: string | null = null;

function clearProviderEnv() {
  for (const k of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GROK_API_KEY',
    'XAI_API_KEY',
    'MISTRAL_API_KEY',
    'CHATGPT_MODEL',
    'CODEBUDDY_CODEX_AUTH_PATH',
    'CODEBUDDY_FLEET_HOSTNAME',
    'CODEBUDDY_FLEET_MACHINE_LABEL',
    'CODEBUDDY_FLEET_GPU',
    'CODEBUDDY_FLEET_RAM_GB',
    'CODEBUDDY_FLEET_MAX_CONCURRENCY',
    'CODEBUDDY_FLEET_ROLES',
    'AGY_CLI_PATH',
    'LEMONADE_HOST',
    'LEMONADE_API_KEY',
    'OMNIROUTE_BASE_URL',
    'OMNIROUTE_API_KEY',
    'OPENROUTER_API_KEY',
  ]) {
    delete process.env[k];
  }
}

beforeEach(() => {
  clearProviderEnv();
  resetCapabilityCache();
  tempAuthDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cap-auth-'));
  process.env.CODEBUDDY_CODEX_AUTH_PATH = path.join(tempAuthDir, 'missing-codex-auth.json');
  // Disable gemini-cli auto-detect by default (a real `gemini` binary
  // installed on the test host would otherwise produce 2 extra models
  // and break "no env vars" assertions). Tests that exercise gemini-cli
  // detection must override this to a real path.
  process.env.GEMINI_CLI_PATH = '/tmp/__no_gemini_cli_in_tests__';
  process.env.AGY_CLI_PATH = '/tmp/__no_agy_cli_in_tests__';
  // Default: deny every fetch (Ollama / LM Studio probes return [])
  global.fetch = vi.fn(async () => {
    throw new Error('econn refused');
  }) as unknown as typeof fetch;
});

afterEach(() => {
  if (tempAuthDir) {
    fs.rmSync(tempAuthDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    tempAuthDir = null;
  }
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
});

describe('capability-registry — env-based detection', () => {
  it('returns no models when no env vars are set and no local daemons reachable', async () => {
    const cap = await getLocalCapabilities();
    expect(cap.models).toEqual([]);
    expect(cap.egress).toBe('local');
    expect(cap.machineLabel).toBeTruthy();
  });

  it('detects Anthropic when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-xxx';
    const cap = await getLocalCapabilities();
    const ids = cap.models.map((m) => m.id);
    expect(ids).toContain('claude-opus-4');
    expect(ids).toContain('claude-haiku-4');
    expect(cap.egress).toBe('cloud');
  });

  it('detects OpenAI when OPENAI_API_KEY is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai-xxx';
    const cap = await getLocalCapabilities();
    const ids = cap.models.map((m) => m.id);
    expect(ids).toContain('gpt-5-codex');
    expect(cap.models.find((m) => m.id === 'gpt-5-codex')?.strengths).toContain('code');
    const sol = cap.models.find((m) => m.id === 'gpt-5.6-sol');
    expect(sol).toMatchObject({
      contextWindow: 1_050_000,
      costInputUsdPerMtok: 5,
      costOutputUsdPerMtok: 30,
      provider: 'openai',
    });
    expect(sol?.strengths).toEqual(expect.arrayContaining([
      'code',
      'reasoning',
      'vision',
      'tool-calling',
      'long-context',
    ]));
  });

  it('detects ChatGPT OAuth credentials as zero-marginal-cost Codex models', async () => {
    const authPath = path.join(tempAuthDir!, 'codex-auth.json');
    process.env.CODEBUDDY_CODEX_AUTH_PATH = authPath;
    fs.writeFileSync(
      authPath,
      JSON.stringify({ tokens: { access_token: 'tok_test' } }),
      'utf-8',
    );

    const cap = await getLocalCapabilities();
    const chatgptModels = cap.models.filter((m) => m.provider === 'chatgpt-oauth');
    expect(chatgptModels.map((m) => m.id)).toEqual(expect.arrayContaining([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
    ]));
    expect(chatgptModels.map((m) => m.id)).not.toContain('terra');
    expect(chatgptModels.map((m) => m.id)).not.toContain('luna');
    expect(chatgptModels.map((m) => m.id)).not.toContain('gpt-5.1-codex');
    expect(chatgptModels.find((m) => m.id === 'gpt-5.6-sol')?.contextWindow).toBe(372_000);
    expect(chatgptModels.find((m) => m.id === 'gpt-5.6-sol')?.strengths).toContain('code');
    expect(chatgptModels.every((m) => m.costInputUsdPerMtok === 0)).toBe(true);
    expect(chatgptModels.every((m) => m.costOutputUsdPerMtok === 0)).toBe(true);
    expect(cap.egress).toBe('cloud');
  });

  it('Gemini detection uses GEMINI_API_KEY or GOOGLE_API_KEY', async () => {
    process.env.GOOGLE_API_KEY = 'gxxx';
    const cap = await getLocalCapabilities();
    expect(cap.models.some((m) => m.provider === 'gemini')).toBe(true);
  });

  it('Gemini CLI subprocess detected when GEMINI_CLI_PATH points at an existing binary', async () => {
    // Use process.execPath as a stand-in for the gemini binary.
    process.env.GEMINI_CLI_PATH = process.execPath;
    const cap = await getLocalCapabilities();
    const cliModels = cap.models.filter((m) => m.provider === 'gemini-cli');
    expect(cliModels.length).toBeGreaterThan(0);
    // Cost is reported as 0 because the subscription has already been paid.
    expect(cliModels[0].costInputUsdPerMtok).toBe(0);
    expect(cliModels[0].costOutputUsdPerMtok).toBe(0);
    // Egress still 'cloud' for privacy routing.
    expect(cap.egress).toBe('cloud');
  });

  it('parses dynamic agy display names as opaque de-duplicated values', () => {
    expect(parseAgyModelsOutput(
      'Gemini 3.5 Flash (High)\nClaude Opus 4.6 (Thinking)\nGemini 3.5 Flash (High)\n',
    )).toEqual(['Gemini 3.5 Flash (High)', 'Claude Opus 4.6 (Thinking)']);
  });

  it('advertises the OpenRouter free pool at zero marginal cost', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test';
    const cap = await getLocalCapabilities();
    const free = cap.models.filter((model) => model.provider === 'openrouter');
    expect(free.map((model) => model.id)).toContain('openrouter/free');
    expect(free.every((model) => model.costInputUsdPerMtok === 0)).toBe(true);
    expect(cap.egress).toBe('cloud');
  });

  it('advertises Grok when configured through XAI_API_KEY', async () => {
    process.env.XAI_API_KEY = 'xai-test';
    const cap = await getLocalCapabilities();
    expect(cap.models.some((model) => model.provider === 'grok')).toBe(true);
    expect(cap.egress).toBe('cloud');
  });

  it('aggregates several providers when multiple keys are set', async () => {
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.OPENAI_API_KEY = 'o';
    process.env.MISTRAL_API_KEY = 'm';
    const cap = await getLocalCapabilities();
    const providers = new Set(cap.models.map((m) => m.provider));
    expect(providers.has('anthropic')).toBe(true);
    expect(providers.has('openai')).toBe(true);
    expect(providers.has('mistral')).toBe(true);
  });

  it('respects CODEBUDDY_FLEET_HOSTNAME override for machineLabel', async () => {
    process.env.CODEBUDDY_FLEET_HOSTNAME = 'darkstar';
    const cap = await getLocalCapabilities();
    expect(cap.machineLabel).toBe('darkstar');
  });

  it('parses machineSpec from CODEBUDDY_FLEET_GPU + CODEBUDDY_FLEET_RAM_GB', async () => {
    process.env.CODEBUDDY_FLEET_GPU = 'RTX 3090 ×2';
    process.env.CODEBUDDY_FLEET_RAM_GB = '128';
    const cap = await getLocalCapabilities();
    expect(cap.machineSpec?.gpu).toBe('RTX 3090 ×2');
    expect(cap.machineSpec?.ramGb).toBe(128);
  });

  it('respects CODEBUDDY_FLEET_MAX_CONCURRENCY', async () => {
    process.env.CODEBUDDY_FLEET_MAX_CONCURRENCY = '8';
    const cap = await getLocalCapabilities();
    expect(cap.maxConcurrency).toBe(8);
  });
});

describe('capability-registry — Ollama probe', () => {
  it('adds local Ollama models when /api/tags responds', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/tags')) {
        return new Response(
          JSON.stringify({
            models: [
              { name: 'qwen3.6:35b-a3b-q4_K_M' },
              { name: 'gemma4:26b' },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error('econn');
    }) as unknown as typeof fetch;

    const cap = await getLocalCapabilities();
    const ids = cap.models.map((m) => m.id);
    expect(ids).toContain('qwen3.6:35b-a3b-q4_K_M');
    expect(ids).toContain('gemma4:26b');
    expect(cap.models.find((m) => m.id.startsWith('qwen3.6'))?.provider).toBe('ollama');
    expect(cap.egress).toBe('local'); // no cloud key set
  });

  it('marks egress as cloud when both Ollama and an Anthropic key are present', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'gemma4:26b' }] }), {
          status: 200,
        });
      }
      throw new Error('econn');
    }) as unknown as typeof fetch;

    const cap = await getLocalCapabilities();
    expect(cap.egress).toBe('cloud');
    expect(cap.models.some((m) => m.provider === 'ollama')).toBe(true);
    expect(cap.models.some((m) => m.provider === 'anthropic')).toBe(true);
    expect(cap.models.find((m) => m.provider === 'ollama')?.egress).toBe('local');
    expect(cap.models.find((m) => m.provider === 'anthropic')?.egress).toBe('cloud');
  });

  it('classifies a private-network Ollama endpoint as LAN', async () => {
    process.env.OLLAMA_BASE_URL = 'http://192.168.1.20:11434';
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'darkstar-qwen' }] }), {
          status: 200,
        });
      }
      throw new Error('econn');
    }) as unknown as typeof fetch;
    const cap = await getLocalCapabilities();
    expect(cap.models.find((model) => model.id === 'darkstar-qwen')?.egress).toBe('lan');
    expect(cap.egress).toBe('lan');
  });

  it('survives an Ollama probe error and returns empty models gracefully', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const cap = await getLocalCapabilities();
    expect(cap.models).toEqual([]);
    expect(cap.egress).toBe('local');
  });
});

describe('capability-registry — Lemonade probe', () => {
  it('discovers downloaded models from the local OpenAI-compatible endpoint', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes(':13305/v1/models')) {
        return new Response(JSON.stringify({
          data: [
            { id: 'Qwen3.6-35B-A3B-MTP-GGUF' },
            { id: 'gemma-4-31B-it-GGUF-Q4_K_M' },
          ],
        }), { status: 200 });
      }
      throw new Error('econn');
    }) as unknown as typeof fetch;

    const cap = await getLocalCapabilities();
    const lemonade = cap.models.filter((model) => model.provider === 'lemonade');
    expect(lemonade.map((model) => model.id)).toContain('Qwen3.6-35B-A3B-MTP-GGUF');
    expect(cap.egress).toBe('local');
  });
});

describe('capability-registry — OmniRoute gateway probe', () => {
  it('enrols the gateway models when /v1/models answers, with cloud egress (inference leaves the box)', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === 'http://127.0.0.1:20128/v1/models') {
        return new Response(JSON.stringify({
          data: [
            { id: 'auto/best-free' },
            { id: 'nvidia/nemotron-3-nano' },
            { id: 42 }, // junk id → dropped
          ],
        }), { status: 200 });
      }
      throw new Error('econn');
    }) as unknown as typeof fetch;

    const cap = await getLocalCapabilities();
    const omni = cap.models.filter((model) => model.provider === 'omniroute');
    expect(omni.map((model) => model.id)).toEqual(['auto/best-free', 'nvidia/nemotron-3-nano']);
    expect(omni.every((model) => model.egress === 'cloud')).toBe(true);
    expect(cap.egress).toBe('cloud');
  });

  it('stays silent when the gateway is absent (connection refused)', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:20128');
    }) as unknown as typeof fetch;

    const cap = await getLocalCapabilities();
    expect(cap.models.filter((model) => model.provider === 'omniroute')).toEqual([]);
    expect(cap.egress).toBe('local');
  });

  it('stays silent on an HTTP error or a malformed body', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes(':20128/v1/models')) {
        return new Response('upstream exploded', { status: 502 });
      }
      throw new Error('econn');
    }) as unknown as typeof fetch;
    expect((await getLocalCapabilities({ force: true })).models.filter((m) => m.provider === 'omniroute')).toEqual([]);

    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes(':20128/v1/models')) {
        return new Response('not json', { status: 200 });
      }
      throw new Error('econn');
    }) as unknown as typeof fetch;
    expect((await getLocalCapabilities({ force: true })).models.filter((m) => m.provider === 'omniroute')).toEqual([]);

    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes(':20128/v1/models')) {
        return new Response(JSON.stringify({ models: ['wrong-shape'] }), { status: 200 });
      }
      throw new Error('econn');
    }) as unknown as typeof fetch;
    expect((await getLocalCapabilities({ force: true })).models.filter((m) => m.provider === 'omniroute')).toEqual([]);
  });

  it('honours OMNIROUTE_BASE_URL (HOST:PORT or /v1 form) and sends the bearer when OMNIROUTE_API_KEY is set', async () => {
    process.env.OMNIROUTE_BASE_URL = 'omni.lan:20128/v1/';
    process.env.OMNIROUTE_API_KEY = 'sk-omni';
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === 'http://omni.lan:20128/v1/models') {
        return new Response(JSON.stringify({ data: [{ id: 'auto/best-free' }] }), { status: 200 });
      }
      throw new Error('econn');
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const cap = await getLocalCapabilities();
    expect(cap.models.filter((model) => model.provider === 'omniroute').map((m) => m.id)).toEqual(['auto/best-free']);
    const call = fetchSpy.mock.calls.find((c) => String(c[0]).includes('omni.lan'));
    expect(call).toBeDefined();
    expect((call![1] as RequestInit | undefined)?.headers).toEqual({ Authorization: 'Bearer sk-omni' });
  });

  it('omnirouteModelsUrl normalises scheme, trailing slash and /v1', () => {
    expect(omnirouteModelsUrl(undefined)).toBe('http://127.0.0.1:20128/v1/models');
    expect(omnirouteModelsUrl('localhost:20128')).toBe('http://localhost:20128/v1/models');
    expect(omnirouteModelsUrl('http://localhost:20128/v1')).toBe('http://localhost:20128/v1/models');
    expect(omnirouteModelsUrl('https://gw.example/v1/')).toBe('https://gw.example/v1/models');
  });
});

describe('capability-registry — strength derivation', () => {
  it('marks Codex / coder models with the "code" strength', async () => {
    process.env.OPENAI_API_KEY = 'k';
    const cap = await getLocalCapabilities();
    const codex = cap.models.find((m) => m.id === 'gpt-5-codex');
    expect(codex?.strengths).toContain('code');
  });

  it('marks Haiku/mini/gemma as cheap + fast', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    process.env.OPENAI_API_KEY = 'k';
    const cap = await getLocalCapabilities();
    const haiku = cap.models.find((m) => m.id === 'claude-haiku-4');
    const mini = cap.models.find((m) => m.id === 'gpt-5-mini');
    expect(haiku?.strengths).toContain('cheap');
    expect(haiku?.strengths).toContain('fast');
    expect(mini?.strengths).toContain('cheap');
  });
});

describe('capability-registry — Hermes role tags', () => {
  it('defaults to ["balanced"] when no models and no env override', async () => {
    const cap = await getLocalCapabilities();
    expect(cap.roles).toEqual(['balanced']);
  });

  it('CODEBUDDY_FLEET_ROLES env wins over heuristic', async () => {
    process.env.OPENAI_API_KEY = 'k'; // would normally pick code role
    process.env.CODEBUDDY_FLEET_ROLES = 'review,research';
    const cap = await getLocalCapabilities();
    expect(cap.roles).toEqual(['review', 'research']);
  });

  it('infers "code" from a Codex-class model', async () => {
    process.env.OPENAI_API_KEY = 'k';
    const cap = await getLocalCapabilities();
    expect(cap.roles).toContain('code');
  });

  it('infers "review" + "research" from reasoning-class models', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const cap = await getLocalCapabilities();
    expect(cap.roles).toContain('review');
    expect(cap.roles).toContain('research');
  });

  it('infers "safe" from cheap + fast models', async () => {
    process.env.ANTHROPIC_API_KEY = 'k'; // includes haiku → cheap+fast
    const cap = await getLocalCapabilities();
    expect(cap.roles).toContain('safe');
  });

  it('trims and deduplicates explicit role list', async () => {
    process.env.CODEBUDDY_FLEET_ROLES = ' review , review ,  research,, code';
    const cap = await getLocalCapabilities();
    expect(cap.roles).toEqual(['review', 'research', 'code']);
  });
});

describe('capability-registry — caching', () => {
  it('caches the snapshot — second call does not re-probe', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const fetchSpy = vi.fn(async () => {
      throw new Error('econn');
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await getLocalCapabilities();
    const callsAfterFirst = fetchSpy.mock.calls.length;
    await getLocalCapabilities();
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('force=true bypasses the cache', async () => {
    process.env.ANTHROPIC_API_KEY = 'k';
    const fetchSpy = vi.fn(async () => {
      throw new Error('econn');
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    await getLocalCapabilities();
    const callsAfterFirst = fetchSpy.mock.calls.length;
    await getLocalCapabilities({ force: true });
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});

describe('capability registry — live load overlay', () => {
  it('reports live activeRequests on every call, even cache hits', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('no network')) as unknown as typeof fetch;
    const { beginFleetWork, _resetFleetLoadForTests } = await import('../../src/fleet/fleet-load.js');
    _resetFleetLoadForTests();
    resetCapabilityCache();

    const cold = await getLocalCapabilities();
    expect(cold.activeRequests).toBe(0);

    const done = beginFleetWork('peer.dispatch');
    // Second call is a cache hit (no force) — load must still be live.
    const warm = await getLocalCapabilities();
    expect(warm.activeRequests).toBe(1);

    done();
    const after = await getLocalCapabilities();
    expect(after.activeRequests).toBe(0);

    _resetFleetLoadForTests();
    global.fetch = originalFetch;
  });
});
