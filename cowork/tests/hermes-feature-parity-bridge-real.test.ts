import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getHermesFeatureParityForReview } from '../src/main/tools/hermes-feature-parity-bridge';

const distRoot = path.resolve(process.cwd(), '..', 'dist');
const hasBuiltParityCore = fs.existsSync(path.join(distRoot, 'agent', 'hermes-parity-manifest.js'));

describe.skipIf(!hasBuiltParityCore)('Hermes feature parity bridge real core integration', () => {
  let originalEnginePath: string | undefined;

  beforeEach(() => {
    originalEnginePath = process.env.CODEBUDDY_ENGINE_PATH;
    process.env.CODEBUDDY_ENGINE_PATH = distRoot;
  });

  afterEach(() => {
    if (originalEnginePath === undefined) delete process.env.CODEBUDDY_ENGINE_PATH;
    else process.env.CODEBUDDY_ENGINE_PATH = originalEnginePath;
  });

  it('loads the real compiled Hermes feature parity manifest for the cockpit', async () => {
    const summary = await getHermesFeatureParityForReview();

    // Stable invariants only — the audit anchor (inspectedCommit / tag /
    // document) moves on every upstream drift re-audit, so pin its SHAPE, not
    // the dated values (pinned values broke here on the 2026-07-03 re-audit).
    expect(summary).toMatchObject({
      command: 'buddy hermes parity --json',
      source: 'https://github.com/NousResearch/hermes-agent',
    });
    expect(summary?.auditDocument).toMatch(/^docs\/.+\.md$/);
    expect(summary?.inspectedCommit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(summary?.latestTagObserved).toMatch(/^v?\d{4}\./);

    expect(summary?.summary.total).toBeGreaterThanOrEqual(20);
    // Parity reached 0 hard gaps on 2026-06 (and 0 partial on 2026-07-03) —
    // assert the summary stays internally coherent instead of requiring open
    // work to exist forever.
    expect(summary?.summary.gaps).toBeGreaterThanOrEqual(0);
    const counts = summary!.summary;
    expect(counts.covered + counts.coveredPartial + counts.partial + counts.gaps).toBe(counts.total);

    // topWork never surfaces the deferred openclaw-migration line; deferredWork
    // may only ever hold that line (and is empty once it left partial/gap).
    expect(summary?.topWork.map((feature) => feature.id)).not.toContain('openclaw-migration');
    expect(summary?.deferredWork.every((feature) => feature.id === 'openclaw-migration')).toBe(true);
    expect(summary?.topWork.length).toBe(counts.partial + counts.gaps - summary!.deferredWork.length);
    for (const feature of summary?.topWork ?? []) {
      expect(feature.verificationCommands.length).toBeGreaterThan(0);
    }
    expect(summary?.todoCommand).toBe('buddy hermes todo --json');
  });
});
