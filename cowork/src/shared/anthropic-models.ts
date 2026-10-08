/**
 * Claude models offered by Cowork — the only place in `cowork/src` that names them.
 *
 * Fallback list, not a contract: `GET https://api.anthropic.com/v1/models` is the
 * source of truth (checked 2026-10-08: the 5.5 trio is served; every `claude-3-*`
 * id and `claude-*-4-20250514` answers 404 `not_found_error`).
 * The default model of a profile is the user's own setting (`profiles.anthropic.model`);
 * `ANTHROPIC_MODEL` overrides the built-in fallback in the main process.
 */
export const ANTHROPIC_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;

export const ANTHROPIC_DEFAULT_MODEL = 'claude-sonnet-5-5';

/** Built-in default, overridable by `ANTHROPIC_MODEL` where `process` exists (main process, tests). */
export function anthropicDefaultModel(): string {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  return env?.ANTHROPIC_MODEL?.trim() || ANTHROPIC_DEFAULT_MODEL;
}
