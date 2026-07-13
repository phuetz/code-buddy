import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMFY_RECIPE_TOOL } from '../../src/codebuddy/tool-definitions/comfy-recipe-tools.js';
import type {
  ComfyUIPreflightResult,
  ComfyUIRecipeRunResult,
  ComfyUIRecipeRuntimeOptions,
} from '../../src/media/comfyui-recipe-runtime.js';
import { ComfyRecipeTool } from '../../src/tools/comfy-recipe-tool.js';
import { TOOL_METADATA } from '../../src/tools/metadata.js';
import { createInteractiveToolAdapters } from '../../src/tools/registry/interactive-adapters.js';
import { createComfyRecipeTools } from '../../src/tools/registry/comfy-recipe-tools.js';
import { recipeFixture } from '../media/comfyui-recipe-fixture.js';

process.env.CODEBUDDY_LOAD_AUTHORED_TOOLS = 'false';

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('comfy_recipe contract and registry wiring', () => {
  it('exposes the intentionally narrow surface everywhere', async () => {
    const tool = new ComfyRecipeTool();
    expect(tool.getSchema().parameters.required).toEqual(['action', 'commercial_use']);
    expect(Object.keys(tool.getSchema().parameters.properties ?? {})).not.toEqual(expect.arrayContaining([
      'workflow', 'workflow_path', 'image_path', 'mask_path', 'audio_path', 'download',
    ]));
    expect(COMFY_RECIPE_TOOL.function.parameters.required).toEqual(['action', 'commercial_use']);
    expect(createComfyRecipeTools().map((entry) => entry.name)).toEqual(['comfy_recipe']);
    expect(createInteractiveToolAdapters({ includeWindowsTools: false, includeSelfImproveTools: false })
      .filter((entry) => entry.name === 'comfy_recipe')).toHaveLength(1);
    expect(TOOL_METADATA.find((entry) => entry.name === 'comfy_recipe')).toMatchObject({
      category: 'media',
      priority: 9,
    });
    const { getBuiltinToolNames } = await import('../../src/codebuddy/tools.js');
    expect(getBuiltinToolNames()).toContain('comfy_recipe');
  });

  it('requires explicit commercial intent and rejects undeclared/path upload inputs', () => {
    const tool = new ComfyRecipeTool();
    expect(tool.validate({ action: 'list' }).valid).toBe(false);
    expect(tool.validate({ action: 'run', commercial_use: false, recipe_id: 'image.test', prompt: 'cover' }).valid).toBe(true);
    expect(tool.validate({
      action: 'run',
      commercial_use: false,
      recipe_id: 'image.test',
      prompt: 'cover',
      workflow: {},
      image_path: '/tmp/input.png',
    })).toMatchObject({ valid: false });
  });
});

