/**
 * Per-Model Tool Configuration (Codex-inspired)
 *
 * Different models get different tool sets and prompt templates
 * based on their capabilities. For example, smaller models might
 * not get complex tools, and some models support specific features
 * like extended thinking or structured outputs.
 */

import { logger } from '../utils/logger.js';
import type { ModelStrength } from './model-strengths.js';

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelToolConfig {
  /** Model name pattern (glob-like matching) */
  model: string;
  /**
   * Strengths the booleans cannot express (code, thinking, french, fast,
   * cheap). reasoning/vision/tool-calling/long-context are DERIVED from the
   * booleans + contextWindow by `getModelStrengths()` — do not duplicate them
   * here. This field is the single source of truth that replaced the three
   * name-regex mappers (inferStrengths / deriveStrengths / cfgToStrengths).
   */
  strengths?: ModelStrength[];
  /** Tools to enable for this model (null = all tools) */
  enabledTools?: string[] | null;
  /** Tools to disable for this model */
  disabledTools?: string[];
  /** Maximum tool rounds per turn */
  maxToolRounds?: number;
  /** Whether this model supports extended thinking/reasoning */
  supportsReasoning?: boolean;
  /** Reasoning efforts accepted by the model API, when explicitly documented. */
  supportedReasoningEfforts?: readonly ReasoningEffort[];
  /** Whether this model supports structured tool calls (function calling) */
  supportsToolCalls?: boolean;
  /** Whether this model supports vision/images */
  supportsVision?: boolean;
  /** System prompt template override */
  systemPromptTemplate?: string;
  /** Max output tokens for this model */
  maxOutputTokens?: number;
  /** Context window size */
  contextWindow?: number;
  /** Preferred patch format: 'unified' | 'search_replace' | 'full_file' */
  patchFormat?: 'unified' | 'search_replace' | 'full_file';
  /**
   * Phase d.22 — system-prompt size profile.
   *   - `'lite'` : minimal SP (base + writing-rules only). For small
   *     local models (Ollama qwen 7b, llama3 8b) that drown in context
   *     and hallucinate tool calls when shown 73 KB of directives.
   *   - `'standard'` (default) : query-classified gating per
   *     `classifyQuery(message).complexity` — trivial gets minimal,
   *     complex gets full.
   *   - `'rich'` : every block always injected. For top-tier cloud
   *     models (Claude Opus, Grok-3) that handle and benefit from the
   *     full instruction set.
   */
  promptProfile?: 'lite' | 'standard' | 'rich';
}

/**
 * Default per-model configurations.
 * Models are matched by prefix — first match wins.
 */
