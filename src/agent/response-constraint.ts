/**
 * Response Prefill Modes — Manus AI tool call space restriction
 *
 * Instead of dynamically removing tools from the tool list (which would cause
 * a different prompt hash → KV-cache miss → 10× higher cost), Manus restricts
 * the action space by controlling `tool_choice` on each model call.
 *
 * Three modes:
 * - 'auto'      → model chooses freely (default; maps to tool_choice: "auto")
 * - 'required'  → model MUST make a tool call (maps to tool_choice: "required")
 * - 'specified' → model MUST call a specific tool or tool-group prefix
 *                 (maps to tool_choice: {type: "function", function: {name: exactName}}
 *                  or the first tool whose name starts with namePrefix)
 *
 * Preserves the full tool list so KV-cache hits are maintained.
 * Use for state-machine-like sequencing: "first call must be plan_update,
 * then shell_exec, then file_write".
 */

// ============================================================================
// Types
// ============================================================================

export type ResponsePrefillMode = 'auto' | 'required' | 'specified';

export interface ResponseConstraint {
  /** Prefill mode controlling what the model is allowed to respond with */
  mode: ResponsePrefillMode;
  /**
   * For 'specified' mode: exact tool name or prefix ending in '_'.
   * If a prefix (e.g. "plan_"), the first matching tool is selected.
   */
  nameOrPrefix?: string;
}

// ============================================================================
// tool_choice resolver
// ============================================================================

export type ToolChoiceValue =
  | 'auto'
  | 'required'
  | 'none'
  | { type: 'function'; function: { name: string } };

/**
 * Resolve a `ResponseConstraint` to a concrete `tool_choice` value.
 *
 * @param constraint  - The desired constraint
 * @param availableToolNames - Names of tools in the current call (for prefix resolution)
 * @returns OpenAI-compatible `tool_choice` value
 */
export function resolveToolChoice(
  constraint: ResponseConstraint,
  availableToolNames: string[] = []
): ToolChoiceValue {
  switch (constraint.mode) {
    case 'auto':
      return 'auto';

    case 'required':
      return 'required';

    case 'specified': {
      const target = constraint.nameOrPrefix;
      if (!target) return 'auto';

      // Exact match first
      if (availableToolNames.includes(target)) {
        return { type: 'function', function: { name: target } };
      }

      // Prefix match (e.g. "plan_" matches "plan_update", "plan_read")
      if (target.endsWith('_')) {
        const match = availableToolNames.find(n => n.startsWith(target));
        if (match) {
          return { type: 'function', function: { name: match } };
        }
      }

      // Fallback: 'required' so at least some tool call is forced
      return 'required';
    }

    default:
      return 'auto';
  }
}

// ============================================================================
// Session-level constraint registry
// ============================================================================

/**
 * A simple per-session constraint stack. Push constraints for specific turns,
 * pop after the turn completes. The top of the stack is the active constraint.
 *
 * Usage in agent-executor:
 *   constraintStack.push({ mode: 'required' });  // force tool call
 *   ... run LLM turn ...
 *   constraintStack.pop();
 */
export class ResponseConstraintStack {
  private stack: ResponseConstraint[] = [];

  push(constraint: ResponseConstraint): void {
    this.stack.push(constraint);
  }

  pop(): ResponseConstraint | undefined {
    return this.stack.pop();
  }

  /** Current active constraint (top of stack), or default 'auto' */
  current(): ResponseConstraint {
    return this.stack[this.stack.length - 1] ?? { mode: 'auto' };
  }

  clear(): void {
    this.stack = [];
  }

  isEmpty(): boolean {
    return this.stack.length === 0;
  }
}

let _globalConstraintStack: ResponseConstraintStack | null = null;

export function getResponseConstraintStack(): ResponseConstraintStack {
  if (!_globalConstraintStack) _globalConstraintStack = new ResponseConstraintStack();
  return _globalConstraintStack;
}
