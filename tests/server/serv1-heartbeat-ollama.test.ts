import { afterEach, describe, expect, it } from 'vitest';
import { resolveHeartbeatProbeTarget } from '../../src/server/heartbeat-monitor.js';

describe('SERV1 API heartbeat probes Ollama via OLLAMA_HOST', () => {
  const keys = ['OLLAMA_HOST', 'OLLAMA_BASE_URL', 'OPENAI_BASE_URL', 'GROK_BASE_URL'] as const;
  const previous: Partial<Record<(typeof keys)[number], string | undefined>> = {};

  afterEach(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
      delete previous[key];
    }
  });

  function snapshot(): void {
    for (const key of keys) {
      previous[key] = process.env[key];
      delete process.env[key];
    }
  }

  it('builds an /api/tags probe from OLLAMA_HOST when OLLAMA_BASE_URL is unset', () => {
    snapshot();
    process.env.OLLAMA_HOST = 'http://127.0.0.1:11434';
    const target = resolveHeartbeatProbeTarget();
    expect(target).not.toBeNull();
    expect(target?.label).toBe('ollama');
    expect(target?.url).toBe('http://127.0.0.1:11434/api/tags');
  });
});
