import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  editImage,
  getImageEditCapabilities,
} from '../../src/tools/media-generation-tool.js';

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzTnWQAAAABJRU5ErkJggg==';
const SOURCE = `data:image/png;base64,${PIXEL}`;
const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => fs.rm(workspace, { recursive: true, force: true })));
});

describe('ComfyUI inpaint workflow', () => {
  it('uploads source+mask, injects a validated workflow, polls its bound output, and saves a confined version', async () => {
    const workspace = await temporaryWorkspace();
    const submitted: Array<{ url: string; body?: unknown }> = [];
    const workflowBundle = inpaintBundle();
    const result = await editImage({
      prompt: 'Replace the lamp with a plant',
      imageUrl: SOURCE,
      maskUrl: SOURCE,
      sourceRef: '/trusted/source.png',
    }, {
      rootDir: workspace,
      createId: () => 'inpaint-test',
      env: comfyEnv(workflowBundle),
      fetch: async (input, init) => {
        const url = String(input);
        submitted.push({ url, body: init?.body });
        if (url.endsWith('/upload/image')) {
          expect([...(init?.body as FormData).keys()]).toEqual(['image', 'type', 'overwrite']);
          return json({ name: 'codebuddy-source-inpaint-test.png', subfolder: 'codebuddy', type: 'input' });
        }
        if (url.endsWith('/upload/mask')) {
          const form = init?.body as FormData;
          expect([...(form).keys()]).toEqual(['image', 'type', 'subfolder', 'original_ref']);
          expect(String(form.get('original_ref'))).toContain('codebuddy-source-inpaint-test.png');
          return json({ name: 'codebuddy-mask-inpaint-test.png', subfolder: 'codebuddy', type: 'input' });
        }
        if (url.endsWith('/prompt')) return json({ prompt_id: 'prompt-1' });
        if (url.endsWith('/history/prompt-1')) {
          return json({
            'prompt-1': {
              status: { status_str: 'success', completed: true },
              outputs: { '9': { images: [{ filename: 'inpaint.png', subfolder: '', type: 'output' }] } },
            },
          });
        }
        if (url.includes('/view?')) return new Response(Buffer.from(PIXEL, 'base64'), { status: 200, headers: { 'Content-Type': 'image/png' } });
        return new Response('not found', { status: 404 });
      },
    });

    expect(result).toMatchObject({
      success: true,
      provider: 'comfyui',
      masked: true,
      maskMode: 'alpha',
      source: '/trusted/source.png',
    });
    expect(result.outputPath).toBe(path.join(workspace, '.codebuddy', 'media-generation', 'images', 'image-edit-inpaint-test.png'));
    await expect(fs.readFile(result.outputPath!)).resolves.toEqual(Buffer.from(PIXEL, 'base64'));

    const promptCall = submitted.find((call) => call.url.endsWith('/prompt'))!;
    const submittedBody = JSON.parse(String(promptCall.body)) as {
      prompt: Record<string, { inputs: Record<string, unknown> }>;
    };
    expect(submittedBody.prompt['1']!.inputs.image).toBe('codebuddy/codebuddy-source-inpaint-test.png');
    expect(submittedBody.prompt['2']!.inputs.image).toBe('codebuddy/codebuddy-mask-inpaint-test.png');
    expect(submittedBody.prompt['3']!.inputs.text).toBe('Replace the lamp with a plant');
    expect(submittedBody.prompt['9']!.inputs.filename_prefix).toBe('codebuddy-inpaint-inpaint-test');
    expect(JSON.stringify(submittedBody)).not.toContain('{{CODEBUDDY_');
  });

  it('accepts a private JSON workflow file and reports real masking capability without network access', async () => {
    const workspace = await temporaryWorkspace();
    const workflowPath = path.join(workspace, 'inpaint-api.json');
    await fs.writeFile(workflowPath, JSON.stringify(inpaintBundle()), { mode: 0o600 });

    await expect(getImageEditCapabilities({
      rootDir: workspace,
      env: {
        CODEBUDDY_IMAGE_PROVIDER: 'comfyui',
        CODEBUDDY_COMFYUI_INPAINT_WORKFLOW: workflowPath,
      },
    })).resolves.toEqual({ provider: 'comfyui', available: true, alphaMasking: true });

    const direct = inpaintBundle();
    await expect(getImageEditCapabilities({
      rootDir: workspace,
      env: {
        CODEBUDDY_IMAGE_PROVIDER: 'comfyui',
        CODEBUDDY_COMFYUI_INPAINT_WORKFLOW_JSON: JSON.stringify(direct.workflow),
        CODEBUDDY_COMFYUI_INPAINT_BINDINGS_JSON: JSON.stringify(direct.bindings),
      },
    })).resolves.toEqual({ provider: 'comfyui', available: true, alphaMasking: true });
  });

  it('fails closed when configuration is absent, placeholders are incompatible, or mask dataflow is disconnected', async () => {
    const workspace = await temporaryWorkspace();
    let calls = 0;
    await expect(editImage({ prompt: 'Edit', imageUrl: SOURCE, maskUrl: SOURCE }, {
      rootDir: workspace,
      env: { CODEBUDDY_IMAGE_PROVIDER: 'comfyui' },
      fetch: async () => { calls += 1; throw new Error('must not fetch'); },
    })).rejects.toThrow(/explicit inpaint workflow/i);

    const wrongPlaceholder = inpaintBundle();
    wrongPlaceholder.workflow['2']!.inputs.image = 'mask.png';
    await expect(editImage({ prompt: 'Edit', imageUrl: SOURCE, maskUrl: SOURCE }, {
      rootDir: workspace,
      env: comfyEnv(wrongPlaceholder),
      fetch: async () => { calls += 1; throw new Error('must not fetch'); },
    })).rejects.toThrow(/CODEBUDDY_MASK_IMAGE/);

    const disconnected = inpaintBundle();
    disconnected.workflow['6']!.inputs.mask = ['1', 1];
    await expect(editImage({ prompt: 'Edit', imageUrl: SOURCE, maskUrl: SOURCE }, {
      rootDir: workspace,
      env: comfyEnv(disconnected),
      fetch: async () => { calls += 1; throw new Error('must not fetch'); },
    })).rejects.toThrow(/alpha mask is not connected/i);
    expect(calls).toBe(0);
  });

  it('honors abort and bounded polling timeout', async () => {
    const workspace = await temporaryWorkspace();
    const controller = new AbortController();
    controller.abort('cancelled by caller');
    let calls = 0;
    await expect(editImage({ prompt: 'Edit', imageUrl: SOURCE, maskUrl: SOURCE }, {
      rootDir: workspace,
      env: comfyEnv(inpaintBundle()),
      signal: controller.signal,
      fetch: async () => { calls += 1; throw new Error('must not fetch'); },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(0);

    await expect(editImage({ prompt: 'Edit', imageUrl: SOURCE, maskUrl: SOURCE }, {
      rootDir: workspace,
      env: {
        ...comfyEnv(inpaintBundle()),
        CODEBUDDY_COMFYUI_INPAINT_TIMEOUT_MS: '0',
      },
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith('/upload/image')) return json({ name: 'source.png', subfolder: '', type: 'input' });
        if (url.endsWith('/upload/mask')) return json({ name: 'mask.png', subfolder: '', type: 'input' });
        if (url.endsWith('/prompt')) return json({ prompt_id: 'timeout-prompt' });
        if (url.endsWith('/history/timeout-prompt')) return json({});
        return new Response('not found', { status: 404 });
      },
    })).rejects.toThrow(/timed out/i);
  });

  it('rejects an unsafe output reference instead of requesting or writing it', async () => {
    const workspace = await temporaryWorkspace();
    let viewed = false;
    await expect(editImage({ prompt: 'Edit', imageUrl: SOURCE, maskUrl: SOURCE }, {
      rootDir: workspace,
      env: comfyEnv(inpaintBundle()),
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith('/upload/image')) return json({ name: 'source.png', subfolder: '', type: 'input' });
        if (url.endsWith('/upload/mask')) return json({ name: 'mask.png', subfolder: '', type: 'input' });
        if (url.endsWith('/prompt')) return json({ prompt_id: 'unsafe-output' });
        if (url.endsWith('/history/unsafe-output')) {
          return json({
            'unsafe-output': { outputs: { '9': { images: [{ filename: '../private.png', type: 'output' }] } } },
          });
        }
        if (url.includes('/view')) viewed = true;
        return new Response('not found', { status: 404 });
      },
    })).rejects.toThrow(/safe SaveImage output/i);
    expect(viewed).toBe(false);
  });

  it('refuses a symbolic-link output directory after a successful local workflow', async () => {
    const workspace = await temporaryWorkspace();
    const outside = await temporaryWorkspace();
    await fs.mkdir(path.join(workspace, '.codebuddy'), { recursive: true });
    await fs.symlink(outside, path.join(workspace, '.codebuddy', 'media-generation'));

    await expect(editImage({ prompt: 'Edit', imageUrl: SOURCE, maskUrl: SOURCE }, {
      rootDir: workspace,
      createId: () => 'confined',
      env: comfyEnv(inpaintBundle()),
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith('/upload/image')) return json({ name: 'source.png', subfolder: '', type: 'input' });
        if (url.endsWith('/upload/mask')) return json({ name: 'mask.png', subfolder: '', type: 'input' });
        if (url.endsWith('/prompt')) return json({ prompt_id: 'confined-output' });
        if (url.endsWith('/history/confined-output')) {
          return json({
            'confined-output': { outputs: { '9': { images: [{ filename: 'safe.png', type: 'output' }] } } },
          });
        }
        if (url.includes('/view?')) return new Response(Buffer.from(PIXEL, 'base64'), { status: 200 });
        return new Response('not found', { status: 404 });
      },
    })).rejects.toThrow(/output directory contains a symbolic link/i);
    expect(await fs.readdir(outside)).toEqual([]);
  });
});

