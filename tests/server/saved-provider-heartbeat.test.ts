import { afterEach, describe, expect, it, vi } from 'vitest';
const { target } = vi.hoisted(() => ({ target: vi.fn(() => null as { apiKey: string; providerLabel: string; baseURL: string; model: string } | null) }));
vi.mock('../../src/commands/llm-provider-resolution.js', () => ({ resolveCommandProvider: target }));
import { resolveHeartbeatProbeTarget } from '../../src/server/heartbeat-monitor.js';

describe('server uses the doctor-saved provider without environment overrides', () => {
  afterEach(() => { target.mockReturnValue(null); vi.unstubAllEnvs(); });
  it('probes the saved Ollama endpoint', () => {
    for (const key of ['OLLAMA_HOST', 'OLLAMA_BASE_URL', 'OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL', 'GROK_BASE_URL', 'XAI_BASE_URL', 'GEMINI_BASE_URL']) vi.stubEnv(key, '');
    target.mockReturnValue({ apiKey: 'ollama', providerLabel: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', model: 'fixture-model' });
    expect(resolveHeartbeatProbeTarget()).toEqual({ label: 'ollama', url: 'http://127.0.0.1:11434/api/tags' });
  });
});
