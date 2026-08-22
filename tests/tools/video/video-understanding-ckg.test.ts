/**
 * `understandVideo` × Collective Knowledge Graph gate — integration tests.
 *
 * Proves the wiring described in `video-ckg.ts`'s header: the CKG ingestion is
 * STRICTLY gated on the shared `CODEBUDDY_COLLECTIVE_MEMORY=true` env flag (no new
 * tool parameter), never alters `understandVideo`'s return value, and never throws
 * even when the injected bridge misbehaves. Uses the SAME injected-deps pattern as
 * `video-understanding.test.ts` (no network, no yt-dlp, no real STT).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { understandVideo, isUnderstandOk } from '../../../src/tools/video/video-understanding.js';
import type { VideoCkgBridge, VideoCkgIngestPayload } from '../../../src/tools/video/video-ckg.js';

function fakeBridge(impl?: (payload: VideoCkgIngestPayload) => Promise<unknown>): VideoCkgBridge {
  return { ingest: vi.fn(impl ?? (async () => ({ id: 'discovery:collective:x' }))) };
}

const fetchCaptions = async () => [
  { text: 'introduction segment', start: 0, duration: 5 },
  { text: 'middle explanation segment', start: 5, duration: 5 },
  { text: 'conclusion segment', start: 10, duration: 5 },
];

describe('understandVideo — CKG ingestion gate', () => {
  let outDir: string;
  const ORIGINAL_ENV = process.env.CODEBUDDY_COLLECTIVE_MEMORY;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'buddy-understand-ckg-'));
    delete process.env.CODEBUDDY_COLLECTIVE_MEMORY;
  });

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
    if (ORIGINAL_ENV === undefined) delete process.env.CODEBUDDY_COLLECTIVE_MEMORY;
    else process.env.CODEBUDDY_COLLECTIVE_MEMORY = ORIGINAL_ENV;
  });

  it('gate OFF (default): the bridge is never called, and the result is byte-identical whether or not a bridge is injected', async () => {
    const bridge = fakeBridge();
    const withoutBridge = await understandVideo({ source: 'https://youtu.be/dQw4w9WgXcQ' }, { outDir, fetchCaptions });
    const withBridge = await understandVideo(
      { source: 'https://youtu.be/dQw4w9WgXcQ' },
      { outDir, fetchCaptions, ckgBridge: bridge },
    );
    expect(bridge.ingest).not.toHaveBeenCalled();
    expect(withBridge).toEqual(withoutBridge);
    expect(isUnderstandOk(withBridge)).toBe(true);
  });

  it('gate ON: ingests one bounded discovery node and does NOT alter the return value', async () => {
    process.env.CODEBUDDY_COLLECTIVE_MEMORY = 'true';
    const bridge = fakeBridge();

    const bare = await understandVideo({ source: 'https://youtu.be/dQw4w9WgXcQ' }, { outDir, fetchCaptions });
    const withBridge = await understandVideo(
      { source: 'https://youtu.be/dQw4w9WgXcQ' },
      { outDir, fetchCaptions, ckgBridge: bridge },
    );

    expect(bridge.ingest).toHaveBeenCalledTimes(1);
    const payload = (bridge.ingest as ReturnType<typeof vi.fn>).mock.calls[0]![0] as VideoCkgIngestPayload;
    expect(payload.name).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(payload.source).toBe('video-understanding');
    expect(payload.text).toContain('youtube-captions');
    expect(payload.text.length).toBeLessThanOrEqual(4000); // bounded, never the whole transcript

    // Ingestion is a pure side effect: the returned understanding is identical either way.
    expect(withBridge).toEqual(bare);
  });

  it('never throws: a bridge that rejects still lets understandVideo succeed normally', async () => {
    process.env.CODEBUDDY_COLLECTIVE_MEMORY = 'true';
    const bridge: VideoCkgBridge = {
      ingest: vi.fn(async () => {
        throw new Error('ledger down');
      }),
    };
    const result = await understandVideo(
      { source: 'https://youtu.be/dQw4w9WgXcQ' },
      { outDir, fetchCaptions, ckgBridge: bridge },
    );
    expect(isUnderstandOk(result)).toBe(true);
    if (isUnderstandOk(result)) {
      expect(result.method).toBe('youtube-captions');
      expect(result.segments).toHaveLength(3);
    }
  });

  it('bounded: a very long transcript still ingests a short digest, never the full transcript', async () => {
    process.env.CODEBUDDY_COLLECTIVE_MEMORY = 'true';
    const longSegment = 'word '.repeat(500);
    const longCaptions = async () =>
      Array.from({ length: 20 }, (_, i) => ({ text: `${longSegment}${i}`, start: i * 10, duration: 10 }));
    const bridge = fakeBridge();

    await understandVideo(
      { source: 'https://youtu.be/dQw4w9WgXcQ' },
      { outDir, fetchCaptions: longCaptions, ckgBridge: bridge },
    );

    const payload = (bridge.ingest as ReturnType<typeof vi.fn>).mock.calls[0]![0] as VideoCkgIngestPayload;
    const fullTranscriptLength = 20 * (longSegment.length + 2);
    expect(payload.text.length).toBeLessThanOrEqual(4000);
    expect(payload.text.length).toBeLessThan(fullTranscriptLength / 5);
  });

  it('a non-"true" env value does not enable the gate', async () => {
    process.env.CODEBUDDY_COLLECTIVE_MEMORY = '1';
    const bridge = fakeBridge();
    await understandVideo({ source: 'https://youtu.be/dQw4w9WgXcQ' }, { outDir, fetchCaptions, ckgBridge: bridge });
    expect(bridge.ingest).not.toHaveBeenCalled();
  });
});
