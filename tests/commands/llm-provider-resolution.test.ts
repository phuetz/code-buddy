/**
 * reconcileModelForBackend — the Codex/ChatGPT-OAuth backend only accepts
 * Codex-family models. When provider resolution crosses over to that backend
 * (no Grok key → the Grok default falls through to ChatGPT OAuth), a mismatched
 * model like `grok-code-fast-1` is otherwise handed to the Codex backend and
 * rejected (400), breaking `goal`/`loop`/`flow`/`research` out of the box.
 */
import { describe, expect, it } from 'vitest';

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
