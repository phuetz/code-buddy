import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ComfyUIRecipeRegistry,
  loadComfyUIRecipeDirectory,
  loadComfyUIRecipeFile,
} from '../../src/media/comfyui-recipe-registry.js';
import { recipeFixture } from './comfyui-recipe-fixture.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ComfyUI recipe loader and registry', () => {
  it('loads bounded UTF-8 JSON below a real root and registers it atomically', async () => {
    const root = await temporaryDirectory();
    await mkdir(path.join(root, 'images'));
    await writeFile(path.join(root, 'images', 'draft.json'), JSON.stringify(recipeFixture()));

    const loaded = await loadComfyUIRecipeFile(root, 'images/draft.json');
    expect(loaded.recipe.id).toBe('image.test');
    expect(loaded.sourcePath).toBe(path.join(root, 'images', 'draft.json'));

    const registry = new ComfyUIRecipeRegistry();
    const directoryRecipes = await registry.loadDirectory(root);
    expect(directoryRecipes).toHaveLength(1);
    expect(registry.get('image.test').title).toBe('Test image recipe');
  });

  it('rejects traversal, absolute paths, file links, directory links, and linked roots', async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await writeFile(path.join(outside, 'recipe.json'), JSON.stringify(recipeFixture()));

    await expect(loadComfyUIRecipeFile(root, '../recipe.json')).rejects.toThrow(/safe relative/);
    await expect(loadComfyUIRecipeFile(root, path.join(outside, 'recipe.json'))).rejects.toThrow(/safe relative/);

    await symlink(path.join(outside, 'recipe.json'), path.join(root, 'linked.json'));
    await expect(loadComfyUIRecipeFile(root, 'linked.json')).rejects.toThrow(/symbolic link/);

    await symlink(outside, path.join(root, 'linked-dir'));
    await expect(loadComfyUIRecipeDirectory(root)).rejects.toThrow(/symbolic link/);

    const rootLink = `${root}-link`;
    temporaryRoots.push(rootLink);
    await symlink(root, rootLink);
    await expect(loadComfyUIRecipeDirectory(rootLink)).rejects.toThrow(/symbolic link/);
  });

  it('fails closed on oversized files, excessive depth, and special/non-JSON-safe entries', async () => {
    const oversizedRoot = await temporaryDirectory();
    await writeFile(path.join(oversizedRoot, 'large.json'), 'x'.repeat(1025));
    await expect(loadComfyUIRecipeFile(oversizedRoot, 'large.json', { maxBytes: 1024 }))
      .rejects.toThrow(/exceeds 1024 bytes/);

    const deepRoot = await temporaryDirectory();
    await mkdir(path.join(deepRoot, 'one', 'two'), { recursive: true });
    await writeFile(path.join(deepRoot, 'one', 'two', 'recipe.json'), JSON.stringify(recipeFixture()));
    await expect(loadComfyUIRecipeDirectory(deepRoot, { maxDepth: 1 })).rejects.toThrow(/exceeds depth/);

    const countRoot = await temporaryDirectory();
    await writeFile(path.join(countRoot, 'one.json'), JSON.stringify(recipeFixture({ id: 'one' })));
    await writeFile(path.join(countRoot, 'two.json'), JSON.stringify(recipeFixture({ id: 'two' })));
    await expect(loadComfyUIRecipeDirectory(countRoot, { maxFiles: 1 })).rejects.toThrow(/exceeds 1 JSON files/);
  });

  it('rejects unresolved and cyclic fallback registries before execution', () => {
    const missing = new ComfyUIRecipeRegistry([
      recipeFixture({ fallback: [{ id: 'missing' }] }),
    ]);
    expect(() => missing.resolveFallbackChain('image.test')).toThrow(/Unknown ComfyUI recipe/);

    const cyclic = new ComfyUIRecipeRegistry([
      recipeFixture({ id: 'cycle.a', fallback: [{ id: 'cycle.b' }] }),
      recipeFixture({ id: 'cycle.b', fallback: [{ id: 'cycle.a' }] }),
    ]);
    expect(() => cyclic.resolveFallbackChain('cycle.a')).toThrow(/fallback cycle/);
  });
});

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'codebuddy-comfy-recipe-'));
  temporaryRoots.push(root);
  return root;
}
