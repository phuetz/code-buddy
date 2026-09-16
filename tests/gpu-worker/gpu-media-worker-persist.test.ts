import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/utils/atomic-write.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/atomic-write.js')>();
  return { ...actual, writeFileAtomic: vi.fn(actual.writeFileAtomic) };
});

import { createGpuMediaWorkerServer } from '../../src/gpu-worker/gpu-media-worker-server.js';
import { GpuMediaWorkerClient } from '../../src/tools/gpu-media-worker.js';
import { writeFileAtomic } from '../../src/utils/atomic-write.js';

const TOKEN = 'test-worker-token-with-enough-entropy';
const RUNNER = resolve('tests/fixtures/gpu-media-runner.mjs');
const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.mocked(writeFileAtomic).mockClear();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  );
});

describe('GPU media worker job store', () => {
  // A cancelled job re-reads job.json while the server rewrites it: on Windows
  // a bare rename over the open destination fails with EPERM. The shared atomic
  // writer owns the temporary, the durable rename and the retry budget.
  it('persists job state through the shared atomic writer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codebuddy-gpu-persist-'));
    temporaryRoots.push(root);
    const data = join(root, 'data');
    const state = join(root, 'state');
    await mkdir(data, { recursive: true });
    await writeFile(join(data, 'audio.wav'), 'audio');
    await writeFile(join(data, 'lisa.png'), 'image');

    const worker = createGpuMediaWorkerServer({
      host: '127.0.0.1',
      port: 0,
      token: TOKEN,
      stateDir: state,
      allowedRoots: [data],
      runners: {
        avatar_video_render: { command: process.execPath, args: [RUNNER], timeoutMs: 5_000 },
      },
      workerId: 'gpuNode-persist',
    });
    const address = await worker.listen();
    try {
      const client = new GpuMediaWorkerClient({ baseUrl: `http://127.0.0.1:${address.port}`, token: TOKEN });
      const submitted = await client.submit('avatar_video_render', {
        turn_id: 'turn-persist',
        audio_path: join(data, 'audio.wav'),
        reference_image_path: join(data, 'lisa.png'),
        prompt: 'Lisa répond face caméra. [delay]',
        resolution: '480p',
      });
      await expect(client.cancel(submitted.id)).resolves.toMatchObject({ status: 'cancelled' });

      const jobDirectory = join(state, 'jobs', submitted.id);
      const jobFile = join(jobDirectory, 'job.json');
      const calls = vi.mocked(writeFileAtomic).mock.calls.filter(([target]) => target === jobFile);
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls[0]?.[2]).toMatchObject({ mode: 0o600 });
      expect(JSON.parse(await readFile(jobFile, 'utf8')) as { id: string }).toMatchObject({ id: submitted.id });
      expect((await readdir(jobDirectory)).filter((entry) => entry.includes('.tmp'))).toEqual([]);
    } finally {
      await worker.close();
    }
  });
});
