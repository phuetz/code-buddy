import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundaryMocks = vi.hoisted(() => ({
  chat: vi.fn(),
  prepare: vi.fn(),
  command: vi.fn(),
}));

vi.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: vi.fn(function MockCodeBuddyClient() {
    return { chat: boundaryMocks.chat };
  }),
}));

vi.mock('../../src/context/tool-observation-optimizer.js', () => ({
  optimizeToolObservation: boundaryMocks.prepare,
}));

vi.mock('../../src/agent/prompt-tool-observation.js', () => ({
  prepareToolObservationForPrompt: boundaryMocks.prepare,
  commandFromToolArguments: boundaryMocks.command,
}));

import { BaseAgent } from '../../src/agent/multi-agent/base-agent.js';
import type {
  AgentConfig,
  AgentTask,
  SharedContext,
} from '../../src/agent/multi-agent/types.js';
import { Subagent } from '../../src/agent/subagents.js';
import { createSWEAgent, type SWELLMResponse } from '../../src/agent/specialized/swe-agent.js';
import {
  DelegateAgentTool,
  resetDelegateAgentProvider,
  setDelegateAgentProvider,
} from '../../src/tools/registry/delegate-agent-tools.js';
import { createAcpAgenticRunner } from '../../src/protocols/acp/acp-agentic-runner.js';
import type { AcpPromptContext } from '../../src/protocols/acp/acp-stdio-server.js';
import type { CodeBuddyMessage, CodeBuddyTool } from '../../src/codebuddy/client.js';

class TestBaseAgent extends BaseAgent {}

const RESTORE_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'restore_context',
    description: 'restore',
    parameters: {
      type: 'object',
      properties: { identifier: { type: 'string' } },
      required: ['identifier'],
    },
  },
};

const BASH_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'bash',
    description: 'bash',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
};

function snapshot(messages: ReadonlyArray<CodeBuddyMessage>): CodeBuddyMessage[] {
  return structuredClone(messages) as CodeBuddyMessage[];
}

