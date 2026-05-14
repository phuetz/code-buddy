/**
 * Fleet LLM routing tests — Phase (d).20.
 *
 * Validates `resolveTickProvider` priority cascade:
 *   1. task.preferLocal=true + Ollama → ollama
 *   2. preferLocal=true without Ollama → fallthrough to host config
 *   3. llm_provider='cloud' (default) → ChatGPT subscription, then cloud API env
 *   4. llm_provider='auto' → factory auto-detect
 *   5. llm_provider='<id>' → force that provider via factory
 *   6. Factory failure → fallback to GROK env
 *   7. preferLocal overrides llm_provider config
 *   8. Worklog entry includes provider + model fields (smoke test)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as FleetTick from '../../../src/agent/autonomous/fleet-tick-handler.js';
import type { FleetTask } from '../../../src/agent/autonomous/fleet-task-types.js';

const ENV_KEYS = [
  'OLLAMA_HOST',
  'GROK_API_KEY',
  'GROK_BASE_URL',
  'GROK_MODEL',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_CLI_PATH',
  'OPENAI_API_KEY',
  'CODEBUDDY_PEER_PROVIDER',
  'CODEBUDDY_PEER_MODEL',
  'CHATGPT_MODEL',
  'HOME',
  'USERPROFILE',
];

let saved: Record<string, string | undefined>;
let tmpHome: string;
let fleetTick: typeof FleetTick;

beforeEach(async () => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-fleet-home-'));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  // Keep these tests hermetic on developer machines that have `gemini`
  // installed globally; an explicit missing path disables PATH probing.
  process.env.GEMINI_CLI_PATH = '__codebuddy_missing_gemini_cli_for_tests__';
  vi.resetModules();
  fleetTick = await import('../../../src/agent/autonomous/fleet-tick-handler.js');
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function resolveTickProvider(
  task: Pick<FleetTask, 'preferLocal'>,
  configProvider: Parameters<typeof fleetTick.resolveTickProvider>[1],
): ReturnType<typeof fleetTick.resolveTickProvider> {
  return fleetTick.resolveTickProvider(task, configProvider);
}

function writeCodexCredentials(): void {
  const dir = path.join(tmpHome, '.codebuddy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'codex-auth.json'),
    JSON.stringify({
      tokens: {
        access_token: 'test-access-token',
        id_token: 'test-id-token',
        refresh_token: 'test-refresh-token',
      },
    }),
    'utf-8',
  );
}

const taskBase = (overrides: Partial<FleetTask> = {}): Pick<FleetTask, 'preferLocal'> => ({
  preferLocal: false,
  ...overrides,
});

describe('resolveTickProvider — priority cascade', () => {
  it('preferLocal=true with OLLAMA_HOST → ollama (local)', () => {
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    const r = resolveTickProvider(taskBase({ preferLocal: true }), 'cloud');
    expect(r.provider).toBe('ollama');
    expect(r.isLocal).toBe(true);
    expect(r.reason).toBe('preferLocal');
    expect(r.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('preferLocal=true WITHOUT Ollama → falls through to llm_provider=cloud', () => {
    process.env.GROK_API_KEY = 'sk-grok';
    const r = resolveTickProvider(taskBase({ preferLocal: true }), 'cloud');
    // Falls through — no OLLAMA_HOST, so cloud takes effect
    expect(r.provider).toBe('grok');
    expect(r.reason).toBe('config:cloud');
    expect(r.apiKey).toBe('sk-grok');
  });

  it('llm_provider=undefined or "cloud" → cloud provider env', () => {
    process.env.GROK_API_KEY = 'sk-grok';
    process.env.GROK_BASE_URL = 'https://custom-grok/v1';
    process.env.GROK_MODEL = 'grok-3-mini';

    const r1 = resolveTickProvider(taskBase(), 'cloud');
    expect(r1.provider).toBe('grok');
    expect(r1.apiKey).toBe('sk-grok');
    expect(r1.baseUrl).toBe('https://custom-grok/v1');
    expect(r1.model).toBe('grok-3-mini');
    expect(r1.reason).toBe('config:cloud');

    // undefined → same as 'cloud' (default V0.1)
    const r2 = resolveTickProvider(taskBase(), undefined);
    expect(r2.provider).toBe('grok');
    expect(r2.reason).toBe('config:cloud');
  });

  it('llm_provider="cloud" prefers ChatGPT subscription auth over legacy Grok env', () => {
    writeCodexCredentials();
    process.env.GROK_API_KEY = 'sk-grok';
    process.env.CHATGPT_MODEL = 'gpt-5.1-codex';

    const r = resolveTickProvider(taskBase(), 'cloud');

    expect(r.provider).toBe('chatgpt');
    expect(r.apiKey).toBe('oauth-chatgpt');
    expect(r.model).toBe('gpt-5.1-codex');
    expect(r.reason).toBe('config:cloud');
  });

  it('llm_provider="auto" → factory auto-detect (Ollama first)', () => {
    process.env.OLLAMA_HOST = 'localhost:11434';
    process.env.GROK_API_KEY = 'sk-grok';
    const r = resolveTickProvider(taskBase(), 'auto');
    expect(r.provider).toBe('ollama'); // Ollama wins priority
    expect(r.isLocal).toBe(true);
    expect(r.reason).toBe('config:auto');
  });

  it('llm_provider="ollama" forces ollama', () => {
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    const r = resolveTickProvider(taskBase(), 'ollama');
    expect(r.provider).toBe('ollama');
    expect(r.reason).toBe('config:explicit');
  });

  it('llm_provider="anthropic" forces anthropic', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    const r = resolveTickProvider(taskBase(), 'anthropic');
    expect(r.provider).toBe('anthropic');
    expect(r.apiKey).toBe('sk-ant');
    expect(r.reason).toBe('config:explicit');
  });

  it('llm_provider="ollama" without OLLAMA_HOST → fallback GROK env', () => {
    // No OLLAMA_HOST configured. Factory.resolve('ollama') returns null.
    process.env.GROK_API_KEY = 'sk-grok';
    const r = resolveTickProvider(taskBase(), 'ollama');
    expect(r.provider).toBe('grok');
    expect(r.reason).toBe('fallback');
  });

  it('llm_provider="auto" with no providers configured → fallback GROK env (empty)', () => {
    // Nothing in env at all.
    const r = resolveTickProvider(taskBase(), 'auto');
    expect(r.provider).toBe('grok');
    expect(r.reason).toBe('fallback');
    expect(r.apiKey).toBe(''); // V0.1 behavior — empty key, will fail later
  });

  it('preferLocal=true OVERRIDES llm_provider config', () => {
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    // Config says anthropic, task says preferLocal — preferLocal wins
    const r = resolveTickProvider(taskBase({ preferLocal: true }), 'anthropic');
    expect(r.provider).toBe('ollama');
    expect(r.reason).toBe('preferLocal');
  });

  it('CODEBUDDY_PEER_MODEL overrides default model on explicit provider', () => {
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    process.env.CODEBUDDY_PEER_MODEL = 'qwen2.5-coder:32b';
    const r = resolveTickProvider(taskBase(), 'ollama');
    expect(r.model).toBe('qwen2.5-coder:32b');
  });

  it('default model used when CODEBUDDY_PEER_MODEL not set', () => {
    process.env.OLLAMA_HOST = 'http://localhost:11434';
    const r = resolveTickProvider(taskBase(), 'ollama');
    expect(r.model).toBe('qwen2.5-coder:7b');
  });

  it('Ollama URL normalisation: bare host → http://host:port/v1', () => {
    process.env.OLLAMA_HOST = '100.98.18.76:11434';
    const r = resolveTickProvider(taskBase(), 'ollama');
    expect(r.baseUrl).toBe('http://100.98.18.76:11434/v1');
  });
});
