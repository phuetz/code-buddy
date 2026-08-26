/**
 * Phase 3 (`cloud`) video-understanding tests — deterministic, NO real Gemini call in CI.
 *
 * The cloud path is proven to be:
 *   - STRICTLY opt-in: `cloud` absent/false never touches the cloud machinery, and the
 *     output is byte-identical to a no-cloud run (mirrors the Phase 2 `visual:false` proof).
 *   - never-throws: no API key, a network error, an oversized file all degrade cleanly to
 *     the local transcript.
 *   - privacy-safe: a successful cloud answer carries the explicit privacy warning.
 *
 * The Gemini HTTP boundary is INJECTED (`cloudDeps.callGemini`) so the real
 * `understandVideoCloud` orchestration (source-kind detection, request parts) is exercised
 * without any network — and a couple of tests inject `understandCloud` at the orchestrator
 * seam to assert the "never called" invariant.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { understandVideo, isUnderstandOk } from '../../../src/tools/video/video-understanding.js';
import {
  understandVideoCloud,
  CLOUD_PRIVACY_WARNING,
  type GeminiVideoRequest,
  type GeminiVideoCaller,
} from '../../../src/tools/video/cloud-understand.js';

// A deterministic local transcript pipeline (no ffmpeg / no STT) for a local-file source.
function localDeps(source: string, said = 'only speech') {
  return {
    existsSync: (p: string) => p === source,
    extractAudio: async () => ({ success: true, output: 'ok', data: { path: '/tmp/x.mp3' } }),
    transcribeLong: async () => [{ t_start: 0, t_end: 10, said }],
  };
}

// ---------------------------------------------------------------------------
// Opt-in: cloud absent/false never touches the cloud machinery (byte-identical)
// ---------------------------------------------------------------------------
describe('understandVideo — cloud is strictly opt-in', () => {
  let outDir: string;
  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'buddy-cloud-'));
    await mkdir(outDir, { recursive: true });
  });
  afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
  });

  it('cloud absent: understandCloud is NEVER called and result.cloud is undefined', async () => {
    const understandCloud = vi.fn();
    const result = await understandVideo(
      { source: '/videos/demo.mp4', question: 'what?' },
      { outDir, ...localDeps('/videos/demo.mp4'), understandCloud: understandCloud as never },
    );
    expect(isUnderstandOk(result)).toBe(true);
    if (isUnderstandOk(result)) {
      expect(result.cloud).toBeUndefined();
      expect(result.output).not.toContain('Gemini');
      expect(result.output).not.toContain('Compréhension cloud');
      expect(result.output).not.toContain(CLOUD_PRIVACY_WARNING);
    }
    expect(understandCloud).not.toHaveBeenCalled();
  });

  it('cloud:false: identical behaviour, understandCloud NEVER called', async () => {
    const understandCloud = vi.fn();
    const result = await understandVideo(
      { source: '/videos/demo.mp4', cloud: false },
      { outDir, ...localDeps('/videos/demo.mp4'), understandCloud: understandCloud as never },
    );
    expect(isUnderstandOk(result)).toBe(true);
    if (isUnderstandOk(result)) expect(result.cloud).toBeUndefined();
    expect(understandCloud).not.toHaveBeenCalled();
  });

  it('output is byte-identical with vs without the cloud dep wired (cloud not requested)', async () => {
    const understandCloud = vi.fn();
    const plain = await understandVideo(
      { source: '/videos/demo.mp4', question: 'what?' },
      { outDir, ...localDeps('/videos/demo.mp4') },
    );
    const withDep = await understandVideo(
      { source: '/videos/demo.mp4', question: 'what?' },
      { outDir, ...localDeps('/videos/demo.mp4'), understandCloud: understandCloud as never },
    );
    expect(isUnderstandOk(plain) && isUnderstandOk(withDep)).toBe(true);
    if (isUnderstandOk(plain) && isUnderstandOk(withDep)) {
      expect(withDep.output).toBe(plain.output); // proof: cloud wiring is inert when not requested
    }
    expect(understandCloud).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// cloud:true — degradation + success paths through the orchestrator
// ---------------------------------------------------------------------------
describe('understandVideo — cloud path (never-throws)', () => {
  let outDir: string;
  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'buddy-cloud2-'));
    await mkdir(outDir, { recursive: true });
  });
  afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
  });

  it('cloud:true with NO API key degrades cleanly to the local transcript', async () => {
    // Real understandVideoCloud, but an EMPTY env → config resolves to null before any network.
    const result = await understandVideo(
      { source: '/videos/demo.mp4', cloud: true },
      { outDir, ...localDeps('/videos/demo.mp4', 'spoken words'), cloudDeps: { env: {} } },
    );
    expect(isUnderstandOk(result)).toBe(true);
    if (isUnderstandOk(result)) {
      // Transcript intact (clean fallback).
      expect(result.segments[0]?.said).toBe('spoken words');
      // Cloud requested but degraded — a note, no answer, no privacy warning.
      expect(result.cloud).toBeDefined();
      expect(result.cloud!.answer).toBeUndefined();
      expect(result.cloud!.note).toContain('dégradé');
      expect(result.cloud!.note?.toLowerCase()).toContain('clé api');
      expect(result.output).toContain('transcript'); // fell back to the local transcript
    }
  });

  it('cloud:true with an injected Gemini caller carries the answer + privacy warning', async () => {
    let seen: GeminiVideoRequest | undefined;
    const callGemini: GeminiVideoCaller = async (req) => {
      seen = req;
      return '[0:00] Intro. [1:12] La démo montre le terminal. TL;DR: tutoriel.';
    };
    const result = await understandVideo(
      { source: 'https://youtu.be/dQw4w9WgXcQ', question: 'de quoi parle la vidéo ?', cloud: true },
      {
        outDir,
        fetchCaptions: async () => [{ text: 'hello', start: 0, duration: 5 }],
        cloudDeps: { env: { GEMINI_API_KEY: 'test-key' }, callGemini },
      },
    );
    expect(isUnderstandOk(result)).toBe(true);
    if (isUnderstandOk(result)) {
      expect(result.cloud?.answer).toContain('TL;DR');
      expect(result.cloud?.provider).toBe('gemini');
      expect(result.cloud?.warning).toBe(CLOUD_PRIVACY_WARNING);
      expect(result.cloud?.sourceKind).toBe('youtube');
      // Output leads with the cloud answer AND the privacy warning.
      expect(result.output).toContain('TL;DR');
      expect(result.output).toContain(CLOUD_PRIVACY_WARNING);
      expect(result.output).toContain('Gemini');
    }
    // The injected caller saw a YouTube fileData part, not a byte dump.
    expect(seen?.sourceKind).toBe('youtube');
    expect(seen?.parts?.[0]?.fileData?.fileUri).toBe('https://youtu.be/dQw4w9WgXcQ');
  });

  it('a network error from the caller falls back to the transcript, never throws', async () => {
    const callGemini: GeminiVideoCaller = async () => {
      throw new Error('network down');
    };
    const result = await understandVideo(
      { source: '/videos/demo.mp4', cloud: true },
      {
        outDir,
        ...localDeps('/videos/demo.mp4', 'the spoken transcript'),
        cloudDeps: { env: { GEMINI_API_KEY: 'test-key' }, callGemini },
      },
    );
    expect(isUnderstandOk(result)).toBe(true);
    if (isUnderstandOk(result)) {
      expect(result.segments[0]?.said).toBe('the spoken transcript');
      expect(result.cloud?.answer).toBeUndefined();
      expect(result.cloud?.note).toContain('dégradé');
    }
  });

  it('an understandCloud that THROWS at the seam still degrades (defensive)', async () => {
    const understandCloud = vi.fn(async () => {
      throw new Error('boom');
    });
    const result = await understandVideo(
      { source: '/videos/demo.mp4', cloud: true },
      { outDir, ...localDeps('/videos/demo.mp4'), understandCloud: understandCloud as never },
    );
    expect(isUnderstandOk(result)).toBe(true);
    if (isUnderstandOk(result)) {
      expect(result.cloud?.note).toContain('erreur');
      expect(result.segments).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// understandVideoCloud — unit (source-kind detection, never-throws, no network)
// ---------------------------------------------------------------------------
describe('understandVideoCloud (injected caller)', () => {
  it('YouTube URL → a fileData part, ok result with warning', async () => {
    let req: GeminiVideoRequest | undefined;
    const callGemini: GeminiVideoCaller = async (r) => {
      req = r;
      return 'timestamped answer';
    };
    const out = await understandVideoCloud('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'q?', {
      env: { GEMINI_API_KEY: 'k' },
      callGemini,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.answer).toBe('timestamped answer');
      expect(out.result.sourceKind).toBe('youtube');
      expect(out.result.warning).toBe(CLOUD_PRIVACY_WARNING);
    }
    expect(req?.parts?.[0]?.fileData?.fileUri).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(req?.parts?.[1]?.text).toContain('q?'); // the question is passed through
  });

  it('local file → an inline base64 part with a mime type', async () => {
    let req: GeminiVideoRequest | undefined;
    const bytes = Buffer.from('fake-mp4-bytes');
    const callGemini: GeminiVideoCaller = async (r) => {
      req = r;
      return 'ok';
    };
    const out = await understandVideoCloud('/videos/clip.mp4', undefined, {
      env: { GEMINI_API_KEY: 'k' },
      existsSync: (p) => p === '/videos/clip.mp4',
      readFile: async () => bytes,
      callGemini,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.result.sourceKind).toBe('file-inline');
    expect(req?.parts?.[0]?.inlineData?.mimeType).toBe('video/mp4');
    expect(req?.parts?.[0]?.inlineData?.data).toBe(bytes.toString('base64'));
  });

  it('no API key → soft failure, caller NEVER invoked (no data sent)', async () => {
    const callGemini = vi.fn();
    const out = await understandVideoCloud('https://youtu.be/x', undefined, {
      env: {},
      callGemini: callGemini as never,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason.toLowerCase()).toContain('clé api');
    expect(callGemini).not.toHaveBeenCalled();
  });

  it('oversized local file → soft failure (Files API out of scope), never throws', async () => {
    const big = Buffer.alloc(1024); // 1 KB
    const out = await understandVideoCloud('/videos/huge.mp4', undefined, {
      env: { GEMINI_API_KEY: 'k' },
      existsSync: (p) => p === '/videos/huge.mp4',
      readFile: async () => big,
      maxInlineBytes: 512, // force the over-limit branch
      callGemini: async () => 'should not be reached',
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('volumineux');
  });

  it('a caller that throws is swallowed → soft failure (never-throws)', async () => {
    const out = await understandVideoCloud('https://youtu.be/x', undefined, {
      env: { GEMINI_API_KEY: 'k' },
      callGemini: async () => {
        throw new Error('quota exceeded');
      },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('Gemini');
  });

  it('an unknown source (no file, not a URL) → soft failure', async () => {
    const out = await understandVideoCloud('just some words', undefined, {
      env: { GEMINI_API_KEY: 'k' },
      existsSync: () => false,
      callGemini: async () => 'x',
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('introuvable');
  });
});
