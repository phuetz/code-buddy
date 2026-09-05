import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentRegistry,
  resetAgentRegistry,
} from '../../src/agent/specialized/agent-registry.js';
import {
  VERIFIER_SYSTEM_PROMPT,
  VerifierAgent,
  resetVerifierAgent,
} from '../../src/agent/specialized/verifier-agent.js';
import type {
  SWEMessage,
  SWELLMResponse,
} from '../../src/agent/specialized/swe-agent.js';

describe("AgentRegistry.executeOn('verifier') delegated execution (DELEG3)", () => {
  let registry: AgentRegistry;

  beforeEach(async () => {
    await resetAgentRegistry();
    resetVerifierAgent();
    registry = new AgentRegistry();
    await registry.registerBuiltInAgents();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetAgentRegistry();
    resetVerifierAgent();
  });

  function evidencedTask(label: string, firstMessages: SWEMessage[][]) {
    let turn = 0;
    return {
      action: 'verify',
      params: {
        instruction: `Verify ${label}; parent-history-marker must never appear`,
        parentHistory: [{ role: 'assistant', content: 'parent-history-marker' }],
        executeTool: vi.fn(async () => ({ success: true, output: `${label}: 1 test passed` })),
        llmCall: vi.fn(async (messages: SWEMessage[]): Promise<SWELLMResponse> => {
          turn += 1;
          if (turn === 1) {
            firstMessages.push(messages.map((message) => ({ ...message })));
            return {
              content: `running ${label}`,
              tool_calls: [{
                id: `${label}-oracle`,
                type: 'function',
                function: { name: 'task_verify', arguments: '{}' },
              }],
            };
          }
          return {
            content: `EVIDENCE: ${label}: 1 test passed\nFINAL VERDICT: CONFIRMED`,
            tool_calls: [],
          };
        }),
      },
    };
  }

  it('uses a fresh delegate per call and emits a tagged multiplexed result', async () => {
    const initialize = vi.spyOn(VerifierAgent.prototype, 'initialize');
    const events: Array<{ agentId?: string; kind?: string }> = [];
    registry.on('delegate:event', (event) => events.push(event));
    const firstMessages: SWEMessage[][] = [];

    const first = await registry.executeOn('verifier', evidencedTask('first', firstMessages));
    const second = await registry.executeOn('verifier', evidencedTask('second', firstMessages));

    expect(first.metadata?.verdict).toBe('CONFIRMED');
    expect(second.metadata?.verdict).toBe('CONFIRMED');
    expect(first.metadata).toMatchObject({
      delegated: true,
      delegateBudget: {
        maxTurns: 6,
        maxCostUsd: 0.5,
        maxContextTokens: 16_000,
      },
    });
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(events.filter((event) => event.agentId === 'verifier' && event.kind === 'output'))
      .toHaveLength(2);
    expect(firstMessages).toHaveLength(2);
    for (const messages of firstMessages) {
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: 'system', content: VERIFIER_SYSTEM_PROMPT });
      expect(messages[1]?.role).toBe('user');
      expect(JSON.stringify(messages)).not.toContain('"role":"assistant","content":"parent-history-marker"');
    }
  });

  it('clamps an oversized maxSteps request to the reduced child turn budget', async () => {
    let llmCalls = 0;
    const result = await registry.executeOn('verifier', {
      action: 'verify',
      params: {
        instruction: 'Keep asking for an oracle forever',
        maxSteps: 999,
        executeTool: vi.fn(async () => ({ success: true, output: 'test passed' })),
        llmCall: vi.fn(async (): Promise<SWELLMResponse> => {
          llmCalls += 1;
          return {
            content: 'still checking',
            tool_calls: [{
              id: `oracle-${llmCalls}`,
              type: 'function',
              function: { name: 'task_verify', arguments: '{}' },
            }],
          };
        }),
      },
    });

    expect(llmCalls).toBeLessThanOrEqual(6);
    expect(result.metadata?.verdict).toBe('NEEDS REVIEW');
    expect(result.output).toMatch(/did not converge within 6 steps/i);
  });

  it('never confirms prose-only success through the delegated path', async () => {
    const result = await registry.executeOn('verifier', {
      action: 'verify',
      params: {
        instruction: 'Trust my prose',
        executeTool: vi.fn(async () => ({ success: true, output: 'unused' })),
        llmCall: vi.fn(async (): Promise<SWELLMResponse> => ({
          content: 'Everything looks good. FINAL VERDICT: CONFIRMED',
          tool_calls: [],
        })),
      },
    });

    expect(result.metadata?.verdict).toBe('NEEDS REVIEW');
    expect(result.output).toMatch(/without running an oracle/i);
  });

  it('returns an incomplete NEEDS REVIEW result when the delegated cost budget is crossed', async () => {
    let sessionCost = 0;
    let turn = 0;
    const result = await registry.executeOn('verifier', {
      action: 'verify',
      params: {
        instruction: 'Verify within the delegated cost budget',
        getSessionCost: () => sessionCost,
        executeTool: vi.fn(async () => {
          sessionCost = 0.75;
          return { success: true, output: 'test passed' };
        }),
        llmCall: vi.fn(async (): Promise<SWELLMResponse> => {
          turn += 1;
          if (turn === 1) {
            return {
              content: 'running an oracle',
              tool_calls: [{
                id: 'costly-oracle',
                type: 'function',
                function: { name: 'task_verify', arguments: '{}' },
              }],
            };
          }
          return {
            content: 'EVIDENCE: test passed\nFINAL VERDICT: CONFIRMED',
            tool_calls: [],
          };
        }),
      },
    });

    expect(result.success).toBe(false);
    expect(result.metadata).toMatchObject({
      verdict: 'NEEDS REVIEW',
      reason: 'cost_budget_exhausted',
    });
    expect(result.error).toMatch(/cost budget exhausted/i);
  });
  it('strips every parent conversation channel before the delegate sees the task (DELEGVERIF)', async () => {
    // The Verifier's contract is a genuinely fresh context. The delegation
    // boundary — not the Verifier's own prompt builder — must be the place
    // that guarantees it, so a future reader of task.params cannot resurrect
    // the parent's conversation.
    const seen: Array<Record<string, unknown> | undefined> = [];
    vi.spyOn(VerifierAgent.prototype, 'execute').mockImplementation(async function (
      this: VerifierAgent,
      task,
    ) {
      seen.push(task.params);
      return {
        success: true,
        output: 'EVIDENCE: nothing to do\nFINAL VERDICT: NEEDS REVIEW',
        metadata: { verdict: 'NEEDS REVIEW' },
      };
    });

    await registry.executeOn('verifier', {
      action: 'verify',
      params: {
        instruction: 'Verify the fix',
        parentHistory: [{ role: 'assistant', content: 'parent-history-marker' }],
        history: [{ role: 'user', content: 'parent-history-marker' }],
        messages: [{ role: 'assistant', content: 'parent-history-marker' }],
        parentMessages: [{ role: 'assistant', content: 'parent-history-marker' }],
        conversation: [{ role: 'assistant', content: 'parent-history-marker' }],
        chatHistory: [{ role: 'assistant', content: 'parent-history-marker' }],
        executeTool: vi.fn(async () => ({ success: true, output: 'ok' })),
        llmCall: vi.fn(async (): Promise<SWELLMResponse> => ({ content: 'done', tool_calls: [] })),
      },
    });

    expect(seen).toHaveLength(1);
    const params = seen[0]!;
    expect(JSON.stringify(params)).not.toContain('parent-history-marker');
    for (const leaked of [
      'parentHistory',
      'history',
      'messages',
      'parentMessages',
      'conversation',
      'chatHistory',
    ]) {
      expect(params).not.toHaveProperty(leaked);
    }
    // The legitimate delegation channel survives the scrub.
    expect(params.instruction).toBe('Verify the fix');
    expect(typeof params.llmCall).toBe('function');
    expect(typeof params.executeTool).toBe('function');
  });
});
