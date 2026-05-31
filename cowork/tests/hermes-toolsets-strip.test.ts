/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HermesToolsetsStrip,
  buildHermesToolsetsCommand,
  type HermesToolsetsCatalogReview,
} from '../src/renderer/components/hermes-toolsets-strip';

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

const catalog: HermesToolsetsCatalogReview = {
  activeProfile: 'safe',
  activeToolset: {
    allowGroups: ['group:fs:read'],
    allowedTools: ['view_file', 'web_search'],
    confirmGroups: ['group:web:fetch'],
    confirmTools: ['web_fetch'],
    decisions: [],
    defaultAction: 'deny',
    deniedTools: ['create_file', 'bash', 'git_push'],
    denyGroups: ['group:fs:write', 'group:runtime', 'group:git:write'],
    intent: 'Conservative read-only work.',
    label: 'Hermes-style Fleet safe toolset',
    policyProfile: 'minimal',
    profile: 'safe',
    summary: 'Safe posture: read-only by default.',
    systemPrompt: 'Be conservative.',
    toolsetId: 'fleet.hermes.safe',
  },
  command: 'buddy hermes toolsets safe --json',
  generatedAt: '2026-05-31T10:30:00.000Z',
  guidance: [],
  kind: 'hermes_toolsets_catalog',
  notes: [],
  officialSource: {
    inspectedCommit: '5921d667',
    repository: 'https://github.com/NousResearch/hermes-agent',
    sourceFiles: ['toolsets.py::TOOLSETS'],
  },
  previewTools: ['view_file', 'create_file', 'bash', 'git_push', 'web_search', 'web_fetch'],
  requestedProfile: 'safe',
  schemaVersion: 1,
  summary: {
    profiles: ['balanced', 'research', 'code', 'review', 'safe'],
    totalToolsets: 5,
  },
  toolsets: [
    {
      allowGroups: ['group:fs:read'],
      allowedTools: ['view_file', 'web_search'],
      confirmGroups: ['group:web:fetch'],
      confirmTools: ['web_fetch'],
      decisions: [],
      defaultAction: 'deny',
      deniedTools: ['create_file', 'bash', 'git_push'],
      denyGroups: ['group:fs:write', 'group:runtime', 'group:git:write'],
      intent: 'Safe intent',
      label: 'Safe',
      policyProfile: 'minimal',
      profile: 'safe',
      summary: 'Safe posture: read-only by default.',
      systemPrompt: 'Safe prompt',
      toolsetId: 'fleet.hermes.safe',
    },
    {
      allowGroups: ['group:fs:read'],
      allowedTools: ['view_file'],
      confirmGroups: ['group:runtime'],
      confirmTools: ['bash'],
      decisions: [],
      defaultAction: 'confirm',
      deniedTools: [],
      denyGroups: [],
      intent: 'Code intent',
      label: 'Code',
      policyProfile: 'coding',
      profile: 'code',
      summary: 'Code posture.',
      systemPrompt: 'Code prompt',
      toolsetId: 'fleet.hermes.code',
    },
  ],
};

describe('HermesToolsetsStrip', () => {
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

  it('renders active Hermes toolset counts and all Fleet toolset profiles', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(HermesToolsetsStrip, {
          catalog,
          error: 'bridge warning',
          profile: 'safe',
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-hermes-toolsets"]');
    expect(strip?.textContent).toContain('Hermes toolsets');
    expect(strip?.textContent).toContain('fleet.hermes.safe');
    expect(strip?.textContent).toContain('2 allow');
    expect(strip?.textContent).toContain('1 confirm');
    expect(strip?.textContent).toContain('3 deny');
    expect(strip?.textContent).toContain('5 profiles');
    expect(strip?.textContent).toContain('Safe posture: read-only by default.');
    expect(strip?.textContent).toContain('fleet.hermes.code');
    expect(strip?.textContent).toContain('Hermes toolsets load failed');
    expect(strip?.textContent).toContain('bridge warning');
    expect(strip?.textContent).toContain('buddy hermes toolsets safe --json');
  });

  it('keeps the CLI helper command stable', () => {
    expect(buildHermesToolsetsCommand('review')).toBe('buddy hermes toolsets review --json');
  });

  it('loads the catalog from the readonly Electron bridge when no catalog is provided', async () => {
    const target = container();
    const get = vi.fn().mockResolvedValue(catalog);
    (window as unknown as {
      electronAPI?: {
        tools?: {
          hermesToolsets?: {
            get: typeof get;
          };
        };
      };
    }).electronAPI = {
      tools: {
        hermesToolsets: {
          get,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesToolsetsStrip, { profile: 'safe' }));
      await Promise.resolve();
    });

    expect(get).toHaveBeenCalledWith({ profile: 'safe' });
    expect(target.textContent).toContain('fleet.hermes.safe');
    expect(target.textContent).toContain('buddy hermes toolsets safe --json');
  });
});
