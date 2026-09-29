import { describe, expect, it } from 'vitest';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const pythonBin = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0);
const skipReason = !hasFfmpeg ? 'ffmpeg unavailable' : !pythonBin ? 'Python unavailable' : undefined;

describe('understandVideo process lifecycle', () => {
  it.skipIf(Boolean(skipReason))(`returns after local STT and leaves no live child process or pipe${skipReason ? ` (skipped: ${skipReason})` : ''}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'video-lifecycle-'));
    const video = join(dir, 'sample.mp4');
    const home = join(dir, 'home');
    await mkdir(home);
    try {
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=5:duration=20',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=20',
        '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', video,
      ], { timeout: 5_000 });
      // Use the real persistent Python worker protocol without downloading a model.
      await writeFile(join(dir, 'faster_whisper.py'), `class WhisperModel:
    def __init__(self, *args, **kwargs):
        pass

    def transcribe(self, wav, **kwargs):
        return [], None
`, 'utf8');

      const script = `
        import { understandVideo } from './src/tools/video/video-understanding.ts';
        const result = await understandVideo({ source: ${JSON.stringify(video)}, language: 'en' }, { outDir: ${JSON.stringify(dir)} });
        if ('error' in result) throw new Error(result.error);
        const active = process._getActiveHandles().filter((handle) =>
          handle.constructor?.name === 'ChildProcess' ||
          (handle.constructor?.name === 'Socket' && handle !== process.stdin && handle !== process.stdout && handle !== process.stderr)
        );
        if (active.length) throw new Error('active handles after result: ' + active.map((h) => h.constructor?.name).join(','));
        console.log('DONE');
      `;
      const { stdout } = await run(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          HOME: home,
          USERPROFILE: home,
          PYTHONPATH: dir,
          CODEBUDDY_SPEECH_ENGINE: 'faster-whisper',
          CODEBUDDY_SPEECH_WORKER: 'true',
          CODEBUDDY_SPEECH_PYTHON: pythonBin ?? 'python3',
          CODEBUDDY_COLLECTIVE_MEMORY: 'false',
        },
        timeout: 8_000,
      });
      expect(stdout).toContain('DONE');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 15_000);
});
