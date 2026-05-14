/**
 * A2A inbound TaskExecutor — Code Buddy implementation
 *
 * Wires Code Buddy as an A2A `TaskExecutor` callback so remote peers
 * can submit natural-language tasks via `POST /api/a2a/tasks/send` and
 * receive results back. The peer-driven LLM is **strictly bounded** by
 * the `fleetSafe` tool flag — only tools opted in via
 * `ToolMetadata.fleetSafe = true` are exposed.
 *
 * Architecture:
 *   - Per-task isolation: a fresh `CodeBuddyClient` is constructed per
 *     task call; no shared `chatHistory`/messages between peers.
 *   - Bounded loop: max {@link MAX_TURNS} LLM round-trips per task. If
 *     the model still wants tool calls at the cap, we terminate with a
 *     partial answer.
 *   - Cost cap: cumulative {@link MAX_TOKENS} per task; budget exceeded
 *     short-circuits with the most recent reply content.
 *   - Tool dispatch via the `FormalToolRegistry` execution surface.
 *   - Audit log: one structured `[a2a:inbound]` log line per task with
 *     metadata (no peer prompt content — that could be PII).
 *
 * Threat model (this surface):
 *   - The peer's message is treated as a normal user prompt; prompt
 *     injection is possible but bounded by the read-only tool list.
 *   - The auto-detected local provider is shared with the local user —
 *     A2A traffic counts against the same subscription/quota. Per-peer
 *     cost quotas live in V2.
 *   - Rate limiting is enforced at the route level (see
 *     `src/server/routes/a2a-protocol.ts`), not here.
 *
 * @module protocols/a2a/codebuddy-executor
 */

import { CodeBuddyClient } from '../../codebuddy/client.js';
import type {
  CodeBuddyMessage,
  CodeBuddyResponse,
  CodeBuddyToolCall,
} from '../../codebuddy/client.js';
import { getToolRegistry } from '../../tools/registry.js';
import { getFormalToolRegistry } from '../../tools/registry/tool-registry.js';
import { logger } from '../../utils/logger.js';
import { detectProviderFromEnv } from '../../utils/provider-detector.js';
import {
  TaskStatus,
  type Task,
  type TaskExecutor,
  type A2AMessage,
} from './index.js';

const MAX_TURNS = 3;
const MAX_TOKENS = 100_000;

const SYSTEM_PROMPT = `You are Code Buddy, exposed via the Agent-to-Agent (A2A) protocol.
A remote peer agent has submitted a task to you. You only have access to read-only,
search, web-query, and codebase-analysis tools — you cannot edit files, run shell
commands, or modify any state on the host. Answer the peer's task as best you can
with the tools available. If the task requires capabilities you don't have, say so
explicitly and concisely. Keep replies focused.`;

function extractMessageText(msg: A2AMessage): string {
  return msg.parts
    .filter(
      (p): p is { type: 'text'; text: string } =>
        p.type === 'text' && typeof (p as { text?: unknown }).text === 'string'
    )
    .map((p) => p.text)
    .join('\n')
    .trim();
}

function failTask(task: Task, message: string): Task {
  task.status = { status: TaskStatus.FAILED, message, timestamp: Date.now() };
  task.history.push({ ...task.status });
  return task;
}

/**
 * Build the A2A `TaskExecutor` callback that powers Code Buddy's inbound
 * surface. Returned function is safe to register multiple times — each
 * invocation builds an isolated `CodeBuddyClient`.
 */
