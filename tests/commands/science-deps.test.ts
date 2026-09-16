/**
 * `buddy science` deps wiring — F1 regression: the Verifier review must ACTUALLY
 * run.
 *
 * The bug: `reviewWithVerifier` fetched the agent registry singleton, but the
 * `buddy science` path never calls `initializeAgentRegistry()`, so the registry
 * was EMPTY. `executeOn('verifier', …)` then returned "Agent not found: verifier"
 * and the review collapsed to the dead sentinel evidence `'no verifier output'`
 * with a permanent NEEDS REVIEW — the independent review was a 100% no-op.
 *
 * The fix populates the built-in agents when the registry is empty (the same
 * guard `executeSpecializedTask` uses). This test proves the verifier now runs
 * and returns a REAL verdict. The LLM boundary is mocked so there is zero network.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the LLM client so the verifier's single-shot review is deterministic.
vi.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: class {
    async chat(): Promise<{ choices: Array<{ message: { content: string } }> }> {
      return {
        choices: [
          {
            message: {
              content:
                'WHAT WAS VERIFIED: internal consistency of the report.\n' +
                'RESULT PER CHECK: consistency — pass.\n' +
                'FINAL VERDICT: CONFIRMED — the conclusions follow from the shown output.',
            },
          },
        ],
      };
    }
  },
}));

import { buildScienceDeps } from '../../src/commands/science/deps.js';
import {
  getAgentRegistry,
  resetAgentRegistry,
} from '../../src/agent/specialized/agent-registry.js';
import type { ResolvedCommandProvider } from '../../src/commands/llm-provider-resolution.js';

const provider: ResolvedCommandProvider = {
  apiKey: 'test-key',
  model: 'test-model',
  baseURL: 'http://127.0.0.1:0',
};

describe('buddy science deps — F1: the Verifier review runs (registry populated)', () => {
  beforeEach(async () => {
    // Start from an EMPTY singleton — exactly the `buddy science` situation that
    // made the review a permanent no-op before the fix.
    await resetAgentRegistry();
    expect(getAgentRegistry().getAll()).toHaveLength(0);
  });

  it('returns a REAL fail-closed verdict instead of the dead "no verifier output" sentinel', async () => {
    const deps = buildScienceDeps({ provider, language: 'python' });

    const verdict = await deps.review(
      { report: '# Experiment\n\naccuracy=0.90 measured; the hypothesis is supported by stdout.' },
      { hypothesis: 'focal loss improves minority recall', source: 'user' },
    );

    // The regression guard: pre-fix, the empty registry made executeOn return
    // "Agent not found: verifier" ⇒ evidence collapsed to this exact sentinel.
    expect(verdict.evidence).not.toBe('no verifier output');
    expect(verdict.evidence.length).toBeGreaterThan(0);
    // A verifier may no longer confirm from model prose alone: without a real
    // oracle call the hardened verifier must retain its evidence but fail closed.
    expect(verdict.verdict).toBe('NEEDS REVIEW');
    expect(verdict.evidence).toMatch(/without running an oracle/i);
  });

  it('populates the built-in agents (incl. the verifier) on the science path', async () => {
    const deps = buildScienceDeps({ provider, language: 'python' });
    await deps.review(
      { report: '# R\n\naccuracy=0.5' },
      { hypothesis: 'h', source: 'user' },
    );
    // The fix registered the built-ins into the previously-empty singleton.
    expect(getAgentRegistry().getAll().length).toBeGreaterThan(0);
    expect(getAgentRegistry().get('verifier')).toBeDefined();
  });
});
