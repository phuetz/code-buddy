/**
 * Adaptive auto-compact threshold helper.
 *
 * Derived from the comparative audit Claude Code source vs Code Buddy
 * SmartCompactionEngine (private-handover-repo/propositions/AUDIT-COMPACTION-CLAUDE-CODE-2026-05-04.md).
 * Recommended #1 in the audit — adaptive buffer per model, scope M.
 *
 * Problem
 * -------
 * Code Buddy's current `shouldAutoCompact` uses a single percent
 * (`CODEBUDDY_AUTOCOMPACT_PCT`, default ~85%) of `maxContextTokens` —
 * fixed across models. Claude Code source uses a buffer-tokens approach:
 * `effective = contextWindow − bufferTokens` where bufferTokens varies
 * per model (~13K for Claude 3.5 Sonnet, smaller for Haiku, etc.) plus
 * a dynamic output reservation. Result: large models (200K context)
 * leave ~15K of unused slack; small models (100K) miss margin.
 *
 * Solution
 * --------
 * A pure function that computes the threshold given `maxContextTokens`
 * + an optional model name. Looks up a buffer in a default per-model
 * table (overridable via `bufferTokensByModel` config or
 * `CODEBUDDY_AUTOCOMPACT_BUFFER_TOKENS` env). Optionally applies a
 * percent multiplier on top.
 *
 * Standalone module: easily testable, easily wired into
 * `ContextManagerV2.shouldAutoCompact()` when ready (backward compat).
 */

/**
 * Default buffer-tokens reservation per model family.
 * Larger models get larger buffers proportional to typical output sizes.
 * Lookup is by case-insensitive substring (so `claude-sonnet-4-6`
 * matches `claude-sonnet`).
 */
const DEFAULT_BUFFER_TABLE: Record<string, number> = {
  // Claude family
  'claude-opus': 16_000,
  'claude-sonnet': 13_000,
  'claude-haiku': 8_000,
  // Gemini family
  'gemini-2.5-pro': 13_000,
  'gemini-2.5-flash': 10_000,
  'gemini-2.0-flash': 8_000,
  'gemini-1.5-pro': 13_000,
  // Grok family
  'grok-4': 14_000,
  'grok-3': 12_000,
  'grok-2': 10_000,
  // GPT family
  'gpt-4o': 12_000,
  'gpt-4-turbo': 12_000,
  // Local Ollama (smaller default — local models often have tight contexts)
  'qwen2.5-coder': 8_000,
  'qwen3': 8_000,
  'llama3': 8_000,
  'gemma': 8_000,
  // Last-resort fallback
  default: 13_000,
};

export interface AutoCompactThresholdOptions {
  /** Per-model buffer override (case-insensitive substring match on model name). */
  bufferTokensByModel?: Record<string, number>;
  /** Single buffer override (wins over per-model table when set). */
  bufferTokens?: number;
  /**
   * Optional percent multiplier (0–100). Applied on top of
   * `(maxContextTokens − buffer)`. When omitted, the threshold equals
   * `maxContextTokens − buffer` (full effective budget).
   */
  percent?: number;
}

/**
 * Pick the buffer-tokens value to apply for a given model.
 * Priority: explicit options.bufferTokens > options.bufferTokensByModel
 * substring match > env CODEBUDDY_AUTOCOMPACT_BUFFER_TOKENS >
 * DEFAULT_BUFFER_TABLE substring match > DEFAULT_BUFFER_TABLE.default.
 *
 * Pure function. Exported for testing.
 */
export function pickBufferTokens(
  model: string | undefined,
  options: Pick<AutoCompactThresholdOptions, 'bufferTokens' | 'bufferTokensByModel'> = {},
): number {
  if (typeof options.bufferTokens === 'number' && Number.isFinite(options.bufferTokens) && options.bufferTokens >= 0) {
    return Math.floor(options.bufferTokens);
  }
  const lcModel = (model ?? '').toLowerCase();
  // Per-call override table
  if (options.bufferTokensByModel) {
    for (const [pattern, value] of Object.entries(options.bufferTokensByModel)) {
      if (lcModel.includes(pattern.toLowerCase())) return Math.max(0, Math.floor(value));
    }
  }
  // Env override
  const envBuf = process.env.CODEBUDDY_AUTOCOMPACT_BUFFER_TOKENS;
  if (envBuf) {
    const n = parseInt(envBuf, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  // Default table
  if (lcModel) {
    for (const [pattern, value] of Object.entries(DEFAULT_BUFFER_TABLE)) {
      if (pattern === 'default') continue;
      if (lcModel.includes(pattern)) return value;
    }
  }
  // DEFAULT_BUFFER_TABLE.default is statically defined above (13_000); the
  // `?? 13_000` keeps the same literal in the impossible-undefined case.
  return DEFAULT_BUFFER_TABLE.default ?? 13_000;
}

/**
 * Compute the auto-compact threshold (in tokens) for a given context
 * window. The returned value is the token count at which compaction
 * should trigger. `getStats(messages).totalTokens >= threshold` →
 * compact now.
 *
 * Algorithm:
 *   1. Pick `buffer` for the model (see pickBufferTokens).
 *   2. `effective = max(0, maxContextTokens − buffer)`.
 *   3. If `percent` is given (1–100), threshold = floor(effective × percent/100).
 *      Otherwise threshold = effective.
 *
 * Pure function. Caller decides where to wire it (typically
 * ContextManagerV2.shouldAutoCompact).
 */
export function computeAutoCompactThreshold(
  maxContextTokens: number,
  model?: string,
  options: AutoCompactThresholdOptions = {},
): number {
  if (!Number.isFinite(maxContextTokens) || maxContextTokens <= 0) return 0;
  const buffer = pickBufferTokens(model, options);
  const effective = Math.max(0, maxContextTokens - buffer);
  if (
    typeof options.percent === 'number' &&
    Number.isFinite(options.percent) &&
    options.percent > 0 &&
    options.percent <= 100
  ) {
    return Math.floor(effective * (options.percent / 100));
  }
  return effective;
}

/** Test-only: read the default table. */
export function _getDefaultBufferTableForTests(): Readonly<Record<string, number>> {
  return DEFAULT_BUFFER_TABLE;
}
