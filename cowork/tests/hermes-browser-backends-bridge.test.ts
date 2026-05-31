import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getHermesBrowserBackendsForReview,
  runHermesBrowserBackendSmokeForReview,
} from '../src/main/tools/hermes-browser-backends-bridge';

const distRoot = path.resolve(process.cwd(), '..', 'dist');
const hasBuiltCore = fs.existsSync(path.join(distRoot, 'agent', 'hermes-browser-backends.js'));

describe.skipIf(!hasBuiltCore)('Hermes browser backends bridge real core integration', () => {
  const originalEnginePath = process.env.CODEBUDDY_ENGINE_PATH;

  beforeEach(() => {
    process.env.CODEBUDDY_ENGINE_PATH = distRoot;
  });

  afterEach(() => {
    if (originalEnginePath === undefined) delete process.env.CODEBUDDY_ENGINE_PATH;
    else process.env.CODEBUDDY_ENGINE_PATH = originalEnginePath;
  });

  it('loads real browser readiness without leaking secret values', async () => {
    const originalCdp = process.env.CODEBUDDY_BROWSER_CDP_URL;
    const originalBrowserbaseKey = process.env.BROWSERBASE_API_KEY;
    const originalBrowserbaseProject = process.env.BROWSERBASE_PROJECT_ID;
    try {
      process.env.CODEBUDDY_BROWSER_CDP_URL = 'ws://secret-cdp-host.example.test/devtools/browser/abc';
      process.env.BROWSERBASE_API_KEY = 'secret-browserbase-key';
      process.env.BROWSERBASE_PROJECT_ID = 'secret-browserbase-project';

      const readiness = await getHermesBrowserBackendsForReview();

      expect(readiness).toMatchObject({
        command: 'buddy hermes browser status --json',
        localRunnableCount: expect.any(Number),
        platform: process.platform,
      });
      expect(readiness?.localRunnableCount).toBeGreaterThanOrEqual(1);
      expect(readiness?.backends).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'local-playwright',
            runnable: true,
            smokeCommand: 'buddy hermes browser-smoke local-playwright --json',
          }),
          expect.objectContaining({
            id: 'remote-cdp',
            credentialSources: ['CODEBUDDY_BROWSER_CDP_URL'],
            status: 'configured',
          }),
          expect.objectContaining({
            id: 'browserbase',
            credentialSources: ['BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID'],
            status: 'configured',
          }),
          expect.objectContaining({
            id: 'session-recording',
            runnable: true,
            smokeCommand: 'buddy hermes browser-smoke local-playwright --json',
            status: 'available',
          }),
        ]),
      );
      expect(JSON.stringify(readiness)).not.toContain('secret-');
      expect(JSON.stringify(readiness)).not.toContain('ws://secret-cdp-host');
    } finally {
      if (originalCdp === undefined) delete process.env.CODEBUDDY_BROWSER_CDP_URL;
      else process.env.CODEBUDDY_BROWSER_CDP_URL = originalCdp;
      if (originalBrowserbaseKey === undefined) delete process.env.BROWSERBASE_API_KEY;
      else process.env.BROWSERBASE_API_KEY = originalBrowserbaseKey;
      if (originalBrowserbaseProject === undefined) delete process.env.BROWSERBASE_PROJECT_ID;
      else process.env.BROWSERBASE_PROJECT_ID = originalBrowserbaseProject;
    }
  });

  it('runs the real local Playwright smoke through the bridge', async () => {
    const result = await runHermesBrowserBackendSmokeForReview(' local-playwright ');

    expect(result).toMatchObject({
      backendId: 'local-playwright',
      command: process.execPath,
      ok: true,
      status: 'passed',
    });
    expect(result.output).toContain('OK-HERMES-BROWSER');
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exists: true,
          kind: 'playwright-trace',
          sizeBytes: expect.any(Number),
        }),
      ]),
    );
    expect(result.artifacts?.[0]?.sizeBytes).toBeGreaterThan(0);
  });
});
