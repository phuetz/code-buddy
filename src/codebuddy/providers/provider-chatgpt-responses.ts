/**
 * ChatGPT Codex Responses provider — Phase d.23.
 *
 * Strategy class for the **ChatGPT subscription backend** at
 * `https://chatgpt.com/backend-api/codex/responses`. This is NOT the
 * standard `api.openai.com/v1/chat/completions` endpoint — it's the
 * private Codex backend that consumes the OAuth bearer token issued by
 * the Codex CLI flow (see `src/providers/codex-oauth.ts`).
 *
 * Selected by `CodeBuddyClient` when:
 *   - `baseURL` matches `chatgpt.com/backend-api/codex`, OR
 *   - `apiKey === 'oauth-chatgpt'` (sentinel from auto-detect).
 *
 * Wire format differs significantly from `chat/completions`:
 *   - Body uses `input` (array of items) instead of `messages`
 *   - System prompt → `instructions` field (not in `input`)
 *   - Tools have a flattened shape (no nested `function: {...}`)
 *   - Tool calls/results are `function_call` / `function_call_output`
 *     items in the conversation array
 *   - Streaming uses Codex SSE events, not OpenAI's chunk format
 *
 * We accept the standard `CodeBuddyMessage[]` (chat/completions shape)
 * and translate to/from the Codex shape so the rest of the agentic loop
 * stays unchanged.
 */

import type { ChatCompletionChunk } from 'openai/resources/chat';
import type {
  CodeBuddyMessage,
  CodeBuddyTool,
  CodeBuddyToolCall,
  CodeBuddyResponse,
  ChatOptions,
} from '../client.js';
import type { Provider } from './provider-interface.js';
import type { ChatGptAuth } from '../../providers/codex-oauth.js';
import {
  CHATGPT_OAUTH_DEFAULT_MODEL,
  CHATGPT_OAUTH_SAFE_FALLBACK_MODEL,
  getChatGptOAuthFallbackModels,
  isChatGptModelCompatibilityError,
  isChatGptSubscriptionModel,
  modelUsesResponsesLite,
  normalizeChatGptOAuthModel,
  resolveChatGptReasoningEffort,
  selectChatGptOAuthModel,
  type ChatGptCodexModelCatalog,
  type ChatGptModelCatalogProvider,
} from '../../providers/chatgpt-models.js';
import { logger } from '../../utils/logger.js';
import { getInstallationId } from '../../utils/installation-id.js';

const RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const ORIGINATOR = 'codex_cli_rs';

// The Codex backend has no documented SLA and has been observed to silently
// stall (TLS handshake completes, no headers ever arrive). Without these the
// agent loop hangs on "thinking…" forever. Keep them generous enough to
// cover slow networks but tight enough to surface a clear error before the
// user gives up.
const CONNECT_TIMEOUT_MS = 60_000;       // until response headers
const STREAM_IDLE_TIMEOUT_MS = 120_000;  // between SSE events

export interface ChatGptResponsesProviderOptions {
  /**
   * Lazy auth provider — returns null if no credentials on disk. Called
   * once per request so refreshes propagate. The closure is responsible
   * for opportunistic refresh (`getChatGptAuth()` does this).
   */
  authProvider: () => Promise<ChatGptAuth | null>;
  /**
   * Force a fresh auth fetch after a 401 (refresh + retry once). The
   * production client supplies `refreshChatGptAuth()`; direct callers can
   * stub it. When omitted, the regular auth provider is reused.
   */
  refreshAuth?: () => Promise<ChatGptAuth | null>;
  /** Optional account model discovery. Kept injectable so provider unit tests
   * do not need to multiplex `/models` and `/responses` fetch mocks. */
  modelCatalogProvider?: ChatGptModelCatalogProvider;
  model: string;
  defaultMaxTokens: number;
  /** Provider-specific default; accepts Sol's `max` and `ultra` levels. */
  defaultReasoningEffort?: string;
  /**
   * If true, skip auto-fallback when the backend rejects a model with
   * `model_not_supported` / `model_not_found`. Default: false (i.e.
   * auto-fallback is ON when the user did not pin `--model`). Useful
   * for tests, or when the user genuinely wants to see the raw error.
   */
  disableModelFallback?: boolean;
}

/** Models served only by the classic OpenAI API — the ChatGPT/Codex backend
 *  never exposes them. (smoke-test finding F7, 2026-05-29) */
