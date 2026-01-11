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
      if (acc[key] === undefined || acc[key] === null) {
        acc[key] = value;
        // Clean up index properties from tool calls (standardized format)
        if (Array.isArray(acc[key])) {
          for (const arr of acc[key]) {
            if (arr && typeof arr === 'object' && 'index' in arr) {
              delete arr.index;
            }
          }
        }
      } else if (typeof acc[key] === "string" && typeof value === "string") {
        (acc[key] as string) += value;
      } else if (Array.isArray(acc[key]) && Array.isArray(value)) {
        const accArray = acc[key] as Array<Record<string, unknown>>;
        for (let i = 0; i < value.length; i++) {
          if (!accArray[i]) accArray[i] = {};
          accArray[i] = reduce(accArray[i], value[i]);
        }
      } else if (typeof acc[key] === "object" && typeof value === "object" && acc[key] !== null && value !== null) {
        acc[key] = reduce(acc[key] as Record<string, unknown>, value);
      }
    }
    return acc;
  };

  const itemObj = chunk as { choices?: Array<{ delta?: unknown }> };
  return reduce(previous, itemObj.choices?.[0]?.delta || {});
}
