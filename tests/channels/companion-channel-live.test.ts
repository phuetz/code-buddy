/**
 * Live companion-profile turn against a local Ollama (opt-in, skipped if down).
 * Bound: < 30s. Ports ≥ 3470 are unused here (loopback Ollama only).
 */
import { describe, it, expect } from 'vitest';
import {
  assembleCompanionChannelPrompt,
  shouldUseCompanionChannelProfile,
} from '../../src/channels/companion-channel-profile.js';
import { runCompanionChannelTurn } from '../../src/channels/companion-channel-turn.js';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11435';
const MODEL = process.env.OLLAMA_MODEL || process.env.GROK_MODEL || 'qwen3:4b-instruct';

async function ollamaReady(): Promise<boolean> {
  try {
    const base = OLLAMA_HOST.replace(/\/v1\/?$/, '');
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// Live performance assertion on a shared local GPU: opt-in like mobile-ws-live
// (RUN_MOBILE_LIVE). Under load (other models resident, lanes running) a 30 s
// budget is a measurement of the machine, not of the code.
describe.skipIf(process.env.RUN_OLLAMA_LIVE !== '1')('companion channel live turn', () => {
  it('completes a no-tools companion turn in under 30s on local Ollama', async () => {
    if (!(await ollamaReady())) {
      return;
    }
    const env = {
      CODEBUDDY_PROVIDER: 'ollama',
      CODEBUDDY_COMPANION_PERSONA: 'copine',
      CODEBUDDY_CHANNEL_PROFILE: 'companion',
    };
    expect(shouldUseCompanionChannelProfile({ text: 'salut, tu es là ?', env })).toBe(true);
    const prompt = await assembleCompanionChannelPrompt({
      userText: 'Réponds seulement: OK',
      history: [],
      env,
    });
    expect(prompt.tokenEstimate).toBeLessThan(1500);
    const started = Date.now();
    const result = await runCompanionChannelTurn({
      apiKey: 'ollama',
      baseUrl: OLLAMA_HOST.endsWith('/v1') ? OLLAMA_HOST : `${OLLAMA_HOST.replace(/\/+$/, '')}/v1`,
      model: MODEL,
      messages: prompt.messages,
      maxTokens: 32,
    });
    const elapsedMs = Date.now() - started;
    expect(result.text.trim().length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(30_000);
  }, 35_000);
});
