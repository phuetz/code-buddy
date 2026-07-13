/**
 * Browser Operator action events (S2).
 *
 * The engine adapter streams tool lifecycle events; when a browser-automation
 * tool finishes we translate it into a `browser.action` ServerEvent that the
 * BrowserOperatorOverlay renders live (mirrors the Computer Use `gui.action`
 * pipeline). Pure helpers live here so they can be unit-tested without the
 * whole engine runner.
 *
 * @module main/engine/browser-action
 */

import type { BrowserActionEvent } from '../../renderer/types';

/** Detect browser-automation tool names so we can stream their actions live. */
export function isBrowserOperatorTool(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return (
    lower === 'browser' ||
    lower.startsWith('browser_') ||
    lower === 'internet_scout' ||
    lower === 'browser_search'
  );
}

function tryParseInput(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Extract a screenshot data URI / file path from a tool output data blob. */
function extractScreenshot(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const obj = data as Record<string, unknown>;
  const candidate = obj.screenshot ?? obj.image ?? obj.imagePath ?? obj.screenshotPath;
  if (typeof candidate === 'string' && candidate.length > 0) {
    if (!candidate.startsWith('data:image/') && !candidate.startsWith('file://')) {
      if (/^[A-Za-z0-9+/=]+$/.test(candidate.substring(0, 50))) {
        return `data:image/png;base64,${candidate}`;
      }
    }
    return candidate;
  }
  return undefined;
}

function extractOperatorDraft(toolName: string, data: unknown): unknown {
  if (toolName !== 'browser_operator' || !data || typeof data !== 'object') return undefined;
  const draft = (data as Record<string, unknown>).draft;
  return draft && typeof draft === 'object' ? draft : undefined;
}

const EVIDENCE_MAX = 280;

export interface BrowserActionInput {
  sessionId: string;
  toolUseId: string;
  toolName: string;
  rawInput?: string;
  data?: unknown;
  output?: string;
  /** Injectable for deterministic tests; defaults to Date.now(). */
  now?: number;
}

/** Build the `browser.action` payload from a finished browser tool call. */
export function buildBrowserActionPayload(args: BrowserActionInput): BrowserActionEvent {
  const input = tryParseInput(args.rawInput);
  const action =
    typeof input.action === 'string'
      ? input.action
      : typeof input.command === 'string'
        ? input.command
        : args.toolName;
  const url = typeof input.url === 'string' ? input.url : undefined;
  const target =
    typeof input.selector === 'string'
      ? input.selector
      : typeof input.text === 'string'
        ? input.text
        : typeof input.query === 'string'
          ? input.query
          : undefined;
  const evidence =
    typeof args.output === 'string' && args.output.length > 0
      ? args.output.slice(0, EVIDENCE_MAX)
      : undefined;
  const operatorDraft = extractOperatorDraft(args.toolName, args.data);

  return {
    sessionId: args.sessionId,
    toolUseId: args.toolUseId,
    action,
    url,
    target,
    evidence,
    screenshot: extractScreenshot(args.data),
    details: {
      ...input,
      ...(operatorDraft ? { operatorDraft } : {}),
    },
    timestamp: args.now ?? Date.now(),
  };
}