const CODEX_UNSUPPORTED_MODELS = new Set([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
]);

/** True when the ChatGPT/Codex backend can actually serve `model`: the gpt-5
 *  family, the o-series reasoning models, and codex-suffixed slugs. Classic
 *  gpt-4* (CODEX_UNSUPPORTED_MODELS) and other vendors' models (grok-*,
 *  claude-*, gemini-*, …) are NOT served and would 400. */
function isCodexServableModel(model: string): boolean {
  if (CODEX_UNSUPPORTED_MODELS.has(model)) return false;
  return isChatGptSubscriptionModel(model);
}

/** When a model the Codex backend cannot serve reaches this provider WITHOUT an
 *  explicit `--model`, remap proactively — preferring the user's configured
 *  session model — instead of firing a guaranteed-failed round-trip (and a
 *  confusing fallback to yet another unsupported slug). Two real mis-routes hit
 *  this: a secondary call inheriting a classic `gpt-4o` default (F7), and the
 *  agent's task-router handing back a `grok-*` coding model on a ChatGPT session
 *  (which otherwise 400s, then falls back to gpt-5.2 and 400s again → crash).
 *  An explicit `--model` is always respected. (cross-vendor fix, 2026-06-21) */
function resolveCodexModel(
  model: string,
  hasExplicitModel: boolean,
  configuredModel?: string,
): string {
  const normalized = normalizeChatGptOAuthModel(model);
  if (hasExplicitModel || isCodexServableModel(normalized)) return normalized;
  const target =
    configuredModel && isCodexServableModel(configuredModel)
      ? normalizeChatGptOAuthModel(configuredModel)
      : CHATGPT_OAUTH_DEFAULT_MODEL;
  logger.debug(
    `[chatgpt-responses] "${normalized}" is not served by the Codex backend; using "${target}". Set --model to override.`,
  );
  return target;
}

// ─────────────────────────────────────────────────────────────────────
// Type definitions for the Codex Responses API
// ─────────────────────────────────────────────────────────────────────

interface ResponsesInputMessage {
  type: 'message';
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: Array<{ type: 'input_text' | 'output_text'; text: string }>;
}

interface ResponsesAdditionalTools {
  type: 'additional_tools';
  role: 'developer';
  tools: ResponsesTool[];
}

interface ResponsesFunctionCall {
  type: 'function_call';
  name: string;
  arguments: string;
  call_id: string;
}

interface ResponsesFunctionCallOutput {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

interface ResponsesCustomToolCall {
  type: 'custom_tool_call';
  name: string;
  input: string;
  call_id: string;
}

interface ResponsesCustomToolCallOutput {
  type: 'custom_tool_call_output';
  call_id: string;
  output: string;
}

/**
 * Encrypted reasoning blob the Codex backend emits between tool rounds
 * when `include: ["reasoning.encrypted_content"]` is set in the request.
 * The blob is opaque — re-injecting it into `input` on the next call
 * lets the model preserve its chain-of-thought across tool round-trips.
 * Decryption is server-side only, by design.
 */
interface ResponsesReasoningItem {
  type: 'reasoning';
  encrypted_content: string;
}

type ResponsesInputItem =
  | ResponsesAdditionalTools
  | ResponsesInputMessage
  | ResponsesFunctionCall
  | ResponsesFunctionCallOutput
  | ResponsesCustomToolCall
  | ResponsesCustomToolCallOutput
  | ResponsesReasoningItem;

interface ResponsesFunctionTool {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface ResponsesCustomTool {
  type: 'custom';
  name: string;
  description: string;
  format: {
    type: 'grammar';
    syntax: 'lark';
    definition: string;
  };
}

type ResponsesTool = ResponsesFunctionTool | ResponsesCustomTool;

interface ResponsesRequestBody {
  model: string;
  instructions?: string;
  input: ResponsesInputItem[];
  tools?: ResponsesTool[];
  tool_choice?: 'auto' | 'none' | 'required';
  parallel_tool_calls?: boolean;
  store: boolean;
  stream: boolean;
  reasoning?: { effort?: string; context?: 'all_turns' };
  prompt_cache_key?: string;
  /** Tells the backend to surface the chain-of-thought as encrypted
   *  blobs in the SSE stream. Required to make `lastTurnReasoningItems`
   *  preservation actually work. */
  include?: string[];
}

// ─────────────────────────────────────────────────────────────────────
// Provider implementation
// ─────────────────────────────────────────────────────────────────────

export class ChatGptResponsesProvider implements Provider {
  private authProvider: () => Promise<ChatGptAuth | null>;
  private refreshAuth: () => Promise<ChatGptAuth | null>;
  private modelCatalogProvider?: ChatGptModelCatalogProvider;
  private currentModel: string;
  /** Stable per-instance key so the backend's prompt cache lights up
   *  across tool-call turns within the same conversation. */
  private promptCacheKey: string;
  /**
   * Encrypted reasoning blobs captured from the previous turn, to
   * re-inject into the next request's `input`. This preserves the
   * model's chain-of-thought across tool round-trips. Reset whenever
   * a fresh user message arrives (= start of a new conversational turn).
   *
   * Scope: process lifetime, single conversation. Lost on restart, by
   * design (the agentic loop also discards in-flight reasoning on
   * restart, so no asymmetry is introduced).
   */
  private lastTurnReasoningItems: ResponsesReasoningItem[] = [];
  private disableModelFallback: boolean;
  private defaultReasoningEffort?: string;
  /** The model this provider was constructed with (the user's configured
   *  session model). Never mutated by per-call overrides or fallback, so it is
   *  the safe remap target when a mis-routed / non-Codex model arrives. */
  private readonly configuredModel: string;

