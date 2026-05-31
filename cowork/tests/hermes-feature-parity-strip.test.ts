/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HermesFeatureParityStrip,
  buildHermesFeatureParityCommand,
  buildHermesFeatureTodoCommand,
} from '../src/renderer/components/hermes-feature-parity-strip';

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

describe('HermesFeatureParityStrip', () => {
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

  it('renders Hermes feature parity counts and prioritized work', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(HermesFeatureParityStrip, {
          error: 'parity unavailable',
          parity: {
            auditDocument: 'docs/hermes-agent-official-parity-audit-2026-05-30.md',
            command: 'buddy hermes parity --json',
            deferredWork: [
              {
                area: 'OpenClaw migration',
                id: 'openclaw-migration',
                nextWork: 'Do this at the end.',
                officialSurface: 'hermes claw migrate',
                status: 'gap',
                verificationCommands: ['rg -n "openclaw" src tests docs'],
              },
            ],
            generatedAt: '2026-05-31T18:00:00.000Z',
            inspectedCommit: '5921d667',
            latestTagObserved: 'v2026.5.29.2',
            source: 'https://github.com/NousResearch/hermes-agent',
            summary: {
              covered: 0,
              coveredPartial: 5,
              gaps: 1,
              partial: 14,
              total: 20,
            },
            topWork: [
              {
                area: 'Closed learning loop',
                id: 'closed-learning-loop',
                nextWork: 'Keep skill mutation outcomes tied to rollback history.',
                officialSurface: 'Memory nudges and autonomous skill creation',
                status: 'partial',
                verificationCommands: ['npm test -- tests/agent/learning-agent-real.test.ts --run'],
              },
            ],
            todoCommand: 'buddy hermes todo --json',
          },
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-hermes-feature-parity"]');
    expect(strip?.textContent).toContain('Hermes feature parity');
    expect(strip?.textContent).toContain('5/20 major areas');
    expect(strip?.textContent).toContain('0 covered');
    expect(strip?.textContent).toContain('5 covered/partial');
    expect(strip?.textContent).toContain('14 partial');
    expect(strip?.textContent).toContain('1 gaps');
    expect(strip?.textContent).toContain('Hermes feature parity load failed');
    expect(strip?.textContent).toContain('parity unavailable');
    expect(strip?.textContent).toContain('Closed learning loop');
    expect(strip?.textContent).toContain('OpenClaw migration');
    expect(strip?.textContent).toContain('Do this at the end.');
    expect(strip?.textContent).toContain('Deferred');
    expect(strip?.textContent).toContain('buddy hermes todo --json');
    expect(strip?.textContent).toContain('buddy hermes parity --json');
  });

  it('keeps the CLI helper command stable', () => {
    expect(buildHermesFeatureParityCommand()).toBe('buddy hermes parity --json');
    expect(buildHermesFeatureTodoCommand()).toBe('buddy hermes todo --json');
  });

  it('loads the parity summary from the readonly Electron bridge when no parity is provided', async () => {
    const target = container();
    const get = vi.fn().mockResolvedValue({
      auditDocument: 'docs/hermes-agent-official-parity-audit-2026-05-30.md',
      command: 'buddy hermes parity --json',
      deferredWork: [],
      generatedAt: '2026-05-31T18:05:00.000Z',
      inspectedCommit: '5921d667',
      latestTagObserved: 'v2026.5.29.2',
      source: 'https://github.com/NousResearch/hermes-agent',
      summary: {
        covered: 0,
        coveredPartial: 5,
        gaps: 1,
        partial: 14,
        total: 20,
      },
      topWork: [
        {
          area: 'Runtime backends',
          id: 'runtime-backends',
          officialSurface: 'Local, Docker, SSH, Modal, Daytona',
          status: 'partial',
          verificationCommands: ['npx tsx src/index.ts hermes runtime status --json'],
        },
      ],
      todoCommand: 'buddy hermes todo --json',
    });
    (window as unknown as {
      electronAPI?: {
        tools?: {
          hermesFeatureParity?: {
            get: typeof get;
          };
        };
      };
    }).electronAPI = {
      tools: {
        hermesFeatureParity: {
          get,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesFeatureParityStrip));
      await Promise.resolve();
    });

    expect(get).toHaveBeenCalledWith();
    expect(target.textContent).toContain('Runtime backends');
    expect(target.textContent).toContain('5/20 major areas');
    expect(target.textContent).toContain('buddy hermes todo --json');
  });
});
