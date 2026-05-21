/**
 * Extended Model Output Sanitization
 *
 * Exhaustive sanitization of LLM control tokens, thinking blocks,
 * and invisible characters that can leak from various model providers.
 *
 * Supports: GLM-5, DeepSeek, ChatML, LLaMA, and common zero-width chars.
 *
 * @module utils/output-sanitizer
 */

/**
 * GLM-5 full-width angle bracket tokens.
 * Pattern: \uFF1C\uFF5C...\uFF5C\uFF1E (e.g., ＜｜assistant｜＞)
 */
const GLM5_FULLWIDTH_PATTERN = /\uFF1C\uFF5C[^\uFF1E]*?\uFF5C\uFF1E/g;

/**
 * DeepSeek internal thinking/reasoning blocks.
 * These are model-internal reasoning traces, not user-facing markdown.
 */
const DEEPSEEK_THINK_PATTERN = /<think>[\s\S]*?<\/think>/g;
const DEEPSEEK_REASONING_PATTERN = /<reasoning>[\s\S]*?<\/reasoning>/g;

/**
 * ChatML control tokens used by OpenAI-compatible models.
 * Matches: <|im_start|>, <|im_end|>, <|endoftext|>, <|assistant|>, <|user|>, <|system|>
 * and any other <|...|> variant.
 */
const CHATML_TOKEN_PATTERN = /<\|(?:im_start|im_end|endoftext|assistant|user|system|pad|eos|bos|sep|cls|mask|unk)[^|]*\|>/gi;

/**
 * Generic control token pattern for any <|...|> markers not caught above.
 * Kept as a separate pass to avoid over-matching legitimate content.
 */
const GENERIC_CONTROL_TOKEN_PATTERN = /<\|[^|>]+\|>/g;

/**
 * JSON-escaped control tokens: \u003c|token|\u003e
 */
const JSON_ESCAPED_CONTROL_TOKEN_PATTERN = /\\u003c\|[^|>]+\|\\u003e/gi;

/**
 * LLaMA system prompt markers.
 * Matches: <<SYS>>...<<\/SYS>> or <<SYS>>...<</SYS>>
 */
const LLAMA_SYS_PATTERN = /<<SYS>>[\s\S]*?<<\/SYS>>/g;

/**
 * LLaMA instruction markers.
 * Matches: [INST]...[/INST]
 */
const LLAMA_INST_PATTERN = /\[INST\][\s\S]*?\[\/INST\]/g;

/**
 * Zero-width and invisible Unicode characters.
 * - U+200B: Zero Width Space
 * - U+200C: Zero Width Non-Joiner
 * - U+200D: Zero Width Joiner
 * - U+FEFF: Byte Order Mark (BOM) / Zero Width No-Break Space
 * - U+00AD: Soft Hyphen
 */
const ZERO_WIDTH_CHARS_PATTERN = /(?:\u200B|\u200C|\u200D|\uFEFF|\u00AD)/g;

/**
 * All sanitization rules applied in order.
 * Each entry has a pattern and a replacement string.
 */
const SANITIZATION_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  // GLM-5 full-width tokens
  { pattern: GLM5_FULLWIDTH_PATTERN, replacement: '' },
  // DeepSeek thinking/reasoning blocks
  { pattern: DEEPSEEK_THINK_PATTERN, replacement: '' },
  { pattern: DEEPSEEK_REASONING_PATTERN, replacement: '' },
  // ChatML-specific tokens (named variants)
  { pattern: CHATML_TOKEN_PATTERN, replacement: '' },
  // Generic <|...|> control tokens
  { pattern: GENERIC_CONTROL_TOKEN_PATTERN, replacement: '' },
  // JSON-escaped control tokens
  { pattern: JSON_ESCAPED_CONTROL_TOKEN_PATTERN, replacement: '' },
  // LLaMA system prompt blocks
  { pattern: LLAMA_SYS_PATTERN, replacement: '' },
  // LLaMA instruction blocks
  { pattern: LLAMA_INST_PATTERN, replacement: '' },
];

/**
 * Sanitize model output by removing control tokens, thinking blocks,
 * and other model-internal markers that should not be displayed to users.
 *
 * This function does NOT strip zero-width characters by default.
 * Use `stripInvisibleChars()` separately if needed.
 *
 * @param text - The raw model output text
 * @returns Sanitized text with control tokens removed
 */
export function sanitizeModelOutput(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let sanitized = text;

  for (const rule of SANITIZATION_RULES) {
    sanitized = sanitized.replace(rule.pattern, rule.replacement);
  }

  // Collapse excessive newlines left behind by stripped blocks
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

  return sanitized;
}

/**
 * Strip zero-width and invisible Unicode characters from text.
 *
 * Removes:
 * - U+200B (Zero Width Space)
 * - U+200C (Zero Width Non-Joiner)
 * - U+200D (Zero Width Joiner)
 * - U+FEFF (BOM / Zero Width No-Break Space)
 * - U+00AD (Soft Hyphen)
 *
 * @param text - The text to clean
 * @returns Text without invisible characters
 */
export function stripInvisibleChars(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text.replace(ZERO_WIDTH_CHARS_PATTERN, '');
}