  constructor(opts: ChatGptResponsesProviderOptions) {
    this.authProvider = opts.authProvider;
    this.refreshAuth = opts.refreshAuth ?? opts.authProvider;
    this.modelCatalogProvider = opts.modelCatalogProvider;
    this.currentModel = normalizeChatGptOAuthModel(opts.model);
    this.configuredModel = normalizeChatGptOAuthModel(opts.model);
    this.promptCacheKey = `cb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.disableModelFallback = opts.disableModelFallback ?? false;
    this.defaultReasoningEffort = opts.defaultReasoningEffort;
  }

  setModel(model: string): void {
    this.currentModel = normalizeChatGptOAuthModel(model);
  }

  setDefaultReasoningEffort(level: string): void {
    this.defaultReasoningEffort = level;
  }

  // ─── Public Provider interface ─────────────────────────────────────

  async chat(
    messages: CodeBuddyMessage[],
    tools: CodeBuddyTool[] = [],
    opts: ChatOptions = {}
  ): Promise<CodeBuddyResponse> {
    // Non-streaming consumes the streaming path and aggregates.
    let content = '';
    const toolCalls: CodeBuddyToolCall[] = [];
    let finishReason = 'stop';

    for await (const chunk of this.chatStream(messages, tools, opts)) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) content += delta.content;
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          // Streaming yields complete tool_calls in this provider (no
          // partial accumulation), so we just collect them.
          if (tc.id && tc.function?.name) {
            toolCalls.push({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments ?? '',
              },
            });
          }
        }
      }
      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
    }

    return {
      choices: [{
        message: {
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finish_reason: finishReason,
      }],
    };
  }

  async *chatStream(
    messages: CodeBuddyMessage[],
    tools: CodeBuddyTool[] = [],
    opts: ChatOptions = {}
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    // Auth is needed both by `/models` discovery and by the Responses call.
    let auth = await this.authProvider();
    if (!auth) {
      throw new Error(
        'No ChatGPT credentials. Run `/login chatgpt` (or click Sign In in Cowork settings) first.',
      );
    }

    let catalog: ChatGptCodexModelCatalog | null = null;
    if (this.modelCatalogProvider) {
      try {
        catalog = await this.modelCatalogProvider(auth);
      } catch (error) {
        logger.debug('[chatgpt-responses] Model discovery failed; continuing with safe policy', {
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
    }

    let model = resolveCodexModel(
      opts.model ?? this.currentModel,
      opts.model != null,
      this.configuredModel,
    );
    if (!opts.model) model = selectChatGptOAuthModel(model, catalog);

    // If this is a brand-new conversational turn (last user message has
    // no preceding tool round in messages), drop any stale reasoning
    // blobs from the previous turn — they belonged to a different
    // chain-of-thought.
    if (isFreshUserTurn(messages)) {
      this.lastTurnReasoningItems = [];
    }
    const { instructions, input } = convertMessages(messages, this.lastTurnReasoningItems);
    let request = this.buildRequestForModel(model, instructions, input, tools, opts, catalog);
    let response = await this.postResponses(request.body, auth, request.useResponsesLite);

    // 401 → refresh and retry once.
    if (response.status === 401) {
      logger.debug('[chatgpt-responses] 401, refreshing token and retrying once');
      auth = await this.refreshAuth();
      if (!auth) {
        throw new Error(
          'ChatGPT auth expired or revoked. Run `/login chatgpt` to re-authenticate.',
        );
      }
      // Retry the exact same request. Authentication errors must never be
      // disguised as model fallback.
      response = await this.postResponses(request.body, auth, request.useResponsesLite);
    }

    // Only 400/404 model compatibility failures may advance to another
    // account-supported model. Quota (429), auth (401/403), and transient
    // errors stop immediately.
    if (!response.ok && !this.disableModelFallback && !opts.model) {
      const errorText = await response.clone().text().catch(() => '');
      if (isChatGptModelCompatibilityError(response.status, errorText)) {
        for (const fallback of getChatGptOAuthFallbackModels(model, catalog)) {
          logger.warn(
            `[chatgpt-responses] Model "${model}" rejected by backend. Auto-falling back to "${fallback}". Set --model explicitly to override.`,
          );
          request = this.buildRequestForModel(
            fallback,
            instructions,
            input,
            tools,
            opts,
            catalog,
          );
          response = await this.postResponses(request.body, auth, request.useResponsesLite);
          model = fallback;
          if (response.ok) break;

          const fallbackError = await response.clone().text().catch(() => '');
          if (!isChatGptModelCompatibilityError(response.status, fallbackError)) break;
        }
      }
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw enrichError(
        response.status,
        errorText,
        request.body.model,
        getChatGptOAuthFallbackModels(request.body.model, catalog),
      );
    }

    this.currentModel = request.body.model;

    if (!response.body) {
      throw new Error('ChatGPT Responses backend returned empty body');
    }

    // Reset capture buffer for THIS response — only successful new
    // reasoning blobs should populate `lastTurnReasoningItems`. We swap
    // in a fresh array so the SSE parser can push without races.
    // Pass the post-fallback model so streaming chunks are labelled
    // with the model that actually served the response.
    const capturedReasoning: ResponsesReasoningItem[] = [];
    try {
      yield* parseSseStream(response.body, request.body.model, (item) => {
        capturedReasoning.push(item);
      });
    } finally {
      // Whatever we captured (even partially on error) replaces the
      // previous turn's blobs — fresher data is always more correct.
      if (capturedReasoning.length > 0) {
        this.lastTurnReasoningItems = capturedReasoning;
      }
    }
  }

  // ─── Internal helpers ──────────────────────────────────────────────

  private buildRequestForModel(
    model: string,
    instructions: string | undefined,
    input: ResponsesInputItem[],
    tools: CodeBuddyTool[],
    opts: ChatOptions,
    catalog: ChatGptCodexModelCatalog | null,
  ): { body: ResponsesRequestBody; useResponsesLite: boolean } {
    const configuredEffort = opts.codexReasoningEffort
      ?? opts.thinkingLevel
      ?? this.defaultReasoningEffort
      ?? process.env.CODEBUDDY_CODEX_REASONING_EFFORT;
    const reasoningEffort = resolveChatGptReasoningEffort(configuredEffort, model, catalog);
    const useResponsesLite = modelUsesResponsesLite(model, catalog);
    return {
      body: buildRequestBody({
        model,
        instructions,
        input,
        tools,
        reasoningEffort,
        maxTokens: opts.maxTokens,
        promptCacheKey: this.promptCacheKey,
        includeEncryptedReasoning: !!reasoningEffort,
        useResponsesLite,
      }),
      useResponsesLite,
    };
  }

  private async postResponses(
    body: ResponsesRequestBody,
    auth: ChatGptAuth,
    useResponsesLite: boolean,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.access_token}`,
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      originator: ORIGINATOR,
      // Stable per-install UUID — Codex backend uses this for telemetry
      // and rate-limiting. Generated lazily on first read, persisted to
      // ~/.codebuddy/installation-id. Mirrors openai/codex upstream.
      'x-codex-installation-id': getInstallationId(),
      'User-Agent': `codebuddy/${process.env.npm_package_version ?? 'dev'}`,
    };
    if (auth.account_id) {
      headers['ChatGPT-Account-ID'] = auth.account_id;
    }
    if (auth.is_fedramp) {
      headers['X-OpenAI-Fedramp'] = 'true';
    }
    if (useResponsesLite) {
      headers['x-openai-internal-codex-responses-lite'] = 'true';
    }

