/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act, Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HermesRuntimeBackendsStrip,
  type HermesRuntimeBackendsReview,
} from '../src/renderer/components/hermes-runtime-backends-strip';

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

const readyRuntime: HermesRuntimeBackendsReview = {
  arch: 'x64',
  availableCount: 4,
  backends: [
    {
      command: 'node',
      configured: true,
      credentialSources: [],
      id: 'local',
      installed: true,
      label: 'Local process',
      notes: ['Uses the current runtime.'],
      officialSurface: 'local terminal backend',
      remediation: [],
      runnable: true,
      smokeCommand: 'node -e "console.log(\'OK-HERMES-LOCAL\')"',
      status: 'available',
      version: 'v24.14.0',
    },
    {
      command: 'docker',
      configured: false,
      credentialSources: [],
      id: 'docker',
      installed: true,
      label: 'Docker sandbox',
      notes: ['Docker daemon is not reachable.'],
      officialSurface: 'Docker terminal backend',
      remediation: ['Start Docker Desktop.'],
      runnable: false,
      smokeCommand: 'docker run --rm --network none node:22-slim node -e "console.log(\'OK-HERMES-DOCKER\')"',
      status: 'available',
      version: 'Docker version 29.4.3',
    },
    {
      command: 'vercel',
      configured: true,
      credentialSources: ['VERCEL_TOKEN'],
      id: 'vercel-sandbox',
      installed: true,
      label: 'Vercel Sandbox',
      notes: ['Remote backend.'],
      officialSurface: 'Vercel Sandbox remote backend',
      remediation: [],
      runnable: true,
      smokeCommand: 'vercel whoami',
      status: 'configured',
      version: 'Vercel CLI 42.0.0',
    },
  ],
  command: 'buddy hermes doctor balanced --json',
  configuredRemoteCount: 1,
  generatedAt: '2026-05-30T22:00:00.000Z',
  issues: [],
  ok: true,
  platform: 'win32',
  recommendations: ['Run the Docker smoke command when Docker is available.'],
  routePlan: {
    fallbackBackendIds: [],
    mode: 'hybrid',
    primaryBackendId: 'local',
    reason: 'Auto runtime smoke will use Local process; no secondary safe backend is currently runnable.',
    smokeCommand: 'buddy hermes runtime-smoke auto --json',
  },
  runnableCount: 2,
};

describe('HermesRuntimeBackendsStrip', () => {
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

  it('renders runtime readiness, backend rows, and safe smoke commands', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(React.createElement(HermesRuntimeBackendsStrip, { readiness: readyRuntime }));
    });

    const strip = target.querySelector('[data-testid="fleet-hermes-runtime-backends"]');
    expect(strip?.textContent).toContain('Hermes runtime backends');
    expect(strip?.textContent).toContain('runtime ready');
    expect(strip?.textContent).toContain('2/3');
    expect(strip?.textContent).toContain('win32/x64');
    expect(strip?.textContent).toContain('Local process');
    expect(strip?.textContent).toContain('Hybrid route');
    expect(strip?.textContent).toContain('buddy hermes runtime-smoke auto --json');
    expect(strip?.textContent).toContain('Docker sandbox');
    expect(strip?.textContent).toContain('Vercel Sandbox');
    expect(strip?.textContent).toContain('OK-HERMES-LOCAL');
    expect(strip?.textContent).toContain('OK-HERMES-DOCKER');
    expect(strip?.textContent).toContain('buddy hermes doctor balanced --json');
    expect(target.querySelector('[data-testid="hermes-runtime-route-plan"]')?.textContent).toContain('local');
  });

  it('loads runtime readiness from the readonly Electron bridge when no prop is provided', async () => {
    const target = container();
    const get = vi.fn().mockResolvedValue(readyRuntime);
    (window as unknown as {
      electronAPI?: {
        tools?: {
          hermesRuntimeBackends?: {
            get: typeof get;
          };
        };
      };
    }).electronAPI = {
      tools: {
        hermesRuntimeBackends: {
          get,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesRuntimeBackendsStrip));
      await Promise.resolve();
    });

    expect(get).toHaveBeenCalledWith();
    expect(target.textContent).toContain('Vercel Sandbox');
    expect(target.textContent).toContain('vercel whoami');
  });

  it('runs an opt-in live smoke through the Electron bridge', async () => {
    const target = container();
    const smoke = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        args: ['-e', "console.log('OK-HERMES-LOCAL')"],
        backendId: 'local',
        command: 'node',
        durationMs: 25,
        exitCode: 0,
        finishedAt: '2026-05-31T10:18:00.025Z',
        label: 'Local process',
        ok: true,
        output: 'OK-HERMES-LOCAL',
        signal: null,
        startedAt: '2026-05-31T10:18:00.000Z',
        status: 'passed',
        stderr: '',
        stdout: 'OK-HERMES-LOCAL',
      },
    });
    (window as unknown as {
      electronAPI?: {
        tools?: {
          hermesRuntimeBackends?: {
            smoke: typeof smoke;
          };
        };
      };
    }).electronAPI = {
      tools: {
        hermesRuntimeBackends: {
          smoke,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesRuntimeBackendsStrip, { readiness: readyRuntime }));
      await Promise.resolve();
    });

    const button = target.querySelector('[data-testid="hermes-runtime-smoke-local"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    await act(async () => {
      Simulate.click(button);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(smoke).toHaveBeenCalledWith({
      allowDockerSmoke: false,
      allowRemoteSmoke: false,
      backendId: 'local',
    });
    const result = target.querySelector('[data-testid="hermes-runtime-smoke-result-local"]');
    expect(result?.textContent).toContain('smoke passed');
    expect(result?.textContent).toContain('OK-HERMES-LOCAL');
  });
});
