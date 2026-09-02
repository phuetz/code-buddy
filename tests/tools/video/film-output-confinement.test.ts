import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { spawn } from 'node:child_process';
import {
  assembleFilm,
  type ClipProbe,
} from '../../../src/tools/video/film-assemble.js';

const probe: ClipProbe = {
  path: 'clip.mp4',
  duration: 2,
  width: 640,
  height: 360,
  fps: 30,
  hasAudio: false,
  sar: '1:1',
  pixFmt: 'yuv420p',
};

function fakeSpawn(seen: string[][]): typeof spawn {
  return ((command: string, args: string[]) => {
    seen.push([command, ...args]);
    const child = new EventEmitter() as ReturnType<typeof spawn> & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    setImmediate(() => {
      if (command.includes('ffprobe')) {
        child.stdout.emit('data', Buffer.from(JSON.stringify({
          format: { duration: '2' },
          streams: [{
            codec_type: 'video',
            width: 640,
            height: 360,
            r_frame_rate: '30/1',
            pix_fmt: 'yuv420p',
            sample_aspect_ratio: '1:1',
          }],
        })));
        child.emit('close', 0);
        return;
      }
      // Since R1 (2026-09-02) a render is only a success once its artefact exists:
      // the fake ffmpeg leaves a non-empty file at its destination, like the real one.
      const destination = args.at(-1);
      const writes = destination && /\.(mp4|wav|mkv|mov)$/i.test(destination)
        ? writeFile(destination, 'rendered').catch(() => undefined)
        : Promise.resolve();
      void writes.then(() => child.emit('close', 0));
    });
    return child;
  }) as typeof spawn;
}

describe('film output confinement', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'cb-film-confined-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it.each([
    '/tmp/escaped-film.mp4',
    '../escaped-film.mp4',
    'nested/../../escaped-film.mp4',
    'C:\\escaped-film.mp4',
  ])('rejects unsafe output %s before launching ffmpeg', async (output) => {
    const seen: string[][] = [];

    const result = await assembleFilm(
      { clips: ['clip.mp4'], output, rootDir },
      { spawn: fakeSpawn(seen), probeClips: async () => [probe] },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/relative|traversal|media directory/i);
    expect(seen).toHaveLength(0);
  });

  it('resolves a simple relative filename under the confined media directory', async () => {
    const seen: string[][] = [];

    const result = await assembleFilm(
      { clips: ['clip.mp4'], output: 'finished.mp4', rootDir },
      { spawn: fakeSpawn(seen), probeClips: async () => [probe] },
    );

    expect(result.success).toBe(true);
    // The confined output dir is canonical (realpath); os.tmpdir() is a symlink on macOS.
    expect(result.outputPath).toBe(
      path.join(await realpath(rootDir), '.codebuddy', 'media-generation', 'films', 'finished.mp4'),
    );
    // Since R1 (2026-09-02) ffmpeg renders into a unique temp file INSIDE the confined
    // directory and the final name is installed atomically once the artefact is verified.
    const confinedDir = path.dirname(result.outputPath!);
    expect(seen.some((call) => call.some((arg) => arg.startsWith(confinedDir + path.sep) && /-render\.mp4$/.test(arg)))).toBe(true);
    expect(seen.some((call) => call.some((arg) => arg.startsWith('/tmp/') && !arg.startsWith(confinedDir)))).toBe(false);
    await expect(stat(result.outputPath!)).resolves.toMatchObject({ size: expect.any(Number) });
  });
});
