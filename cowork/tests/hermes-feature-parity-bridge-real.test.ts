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

    expect(summary).toMatchObject({
      auditDocument: 'docs/hermes-agent-official-parity-audit-2026-05-30.md',
      command: 'buddy hermes parity --json',
      inspectedCommit: '5921d667',
      latestTagObserved: 'v2026.5.29.2',
      source: 'https://github.com/NousResearch/hermes-agent',
    });
    expect(summary?.summary.total).toBeGreaterThanOrEqual(20);
    expect(summary?.summary.gaps).toBeGreaterThanOrEqual(1);
    expect(summary?.topWork.map((feature) => feature.id)).toContain('openclaw-migration');
    expect(summary?.topWork.some((feature) => feature.verificationCommands.length > 0)).toBe(true);
  });
});
