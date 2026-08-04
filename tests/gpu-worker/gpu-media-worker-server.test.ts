import { createHash } from 'crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { createGpuMediaWorkerServer } from '../../src/gpu-worker/gpu-media-worker-server.js';
import { GpuMediaWorkerClient, type GpuMediaJobView } from '../../src/tools/gpu-media-worker.js';

const TOKEN = 'test-worker-token-with-enough-entropy';
const RUNNER = resolve('tests/fixtures/gpu-media-runner.mjs');
const temporaryRoots: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codebuddy-gpu-worker-'));
  temporaryRoots.push(root);
  const data = join(root, 'data');
  const state = join(root, 'state');
  await mkdir(data, { recursive: true });
  await writeFile(join(data, 'pano.jpg'), 'pano');
  await writeFile(join(data, 'audio.wav'), 'audio');
  await writeFile(join(data, 'lisa.png'), 'image');
  const config = {
    host: '127.0.0.1',
    port: 0,
    token: TOKEN,
    stateDir: state,
    allowedRoots: [data],
    runners: {
      panoworld_reconstruct: { command: process.execPath, args: [RUNNER], timeoutMs: 5_000 },
      avatar_video_render: { command: process.execPath, args: [RUNNER], timeoutMs: 5_000 },
    },
    workerId: 'darkstar-test',
  };
  const worker = createGpuMediaWorkerServer(config);
  const address = await worker.listen();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return { root, data, state, config, worker, baseUrl };
}

async function waitForTerminal(client: GpuMediaWorkerClient, id: string): Promise<GpuMediaJobView> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const job = await client.status(id);
    if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error('job did not reach a terminal state');
}

