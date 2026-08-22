import { createHash } from 'crypto';
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadVoiceRightsRegistry, voiceProfileRevision } from '../../../src/tools/video/voice-rights-registry.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'voice-rights-'));
  roots.push(root);
  const evidencePath = path.join(root, 'license.txt');
  await writeFile(evidencePath, 'reviewed license evidence', { mode: 0o600 });
  const evidenceSha256 = createHash('sha256').update(await readFile(evidencePath)).digest('hex');
  const profile = {
    id: 'lisa-fr-pocket-v1', locale: 'fr-FR', provider: 'pocket', voice: 'estelle', language: 'french',
    status: 'approved', revoked: false, scopes: ['commercial-youtube'], reviewer: 'Patrice',
    reviewedAt: '2026-07-18T12:00:00.000Z',
    provenance: { ref: 'license/lisa-fr-v1', evidencePath, evidenceSha256 },
    ...overrides,
  };
  const registryPath = path.join(root, 'registry.json');
  await writeFile(registryPath, JSON.stringify({ schemaVersion: 2, profiles: [profile] }), { mode: 0o600 });
  await chmod(registryPath, 0o600);
  return { root, registryPath, evidencePath };
}

describe('voice rights registry V2', () => {
  it('derives an approved runtime profile from reviewed evidence', async () => {
    const { registryPath } = await fixture();
    const profiles = await loadVoiceRightsRegistry(registryPath, 'commercial-youtube', new Date('2026-07-19'));
    const profile = profiles.get('lisa-fr-pocket-v1')!;
    expect(profile).toMatchObject({ commercialUseApproved: true, provenanceRef: 'license/lisa-fr-v1' });
    expect(voiceProfileRevision(profile)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rejects pending, expired and modified evidence', async () => {
    await expect(loadVoiceRightsRegistry((await fixture({ status: 'pending' })).registryPath)).rejects.toThrow('not approved');
    await expect(loadVoiceRightsRegistry((await fixture({ expiresAt: '2026-01-01T00:00:00.000Z' })).registryPath))
      .rejects.toThrow('expired');
    const changed = await fixture();
    await writeFile(changed.evidencePath, 'changed evidence', { mode: 0o600 });
    await expect(loadVoiceRightsRegistry(changed.registryPath)).rejects.toThrow('digest mismatch');
  });

  it('rejects a symlinked registry even when its target is private', async () => {
    const { root, registryPath } = await fixture();
    const linked = path.join(root, 'linked.json');
    await symlink(registryPath, linked);
    await expect(loadVoiceRightsRegistry(linked)).rejects.toThrow('non-symlink');
  });
});
