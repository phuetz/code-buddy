/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act, Simulate } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HermesLocalSmokeStrip } from '../src/renderer/components/hermes-local-smoke-strip';

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

describe('HermesLocalSmokeStrip', () => {
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

  it('renders the Cowork local Hermes smoke entry point', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(React.createElement(HermesLocalSmokeStrip));
    });

    const strip = target.querySelector('[data-testid="fleet-hermes-local-smoke"]');
    expect(strip?.textContent).toContain('Hermes local smoke');
    expect(strip?.textContent).toContain('local smoke');
    expect(strip?.textContent).toContain('buddy hermes smoke --json');
  });

  it('runs the combined local smoke through the Electron bridge', async () => {
    const target = container();
    const run = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        commands: {
          browser: 'buddy hermes browser-smoke auto --json',
          protocols: 'buddy hermes protocols-smoke local --json',
          runtime: 'buddy hermes runtime-smoke auto --json',
          suite: 'buddy hermes smoke --json',
        },
        generatedAt: '2026-06-01T05:25:00.000Z',
        kind: 'hermes_local_smoke_suite',
        notes: [],
        ok: true,
        results: {
          browser: {
            artifacts: [],
            backendId: 'local-playwright',
            command: 'node',
            durationMs: 31,
            finishedAt: '2026-06-01T05:25:00.031Z',
            label: 'Local Playwright',
            ok: true,
            output: 'title=OK-HERMES-BROWSER',
            startedAt: '2026-06-01T05:25:00.000Z',
            status: 'passed',
            stderr: '',
            stdout: 'title=OK-HERMES-BROWSER',
          },
          protocols: {
            durationMs: 42,
            generatedAt: '2026-06-01T05:25:00.042Z',
            httpRoutes: {
              a2aAgentName: 'Code Buddy',
              acpSessionCount: 1,
              baseUrl: 'http://127.0.0.1:54123',
              ok: true,
              routes: [
                { ok: true, path: '/api/a2a/.well-known/agent.json', status: 200 },
                { ok: true, path: '/api/acp/sessions', status: 201 },
              ],
            },
            kind: 'hermes_protocol_gateway_smoke',
            mcpStdio: {
              echoText: 'HERMES_PROTOCOL_MCP:OK',
              ok: true,
              serverName: 'hermes_protocol_fixture',
              toolCount: 1,
              transport: 'stdio',
            },
            ok: true,
            schemaVersion: 1,
          },
          runtime: {
            args: ['-e', "console.log('OK-HERMES-LOCAL')"],
            backendId: 'local',
            command: 'node',
            durationMs: 22,
            exitCode: 0,
            finishedAt: '2026-06-01T05:25:00.022Z',
            label: 'Local process',
            ok: true,
            output: 'OK-HERMES-LOCAL',
            signal: null,
            startedAt: '2026-06-01T05:25:00.000Z',
            status: 'passed',
            stderr: '',
            stdout: 'OK-HERMES-LOCAL',
          },
        },
        schemaVersion: 1,
        summary: {
          passed: 3,
          total: 3,
        },
      },
    });
    (window as unknown as {
      electronAPI?: {
        tools?: {
          hermesLocalSmoke?: {
            run: typeof run;
          };
        };
      };
    }).electronAPI = {
      tools: {
        hermesLocalSmoke: {
          run,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesLocalSmokeStrip));
      await Promise.resolve();
    });

    const button = target.querySelector('[data-testid="hermes-local-smoke-run"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    await act(async () => {
      Simulate.click(button);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(run).toHaveBeenCalledWith();
    const result = target.querySelector('[data-testid="hermes-local-smoke-result"]');
    expect(result?.textContent).toContain('local smoke passed');
    expect(result?.textContent).toContain('runtime passed');
    expect(result?.textContent).toContain('browser passed');
    expect(result?.textContent).toContain('protocols passed');
    expect(target.textContent).toContain('Runtime');
    expect(target.textContent).toContain('Browser');
    expect(target.textContent).toContain('MCP ok / HTTP 2');
  });
});
