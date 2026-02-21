/**
 * Stable JSON Serialization — Manus AI / OpenClaw KV-cache preservation
 *
 * A single-token difference anywhere in the prompt prefix invalidates the
 * KV-cache from that point forward (autoregressive transformer property).
 * Many JSON serializers produce non-deterministic key ordering, causing
 * spurious cache misses.
 *
 * `stableStringify()` sorts keys recursively so the same object always
 * produces the same byte sequence regardless of insertion order.
 *
 * Apply to all tool result metadata, structured objects in system prompts,
 * and any JSON embedded in message content.
 */

/**
 * Serialize an object to JSON with recursively sorted keys.
 * Arrays preserve their original element order.
 *
 * @param value  - Value to serialize
 * @param space  - Optional indentation (same as JSON.stringify)
 */
export function stableStringify(value: unknown, space?: number | string): string {
  return JSON.stringify(sortKeys(value), null, space);
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key]);
  }
  return sorted;
}

/**
 * Parse JSON and re-serialize with stable key order.
 * Useful for normalizing JSON strings that may come from external sources.
 */
export function normalizeJson(jsonString: string, space?: number | string): string {
  try {
    return stableStringify(JSON.parse(jsonString), space);
  } catch {
    return jsonString; // Not valid JSON, return as-is
  }
}
