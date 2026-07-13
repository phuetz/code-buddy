import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { editImage } from '../../src/tools/media-generation-tool.js';
import { ImageEditTool } from '../../src/tools/registry/multimodal-tools.js';

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzTnWQAAAABJRU5ErkJggg==';
const SOURCE = `data:image/png;base64,${PIXEL}`;
const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => fs.rm(workspace, { recursive: true, force: true })));
});

describe('editImage', () => {
  it('sends xAI its documented JSON edit request and preserves normalized selections', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-image-edit-'));
    workspaces.push(workspace);
    let captured: Record<string, unknown> | undefined;
    const result = await editImage({
      prompt: 'Change the sofa to sage green',
      imageUrl: SOURCE,
      selections: [{ x: -1, y: 0.25, width: 0.4, height: 2 }],
    }, {
      rootDir: workspace,
      createId: () => 'xai-selection',
      env: {
        CODEBUDDY_IMAGE_PROVIDER: 'xai',
        CODEBUDDY_IMAGE_BASE_URL: 'https://api.x.ai/v1',
        CODEBUDDY_IMAGE_API_KEY: 'test-key',
        CODEBUDDY_IMAGE_MODEL: 'grok-imagine-image-quality',
      },
      fetch: async (_url, init) => {
        captured = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ data: [{ b64_json: PIXEL }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    expect(result).toMatchObject({
      kind: 'image_edit_result',
      success: true,
      provider: 'xai',
      masked: false,
      selections: [{ x: 0, y: 0.25, width: 0.4, height: 0.75 }],
    });
    expect(captured).toMatchObject({
      model: 'grok-imagine-image-quality',
      image: { url: SOURCE, type: 'image_url' },
    });
    expect(String(captured?.prompt)).toContain('0.0000,0.2500,0.4000,0.7500');
    await expect(fs.stat(result.outputPath!)).resolves.toMatchObject({ mode: expect.any(Number) });
  });

  it('sends an alpha mask as multipart data to OpenAI', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-image-mask-'));
    workspaces.push(workspace);
    let fields: string[] = [];
    const result = await editImage({
      prompt: 'Replace only this object',
      imageUrl: SOURCE,
      maskUrl: SOURCE,
    }, {
      rootDir: workspace,
      createId: () => 'openai-mask',
      env: {
        CODEBUDDY_IMAGE_PROVIDER: 'openai',
        CODEBUDDY_IMAGE_BASE_URL: 'https://api.openai.com/v1',
        CODEBUDDY_IMAGE_API_KEY: 'test-key',
        CODEBUDDY_IMAGE_MODEL: 'gpt-image-2',
      },
      fetch: async (_url, init) => {
        const form = init?.body as FormData;
        fields = [...form.keys()];
        return new Response(JSON.stringify({ data: [{ b64_json: PIXEL }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    expect(fields).toEqual(['model', 'prompt', 'image[]', 'mask']);
    expect(result.masked).toBe(true);
    expect(result.maskMode).toBe('alpha');
    expect(result.outputPath).toContain('image-edit-openai-mask.png');
  });

  it('does not claim an alpha mask was applied by xAI', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-image-xai-mask-'));
    workspaces.push(workspace);
    const result = await editImage({
      prompt: 'Change this region',
      imageUrl: SOURCE,
      maskUrl: SOURCE,
      selections: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }],
    }, {
      rootDir: workspace,
      env: {
        CODEBUDDY_IMAGE_PROVIDER: 'xai',
        CODEBUDDY_IMAGE_BASE_URL: 'https://api.x.ai/v1',
        CODEBUDDY_IMAGE_API_KEY: 'test-key',
      },
      fetch: async () => new Response(JSON.stringify({ data: [{ b64_json: PIXEL }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    expect(result).toMatchObject({ masked: false, maskMode: 'region-prompt' });
  });

  it('rejects an HTTPS source early for the OpenAI multipart contract', async () => {
    await expect(editImage({ prompt: 'Edit', imageUrl: 'https://example.com/source.png' }, {
      env: {
        CODEBUDDY_IMAGE_PROVIDER: 'openai',
        CODEBUDDY_IMAGE_BASE_URL: 'https://api.openai.com/v1',
        CODEBUDDY_IMAGE_API_KEY: 'test-key',
      },
      fetch: async () => { throw new Error('must not fetch'); },
    })).rejects.toThrow(/require a bounded image data URL/);
  });

  it('fails closed for local ComfyUI without an explicit inpaint workflow', async () => {
    await expect(editImage({ prompt: 'edit', imageUrl: SOURCE }, {
      env: { CODEBUDDY_IMAGE_PROVIDER: 'comfyui' },
    })).rejects.toThrow(/explicit inpaint workflow/);
  });

  it('exposes a workspace-confined agent tool and never overwrites its source', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codebuddy-image-edit-tool-'));
    workspaces.push(workspace);
    const sourcePath = path.join(workspace, 'source.png');
    await fs.writeFile(sourcePath, Buffer.from(PIXEL, 'base64'));
    const tool = new ImageEditTool({
      rootDir: workspace,
      createId: () => 'tool-edit',
      env: {
        CODEBUDDY_IMAGE_PROVIDER: 'xai',
        CODEBUDDY_IMAGE_BASE_URL: 'https://api.x.ai/v1',
        CODEBUDDY_IMAGE_API_KEY: 'test-key',
      },
      fetch: async () => new Response(JSON.stringify({ data: [{ b64_json: PIXEL }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const result = await tool.execute({ prompt: 'Add a lamp', image_path: 'source.png' }, { cwd: workspace });
    expect(result.success, result.error).toBe(true);
    await expect(fs.readFile(sourcePath)).resolves.toEqual(Buffer.from(PIXEL, 'base64'));
    const output = JSON.parse(result.output!) as { outputPath: string };
    expect(output.outputPath).not.toBe(sourcePath);

    const escaped = await tool.execute({ prompt: 'Edit', image_path: '../outside.png' }, { cwd: workspace });
    expect(escaped.success).toBe(false);
  });
});
