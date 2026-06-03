/**
 * ClipboardWatcher — polls the system clipboard from the Electron
 * main process and fires a summary on substantial new content.
 *
 * Adapted from Lisa's `useClipboardSummarizer` hook. Cowork-specific
 * differences:
 *  - Uses Electron's `clipboard.readText()` (no permission required,
 *    works without focus, survives renderer reloads) instead of the
 *    browser's `navigator.clipboard.readText()`.
 *  - Reuses `summarizeForClipboard()` (from claude-sdk-one-shot) so
 *    the user's configured LLM is hit — not a hard-coded OpenAI key.
 *  - Persists the enable flag in `configStore.clipboard.monitoringEnabled`
 *    so the choice survives restarts.
 *  - Hash-based change detection instead of full-text comparison
 *    keeps memory bounded for very long copies.
 *
 * @module main/clipboard/clipboard-watcher
 */
import { clipboard } from 'electron';
import { createHash } from 'node:crypto';
import { log, logWarn } from '../utils/logger';
import { configStore } from '../config/config-store';
import type { ServerEvent } from '../../renderer/types';

/** Minimum length to trigger auto-summary (Lisa uses 100, we keep parity). */
const MIN_AUTO_LENGTH = 100;
/** Poll interval — 2 s matches Lisa, low CPU on idle. */
const POLL_INTERVAL_MS = 2000;
/** Hard cap on text we'll forward to the LLM, to bound cost. */
const MAX_INPUT_LENGTH = 8000;

export interface ClipboardSummaryPayload {
  /** SHA-256 of the source text — lets the renderer dedup identical events. */
  hash: string;
  /** Length of the original (pre-truncation) clipboard text. */
  sourceLength: number;
  /** First ~120 chars of the source for display ("… clipboard preview"). */
  sourcePreview: string;
  /** The LLM-produced summary, or null if the call failed. */
  summary: string | null;
  /** ISO timestamp when the event was emitted. */
  at: string;
}

export class ClipboardWatcher {
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private lastHash: string | null = null;
  private summarising = false;
  private sendToRenderer: ((event: ServerEvent) => void) | null = null;

  setSendToRenderer(fn: (event: ServerEvent) => void): void {
    this.sendToRenderer = fn;
  }

  /** Start polling. Idempotent. */
  start(): void {
    if (this.pollHandle) return;
    log('[ClipboardWatcher] starting (interval=' + POLL_INTERVAL_MS + 'ms)');
    // Seed the hash with whatever's already in the clipboard so we
    // don't trigger a summary the moment the user enables monitoring.
    try {
      this.lastHash = hashText(clipboard.readText() || '');
    } catch {
      this.lastHash = null;
    }
    this.pollHandle = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);
  }

  /** Stop polling. Idempotent. */
  stop(): void {
    if (!this.pollHandle) return;
    clearInterval(this.pollHandle);
    this.pollHandle = null;
    log('[ClipboardWatcher] stopped');
  }

  isRunning(): boolean {
    return this.pollHandle !== null;
  }

  /**
   * Force-summarise whatever's in the clipboard right now and emit
   * the resulting `clipboard.summary` event. Skips the auto-length
   * threshold so the user can request a summary on short copies too.
   */
  async summariseNow(): Promise<ClipboardSummaryPayload | null> {
    const text = (clipboard.readText() || '').trim();
    if (text.length < 10) {
      return null;
    }
    return this.runSummary(text, /*announce*/ true);
  }

  // ─────── internals ───────

  private async tick(): Promise<void> {
    if (this.summarising) return; // back-pressure
    let text: string;
    try {
      text = (clipboard.readText() || '').trim();
    } catch (err) {
      logWarn('[ClipboardWatcher] readText failed:', err);
      return;
    }
    if (text.length < MIN_AUTO_LENGTH) return;
    const hash = hashText(text);
    if (hash === this.lastHash) return;
    this.lastHash = hash;
    await this.runSummary(text, /*announce*/ true);
  }

  private async runSummary(
    text: string,
    announce: boolean,
  ): Promise<ClipboardSummaryPayload | null> {
    this.summarising = true;
    try {
      const config = configStore.getAll();
      const trimmed = text.length > MAX_INPUT_LENGTH
        ? text.slice(0, MAX_INPUT_LENGTH) + '…'
        : text;
      const { summarizeForClipboard } = await import('../claude/claude-sdk-one-shot');
      const summary = await summarizeForClipboard(trimmed, config);
      const payload: ClipboardSummaryPayload = {
        hash: hashText(text),
        sourceLength: text.length,
        sourcePreview: text.slice(0, 120),
        summary,
        at: new Date().toISOString(),
      };
      if (announce && this.sendToRenderer) {
        this.sendToRenderer({
          type: 'clipboard.summary',
          payload,
        } as ServerEvent);
      }
      return payload;
    } finally {
      this.summarising = false;
    }
  }
}

function hashText(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
