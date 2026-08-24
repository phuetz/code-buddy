import { describe, expect, it, vi } from 'vitest';
import {
  runPerceivedVoiceLatencyBenchmark,
  type BenchmarkAudioOpener,
} from '../../src/voice/perceived-latency-benchmark.js';

function wavStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(44));
      controller.enqueue(new Uint8Array(12));
      controller.close();
    },
  });
}

describe('perceived voice latency benchmark', () => {
  it('exercises the cached hybrid route sentence-by-sentence without playback', async () => {
    const opened: Array<{ engine: string; text: string }> = [];
    const opener = (engine: string): BenchmarkAudioOpener => vi.fn(async (text) => {
      opened.push({ engine, text });
      return wavStream();
    });

    const report = await runPerceivedVoiceLatencyBenchmark(
      {},
      "Lisa, quelles sont les actualités ?",
      {
        runs: 1,
        prefetchAnswer: 'Première nouvelle vérifiée. Deuxième nouvelle importante.',
        engines: ['voicebox', 'pocket'],
        voiceboxOpener: opener('voicebox'),
        pocketOpener: opener('pocket'),
      }
    );

    expect(report).toMatchObject({
      cacheHit: true,
      answerChars: 57,
      sentenceCap: 160,
      runs: 1,
    });
    expect(report.results).toHaveLength(2);
    for (const result of report.results) {
      expect(result).toMatchObject({ successes: 1 });
      expect(result.attempts[0]).toMatchObject({
        success: true,
        mode: 'streamed',
        streamRequests: 2,
        audioChunks: 4,
        audioBytes: 112,
        spokenSegments: 2,
      });
      expect(result.attempts[0]?.firstTextMs).toEqual(expect.any(Number));
      expect(result.attempts[0]?.firstAudioMs).toEqual(expect.any(Number));
    }
    expect(opened.map(({ engine, text }) => `${engine}:${text}`)).toEqual([
      'voicebox:Première nouvelle vérifiée.',
      'voicebox:Deuxième nouvelle importante.',
      'pocket:Première nouvelle vérifiée.',
      'pocket:Deuxième nouvelle importante.',
    ]);
  });

  it('reports a prefetch miss without touching either renderer', async () => {
    const opener = vi.fn(async () => wavStream());
    const report = await runPerceivedVoiceLatencyBenchmark({}, 'actualités', {
      runs: 99,
      sentenceCap: 999,
      prefetchAnswer: null,
      engines: ['pocket'],
      pocketOpener: opener,
    });

    expect(report).toMatchObject({
      cacheHit: false,
      answerChars: 0,
      sentenceCap: 240,
      runs: 5,
    });
    expect(report.results[0]?.attempts).toHaveLength(5);
    expect(report.results[0]?.attempts[0]).toMatchObject({
      success: false,
      error: 'prefetch-cache-miss',
      streamRequests: 0,
    });
    expect(opener).not.toHaveBeenCalled();
  });
});
