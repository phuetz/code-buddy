import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

describe('understandVideo process lifecycle', () => {
  it('returns after local STT and leaves no live child process or pipe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'video-lifecycle-'));
    const video = join(dir, 'sample.mp4');
    const worker = join(dir, 'local-stt');
    const home = join(dir, 'home');
    await mkdir(home);
    try {
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=5:duration=20',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=20',
        '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', video,
      ], { timeout: 5_000 });
      // Local protocol-compatible STT keeps stdin open, just like faster-whisper.
      // The test needs no model download and exposes a leaked persistent worker.
      await writeFile(worker, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ ready: true }) + '\\n');
let buffer = '';
process.stdin.on('data', (part) => {
  buffer += part;
  let end;
  while ((end = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    const request = JSON.parse(line);
    process.stdout.write(JSON.stringify({ id: request.id, text: '' }) + '\\n');
  }
});
`, 'utf8');
      await chmod(worker, 0o755);

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
          CODEBUDDY_SPEECH_ENGINE: 'faster-whisper',
          CODEBUDDY_SPEECH_WORKER: 'true',
          CODEBUDDY_SPEECH_PYTHON: worker,
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
