import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComfyLabService } from '../src/main/comfy-lab/comfy-lab-service';

const roots: string[] = [];

async function makeComfyRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'comfy-lab-'));
  roots.push(root);
  await Promise.all([
    mkdir(join(root, 'models', 'checkpoints'), { recursive: true }),
    mkdir(join(root, 'models', 'diffusion_models'), { recursive: true }),
    mkdir(join(root, 'models', 'audio'), { recursive: true }),
    mkdir(join(root, 'workflows'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, 'main.py'), '# local fixture\n'),
    writeFile(join(root, 'models', 'checkpoints', 'sd_turbo.safetensors'), 'image-model'),
    writeFile(join(root, 'models', 'checkpoints', 'empty-checkpoint.safetensors'), ''),
    writeFile(join(root, 'models', 'diffusion_models', 'Wan2.1-T2V.gguf'), 'wan-model'),
    writeFile(join(root, 'models', 'audio', 'ace-step-zero.safetensors'), ''),
    writeFile(join(root, 'workflows', 'flux_storyboard.json'), '{}'),
    writeFile(join(root, 'workflows', 'wan_animatic.json'), '{}'),
  ]);
  return root;
}

function localFetcher(nodes: string[] = []): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/system_stats')) {
      return new Response(JSON.stringify({
        system: { comfyui_version: '0.22.0' },
        devices: [{ name: 'cpu', type: 'cpu' }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(Object.fromEntries(nodes.map((node) => [node, {}]))), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ComfyLabService', () => {
  it('derives prioritized readiness from non-empty models, templates, and loopback nodes', async () => {
    const root = await makeComfyRoot();
    const fetcher = localFetcher([
      'CheckpointLoaderSimple',
      'KSampler',
      'WanVideoModelLoader',
      'WanVideoSampler',
      'TextEncodeAceStepAudio',
      'Hunyuan3Dv2Conditioning',
    ]);
    const service = new ComfyLabService({
      environment: { COMFYUI_ROOT: root, COMFYUI_PORT: '8188' },
      fetcher,
      now: () => new Date('2026-07-12T12:00:00.000Z'),
    });

    const snapshot = await service.inspect();

    expect(snapshot).toMatchObject({
      generatedAt: '2026-07-12T12:00:00.000Z',
      installation: { found: true, source: 'COMFYUI_ROOT' },
      probe: {
        state: 'reachable',
        url: 'http://127.0.0.1:8188',
        comfyuiVersion: '0.22.0',
        device: { name: 'cpu', type: 'cpu' },
        cpuFallback: true,
      },
      inventory: { modelFiles: 2, templates: 2 },
      safety: { localOnly: true, implicitDownloads: false, implicitExecution: false },
    });
    expect(snapshot.useCases.map((useCase) => useCase.priority)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(snapshot.useCases.find((useCase) => useCase.id === 'book-visuals')?.readiness).toBe('ready');
    expect(snapshot.useCases.find((useCase) => useCase.id === 'book-visuals')?.readinessReason)
      .toMatch(/fallback CPU/i);
    expect(snapshot.useCases.find((useCase) => useCase.id === 'wan-animatic')?.readiness).toBe('ready');
    expect(snapshot.useCases.find((useCase) => useCase.id === 'ace-music')).toMatchObject({
      readiness: 'partial',
      readinessReason: expect.stringMatching(/modèle ACE-Step/i),
    });
    expect(snapshot.useCases.find((useCase) => useCase.id === 'three-d')?.readiness).toBe('partial');
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, options] of (fetcher as ReturnType<typeof vi.fn>).mock.calls) {
      expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:8188\/(system_stats|object_info)$/u);
      expect(options).toMatchObject({ method: 'GET', redirect: 'error' });
    }
  });

  it('reports missing capabilities without silently accepting an invalid COMFYUI_ROOT', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('connection refused');
    }) as typeof fetch;
    const service = new ComfyLabService({
      environment: { COMFYUI_ROOT: 'relative/attacker-root', COMFYUI_PORT: 'https://remote.test' },
      homeDirectory: '/definitely-missing',
      fetcher,
    });

    const snapshot = await service.inspect();

    expect(snapshot.installation).toMatchObject({ found: false, source: 'COMFYUI_ROOT' });
    expect(snapshot.probe).toMatchObject({ state: 'unreachable', url: 'http://127.0.0.1:8188' });
    expect(snapshot.useCases.every((useCase) => useCase.readiness === 'missing')).toBe(true);
  });

  it('only opens fixed loopback and copies a main-process-derived manual plan', async () => {
    const root = await makeComfyRoot();
    const openExternal = vi.fn(async () => undefined);
    const writeClipboard = vi.fn();
    const service = new ComfyLabService({
      environment: { COMFYUI_ROOT: root, COMFYUI_PORT: '9191' },
      fetcher: localFetcher(['CheckpointLoaderSimple']),
      openExternal,
      writeClipboard,
    });

    await expect(service.openComfyUi()).resolves.toMatchObject({ ok: true });
    expect(openExternal).toHaveBeenCalledWith('http://127.0.0.1:9191');

    const copied = await service.copyPlan('book-visuals');
    expect(copied).toMatchObject({ ok: true, plan: expect.stringMatching(/Plan ComfyUI — Couvertures/) });
    expect(writeClipboard).toHaveBeenCalledWith(expect.stringContaining('ne télécharge rien'));
    expect(writeClipboard).toHaveBeenCalledWith(expect.stringContaining('Licence'));
  });

  it('bounds a stalled loopback probe', async () => {
    const fetcher = vi.fn((_input: string | URL | Request, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })
    )) as typeof fetch;
    const service = new ComfyLabService({
      environment: {},
      homeDirectory: '/definitely-missing',
      fetcher,
      probeTimeoutMs: 250,
    });

    const startedAt = Date.now();
    const snapshot = await service.inspect();

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(snapshot.probe.state).toBe('unreachable');
  });
});
