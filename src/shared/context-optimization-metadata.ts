/**
 * Serializable context-optimization metadata shared by the agent, terminal,
 * desktop bridge and Cowork renderer. This module is intentionally browser-safe.
 */

export interface ContextOptimizationMetadata {
  optimizer: string;
  reason: string;
  rawRef: string;
  originalBytes: number;
  finalBytes: number;
  bytesSaved: number;
  transport?: 'http' | 'cli';
}

export interface ContextOptimizationPresentation {
  badge: string;
  percentSaved: number;
  bytesSaved: number;
  rawRef: string;
  restoreCommand: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/** Parse untrusted metadata received across a stream or persistence boundary. */
export function parseContextOptimizationMetadata(
  value: unknown,
): ContextOptimizationMetadata | null {
  if (!isRecord(value)) return null;
  const optimizer = typeof value.optimizer === 'string' ? value.optimizer : null;
  const reason = typeof value.reason === 'string' ? value.reason : null;
  const rawRef = typeof value.rawRef === 'string' ? value.rawRef : null;
  const originalBytes = finiteNonNegative(value.originalBytes);
  const finalBytes = finiteNonNegative(value.finalBytes);
  const bytesSaved = finiteNonNegative(value.bytesSaved);
  if (
    optimizer === null
    || reason === null
    || rawRef === null
    || rawRef.length === 0
    || originalBytes === null
    || finalBytes === null
    || bytesSaved === null
  ) {
    return null;
  }
  const transport = value.transport === 'http' || value.transport === 'cli'
    ? value.transport
    : undefined;
  return {
    optimizer,
    reason,
    rawRef,
    originalBytes,
    finalBytes,
    bytesSaved,
    ...(transport ? { transport } : {}),
  };
}

/** Extract the nested field from a ToolResult.metadata object. */
export function extractContextOptimizationMetadata(
  toolResultMetadata: unknown,
): ContextOptimizationMetadata | null {
  if (!isRecord(toolResultMetadata)) return null;
  return parseContextOptimizationMetadata(toolResultMetadata.contextOptimization);
}

/**
 * Build the compact UI model. Returning null keeps raw/error observations free
 * of misleading lm-resizer badges.
 */
export function presentContextOptimization(
  metadata: ContextOptimizationMetadata | null | undefined,
): ContextOptimizationPresentation | null {
  if (!metadata || metadata.optimizer !== 'lm-resizer' || metadata.originalBytes <= 0) {
    return null;
  }
  const derivedSaved = Math.max(0, metadata.originalBytes - metadata.finalBytes);
  const bytesSaved = Math.min(
    metadata.originalBytes,
    Math.max(metadata.bytesSaved, derivedSaved),
  );
  if (bytesSaved <= 0) return null;
  const percentSaved = Math.min(
    100,
    Math.max(1, Math.round((bytesSaved / metadata.originalBytes) * 100)),
  );
  const restoreCommand = `restore_context({"identifier":${JSON.stringify(metadata.rawRef)}})`;
  return {
    badge: `lm-resizer · ${percentSaved}% saved`,
    percentSaved,
    bytesSaved,
    rawRef: metadata.rawRef,
    restoreCommand,
  };
}
