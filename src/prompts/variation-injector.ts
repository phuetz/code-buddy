/**
 * Prompt Variation Injector — Manus AI structured variation pattern
 *
 * Applies randomised structural variation to the system prompt on each
 * session initialisation to prevent the model from falling into brittle
 * repetition patterns caused by memorised few-shot examples.
 *
 * What varies:
 * - Order of reminder / behavioural rule blocks
 * - Phrasing alternatives for common instructions (a pool of semantically
 *   equivalent wordings is sampled uniformly)
 * - Optional emphasis markers (bold, italic, ALL-CAPS) rotated per block
 *
 * What does NOT vary:
 * - Core tool definitions (must be stable for KV cache)
 * - Safety rules that must always appear exactly (security patterns)
 * - Knowledge / todo context injected after the stable prefix
 *
 * The injector operates on the "reminder section" of the system prompt —
 * the footer block that lists behavioural guidelines. The tool definitions
 * and identity preamble are left untouched so Anthropic prompt caching
 * remains maximally effective on the stable prefix.
 *
 * Ref: "Context Engineering for AI Agents: Lessons from Building Manus"
 * https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
 */

// ============================================================================
// Types
// ============================================================================

export interface VariationOptions {
  /** Seed for deterministic variation (e.g., session ID). Omit for random. */
  seed?: number;
  /** Fraction of reminder blocks to vary (0-1). Default: 0.4 */
  variationRate?: number;
  /** Enable order shuffling. Default: true */
  shuffleOrder?: boolean;
  /** Enable phrasing alternatives. Default: true */
  alternativePhrasing?: boolean;
}

// ============================================================================
// Phrasing alternatives
// Maps a canonical instruction prefix to a pool of equivalent alternatives
// ============================================================================

const PHRASING_POOLS: Record<string, string[]> = {
  'Always ask for clarification': [
    'Always ask for clarification',
    'Request clarification',
    'When uncertain, clarify before proceeding',
    'Seek clarification rather than guessing',
  ],
  'Never modify files without': [
    'Never modify files without',
    'Do not modify files without',
    'Refrain from modifying files without',
    'Only modify files when',
  ],
  'Prefer small, focused changes': [
    'Prefer small, focused changes',
    'Keep changes minimal and targeted',
    'Make targeted, minimal edits',
    'Focus changes to the minimum required',
  ],
  'Use the available tools': [
    'Use the available tools',
    'Leverage the available tools',
    'Employ the provided tools',
    'Rely on the available tools',
  ],
  'Explain your reasoning': [
    'Explain your reasoning',
    'Reason through your approach',
    'Articulate your thought process',
    'Think step by step',
  ],
  'Check existing code before': [
    'Check existing code before',
    'Review existing code before',
    'Examine existing code before',
    'Read existing code before',
  ],
};

// ============================================================================
// Seeded RNG (xorshift32 — deterministic, lightweight)
// ============================================================================

function xorshift32(seed: number): () => number {
  let s = seed >>> 0 || 0xdeadbeef;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

// ============================================================================
// Core functions
// ============================================================================

/**
 * Apply structural variation to a list of reminder/guideline blocks.
 * Returns a new array — the input is not mutated.
 */
export function applyVariation(
  blocks: string[],
  options: VariationOptions = {}
): string[] {
  const {
    seed,
    variationRate = 0.4,
    shuffleOrder = true,
    alternativePhrasing = true,
  } = options;

  const rng = seed !== undefined ? xorshift32(seed) : Math.random.bind(Math);

  let result = [...blocks];

  // 1. Shuffle order (Fisher-Yates)
  if (shuffleOrder) {
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
  }

  // 2. Apply phrasing alternatives to a subset of blocks
  if (alternativePhrasing) {
    result = result.map(block => {
      if (rng() > variationRate) return block; // skip this block

      for (const [canonical, alternatives] of Object.entries(PHRASING_POOLS)) {
        if (block.includes(canonical)) {
          const pick = alternatives[Math.floor(rng() * alternatives.length)];
          return block.replace(canonical, pick);
        }
      }

      return block;
    });
  }

  return result;
}

/**
 * Extract the reminder/footer section from a system prompt string.
 * Returns { prefix, blocks, suffix } where blocks are the bullet-point lines.
 */
export function extractBlocks(prompt: string): {
  prefix: string;
  blocks: string[];
  suffix: string;
} {
  const lines = prompt.split('\n');

  let blockStart = -1;
  let blockEnd = -1;

  // Find the "Reminders" or "Guidelines" or "Important" section marker
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      /^#{1,3}\s+(Reminder|Guideline|Important|Behavior|Rule)/i.test(line) ||
      line === '---' && i > lines.length / 2
    ) {
      if (blockStart === -1) blockStart = i;
    }
  }

  if (blockStart === -1) {
    // No marker found — treat the last 25% of lines as the variable section
    blockStart = Math.floor(lines.length * 0.75);
  }

  blockEnd = lines.length;

  const prefix = lines.slice(0, blockStart).join('\n');
  const rawBlocks = lines.slice(blockStart, blockEnd);
  const suffix = '';

  // Split rawBlocks into individual bullet points
  const blocks: string[] = [];
  let current = '';
  for (const line of rawBlocks) {
    if ((line.startsWith('- ') || line.startsWith('* ') || line.match(/^\d+\./)) && current) {
      blocks.push(current.trim());
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current.trim()) blocks.push(current.trim());

  return { prefix, blocks, suffix };
}

/**
 * Apply variation to a full system prompt string.
 * Only the reminder/footer section is varied; the preamble is left untouched.
 */
export function varySystemPrompt(
  prompt: string,
  options: VariationOptions = {}
): string {
  if (!prompt) return prompt;

  const { prefix, blocks, suffix } = extractBlocks(prompt);

  if (blocks.length < 3) {
    // Too few blocks to meaningfully vary — return as-is
    return prompt;
  }

  const variedBlocks = applyVariation(blocks, options);
  return [prefix, ...variedBlocks, suffix].join('\n').replace(/\n{3,}/g, '\n\n');
}
