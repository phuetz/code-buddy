/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act, Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HermesBrowserBackendsStrip,
  type HermesBrowserBackendsReview,
} from '../src/renderer/components/hermes-browser-backends-strip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>, maybeOptions?: Record<string, unknown>) => {
      const template = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
      const options = typeof fallbackOrOptions === 'object' ? fallbackOrOptions : maybeOptions;
      return Object.entries(options ?? {}).reduce(
        (value, [optionKey, optionValue]) =>
          value.replaceAll(`{{${optionKey}}}`, String(optionValue)),
        template,
      );
    },
  }),
}));

const readyBrowserBackends: HermesBrowserBackendsReview = {
  backends: [
    {
      command: process.execPath,
      configured: true,
      credentialSources: [],
      id: 'local-playwright',
      installed: true,
      label: 'Local Playwright',
      notes: ['Real local browser.'],
      officialSurface: 'local CDP/Playwright browser backend',
      remediation: [],
      runnable: true,
      smokeCommand: 'buddy hermes browser-smoke local-playwright --json',
      status: 'available',
      version: '1.58.2',
    },
    {
      command: null,
      configured: true,
      credentialSources: ['BROWSERBASE_API_KEY', 'BROWSERBASE_PROJECT_ID'],
      id: 'browserbase',
      installed: true,
      label: 'Browserbase / Stagehand',
      notes: ['Managed browser.'],
      officialSurface: 'managed browser backend',
      remediation: [],
      runnable: false,
      smokeCommand: null,
      status: 'configured',
      version: '3.4.0',
    },
    {
      command: null,
      configured: false,
      credentialSources: [],
      id: 'session-recording',
      installed: false,
      label: 'Browser session recording',
      notes: ['Not implemented yet.'],
      officialSurface: 'browser session replay/recording',
      remediation: ['Add recording artifacts.'],
      runnable: false,
      smokeCommand: null,
      status: 'missing',
      version: null,
    },
  ],
  command: 'buddy hermes browser status --json',
  generatedAt: '2026-05-31T13:50:00.000Z',
  issues: [],
  localRunnableCount: 1,
  managedConfiguredCount: 1,
  ok: true,
  platform: 'win32',
  recommendations: ['Add a real browser session recording artifact before claiming full Hermes browser backend parity.'],
};

describe('HermesBrowserBackendsStrip', () => {
  let root: Root | null = null;
  const container = () => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return element;
  };

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    document.body.innerHTML = '';
  });

  it('renders browser readiness and safe backend commands', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(React.createElement(HermesBrowserBackendsStrip, { readiness: readyBrowserBackends }));
    });

    const strip = target.querySelector('[data-testid="fleet-hermes-browser-backends"]');
    expect(strip?.textContent).toContain('Hermes browser backends');
    expect(strip?.textContent).toContain('browser ready');
    expect(strip?.textContent).toContain('Local Playwright');
    expect(strip?.textContent).toContain('Browserbase / Stagehand');
    expect(strip?.textContent).toContain('Browser session recording');
    expect(strip?.textContent).toContain('buddy hermes browser-smoke local-playwright --json');
    expect(strip?.textContent).toContain('buddy hermes browser status --json');
  });

  it('loads browser readiness from the Electron bridge when no prop is provided', async () => {
    const target = container();
    const get = vi.fn().mockResolvedValue(readyBrowserBackends);
    (window as unknown as {
      electronAPI?: {
        tools?: {
          hermesBrowserBackends?: {
            get: typeof get;
          };
        };
      };
    }).electronAPI = {
      tools: {
        hermesBrowserBackends: {
          get,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesBrowserBackendsStrip));
      await Promise.resolve();
    });

    expect(get).toHaveBeenCalledWith();
    expect(target.textContent).toContain('Browserbase / Stagehand');
  });

  it('runs an opt-in browser smoke through the Electron bridge', async () => {
    const target = container();
    const smoke = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        backendId: 'local-playwright',
        command: process.execPath,
        durationMs: 31,
        finishedAt: '2026-05-31T13:51:00.031Z',
        label: 'Local Playwright',
        ok: true,
        output: 'title=OK-HERMES-BROWSER; heading=OK-HERMES-BROWSER',
        startedAt: '2026-05-31T13:51:00.000Z',
        status: 'passed',
        stderr: '',
        stdout: 'title=OK-HERMES-BROWSER; heading=OK-HERMES-BROWSER',
      },
    });
    (window as unknown as {
      electronAPI?: {
        tools?: {
          hermesBrowserBackends?: {
            smoke: typeof smoke;
          };
        };
      };
    }).electronAPI = {
      tools: {
        hermesBrowserBackends: {
          smoke,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesBrowserBackendsStrip, { readiness: readyBrowserBackends }));
      await Promise.resolve();
    });

    const button = target.querySelector('[data-testid="hermes-browser-smoke-local-playwright"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    await act(async () => {
      Simulate.click(button);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(smoke).toHaveBeenCalledWith({ backendId: 'local-playwright' });
    const result = target.querySelector('[data-testid="hermes-browser-smoke-result-local-playwright"]');
    expect(result?.textContent).toContain('smoke passed');
    expect(result?.textContent).toContain('OK-HERMES-BROWSER');
  });
});