function inpaintBundle(): {
  workflow: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  bindings: Record<string, { nodeId: string; input: string }>;
} {
  return {
    workflow: {
      '1': { class_type: 'LoadImage', inputs: { image: '{{CODEBUDDY_SOURCE_IMAGE}}' } },
      '2': { class_type: 'LoadImage', inputs: { image: '{{CODEBUDDY_MASK_IMAGE}}' } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: '{{CODEBUDDY_PROMPT}}', clip: ['5', 1] } },
      '4': { class_type: 'CLIPTextEncode', inputs: { text: '{{CODEBUDDY_NEGATIVE_PROMPT}}', clip: ['5', 1] } },
      '5': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd15-inpaint.safetensors' } },
      '6': { class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['1', 0], vae: ['5', 2], mask: ['2', 1], grow_mask_by: 6 } },
      '7': {
        class_type: 'KSampler',
        inputs: {
          seed: 1, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1,
          model: ['5', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['6', 0],
        },
      },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['5', 2] } },
      '9': { class_type: 'SaveImage', inputs: { filename_prefix: '{{CODEBUDDY_OUTPUT_PREFIX}}', images: ['8', 0] } },
    },
    bindings: {
      source: { nodeId: '1', input: 'image' },
      mask: { nodeId: '2', input: 'image' },
      prompt: { nodeId: '3', input: 'text' },
      negativePrompt: { nodeId: '4', input: 'text' },
      output: { nodeId: '9', input: 'filename_prefix' },
    },
  };
}

function comfyEnv(bundle: ReturnType<typeof inpaintBundle>): NodeJS.ProcessEnv {
  return {
    CODEBUDDY_IMAGE_PROVIDER: 'comfyui',
    COMFYUI_URL: 'http://127.0.0.1:8188',
    CODEBUDDY_IMAGE_MODEL: 'sd15-inpaint.safetensors',
    CODEBUDDY_COMFYUI_INPAINT_WORKFLOW_JSON: JSON.stringify(bundle),
    CODEBUDDY_COMFYUI_POLL_MS: '10',
  };
}

async function temporaryWorkspace(): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-comfy-inpaint-'));
  workspaces.push(workspace);
  return workspace;
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