    logger.debug(`[chatgpt-responses] POST ${RESPONSES_URL} (model=${body.model})`);

    // Connect timeout: bounds the wait for response headers only. Cleared
    // as soon as fetch resolves, so it does not interrupt body streaming —
    // the SSE reader has its own idle timeout for that.
    const controller = new AbortController();
    const connectTimer = setTimeout(
      () => controller.abort(),
      CONNECT_TIMEOUT_MS,
    );
    try {
      return await fetch(RESPONSES_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new Error(
          `ChatGPT Responses backend did not respond within ${CONNECT_TIMEOUT_MS}ms. ` +
            `Likely a network issue or stalled backend — try again, or run \`/login chatgpt\` to refresh credentials.`,
        );
      }
      throw err;
    } finally {
      clearTimeout(connectTimer);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Message conversion (chat/completions → Codex Responses)
// ─────────────────────────────────────────────────────────────────────

interface ConversionResult {
  /** Concatenated system messages — go into the `instructions` field. */
  instructions?: string;
  /** Everything else → `input` array of typed items. */
  input: ResponsesInputItem[];
}

/**
 * Returns true if the most recent user message is followed only by user
 * content (no assistant tool round in between), meaning this is a fresh
 * conversational turn — stale reasoning blobs from a previous turn must
 * be discarded.
 */
export function isFreshUserTurn(messages: CodeBuddyMessage[]): boolean {
  // Find the last user message and look at what comes after it.
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return true; // no user message yet — treat as fresh
  // Fresh if everything AFTER the last user message is also user/system.
  // (If there's any assistant or tool message after, we're mid-turn.)
  for (let j = lastUserIdx + 1; j < messages.length; j++) {
    const role = messages[j]?.role;
    if (role === 'assistant' || role === 'tool') return false;
  }
  return true;
}

/**
 * Convert chat/completions messages into Codex Responses input items.
 *
 * `priorReasoningItems` (optional) — encrypted reasoning blobs captured
 * from the previous turn. If present AND the conversation has at least
 * one assistant tool-call round, they're prepended to the `input` array
 * (Codex expects reasoning items to appear before the function_calls
 * they belong to).
 */
export function convertMessages(
  messages: CodeBuddyMessage[],
  priorReasoningItems: ResponsesReasoningItem[] = [],
): ConversionResult {
  const systemParts: string[] = [];
  const input: ResponsesInputItem[] = [];
  const customToolCallIds = new Set<string>();

  // Code Buddy's internal transcript shape is function-call compatible. The
  // `code_exec` marker lets us recover the Codex custom-tool wire type without
  // widening every message type in the application.
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const calls = (message as { tool_calls?: CodeBuddyToolCall[] }).tool_calls;
    for (const call of calls ?? []) {
      if (call.function.name === 'code_exec') customToolCallIds.add(call.id);
    }
  }

  // Prepend prior-turn reasoning blobs ONLY if the conversation is
  // already past at least one assistant tool round — otherwise the
  // backend rejects an orphan reasoning item.
  const hasPriorAssistantRound = messages.some(
    (m) => m.role === 'assistant' && Array.isArray((m as { tool_calls?: unknown[] }).tool_calls),
  );
  if (hasPriorAssistantRound && priorReasoningItems.length > 0) {
    input.push(...priorReasoningItems);
  }

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (text) systemParts.push(text);
      continue;
    }