const DEFAULT_MODEL_CONFIGS: ModelToolConfig[] = [
  // OpenRouter free pool — full provider-qualified IDs. These must precede
  // local bare-name globs such as qwen3* / gemma4*. The output caps are
  // intentionally below provider maxima to keep free councils responsive.
  {
    model: 'openrouter/free',
    strengths: ['cheap'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 200000,
    maxOutputTokens: 4096,
    patchFormat: 'search_replace',
  },
  {
    model: 'openai/gpt-oss-*:free',
    strengths: ['thinking', 'cheap'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 131072,
    maxOutputTokens: 4096,
    patchFormat: 'search_replace',
  },
  {
    model: 'cohere/north-mini-code:free',
    strengths: ['code', 'fast', 'cheap'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 256000,
    maxOutputTokens: 8192,
    patchFormat: 'search_replace',
  },
  {
    model: 'qwen/qwen3-coder:free',
    strengths: ['code', 'french', 'cheap'],
    supportsReasoning: false,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    patchFormat: 'search_replace',
  },
  {
    model: 'qwen/qwen3-next-80b-a3b-instruct:free',
    strengths: ['french', 'fast', 'cheap'],
    supportsReasoning: false,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 262144,
    maxOutputTokens: 8192,
    patchFormat: 'search_replace',
  },
  {
    model: 'google/gemma-4-*:free',
    strengths: ['french', 'cheap'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 262144,
    maxOutputTokens: 8192,
    patchFormat: 'search_replace',
  },
  {
    model: 'nvidia/nemotron-3-*:free',
    strengths: ['thinking', 'cheap'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    patchFormat: 'search_replace',
  },
  {
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    strengths: ['cheap'],
    supportsReasoning: false,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 131072,
    maxOutputTokens: 4096,
    patchFormat: 'search_replace',
  },
  {
    model: 'poolside/laguna-*:free',
    strengths: ['code', 'fast', 'cheap'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 262144,
    maxOutputTokens: 8192,
    patchFormat: 'search_replace',
  },
  // GPT-4.1 (1M context)
  {
    model: 'gpt-4.1*',
    supportsReasoning: false,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 1000000,
    maxOutputTokens: 32768,
    patchFormat: 'unified',
  },
  // o4 / o4-mini (2026 reasoning models)
  {
    model: 'o4*',
    strengths: ['thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 200000,
    maxOutputTokens: 100000,
    patchFormat: 'unified',
  },
  // o3-mini (reasoning model)
  {
    model: 'o3-mini*',
    strengths: ['thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 200000,
    maxOutputTokens: 100000,
    patchFormat: 'unified',
  },
  // o1 / o1-mini (reasoning models)
  {
    model: 'o1*',
    strengths: ['thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 200000,
    maxOutputTokens: 100000,
    patchFormat: 'unified',
  },
  // GPT-4o
  {
    model: 'gpt-4o*',
    supportsReasoning: false,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 128000,
    maxOutputTokens: 16384,
    patchFormat: 'unified',
  },
  // GPT-4 (other)
  {
    model: 'gpt-4*',
    supportsReasoning: false,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 128000,
    maxOutputTokens: 16384,
    patchFormat: 'unified',
  },
  // Claude Opus 4.6 (200K context, 128K output)
  {
    model: 'claude-opus-4-6*',
    strengths: ['code', 'thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 200000,
    maxOutputTokens: 128000,
    patchFormat: 'search_replace',
    promptProfile: 'rich',
  },
  // Claude Sonnet 4.5 (200K context, 64K output)
  {
    model: 'claude-sonnet-4-5*',
    strengths: ['code', 'thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    patchFormat: 'search_replace',
    promptProfile: 'rich',
  },
  // Claude Haiku 4.5 (200K context, 64K output)
  {
    model: 'claude-haiku-4-5*',
    strengths: ['code', 'thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    patchFormat: 'search_replace',
  },
  // Claude Opus 4/4.1/4.5 (200K context, 32K-64K output)
  {
    model: 'claude-opus-4*',
    strengths: ['code', 'thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 200000,
    maxOutputTokens: 32000,
    patchFormat: 'search_replace',
    promptProfile: 'rich',
  },
  // Claude Sonnet 4 (200K context, 64K output)
  {
    model: 'claude-sonnet-4*',
    strengths: ['code', 'thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    patchFormat: 'search_replace',
  },
  // Claude 3.x legacy
  {
    model: 'claude-3*',
    strengths: ['code'],
    supportsReasoning: false,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 200000,
    maxOutputTokens: 8192,
    patchFormat: 'search_replace',
  },
  // Claude catch-all
  {
    model: 'claude-*',
    strengths: ['code', 'thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    patchFormat: 'search_replace',
  },

  // GPT-5.6 Sol — public OpenAI API capabilities. Keep the official `gpt-5.6`
  // alias exact so it cannot absorb sibling ChatGPT subscription slugs such as
  // `gpt-5.6-terra` or `gpt-5.6-luna`. Versioned Sol snapshots may still use
  // the canonical glob.
  {
    model: 'gpt-5.6-sol*',
    strengths: ['code', 'thinking'],
    supportsReasoning: true,
    supportedReasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    patchFormat: 'unified',
    promptProfile: 'rich',
  },
  {
    model: 'gpt-5.6',
    strengths: ['code', 'thinking'],
    supportsReasoning: true,
    supportedReasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    patchFormat: 'unified',
    promptProfile: 'rich',
  },

  // ChatGPT Codex backend (Phase d.23) — exposed via OAuth subscription.
  // GPT-5.5 remains the historical fallback for older accounts/backends.
  {
    model: 'gpt-5.5*',
    strengths: ['code', 'thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    patchFormat: 'search_replace',
    promptProfile: 'rich',
  },
  {
    model: 'gpt-5.1-codex*',
    strengths: ['code', 'thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    patchFormat: 'search_replace',
    promptProfile: 'rich',
  },
  {
    model: 'gpt-5-codex*',
    strengths: ['code', 'thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    patchFormat: 'search_replace',
    promptProfile: 'rich',
  },
  {
    model: 'gpt-5.1*',
    strengths: ['thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 200000,
    maxOutputTokens: 64000,
    patchFormat: 'search_replace',
    promptProfile: 'rich',
  },
  // GPT-5 (400K context, 128K output)
  {
    model: 'gpt-5*',
    strengths: ['thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    patchFormat: 'unified',
  },
  // Grok 4.1 Fast (2M context)
  {
    model: 'grok-4*fast*',
    strengths: ['thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 2000000,
    maxOutputTokens: 16384,
    patchFormat: 'search_replace',
    promptProfile: 'rich',
  },
  // Grok 4 (256K context)
  {
    model: 'grok-4*',
    strengths: ['thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 256000,
    maxOutputTokens: 16384,
    patchFormat: 'search_replace',
    promptProfile: 'rich',
  },
  // Grok Code Fast (256K context)
  {
    model: 'grok-code*',
    strengths: ['code'],
    supportsReasoning: false,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 256000,
    maxOutputTokens: 16384,
    patchFormat: 'search_replace',
  },
  // Grok 3
  {
    model: 'grok-3*',
    supportsReasoning: false,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 131072,
    maxOutputTokens: 8192,
    patchFormat: 'search_replace',
  },
  // Grok 2
  {
    model: 'grok-2*',
    supportsReasoning: false,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 32768,
    maxOutputTokens: 4096,
    patchFormat: 'full_file',
  },

  // Gemini 3.1 Flash-Lite (1M context, 64K output, thinkingLevel support)
  {
    model: 'gemini-3.1-flash-lite*',
    strengths: ['thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 1000000,
    maxOutputTokens: 64000,
    patchFormat: 'unified',
  },
  // Gemini 3.x (1M context, 64K output)
  {
    model: 'gemini-3*',
    strengths: ['thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 1000000,
    maxOutputTokens: 64000,
    patchFormat: 'unified',
  },
  // Gemini 2.5 (1M context, 65K output)
  {
    model: 'gemini-2.5*',
    strengths: ['thinking'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 1000000,
    maxOutputTokens: 65536,
    patchFormat: 'unified',
  },
  // Gemini 2.0
  {
    model: 'gemini-2*',
    supportsReasoning: false,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    patchFormat: 'search_replace',
  },
  // Gemini 1.5 Pro (2M context)
  {
    model: 'gemini-1.5-pro*',
    supportsReasoning: false,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 2000000,
    maxOutputTokens: 8192,
    patchFormat: 'search_replace',
  },
  // Gemini 1.5 Flash
  {
    model: 'gemini-1.5*',
    supportsReasoning: false,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    patchFormat: 'search_replace',
  },

  // Mistral / Devstral
  {
    model: 'devstral*',
    strengths: ['code', 'french'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 131072,
    maxOutputTokens: 16384,
    patchFormat: 'search_replace',
  },
  {
    model: 'mistral*',
    strengths: ['french'],
    supportsReasoning: false,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 32768,
    maxOutputTokens: 4096,
    patchFormat: 'full_file',
  },

  // Ollama / Local models — conservative defaults.
  //
  // The local-model match is tricky because the OpenAI-compat path
  // (used when OLLAMA_HOST is set + we route through the openai
  // strategy) sends the BARE model id like `qwen2.5-coder:7b`, not
  // `ollama/qwen2.5-coder:7b`. So `ollama/*` alone misses it. We list
  // the common Ollama-shipped families directly so the conservative
  // config is picked up regardless of how the request was routed.
  // Moondream2 profile verified against the local Ollama manifest on
  // 2026-07-14: Phi-2 + CLIP, 2,048-token context, completion + vision only.
  {
    model: 'moondream*',
    strengths: ['fast', 'cheap'],
    supportsReasoning: false,
    supportsToolCalls: false,
    supportsVision: true,
    contextWindow: 2048,
    maxOutputTokens: 512,
    maxToolRounds: 0,
    enabledTools: [],
    patchFormat: 'full_file',
    promptProfile: 'lite',
  },
  {
    model: 'ollama/*',
    supportsReasoning: false,
    supportsToolCalls: false,
    supportsVision: false,
    contextWindow: 8192,
    maxOutputTokens: 2048,
    maxToolRounds: 10,
    disabledTools: ['apply_patch', 'browser', 'computer_control'],
    patchFormat: 'full_file',
    promptProfile: 'lite',
  },
  {
    model: 'qwen2.5*',
    strengths: ['french'],
    supportsReasoning: false,
    // Conservative: qwen2.5:7b emits tool calls as TEXT (not structured OpenAI
    // tool_calls) via Ollama, so the agent can't execute them — it stays
    // chat-only. Verified flaky against scripts/autonomy-lab/ (unlike qwen3,
    // which does emit structured calls). Use qwen3+ for autonomous editing.
    supportsToolCalls: false,
    supportsVision: false,
    contextWindow: 32768,
    maxOutputTokens: 2048,
    maxToolRounds: 10,
    disabledTools: ['apply_patch', 'browser', 'computer_control'],
    patchFormat: 'full_file',
    promptProfile: 'lite',
  },
  {
    model: 'qwen3*',
    strengths: ['french'],
    supportsReasoning: true,
    // qwen3 (incl. the 2026 MoE builds) reliably emits OpenAI tool calls via
    // Ollama, so it can drive the agent loop — unlike the older small models
    // this table conservatively gates to chat-only. Verified against the
    // autonomy lab (scripts/autonomy-lab/).
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 32768,
    maxOutputTokens: 4096,
    maxToolRounds: 10,
    disabledTools: ['apply_patch', 'browser', 'computer_control'],
    patchFormat: 'full_file',
    promptProfile: 'lite',
  },
  {
    model: 'llama3*',
    supportsReasoning: false,
    supportsToolCalls: false,
    supportsVision: false,
    contextWindow: 8192,
    maxOutputTokens: 2048,
    maxToolRounds: 10,
    disabledTools: ['apply_patch', 'browser', 'computer_control'],
    patchFormat: 'full_file',
    promptProfile: 'lite',
  },
  {
    model: 'deepseek*',
    supportsReasoning: false,
    supportsToolCalls: false,
    supportsVision: false,
    contextWindow: 32768,
    maxOutputTokens: 2048,
    maxToolRounds: 10,
    disabledTools: ['apply_patch', 'browser', 'computer_control'],
    patchFormat: 'full_file',
    promptProfile: 'lite',
  },
  // Gemma 4 (Ollama) — local multimodal model with thinking and tool support.
  // Keep the lite prompt/tool profile, but expose the capabilities reported by
  // current Ollama builds so Cowork can accept images and enable reasoning UI.
  // Real `buddy goal` smoke with gemma4:12b only succeeds when the selected
  // tools are preserved. Use a conservative 32K working context on local RAM
  // even though the model advertises a substantially larger maximum.
  {
    model: 'gemma4*',
    strengths: ['french'],
    supportsReasoning: true,
    supportsToolCalls: true,
    supportsVision: true,
    contextWindow: 32768,
    maxOutputTokens: 4096,
    maxToolRounds: 10,
    disabledTools: ['apply_patch', 'browser', 'computer_control'],
    patchFormat: 'full_file',
    promptProfile: 'lite',
  },
  // Gemma 2/3 (legacy lineage) — same conservative defaults.
  {
    model: 'gemma*',
    strengths: ['french'],
    supportsReasoning: false,
    supportsToolCalls: false,
    supportsVision: false,
    contextWindow: 8192,
    maxOutputTokens: 2048,
    maxToolRounds: 10,
    disabledTools: ['apply_patch', 'browser', 'computer_control'],
    patchFormat: 'full_file',
    promptProfile: 'lite',
  },

  // LM Studio (same as Ollama)
  {
    model: 'meta-llama-3.1-8b-instruct',
    supportsReasoning: false,
    supportsToolCalls: false,
    supportsVision: false,
    contextWindow: 131072,
    maxOutputTokens: 4096,
    maxToolRounds: 10,
    disabledTools: ['apply_patch', 'browser', 'computer_control'],
    patchFormat: 'full_file',
    promptProfile: 'lite',
  },
  {
    model: 'lmstudio/*',
    supportsReasoning: false,
    supportsToolCalls: false,
    supportsVision: false,
    contextWindow: 8192,
    maxOutputTokens: 2048,
    maxToolRounds: 10,
    disabledTools: ['apply_patch', 'browser', 'computer_control'],
    patchFormat: 'full_file',
  },
];

/**
 * Match a model name against a pattern with glob-like wildcards.
 */
function matchModel(modelName: string, pattern: string): boolean {
  // Escape regex metacharacters FIRST (except the glob wildcards * and ?), THEN
  // expand the wildcards. Without escaping, a literal '.' in a version pattern
  // like `gpt-5.5` / `gpt-4.1` acted as regex "any char" and could match the
  // wrong family (e.g. `gpt-4.1` matching `gpt-4o1`), assigning a model the
  // wrong context/output caps.
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  return regex.test(modelName);
}

/**
 * Get the tool configuration for a specific model.
 * Falls back to permissive defaults if no match.
 * Results are cached per model name (when no custom configs are provided).
 */
const _configCache = new Map<string, ModelToolConfig>();

export function getModelToolConfig(
  modelName: string,
  customConfigs?: ModelToolConfig[],
): ModelToolConfig {
  // Use cache for default config lookups (hot path)
  if (!customConfigs && _configCache.has(modelName)) {
    return _configCache.get(modelName)!;
  }

  const configs = [...(customConfigs || []), ...DEFAULT_MODEL_CONFIGS];

  for (const config of configs) {
    if (matchModel(modelName, config.model)) {
      logger.debug('Model tool config matched', { model: modelName, pattern: config.model });
      if (!customConfigs) _configCache.set(modelName, config);
      return config;
    }
  }

  // Permissive fallback
  logger.debug('No model tool config match, using defaults', { model: modelName });
  const fallback: ModelToolConfig = {
    model: modelName,
    supportsReasoning: false,
    supportsToolCalls: true,
    supportsVision: false,
    contextWindow: 32768,
    maxOutputTokens: 4096,
    patchFormat: 'search_replace',
  };
  if (!customConfigs) _configCache.set(modelName, fallback);
  return fallback;
}

// ─── Model strengths (single source of truth) ───────────────────────
//
// Replaces the three divergent name→strengths mappers that used to live in
// fleet/model-capability-heuristics.ts (inferStrengths), fleet/capability-
// registry.ts (deriveStrengths) and fleet/model-inventory.ts (cfgToStrengths)
// — all three now delegate here.

/** Name heuristics for strengths the config booleans cannot express. */
const NAME_CODE = /code|coder|codex/i;
const NAME_THINKING = /thinking|reasoner|qwq|r1\b|a3b/i;
const NAME_FAST_CHEAP = /flash|mini|fast|haiku|small|nano|tiny|gemma|:3b|:4b|:7b|:8b|\b3b\b|\b7b\b|\b8b\b/i;
const NAME_FRENCH = /mistral|qwen|gemma|mixtral/i;

/** Fallback-only heuristics — applied ONLY when no glob matched (the config
 * booleans are authoritative for reasoning/vision when a glob DID match). */
const NAME_REASONING_FALLBACK = /opus|gpt-5|o1|o3|reason|think|r1|qwq|deepseek|gemini|sonnet|grok-[34]/i;
const NAME_VISION_FALLBACK = /vision|gpt-4o|gpt-5|gemini/i;
const NAME_LONG_CONTEXT_FALLBACK = /gemini|pro|opus|sonnet|long|1m|200k|128k/i;

function matchModelConfig(modelName: string): { cfg: ModelToolConfig; matched: boolean } {
  for (const config of DEFAULT_MODEL_CONFIGS) {
    if (matchModel(modelName, config.model)) return { cfg: config, matched: true };
  }
  return { cfg: getModelToolConfig(modelName), matched: false };
}

const _strengthsCache = new Map<string, ModelStrength[]>();

/** Test seam — clear the strengths memo. */
export function resetModelStrengthsCache(): void {
  _strengthsCache.clear();
}

/**
 * Derive a model's strengths from its config entry (single source of truth).
 *
 * Precedence:
 *  - **Glob matched** — the config booleans are AUTHORITATIVE: reasoning /
 *    vision / tool-calling come from `supportsReasoning` / `supportsVision` /
 *    `supportsToolCalls`, long-context from `contextWindow ≥ 128k`. The
 *    explicit `strengths` field and the name heuristics add ONLY strengths
 *    the booleans cannot express (code, thinking, fast, cheap, french) — a
 *    name pattern never grants vision/reasoning/tool-calling against the
 *    config (e.g. gpt-5-codex is NOT vision, qwen2.5 is NOT tool-calling).
 *  - **No glob matched** (unknown model) — no authoritative data, so the full
 *    legacy regex union applies, plus the permissive fallback's booleans
 *    (which include tool-calling).
 */
export function getModelStrengths(modelName: string): ModelStrength[] {
  const cached = _strengthsCache.get(modelName);
  if (cached) return [...cached];

  const { cfg, matched } = matchModelConfig(modelName);
  const out = new Set<ModelStrength>();

  if (cfg.supportsReasoning) out.add('reasoning');
  if (cfg.supportsVision) out.add('vision');
  if (cfg.supportsToolCalls) out.add('tool-calling');
  if ((cfg.contextWindow ?? 0) >= 128_000) out.add('long-context');

  if (matched) {
    for (const s of cfg.strengths ?? []) out.add(s);
  }
  if (NAME_CODE.test(modelName)) out.add('code');
  if (NAME_THINKING.test(modelName)) out.add('thinking');
  if (NAME_FAST_CHEAP.test(modelName)) {
    out.add('fast');
    out.add('cheap');
  }
  if (NAME_FRENCH.test(modelName)) out.add('french');

  if (!matched) {
    if (NAME_REASONING_FALLBACK.test(modelName)) {
      out.add('reasoning');
      out.add('thinking');
    }
    if (NAME_VISION_FALLBACK.test(modelName)) out.add('vision');
    if (NAME_LONG_CONTEXT_FALLBACK.test(modelName)) out.add('long-context');
  }

  const arr = [...out];
  _strengthsCache.set(modelName, arr);
  return [...arr];
}

/**
 * Filter a list of tool names based on model capabilities.
 */
export function filterToolsForModel(
  toolNames: string[],
  modelConfig: ModelToolConfig,
): string[] {
  let filtered = [...toolNames];

  // Remove disabled tools
  if (modelConfig.disabledTools) {
    filtered = filtered.filter(t => !modelConfig.disabledTools!.includes(t));
  }

  // Keep only enabled tools (if specified)
  if (modelConfig.enabledTools) {
    filtered = filtered.filter(t => modelConfig.enabledTools!.includes(t));
  }

  // Remove vision tools if not supported
  if (!modelConfig.supportsVision) {
    filtered = filtered.filter(t => !['view_image', 'screenshot', 'screen_capture'].includes(t));
  }

  return filtered;
}
