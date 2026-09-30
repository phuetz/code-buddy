import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { transcribeLong } from '../../../src/tools/video/long-transcribe.js';
import { understandVideo } from '../../../src/tools/video/video-understanding.js';

// Needs a real ffmpeg (WAV fixture + segmentation), absent from the CI runners.
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

describe.runIf(hasFfmpeg)('video transcription failures', () => {
  it('reports an unavailable STT engine instead of claiming silence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'buddy-video-stt-'));
    const wav = join(dir, 'audio.wav');
    try {
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', wav]);
      const result = await understandVideo({ source: wav }, {
        outDir: join(dir, 'out'),
        extractAudio: async () => ({ success: true, data: { path: wav } }),
        transcribeLong: (file, options) => transcribeLong(file, {
          ...options,
          transcriber: async () => { throw new Error('STT engine unavailable'); },
        }),
      });
      expect(result).toEqual({ error: expect.stringContaining('STT engine unavailable') });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
