import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatHeadlessPromptProgress,
  shouldShowHeadlessPromptProgress,
  startHeadlessPromptProgress,
} from '../../src/cli/headless-prompt-progress.js';

describe('headless prompt progress', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is silent without a TTY, without -p, or with --quiet', () => {
    const env = { CODEBUDDY_HEADLESS: 'true' };
    expect(shouldShowHeadlessPromptProgress(env, { isTTY: true })).toBe(true);
    expect(shouldShowHeadlessPromptProgress(env, { isTTY: false })).toBe(false);
    expect(shouldShowHeadlessPromptProgress({}, { isTTY: true })).toBe(false);
    expect(shouldShowHeadlessPromptProgress(
      { CODEBUDDY_HEADLESS: 'true', CODEBUDDY_QUIET: 'true' },
      { isTTY: true },
    )).toBe(false);
  });

  it('formats the wait line with elapsed seconds', () => {
    expect(formatHeadlessPromptProgress(10)).toBe('évaluation du prompt… (10 s)\n');
  });

  it('writes the wait line every 10s until the first token', () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const progress = startHeadlessPromptProgress({
      env: { CODEBUDDY_HEADLESS: 'true' },
      stdout: { isTTY: true },
      stderr: { write: (chunk) => { writes.push(chunk); } },
      intervalMs: 10_000,
    });
    vi.advanceTimersByTime(9_999);
    expect(writes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(writes).toEqual(['évaluation du prompt… (10 s)\n']);
    vi.advanceTimersByTime(10_000);
    expect(writes).toEqual([
      'évaluation du prompt… (10 s)\n',
      'évaluation du prompt… (20 s)\n',
    ]);
    progress.onFirstToken();
    vi.advanceTimersByTime(20_000);
    expect(writes).toHaveLength(2);
  });
});
