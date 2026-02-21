/**
 * Pro Callback Router
 *
 * Parses callback data from buttons and dispatches to the correct
 * pro feature handler. Supports both new `pro:<feature>:<action>:<id>`
 * format and legacy Telegram short prefixes (`da_`, `dc_`, etc.).
 */

import type { DiffFirstManager } from './diff-first.js';
import type { RunCommands } from './run-commands.js';
import type { CIWatcher } from './ci-watcher.js';
import type { EnhancedCommands } from './enhanced-commands.js';
import type { ChannelProFormatter } from './types.js';

/** Parsed callback data */
export interface ParsedCallback {
  feature: 'diff' | 'run' | 'ci' | 'plan' | 'pin' | 'pr';
  action: string;
  id: string;
}

/**
 * Parse callback data from either format.
 *
 * New format: `pro:diff:apply:abc123`
 * Legacy Telegram: `da_abc123` (da=diff apply, dc=diff cancel, etc.)
 */
export function parseCallbackData(data: string): ParsedCallback | null {
  // New format: pro:<feature>:<action>:<id>
  if (data.startsWith('pro:')) {
    const parts = data.split(':');
    if (parts.length >= 4) {
      return {
        feature: parts[1] as ParsedCallback['feature'],
        action: parts[2],
        id: parts.slice(3).join(':'),
      };
    }
    return null;
  }

  // Legacy Telegram short prefixes
  const legacyMap: Record<string, { feature: ParsedCallback['feature']; action: string }> = {
    'da_': { feature: 'diff', action: 'apply' },
    'dc_': { feature: 'diff', action: 'cancel' },
    'dv_': { feature: 'diff', action: 'view' },
    'pa_': { feature: 'plan', action: 'approve' },
    'pr_': { feature: 'plan', action: 'reject' },
    'rd_': { feature: 'run', action: 'detail' },
    'rr_': { feature: 'run', action: 'rerun' },
    'rt_': { feature: 'run', action: 'tests' },
    'rb_': { feature: 'run', action: 'rollback' },
    'cf_': { feature: 'ci', action: 'fix' },
    'cm_': { feature: 'ci', action: 'mute' },
    'pm_': { feature: 'pr', action: 'merge' },
    'pv_': { feature: 'pr', action: 'review' },
  };

  for (const [prefix, mapping] of Object.entries(legacyMap)) {
    if (data.startsWith(prefix)) {
      return {
        ...mapping,
        id: data.slice(prefix.length),
      };
    }
  }

  // Pin callback
  if (data.startsWith('pin_')) {
    return {
      feature: 'pin',
      action: 'create',
      id: data.slice(4),
    };
  }

  return null;
}

/** Send function signature for callback responses */
export type SendFn = (chatId: string, text: string, buttons?: Array<{ text: string; type: 'url' | 'callback'; url?: string; data?: string }>) => Promise<void>;

/** Emit task function signature */
export type EmitTaskFn = (chatId: string, userId: string, objective: string) => void;

/**
 * Routes parsed callbacks to the correct pro feature handler.
 */
export class ProCallbackRouter {
  constructor(
    private diffFirst: DiffFirstManager,
    private runCommands: RunCommands,
    private ciWatcher: CIWatcher,
    private enhancedCommands: EnhancedCommands,
    private formatter: ChannelProFormatter,
  ) {}

  /**
   * Route a callback to the correct handler.
   * Returns true if handled, false if not recognized.
   */
  async route(
    data: string,
    userId: string,
    chatId: string,
    sendFn: SendFn,
    emitTask?: EmitTaskFn
  ): Promise<boolean> {
    const parsed = parseCallbackData(data);
    if (!parsed) return false;

    switch (parsed.feature) {
      case 'diff':
        return this.handleDiff(parsed, userId, chatId, sendFn);
      case 'run':
        return this.handleRun(parsed, userId, chatId, sendFn, emitTask);
      case 'ci':
        return this.handleCI(parsed, userId, chatId, sendFn, emitTask);
      case 'pin':
        return this.handlePin(parsed, userId, chatId, sendFn);
      default:
        return false;
    }
  }

  private async handleDiff(
    parsed: ParsedCallback,
    userId: string,
    chatId: string,
    sendFn: SendFn
  ): Promise<boolean> {
    switch (parsed.action) {
      case 'apply': {
        const result = await this.diffFirst.handleApply(parsed.id, userId);
        await sendFn(
          chatId,
          result.success
            ? `Applied ${result.filesApplied} file(s) successfully.`
            : `Failed to apply: ${result.error}`
        );
        return true;
      }
      case 'cancel': {
        const result = await this.diffFirst.handleCancel(parsed.id, userId);
        await sendFn(
          chatId,
          result.success ? 'Changes cancelled.' : `Failed: ${result.error}`
        );
        return true;
      }
      case 'view': {
        const fullDiff = this.diffFirst.handleViewFull(parsed.id);
        await sendFn(chatId, fullDiff || 'Diff not found.');
        return true;
      }
      default:
        return false;
    }
  }

  private async handleRun(
    parsed: ParsedCallback,
    userId: string,
    chatId: string,
    sendFn: SendFn,
    emitTask?: EmitTaskFn
  ): Promise<boolean> {
    switch (parsed.action) {
      case 'detail': {
        const detail = this.runCommands.handleRunDetail(chatId, parsed.id);
        if (detail) {
          const formatted = this.formatter.formatRunDetail(detail.run, detail.testSteps, detail.commitRefs);
          await sendFn(chatId, formatted.text, formatted.buttons);
        }
        return true;
      }
      case 'rerun': {
        const result = await this.runCommands.handleRerun(parsed.id, userId, chatId);
        await sendFn(chatId, result.text);
        if (result.objective && emitTask) {
          emitTask(chatId, userId, result.objective);
        }
        return true;
      }
      case 'tests': {
        const result = await this.runCommands.handleRerunTests(parsed.id, userId, chatId);
        await sendFn(chatId, result.text);
        return true;
      }
      case 'rollback': {
        const result = await this.runCommands.handleRollback(parsed.id, userId, chatId);
        await sendFn(chatId, result.text);
        return true;
      }
      default:
        return false;
    }
  }

  private async handleCI(
    parsed: ParsedCallback,
    userId: string,
    chatId: string,
    sendFn: SendFn,
    emitTask?: EmitTaskFn
  ): Promise<boolean> {
    switch (parsed.action) {
      case 'fix': {
        const result = await this.ciWatcher.handleFixIt(parsed.id, userId, chatId);
        await sendFn(chatId, result.text);
        if (result.objective && emitTask) {
          emitTask(chatId, userId, result.objective);
        }
        return true;
      }
      case 'mute': {
        const result = this.ciWatcher.handleMute(parsed.id);
        await sendFn(chatId, result.text);
        return true;
      }
      default:
        return false;
    }
  }

  private async handlePin(
    parsed: ParsedCallback,
    userId: string,
    chatId: string,
    sendFn: SendFn
  ): Promise<boolean> {
    const pin = this.enhancedCommands.handlePinContext(chatId, userId, parsed.id);
    await sendFn(chatId, `Pinned: ${pin.id}`);
    return true;
  }
}