    if (msg.role === 'tool') {
      // tool_result message: { role: 'tool', tool_call_id, content }
      const toolCallId = (msg as { tool_call_id?: string }).tool_call_id;
      const output =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content ?? '');
      if (toolCallId) {
        input.push(customToolCallIds.has(toolCallId)
          ? {
              type: 'custom_tool_call_output',
              call_id: toolCallId,
              output,
            }
          : {
              type: 'function_call_output',
              call_id: toolCallId,
              output,
            });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const tc = (msg as { tool_calls?: CodeBuddyToolCall[] }).tool_calls;
      if (tc && tc.length > 0) {
        for (const call of tc) {
          if (call.function.name === 'code_exec') {
            input.push({
              type: 'custom_tool_call',
              name: 'exec',
              input: extractCodeExecInput(call.function.arguments),
              call_id: call.id,
            });
          } else {
            input.push({
              type: 'function_call',
              name: call.function.name,
              arguments: call.function.arguments,
              call_id: call.id,
            });
          }
        }
        // If the assistant message also has text content alongside tool
        // calls, emit it as an output_text message.
        const text = typeof msg.content === 'string' ? msg.content : '';
        if (text) {
          input.push({
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text }],
          });
        }
        continue;
      }
      // Plain assistant text.
      const text = typeof msg.content === 'string' ? msg.content : '';
      input.push({
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      });
      continue;
    }

