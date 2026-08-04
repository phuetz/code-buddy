import { createHash } from 'crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { CreativeAssetRegistry } from '../src/main/media/creative-asset-registry';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('CreativeAssetRegistry', () => {
  it('exposes approved safe MySoulmate assets by default and materializes them for Vite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'creative-workspace-'));
    const catalog = await mkdtemp(join(tmpdir(), 'mysoulmate-catalog-'));
    roots.push(root, catalog);
    await mkdir(join(catalog, 'safe'), { recursive: true });
    await mkdir(join(catalog, 'explicit'), { recursive: true });
    const safeBytes = Buffer.from([137, 80, 78, 71]);
    const safeSha256 = createHash('sha256').update(safeBytes).digest('hex');
    await writeFile(join(catalog, 'safe', 'lisa.png'), safeBytes);
    await writeFile(join(catalog, 'explicit', 'lisa.png'), Buffer.from([137, 80, 78, 71]));
    await writeFile(join(catalog, 'manifest.json'), JSON.stringify({ assets: [
      { id: 'safe-lisa', profileId: 'lisa', contentTier: 'safe', style: 'street', qaStatus: 'approved', sha256: safeSha256, path: 'safe/lisa.png' },
      { id: 'adult-lisa', profileId: 'lisa', contentTier: 'explicit', style: 'private', qaStatus: 'approved', sha256: safeSha256, path: 'explicit/lisa.png' },
      { id: 'rejected', profileId: 'lisa', contentTier: 'safe', style: 'bad', qaStatus: 'rejected', sha256: safeSha256, path: 'safe/lisa.png' },
    ] }));
    const registry = new CreativeAssetRegistry({ roots: () => [root], activeRoot: () => root, mySoulmateRoot: catalog, environment: {} });
    const listed = await registry.list({ contentTier: 'all' });
    expect(listed.allowedTiers).toEqual(['safe']);
    expect(listed.assets.map((asset) => asset.id)).toEqual(['mysoulmate:safe-lisa']);
    const output = await registry.materialize({ ids: ['mysoulmate:safe-lisa'], targetRoot: root, stack: 'react-vite' });
    expect(output).toMatchObject({ ok: true, assets: [{ contentTier: 'safe' }] });
    const relativePath = output.assets?.[0]?.relativePath;
    expect(relativePath).toMatch(/^public\/generated\//);
    await expect(readFile(join(root, relativePath!))).resolves.toBeInstanceOf(Buffer);
  });

  it('refuses modified MySoulmate media and symlink escape paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'creative-workspace-'));
    const catalog = await mkdtemp(join(tmpdir(), 'mysoulmate-catalog-'));
    const outside = await mkdtemp(join(tmpdir(), 'creative-outside-'));
    roots.push(root, catalog, outside);
    const image = join(catalog, 'lisa.png');
    const bytes = Buffer.from([137, 80, 78, 71]);
    await writeFile(image, bytes);
    await writeFile(join(catalog, 'manifest.json'), JSON.stringify({ assets: [{
      id: 'lisa', profileId: 'lisa', contentTier: 'safe', style: 'portrait', qaStatus: 'approved',
      sha256: createHash('sha256').update(bytes).digest('hex'), path: 'lisa.png',
    }] }));
    const registry = new CreativeAssetRegistry({ roots: () => [root], activeRoot: () => root, mySoulmateRoot: catalog, environment: {} });
    await registry.list();
    await writeFile(image, Buffer.from([137, 80, 78, 72]));
    await expect(registry.resolveAssetPath('mysoulmate:lisa')).rejects.toThrow('empreinte');

    const linkedImport = join(root, 'linked.png');
    await symlink(image, linkedImport);
    await expect(registry.importPaths([linkedImport])).rejects.toThrow('lien symbolique');

    const linkedProject = join(root, 'linked-project');
    await symlink(outside, linkedProject);
    await expect(registry.materialize({
      ids: ['mysoulmate:lisa'],
      targetRoot: linkedProject,
      stack: 'react-vite',
    })).resolves.toMatchObject({ ok: false, error: expect.stringContaining('lien symbolique') });
  });

  it('refuses an import destination that traverses a workspace symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'creative-workspace-'));
    const outside = await mkdtemp(join(tmpdir(), 'creative-outside-'));
    const sourceRoot = await mkdtemp(join(tmpdir(), 'creative-source-'));
    roots.push(root, outside, sourceRoot);
    const source = join(sourceRoot, 'portrait.png');
    await writeFile(source, Buffer.from([137, 80, 78, 71]));
    await symlink(outside, join(root, '.codebuddy'));
    const registry = new CreativeAssetRegistry({ roots: () => [root], activeRoot: () => root, environment: {} });

    await expect(registry.importPaths([source])).rejects.toThrow('lien symbolique');
    await expect(readFile(join(outside, 'media-generation', 'images', 'portrait.png'))).rejects.toThrow();
  });

  it('does not reuse an altered materialized file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'creative-workspace-'));
    roots.push(root);
    const sourceDirectory = join(root, '.codebuddy', 'media-generation', 'images');
    await mkdir(sourceDirectory, { recursive: true });
    const source = join(sourceDirectory, 'portrait.png');
    await writeFile(source, Buffer.from([137, 80, 78, 71]));
    const registry = new CreativeAssetRegistry({ roots: () => [root], activeRoot: () => root, environment: {} });
    const asset = await registry.registerTrustedPath(source);
    const first = await registry.materialize({ ids: [asset.id], targetRoot: root, stack: 'react-vite' });
    const relativePath = first.assets?.[0]?.relativePath;
    expect(relativePath).toBeTruthy();
    await writeFile(join(root, relativePath!), Buffer.from('tampered'));

    await expect(registry.materialize({ ids: [asset.id], targetRoot: root, stack: 'react-vite' }))
      .resolves.toMatchObject({ ok: false, error: expect.stringContaining('contenu différent') });
  });
});
