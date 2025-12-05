/**
 * Thinking Keywords System
 *
 * Inspired by Claude Code's extended thinking triggers:
 * - "think" -> Standard thinking (4K tokens)
 * - "think harder" / "megathink" -> Deep thinking (10K tokens)
 * - "think even harder" / "ultrathink" -> Exhaustive thinking (32K tokens)
 *
 * Detects keywords in user input and adjusts reasoning depth accordingly.
 */

import { EventEmitter } from 'events';

// ============================================================================
// Types
// ============================================================================

export type ThinkingLevel = 'none' | 'standard' | 'deep' | 'exhaustive';

export interface ThinkingKeywordConfig {
  level: ThinkingLevel;
  tokenBudget: number;
  systemPromptAddition: string;
  keywords: string[];
  description: string;
}

export interface ThinkingKeywordResult {
  detected: boolean;
  level: ThinkingLevel;
  keyword: string | null;
  cleanedInput: string;
  tokenBudget: number;
  systemPromptAddition: string;
}

// ============================================================================
// Configuration
// ============================================================================

const THINKING_CONFIGS: Record<ThinkingLevel, ThinkingKeywordConfig> = {
  none: {
    level: 'none',
    tokenBudget: 0,
    systemPromptAddition: '',
    keywords: [],
    description: 'No extended thinking',
  },
  standard: {
    level: 'standard',
    tokenBudget: 4000,
    systemPromptAddition: `
Before responding, think through this step by step:
1. Understand the problem fully
2. Consider different approaches
3. Evaluate trade-offs
4. Provide a well-reasoned answer`,
    keywords: [
      'think',
      'think about',
      'think through',
      'reason',
      'consider carefully',
      'analyze',
    ],
    description: 'Standard thinking mode (4K tokens)',
  },
  deep: {
    level: 'deep',
    tokenBudget: 10000,
    systemPromptAddition: `
This requires deep analysis. Before responding:
1. Break down the problem into components
2. Explore multiple solution paths
3. Consider edge cases and failure modes
4. Evaluate each approach systematically
5. Verify your reasoning for consistency
6. Synthesize insights into a comprehensive answer

Take your time to think thoroughly.`,
    keywords: [
      'think hard',
      'think harder',
      'megathink',
      'deep think',
      'think deeply',
      'analyze thoroughly',
      'consider extensively',
    ],
    description: 'Deep thinking mode (10K tokens)',
  },
  exhaustive: {
    level: 'exhaustive',
    tokenBudget: 32000,
    systemPromptAddition: `
This is a complex problem requiring exhaustive analysis. Before responding:
1. Map out the entire problem space
2. Identify all relevant factors and constraints
3. Generate multiple hypotheses and approaches
4. For each approach:
   - Analyze pros and cons
   - Consider implementation details
   - Identify potential issues
   - Evaluate against requirements
5. Cross-verify findings for consistency
6. Consider alternative perspectives
7. Synthesize into a comprehensive, well-structured answer
8. Explicitly state confidence levels and uncertainties

Think as thoroughly as possible. Quality over speed.`,
    keywords: [
      'think even harder',
      'ultrathink',
      'think very hard',
      'exhaustive analysis',
      'deep dive',
      'comprehensive analysis',
      'think maximum',
    ],
    description: 'Exhaustive thinking mode (32K tokens)',
  },
};

// Patterns for detecting thinking requests
const THINKING_PATTERNS = [
  // Ultrathink patterns (must check first - most specific)
  { pattern: /\bultrathink\b/i, level: 'exhaustive' as ThinkingLevel },
  { pattern: /\bthink\s+even\s+harder\b/i, level: 'exhaustive' as ThinkingLevel },
  { pattern: /\bthink\s+very\s+hard\b/i, level: 'exhaustive' as ThinkingLevel },
  { pattern: /\bexhaustive\s+analysis\b/i, level: 'exhaustive' as ThinkingLevel },
  { pattern: /\bdeep\s+dive\b/i, level: 'exhaustive' as ThinkingLevel },
  { pattern: /\bthink\s+maximum\b/i, level: 'exhaustive' as ThinkingLevel },

  // Megathink patterns
  { pattern: /\bmegathink\b/i, level: 'deep' as ThinkingLevel },
  { pattern: /\bthink\s+hard(er)?\b/i, level: 'deep' as ThinkingLevel },
  { pattern: /\bdeep\s+think\b/i, level: 'deep' as ThinkingLevel },
  { pattern: /\bthink\s+deeply\b/i, level: 'deep' as ThinkingLevel },
  { pattern: /\banalyze\s+thoroughly\b/i, level: 'deep' as ThinkingLevel },

  // Standard think patterns
  { pattern: /\bthink\s+about\b/i, level: 'standard' as ThinkingLevel },
  { pattern: /\bthink\s+through\b/i, level: 'standard' as ThinkingLevel },
  { pattern: /\bconsider\s+carefully\b/i, level: 'standard' as ThinkingLevel },
  { pattern: /\bthink\b(?!\s+(hard|even|very|deeply|about|through|maximum))/i, level: 'standard' as ThinkingLevel },
];

// ============================================================================
// Thinking Keywords Manager
// ============================================================================

