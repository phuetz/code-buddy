/**
 * Headless slash-command execution.
 *
 * The TUI dispatches special slash-command tokens (`__FOO__`) through
 * `ClientCommandDispatcher`, which is coupled to Ink/React (it needs
 * `setChatHistory`, `setShowModelSelection`, …). Non-TUI surfaces — the Cowork
 * GUI and, later, the mobile supervision gateway — need to run the *behaviour*
 * of those tokens without that UI coupling.
 *
 * The real behaviour already lives in `EnhancedCommandHandler.handleCommand()`,
 * which returns plain data (`{ handled, entry, passToAI, prompt }`) and applies
 * no Ink side effects itself. This module is the stable seam that lets a
 * non-TUI caller invoke it safely:
 *
 * - **Default-deny.** The caller passes an explicit `allow` set. Tokens outside
 *   it return `{ handled: true, denied: true }` so the surface can show an
 *   honest "not available here yet" message instead of a silent no-op. This is
 *   server-side gating: a renderer cannot widen the set, because it never passes
 *   one — the trusted main process owns the policy.
 * - **Honest about context.** History/client-dependent tokens (e.g.
 *   `__COMPACT__`, `__SAVE_CONVERSATION__`) read context that a fresh surface may
 *   not have wired yet. Such tokens are expected to be *denied* by the caller's
 *   allow set until that surface wires `conversationHistory`/`client` here,
 *   rather than running against an empty history.
 *
 * @module commands/headless-slash
 */

import type { ChatEntry } from "../agent/codebuddy-agent.js";
import type { CodeBuddyClient } from "../codebuddy/client.js";
import {
  getEnhancedCommandHandler,
  type CommandHandlerResult,
} from "./enhanced-command-handler.js";
import { handleGoal, handleLoop, handleSubgoal } from "./handlers/goal-handler.js";

/** Optional session context for tokens that need it. */
export interface HeadlessSlashContext {
  /** Conversation messages, for history-dependent tokens (compact, save). */
  conversationHistory?: ChatEntry[];
  /** LLM client, for tokens that call the model directly (ai-test, btw). */
  client?: CodeBuddyClient;
  /** Optional goal-state key for non-TUI surfaces with their own session ids. */
  goalSessionKey?: string;
}

/** Result of running a special token outside the TUI. */
export interface HeadlessSlashResult {
  /** True when a registered handler ran (or the token was knowingly denied). */
  handled: boolean;
  /** Plain text to render as an assistant message, from the handler's entry. */
  output?: string;
  /** A prompt the surface should forward to the LLM (only when passToAI). */
  prompt?: string;
  /** True when the handler asked the surface to send `prompt` to the LLM. */
  passToAI?: boolean;
  /** True when the token is recognized but intentionally gated for this surface. */
  denied?: boolean;
  /** Human-readable reason, set when denied or when a handler throws. */
  reason?: string;
}

/** True for `__TOKEN__`-style special command markers. */
export function isSpecialCommandToken(value: string): boolean {
  return value.length > 4 && value.startsWith("__") && value.endsWith("__");
}

/**
 * Run a special slash-command token headlessly.
 *
 * @param token - The `__FOO__` token resolved from the slash catalog.
 * @param args - Parsed arguments (everything after the command name).
 * @param allow - Default-deny allow set the trusted caller controls.
 * @param ctx - Optional session context for history/client-dependent tokens.
 */
export async function executeHeadlessSlashToken(
  token: string,
  args: string[],
  allow: ReadonlySet<string>,
  ctx: HeadlessSlashContext = {},
): Promise<HeadlessSlashResult> {
  if (!isSpecialCommandToken(token)) {
    return { handled: false };
  }
  if (!allow.has(token)) {
    return {
      handled: true,
      denied: true,
      reason: `${token} is not available in this surface yet`,
    };
  }

  const handler = getEnhancedCommandHandler();
  if (ctx.conversationHistory) handler.setConversationHistory(ctx.conversationHistory);
  if (ctx.client) handler.setCodeBuddyClient(ctx.client);

  try {
    if (ctx.goalSessionKey && (token === '__GOAL__' || token === '__LOOP__' || token === '__SUBGOAL__')) {
      const result =
        token === '__GOAL__'
          ? await handleGoal(args, { sessionKey: ctx.goalSessionKey, client: ctx.client ?? null })
          : token === '__LOOP__'
            ? await handleLoop(args, { sessionKey: ctx.goalSessionKey, client: ctx.client ?? null })
            : await handleSubgoal(args, { sessionKey: ctx.goalSessionKey });
      return {
        handled: result.handled,
        output: result.entry?.content,
        prompt: result.prompt,
        passToAI: result.passToAI,
      };
    }

    const result: CommandHandlerResult = await handler.handleCommand(
      token,
      args,
      [token, ...args].join(" "),
    );
    return {
      handled: result.handled,
      output: result.entry?.content,
      prompt: result.prompt,
      passToAI: result.passToAI,
    };
  } catch (error: unknown) {
    return {
      handled: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