async function waitForProgress(
  client: GpuMediaWorkerClient,
  id: string,
  minimum: number
): Promise<GpuMediaJobView> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const job = await client.status(id);
    if ((job.progress ?? 0) >= minimum) return job;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error('job did not report progress');
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe('GPU media worker server', () => {
  it('stages bounded authenticated image and audio assets for a LongCat job', async () => {
    const context = await fixture();
    try {
      const client = new GpuMediaWorkerClient({ baseUrl: context.baseUrl, token: TOKEN });
      const image = await client.uploadAsset('reference.png', new Uint8Array([137, 80, 78, 71]), 'image/png');
      const audio = await client.uploadAsset('voice.wav', new Uint8Array([82, 73, 70, 70]), 'audio/wav');
      expect(image.path).toContain(join(context.state, 'uploads'));
      expect(audio.bytes).toBe(4);
      const submitted = await client.submit('avatar_video_render', {
        turnId: 'flow-turn',
        audioPath: audio.path,
        referenceImagePath: image.path,
        prompt: 'Warm virtual companion speaking to camera.',
        resolution: '480p',
      });
      await expect(waitForTerminal(client, submitted.id)).resolves.toMatchObject({ status: 'succeeded' });
    } finally {
      await context.worker.close();
    }
  });

  it('authenticates, advertises capabilities, persists and executes a PanoWorld job', async () => {
    const context = await fixture();
    try {
      const unauthorized = await fetch(`${context.baseUrl}/v1/capabilities`);
      expect(unauthorized.status).toBe(401);

      const client = new GpuMediaWorkerClient({ baseUrl: context.baseUrl, token: TOKEN });
      await expect(client.capabilities()).resolves.toMatchObject({
        protocolVersion: 1,
        workerId: 'darkstar-test',
        jobs: expect.arrayContaining(['panoworld_reconstruct', 'avatar_video_render']),
      });

      const submitted = await client.submit('panoworld_reconstruct', {
        scene_id: 'living-room',
        profile: 'single-2048',
        panoramas: [{ image_path: join(context.data, 'pano.jpg'), room_id: 'living-room' }],
        output_dir: context.data,
      });
      const completed = await waitForTerminal(client, submitted.id);
      expect(completed).toMatchObject({
        kind: 'panoworld_reconstruct',
        status: 'succeeded',
        progress: 1,
        output: {
          jobId: submitted.id,
          artifact: 'result.bin',
          requestEnvMatchesArgument: true,
          allowedRoots: [context.data],
        },
      });
      expect(context.worker.getJob(submitted.id)?.payload).toBeTruthy();
    } finally {
      await context.worker.close();
    }
  });

  it('fails closed for paths outside configured roots', async () => {
    const context = await fixture();
    try {
      const client = new GpuMediaWorkerClient({ baseUrl: context.baseUrl, token: TOKEN });
      await expect(
        client.submit('panoworld_reconstruct', {
          scene_id: 'escape',
          profile: 'single-2048',
          panoramas: [{ image_path: resolve(context.root, '..', 'private.jpg'), room_id: 'room' }],
          output_dir: context.data,
        })
      ).rejects.toThrow(/outside configured roots/);
    } finally {
      await context.worker.close();
    }
  });

  it('publishes chunk-safe runner progress while a job is running', async () => {
    const context = await fixture();
    try {
      const client = new GpuMediaWorkerClient({ baseUrl: context.baseUrl, token: TOKEN });
      const submitted = await client.submit('panoworld_reconstruct', {
        scene_id: 'progress-room',
        profile: 'single-2048',
        panoramas: [{ image_path: join(context.data, 'pano.jpg'), room_id: 'room' }],
        output_dir: context.data,
      });
      await expect(waitForProgress(client, submitted.id, 0.25)).resolves.toMatchObject({
        status: 'running',
        progress: 0.25,
        progressMessage: 'loading checkpoint',
      });
      await expect(waitForProgress(client, submitted.id, 0.75)).resolves.toMatchObject({
        progress: 0.75,
        progressMessage: 'reconstructing scene',
      });
      await expect(waitForTerminal(client, submitted.id)).resolves.toMatchObject({
        status: 'succeeded',
        progress: 1,
        progressMessage: 'completed',
      });
    } finally {
      await context.worker.close();
    }
  });

  it('returns a bounded runner error summary instead of only an exit code', async () => {
    const context = await fixture();
    try {
      const client = new GpuMediaWorkerClient({ baseUrl: context.baseUrl, token: TOKEN });
      const submitted = await client.submit('panoworld_reconstruct', {
        scene_id: 'failure-room',
        profile: 'single-2048',
        panoramas: [{ image_path: join(context.data, 'pano.jpg'), room_id: 'room' }],
        output_dir: context.data,
      });
      await expect(waitForTerminal(client, submitted.id)).resolves.toMatchObject({
        status: 'failed',
        error: 'GPU runner exited with code 7: PanoWorld runner error: synthetic model failure',
      });
    } finally {
      await context.worker.close();
    }
  });

  it('cancels a running avatar render', async () => {
    const context = await fixture();
    try {
      const client = new GpuMediaWorkerClient({ baseUrl: context.baseUrl, token: TOKEN });
      const submitted = await client.submit('avatar_video_render', {
        turn_id: 'turn-delay',
        audio_path: join(context.data, 'audio.wav'),
        reference_image_path: join(context.data, 'lisa.png'),
        prompt: 'Lisa répond face caméra. [delay]',
        resolution: '480p',
      });
      const cancelled = await client.cancel(submitted.id);
      expect(cancelled.status).toBe('cancelled');
      await expect(waitForTerminal(client, submitted.id)).resolves.toMatchObject({
        status: 'cancelled',
      });
    } finally {
      await context.worker.close();
    }
  });

  it('reports active jobs and available slots separately from the queued depth', async () => {
    const context = await fixture();
    try {
      const client = new GpuMediaWorkerClient({ baseUrl: context.baseUrl, token: TOKEN });
      const submitted = await client.submit('avatar_video_render', {
        turnId: 'turn-capacity',
        audioPath: join(context.data, 'audio.wav'),
        referenceImagePath: join(context.data, 'lisa.png'),
        prompt: 'Lisa répond face caméra. [delay]',
        resolution: '480p',
      });
      const deadline = Date.now() + 2_000;
      while ((await client.status(submitted.id)).status !== 'running' && Date.now() < deadline) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
      }
      await expect(client.capabilities()).resolves.toMatchObject({
        queueDepth: 0,
        activeJobs: 1,
        availableSlots: 0,
        runnerRevisions: { avatar_video_render: expect.stringMatching(/^[a-f0-9]{64}$/) },
      });
      await client.cancel(submitted.id);
    } finally {
      await context.worker.close();
    }
  });

  it('deduplicates avatar submissions by their stable turn id', async () => {
    const context = await fixture();
    try {
      const client = new GpuMediaWorkerClient({ baseUrl: context.baseUrl, token: TOKEN });
      const payload = {
        turn_id: 'turn-idempotent',
        audio_path: join(context.data, 'audio.wav'),
        reference_image_path: join(context.data, 'lisa.png'),
        prompt: 'Lisa répond face caméra. [delay]',
        resolution: '480p' as const,
        audio_sha256: createHash('sha256').update('audio').digest('hex'),
        reference_image_sha256: createHash('sha256').update('image').digest('hex'),
      };
      const first = await client.submit('avatar_video_render', payload);
      const alternateAudio = join(context.data, 'audio-copy.wav');
      const alternateImage = join(context.data, 'lisa-copy.png');
      await Promise.all([writeFile(alternateAudio, 'audio'), writeFile(alternateImage, 'image')]);
      const alternatePayload = {
        ...payload,
        audio_path: alternateAudio,
        reference_image_path: alternateImage,
      };
      const duplicate = await client.submit('avatar_video_render', alternatePayload);
      expect(duplicate.id).toBe(first.id);
      await expect(client.submit('avatar_video_render', {
        ...payload,
        prompt: 'Collision avec une autre demande.',
      })).rejects.toThrow('turnId collision');
      await client.cancel(first.id);
      const retry = await client.submit('avatar_video_render', alternatePayload, { retryTerminal: true });
      expect(retry.id).not.toBe(first.id);
      expect(retry).toMatchObject({ retryOf: first.id, attempt: 2 });
      await client.cancel(retry.id);
    } finally {
      await context.worker.close();
    }
  });

  it('downloads a completed avatar artifact through the authenticated worker', async () => {
    const context = await fixture();
    try {
      const client = new GpuMediaWorkerClient({ baseUrl: context.baseUrl, token: TOKEN });
      const submitted = await client.submit('avatar_video_render', {
        turn_id: 'turn-artifact',
        audio_path: join(context.data, 'audio.wav'),
        reference_image_path: join(context.data, 'lisa.png'),
        prompt: 'Lisa répond face caméra.',
        resolution: '480p',
      });
      await expect(waitForTerminal(client, submitted.id)).resolves.toMatchObject({
        status: 'succeeded',
      });
      const artifact = await client.downloadArtifact(submitted.id);
      expect(Buffer.from(artifact).toString('utf8')).toBe('synthetic-avatar-video');
    } finally {
      await context.worker.close();
    }
  });

  it('reloads completed jobs from the persistent store after restart', async () => {
    const context = await fixture();
    const firstClient = new GpuMediaWorkerClient({ baseUrl: context.baseUrl, token: TOKEN });
    const submitted = await firstClient.submit('panoworld_reconstruct', {
      scene_id: 'persistent-room',
      profile: 'single-2048',
      panoramas: [{ image_path: join(context.data, 'pano.jpg'), room_id: 'room' }],
      output_dir: context.data,
    });
    await expect(waitForTerminal(firstClient, submitted.id)).resolves.toMatchObject({
      status: 'succeeded',
    });
    await context.worker.close();

    const restarted = createGpuMediaWorkerServer(context.config);
    try {
      const address = await restarted.listen();
      const client = new GpuMediaWorkerClient({
        baseUrl: `http://127.0.0.1:${address.port}`,
        token: TOKEN,
      });
      await expect(client.status(submitted.id)).resolves.toMatchObject({
        id: submitted.id,
        status: 'succeeded',
        output: { artifact: 'result.bin' },
      });
    } finally {
      await restarted.close();
    }
  });
});
