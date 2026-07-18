import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { exportGoogleFlowHandoffFromPlan } from '../../../src/tools/video/google-flow-plan-export.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-plan-'));
  temporaryDirectories.push(root);
  const filename = path.join(root, 'lisa.png');
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('approved-fictional-adult-source'),
  ]);
  await fs.writeFile(filename, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const plannedShort = (shortId: string, locale: string) => ({
    shortId,
    locale,
    profile: { name: 'Lisa', declaredAdultAge: 28 },
    render: {
      shots: [{
        assetId: 'lisa-safe-1',
        sourceSha256: sha256,
        referenceImagePath: filename,
        contentTier: 'safe',
        qaStatus: 'approved',
        motionPrompt: 'gentle camera push, natural blink and subtle hair movement',
      }],
    },
    publication: {
      visibility: 'private',
      autoPublish: false,
      containsSyntheticMedia: true,
      reviewStatus: 'pending-human-review',
    },
  });
  return {
    root,
    plan: {
      schemaVersion: 3,
      sourceDigests: {
        imageManifestSha256: 'a'.repeat(64),
        imageCatalogSha256: 'b'.repeat(64),
        factoryConfigSha256: 'c'.repeat(64),
      },
      policy: {
        contentTier: 'safe',
        qaStatus: 'approved',
        autoPublish: false,
        initialVisibility: 'private',
        syntheticMediaDisclosureRequired: true,
      },
      shorts: [plannedShort('lisa-fr', 'fr-FR'), plannedShort('lisa-en', 'en-US')],
    },
  };
}

function options(root: string) {
  return {
    approvedAssetRoot: root,
    batchId: 'pilot',
    includeAllShorts: true,
    model: 'fast' as const,
    durationSeconds: 4 as const,
    aspectRatio: '9:16' as const,
    upscale4k: false,
    remainingFlowCredits: 25_000,
    maxFlowCreditsPerBatch: 100,
    darkstarAvailable: true,
    ministarAvailable: true,
  };
}

describe('Google Flow plan export', () => {
  it('verifies assets and reuses an identical visual across localized masters', async () => {
    const { root, plan } = await fixture();
    const handoff = await exportGoogleFlowHandoffFromPlan(plan, options(root));
    expect(handoff).toMatchObject({
      schemaVersion: 2,
      locale: 'multilingual-shared-visuals',
      estimatedCredits: 10,
      autoPublish: false,
    });
    expect(handoff.jobs).toHaveLength(1);
    expect(handoff.jobs[0]?.consumerShortIds).toEqual(['lisa-fr', 'lisa-en']);
    expect(handoff.jobs[0]?.consumers).toEqual([
      { shortId: 'lisa-fr', shotIndex: 1 },
      { shortId: 'lisa-en', shotIndex: 1 },
    ]);
    expect(handoff.sourcePlanSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(handoff.handoffSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('fails closed when a source digest no longer matches', async () => {
    const { root, plan } = await fixture();
    plan.shorts[0]!.render.shots[0]!.sourceSha256 = '0'.repeat(64);
    await expect(exportGoogleFlowHandoffFromPlan(plan, options(root))).rejects.toThrow('digest does not match');
  });

  it('defaults to the first Short when all is not explicitly requested', async () => {
    const { root, plan } = await fixture();
    const exportOptions = options(root);
    delete (exportOptions as Partial<typeof exportOptions>).includeAllShorts;
    const handoff = await exportGoogleFlowHandoffFromPlan(plan, exportOptions);
    expect(handoff.locale).toBe('fr-FR');
    expect(handoff.jobs[0]?.consumerShortIds).toEqual(['lisa-fr']);
  });

  it('rejects legacy plans even when their publication policy looks safe', async () => {
    const { root, plan } = await fixture();
    plan.schemaVersion = 2;
    await expect(exportGoogleFlowHandoffFromPlan(plan, options(root))).rejects.toThrow('not safe');
  });
});
