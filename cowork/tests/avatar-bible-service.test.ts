import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { AvatarBibleService } from '../src/main/comfy-lab/avatar-bible-service';

const roots: string[] = [];

function png(width = 64, height = 64): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

async function fixture(): Promise<{ workspace: string; source: string }> {
  const root = await mkdtemp(join(tmpdir(), 'avatar-bible-'));
  roots.push(root);
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  const source = join(root, 'avatar.png');
  await writeFile(source, png());
  return { workspace, source };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('AvatarBibleService', () => {
  it('copies a dialog-selected image into an atomic private manifest without path or biometric leakage', async () => {
    const { workspace, source } = await fixture();
    const service = new AvatarBibleService({
      getWorkspace: () => workspace,
      selectImage: async () => source,
      now: () => new Date('2026-07-12T15:00:00.000Z'),
    });

    const imported = await service.importFromDialog({
      name: 'Code Buddy principal',
      role: 'master',
      rights: 'owned',
      consent: 'not-applicable',
      notes: 'Visière cyan, manteau violet.',
    });

    expect(imported).toMatchObject({
      canceled: false,
      avatar: {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        name: 'Code Buddy principal',
        role: 'master',
        mime: 'image/png',
        width: 64,
        height: 64,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
      snapshot: {
        revision: 1,
        masterId: expect.any(String),
        privacy: { containsFaceEmbeddings: false },
      },
    });
    const manifestPath = join(workspace, '.codebuddy', 'avatar-bible', 'manifest.json');
    const rawManifest = await readFile(manifestPath, 'utf8');
    expect(rawManifest).not.toContain(source);
    expect(rawManifest).not.toMatch(/embedding|enrol|enrollment/iu);
    const stored = JSON.parse(rawManifest) as { avatars: Array<{ fileName: string }> };
    expect(stored.avatars[0]?.fileName).toMatch(/^[0-9a-f-]{36}\.png$/u);
    expect((await stat(manifestPath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(workspace, '.codebuddy', 'avatar-bible', 'assets', stored.avatars[0]!.fileName))).mode & 0o777).toBe(0o600);

    const listed = await service.list();
    expect(JSON.stringify(listed)).not.toContain('fileName');
    expect(JSON.stringify(listed)).not.toContain(source);
    await expect(service.preview(imported.avatar!.id)).resolves.toMatchObject({
      id: imported.avatar!.id,
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/u),
    });
  });

  it('keeps one coherent master and supports update, stable Flow materialization, and removal', async () => {
    const { workspace, source } = await fixture();
    const service = new AvatarBibleService({
      getWorkspace: () => workspace,
      selectImage: async () => source,
    });
    const first = await service.importFromDialog({
      name: 'Face', role: 'master', rights: 'owned', consent: 'not-applicable',
    });
    const second = await service.importFromDialog({
      name: 'Profil', role: 'master', rights: 'licensed', consent: 'confirmed',
    });
    expect(second.snapshot.masterId).toBe(second.avatar!.id);
    expect(second.snapshot.avatars.filter((avatar) => avatar.role === 'master')).toEqual([
      expect.objectContaining({ id: second.avatar!.id }),
    ]);
    expect(second.snapshot.avatars.find((avatar) => avatar.id === first.avatar!.id)?.role).toBe('front');

    const remastered = await service.setMaster(first.avatar!.id);
    expect(remastered.masterId).toBe(first.avatar!.id);
    expect(remastered.avatars.filter((avatar) => avatar.role === 'master')).toHaveLength(1);
    const updated = await service.update({
      id: first.avatar!.id,
      name: 'Face souriante',
      role: 'expression',
      rights: 'owned',
      consent: 'not-applicable',
      notes: 'Sourire léger',
    });
    expect(updated.snapshot.masterId).toBeUndefined();
    expect(updated.avatar).toMatchObject({ name: 'Face souriante', role: 'expression' });

    const flowOne = await service.materializeForFlow(second.avatar!.id);
    const flowTwo = await service.materializeForFlow(second.avatar!.id);
    expect(flowTwo.path).toBe(flowOne.path);
    expect(flowOne.path).toContain(join('.codebuddy', 'media-generation', 'images'));
    expect(flowOne.path).not.toContain(join('avatar-bible', 'assets'));
    expect(await readdir(join(workspace, '.codebuddy', 'media-generation', 'images'))).toHaveLength(1);

    const removed = await service.remove(second.avatar!.id);
    expect(removed.removedId).toBe(second.avatar!.id);
    expect(removed.snapshot.avatars.some((avatar) => avatar.id === second.avatar!.id)).toBe(false);
    expect(await readdir(join(workspace, '.codebuddy', 'avatar-bible', 'assets'))).toHaveLength(1);
    await expect(service.preview(second.avatar!.id)).rejects.toThrow(/introuvable/iu);
  });

  it('rejects symlink imports, signature mismatch, invalid dimensions, and symlinked storage roots', async () => {
    const { workspace, source } = await fixture();
    const sourceLink = join(workspace, 'linked.png');
    await symlink(source, sourceLink);
    const metadata = {
      name: 'Unsafe', role: 'front' as const, rights: 'owned' as const, consent: 'not-applicable' as const,
    };
    await expect(new AvatarBibleService({
      getWorkspace: () => workspace,
      selectImage: async () => sourceLink,
    }).importFromDialog(metadata)).rejects.toThrow(/symbolique/iu);

    const fake = join(workspace, 'fake.png');
    await writeFile(fake, 'not an image');
    await expect(new AvatarBibleService({
      getWorkspace: () => workspace,
      selectImage: async () => fake,
    }).importFromDialog(metadata)).rejects.toThrow(/signature/iu);

    const huge = join(workspace, 'huge.png');
    await writeFile(huge, png(8192, 8192));
    await expect(new AvatarBibleService({
      getWorkspace: () => workspace,
      selectImage: async () => huge,
    }).importFromDialog(metadata)).rejects.toThrow(/Dimensions/iu);

    const storageFixture = await fixture();
    const storageWorkspace = storageFixture.workspace;
    const outside = join(storageWorkspace, 'outside');
    await mkdir(outside);
    await mkdir(join(storageWorkspace, '.codebuddy'));
    await symlink(outside, join(storageWorkspace, '.codebuddy', 'avatar-bible'));
    await expect(new AvatarBibleService({
      getWorkspace: () => storageWorkspace,
      selectImage: async () => storageFixture.source,
    }).list()).rejects.toThrow(/symbolique/iu);
  });

  it('fails closed if the project changes while the native file dialog is open', async () => {
    const { workspace, source } = await fixture();
    const other = join(workspace, 'other');
    await mkdir(other);
    let active = workspace;
    const service = new AvatarBibleService({
      getWorkspace: () => active,
      selectImage: async () => {
        active = other;
        return source;
      },
    });
    await expect(service.importFromDialog({
      name: 'Race', role: 'front', rights: 'owned', consent: 'not-applicable',
    })).rejects.toThrow(/projet actif a changé/iu);
  });
});
