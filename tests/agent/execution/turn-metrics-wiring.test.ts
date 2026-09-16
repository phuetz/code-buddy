import { describe, expect, it, vi } from 'vitest';
import {
  AgentExecutor,
  type ExecutorConfig,
  type ExecutorDependencies,
} from '../../../src/agent/execution/agent-executor.js';
import type { CodeBuddyClient } from '../../../src/codebuddy/client.js';
import type { ToolHandler } from '../../../src/agent/tool-handler.js';
import type { ToolSelectionStrategy } from '../../../src/agent/execution/tool-selection-strategy.js';
import type { StreamingHandler } from '../../../src/agent/streaming/index.js';
import type { ContextManagerV2 } from '../../../src/context/context-manager-v2.js';
import type { TokenCounter } from '../../../src/utils/token-counter.js';

describe('AgentExecutor turn-metrics wiring', () => {
  it('enables precise provider metrics from the authoritative runTurnLoop', async () => {
    const chatStream = vi.fn(async function* () {
      yield { choices: [{ delta: { content: 'hello' } }] };
    });
    const dependencies: ExecutorDependencies = {
      client: {
        chatStream,
        getCurrentModel: () => 'qwen3:4b-instruct',
        getProviderName: () => 'Local',
        isSubscriptionAuth: () => false,
      } as unknown as CodeBuddyClient,
      toolHandler: {
        getWorkingDirectory: () => process.cwd(),
        getRunId: () => undefined,
        setRunId: () => undefined,
      } as unknown as ToolHandler,
      toolSelectionStrategy: {
        selectToolsForQuery: async () => ({
          tools: [],
          selection: null,
          fromCache: false,
          query: 'hello',
          timestamp: new Date(),
        }),
        cacheTools: () => undefined,
        shouldUseSearchFor: () => false,
      } as unknown as ToolSelectionStrategy,
      streamingHandler: {
        reset: () => undefined,
        accumulateChunk: () => ({
          displayContent: 'hello',
          rawContent: 'hello',
          hasNewToolCalls: false,
          shouldEmitTokenCount: false,
        }),
        flushDisplayContent: () => '',
        extractToolCalls: () => ({ toolCalls: [], remainingContent: '' }),
        getAccumulatedMessage: () => ({ content: 'hello', tool_calls: undefined }),
        getTokenCount: () => 1,
        hasYieldedToolCalls: () => false,
      } as unknown as StreamingHandler,
      contextManager: {
        shouldAutoCompact: () => false,
        getStats: () => ({ isNearLimit: false }),
        shouldWarn: () => ({ warn: false }),
      } as unknown as ContextManagerV2,
      tokenCounter: {
        countTokens: () => 1,
        countMessageTokens: () => 2,
      } as unknown as TokenCounter,
    };
    const config: ExecutorConfig = {
      maxToolRounds: 1,
      isGrokModel: () => false,
      recordSessionCost: () => undefined,
      isSessionCostLimitReached: () => false,
      estimateSessionCostLimitReached: () => false,
      getSessionCost: () => 0,
      getSessionCostLimit: () => 10,
    };

    await new AgentExecutor(dependencies, config).processUserMessage(
      'hello',
      [],
      [],
      Date.now(),
      undefined,
      false,
      'http',
    );

    const options = chatStream.mock.calls[0]?.[2] as {
      turnMetrics?: {
        inputTokens?: number;
        getOutputTokens?: () => number;
      };
    };
    expect(options.turnMetrics?.inputTokens).toBe(2);
    expect(options.turnMetrics?.getOutputTokens?.()).toBe(1);
  });
});
