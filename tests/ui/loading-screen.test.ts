import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('ink', () => ({
  Text: ({ children }: { children?: React.ReactNode }) => children,
  Box: ({ children }: { children?: React.ReactNode }) => children,
}));

import {
  isLoadingScreenDisabled,
  LOADING_SCREEN_TITLE,
} from '../../src/ui/loading-screen.js';
import { StartupScreen } from '../../src/ui/components/StartupScreen.js';

describe('isLoadingScreenDisabled', () => {
  const env = (value?: string): NodeJS.ProcessEnv => {
    const next: NodeJS.ProcessEnv = {};
    if (value !== undefined) next.CODEBUDDY_NO_LOADING_SCREEN = value;
    return next;
  };

  it('is enabled by default (splash shown)', () => {
    expect(isLoadingScreenDisabled(env())).toBe(false);
    expect(isLoadingScreenDisabled(env(''))).toBe(false);
    expect(isLoadingScreenDisabled(env('0'))).toBe(false);
    expect(isLoadingScreenDisabled(env('false'))).toBe(false);
  });

  it('is disabled by CODEBUDDY_NO_LOADING_SCREEN=1 (and aliases)', () => {
    expect(isLoadingScreenDisabled(env('1'))).toBe(true);
    expect(isLoadingScreenDisabled(env('true'))).toBe(true);
    expect(isLoadingScreenDisabled(env('YES'))).toBe(true);
    expect(isLoadingScreenDisabled(env(' on '))).toBe(true);
  });

  it('is disabled by --no-loading-screen even without the env var', () => {
    expect(isLoadingScreenDisabled(env(), true)).toBe(true);
    expect(isLoadingScreenDisabled(env('0'), true)).toBe(true);
  });
});

describe('StartupScreen', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the documented Starting Code Buddy splash copy', () => {
    const element = StartupScreen();
    const text = collectText(element);
    expect(text).toContain(LOADING_SCREEN_TITLE);
    expect(text).toContain('Loading the coding assistant.');
  });
});

function collectText(node: unknown, depth = 0): string {
  if (depth > 20 || node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((child) => collectText(child, depth + 1)).join('');
  if (React.isValidElement(node)) {
    const { props, type } = node as React.ReactElement<{ children?: unknown }>;
    if (typeof type === 'function') {
      try {
        const rendered = (type as (p: unknown) => unknown)(props);
        return collectText(rendered, depth + 1);
      } catch {
        return collectText(props?.children, depth + 1);
      }
    }
    return collectText(props?.children, depth + 1);
  }
  return '';
}
