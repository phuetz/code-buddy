/**
 * Message Reducer Utility
 *
 * Handles the accumulation of streaming chunks from LLM responses,
 * merging deltas into a complete message structure including
 * content and tool calls.
 */

/**
 * Reduces a new streaming chunk into the previous accumulated message.
 *
 * @param previous - The previously accumulated message state
 * @param chunk - The new chunk from the stream
 * @returns The updated accumulated message state
 */
export function reduceStreamChunk(
  previous: Record<string, unknown>,
  chunk: unknown
): Record<string, unknown> {
  const reduce = (acc: Record<string, unknown>, delta: unknown): Record<string, unknown> => {
    if (!delta || typeof delta !== 'object') {
      return acc;
    }
    
    // Create a shallow copy to avoid mutating the input
    acc = { ...acc };
    
    for (const [key, value] of Object.entries(delta)) {
      if (Array.isArray(value)) {
        // Always merge arrays element-by-element via the delta element's own
        // `index` field (tool_calls), never as a positional direct-assign —
        // including on the very FIRST chunk that introduces this key.
        //
        // BASHSTREAM1 (2026-09-04): the previous code special-cased "acc[key]
        // is undefined" as a blind `acc[key] = value` (the whole delta array,
        // by ARRAY POSITION), only stripping the `index` field afterwards for
        // cosmetics. That is correct only for providers whose first streamed
        // tool_calls index is 0. MiniMax/GMI was observed numbering tool_calls
        // starting at 1 (no index-0 chunk at all): the first tool call's
        // name/id landed at array position 0 (from the direct-assign), but
        // its OWN continuation deltas carry `index: 1` and were merged via
        // the by-index branch into a *different* slot — so the first tool
        // call's `function.arguments` stayed permanently `""` (crashing
        // `JSON.parse` downstream) while an orphaned, name-less object
        // absorbed its actual arguments. Routing every array merge — first
        // chunk included — through the same by-index logic fixes this: a
        // provider that DOES start at 0 (the common case) behaves exactly as
        // before (index 0 was always going to land at position 0 anyway).
        const accArray = Array.isArray(acc[key])
          ? (acc[key] as Array<Record<string, unknown>>)
          : ((acc[key] = []) as Array<Record<string, unknown>>);
        for (let i = 0; i < value.length; i++) {
          const elem = value[i];
          // For tool_calls, each delta element carries an `index` field
          // (0, 1, ...) identifying which tool call it belongs to. Merge
          // strictly by that index so parallel tool calls accumulate into
          // separate slots instead of being concatenated/misplaced by array
          // position.
          const elemIndex =
            key === 'tool_calls' &&
            elem &&
            typeof elem === 'object' &&
            typeof (elem as Record<string, unknown>).index === 'number'
              ? ((elem as Record<string, unknown>).index as number)
              : i;
          const current = accArray[elemIndex] ?? {};
          const merged = reduce(current, elem);
          // Clean up the index property from tool calls (standardized format)
          if (merged && typeof merged === 'object' && 'index' in merged) {
            delete (merged as Record<string, unknown>).index;
          }
          accArray[elemIndex] = merged;
        }
      } else if (acc[key] === undefined || acc[key] === null) {
        acc[key] = value;
      } else if (typeof acc[key] === "string" && typeof value === "string") {
        (acc[key] as string) += value;
      } else if (typeof acc[key] === "object" && typeof value === "object" && acc[key] !== null && value !== null) {
        acc[key] = reduce(acc[key] as Record<string, unknown>, value);
      }
    }
    return acc;
  };

  const itemObj = chunk as { choices?: Array<{ delta?: unknown }> };
  return reduce(previous, itemObj.choices?.[0]?.delta || {});
}