    // Default: user message.
    const text =
      typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content ?? '');
    input.push({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text }],
    });
  }

  return {
    instructions: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    input,
  };
}

function extractCodeExecInput(argumentsJson: string): string {
  try {
    const parsed = JSON.parse(argumentsJson) as { code?: unknown };
    if (typeof parsed.code === 'string') return parsed.code;
  } catch {
    // A hand-authored transcript can contain raw code; preserve it verbatim.
  }
  return argumentsJson;
}

// ─────────────────────────────────────────────────────────────────────
// Tools flatten (chat/completions → Codex Responses)
// ─────────────────────────────────────────────────────────────────────

const CODE_EXEC_LARK_GRAMMAR = String.raw`
start: pragma_source | plain_source
pragma_source: PRAGMA_LINE NEWLINE SOURCE
plain_source: SOURCE

PRAGMA_LINE: /[ \t]*\/\/ @exec:[^\r\n]*/
NEWLINE: /\r?\n/
SOURCE: /[\s\S]+/
`;

export function flattenTools(tools: CodeBuddyTool[]): ResponsesTool[] {
  return tools.map((tool): ResponsesTool => {
    if (tool.function.name === 'code_exec') {
      return {
        type: 'custom',
        name: 'exec',
        description: tool.function.description,
        format: {
          type: 'grammar',
          syntax: 'lark',
          definition: CODE_EXEC_LARK_GRAMMAR,
        },
      };
    }
    return {
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters as Record<string, unknown>,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// Request body assembly
// ─────────────────────────────────────────────────────────────────────

interface BuildRequestBodyOpts {
  model: string;
  instructions?: string;
  input: ResponsesInputItem[];
  tools: CodeBuddyTool[];
  reasoningEffort?: string;
  /**
   * Accepted for Provider interface parity, but deliberately not serialized:
   * the ChatGPT Codex backend rejects `max_output_tokens` with 400.
   */
  maxTokens?: number;
  promptCacheKey?: string;
  /** When true, ask the backend to emit encrypted reasoning blobs so we
   *  can re-inject them next turn (preserves chain-of-thought across
   *  tool rounds). Only meaningful when `reasoningEffort` is set. */
  includeEncryptedReasoning?: boolean;
  /** Codex Responses Lite moves instructions/tools into input items and
   * requires serial tool execution + all-turn reasoning context. */
  useResponsesLite?: boolean;
}

/** Default `instructions` value when the caller didn't provide a system
 *  prompt. The Codex Responses backend (chatgpt.com/backend-api/codex)
 *  REJECTS the request with `400 Instructions are required` when this
 *  field is missing or empty — even on a single-turn user message. We
 *  ship a minimal-but-non-empty default so the agentic loop can issue
 *  raw chat requests without forcing every caller to thread a system
 *  prompt through. */
const DEFAULT_INSTRUCTIONS =
  'You are Code Buddy, a helpful AI assistant powered by ChatGPT.';

export function buildRequestBody(opts: BuildRequestBodyOpts): ResponsesRequestBody {
  const instructions = opts.instructions && opts.instructions.trim().length > 0
    ? opts.instructions
    : DEFAULT_INSTRUCTIONS;
  const flattenedTools = flattenTools(opts.tools);
  const body: ResponsesRequestBody = {
    model: opts.model,
    input: opts.input,
    tool_choice: 'auto',
    parallel_tool_calls: !opts.useResponsesLite,
    store: false,
    stream: true,
  };
  if (opts.useResponsesLite) {
    body.input = [
      {
        type: 'additional_tools',
        role: 'developer',
        tools: flattenedTools,
      },
      {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: instructions }],
      },
      ...opts.input,
    ];
    body.reasoning = opts.reasoningEffort
      ? { effort: opts.reasoningEffort, context: 'all_turns' }
      : { context: 'all_turns' };
  } else {
    body.instructions = instructions;
    if (flattenedTools.length > 0) body.tools = flattenedTools;
    if (opts.reasoningEffort) body.reasoning = { effort: opts.reasoningEffort };
  }
  if (opts.promptCacheKey) body.prompt_cache_key = opts.promptCacheKey;
  if (opts.includeEncryptedReasoning) {
    body.include = ['reasoning.encrypted_content'];
  }
  return body;
}

// ─────────────────────────────────────────────────────────────────────
// SSE stream parser (Codex Responses → OpenAI ChatCompletionChunk)
// ─────────────────────────────────────────────────────────────────────

/** Delta extension carrying Codex `reasoning_text.delta` events. Not in
 *  the OpenAI ChatCompletionChunk type, but accepted as a passthrough
 *  field — consumers (CLI / Cowork) check for it and render conditionally. */
type DeltaWithReasoning = ChatCompletionChunk['choices'][0]['delta'] & {
  reasoning_content?: string;
};

/** Async-generates OpenAI-shaped chunks from a Codex SSE stream.
 *
 *  `onReasoningItem` (optional) is invoked for each `output_item.done`
 *  event of type `reasoning` carrying an `encrypted_content` blob — the
 *  caller persists these to re-inject into `input` on the next turn,
 *  preserving the model's chain-of-thought across tool round-trips.
 */
export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  model: string,
  onReasoningItem?: (item: ResponsesReasoningItem) => void,
  idleTimeoutMs: number = STREAM_IDLE_TIMEOUT_MS,
): AsyncGenerator<ChatCompletionChunk, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chunkIndex = 0;
  // Monotonic index per function_call so the downstream message-reducer keeps
  // parallel tool calls in separate slots. Hardcoding 0 made every parallel
  // call merge into one — names/call_ids/arguments concatenated — producing a
  // 100+ char call_id the Responses backend rejects (max 64) on the next turn.
  let functionCallIndex = 0;
  const customCalls = new Map<string, { callId?: string; name?: string; input: string }>();

  const makeChunk = (delta: DeltaWithReasoning, finishReason?: string): ChatCompletionChunk => ({
    id: `chatcmpl-codex-${chunkIndex++}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: delta as ChatCompletionChunk['choices'][0]['delta'],
      finish_reason: (finishReason as ChatCompletionChunk['choices'][0]['finish_reason']) ?? null,
    }],
  });

  try {
    while (true) {
      // Idle timeout: race reader.read() against a timer. If no SSE event
      // arrives within idleTimeoutMs we cancel the reader (releases the
      // socket) and surface a clear error instead of hanging.
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const idlePromise = new Promise<never>((_, reject) => {
        idleTimer = setTimeout(() => {
          reject(
            new Error(
              `ChatGPT Responses stream stalled — no SSE event for ${idleTimeoutMs}ms. ` +
                `The backend likely dropped the connection mid-stream; please retry.`,
            ),
          );
        }, idleTimeoutMs);
      });
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        readResult = await Promise.race([reader.read(), idlePromise]);
      } catch (err) {
        try { await reader.cancel(); } catch { /* socket may already be dead */ }
        throw err;
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
      }
      const { value, done } = readResult;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events. Each event is delimited by `\n\n`,
      // with each line prefixed by `data: ` (or `event:`, which we ignore).
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? ''; // last (incomplete) event stays in buffer

      for (const event of events) {
        const dataLines = event
          .split('\n')
          .filter((l) => l.startsWith('data: '))
          .map((l) => l.slice(6));
        if (dataLines.length === 0) continue;
        const dataStr = dataLines.join('\n');
        if (dataStr === '[DONE]') {
          yield makeChunk({}, 'stop');
          return;
        }

        let parsed: {
          type?: string;
          delta?: string;
          item_id?: string;
          call_id?: string;
          item?: {
            type?: string;
            id?: string;
            name?: string;
            arguments?: string;
            input?: string;
            call_id?: string;
            encrypted_content?: string;
          };
          response?: { error?: { code?: string; message?: string } };
        };
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          continue; // malformed event, skip
        }

        const type = parsed.type;

        if (type === 'response.output_item.added' && parsed.item?.type === 'custom_tool_call') {
          const key = parsed.item.id ?? parsed.item.call_id;
          if (key) {
            const state = {
              callId: parsed.item.call_id,
              name: parsed.item.name,
              input: parsed.item.input ?? '',
            };
            customCalls.set(key, state);
            if (parsed.item.call_id) customCalls.set(parsed.item.call_id, state);
          }
          continue;
        }

        if (
          type === 'response.custom_tool_call_input.delta' &&
          typeof parsed.delta === 'string'
        ) {
          const key = parsed.item_id ?? parsed.call_id;
          if (key) {
            const existing = customCalls.get(key) ?? {
              callId: parsed.call_id,
              input: '',
            };
            existing.callId ??= parsed.call_id;
            existing.input += parsed.delta;
            customCalls.set(key, existing);
            if (existing.callId) customCalls.set(existing.callId, existing);
          }
          continue;
        }

        if (type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
          yield makeChunk({ content: parsed.delta });
          continue;
        }

        // Reasoning streaming — `reasoning_text.delta` is the incremental
        // chain-of-thought; `reasoning_summary_text.delta` is the
        // post-hoc summary (some Codex models emit both). We pipe both
        // through `delta.reasoning_content` (passthrough field). The
        // standard agentic loop ignores chunks without content/tool_calls,
        // so this is non-disruptive — only consumers that opt-in to
        // displaying reasoning will pick it up.
        if (
          (type === 'response.reasoning_text.delta' ||
           type === 'response.reasoning_summary_text.delta') &&
          typeof parsed.delta === 'string'
        ) {
          yield makeChunk({ reasoning_content: parsed.delta });
          continue;
        }

        if (type === 'response.output_item.done' && parsed.item?.type === 'function_call') {
          const item = parsed.item;
          if (item.name && item.call_id) {
            yield makeChunk({
              tool_calls: [{
                index: functionCallIndex++,
                id: item.call_id,
                type: 'function',
                function: {
                  name: item.name,
                  arguments: item.arguments ?? '',
                },
              }],
            });
          }
          continue;
        }

        if (type === 'response.output_item.done' && parsed.item?.type === 'custom_tool_call') {
          const item = parsed.item;
          const accumulated = customCalls.get(item.id ?? '')
            ?? customCalls.get(item.call_id ?? '');
          const callId = item.call_id ?? accumulated?.callId;
          const customName = item.name ?? accumulated?.name;
          const rawInput = item.input ?? accumulated?.input ?? '';
          if (callId && customName === 'exec') {
            yield makeChunk({
              tool_calls: [{
                index: functionCallIndex++,
                id: callId,
                type: 'function',
                function: {
                  name: 'code_exec',
                  arguments: JSON.stringify({ code: rawInput }),
                },
              }],
            });
          }
          for (const [key, state] of customCalls) {
            if (state === accumulated || key === item.id || key === callId) customCalls.delete(key);
          }
          continue;
        }

        // Encrypted reasoning blob — capture for next-turn re-injection.
        // No chunk yielded (the agentic loop ignores no-op deltas).
        if (
          type === 'response.output_item.done' &&
          parsed.item?.type === 'reasoning' &&
          typeof parsed.item.encrypted_content === 'string' &&
          onReasoningItem
        ) {
          onReasoningItem({
            type: 'reasoning',
            encrypted_content: parsed.item.encrypted_content,
          });
          continue;
        }

        if (type === 'response.completed') {
          yield makeChunk({}, 'stop');
          return;
        }

        if (type === 'response.failed') {
          const err = parsed.response?.error;
          throw new Error(
            `ChatGPT Responses backend failure (${err?.code ?? 'unknown'}): ${err?.message ?? 'no message'}`,
          );
        }

        // Other events (response.created, response.in_progress,
        // response.reasoning_text.delta, etc.) are ignored.
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Error enrichment
// ─────────────────────────────────────────────────────────────────────

function enrichError(
  status: number,
  body: string,
  model: string,
  fallbackModels: string[] = [CHATGPT_OAUTH_SAFE_FALLBACK_MODEL],
): Error {
  // Try to surface the model_not_found case with a helpful suggestion.
  if (isChatGptModelCompatibilityError(status, body)) {
    const fallbackHint = fallbackModels.length > 0
      ? `Suggested fallbacks: ${fallbackModels.join(', ')}. `
      : 'No alternate model was discovered for this account. ';
    return new Error(
      `Model "${model}" not available on the ChatGPT Codex backend. ` +
        fallbackHint +
        `Switch with \`/switch <model>\` or set CHATGPT_MODEL.`,
    );
  }
  if (status === 401 || status === 403) {
    return new Error(
      `ChatGPT auth rejected (${status}). Run \`/login chatgpt\` to re-authenticate.`,
    );
  }
  return new Error(`ChatGPT Responses backend error (${status}): ${body.slice(0, 500)}`);
}
