import { describe, expect, it } from 'vitest';
import { collectAutonomyBenchCandidates } from '../../src/daemon/autonomy-bench-candidates.js';

describe('collectAutonomyBenchCandidates', () => {
  it('includes the local Ollama model even when no Tailnet peers exist', () => {
    const { candidates, error } = collectAutonomyBenchCandidates({
      local: { model: 'qwen3:4b-instruct', baseUrl: 'http://127.0.0.1:11434/v1', label: 'local' },
      tailnet: [],
    });
    expect(error).toBeUndefined();
    expect(candidates).toEqual([
      { model: 'qwen3:4b-instruct', baseUrl: 'http://127.0.0.1:11434/v1', label: 'local' },
    ]);
  });

  it('keeps local plus matching tailnet models and dedupes the same endpoint', () => {
    const { candidates } = collectAutonomyBenchCandidates({
      local: { model: 'qwen3:4b-instruct', baseUrl: 'http://127.0.0.1:11434/v1', label: 'local' },
      tailnet: [
        {
          hostname: 'ministar-linux',
          ip: '127.0.0.1',
          baseURL: 'http://127.0.0.1:11434/v1',
          models: ['qwen3:4b-instruct', 'qwen3.8:27b'],
        },
        {
          hostname: 'gpuNode',
          ip: '100.64.0.2',
          baseURL: 'http://100.64.0.2:11434/v1',
          models: ['qwen3.8:27b', 'llama3:latest'],
        },
      ],
      modelFilters: ['qwen3'],
    });
    expect(candidates.map((c) => `${c.label}:${c.model}`)).toEqual([
      'local:qwen3:4b-instruct',
      'ministar-linux:qwen3.8:27b',
      'gpuNode:qwen3.8:27b',
    ]);
  });

  it('reports a clear error only when neither local nor tailnet candidates remain', () => {
    const { candidates, error } = collectAutonomyBenchCandidates({
      tailnet: [],
      peerFilter: 'gpuNode',
    });
    expect(candidates).toEqual([]);
    expect(error).toMatch(/local Ollama|Tailnet/i);
  });
});
