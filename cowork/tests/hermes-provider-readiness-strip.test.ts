/**
 * @vitest-environment happy-dom
 */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HermesProviderReadinessStrip,
  type HermesProviderReadinessReview,
} from '../src/renderer/components/hermes-provider-readiness-strip';

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

const readyProvider: HermesProviderReadinessReview = {
  command: 'buddy hermes providers status --json',
  ok: true,
  activeModel: {
    contextWindow: 200000,
    maxOutputTokens: 64000,
    model: 'gpt-5.5',
    provider: 'openai',
    source: 'environment model',
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
  },
  activeProvider: {
    baseUrl: null,
    configured: true,
    credentialSources: ['OPENAI_API_KEY'],
    label: 'OpenAI / Codex-compatible',
    local: false,
    setupCommands: [],
  },
  configuredProviderCount: 1,
  issues: [],
  portal: {
    credentialPresent: true,
    credentialSources: ['CODEBUDDY_NOUS_ACCESS_TOKEN'],
    directFallbackCount: 3,
    managedByNousCount: 2,
    toolGatewayConfigured: true,
  },
  providerCount: 8,
  recommendations: ['Run buddy hermes portal status --json.'],
};

const missingProvider: HermesProviderReadinessReview = {
  ...readyProvider,
  ok: false,
  activeProvider: {
    ...readyProvider.activeProvider,
    configured: false,
    credentialSources: [],
    setupCommands: ['buddy login', 'buddy --setup'],
  },
  issues: ['Active provider OpenAI / Codex-compatible has no detected credential or local endpoint.'],
};

describe('HermesProviderReadinessStrip', () => {
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

  it('renders model/provider readiness and the safe CLI command', () => {
    const target = container();
    const openSettings = vi.fn();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(HermesProviderReadinessStrip, {
          onOpenSettings: openSettings,
          readiness: readyProvider,
        }),
      );
    });

    const strip = target.querySelector('[data-testid="fleet-hermes-provider-readiness"]');
    expect(strip?.textContent).toContain('Hermes provider readiness');
    expect(strip?.textContent).toContain('ready');
    expect(strip?.textContent).toContain('gpt-5.5');
    expect(strip?.textContent).toContain('OpenAI / Codex-compatible');
    expect(strip?.textContent).toContain('configured');
    expect(strip?.textContent).toContain('2 managed');
    expect(strip?.textContent).toContain('tool-calls=yes');
    expect(strip?.textContent).toContain('reasoning=yes');
    expect(strip?.textContent).toContain('vision=yes');
    expect(strip?.textContent).toContain('1/8 providers');
    expect(strip?.textContent).toContain('Context/output: 200000 / 64000 tokens');
    expect(strip?.textContent).toContain('buddy hermes providers status --json');
    expect(strip?.textContent).not.toContain('Setupbuddy login');

    const button = target.querySelector('button');
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('renders the first safe provider setup command when credentials are missing', () => {
    const target = container();
    root = createRoot(target);

    act(() => {
      root?.render(
        React.createElement(HermesProviderReadinessStrip, {
          readiness: missingProvider,
        }),
      );
    });

    expect(target.textContent).toContain('attention');
    expect(target.textContent).toContain('missing');
    expect(target.textContent).toContain('Setup');
    expect(target.textContent).toContain('buddy login');
  });

  it('loads readiness from the readonly Electron bridge when no prop is provided', async () => {
    const target = container();
    const get = vi.fn().mockResolvedValue(readyProvider);
    (window as unknown as {
      electronAPI?: {
        tools?: {
          hermesProviderReadiness?: {
            get: typeof get;
          };
        };
      };
    }).electronAPI = {
      tools: {
        hermesProviderReadiness: {
          get,
        },
      },
    };
    root = createRoot(target);

    await act(async () => {
      root?.render(React.createElement(HermesProviderReadinessStrip));
      await Promise.resolve();
    });

    expect(get).toHaveBeenCalledWith();
    expect(target.textContent).toContain('gpt-5.5');
    expect(target.textContent).toContain('2 managed');
  });
});