export class ThinkingKeywordsManager extends EventEmitter {
  private defaultLevel: ThinkingLevel = 'none';
  private enabled: boolean = true;

  constructor(options: { defaultLevel?: ThinkingLevel; enabled?: boolean } = {}) {
    super();
    this.defaultLevel = options.defaultLevel || 'none';
    this.enabled = options.enabled ?? true;
  }

  /**
   * Detect thinking keywords in user input
   */
  detectThinkingLevel(input: string): ThinkingKeywordResult {
    if (!this.enabled) {
      return this.createResult('none', null, input);
    }

    // Check patterns from most specific to least specific
    for (const { pattern, level } of THINKING_PATTERNS) {
      const match = input.match(pattern);
      if (match) {
        const cleanedInput = this.cleanInput(input, match[0]);
        const result = this.createResult(level, match[0], cleanedInput);
        this.emit('thinking:detected', result);
        return result;
      }
    }

    // No thinking keyword detected
    return this.createResult(this.defaultLevel, null, input);
  }

  /**
   * Create result object
   */
  private createResult(
    level: ThinkingLevel,
    keyword: string | null,
    cleanedInput: string
  ): ThinkingKeywordResult {
    const config = THINKING_CONFIGS[level];
    return {
      detected: level !== 'none',
      level,
      keyword,
      cleanedInput: cleanedInput.trim(),
      tokenBudget: config.tokenBudget,
      systemPromptAddition: config.systemPromptAddition,
    };
  }

  /**
   * Clean thinking keyword from input
   */
  private cleanInput(input: string, matchedKeyword: string): string {
    // Remove the keyword and clean up punctuation
    let cleaned = input.replace(new RegExp(matchedKeyword, 'i'), '');

    // Clean up double spaces and leading/trailing punctuation
    cleaned = cleaned
      .replace(/\s+/g, ' ')
      .replace(/^[\s,.:;]+/, '')
      .replace(/[\s,.:;]+$/, '')
      .trim();

    // If nothing left after cleaning, keep original minus keyword
    if (!cleaned) {
      cleaned = input.replace(new RegExp(`\\b${matchedKeyword}\\b`, 'i'), '').trim();
    }

    return cleaned;
  }

  /**
   * Get configuration for a thinking level
   */
  getConfig(level: ThinkingLevel): ThinkingKeywordConfig {
    return { ...THINKING_CONFIGS[level] };
  }

  /**
   * Get all available levels
   */
  getAvailableLevels(): ThinkingKeywordConfig[] {
    return Object.values(THINKING_CONFIGS);
  }

  /**
   * Check if a level requires extended thinking
   */
  requiresExtendedThinking(level: ThinkingLevel): boolean {
    return level !== 'none';
  }

  /**
   * Get token budget for a level
   */
  getTokenBudget(level: ThinkingLevel): number {
    return THINKING_CONFIGS[level].tokenBudget;
  }

  /**
   * Format thinking level for display
   */
  formatLevel(level: ThinkingLevel): string {
    const config = THINKING_CONFIGS[level];
    const icons: Record<ThinkingLevel, string> = {
      none: '',
      standard: '🧠',
      deep: '🧠🧠',
      exhaustive: '🧠🧠🧠',
    };
    return `${icons[level]} ${config.description}`;
  }

  /**
   * Get help text for thinking keywords
   */
  getHelpText(): string {
    return `
**Extended Thinking Keywords**

Add these keywords to your prompt to enable deeper reasoning:

| Keyword | Level | Token Budget |
|---------|-------|--------------|
| think | Standard | 4K tokens |
| think harder / megathink | Deep | 10K tokens |
| ultrathink / think even harder | Exhaustive | 32K tokens |

**Examples:**
- "think about how to refactor this function"
- "megathink: design a scalable architecture"
- "ultrathink through this security issue"
`.trim();
  }

  /**
   * Enable/disable thinking keyword detection
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.emit('thinking:enabled', enabled);
  }

  /**
   * Set default thinking level
   */
  setDefaultLevel(level: ThinkingLevel): void {
    this.defaultLevel = level;
    this.emit('thinking:default-changed', level);
  }

  /**
   * Check if enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get default level
   */
  getDefaultLevel(): ThinkingLevel {
    return this.defaultLevel;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let thinkingKeywordsInstance: ThinkingKeywordsManager | null = null;

export function getThinkingKeywordsManager(
  options?: { defaultLevel?: ThinkingLevel; enabled?: boolean }
): ThinkingKeywordsManager {
  if (!thinkingKeywordsInstance) {
    thinkingKeywordsInstance = new ThinkingKeywordsManager(options);
  }
  return thinkingKeywordsInstance;
}

export function resetThinkingKeywordsManager(): void {
  thinkingKeywordsInstance = null;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Quick check if input contains any thinking keyword
 */
export function hasThinkingKeyword(input: string): boolean {
  return THINKING_PATTERNS.some(({ pattern }) => pattern.test(input));
}

/**
 * Extract thinking level from input
 */
export function extractThinkingLevel(input: string): ThinkingLevel {
  for (const { pattern, level } of THINKING_PATTERNS) {
    if (pattern.test(input)) {
      return level;
    }
  }
  return 'none';
}
