/**
 * Gemini native provider — Vague 2 Phase B.
 *
 * Migrated verbatim from `client.ts` (rev 17b148d). The only behavioral
 * differences vs the inlined version:
 *  - logger sources renamed `'CodeBuddyClient'` → `'GeminiNativeProvider'`
 *  - public methods renamed `geminiChat`/`geminiChatStream` → `chat`/`chatStream`
 *
 * Parity with OpenAI-compat (2026-05-29):
 *  - `chat`/`chatStream` fetch calls are now wrapped in the shared circuit
 *    breaker when the caller opts in via `ChatOptions.circuitBreaker`
 *    (default off → common path unchanged).
 *  - Response rate-limit headers are parsed via `parseRateLimitHeaders` and
 *    surfaced through `/quota`.
 * Remaining asymmetry (by design):
 *  - `trackPromptCache` is OpenAI-compat-only (Gemini does not surface
 *    `cached_tokens` in usageMetadata), so this provider has no cache stats.
 */

import type { ChatCompletionChunk } from 'openai/resources/chat';
import { logger } from '../../utils/logger.js';
import { retry, RetryStrategies, RetryPredicates } from '../../utils/retry.js';
import { getCircuitBreaker } from '../../providers/circuit-breaker.js';
import { parseRateLimitHeaders, storeRateLimitInfo } from '../../utils/rate-limit-display.js';
import type {
  CodeBuddyMessage,
  CodeBuddyTool,
  CodeBuddyResponse,
  CodeBuddyToolCall,
  ChatOptions,
  GeminiThinkingLevel,
} from '../client.js';
import type { Provider } from './provider-interface.js';

export interface GeminiNativeProviderOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  defaultMaxTokens: number;
  geminiRequestTimeoutMs: number;
  defaultThinkingLevel?: GeminiThinkingLevel;
  /**
   * Enable Gemini's native server-side Google Search grounding by
   * default. Each request can override via `ChatOptions.googleSearch`.
   * When active, we inject `{ googleSearch: {} }` into the request's
   * `tools` array (alongside any `functionDeclarations`) and surface
   * the citation metadata as a "Sources:" footer in the assistant's
   * content.
   */
  defaultGoogleSearch?: boolean;
}

export class GeminiNativeProvider implements Provider {
  private apiKey: string;
  private baseURL: string;
  private currentModel: string;
  private defaultMaxTokens: number;
  private geminiRequestTimeoutMs: number;
  private defaultThinkingLevel: GeminiThinkingLevel | undefined;
  private defaultGoogleSearch: boolean | undefined;

  /**
   * Format a Gemini `groundingMetadata` payload as a Markdown "Sources"
   * footer. Returns an empty string when the metadata is absent or
   * contains no usable URLs — callers can then append unconditionally.
   *
   * Public surface (exported via the static method) for testability and
   * so the streaming path can reuse the exact same formatting.
   */
  static formatGroundingFooter(metadata: unknown): string {
    if (!metadata || typeof metadata !== 'object') return '';
    const meta = metadata as {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      webSearchQueries?: string[];
    };
    const chunks = Array.isArray(meta.groundingChunks) ? meta.groundingChunks : [];
    const seen = new Set<string>();
    const sources: Array<{ uri: string; title: string }> = [];
    for (const chunk of chunks) {
      const uri = chunk.web?.uri;
      if (!uri || seen.has(uri)) continue;
      seen.add(uri);
      sources.push({ uri, title: chunk.web?.title?.trim() || uri });
    }
    if (sources.length === 0) return '';

    const lines = ['', '', '**Sources:**'];
    for (const s of sources) {
      lines.push(`- [${s.title}](${s.uri})`);
    }
    if (Array.isArray(meta.webSearchQueries) && meta.webSearchQueries.length > 0) {
      lines.push('', `_Search queries: ${meta.webSearchQueries.join(', ')}_`);
    }
    return lines.join('\n');
  }

