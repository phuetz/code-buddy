/**
 * Phase 1 video-understanding tests — deterministic, no-mocks where feasible.
 *
 * The core `long-transcribe` reassembly runs on a REAL ffmpeg-generated WAV with an
 * INJECTED transcriber (predictable text per chunk), proving cumulative timestamp
 * offsets without a real STT engine. Captions/media-fetch/orchestrator use injected
 * deps so nothing touches the network or spawns yt-dlp.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { execFileSync } from 'child_process';
import { mkdtemp, rm, mkdir, readFile } from 'fs/promises';
import { existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  extractYoutubeVideoId,
  isYoutubeUrl,
  fetchYoutubeCaptions,
  type GetSubtitlesFn,
} from '../../../src/tools/video/youtube-captions.js';
import {
  resolveYtdlp,
  buildYtdlpArgs,
  buildVideoYtdlpArgs,
  downloadAudioWav,
  downloadVideoFile,
  isDownloadOk,
  isVideoDownloadOk,
  isYoutubeSource,
  isRetryableYoutubeFailure,
  resolvePlayerClientChain,
  YOUTUBE_CLIENT_FALLBACKS,
} from '../../../src/tools/video/media-fetch.js';
import {
  buildStoryboardYtdlpArgs,
  extractStoryboardJpegs,
  storyboardFrameIndices,
} from '../../../src/tools/video/youtube-storyboard.js';
import { transcribeLong, defaultChunkSec } from '../../../src/tools/video/long-transcribe.js';
import {
  understandVideo,
  isUnderstandOk,
} from '../../../src/tools/video/video-understanding.js';
import { createMultimodalTools } from '../../../src/tools/registry/multimodal-tools.js';
import { MULTIMODAL_TOOLS } from '../../../src/codebuddy/tool-definitions/multimodal-tools.js';

function hasBinary(bin: string): boolean {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const FFMPEG = hasBinary('ffmpeg') && hasBinary('ffprobe');

/** A fake child process that emits a close/error after the current tick. */
function makeFakeChild(opts: { code?: number | null; error?: Error; stdout?: string; stderr?: string }): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => void;
} {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => {
    if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr));
    if (opts.error) child.emit('error', opts.error);
    else child.emit('close', opts.code ?? 0);
  });
  return child;
}