describe('secondary LLM tool-observation boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDelegateAgentProvider();
    boundaryMocks.command.mockReturnValue('npm test');
    boundaryMocks.prepare.mockImplementation(async (input: { content: string }) => ({
      content: `compact:${input.content}`,
      rawContent: input.content,
      optimized: true,
      reason: 'optimized',
    }));
  });

  it('optimizes BaseAgent prompt history and preserves model/workspace context', async () => {
    const seen: CodeBuddyMessage[][] = [];
    boundaryMocks.chat.mockImplementation(async (messages: CodeBuddyMessage[]) => {
      seen.push(snapshot(messages));
      if (seen.length === 1) {
        return {
          choices: [{
            message: {
              content: '',
              tool_calls: [{
                id: 'call_base',
                type: 'function',
                function: { name: 'bash', arguments: '{"command":"npm test"}' },
              }],
            },
          }],
        };
      }
      return { choices: [{ message: { content: 'done', tool_calls: [] } }] };
    });

    const config: AgentConfig = {
      role: 'coder',
      name: 'test',
      description: 'test',
      systemPrompt: 'test',
      model: 'model-base',
      allowedTools: ['bash'],
      capabilities: ['code_generation'],
    };
    const task: AgentTask = {
      id: 'task-1',
      title: 'Fix tests',
      description: 'Repair the failing suite',
      status: 'in_progress',
      priority: 'high',
      assignedTo: 'coder',
      dependencies: [],
      subtasks: [],
      artifacts: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const context: SharedContext = {
      goal: 'green tests',
      codebaseInfo: {
        rootPath: '/workspace/base',
        language: 'TypeScript',
        structure: { name: 'base', type: 'directory', path: '/workspace/base' },
        dependencies: [],
        entryPoints: [],
      },
      relevantFiles: [],
      conversationHistory: [],
      artifacts: new Map(),
      decisions: [],
      constraints: [],
    };

    const agent = new TestBaseAgent(config, 'key');
    const executeTool = vi.fn().mockResolvedValue({
      success: false,
      output: 'PARTIAL BASE STDOUT',
      error: 'LATE BASE ERROR',
    });
    const result = await agent.execute(
      task,
      context,
      [BASH_TOOL, RESTORE_TOOL],
      executeTool,
    );

    expect(result.success).toBe(true);
    const baseRecovery = '[tool output]\nPARTIAL BASE STDOUT\n\n[tool error]\nLATE BASE ERROR';
    expect(seen[1]?.find((message) => message.role === 'tool')?.content)
      .toBe(`compact:${baseRecovery}`);
    expect(boundaryMocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'bash',
      toolCallId: 'call_base',
      content: baseRecovery,
      workspaceRoot: '/workspace/base',
      model: 'model-base',
      allowOptimization: true,
      sessionId: expect.any(String),
    }));
    const baseRecoverySession = boundaryMocks.prepare.mock.calls[0]?.[0]?.sessionId;
    expect(executeTool).toHaveBeenCalledWith(expect.objectContaining({ id: 'call_base' }), {
      recoverySessionId: baseRecoverySession,
    });
    expect((boundaryMocks.chat.mock.calls[0]?.[1] as CodeBuddyTool[])
      .map((tool) => tool.function.name)).toContain('restore_context');
  });

  it('optimizes Subagent history only when restore_context is exposed', async () => {
    const seen: CodeBuddyMessage[][] = [];
    boundaryMocks.chat.mockImplementation(async (messages: CodeBuddyMessage[]) => {
      seen.push(snapshot(messages));
      if (seen.length === 1) {
        return {
          choices: [{ message: {
            content: '',
            tool_calls: [{
              id: 'call_sub',
              type: 'function',
              function: { name: 'bash', arguments: '{"command":"npm test"}' },
            }],
          } }],
        };
      }
      return { choices: [{ message: { content: 'done' } }] };
    });

    const agent = new Subagent('key', {
      name: 'sub',
      description: 'sub',
      systemPrompt: 'sub',
      tools: ['bash'],
      model: 'model-sub',
    });
    const executeTool = vi.fn().mockResolvedValue({ success: true, output: 'RAW SUB' });
    const result = await agent.run(
      'Inspect tests',
      undefined,
      [BASH_TOOL, RESTORE_TOOL],
      executeTool,
      { workspaceRoot: '/workspace/sub' },
    );

    expect(result.success).toBe(true);
    expect(seen[1]?.find((message) => message.role === 'tool')?.content).toBe('compact:RAW SUB');
    expect(boundaryMocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'call_sub',
      workspaceRoot: '/workspace/sub',
      model: 'model-sub',
      allowOptimization: true,
      sessionId: expect.any(String),
    }));
    const subagentRecoverySession = boundaryMocks.prepare.mock.calls[0]?.[0]?.sessionId;
    expect(executeTool).toHaveBeenCalledWith(expect.objectContaining({ id: 'call_sub' }), {
      recoverySessionId: subagentRecoverySession,
    });
  });

  it('feeds optimized SWE observations to the next LLM call', async () => {
    const seen: Array<ReadonlyArray<{ role: string; content: string }>> = [];
    const llmCall = vi.fn(async (messages): Promise<SWELLMResponse> => {
      seen.push(structuredClone(messages));
      if (seen.length === 1) {
        return {
          content: '',
          tool_calls: [{
            id: 'call_swe',
            type: 'function',
            function: { name: 'bash', arguments: '{"command":"cargo test"}' },
          }],
        };
      }
      return { content: 'done', tool_calls: [] };
    });
    const agent = createSWEAgent({
      maxSteps: 3,
      maxObserve: 10_000,
      llmCall,
      executeTool: vi.fn().mockResolvedValue({
        success: false,
        output: 'PARTIAL SWE STDOUT',
        error: 'LATE SWE ERROR',
      }),
      model: 'model-swe',
      workspaceRoot: '/workspace/swe',
    });

    await agent.run('Repair Rust tests');

    const sweRecovery = '[tool output]\nPARTIAL SWE STDOUT\n\n[tool error]\nLATE SWE ERROR';
    expect(seen[1]?.find((message) => message.role === 'tool')?.content)
      .toBe(`compact:${sweRecovery}`);
    expect(boundaryMocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'call_swe',
      content: sweRecovery,
      fallbackContent: `Error: ${sweRecovery}`,
      query: 'Repair Rust tests',
      workspaceRoot: '/workspace/swe',
      model: 'model-swe',
      allowOptimization: true,
      sessionId: expect.any(String),
    }));
  });

  it('keeps the caller workspace through delegate_agent into SWE observations', async () => {
    const seen: Array<ReadonlyArray<{ role: string; content: string }>> = [];
    const llmCall = vi.fn(async (messages): Promise<SWELLMResponse> => {
      seen.push(structuredClone(messages));
      if (seen.length === 1) {
        return {
          content: '',
          tool_calls: [{
            id: 'call_delegated_swe',
            type: 'function',
            function: { name: 'bash', arguments: '{"command":"npm test"}' },
          }],
        };
      }
      return { content: 'delegated done', tool_calls: [] };
    });
    const executeTool = vi.fn().mockResolvedValue({
      success: false,
      output: 'DELEGATED PARTIAL OUTPUT',
      error: 'DELEGATED LATE ERROR',
    });
    setDelegateAgentProvider(() => ({ llmCall, executeTool }));

    const result = await new DelegateAgentTool().execute({
      agent: 'swe',
      instruction: 'Repair delegated tests',
      params: {
        maxSteps: 3,
        model: 'model-delegated-swe',
        workspaceRoot: '/workspace/untrusted-param',
      },
    }, {
      cwd: '/workspace/from-tool-context',
    });

    expect(result.success).toBe(true);
    const recovery = '[tool output]\nDELEGATED PARTIAL OUTPUT\n\n' +
      '[tool error]\nDELEGATED LATE ERROR';
    expect(seen[1]?.find((message) => message.role === 'tool')?.content)
      .toBe(`compact:${recovery}`);
    expect(boundaryMocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'call_delegated_swe',
      content: recovery,
      workspaceRoot: '/workspace/from-tool-context',
      model: 'model-delegated-swe',
      sessionId: expect.any(String),
    }));
    const recoverySessionId = boundaryMocks.prepare.mock.calls[0]?.[0]?.sessionId;
    expect(executeTool).toHaveBeenCalledWith('bash', { command: 'npm test' }, {
      recoverySessionId,
    });
  });

  it('keeps SWE callId recovery scoped to the native boundary copy', async () => {
    boundaryMocks.prepare.mockImplementation(async (input: {
      toolName: string;
      content: string;
    }) => input.toolName === 'restore_context'
      ? {
          content: input.content,
          rawContent: input.content,
          optimized: false,
          reason: 'restore-context',
        }
      : {
          content: 'compact native observation',
          rawContent: 'NATIVE PRE-HOOK OUTPUT',
          optimized: true,
          reason: 'optimized',
        });

    const seen: Array<ReadonlyArray<{ role: string; content: string }>> = [];
    const llmCall = vi.fn(async (messages): Promise<SWELLMResponse> => {
      seen.push(structuredClone(messages));
      if (seen.length === 1) {
        return {
          content: '',
          tool_calls: [{
            id: 'call_native_swe',
            type: 'function',
            function: { name: 'bash', arguments: '{"command":"npm test"}' },
          }],
        };
      }
      if (seen.length === 2) {
        return {
          content: '',
          tool_calls: [{
            id: 'call_restore_swe',
            type: 'function',
            function: {
              name: 'restore_context',
              arguments: '{"identifier":"call_native_swe"}',
            },
          }],
        };
      }
      return { content: 'done', tool_calls: [] };
    });
    const executeTool = vi.fn().mockResolvedValue({
      success: true,
      output: 'later sanitized output',
    });
    const agent = createSWEAgent({
      maxSteps: 4,
      maxObserve: 10_000,
      llmCall,
      executeTool,
    });

    await agent.run('Recover the native output');

    expect(executeTool).toHaveBeenCalledTimes(1);
    const restoredToolMessage = seen[2]
      ?.filter((message) => message.role === 'tool')
      .at(-1);
    expect(restoredToolMessage?.content).toBe('NATIVE PRE-HOOK OUTPUT');
    expect(boundaryMocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'restore_context',
      content: 'NATIVE PRE-HOOK OUTPUT',
    }));
  });

  it('keeps ACP updates raw while only the next LLM prompt receives optimization', async () => {
    const seen: CodeBuddyMessage[][] = [];
    const fullFile = Array.from(
      { length: 30 },
      (_, index) => `export const value${index} = ${index};`,
    ).join('\n');
    const chat = vi.fn(async (messages: CodeBuddyMessage[]) => {
      seen.push(snapshot(messages));
      if (seen.length === 1) {
        return {
          choices: [{ message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_acp',
              type: 'function',
              function: { name: 'view_file', arguments: '{"file_path":"big.ts"}' },
            }],
          } }],
        };
      }
      return { choices: [{ message: { role: 'assistant', content: 'done', tool_calls: [] } }] };
    });
    const updates: Array<Record<string, unknown>> = [];
    const controller = new AbortController();
    const acpHome = path.resolve('_qa/acp/home');
    fs.mkdirSync(acpHome, { recursive: true });
    const workspace = fs.mkdtempSync(path.join(acpHome, 'observation-'));
    const ctx = {
      sessionId: 'session-1',
      cwd: workspace,
      clientCapabilities: {},
      saveConversation: vi.fn(),
      prompt: [{ type: 'text', text: 'Read big.ts' }],
      signal: controller.signal,
      canRequestClient: (method: string) => method === 'fs/read_text_file',
      requestClient: vi.fn().mockResolvedValue({ content: fullFile }),
      sendUpdate: (update: Record<string, unknown>) => updates.push(update),
    } as unknown as AcpPromptContext;

    const runner = createAcpAgenticRunner({
      apiKey: '', model: 'model-acp',
      modelClient: {
        getCurrentModel: () => 'model-acp',
        probeToolSupport: async () => true,
        chatStream: async function* (messages) {
          const response = await chat(messages as CodeBuddyMessage[]);
          const message = response.choices[0]!.message;
          yield { choices: [{ index: 0, delta: {
            content: message.content,
            tool_calls: message.tool_calls.map((call, index) => ({ ...call, index })),
          }, finish_reason: message.tool_calls.length ? 'tool_calls' : 'stop' }] };
        },
      },
    });
    let result;
    try { result = await runner(ctx); }
    finally { await runner.dispose(); fs.rmSync(workspace, { recursive: true, force: true }); }

    expect(result.stopReason).toBe('end_turn');
    const rawUpdate = updates.find((update) => update.sessionUpdate === 'tool_call_update') as {
      content?: Array<{ content?: { text?: string } }>;
    } | undefined;
    const publicText = rawUpdate?.content?.[0]?.content?.text ?? '';
    expect(publicText).not.toContain('compact:');
    expect(publicText).toContain('export const value29 = 29;');
    expect(seen[1]?.find((message) => message.role === 'tool')?.content)
      .toContain(`compact:${publicText}`);
    expect(boundaryMocks.prepare).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'call_acp',
      content: publicText,
      query: 'Read big.ts',
      workspaceRoot: workspace,
      signal: expect.any(AbortSignal),
    }));
  });
});