  /**
   * Gemini type mapping: lowercase OpenAI types to uppercase Gemini types
   */
  private static readonly GEMINI_TYPE_MAP: Record<string, string> = {
    'string': 'STRING',
    'number': 'NUMBER',
    'integer': 'INTEGER',
    'boolean': 'BOOLEAN',
    'array': 'ARRAY',
    'object': 'OBJECT',
  };

  constructor(opts: GeminiNativeProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseURL = opts.baseURL;
    this.currentModel = opts.model;
    this.defaultMaxTokens = opts.defaultMaxTokens;
    this.geminiRequestTimeoutMs = opts.geminiRequestTimeoutMs;
    this.defaultThinkingLevel = opts.defaultThinkingLevel;
    this.defaultGoogleSearch = opts.defaultGoogleSearch;
    logger.info('Using native Gemini API');
  }

  setModel(model: string): void {
    this.currentModel = model;
  }

  setDefaultThinkingLevel(level: GeminiThinkingLevel): void {
    this.defaultThinkingLevel = level;
  }

  setDefaultGoogleSearch(enabled: boolean): void {
    this.defaultGoogleSearch = enabled;
  }

  private buildGeminiBody(
    messages: CodeBuddyMessage[],
    tools?: CodeBuddyTool[],
    opts?: ChatOptions
  ): Record<string, unknown> {
    // Convert messages to Gemini format
    const contents: Array<{
      role: string;
      parts: Array<{ text?: string; functionResponse?: { name: string; response: unknown }; inlineData?: { mimeType: string; data: string } }>;
    }> = [];

    let systemInstruction: { parts: Array<{ text: string }> } | undefined;

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Gemini uses systemInstruction instead of system message
        systemInstruction ??= { parts: [] };
        systemInstruction.parts.push({ text: String(msg.content) });
      } else if (msg.role === 'user') {
        const parts = this.convertContentToGeminiParts(msg.content);
        contents.push({ role: 'user', parts });
      } else if (msg.role === 'assistant') {
        const assistantMsg = msg as { content?: string | null; tool_calls?: CodeBuddyToolCall[] };
        if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
          // Assistant with tool calls
          const parts: Array<{ functionCall?: { name: string; args: unknown }; text?: string }> = [];
          if (assistantMsg.content) {
            parts.push({ text: assistantMsg.content });
          }
          for (const tc of assistantMsg.tool_calls) {
            let args: unknown;
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              args = {};
            }
            parts.push({
              functionCall: {
                name: tc.function.name,
                args,
              },
            });
          }
          contents.push({ role: 'model', parts: parts as Array<{ text?: string; functionResponse?: { name: string; response: unknown } }> });
        } else {
          contents.push({
            role: 'model',
            parts: [{ text: String(msg.content || '') }],
          });
        }
      } else if (msg.role === 'tool') {
        const toolMsg = msg as { tool_call_id?: string; name?: string; content?: string };
        const functionName = toolMsg.name || toolMsg.tool_call_id || 'unknown';

        logger.debug('Adding functionResponse to Gemini request', {
          source: 'GeminiNativeProvider',
          functionName,
          hasName: !!toolMsg.name,
          toolCallId: toolMsg.tool_call_id,
          contentLength: toolMsg.content?.length || 0,
        });

        const part = {
          functionResponse: {
            name: functionName,
            response: { result: toolMsg.content },
          },
        };
        // Merge consecutive tool results into a single 'function' turn
        // (Gemini requires strict role alternation)
        const lastContent = contents[contents.length - 1];
        if (lastContent && lastContent.role === 'function') {
          lastContent.parts.push(part);
        } else {
          contents.push({ role: 'function', parts: [part] });
        }
      }
    }

    // Sanitize contents for Gemini's strict conversation rules:
    // 1. Must start with 'user'
    // 2. No consecutive same-role turns
    // 3. 'function' must immediately follow 'model' with functionCall
    // 4. 'model' with functionCall must be immediately followed by 'function'
    // Context compression can break these rules by removing intermediate messages.

    // Pass 1: Drop orphaned function responses and strip orphaned functionCalls
    const sanitized: typeof contents = [];
    for (let i = 0; i < contents.length; i++) {
      const entry = contents[i];
      if (!entry) continue;
      if (entry.role === 'function') {
        const prev = sanitized[sanitized.length - 1];
        if (prev && prev.role === 'model' && prev.parts.some(p => 'functionCall' in p)) {
          sanitized.push(entry);
        }
        // else: drop orphaned function response
      } else if (entry.role === 'model' && entry.parts.some(p => 'functionCall' in p)) {
        const next = contents[i + 1];
        if (next && next.role === 'function') {
          sanitized.push(entry);
        } else {
          // Strip functionCall parts, keep text only
          const textParts = entry.parts.filter(p => 'text' in p && p.text);
          if (textParts.length > 0) {
            sanitized.push({ role: 'model', parts: textParts });
          }
        }
      } else {
        sanitized.push(entry);
      }
    }

    // Pass 2: Merge consecutive same-role entries
    const merged: typeof contents = [];
    for (const entry of sanitized) {
      const prev = merged[merged.length - 1];
      if (prev && prev.role === entry.role) {
        prev.parts.push(...entry.parts);
      } else {
        merged.push(entry);
      }
    }

    // Pass 3: Ensure conversation starts with 'user'
    if (merged.length > 0 && merged[0]?.role !== 'user') {
      merged.unshift({ role: 'user', parts: [{ text: '(continuing previous conversation)' }] });
    }

    // Build request body
    // Build generationConfig with optional thinkingConfig for Gemini 3.x
    const generationConfig: Record<string, unknown> = {
      temperature: opts?.temperature ?? 0.7,
      maxOutputTokens: opts?.maxTokens ?? this.defaultMaxTokens,
    };

    // Add thinkingLevel for Gemini 3.x models (never mix with budget_tokens)
    // Use explicitly passed level, or fall back to the default from settings
    const effectiveThinkingLevel = opts?.thinkingLevel || this.defaultThinkingLevel;
    if (effectiveThinkingLevel) {
      generationConfig.thinkingConfig = {
        thinkingLevel: effectiveThinkingLevel,
      };
      logger.debug('Gemini thinkingLevel set', { level: effectiveThinkingLevel });
    }

    // JSON mode for Gemini: add responseMimeType
    if (opts?.responseFormat === 'json') {
      generationConfig.responseMimeType = 'application/json';
    }

    const body: Record<string, unknown> = {
      contents: merged,
      generationConfig,
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    // Decide whether to inject Google Search grounding. The per-call
    // option wins (including `false` to force off when the default is on).
    const groundingEnabled =
      opts?.googleSearch !== undefined ? opts.googleSearch : this.defaultGoogleSearch === true;

    // Build the tools array. Gemini accepts heterogeneous entries:
    //   tools: [{ googleSearch: {} }, { functionDeclarations: [...] }]
    // — server-side tools and client-side function declarations live
    // side by side. We only set toolConfig when we have local functions.
    const toolEntries: Array<Record<string, unknown>> = [];
    if (groundingEnabled) {
      toolEntries.push({ googleSearch: {} });
    }
    if (tools && tools.length > 0) {
      const functionDeclarations = tools.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: this.sanitizeSchemaForGemini(tool.function.parameters),
      }));
      toolEntries.push({ functionDeclarations });
      body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };

      // Log first tool's sanitized schema for debugging
      const firstDeclaration = functionDeclarations[0];
      if (firstDeclaration) {
        logger.debug('Gemini tool schema sample (first tool)', {
          source: 'GeminiNativeProvider',
          toolName: firstDeclaration.name,
          parametersType: (firstDeclaration.parameters as Record<string, unknown>)?.type,
        });
      }
    }
    if (toolEntries.length > 0) {
      body.tools = toolEntries;
    }
    if (groundingEnabled) {
      // Gemini rejects responseMimeType=application/json combined with
      // googleSearch — strip it with a warning rather than 400-ing.
      if ((generationConfig as Record<string, unknown>).responseMimeType) {
        logger.warn('Gemini googleSearch is incompatible with JSON mode — dropping responseMimeType', {
          source: 'GeminiNativeProvider',
        });
        delete (generationConfig as Record<string, unknown>).responseMimeType;
      }
      logger.debug('Gemini googleSearch grounding enabled for this request', {
        source: 'GeminiNativeProvider',
      });
    }

    // Log request for debugging
    logger.debug('Gemini request body built', {
      source: 'GeminiNativeProvider',
      contentsCount: merged.length,
      hasTools: !!(tools && tools.length > 0),
      toolCount: tools?.length || 0,
      toolNames: tools?.slice(0, 10).map(t => t.function.name).join(', ') || 'none',
    });

    return body;
  }

  private getCircuitBreakerKey(): string {
    return `provider:${this.baseURL}`;
  }

  /**
   * Wrap a network call in the shared circuit breaker when the caller opts in
   * (`ChatOptions.circuitBreaker`). When disabled (the default), runs the fn directly
   * so the common path is unchanged. Mirrors the OpenAI-compat provider (parity fix).
   */
  private async withCircuitBreaker<T>(enabled: boolean | undefined, fn: () => Promise<T>): Promise<T> {
    if (!enabled) return fn();
    return getCircuitBreaker(this.getCircuitBreakerKey()).execute(fn);
  }

  /**
   * Gemini-specific chat implementation
   */
  async chat(
    messages: CodeBuddyMessage[],
    tools?: CodeBuddyTool[],
    opts?: ChatOptions
  ): Promise<CodeBuddyResponse> {
    const performChat = async (messagesPayload: CodeBuddyMessage[]): Promise<CodeBuddyResponse> => {
      const model = opts?.model || this.currentModel;
      const malformedRetryCount = opts?.geminiMalformedRetryCount ?? 0;
      const url = `${this.baseURL}/models/${model}:generateContent`;
      const requestTimeoutMs =
        opts?.timeoutMs && opts.timeoutMs >= 1000 ? opts.timeoutMs : this.geminiRequestTimeoutMs;

      const body = this.buildGeminiBody(messagesPayload, tools, opts);

      // Log request for debugging
      logger.debug('Gemini request', {
        source: 'GeminiNativeProvider',
        model,
        hasTools: !!(tools && tools.length > 0),
        toolCount: tools?.length || 0,
      });

      let response: Response;
      try {
        // Make request with retry, optionally guarded by the circuit breaker.
        response = await this.withCircuitBreaker(opts?.circuitBreaker, () => retry(
          async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);
            let res: Response;
            try {
              res = await fetch(url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-goog-api-key': this.apiKey,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
              });
            } finally {
              clearTimeout(timeoutId);
            }

            if (!res.ok) {
              const errorText = await res.text();
              logger.error('Gemini API error', {
                source: 'GeminiNativeProvider',
                status: res.status,
                statusText: res.statusText,
                errorBody: errorText?.substring(0, 500),
              });
              throw new Error(`${res.status} ${errorText || res.statusText}`);
            }

            return res;
          },
          {
            ...RetryStrategies.llmApi,
            timeout: requestTimeoutMs * 2,
            isRetryable: RetryPredicates.llmApiError,
            onRetry: (error, attempt, delay) => {
              logger.warn(`Gemini API call failed, retrying (attempt ${attempt}) in ${delay}ms...`, {
                source: 'GeminiNativeProvider',
                error: error instanceof Error ? error.message : String(error),
                requestTimeoutMs,
              });
            },
          }
        ));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const looksLikeModel404 =
          message.includes('404') &&
          message.includes('models/') &&
          message.includes('is not found');
        const alreadyTriedFallback = opts?.geminiModelFallbackTried === true;

        if (looksLikeModel404 && !alreadyTriedFallback && model !== 'gemini-2.5-flash') {
          logger.warn('Gemini model not found, retrying with fallback model', {
            source: 'GeminiNativeProvider',
            originalModel: model,
            fallbackModel: 'gemini-2.5-flash',
          });
          return await this.chat(messagesPayload, tools, {
            ...opts,
            model: 'gemini-2.5-flash',
            geminiModelFallbackTried: true,
          });
        }
        throw error;
      }

      // Surface provider rate-limit headers for /quota visibility (parity with
      // OpenAI-compat). Best-effort: never let telemetry affect the response path,
      // and tolerate non-standard/mocked header objects.
      try {
        if (response.headers && typeof response.headers.forEach === 'function') {
          const rlHeaders: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            rlHeaders[key] = value;
          });
          storeRateLimitInfo(parseRateLimitHeaders(rlHeaders, 'gemini'));
        }
      } catch {
        /* rate-limit telemetry is best-effort */
      }

      const data = await response.json() as {
        candidates: Array<{
          content: {
            parts: Array<{ text?: string; functionCall?: { name: string; args: unknown } }>;
          };
          finishReason: string;
          groundingMetadata?: unknown;
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
      };

      // Convert response to CodeBuddy format
      const candidate = data.candidates?.[0];

      // Handle MALFORMED_FUNCTION_CALL: Gemini sometimes generates Python-style
      // calls instead of strict JSON tool-call args.
      if (candidate && !candidate.content && candidate.finishReason === 'MALFORMED_FUNCTION_CALL') {
        const finishMsg = (candidate as { finishMessage?: string }).finishMessage || '';
        logger.warn('Gemini returned MALFORMED_FUNCTION_CALL, requesting retry', {
          source: 'GeminiNativeProvider',
          snippet: finishMsg.substring(0, 200),
          malformedRetryCount,
        });

        if (malformedRetryCount < 2) {
          const recoverySystemMessage: CodeBuddyMessage = {
            role: 'system',
            content: 'Retry tool calling with strict JSON arguments only. Do not emit Python-style function syntax.',
          };
          return await this.chat(
            [...messagesPayload, recoverySystemMessage],
            tools,
            { ...opts, geminiMalformedRetryCount: malformedRetryCount + 1 },
          );
        }

        return {
          choices: [{
            message: {
              role: 'assistant',
              content: 'I generated a malformed function call. Let me retry with the correct tool format. I need to use proper JSON arguments, not Python syntax.',
              tool_calls: undefined,
            },
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
            completion_tokens: 0,
            total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
          },
        };
      }

      if (!candidate || !candidate.content) {
        logger.error('Gemini response missing candidate or content', {
          source: 'GeminiNativeProvider',
          hasCandidates: !!data.candidates,
          candidatesLength: data.candidates?.length,
          rawResponse: JSON.stringify(data).substring(0, 500),
        });
        throw new Error('Invalid Gemini response: missing candidate content');
      }

      // Handle empty content (Gemini may return content without parts for certain queries)
      if (!candidate.content.parts || candidate.content.parts.length === 0) {
        logger.warn('Gemini returned empty content parts', {
          source: 'GeminiNativeProvider',
          finishReason: candidate.finishReason,
        });
        // Return a graceful response instead of throwing
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: "Je ne peux pas répondre à cette question. Il s'agit peut-être d'une requête nécessitant des données en temps réel (météo, actualités) auxquelles je n'ai pas accès, ou d'une question que le modèle ne peut pas traiter.",
              tool_calls: undefined,
            },
            finish_reason: candidate.finishReason || 'stop',
          }],
          usage: {
            prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
            completion_tokens: 0,
            total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
          },
        };
      }

      const toolCalls: CodeBuddyToolCall[] = [];
      let content = '';

      for (const part of candidate.content.parts) {
        if (part.text) {
          content += part.text;
        } else if (part.functionCall) {
          const toolCall = {
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            type: 'function' as const,
            function: {
              name: part.functionCall.name,
              arguments: JSON.stringify(part.functionCall.args),
            },
          };
          toolCalls.push(toolCall);
          logger.debug('Gemini tool call extracted', {
            source: 'GeminiNativeProvider',
            toolName: part.functionCall.name,
            args: JSON.stringify(part.functionCall.args).substring(0, 200),
          });
        }
      }

      // When grounding was active, append the citation footer so the
      // assistant message carries the sources alongside the prose. This
      // is what the agent loop sees and what gets persisted to history.
      const groundingFooter = GeminiNativeProvider.formatGroundingFooter(candidate.groundingMetadata);
      if (groundingFooter && content) {
        content += groundingFooter;
      }

      // Log response summary
      logger.debug('Gemini response parsed', {
        source: 'GeminiNativeProvider',
        hasContent: !!content,
        contentLength: content.length,
        toolCallCount: toolCalls.length,
        finishReason: candidate.finishReason,
        hasGrounding: !!groundingFooter,
      });

      return {
        choices: [{
          message: {
            role: 'assistant',
            content: content || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          },
          finish_reason: candidate.finishReason === 'STOP' ? 'stop' : candidate.finishReason.toLowerCase(),
        }],
        usage: data.usageMetadata ? {
          prompt_tokens: data.usageMetadata.promptTokenCount || 0,
          completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
          total_tokens: data.usageMetadata.totalTokenCount || 0,
        } : undefined,
      };
    };

    if (opts?.responseFormat === 'json') {
      const { generateJsonWithRetry } = await import('../../utils/llm-retry.js');
      const generateFn = async (promptUpdate: string): Promise<string> => {
        const callMessages = [...messages];
        if (promptUpdate !== 'initial') {
          callMessages.push({ role: 'user', content: promptUpdate });
        }
        const response = await performChat(callMessages);
        return response.choices[0]?.message?.content || '';
      };

      const parsed = await generateJsonWithRetry<any>(generateFn, 'initial');
      const finalString = JSON.stringify(parsed);
      return {
        choices: [{
          message: {
            role: 'assistant',
            content: finalString,
          },
          finish_reason: 'stop',
        }],
      };
    }

    return await performChat(messages);
  }

  private convertContentToGeminiParts(
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null | undefined
  ): Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> {
    if (!content) {
      return [{ text: '' }];
    }
    if (typeof content === 'string') {
      return [{ text: content }];
    }
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
    for (const part of content) {
      if (part.type === 'text' && part.text) {
        parts.push({ text: part.text });
      } else if (part.type === 'image_url' && part.image_url) {
        const { mimeType, data } = this.parseDataUrl(part.image_url.url);
        parts.push({ inlineData: { mimeType, data } });
      }
    }
    return parts.length > 0 ? parts : [{ text: '' }];
  }

  private parseDataUrl(url: string): { mimeType: string; data: string } {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (match && match[1] !== undefined && match[2] !== undefined) {
      return { mimeType: match[1], data: match[2] };
    }
    return { mimeType: 'image/png', data: url };
  }

  /**
   * Sanitize JSON Schema for Gemini API compatibility
   * - Converts lowercase types to uppercase (string -> STRING, object -> OBJECT)
   * - Ensures all array types have 'items' defined
   */
  private sanitizeSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    const result: Record<string, unknown> = { ...schema };

    // Convert lowercase type to uppercase for Gemini
    if (typeof result.type === 'string') {
      const upperType = GeminiNativeProvider.GEMINI_TYPE_MAP[result.type.toLowerCase()];
      if (upperType) {
        result.type = upperType;
      }
    }

    // If this is an array type without items, add default items (use uppercase for Gemini)
    if (result.type === 'ARRAY' && !result.items) {
      result.items = { type: 'OBJECT' };
      logger.debug('Added missing items to array schema', {
        source: 'GeminiNativeProvider',
      });
    }

    // Recursively sanitize properties
    if (result.properties && typeof result.properties === 'object') {
      const props = result.properties as Record<string, Record<string, unknown>>;
      const sanitizedProps: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        sanitizedProps[key] = this.sanitizeSchemaForGemini(value);
      }
      result.properties = sanitizedProps;

      // Filter required to only include properties that actually exist
      if (Array.isArray(result.required)) {
        const propKeys = new Set(Object.keys(sanitizedProps));
        result.required = (result.required as string[]).filter(r => propKeys.has(r));
        if ((result.required as string[]).length === 0) {
          delete result.required;
        }
      }
    }

    // Recursively sanitize items if present
    if (result.items && typeof result.items === 'object') {
      result.items = this.sanitizeSchemaForGemini(result.items as Record<string, unknown>);
    }

    // Recursively sanitize enum values (keep as-is, just ensure array items are sanitized)
    if (result.enum && Array.isArray(result.enum)) {
      // Enum values stay as-is (they're string values, not types)
    }

    return result;
  }

  /**
   * Parse Gemini SSE stream into individual JSON chunks
   */
  private async *parseGeminiSSE(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): AsyncGenerator<Record<string, unknown>, void, unknown> {
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on SSE boundaries
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          if (jsonStr === '[DONE]') return;
          try {
            yield JSON.parse(jsonStr);
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim().startsWith('data: ')) {
      const jsonStr = buffer.trim().slice(6);
      if (jsonStr !== '[DONE]') {
        try {
          yield JSON.parse(jsonStr);
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }

  /**
   * Gemini-specific streaming using streamGenerateContent SSE API
   */
  async *chatStream(
    messages: CodeBuddyMessage[],
    tools?: CodeBuddyTool[],
    opts?: ChatOptions
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const model = opts?.model || this.currentModel;
    const streamUrl = `${this.baseURL}/models/${model}:streamGenerateContent?alt=sse`;
    const requestTimeoutMs =
      opts?.timeoutMs && opts.timeoutMs >= 1000 ? opts.timeoutMs : this.geminiRequestTimeoutMs;

    try {
      // Build the same request body as chat
      const body = this.buildGeminiBody(messages, tools, opts);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

      let res: Response;
      try {
        res = await this.withCircuitBreaker(opts?.circuitBreaker, () => fetch(streamUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }));
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        // Fallback to non-streaming on error
        logger.warn('Gemini streaming failed, falling back to non-streaming', {
          source: 'GeminiNativeProvider',
          status: res.status,
        });
        yield* this.geminiChatStreamFallback(messages, tools, opts);
        return;
      }

      if (!res.body) {
        yield* this.geminiChatStreamFallback(messages, tools, opts);
        return;
      }

      const reader = res.body.getReader();
      let chunkIndex = 0;
      let lastGroundingMetadata: unknown = null;

      for await (const chunk of this.parseGeminiSSE(reader)) {
        const candidates = (chunk as Record<string, unknown>).candidates as Array<Record<string, unknown>> | undefined;
        if (!candidates || candidates.length === 0) continue;

        const candidate = candidates[0];
        if (!candidate) continue;
        // Grounding metadata typically arrives in the final chunk of the
        // stream — keep the latest non-empty payload around so we can
        // emit the "Sources:" footer right before the stop chunk.
        if (candidate.groundingMetadata) {
          lastGroundingMetadata = candidate.groundingMetadata;
        }
        const content = candidate.content as { parts?: Array<Record<string, unknown>> } | undefined;
        const parts = content?.parts;
        if (!parts) continue;

        for (const part of parts) {
          if (part.text) {
            yield {
              id: `chatcmpl-gemini-${Date.now()}-${chunkIndex++}`,
              object: 'chat.completion.chunk' as const,
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{
                index: 0,
                delta: {
                  role: 'assistant' as const,
                  content: part.text as string,
                },
                finish_reason: null,
              }],
            };
          }

          if (part.functionCall) {
            const fc = part.functionCall as { name: string; args?: Record<string, unknown> };
            yield {
              id: `chatcmpl-gemini-${Date.now()}-${chunkIndex++}`,
              object: 'chat.completion.chunk' as const,
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{
                index: 0,
                delta: {
                  tool_calls: [{
                    index: 0,
                    id: `call_${Date.now()}_${chunkIndex}`,
                    type: 'function' as const,
                    function: {
                      name: fc.name,
                      arguments: JSON.stringify(fc.args || {}),
                    },
                  }],
                },
                finish_reason: null,
              }],
            };
          }
        }

        // Check for finish reason
        const finishReason = candidate.finishReason as string | undefined;
        if (finishReason && finishReason !== 'STOP') {
          // Map Gemini finish reasons to OpenAI format
          const finishMap: Record<string, string> = {
            'STOP': 'stop',
            'MAX_TOKENS': 'length',
            'SAFETY': 'content_filter',
            'RECITATION': 'content_filter',
          };
          const mappedReason = finishMap[finishReason] || 'stop';
          yield {
            id: `chatcmpl-gemini-${Date.now()}-${chunkIndex++}`,
            object: 'chat.completion.chunk' as const,
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: mappedReason as 'stop' | 'tool_calls' | 'length' | 'content_filter' | null,
            }],
          };
        }
      }

      // Emit the Sources footer (if any) BEFORE the final stop chunk so
      // it lands in the assistant content rather than after finish_reason.
      const groundingFooter = GeminiNativeProvider.formatGroundingFooter(lastGroundingMetadata);
      if (groundingFooter) {
        yield {
          id: `chatcmpl-gemini-${Date.now()}-${chunkIndex++}`,
          object: 'chat.completion.chunk' as const,
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            delta: {
              role: 'assistant' as const,
              content: groundingFooter,
            },
            finish_reason: null,
          }],
        };
      }

      // Final stop chunk
      yield {
        id: `chatcmpl-gemini-${Date.now()}-${chunkIndex}`,
        object: 'chat.completion.chunk' as const,
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop',
        }],
      };
    } catch (error) {
      logger.warn('Gemini streaming error, falling back to non-streaming', {
        source: 'GeminiNativeProvider',
        error: error instanceof Error ? error.message : String(error),
      });
      yield* this.geminiChatStreamFallback(messages, tools, opts);
    }
  }

  /**
   * Fallback: non-streaming Gemini call emitted as synthetic chunks
   */
  private async *geminiChatStreamFallback(
    messages: CodeBuddyMessage[],
    tools?: CodeBuddyTool[],
    opts?: ChatOptions
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const response = await this.chat(messages, tools, opts);
    const choice = response.choices[0];
    if (!choice) {
      throw new Error('Gemini chat response contained no choices');
    }

    if (choice.message.content) {
      yield {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion.chunk' as const,
        created: Math.floor(Date.now() / 1000),
        model: opts?.model || this.currentModel,
        choices: [{
          index: 0,
          delta: {
            role: 'assistant' as const,
            content: choice.message.content,
          },
          finish_reason: null,
        }],
      };
    }

    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      for (const toolCall of choice.message.tool_calls) {
        yield {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk' as const,
          created: Math.floor(Date.now() / 1000),
          model: opts?.model || this.currentModel,
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: toolCall.id,
                type: 'function' as const,
                function: {
                  name: toolCall.function.name,
                  arguments: toolCall.function.arguments,
                },
              }],
            },
            finish_reason: null,
          }],
        };
      }
    }

    yield {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion.chunk' as const,
      created: Math.floor(Date.now() / 1000),
      model: opts?.model || this.currentModel,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: choice.finish_reason as 'stop' | 'tool_calls' | 'length' | 'content_filter' | null,
      }],
    };
  }
}