// ---------------------------------------------------------------------------
// youtube-captions
// ---------------------------------------------------------------------------
describe('youtube-captions', () => {
  it('extracts the video id from all common URL shapes', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeVideoId('https://example.com/video.mp4')).toBeNull();
    expect(extractYoutubeVideoId('not a url')).toBeNull();
  });

  it('recognizes YouTube URLs', () => {
    expect(isYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(isYoutubeUrl('https://vimeo.com/12345')).toBe(false);
  });

  it('maps injected caption cues to normalized numeric segments', async () => {
    const getSubtitles: GetSubtitlesFn = vi.fn(async () => [
      { start: '0.0', dur: '2.5', text: 'Hello  world' },
      { start: '2.5', dur: '3.0', text: 'second cue' },
    ]);
    const segments = await fetchYoutubeCaptions('https://youtu.be/dQw4w9WgXcQ', ['en'], { getSubtitles });
    expect(segments).not.toBeNull();
    expect(segments).toHaveLength(2);
    expect(segments![0]).toEqual({ text: 'Hello world', start: 0, duration: 2.5 });
    expect(segments![1]).toEqual({ text: 'second cue', start: 2.5, duration: 3 });
  });

  it('returns null (never throws) when the caption lib throws', async () => {
    const getSubtitles: GetSubtitlesFn = vi.fn(async () => {
      throw new Error('blocked from datacenter IP');
    });
    const segments = await fetchYoutubeCaptions('https://youtu.be/dQw4w9WgXcQ', ['en'], { getSubtitles });
    expect(segments).toBeNull();
  });

  it('returns null for a non-YouTube URL without calling the lib', async () => {
    const getSubtitles: GetSubtitlesFn = vi.fn(async () => []);
    const segments = await fetchYoutubeCaptions('https://example.com/x.mp4', ['en'], { getSubtitles });
    expect(segments).toBeNull();
    expect(getSubtitles).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// media-fetch (yt-dlp resolution + command construction)
// ---------------------------------------------------------------------------
describe('media-fetch', () => {
  it('resolveYtdlp returns null when nothing is found', () => {
    const invocation = resolveYtdlp({ env: {}, existsSync: () => false, which: () => null });
    expect(invocation).toBeNull();
  });

  it('resolveYtdlp honors CODEBUDDY_YTDLP_BIN when it exists', () => {
    const invocation = resolveYtdlp({
      env: { CODEBUDDY_YTDLP_BIN: '/opt/yt-dlp' },
      existsSync: (p) => p === '/opt/yt-dlp',
      which: () => null,
    });
    expect(invocation).toEqual({ cmd: '/opt/yt-dlp', baseArgs: [], label: '/opt/yt-dlp' });
  });

  it('resolveYtdlp falls back to python -m yt_dlp', () => {
    const invocation = resolveYtdlp({
      env: {},
      existsSync: () => false,
      which: (bin) => (bin === 'python3' ? '/usr/bin/python3' : null),
    });
    expect(invocation).toEqual({ cmd: '/usr/bin/python3', baseArgs: ['-m', 'yt_dlp'], label: '/usr/bin/python3 -m yt_dlp' });
  });

  it('buildYtdlpArgs produces a 16kHz mono WAV extraction command', () => {
    const args = buildYtdlpArgs('https://youtu.be/x', '/out/a.%(ext)s');
    const jsIdx = args.indexOf('--js-runtimes');
    expect(jsIdx).toBeGreaterThanOrEqual(0);
    expect(args[jsIdx + 1]).toBe(`node:${process.execPath}`);
    expect(args).toContain('-x');
    expect(args).toContain('--audio-format');
    expect(args).toContain('wav');
    const ppIdx = args.indexOf('--postprocessor-args');
    expect(ppIdx).toBeGreaterThanOrEqual(0);
    expect(args[ppIdx + 1]).toBe('-ar 16000 -ac 1');
    expect(args).toContain('https://youtu.be/x');
  });

  it('buildVideoYtdlpArgs enables the running Node executable for YouTube extraction', () => {
    const args = buildVideoYtdlpArgs('https://youtu.be/x', '/out/v.%(ext)s');
    const jsIdx = args.indexOf('--js-runtimes');
    expect(jsIdx).toBeGreaterThanOrEqual(0);
    expect(args[jsIdx + 1]).toBe(`node:${process.execPath}`);
    expect(args).toContain('bv*[height<=480]+ba/b[height<=480]/b');
    expect(args).toContain('https://youtu.be/x');
  });

  it('downloadAudioWav returns a clear error when yt-dlp is absent (never throws)', async () => {
    const result = await downloadAudioWav('https://youtu.be/x', '/tmp/out', {
      env: {},
      existsSync: () => false,
      which: () => null,
    });
    expect(isDownloadOk(result)).toBe(false);
    if (!isDownloadOk(result)) {
      expect(result.error).toMatch(/yt-dlp/i);
      expect(result.error).toMatch(/pip install/i);
    }
  });

  it('downloadAudioWav spawns yt-dlp with the correct command and resolves the wav path', async () => {
    const spawnSpy = vi.fn(() => makeFakeChild({ code: 0 }));
    const result = await downloadAudioWav('https://youtu.be/x', '/out', {
      env: { CODEBUDDY_YTDLP_BIN: '/opt/yt-dlp' },
      existsSync: (p) => p === '/opt/yt-dlp',
      which: () => null,
      spawn: spawnSpy as never,
    });
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnSpy.mock.calls[0] as unknown as [string, string[]];
    expect(cmd).toBe('/opt/yt-dlp');
    expect(args).toContain('-x');
    expect(args).toContain('--audio-format');
    expect(args).toContain('wav');
    expect(args[args.indexOf('--postprocessor-args') + 1]).toBe('-ar 16000 -ac 1');
    expect(args).toContain('https://youtu.be/x');
    expect(isDownloadOk(result)).toBe(true);
    if (isDownloadOk(result)) {
      // path.join spelling: native separators on Windows.
      expect(result.wavPath.startsWith(join('/out', 'ytdl-audio-'))).toBe(true);
      expect(result.wavPath.endsWith('.wav')).toBe(true);
    }
  });

  it('downloadAudioWav returns an error on non-zero exit (never throws)', async () => {
    const spawnSpy = vi.fn(() => makeFakeChild({ code: 1, stderr: 'ERROR: unavailable' }));
    const result = await downloadAudioWav('https://youtu.be/x', '/out', {
      env: { CODEBUDDY_YTDLP_BIN: '/opt/yt-dlp' },
      existsSync: (p) => p === '/opt/yt-dlp',
      which: () => null,
      spawn: spawnSpy as never,
    });
    expect(isDownloadOk(result)).toBe(false);
    if (!isDownloadOk(result)) expect(result.error).toMatch(/code 1/);
  });
});

/**
 * YouTube serves the default `android_vr` formats behind URLs that answer HTTP 403
 * (measured 2026-08-24 on `4HTpSc7vB6U`): extraction succeeds, the download dies. The
 * fix is a player-client fallback chain, so these tests pin BOTH the chain itself and
 * the retry decision — a non-YouTube source, or a genuine error, must not be retried.
 */
describe('media-fetch YouTube player-client fallbacks', () => {
  it('only offers fallbacks for YouTube sources', () => {
    expect(isYoutubeSource('https://youtu.be/x')).toBe(true);
    expect(isYoutubeSource('https://www.youtube.com/watch?v=x')).toBe(true);
    expect(isYoutubeSource('https://vimeo.com/123')).toBe(false);
    expect(resolvePlayerClientChain('https://vimeo.com/123', {})).toEqual([undefined]);
    expect(resolvePlayerClientChain('https://youtu.be/x', {})).toEqual([
      undefined,
      ...YOUTUBE_CLIENT_FALLBACKS,
    ]);
  });

  it('lets CODEBUDDY_YTDLP_PLAYER_CLIENTS override or disable the chain', () => {
    expect(
      resolvePlayerClientChain('https://youtu.be/x', { CODEBUDDY_YTDLP_PLAYER_CLIENTS: 'ios, web' }),
    ).toEqual([undefined, 'ios', 'web']);
    expect(
      resolvePlayerClientChain('https://youtu.be/x', { CODEBUDDY_YTDLP_PLAYER_CLIENTS: '' }),
    ).toEqual([undefined]);
  });

  it('recognises the "extraction ok, media refused" signatures', () => {
    expect(isRetryableYoutubeFailure('ERROR: unable to download video data: HTTP Error 403: Forbidden')).toBe(true);
    expect(isRetryableYoutubeFailure('WARNING: Only images are available for download')).toBe(true);
    expect(isRetryableYoutubeFailure('ERROR: Requested format is not available')).toBe(true);
    expect(isRetryableYoutubeFailure('ERROR: Video unavailable')).toBe(false);
  });

  it('retries the video download with player_client=android after a 403', async () => {
    const spawnSpy = vi.fn(() =>
      spawnSpy.mock.calls.length === 1
        ? makeFakeChild({ code: 1, stderr: 'ERROR: unable to download video data: HTTP Error 403: Forbidden' })
        : makeFakeChild({ code: 0 }),
    );
    const result = await downloadVideoFile('https://youtu.be/x', '/out', {
      env: { CODEBUDDY_YTDLP_BIN: '/opt/yt-dlp' },
      existsSync: (p) => p === '/opt/yt-dlp',
      which: () => null,
      spawn: spawnSpy as never,
    });
    expect(spawnSpy).toHaveBeenCalledTimes(2);
    const firstArgs = spawnSpy.mock.calls[0]?.[1] as unknown as string[];
    const secondArgs = spawnSpy.mock.calls[1]?.[1] as unknown as string[];
    expect(firstArgs).not.toContain('--extractor-args');
    expect(secondArgs[secondArgs.indexOf('--extractor-args') + 1]).toBe('youtube:player_client=android');
    expect(isVideoDownloadOk(result)).toBe(true);
  });

  it('does not retry a genuine failure', async () => {
    const spawnSpy = vi.fn(() => makeFakeChild({ code: 1, stderr: 'ERROR: Video unavailable' }));
    const result = await downloadVideoFile('https://youtu.be/x', '/out', {
      env: { CODEBUDDY_YTDLP_BIN: '/opt/yt-dlp' },
      existsSync: (p) => p === '/opt/yt-dlp',
      which: () => null,
      spawn: spawnSpy as never,
    });
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(isVideoDownloadOk(result)).toBe(false);
  });

  it('surfaces the last error once every client is exhausted', async () => {
    const spawnSpy = vi.fn(() =>
      makeFakeChild({ code: 1, stderr: 'ERROR: unable to download video data: HTTP Error 403: Forbidden' }),
    );
    const result = await downloadAudioWav('https://youtu.be/x', '/out', {
      env: { CODEBUDDY_YTDLP_BIN: '/opt/yt-dlp' },
      existsSync: (p) => p === '/opt/yt-dlp',
      which: () => null,
      spawn: spawnSpy as never,
    });
    expect(spawnSpy).toHaveBeenCalledTimes(1 + YOUTUBE_CLIENT_FALLBACKS.length);
    expect(isDownloadOk(result)).toBe(false);
    if (!isDownloadOk(result)) expect(result.error).toMatch(/403/);
  });
});

describe('youtube-storyboard fallback', () => {
  it('builds a local sb0 download with metadata and the running Node runtime', () => {
    const args = buildStoryboardYtdlpArgs('https://youtu.be/x', '/out/s.%(ext)s');
    expect(args[args.indexOf('--js-runtimes') + 1]).toBe(`node:${process.execPath}`);
    expect(args[args.indexOf('-f') + 1]).toBe('sb0');
    expect(args).toContain('--write-info-json');
    expect(args).toContain('https://youtu.be/x');
  });

  it('extracts binary JPEG MIME bodies without corrupting their bytes', () => {
    const first = Buffer.from([0xff, 0xd8, 0x00, 0x80, 0xfe, 0xff, 0xd9]);
    const second = Buffer.from([0xff, 0xd8, 0x0d, 0x0a, 0x41, 0xff, 0xd9]);
    const part = (body: Buffer): Buffer =>
      Buffer.concat([
        Buffer.from(`Content-ID: <x>\r\nContent-Type: image/jpeg\r\nContent-Length: ${body.length}\r\n\r\n`, 'ascii'),
        body,
        Buffer.from('\r\n--boundary\r\n', 'ascii'),
      ]);
    const parsed = extractStoryboardJpegs(Buffer.concat([Buffer.from('--boundary\r\n'), part(first), part(second)]));
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual(first);
    expect(parsed[1]).toEqual(second);
  });

  it('caps storyboard frames evenly while keeping both ends', () => {
    expect(storyboardFrameIndices(92, 5)).toEqual([0, 23, 46, 68, 91]);
    expect(storyboardFrameIndices(3, 10)).toEqual([0, 1, 2]);
    expect(storyboardFrameIndices(0, 10)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// long-transcribe (the deterministic core: real ffmpeg split + injected STT)
// ---------------------------------------------------------------------------
describe('long-transcribe (real ffmpeg, injected STT)', () => {
  let dir: string;
  let wav: string;

  beforeAll(async () => {
    if (!FFMPEG) return;
    dir = await mkdtemp(join(tmpdir(), 'buddy-longtx-test-'));
    wav = join(dir, 'in.wav');
    // 100 s sine → 45s + 45s + ~10s chunks when segmented.
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=100',
      '-ar', '16000', '-ac', '1', wav,
    ]);
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
  });

  it.skipIf(!FFMPEG)('splits into chunks and reassembles with cumulative offsets', async () => {
    const seen: string[] = [];
    const transcriber = vi.fn(async (chunkPath: string) => {
      const idx = seen.length;
      seen.push(chunkPath);
      return `chunk ${idx} said`;
    });

    const segments = await transcribeLong(wav, { transcriber, chunkSec: 45 });

    // 100 s / 45 s → 3 chunks, all non-empty.
    expect(segments).toHaveLength(3);
    expect(transcriber).toHaveBeenCalledTimes(3);

    // Cumulative offsets: chunk 0 starts at 0; each t_start === previous t_end.
    expect(segments[0].t_start).toBe(0);
    expect(segments[1].t_start).toBeCloseTo(segments[0].t_end, 1);
    expect(segments[2].t_start).toBeCloseTo(segments[1].t_end, 1);

    // Real durations: ~45, ~45, ~10; total ≈ 100.
    expect(segments[0].t_end).toBeGreaterThan(40);
    expect(segments[0].t_end).toBeLessThan(50);
    expect(segments[2].t_end).toBeGreaterThan(95);
    expect(segments[2].t_end).toBeLessThan(105);

    // Text carried through in order.
    expect(segments.map((s) => s.said)).toEqual(['chunk 0 said', 'chunk 1 said', 'chunk 2 said']);
  });

  it.skipIf(!FFMPEG)('drops empty transcripts but keeps the timeline accurate', async () => {
    // Middle chunk transcribes to empty → only 2 segments, but offsets still accumulate.
    let i = -1;
    const transcriber = vi.fn(async () => {
      i += 1;
      return i === 1 ? '' : `chunk ${i}`;
    });
    const segments = await transcribeLong(wav, { transcriber, chunkSec: 45 });
    expect(segments).toHaveLength(2);
    expect(segments[0].t_start).toBe(0);
    // Second kept segment is chunk 2 → starts near 90 (after two ~45s chunks).
    expect(segments[1].t_start).toBeGreaterThan(85);
  });

  it('returns [] (never throws) when ffmpeg segmentation fails', async () => {
    const spawn = vi.fn(() => makeFakeChild({ code: 1, stderr: 'no such file' }));
    const segments = await transcribeLong('/nope.mp3', {
      transcriber: async () => 'x',
      spawn: spawn as never,
      workDir: await mkdtemp(join(tmpdir(), 'buddy-longtx-empty-')),
    });
    expect(segments).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// #1 — the default chunk must stay under the STT worker timeout so a fully-spoken
//      chunk is never silently dropped (worker resolves '' on timeout, not throw).
// ---------------------------------------------------------------------------
describe('long-transcribe — timeout-safe default chunk (#1)', () => {
  it('defaultChunkSec sits under the worker timeout budget and scales/clamps with it', () => {
    const prev = process.env.CODEBUDDY_SPEECH_WORKER_TIMEOUT_MS;
    try {
      delete process.env.CODEBUDDY_SPEECH_WORKER_TIMEOUT_MS;
      const d = defaultChunkSec();
      expect(d).toBeGreaterThanOrEqual(8);
      expect(d).toBeLessThanOrEqual(18); // comfortably below the 20 s default budget
      // A larger tuned timeout scales the chunk up, but stays clamped to the MAX.
      process.env.CODEBUDDY_SPEECH_WORKER_TIMEOUT_MS = '60000';
      expect(defaultChunkSec()).toBe(30);
      // A tiny timeout clamps to the MIN floor.
      process.env.CODEBUDDY_SPEECH_WORKER_TIMEOUT_MS = '2000';
      expect(defaultChunkSec()).toBe(8);
    } finally {
      if (prev === undefined) delete process.env.CODEBUDDY_SPEECH_WORKER_TIMEOUT_MS;
      else process.env.CODEBUDDY_SPEECH_WORKER_TIMEOUT_MS = prev;
    }
  });

  it('segments with a default chunk_time under the timeout and drops no chunk', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'buddy-longtx-def-'));
    const segmentArgs: string[] = [];
    const fakeSpawn = ((_cmd: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: () => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      const isSegment = args.includes('segment'); // ffmpeg split; ffprobe never has it
      setImmediate(() => {
        if (isSegment) {
          segmentArgs.push(...args);
          writeFileSync(join(workDir, 'chunk_0000.wav'), 'x');
          writeFileSync(join(workDir, 'chunk_0001.wav'), 'x');
          child.emit('close', 0);
        } else {
          child.stdout.emit('data', Buffer.from('15\n')); // ffprobe duration
          child.emit('close', 0);
        }
      });
      return child;
    }) as never;
    const transcriber = vi.fn(async () => 'spoken content');
    try {
      const segs = await transcribeLong('/audio.wav', { spawn: fakeSpawn, workDir, transcriber });
      const segmentTime = Number(segmentArgs[segmentArgs.indexOf('-segment_time') + 1]);
      expect(segmentTime).toBeGreaterThan(0);
      expect(segmentTime).toBeLessThanOrEqual(18); // under the 20 s worker timeout
      // Both spoken chunks captured — nothing silently truncated.
      expect(segs).toHaveLength(2);
      expect(transcriber).toHaveBeenCalledTimes(2);
    } finally {
      await rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
    }
  });

  it('still honours an explicit chunkSec verbatim (caller override)', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'buddy-longtx-exp-'));
    const segmentArgs: string[] = [];
    const fakeSpawn = ((_cmd: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: () => void;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      const isSegment = args.includes('segment');
      setImmediate(() => {
        if (isSegment) {
          segmentArgs.push(...args);
          writeFileSync(join(workDir, 'chunk_0000.wav'), 'x');
          child.emit('close', 0);
        } else {
          child.stdout.emit('data', Buffer.from('45\n'));
          child.emit('close', 0);
        }
      });
      return child;
    }) as never;
    try {
      await transcribeLong('/audio.wav', { spawn: fakeSpawn, workDir, transcriber: async () => 'x', chunkSec: 45 });
      expect(segmentArgs[segmentArgs.indexOf('-segment_time') + 1]).toBe('45');
    } finally {
      await rm(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// video-understanding orchestrator (source resolution, injected deps)
// ---------------------------------------------------------------------------
describe('understandVideo source resolution', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'buddy-understand-'));
    await mkdir(outDir, { recursive: true });
  });

  afterAll(async () => {
    if (outDir) await rm(outDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});
  });

  it('YouTube URL tries captions first and does NOT download when captions exist', async () => {
    const fetchCaptions = vi.fn(async () => [
      { text: 'intro', start: 0, duration: 2 },
      { text: 'Le modèle PanoWorld produit un monde 3D cohérent.', start: 2, duration: 3 },
    ]);
    const downloadAudio = vi.fn();
    const result = await understandVideo(
      { source: 'https://youtu.be/dQw4w9WgXcQ', question: 'what is it about?' },
      { outDir, fetchCaptions, downloadAudio: downloadAudio as never },
    );
    expect(isUnderstandOk(result)).toBe(true);
    if (isUnderstandOk(result)) {
      expect(result.method).toBe('youtube-captions');
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0]).toEqual({ t_start: 0, t_end: 2, said: 'intro' });
      expect(existsSync(result.transcriptPath)).toBe(true);
      const persisted = await readFile(result.transcriptPath, 'utf8');
      expect(persisted).toContain('intro');
      expect(persisted).toContain('method: youtube-captions');
      expect(result.researchCardPath).toBeDefined();
      expect(existsSync(result.researchCardPath!)).toBe(true);
      const researchCard = await readFile(result.researchCardPath!, 'utf8');
      expect(researchCard).toContain('# Fiche de recherche vidéo');
      expect(researchCard).toContain('what is it about?');
      expect(result.output).toContain('Fiche de recherche pré-structurée');
      expect(result.experimentBacklogPath).toBeDefined();
      expect(existsSync(result.experimentBacklogPath!)).toBe(true);
      const backlog = JSON.parse(await readFile(result.experimentBacklogPath!, 'utf8')) as {
        candidates: Array<{ verificationStatus: string }>;
      };
      expect(backlog.candidates.length).toBeGreaterThan(0);
      expect(backlog.candidates.every((candidate) => candidate.verificationStatus === 'unverified')).toBe(true);
      expect(result.output).toContain('Backlog d’expériences JSON');
    }
    expect(downloadAudio).not.toHaveBeenCalled();
    expect(fetchCaptions).toHaveBeenCalledTimes(1);
  });

  it('YouTube URL with no captions falls back to yt-dlp + local STT', async () => {
    const fetchCaptions = vi.fn(async () => null);
    const downloadAudio = vi.fn(async () => ({ wavPath: '/tmp/a.wav' }));
    const transcribeLongFn = vi.fn(async () => [{ t_start: 0, t_end: 45, said: 'from whisper' }]);
    const result = await understandVideo(
      { source: 'https://youtu.be/dQw4w9WgXcQ' },
      { outDir, fetchCaptions, downloadAudio, transcribeLong: transcribeLongFn },
    );
    expect(isUnderstandOk(result)).toBe(true);
    if (isUnderstandOk(result)) {
      expect(result.method).toBe('youtube-audio');
      expect(result.segments[0].said).toBe('from whisper');
    }
    expect(downloadAudio).toHaveBeenCalledTimes(1);
    expect(transcribeLongFn).toHaveBeenCalledWith('/tmp/a.wav', expect.anything());
  });

  it('surfaces late research signals even when the inline transcript is truncated', async () => {
    const longOpening = 'conversation générale '.repeat(80);
    const fetchCaptions = vi.fn(async () => [
      { text: longOpening, start: 0, duration: 30 },
      { text: 'PanoWorld est un world model open source publié sur GitHub.', start: 900, duration: 10 },
      { text: 'Le benchmark revendique un gain de 42 %.', start: 1_200, duration: 10 },
    ]);
    const result = await understandVideo(
      { source: 'https://youtu.be/dQw4w9WgXcQ' },
      { outDir, fetchCaptions, maxOutputChars: 120 },
    );

    expect(isUnderstandOk(result)).toBe(true);
    if (isUnderstandOk(result)) {
      expect(result.output).toContain('Transcript horodaté tronqué');
      expect(result.output).toContain('Aperçu de recherche (transcript complet)');
      expect(result.output).toContain('PanoWorld');
      expect(result.output).toContain('20:00');
    }
  });

  it('local file routes through extractAudio + transcribeLong', async () => {
    const extractAudio = vi.fn(async () => ({ success: true, output: 'ok', data: { path: '/tmp/x.mp3' } }));
    const transcribeLongFn = vi.fn(async () => [{ t_start: 0, t_end: 10, said: 'local words' }]);
    const result = await understandVideo(
      { source: '/videos/demo.mp4' },
      { outDir, existsSync: (p) => p === '/videos/demo.mp4', extractAudio, transcribeLong: transcribeLongFn },
    );
    expect(isUnderstandOk(result)).toBe(true);
    if (isUnderstandOk(result)) {
      expect(result.method).toBe('local-file');
      expect(result.segments[0].said).toBe('local words');
    }
    expect(extractAudio).toHaveBeenCalledWith('/videos/demo.mp4');
    expect(transcribeLongFn).toHaveBeenCalledWith('/tmp/x.mp3', expect.anything());
  });

  it('surfaces the download error (never throws) when yt-dlp is missing', async () => {
    const fetchCaptions = vi.fn(async () => null);
    const downloadAudio = vi.fn(async () => ({ error: 'yt-dlp introuvable — installe-le (pip install -U yt-dlp)' }));
    const result = await understandVideo(
      { source: 'https://youtu.be/dQw4w9WgXcQ' },
      { outDir, fetchCaptions, downloadAudio },
    );
    expect(isUnderstandOk(result)).toBe(false);
    if (!isUnderstandOk(result)) expect(result.error).toMatch(/yt-dlp/);
  });

  it('rejects an empty source', async () => {
    const result = await understandVideo({ source: '  ' }, { outDir });
    expect(isUnderstandOk(result)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tool exposition + dispatch adapter
// ---------------------------------------------------------------------------
describe('understand_video tool wiring', () => {
  it('is exposed in the multimodal LLM tool definitions with source required', () => {
    const def = MULTIMODAL_TOOLS.find((t) => t.function.name === 'understand_video');
    expect(def).toBeDefined();
    expect(def!.function.parameters?.required).toContain('source');
  });

  it('has a dispatchable ITool adapter in createMultimodalTools()', () => {
    const tool = createMultimodalTools().find((t) => t.name === 'understand_video');
    expect(tool).toBeDefined();
    const schema = tool!.getSchema();
    expect(schema.parameters.required).toContain('source');
    expect(tool!.validate({ source: 'https://youtu.be/x' }).valid).toBe(true);
    expect(tool!.validate({}).valid).toBe(false);
  });
});