describe('comfy_recipe safe execution surface', () => {
  it('lists only bounded recipe summaries without exposing workflow bodies or source paths', async () => {
    const fixture = await setupFixture();
    const runtimeFactory = vi.fn();
    const tool = new ComfyRecipeTool({
      environment: fixture.environment,
      homeDirectory: fixture.home,
      createRuntime: runtimeFactory,
    });

    const result = await tool.execute({ action: 'list', commercial_use: false }, { cwd: fixture.workspace });

    expect(result.success).toBe(true);
    expect(result.output).toContain('image.test@1.0.0');
    expect(JSON.stringify(result.data)).not.toContain('workflow');
    expect(JSON.stringify(result.data)).not.toContain(fixture.recipes);
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it('preflights read-only and runs only after a fresh confirmation into the fixed workspace root', async () => {
    const fixture = await setupFixture();
    const preflight = okPreflight();
    const optionsSeen: ComfyUIRecipeRuntimeOptions[] = [];
    const run = vi.fn(async (): Promise<ComfyUIRecipeRunResult> => ({
      requestedRecipeId: 'image.test',
      requestedRecipeVersion: '1.0.0',
      recipeId: 'image.test',
      recipeVersion: '1.0.0',
      fallbackUsed: false,
      promptId: 'job-1',
      clientId: 'client-1',
      seed: 9,
      artifacts: [{
        id: 'final',
        type: 'image',
        path: path.join(fixture.workspace, '.codebuddy', 'media-generation', 'recipes', 'job-1', 'final-0.png'),
        bytes: 8,
        sha256: 'a'.repeat(64),
        mimeType: 'image/png',
        source: { filename: 'final.png', subfolder: '', type: 'output' },
      }],
    }));
    const confirm = vi.fn(async () => ({ confirmed: true }));
    const tool = new ComfyRecipeTool({
      environment: fixture.environment,
      homeDirectory: fixture.home,
      confirm,
      createRuntime: (options) => {
        optionsSeen.push(options);
        return { preflight: vi.fn(async () => preflight), run, uploadImage: unreachableUpload };
      },
    });

    const checked = await tool.execute({
      action: 'preflight', commercial_use: true, recipe_id: 'image.test',
    }, { cwd: fixture.workspace });
    expect(checked.success).toBe(true);
    expect(confirm).not.toHaveBeenCalled();

    const generated = await tool.execute({
      action: 'run',
      commercial_use: false,
      recipe_id: 'image.test',
      prompt: 'A moonlit Alsatian village',
      seed: 9,
      width: 512,
      height: 512,
    }, { cwd: fixture.workspace });

    expect(generated.success).toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ forcePrompt: true }));
    expect(run).toHaveBeenCalledWith(
      { id: 'image.test' },
      expect.objectContaining({ prompt: 'A moonlit Alsatian village', seed: 9, dimensions: { width: 512, height: 512 } }),
      expect.objectContaining({ commercialUse: false, allowFallback: true }),
    );
    expect(optionsSeen.at(-1)?.modelsRoot).toBe(path.join(fixture.comfyRoot, 'models'));
    expect(optionsSeen.at(-1)?.outputRoot).toBe(path.join(
      fixture.workspace, '.codebuddy', 'media-generation', 'recipes',
    ));
    expect((generated.data as ComfyUIRecipeRunResult).artifacts[0]?.path).toBe(
      path.join('.codebuddy', 'media-generation', 'recipes', 'job-1', 'final-0.png'),
    );
  });

  it('never runs after denial and keeps mask/audio input recipes blocked', async () => {
    const fixture = await setupFixture();
    const run = vi.fn();
    const denied = new ComfyRecipeTool({
      environment: fixture.environment,
      homeDirectory: fixture.home,
      confirm: async () => ({ confirmed: false, feedback: 'No' }),
      createRuntime: () => ({ preflight: async () => okPreflight(), run, uploadImage: unreachableUpload }),
    });
    const result = await denied.execute({
      action: 'run', commercial_use: false, recipe_id: 'image.test', prompt: 'cover',
    }, { cwd: fixture.workspace });
    expect(result).toMatchObject({ success: false, error: 'No' });
    expect(run).not.toHaveBeenCalled();

    await writeFile(path.join(fixture.recipes, 'asset.json'), JSON.stringify(recipeFixture({
      id: 'image.masked',
      workflow: { nodes: {
        '3': { inputs: { source: ['5', 0] } },
        '5': { class_type: 'LoadImage', inputs: { image: '{{mask}}' } },
      } },
      requirements: { nodes: [
        { classType: 'CLIPTextEncode' },
        { classType: 'EmptyLatentImage' },
        { classType: 'KSampler' },
        { classType: 'SaveImage' },
        { classType: 'LoadImage' },
      ] },
      bindings: {
        mask: { nodeId: '5', input: 'image', required: true },
      },
    })), 'utf8');
    const blocked = await denied.execute({
      action: 'preflight', commercial_use: false, recipe_id: 'image.masked',
    }, { cwd: fixture.workspace });
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain('mask or audio input');
  });

  it('uploads a verified declared reference after confirmation and uses the collision-renamed Comfy reference', async () => {
    const fixture = await setupFixture();
    await installImageBindingRecipe(fixture);
    await mkdir(path.join(fixture.workspace, 'avatars'), { recursive: true });
    const sourceBytes = validPngBytes();
    await writeFile(path.join(fixture.workspace, 'avatars', 'buddy.png'), sourceBytes);
    const digest = createHash('sha256').update(sourceBytes).digest('hex');
    const uploadSubfolder = 'codebuddy-references/test-run-token-0001';
    const uploadedFilename = `source-${digest.slice(0, 16)} (1).png`;
    const uploadedPath = path.join(fixture.comfyRoot, 'input', uploadSubfolder, uploadedFilename);
    const uploadImage = vi.fn(async (upload: { bytes: Uint8Array }) => {
      await writeFile(uploadedPath, upload.bytes);
      return {
        filename: uploadedFilename,
        subfolder: uploadSubfolder,
        type: 'input' as const,
        workflowPath: `${uploadSubfolder}/${uploadedFilename}`,
      };
    });
    const run = vi.fn(async (): Promise<ComfyUIRecipeRunResult> => emptyRunResult());
    const confirm = vi.fn(async () => ({ confirmed: true }));
    const tool = new ComfyRecipeTool({
      environment: fixture.environment,
      homeDirectory: fixture.home,
      confirm,
      createUploadToken: () => 'test-run-token-0001',
      createRuntime: () => ({ preflight: async () => okPreflight('image.asset'), run, uploadImage }),
    });

    const result = await tool.execute({
      action: 'run',
      commercial_use: false,
      recipe_id: 'image.asset',
      prompt: 'Code Buddy reading beside the fireplace',
      reference_images: [{ id: 'source', path: 'avatars/buddy.png' }],
    }, { cwd: fixture.workspace });

    expect(result.success).toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      filename: path.join('.codebuddy', 'media-generation', 'recipes'),
      forcePrompt: true,
      content: expect.stringContaining(`source: avatars/buddy.png (${sourceBytes.length} bytes, SHA-256 ${digest})`),
    }));
    expect(JSON.stringify(confirm.mock.calls)).not.toContain(fixture.workspace);
    expect(uploadImage).toHaveBeenCalledWith(expect.objectContaining({
      bytes: sourceBytes,
      filename: `source-${digest.slice(0, 16)}.png`,
      mimeType: 'image/png',
      subfolder: uploadSubfolder,
    }), undefined);
    expect(run).toHaveBeenCalledWith(
      { id: 'image.asset' },
      expect.objectContaining({
        images: { source: `${uploadSubfolder}/${uploadedFilename}` },
      }),
      expect.any(Object),
    );
    expect((result.data as { uploadCleanup: unknown }).uploadCleanup).toEqual({
      removed: 1,
      retainedReferences: [],
    });
    await expect(access(uploadedPath)).rejects.toThrow();
  });

  it('rejects duplicate, traversal, unknown, and missing reference bindings before upload', async () => {
    const fixture = await setupFixture();
    await installImageBindingRecipe(fixture);
    const runtimeFactory = vi.fn();
    const tool = new ComfyRecipeTool({
      environment: fixture.environment,
      homeDirectory: fixture.home,
      createRuntime: runtimeFactory,
    });

    expect(tool.validate({
      action: 'run', commercial_use: false, recipe_id: 'image.asset', prompt: 'avatar',
      reference_images: [{ id: 'source', path: '../secret.png' }],
    })).toMatchObject({ valid: false });
    expect(tool.validate({
      action: 'run', commercial_use: false, recipe_id: 'image.asset', prompt: 'avatar',
      reference_images: [{ id: 'source', path: 'a.png' }, { id: 'source', path: 'b.png' }],
    })).toMatchObject({ valid: false });

    const missing = await tool.execute({
      action: 'run', commercial_use: false, recipe_id: 'image.asset', prompt: 'avatar',
    }, { cwd: fixture.workspace });
    expect(missing.error).toContain('Missing required recipe image: source');

    const unknown = await tool.execute({
      action: 'run', commercial_use: false, recipe_id: 'image.asset', prompt: 'avatar',
      reference_images: [{ id: 'other', path: 'avatar.png' }],
    }, { cwd: fixture.workspace });
    expect(unknown.error).toContain('Unknown recipe image binding: other');
    expect(runtimeFactory).not.toHaveBeenCalled();
  });

  it('rejects symlinked and signature-spoofed workspace images without confirmation or upload', async () => {
    const fixture = await setupFixture();
    await installImageBindingRecipe(fixture);
    const outside = path.join(await temporaryDirectory('comfy-reference-outside-'), 'outside.png');
    await writeFile(outside, validPngBytes());
    await mkdir(path.join(fixture.workspace, 'avatars'), { recursive: true });
    await symlink(outside, path.join(fixture.workspace, 'avatars', 'linked.png'));
    await writeFile(path.join(fixture.workspace, 'avatars', 'spoof.png'), Buffer.from('not a png', 'utf8'));
    const confirm = vi.fn();
    const uploadImage = vi.fn();
    const tool = new ComfyRecipeTool({
      environment: fixture.environment,
      homeDirectory: fixture.home,
      confirm,
      createRuntime: () => ({ preflight: async () => okPreflight('image.asset'), run: vi.fn(), uploadImage }),
    });

    const linked = await tool.execute({
      action: 'run', commercial_use: false, recipe_id: 'image.asset', prompt: 'avatar',
      reference_images: [{ id: 'source', path: 'avatars/linked.png' }],
    }, { cwd: fixture.workspace });
    expect(linked.error).toContain('symbolic link');

    const spoofed = await tool.execute({
      action: 'run', commercial_use: false, recipe_id: 'image.asset', prompt: 'avatar',
      reference_images: [{ id: 'source', path: 'avatars/spoof.png' }],
    }, { cwd: fixture.workspace });
    expect(spoofed.error).toContain('not a valid PNG, JPEG, or WebP');
    expect(confirm).not.toHaveBeenCalled();
    expect(uploadImage).not.toHaveBeenCalled();
  });

  it('keeps an upload whose on-disk identity cannot be proven without hiding a successful run', async () => {
    const fixture = await setupFixture();
    await installImageBindingRecipe(fixture);
    await mkdir(path.join(fixture.workspace, 'avatars'), { recursive: true });
    const sourceBytes = validPngBytes();
    await writeFile(path.join(fixture.workspace, 'avatars', 'buddy.png'), sourceBytes);
    const uploadSubfolder = 'codebuddy-references/test-retain-token-01';
    const uploadedFilename = 'source-mutated.png';
    const uploadedPath = path.join(fixture.comfyRoot, 'input', uploadSubfolder, uploadedFilename);
    const uploadImage = vi.fn(async () => {
      const changedBytes = Buffer.from(sourceBytes);
      changedBytes[23] = 1;
      await writeFile(uploadedPath, changedBytes);
      return {
        filename: uploadedFilename,
        subfolder: uploadSubfolder,
        type: 'input' as const,
        workflowPath: `${uploadSubfolder}/${uploadedFilename}`,
      };
    });
    const tool = new ComfyRecipeTool({
      environment: fixture.environment,
      homeDirectory: fixture.home,
      confirm: async () => ({ confirmed: true }),
      createUploadToken: () => 'test-retain-token-01',
      createRuntime: () => ({
        preflight: async () => okPreflight('image.asset'),
        run: async () => emptyRunResult(),
        uploadImage,
      }),
    });

    const result = await tool.execute({
      action: 'run', commercial_use: false, recipe_id: 'image.asset', prompt: 'avatar',
      reference_images: [{ id: 'source', path: 'avatars/buddy.png' }],
    }, { cwd: fixture.workspace });

    expect(result.success).toBe(true);
    expect((result.data as { uploadCleanup: unknown }).uploadCleanup).toEqual({
      removed: 0,
      retainedReferences: [`${uploadSubfolder}/${uploadedFilename}`],
    });
    await expect(access(uploadedPath)).resolves.toBeUndefined();
  });
});

