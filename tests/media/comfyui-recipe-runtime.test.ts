import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ComfyUIRecipeRuntime,
  ComfyUIRecipeRuntimeError,
} from '../../src/media/comfyui-recipe-runtime.js';
import { ComfyUIRecipeRegistry } from '../../src/media/comfyui-recipe-registry.js';
import { validateComfyUIRecipe, type ComfyUIRecipeRunInputs } from '../../src/media/comfyui-recipe-contract.js';
import { objectInfoFor, recipeFixture } from './comfyui-recipe-fixture.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MP4 = Uint8Array.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ComfyUI recipe runtime', () => {
  it('preflights nodes/models, submits only a registered materialized workflow, and confines fetched output', async () => {
    const recipe = validateComfyUIRecipe(recipeFixture({
      requirements: {
        models: [{
          id: 'checkpoint',
          relativePath: 'checkpoints/model.bin',
          minBytes: 4,
          sha256: createHash('sha256').update('model-data').digest('hex'),
        }],
      },
    }));
    const paths = await runtimePaths('model-data');
    let submittedWorkflow: Record<string, unknown> | undefined;
    const calls: string[] = [];
    const fetchMock = createFetchMock(async (url, init) => {
      calls.push(url.pathname);
      if (url.pathname === '/object_info') return jsonResponse(objectInfoFor(recipe));
      if (url.pathname === '/prompt') {
        const request = JSON.parse(String(init.body)) as { prompt: Record<string, unknown> };
        submittedWorkflow = request.prompt;
        return jsonResponse({ prompt_id: 'job-1' });
      }
      if (url.pathname === '/history/job-1') {
        return jsonResponse({
          'job-1': {
            status: { status_str: 'success', completed: true },
            outputs: { '4': { images: [{ filename: 'cover (1).png', subfolder: 'novel shots', type: 'output' }] } },
          },
        });
      }
      if (url.pathname === '/view') {
        expect(url.searchParams.get('filename')).toBe('cover (1).png');
        expect(url.searchParams.get('subfolder')).toBe('novel shots');
        return binaryResponse(PNG, 'image/png');
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const runtime = createRuntime([recipe], paths, fetchMock, { createClientId: () => 'client-1' });

    const result = await runtime.run('image.test', {
      prompt: 'A lighthouse in winter',
      seed: 99,
      dimensions: { width: 768, height: 512 },
    });

    expect(submittedWorkflow).toBeDefined();
    const nodes = submittedWorkflow as Record<string, { inputs: Record<string, unknown> }>;
    expect(nodes['1']?.inputs.text).toBe('A lighthouse in winter');
    expect(nodes['2']?.inputs).toMatchObject({ width: 768, height: 512 });
    expect(nodes['3']?.inputs.seed).toBe(99);
    expect(JSON.stringify(submittedWorkflow)).not.toContain('{{');
    expect(result.fallbackUsed).toBe(false);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.path.startsWith(`${paths.outputRoot}${path.sep}`)).toBe(true);
    expect(await readFile(result.artifacts[0]!.path)).toEqual(Buffer.from(PNG));
    expect(result.artifacts[0]?.sha256).toBe(createHash('sha256').update(PNG).digest('hex'));
    expect(calls).toEqual(['/object_info', '/prompt', '/history/job-1', '/view']);
  });

  it('selects a registered fallback when required nodes are unavailable', async () => {
    const fallback = validateComfyUIRecipe(recipeFixture({ id: 'image.fallback' }));
    const requested = validateComfyUIRecipe(recipeFixture({
      id: 'image.primary',
      workflow: { nodes: { '1': { class_type: 'UnavailableTextEncoder' } } },
      requirements: {
        nodes: [
          { classType: 'UnavailableTextEncoder' },
          { classType: 'EmptyLatentImage' },
          { classType: 'KSampler' },
          { classType: 'SaveImage' },
        ],
      },
      fallback: [{ id: 'image.fallback', reason: 'Use the local baseline' }],
    }));
    const paths = await runtimePaths('model-data');
    const fetchMock = successfulFetch(fallback, PNG);
    const runtime = createRuntime([requested, fallback], paths, fetchMock);

    const result = await runtime.run('image.primary', { prompt: 'fallback test' });
    expect(result.recipeId).toBe('image.fallback');
    expect(result.fallbackUsed).toBe(true);
  });

  it('supports declared VHS gifs video outputs with collision names and validates MP4 MIME/signature', async () => {
    const recipe = validateComfyUIRecipe(recipeFixture({
      id: 'video.test',
      modalities: ['text', 'video'],
      workflow: { nodes: { '4': { class_type: 'VHS_VideoCombine' } } },
      requirements: {
        nodes: [
          { classType: 'CLIPTextEncode' },
          { classType: 'EmptyLatentImage' },
          { classType: 'KSampler' },
          { classType: 'VHS_VideoCombine' },
        ],
      },
      outputs: [{ id: 'movie', type: 'video', nodeId: '4', field: 'gifs', maxBytes: 1024 }],
    }));
    const paths = await runtimePaths('model-data');
    const fetchMock = createFetchMock(async (url) => {
      if (url.pathname === '/object_info') return jsonResponse(objectInfoFor(recipe));
      if (url.pathname === '/prompt') return jsonResponse({ prompt_id: 'video-job' });
      if (url.pathname === '/history/video-job') {
        return jsonResponse({
          'video-job': {
            status: { status_str: 'success', completed: true },
            outputs: { '4': { gifs: [{ filename: 'trailer (2).mp4', subfolder: 'VHS exports', type: 'output' }] } },
          },
        });
      }
      if (url.pathname === '/view') return binaryResponse(MP4, 'video/mp4');
      throw new Error(`Unexpected URL ${url}`);
    });
    const runtime = createRuntime([recipe], paths, fetchMock);

    const result = await runtime.run('video.test', { prompt: 'A cinematic reveal' });
    expect(result.artifacts[0]).toMatchObject({ type: 'video', mimeType: 'video/mp4', bytes: MP4.length });
    expect(result.artifacts[0]?.path.endsWith('.mp4')).toBe(true);
  });

  it('rejects unsafe history paths and MIME mismatches before saving outside the output root', async () => {
    const recipe = validateComfyUIRecipe(recipeFixture());
    const paths = await runtimePaths('model-data');
    const calls: string[] = [];
    const unsafeFetch = createFetchMock(async (url) => {
      calls.push(url.pathname);
      if (url.pathname === '/object_info') return jsonResponse(objectInfoFor(recipe));
      if (url.pathname === '/prompt') return jsonResponse({ prompt_id: 'unsafe-job' });
      if (url.pathname === '/history/unsafe-job') {
        return jsonResponse({
          'unsafe-job': {
            status: { status_str: 'success', completed: true },
            outputs: { '4': { images: [{ filename: '../escape.png', subfolder: '', type: 'output' }] } },
          },
        });
      }
      if (url.pathname === '/queue') return jsonResponse({});
      throw new Error(`Unexpected URL ${url}`);
    });
    const unsafeRuntime = createRuntime([recipe], paths, unsafeFetch);
    await expect(unsafeRuntime.run('image.test', { prompt: 'unsafe' })).rejects.toMatchObject({
      code: 'UNSAFE_OUTPUT',
    });
    expect(calls).not.toContain('/view');

    const mismatchFetch = createFetchMock(async (url) => {
      if (url.pathname === '/object_info') return jsonResponse(objectInfoFor(recipe));
      if (url.pathname === '/prompt') return jsonResponse({ prompt_id: 'mime-job' });
      if (url.pathname === '/history/mime-job') {
        return jsonResponse({
          'mime-job': {
            status: { status_str: 'success', completed: true },
            outputs: { '4': { images: [{ filename: 'image.png', subfolder: '', type: 'output' }] } },
          },
        });
      }
      if (url.pathname === '/view') return binaryResponse(PNG, 'text/html');
      if (url.pathname === '/queue') return jsonResponse({});
      throw new Error(`Unexpected URL ${url}`);
    });
    const mismatchRuntime = createRuntime([recipe], paths, mismatchFetch);
    await expect(mismatchRuntime.run('image.test', { prompt: 'mime' })).rejects.toMatchObject({
      code: 'UNSAFE_OUTPUT',
    });
  });

  it('rejects linked models during preflight and never submits a prompt', async () => {
    const recipe = validateComfyUIRecipe(recipeFixture());
    const paths = await runtimePaths(undefined);
    const outside = path.join(paths.base, 'outside-model.bin');
    await writeFile(outside, 'model-data');
    await symlink(outside, path.join(paths.modelsRoot, 'checkpoints', 'model.bin'));
    const calls: string[] = [];
    const fetchMock = createFetchMock(async (url) => {
      calls.push(url.pathname);
      if (url.pathname === '/object_info') return jsonResponse(objectInfoFor(recipe));
      throw new Error(`Unexpected URL ${url}`);
    });
    const runtime = createRuntime([recipe], paths, fetchMock);

    const result = await runtime.preflight('image.test');
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unsafe-model' })]));
    expect(calls).toEqual(['/object_info']);
  });

  it('bounds ignored network aborts and cancels its own queued prompt on user abort', async () => {
    const recipe = validateComfyUIRecipe(recipeFixture());
    const paths = await runtimePaths('model-data');
    const neverFetch = createFetchMock(async () => new Promise<Response>(() => undefined));
    const timedRuntime = createRuntime([recipe], paths, neverFetch, {
      limits: { requestTimeoutMs: 20, maxRunMs: 100, pollIntervalMs: 5 },
    });
    await expect(timedRuntime.preflight('image.test')).rejects.toMatchObject({ code: 'NETWORK_TIMEOUT' });

    const calls: string[] = [];
    const abortFetch = createFetchMock(async (url) => {
      calls.push(url.pathname);
      if (url.pathname === '/object_info') return jsonResponse(objectInfoFor(recipe));
      if (url.pathname === '/prompt') return jsonResponse({ prompt_id: 'abort-job' });
      if (url.pathname === '/history/abort-job') return jsonResponse({});
      if (url.pathname === '/queue') return new Response(null, { status: 200 });
      throw new Error(`Unexpected URL ${url}`);
    });
    const abortRuntime = createRuntime([recipe], paths, abortFetch, {
      limits: { requestTimeoutMs: 100, maxRunMs: 1000, pollIntervalMs: 50 },
    });
    const controller = new AbortController();
    const run = abortRuntime.run('image.test', { prompt: 'abort me' }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(run).rejects.toMatchObject({ code: 'ABORTED' });
    expect(calls).toContain('/queue');
  });

  it('uploads images and masks with bounded bytes, validated collision names, and original_ref', async () => {
    const recipe = validateComfyUIRecipe(recipeFixture());
    const paths = await runtimePaths('model-data');
    let maskOriginalRef: string | null = null;
    let maskSubfolder: string | null = null;
    const fetchMock = createFetchMock(async (url, init) => {
      const form = init.body as FormData;
      if (url.pathname === '/upload/image') {
        expect(form.get('overwrite')).toBe('false');
        return jsonResponse({ name: 'source (1).png', subfolder: 'novel refs', type: 'input' });
      }
      if (url.pathname === '/upload/mask') {
        maskOriginalRef = String(form.get('original_ref'));
        maskSubfolder = String(form.get('subfolder'));
        return jsonResponse({ name: 'mask (2).png', subfolder: 'novel refs', type: 'input' });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    const runtime = createRuntime([recipe], paths, fetchMock);
    const source = await runtime.uploadImage({
      bytes: PNG,
      filename: 'source.png',
      mimeType: 'image/png',
    });
    expect(source.workflowPath).toBe('novel refs/source (1).png');

    const mask = await runtime.uploadMask({
      bytes: PNG,
      filename: 'mask.png',
      mimeType: 'image/png',
      originalRef: source,
    });
    expect(mask.workflowPath).toBe('novel refs/mask (2).png');
    expect(maskSubfolder).toBe('novel refs');
    expect(JSON.parse(maskOriginalRef ?? '{}')).toEqual({
      filename: 'source (1).png',
      subfolder: 'novel refs',
      type: 'input',
    });
  });

  it('does not accept an ad-hoc workflow in run inputs and blocks untrusted remote endpoints', async () => {
    const recipe = validateComfyUIRecipe(recipeFixture());
    const paths = await runtimePaths('model-data');
    const calls: string[] = [];
    const fetchMock = createFetchMock(async (url) => {
      calls.push(url.pathname);
      if (url.pathname === '/object_info') return jsonResponse(objectInfoFor(recipe));
      throw new Error(`Unexpected URL ${url}`);
    });
    const runtime = createRuntime([recipe], paths, fetchMock);
    const maliciousInputs = {
      prompt: 'legitimate prompt',
      workflow: { '666': { class_type: 'ExecuteAnything', inputs: {} } },
    } as unknown as ComfyUIRecipeRunInputs;
    await expect(runtime.run('image.test', maliciousInputs)).rejects.toThrow(/Unknown recipe input: workflow/);
    expect(calls).toEqual(['/object_info']);

    expect(() => new ComfyUIRecipeRuntime({
      registry: new ComfyUIRecipeRegistry([recipe]),
      baseUrl: 'http://attacker.invalid:8188',
      modelsRoot: paths.modelsRoot,
      outputRoot: paths.outputRoot,
    })).toThrow(ComfyUIRecipeRuntimeError);
  });
});

interface RuntimePaths {
  base: string;
  modelsRoot: string;
  outputRoot: string;
}

async function runtimePaths(modelContents: string | undefined): Promise<RuntimePaths> {
  const base = await mkdtemp(path.join(tmpdir(), 'codebuddy-comfy-runtime-'));
  temporaryRoots.push(base);
  const modelsRoot = path.join(base, 'models');
  const outputRoot = path.join(base, 'outputs');
  await mkdir(path.join(modelsRoot, 'checkpoints'), { recursive: true });
  if (modelContents !== undefined) {
    await writeFile(path.join(modelsRoot, 'checkpoints', 'model.bin'), modelContents);
  }
  return { base, modelsRoot, outputRoot };
}

function createRuntime(
  recipes: readonly unknown[],
  paths: RuntimePaths,
  fetchImpl: typeof fetch,
  overrides: Partial<ConstructorParameters<typeof ComfyUIRecipeRuntime>[0]> = {},
): ComfyUIRecipeRuntime {
  return new ComfyUIRecipeRuntime({
    registry: new ComfyUIRecipeRegistry(recipes),
    baseUrl: 'http://127.0.0.1:8188',
    modelsRoot: paths.modelsRoot,
    outputRoot: paths.outputRoot,
    fetchImpl,
    limits: { requestTimeoutMs: 1000, maxRunMs: 5000, pollIntervalMs: 1 },
    ...overrides,
  });
}

function successfulFetch(recipe: ReturnType<typeof validateComfyUIRecipe>, bytes: Uint8Array): typeof fetch {
  return createFetchMock(async (url) => {
    if (url.pathname === '/object_info') return jsonResponse(objectInfoFor(recipe));
    if (url.pathname === '/prompt') return jsonResponse({ prompt_id: 'fallback-job' });
    if (url.pathname === '/history/fallback-job') {
      return jsonResponse({
        'fallback-job': {
          status: { status_str: 'success', completed: true },
          outputs: { '4': { images: [{ filename: 'fallback.png', subfolder: '', type: 'output' }] } },
        },
      });
    }
    if (url.pathname === '/view') return binaryResponse(bytes, 'image/png');
    throw new Error(`Unexpected URL ${url}`);
  });
}

function createFetchMock(
  handler: (url: URL, init: RequestInit) => Promise<Response>,
): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const rawUrl = input instanceof Request ? input.url : input.toString();
    return handler(new URL(rawUrl), init ?? {});
  }) as unknown as typeof fetch;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function binaryResponse(bytes: Uint8Array, contentType: string): Response {
  const copy = Uint8Array.from(bytes);
  return new Response(new Blob([copy], { type: contentType }), {
    status: 200,
    headers: { 'content-type': contentType, 'content-length': String(copy.byteLength) },
  });
}