export function createCodeBuddyTaskExecutor(): TaskExecutor {
  return async function executeCodeBuddyTask(task: Task): Promise<Task> {
    const start = Date.now();
    const peerId = String(task.metadata?.peerId ?? 'unknown');

    // Extract user message — A2A submitTask injects exactly one user
    // message into task.messages[0] before calling the executor.
    const userMessage = task.messages[0];
    const userText = userMessage ? extractMessageText(userMessage) : '';
    if (!userText) {
      return failTask(task, 'Empty user message');
    }

    // Provider credentials. Use the same auto-detection path as the CLI
    // (including ChatGPT Codex OAuth), but still fail closed if nothing
    // is configured rather than surfacing partial answers.
    const provider = detectProviderFromEnv();
    if (!provider) {
      return failTask(
        task,
        'Provider credentials not configured (run `buddy login chatgpt` or set a provider API key)',
      );
    }

    // Fleet-safe tool list — the security boundary. If the legacy
    // registry is empty (server booted without any tools registered yet),
    // we refuse rather than expose a free-form LLM with no tools.
    const fleetSafeTools = getToolRegistry().getFleetSafeTools();
    if (fleetSafeTools.length === 0) {
      return failTask(
        task,
        'No fleet-safe tools registered; A2A inbound disabled until ToolRegistry is populated'
      );
    }

    const client = new CodeBuddyClient(
      provider.apiKey,
      provider.defaultModel,
      provider.baseURL
    );

    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userText },
    ];

    const formalRegistry = getFormalToolRegistry();
    const toolNamesUsed: string[] = [];
    let tokensUsed = 0;
    let finalText = '';
    let turn = 0;
    let warningHitCap = false;

    while (turn < MAX_TURNS) {
      turn++;

      let response: CodeBuddyResponse;
      try {
        response = await client.chat(messages, fleetSafeTools, { temperature: 0.1 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('[a2a:inbound]', {
          peerId,
          taskId: task.id,
          turn,
          error: msg,
          phase: 'llm_call',
        });
        return failTask(task, `LLM call failed: ${msg}`);
      }

      tokensUsed += response.usage?.total_tokens ?? 0;
      const choice = response.choices?.[0];
      if (!choice) {
        return failTask(task, 'LLM returned no choices');
      }

      const reply = choice.message;

      // Cost cap: take whatever content we have and stop.
      if (tokensUsed > MAX_TOKENS) {
        finalText = reply.content ?? '(cost cap reached before answer)';
        warningHitCap = true;
        break;
      }

      const toolCalls: CodeBuddyToolCall[] | undefined = reply.tool_calls;
      const wantsTools =
        choice.finish_reason === 'tool_calls' && Array.isArray(toolCalls) && toolCalls.length > 0;

      if (!wantsTools) {
        // Final answer reached.
        finalText = reply.content ?? '';
        break;
      }

      // Persist assistant tool-call request before dispatching.
      messages.push({
        role: 'assistant',
        content: reply.content,
        tool_calls: toolCalls,
      });

      // Execute each tool sequentially. Order matters because some tools
      // mutate shared in-process caches — even read-only ones.
      for (const toolCall of toolCalls!) {
        const name = toolCall.function.name;
        toolNamesUsed.push(name);

        // Defensive double-check: even though the LLM only sees
        // fleet-safe tools, refuse explicitly if it tries to invoke
        // anything else (e.g. a hallucinated tool name).
        if (!getToolRegistry().isFleetSafe(name)) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Tool "${name}" is not fleet-safe and was rejected.`,
          });
          continue;
        }

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: 'Tool error: invalid JSON arguments',
          });
          continue;
        }

        try {
          const result = await formalRegistry.execute(name, args);
          const resultText = result.success
            ? (result.output ??
                result.content ??
                (result.data !== undefined ? JSON.stringify(result.data) : ''))
            : `Tool error: ${result.error ?? 'unknown'}`;
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: resultText.length > 0 ? resultText : '(empty result)',
          });
        } catch (err) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      // If we hit the turn cap with tool calls still pending, stop.
      if (turn >= MAX_TURNS) {
        finalText = '(turn cap reached before model produced a final answer)';
        warningHitCap = true;
        break;
      }
    }

    // Append the agent reply and mark the task completed.
    task.messages.push({
      role: 'agent',
      parts: [{ type: 'text', text: finalText || '(no content)' }],
    });
    task.status = {
      status: TaskStatus.COMPLETED,
      message: warningHitCap ? 'Completed with cap warning' : undefined,
      timestamp: Date.now(),
    };
    task.history.push({ ...task.status });

    logger.info('[a2a:inbound]', {
      peerId,
      taskId: task.id,
      turns: turn,
      toolsUsed: Array.from(new Set(toolNamesUsed)),
      tokensUsed,
      durationMs: Date.now() - start,
      status: task.status.status,
      capWarning: warningHitCap || undefined,
    });

    return task;
  };
}
