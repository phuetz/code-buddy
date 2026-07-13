import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { runTtsLatencyBenchmark } from '../../src/voice/tts-latency-benchmark.js';

describe('TTS latency benchmark', () => {
  it('measures Voicebox and Pocket sequentially with bounded run counts', async () => {
    const order: string[] = [];
    const voiceboxSynthesizer = vi.fn(async (_text: string, path: string) => {
      order.push('voicebox');
      await writeFile(path, Buffer.alloc(64));
      return true;
    });
    const pocketSynthesizer = vi.fn(async (_text: string, path: string) => {
      order.push('pocket');
      await writeFile(path, Buffer.alloc(48));
      return true;
    });
    let clock = 0;
    const report = await runTtsLatencyBenchmark(
      {},
      ' Une phrase de test. ',
      {
        runs: 2,
        voiceboxSynthesizer,
        pocketSynthesizer,
        now: () => {
          const value = clock;
          clock += 25;
          return value;
        },
      }
    );

    expect(order).toEqual(['voicebox', 'voicebox', 'pocket', 'pocket']);
    expect(report.text).toBe('Une phrase de test.');
    expect(report.runs).toBe(2);
    expect(report.results[0]).toMatchObject({
      engine: 'voicebox',
      successes: 2,
      averageMs: 25,
      bestMs: 25,
    });
    expect(report.results[0]?.attempts[0]?.audioBytes).toBe(64);
    expect(report.results[1]?.attempts[0]?.audioBytes).toBe(48);
  });

  it('records a renderer failure instead of throwing', async () => {
    const report = await runTtsLatencyBenchmark(
      {},
      'Test',
      {
        runs: 99,
        voiceboxSynthesizer: async () => false,
        pocketSynthesizer: async () => {
          throw new Error('Pocket absent');
        },
        now: () => 0,
      }
    );

    expect(report.runs).toBe(5);
    expect(report.results[0]).toMatchObject({ successes: 0 });
    expect(report.results[1]).toMatchObject({ successes: 0 });
    expect(report.results[1]?.attempts[0]?.error).toBe('Pocket absent');
  });
});
