import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initLoraProject, listImages } from '../../src/lora/dataset.js';
import type { IdentityDatasetManifest } from '../../src/lora/identity-dataset-gate.js';
import { promoteIdentityDataset } from '../../src/lora/identity-dataset-promotion.js';

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('identity dataset promotion', () => {
  let root: string;
  let project: string;
  let candidates: string;
  let manifestPath: string;
  let reportPath: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'identity-promotion-test-'));
    ({ dir: project } = await initLoraProject({
      name: 'lisa-hq-v2',
      triggerPhrase: 'ohwx lisa',
      root,
      character: 'lisa',
    }));
    candidates = path.join(project, 'identity-candidates');
    manifestPath = path.join(candidates, 'identity-manifest.json');
    reportPath = path.join(candidates, 'identity-gate-report.json');
    await fs.mkdir(candidates);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function writeApprovedFixture(schemaVersion = 2): Promise<IdentityDatasetManifest> {
    const traits = 'olive skin, brown eyes, brunette hair, high cheekbones, mid-20s';
    const images: IdentityDatasetManifest['images'] = [];
    for (let index = 0; index < 20; index++) {
      const id = `lisa_identity_${String(index + 1).padStart(3, '0')}`;
      const bytes = Buffer.alloc(9_000, index + 1);
      const imagePath = path.join(candidates, `${id}.png`);
      await fs.writeFile(imagePath, bytes);
      await fs.writeFile(path.join(candidates, `${id}.txt`), `ohwx lisa, variation ${index}\n`);
      images.push({
        path: imagePath,
        sha256: sha256(bytes),
        angle: ['front', 'three-quarter', 'profile'][index % 3]!,
        framing: ['close-up', 'medium', 'full-body'][index % 3]!,
        expression: ['neutral', 'smile', 'serious'][index % 3]!,
        lighting: ['soft-window', 'studio'][index % 2]!,
        outfit: `outfit-${index % 4}`,
        background: `background-${index % 4}`,
        personId: 'lisa',
        apparentAge: 25,
        immutableTraits: traits,
      });
    }
    const manifest: IdentityDatasetManifest = {
      personId: 'lisa',
      rights: {
        basis: 'synthetic-owned',
        provenance: 'test generator with pinned inputs',
        licenseCleared: true,
        identityConsent: false,
        evidenceReviewed: true,
      },
      identityApproved: true,
      canonicalImmutableTraits: traits,
      images,
    };
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    await fs.writeFile(manifestPath, manifestText);
    await fs.writeFile(
      reportPath,
      `${JSON.stringify({
        schemaVersion,
        dir: candidates,
        ok: true,
        imageCount: images.length,
        manifestSha256: sha256(manifestText),
        inputProblems: [],
        approvals: {
          licenseCleared: true,
          evidenceReviewedBy: 'reviewer',
          identityApprovedBy: 'approver',
        },
        byteGate: { ok: true },
        identity: { ok: true },
      }, null, 2)}\n`,
    );
    return manifest;
  }

  it('rechecks and atomically promotes the exact approved files while preserving old images', async () => {
    await writeApprovedFixture();
    const oldImage = path.join(project, 'images', 'source.png');
    await fs.writeFile(oldImage, Buffer.alloc(9_000, 99));

    await expect(promoteIdentityDataset(project)).rejects.toThrow(/not empty/);

    const result = await promoteIdentityDataset(project, { replaceExisting: true });
    expect(result.imageCount).toBe(20);
    expect(result.backupDirectory).toBeTruthy();
    await expect(fs.readFile(path.join(result.backupDirectory!, 'source.png'))).resolves.toHaveLength(9_000);
    await expect(listImages(result.imagesDirectory)).resolves.toHaveLength(20);

    const receipt = JSON.parse(await fs.readFile(result.receiptPath, 'utf8')) as {
      manifestSha256: string;
      approvals: { evidenceReviewedBy: string; identityApprovedBy: string };
      imageCount: number;
    };
    expect(receipt).toMatchObject({
      manifestSha256: result.manifestSha256,
      approvals: { evidenceReviewedBy: 'reviewer', identityApprovedBy: 'approver' },
      imageCount: 20,
    });
    expect((await fs.readdir(project)).some((name) => name.startsWith('.identity-promotion-'))).toBe(false);
  });

  it('rejects a manifest changed after approval', async () => {
    await writeApprovedFixture();
    await fs.appendFile(manifestPath, ' ');
    await expect(promoteIdentityDataset(project)).rejects.toThrow(/digest does not match/);
  });

  it('rejects legacy reports that do not bind approvals to manifest bytes', async () => {
    await writeApprovedFixture(1);
    await expect(promoteIdentityDataset(project)).rejects.toThrow(/predates manifest binding/);
  });

  it('rejects image bytes changed after both gates', async () => {
    const manifest = await writeApprovedFixture();
    await fs.writeFile(manifest.images[0]!.path, Buffer.alloc(9_000, 88));
    await expect(promoteIdentityDataset(project)).rejects.toThrow(/image digest mismatch/);
  });
});