async function setupFixture() {
  const home = await temporaryDirectory('comfy-recipe-home-');
  const workspace = await temporaryDirectory('comfy-recipe-workspace-');
  const comfyRoot = await temporaryDirectory('comfy-recipe-runtime-');
  const recipes = path.join(home, '.codebuddy', 'comfy-recipes');
  await mkdir(recipes, { recursive: true });
  await mkdir(path.join(comfyRoot, 'models'), { recursive: true });
  await mkdir(path.join(comfyRoot, 'input'), { recursive: true });
  await writeFile(path.join(recipes, 'image.json'), JSON.stringify(recipeFixture()), 'utf8');
  return {
    home,
    workspace,
    comfyRoot,
    recipes,
    environment: {
      COMFYUI_ROOT: comfyRoot,
      COMFYUI_URL: 'http://127.0.0.1:8188',
    },
  };
}

async function temporaryDirectory(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function okPreflight(recipeId = 'image.test'): ComfyUIPreflightResult {
  return {
    ok: true,
    recipeId,
    recipeVersion: '1.0.0',
    issues: [],
    checkedNodes: 4,
    checkedModels: 1,
  };
}

async function installImageBindingRecipe(fixture: Awaited<ReturnType<typeof setupFixture>>): Promise<void> {
  await writeFile(path.join(fixture.recipes, 'asset.json'), JSON.stringify(recipeFixture({
    id: 'image.asset',
    workflow: { nodes: {
      '3': { inputs: { source: ['5', 0] } },
      '5': { class_type: 'LoadImage', inputs: { image: '{{image:source}}' } },
    } },
    requirements: { nodes: [
      { classType: 'CLIPTextEncode' },
      { classType: 'EmptyLatentImage' },
      { classType: 'KSampler' },
      { classType: 'SaveImage' },
      { classType: 'LoadImage' },
    ] },
    bindings: {
      images: [{ id: 'source', nodeId: '5', input: 'image', required: true }],
    },
  })), 'utf8');
}

function validPngBytes(): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  return bytes;
}

function emptyRunResult(): ComfyUIRecipeRunResult {
  return {
    requestedRecipeId: 'image.asset',
    requestedRecipeVersion: '1.0.0',
    recipeId: 'image.asset',
    recipeVersion: '1.0.0',
    fallbackUsed: false,
    promptId: 'job-assets',
    clientId: 'client-assets',
    artifacts: [],
  };
}

async function unreachableUpload(): Promise<never> {
  throw new Error('uploadImage must not be called');
}
