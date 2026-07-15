import { describe, expect, it, vi } from 'vitest';

import {
  GpuMediaWorkerClient,
  parseAvatarVideoPayload,
  parsePanoWorldPayload,
  validateGpuWorkerUrl,
} from '../../src/tools/gpu-media-worker.js';
import { MULTIMODAL_TOOLS } from '../../src/codebuddy/tool-definitions/multimodal-tools.js';
import { createMultimodalTools } from '../../src/tools/registry/multimodal-tools.js';

function jobResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      id: 'job-123',
      kind: 'panoworld_reconstruct',
      status: 'queued',
      ...overrides,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

describe('gpu media worker contracts', () => {
  it('is exposed to the model and dispatch registry', () => {
    expect(MULTIMODAL_TOOLS.some((tool) => tool.function.name === 'gpu_media_job')).toBe(true);
    expect(createMultimodalTools().some((tool) => tool.name === 'gpu_media_job')).toBe(true);
  });

  it('allows private/Tailscale HTTP but rejects public clear-text endpoints', () => {
    expect(validateGpuWorkerUrl('http://100.73.222.64:4310').hostname).toBe('100.73.222.64');
    expect(validateGpuWorkerUrl('http://darkstar.tail-example.ts.net:4310').protocol).toBe('http:');
    expect(() => validateGpuWorkerUrl('http://example.com:4310')).toThrow(/Unencrypted/);
    expect(validateGpuWorkerUrl('https://gpu.example.com').protocol).toBe('https:');
  });

  it('bounds PanoWorld profiles to the measured Darkstar targets', () => {
    const single = parsePanoWorldPayload({
      scene_id: 'kitchen',
      profile: 'single-2048',
      panoramas: [{ image_path: 'D:\\captures\\kitchen.jpg', room_id: 'kitchen' }],
      output_dir: 'D:\\DEV\\PanoWorld\\outputs\\kitchen',
    });
    expect(single).toMatchObject({ sceneId: 'kitchen', profile: 'single-2048' });
    expect(single.panoramas).toHaveLength(1);

    expect(() =>
      parsePanoWorldPayload({
        scene_id: 'house',
        profile: 'multi-1024',
        panoramas: Array.from({ length: 6 }, (_, index) => ({
          image_path: `D:\\captures\\${index}.jpg`,
          room_id: 'house',
        })),
        output_dir: 'D:\\outputs',
      })
    ).toThrow(/at most 5/);
  });

  it('requires a complete camera matrix when one is supplied', () => {
    expect(() =>
      parsePanoWorldPayload({
        scene_id: 'room',
        profile: 'single-2048',
        panoramas: [{ image_path: '/data/pano.jpg', room_id: 'room', camera_to_world: [1, 0] }],
        output_dir: '/data/out',
      })
    ).toThrow(/16 finite numbers/);
  });

  it('keeps LongCat asynchronous rendering on the 480p profile', () => {
    expect(
      parseAvatarVideoPayload({
        turn_id: 'turn-1',
        audio_path: 'D:\\lisa\\turn-1.wav',
        reference_image_path: 'D:\\lisa\\portrait.png',
        prompt: 'Lisa répond calmement face caméra.',
        channel_target: { channel: 'telegram', conversation_id: 'patrice' },
      })
    ).toMatchObject({
      turnId: 'turn-1',
      resolution: '480p',
      channelTarget: { channel: 'telegram', conversationId: 'patrice' },
    });
    expect(() =>
      parseAvatarVideoPayload({
        turn_id: 'turn-2',
        audio_path: '/tmp/audio.wav',
        reference_image_path: '/tmp/lisa.png',
        prompt: 'test',
        resolution: '720p',
      })
    ).toThrow(/480p/);
  });

  it('submits a validated job without placing the token in the body', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jobResponse());
    const client = new GpuMediaWorkerClient(
      { baseUrl: 'http://100.73.222.64:4310', token: 'secret-token' },
      { fetch: fetchMock }
    );

    const job = await client.submit('panoworld_reconstruct', {
      scene_id: 'room',
      profile: 'single-2048',
      panoramas: [{ image_path: 'D:\\captures\\room.jpg', room_id: 'room' }],
      output_dir: 'D:\\outputs\\room',
    });

    expect(job).toMatchObject({ id: 'job-123', status: 'queued' });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.headers).toMatchObject({ authorization: 'Bearer secret-token' });
    expect(String(init?.body)).not.toContain('secret-token');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      kind: 'panoworld_reconstruct',
      payload: { sceneId: 'room', profile: 'single-2048' },
    });
  });

  it('validates job ids before issuing status requests', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jobResponse());
    const client = new GpuMediaWorkerClient(
      { baseUrl: 'https://gpu.example.com' },
      { fetch: fetchMock }
    );
    await expect(client.status('../escape')).rejects.toThrow(/invalid characters/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an avatar artifact that exceeds its declared response length', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('too-long', {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': '2' },
      })
    );
    const client = new GpuMediaWorkerClient(
      { baseUrl: 'https://gpu.example.com' },
      { fetch: fetchMock }
    );
    await expect(client.downloadArtifact('job-123')).rejects.toThrow(/exceeds its declared/);
  });

  it('reads worker capabilities and queue state', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          protocolVersion: 1,
          workerId: 'darkstar',
          jobs: ['panoworld_reconstruct', 'avatar_video_render'],
          gpus: [{ name: 'RTX 3090', vramMb: 24_576, busy: false }],
          queueDepth: 0,
        }),
        { status: 200 }
      )
    );
    const client = new GpuMediaWorkerClient(
      { baseUrl: 'http://100.73.222.64:4310' },
      { fetch: fetchMock }
    );
    await expect(client.capabilities()).resolves.toMatchObject({
      workerId: 'darkstar',
      queueDepth: 0,
    });
  });
});
