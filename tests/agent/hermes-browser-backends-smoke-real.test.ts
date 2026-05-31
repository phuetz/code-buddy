import { describe, expect, it } from 'vitest';

import {
  buildHermesBrowserBackendsReadiness,
  runHermesBrowserBackendSmoke,
} from '../../src/agent/hermes-browser-backends.js';

describe('Hermes browser backend readiness and live smoke', () => {
  it('reports browser backend readiness without leaking configured secrets', () => {
    const readiness = buildHermesBrowserBackendsReadiness({
      env: {
        CODEBUDDY_BROWSER_CDP_URL: 'ws://secret-cdp-host.example.test/devtools/browser/abc',
        BROWSERBASE_API_KEY: 'secret-browserbase-key',
        BROWSERBASE_PROJECT_ID: 'secret-browserbase-project',
        BROWSER_USE_API_KEY: 'secret-browser-use-key',
        FIRECRAWL_API_KEY: 'secret-firecrawl-key',
      },
      now: () => new Date('2026-05-31T13:35:00.000Z'),
    });

    expect(readiness.generatedAt).toBe('2026-05-31T13:35:00.000Z');
    expect(readiness.backends.map((backend) => backend.id)).toEqual(
      expect.arrayContaining([
        'local-playwright',
        'remote-cdp',
        'browserbase',
        'browser-use',
        'firecrawl',
        'camofox',
        'session-recording',
      ]),
    );
    expect(readiness.localRunnableCount).toBeGreaterThanOrEqual(1);
    expect(readiness.managedConfiguredCount).toBe(3);
    expect(readiness.backends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local-playwright',
          runnable: true,
          smokeCommand: 'buddy hermes browser-smoke local-playwright --json',
          status: 'available',
        }),
        expect.objectContaining({
          id: 'remote-cdp',
          credentialSources: ['CODEBUDDY_BROWSER_CDP_URL'],
          runnable: true,
          status: 'configured',
        }),
        expect.objectContaining({
          id: 'browserbase',
          configured: true,
          credentialSources: ['BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID'],
          runnable: false,
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
  });

  it('launches Chromium through a real local Playwright smoke', async () => {
    const result = await runHermesBrowserBackendSmoke({
      backendId: 'local-playwright',
      now: () => new Date('2026-05-31T13:36:00.000Z'),
    });

    expect(result).toMatchObject({
      backendId: 'local-playwright',
      command: process.execPath,
      ok: true,
      status: 'passed',
    });
    expect(result.stdout).toContain('OK-HERMES-BROWSER');
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
