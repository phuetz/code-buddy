/**
 * reconcileModelForBackend — the Codex/ChatGPT-OAuth backend only accepts
 * Codex-family models. When provider resolution crosses over to that backend
 * (no Grok key → the Grok default falls through to ChatGPT OAuth), a mismatched
 * model like `grok-code-fast-1` is otherwise handed to the Codex backend and
 * rejected (400), breaking `goal`/`loop`/`flow`/`research` out of the box.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reconcileModelForBackend } from '../../src/commands/llm-provider-resolution.js';

const CODEX = 'https://chatgpt.com/backend-api/codex';

describe('reconcileModelForBackend', () => {
  it('coerces a non-Codex model to the backend default on the Codex backend', () => {
    // The real bug: grok default + Codex backend → must become the Codex default.
    expect(reconcileModelForBackend('grok-code-fast-1', CODEX, 'gpt-5.5')).toBe('gpt-5.5');
  });

  it('falls back to gpt-5.6-sol when even the backend default is not Codex', () => {
    expect(reconcileModelForBackend('grok-code-fast-1', CODEX, 'grok-3-fast')).toBe('gpt-5.6-sol');
  });

  it('preserves an already-Codex model on the Codex backend', () => {
    expect(reconcileModelForBackend('gpt-5.2', CODEX, 'gpt-5.5')).toBe('gpt-5.2');
    expect(reconcileModelForBackend('gpt-5.5', CODEX, 'gpt-5.5')).toBe('gpt-5.5');
    expect(reconcileModelForBackend('gpt-5.6', CODEX, 'gpt-5.5')).toBe('gpt-5.6-sol');
    expect(reconcileModelForBackend('codex-mini-latest', CODEX, 'gpt-5.5')).toBe('codex-mini-latest');
  });

  it('is a no-op for non-Codex backends (never rewrites a legitimate model)', () => {
    expect(reconcileModelForBackend('grok-code-fast-1', 'https://api.x.ai/v1', 'grok-3-fast')).toBe(
      'grok-code-fast-1',
    );
    expect(reconcileModelForBackend('llama3.1', 'http://localhost:11434/v1', 'llama3.1')).toBe('llama3.1');
    expect(reconcileModelForBackend('grok-code-fast-1', undefined, 'grok-3-fast')).toBe('grok-code-fast-1');
  });
});

/**
 * `buddy login xai` is an explicit act: it says "bill my SuperGrok subscription".
 * An XAI_API_KEY sitting in a .env file is passive configuration. When both are
 * present the explicit login must win — mirroring the ChatGPT-login precedence
 * already documented in index.ts.
 *
 * Measured live on 2026-09-02: Patrice's API key was out of credits (403
 * permission-denied) while his subscription token answered normally, and naming
 * a model on the command line was enough to swap the working credential for the
 * dead one.
 */
describe('xAI subscription login precedence', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ['XAI_API_KEY', 'GROK_API_KEY', 'CODEBUDDY_PROVIDER']) saved[k] = process.env[k];
    vi.resetModules();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.doUnmock('../../src/providers/xai-oauth.js');
    vi.resetModules();
  });

  it('prefers the subscription token over an ambient API key', async () => {
    process.env.XAI_API_KEY = 'xai-dead-key-out-of-credits';
    delete process.env.GROK_API_KEY;
    vi.doMock('../../src/providers/xai-oauth.js', () => ({
      hasXaiCredentials: () => true,
      getValidXaiAccessToken: async () => 'subscription-token',
      XAI_OAUTH_BASE_URL: 'https://api.x.ai/v1',
    }));
    const { resolveCommandProviderWithOAuth } = await import(
      '../../src/commands/llm-provider-resolution.js'
    );
    const resolved = await resolveCommandProviderWithOAuth({ explicitModel: 'grok-4.3' });
    expect(resolved?.apiKey).toBe('subscription-token');
    expect(resolved?.providerLabel).toBe('grok-oauth');
  });

  it('still uses the API key when there is no subscription login', async () => {
    process.env.XAI_API_KEY = 'xai-real-working-key';
    delete process.env.GROK_API_KEY;
    vi.doMock('../../src/providers/xai-oauth.js', () => ({
      hasXaiCredentials: () => false,
      getValidXaiAccessToken: async () => null,
      XAI_OAUTH_BASE_URL: 'https://api.x.ai/v1',
    }));
    const { resolveCommandProviderWithOAuth } = await import(
      '../../src/commands/llm-provider-resolution.js'
    );
    const resolved = await resolveCommandProviderWithOAuth({ explicitModel: 'grok-4.3' });
    expect(resolved?.apiKey).toBe('xai-real-working-key');
  });
});
