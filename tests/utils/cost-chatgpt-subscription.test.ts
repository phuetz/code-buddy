/**
 * Phase d.25 — tests for cost=0 on ChatGPT subscription models.
 *
 * The Codex backend (chatgpt.com/backend-api/codex/responses) bills
 * against the user's flat-fee Plus/Pro plan, NOT per token. Reporting
 * USD spend would be misleading. Both `cost-tracker.calculateCost()`
 * and `token-display.estimateCost()` zero out for matching slugs.
 *
 * The detection is intentionally conservative — only slugs the OpenAI
 * Platform API does NOT also expose are zeroed out. `gpt-5` and
 * `gpt-5.1` (without `-codex`) keep normal pricing because they're also
 * billable via API key auth.
 */

import { describe, it, expect } from 'vitest';
import { CostTracker } from '../../src/utils/cost-tracker.js';
import { estimateCost } from '../../src/utils/token-display.js';

describe('CostTracker.calculateCost — ChatGPT subscription zeroing', () => {
  // Use disabled-tracking config so the test doesn't write to disk.
  const tracker = new CostTracker({ trackHistory: false });

  it('returns 0 for gpt-5.5 (Codex-backend exclusive)', () => {
    expect(tracker.calculateCost(1000, 500, 'gpt-5.5')).toBe(0);
  });

  it('returns 0 for gpt-5.2 when routed through ChatGPT OAuth fallback', () => {
    expect(tracker.calculateCost(1000, 500, 'gpt-5.2')).toBe(0);
  });

  it('returns 0 for any *-codex model variant', () => {
    expect(tracker.calculateCost(1000, 500, 'gpt-5.1-codex')).toBe(0);
    expect(tracker.calculateCost(1000, 500, 'gpt-5-codex')).toBe(0);
    expect(tracker.calculateCost(1000, 500, 'gpt-5.1-codex-max')).toBe(0);
    expect(tracker.calculateCost(1000, 500, 'gpt-5.3-codex')).toBe(0);
  });

  it('returns 0 for codex-1 and codex-mini families', () => {
    expect(tracker.calculateCost(1000, 500, 'codex-1')).toBe(0);
    expect(tracker.calculateCost(1000, 500, 'codex-mini-latest')).toBe(0);
  });

  it('returns NON-zero for gpt-5 and gpt-5.1 (also billable via API key)', () => {
    expect(tracker.calculateCost(1000, 500, 'gpt-5')).toBeGreaterThan(0);
    expect(tracker.calculateCost(1000, 500, 'gpt-5.1')).toBeGreaterThan(0);
    expect(tracker.calculateCost(1000, 500, 'gpt-5.4')).toBeGreaterThan(0);
  });

  it('returns NON-zero for unrelated models (grok, claude, gemini)', () => {
    expect(tracker.calculateCost(1000, 500, 'grok-3-fast')).toBeGreaterThan(0);
    expect(tracker.calculateCost(1000, 500, 'claude-opus-4-6')).toBeGreaterThan(0);
    expect(tracker.calculateCost(1000, 500, 'gpt-4o')).toBeGreaterThan(0);
  });

  it('case-insensitive matching', () => {
    expect(tracker.calculateCost(1000, 500, 'GPT-5.5')).toBe(0);
    expect(tracker.calculateCost(1000, 500, 'Gpt-5-Codex')).toBe(0);
  });
});

describe('estimateCost (token-display) — same zeroing as CostTracker', () => {
  it('returns 0 for gpt-5.5 when model is passed', () => {
    expect(estimateCost(1000, 500, undefined, undefined, 'gpt-5.5')).toBe(0);
  });

  it('returns 0 for gpt-5.2 when model is passed', () => {
    expect(estimateCost(1000, 500, undefined, undefined, 'gpt-5.2')).toBe(0);
  });

  it('returns 0 for *-codex models when model is passed', () => {
    expect(estimateCost(1000, 500, undefined, undefined, 'gpt-5.1-codex')).toBe(0);
    expect(estimateCost(1000, 500, undefined, undefined, 'gpt-5-codex')).toBe(0);
  });

  it('returns NON-zero when no model passed (back-compat)', () => {
    expect(estimateCost(1000, 500)).toBeGreaterThan(0);
  });

  it('returns NON-zero for billable models even with model param', () => {
    expect(estimateCost(1000, 500, undefined, undefined, 'grok-3-fast')).toBeGreaterThan(0);
    expect(estimateCost(1000, 500, undefined, undefined, 'gpt-4o')).toBeGreaterThan(0);
  });
});
