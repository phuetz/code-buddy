/**
 * Observation Variator — Manus AI anti-repetition pattern
 *
 * For long batch tasks (processing 20+ items sequentially) the model tends
 * to copy the structural pattern of recent tool calls, causing drift or
 * hallucination. Introducing controlled, deterministic variation in how
 * tool results are presented to the model breaks this repetition loop.
 *
 * What varies (presentation layer only — semantic content is untouched):
 * - Wrapping template for tool results (3 rotating templates)
 * - Phrasing for memory/todo injection blocks
 *
 * Variation is seeded by `turnIndex % N`, so it is:
 * - Deterministic (reproducible for debugging)
 * - Stable within a single turn (same message, same wrapper)
 * - Rotating across turns (different template each turn)
 *
 * Ref: "Context Engineering for AI Agents: Lessons from Building Manus"
 */

// ============================================================================
// Tool result presentation templates
// Three semantically equivalent ways to wrap a tool result.
// ============================================================================

const TOOL_RESULT_TEMPLATES = [
  (name: string, content: string) =>
    `Result from ${name}:\n${content}`,

  (name: string, content: string) =>
    `Output of ${name}:\n---\n${content}\n---`,

  (name: string, content: string) =>
    `[${name}] returned:\n${content}`,
] as const;

// ============================================================================
// Memory block phrasing alternatives
// ============================================================================

const MEMORY_BLOCK_PHRASINGS = [
  (content: string) => `Relevant memory context:\n${content}`,
  (content: string) => `From memory:\n${content}`,
  (content: string) => `Recalled context:\n${content}`,
] as const;

// ============================================================================
// ObservationVariator
// ============================================================================

export class ObservationVariator {
  private turnIndex = 0;

  /**
   * Advance the turn counter. Call once at the start of each agent turn.
   */
  nextTurn(): void {
    this.turnIndex++;
  }

  /**
   * Reset to turn 0 (e.g., on new session).
   */
  reset(): void {
    this.turnIndex = 0;
  }

  /**
   * Wrap a tool result with the template selected for the current turn.
   *
   * @param toolName - Name of the tool that produced the result
   * @param content  - Raw tool result content
   * @returns Presentation-layer wrapped result
   */
  wrapToolResult(toolName: string, content: string): string {
    const idx = this.turnIndex % TOOL_RESULT_TEMPLATES.length;
    return TOOL_RESULT_TEMPLATES[idx](toolName, content);
  }

  /**
   * Wrap a memory/context retrieval block with the phrasing for this turn.
   */
  wrapMemoryBlock(content: string): string {
    const idx = this.turnIndex % MEMORY_BLOCK_PHRASINGS.length;
    return MEMORY_BLOCK_PHRASINGS[idx](content);
  }
}

// Module-level singleton (one variator per process)
let _variator: ObservationVariator | null = null;

export function getObservationVariator(): ObservationVariator {
  if (!_variator) _variator = new ObservationVariator();
  return _variator;
}

export function resetObservationVariator(): void {
  _variator = null;
}
