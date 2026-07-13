/**
 * Exact approval scopes for non-shell tools.
 *
 * A session grant must describe the action, not merely the tool name. Keeping
 * the arguments inside a digest avoids leaking secrets into UI state or logs
 * while still making changes to any argument, cwd, or tool invalidate it.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const APPROVAL_SCOPE_VERSION = 'tool-action-v1';
const SECRET_KEY_PATTERN = /(?:api[_-]?key|secret|token|password|passwd|credential|authorization|cookie|private[_-]?key)/i;
const MAX_PREVIEW_STRING = 500;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

function canonicalWorkingDirectory(cwd: string): string {
  const resolved = path.resolve(cwd);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** Build a stable, non-reversible key for one exact tool action. */
export function buildToolApprovalKey(
  toolName: string,
  args: Record<string, unknown>,
  cwd: string,
): string {
  const payload = JSON.stringify({
    version: APPROVAL_SCOPE_VERSION,
    toolName,
    cwd: canonicalWorkingDirectory(cwd),
    args: canonicalize(args),
  });
  return `tool-action:${createHash('sha256').update(payload).digest('hex')}`;
}

function redactPreviewValue(value: unknown, key?: string): unknown {
  if (key && SECRET_KEY_PATTERN.test(key)) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') {
    return value.length > MAX_PREVIEW_STRING
      ? `${value.slice(0, MAX_PREVIEW_STRING)}…[${value.length} chars]`
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactPreviewValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([entryKey, entryValue]) => [entryKey, redactPreviewValue(entryValue, entryKey)]),
    );
  }
  return value;
}

/** Redacted and bounded arguments suitable for an approval dialog. */
export function toolArgsApprovalPreview(args: Record<string, unknown>): string {
  return JSON.stringify(redactPreviewValue(args), null, 2);
}
