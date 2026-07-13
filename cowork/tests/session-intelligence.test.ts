import { describe, expect, it } from 'vitest';
import type { ApiConfigSet, Session, SessionIntelligence } from '../src/renderer/types';
import { chooseLowLatencyRuntime } from '../src/renderer/components/SessionIntelligenceBar';
import { appendLatencyMeasurement, summarizeLatencyHistory } from '../src/shared/session-latency';
import { inferExecutionLocation, rankLowLatencyRuntimes } from '../src/shared/low-latency-routing';

describe('Session Intelligence routing', () => {
  it('prefers a small local runtime over a large cloud reasoning model', () => {
    const sets = [
      {
        id: 'cloud', name: 'Cloud', provider: 'openrouter', customProtocol: 'openai', activeProfileKey: 'openrouter',
        profiles: { openrouter: { apiKey: '', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' } }, enableThinking: true, updatedAt: '',
      },
      {
        id: 'voice-local', name: 'Voice local', provider: 'ollama', customProtocol: 'openai', activeProfileKey: 'ollama',
        profiles: { ollama: { apiKey: '', model: 'qwen3.5:0.8b' } }, enableThinking: false, updatedAt: '',
      },
    ] as ApiConfigSet[];

    expect(chooseLowLatencyRuntime(sets)).toMatchObject({
      configSetId: 'voice-local',
      profileId: 'ollama',
      model: 'qwen3.5:0.8b',
    });
  });

  it('recognises a loopback Lemonade profile as the fastest conversational path', () => {
    const sets = [
      {
        id: 'deep-local', name: 'Deep local', provider: 'custom', customProtocol: 'openai', activeProfileKey: 'deep',
        profiles: { deep: { apiKey: 'lemonade', baseUrl: 'http://127.0.0.1:13305/api/v1', model: 'Qwen3.6-35B-A3B-MTP-GGUF' } },
        enableThinking: false, updatedAt: '',
      },
      {
        id: 'voice-lemonade', name: 'Voice Lemonade', provider: 'custom', customProtocol: 'openai', activeProfileKey: 'voice',
        profiles: { voice: { apiKey: 'lemonade', baseUrl: 'http://127.0.0.1:13305/api/v1', model: 'Qwen2.5-1.5B-Instruct-GGUF-Q4_K_M' } },
        enableThinking: false, updatedAt: '',
      },
    ] as ApiConfigSet[];

    expect(chooseLowLatencyRuntime(sets)).toMatchObject({
      configSetId: 'voice-lemonade',
      model: 'Qwen2.5-1.5B-Instruct-GGUF-Q4_K_M',
      executionLocation: 'local',
    });
  });

  it('keeps a bounded latency history and detects consecutive budget misses', () => {
    let intelligence: SessionIntelligence = {
      thinkingLevel: 'minimal',
      fastMode: true,
      executionLocation: 'local',
      latencyBudgetMs: 700,
    };
    intelligence = appendLatencyMeasurement(intelligence, { firstTokenMs: 420, totalMs: 900, measuredAt: 1 });
    intelligence = appendLatencyMeasurement(intelligence, { firstTokenMs: 810, totalMs: 1_100, measuredAt: 2 });
    intelligence = appendLatencyMeasurement(intelligence, { firstTokenMs: 920, totalMs: 1_300, measuredAt: 3 });

    expect(summarizeLatencyHistory(intelligence)).toEqual({
      samples: 3,
      p50Ms: 810,
      p95Ms: 920,
      consecutiveBudgetBreaches: 2,
    });
  });

  it('prefers measured latency once a runtime has enough observations', () => {
    const sets = [
      {
        id: 'local', name: 'Local', provider: 'ollama', customProtocol: 'openai', activeProfileKey: 'ollama',
        profiles: { ollama: { apiKey: '', model: 'qwen3.5:3b' } }, enableThinking: false, updatedAt: '',
      },
      {
        id: 'cloud-fast', name: 'Cloud Fast', provider: 'openrouter', customProtocol: 'openai', activeProfileKey: 'openrouter',
        profiles: { openrouter: { apiKey: '', model: 'gemini-flash' } }, enableThinking: false, updatedAt: '',
      },
    ] as ApiConfigSet[];
    const sessions: Session[] = [
      {
        id: 'measured-cloud', title: 'Measured', status: 'idle', mountedPaths: [], allowedTools: [], memoryEnabled: false,
        model: 'gemini-flash', createdAt: 0, updatedAt: 0,
        intelligence: {
          configSetId: 'cloud-fast', thinkingLevel: 'minimal', fastMode: true, executionLocation: 'cloud', latencyBudgetMs: 700,
          latencyHistory: [
            { firstTokenMs: 120, measuredAt: 1, configSetId: 'cloud-fast', model: 'gemini-flash' },
            { firstTokenMs: 140, measuredAt: 2, configSetId: 'cloud-fast', model: 'gemini-flash' },
            { firstTokenMs: 130, measuredAt: 3, configSetId: 'cloud-fast', model: 'gemini-flash' },
            { firstTokenMs: 125, measuredAt: 4, configSetId: 'cloud-fast', model: 'gemini-flash' },
            { firstTokenMs: 135, measuredAt: 5, configSetId: 'cloud-fast', model: 'gemini-flash' },
          ],
        },
      },
    ];

    const ranked = rankLowLatencyRuntimes(sets, sessions);
    expect(ranked[0]).toMatchObject({
      configSetId: 'cloud-fast',
      source: 'measured',
      sampleCount: 5,
      p50Ms: 130,
      executionLocation: 'cloud',
    });
  });

  it('classifies private compatible endpoints as LAN runtimes', () => {
    const set = {
      id: 'vllm-lan', name: 'vLLM LAN', provider: 'vllm', customProtocol: 'openai', activeProfileKey: 'vllm',
      profiles: { vllm: { apiKey: '', baseUrl: 'http://192.168.1.42:8000/v1', model: 'gemma-4' } },
      enableThinking: false, updatedAt: '',
    } as ApiConfigSet;
    expect(inferExecutionLocation(set)).toBe('lan');
  });
});
