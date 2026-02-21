/**
 * Pro Features Bundle
 *
 * Composition helper that bundles all 6 pro features with lazy loading.
 * Any channel can opt in by creating a ProFeatures instance.
 */

import type {
  ChannelProFormatter,
  DiffFirstConfig,
  CIWatchConfig,
  AuthScope,
} from './types.js';
import type { SendFn, EmitTaskFn } from './callback-router.js';
import { ScopedAuthManager } from './scoped-auth.js';
import { DiffFirstManager } from './diff-first.js';
import { RunTracker } from './run-tracker.js';
import { RunCommands } from './run-commands.js';
import { EnhancedCommands } from './enhanced-commands.js';
import { CIWatcher } from './ci-watcher.js';
import { TextProFormatter } from './text-formatter.js';
import { ProCallbackRouter } from './callback-router.js';

/** Configuration for ProFeatures */
export interface ProFeaturesConfig {
  /** Admin user IDs */
  adminUsers?: string[];
  /** Custom formatter (defaults to TextProFormatter) */
  formatter?: ChannelProFormatter;
  /** Scoped auth config */
  scopedAuth?: {
    defaultScopes?: AuthScope[];
    adminScopes?: AuthScope[];
  };
  /** Diff-first config */
  diffFirst?: Partial<DiffFirstConfig>;
  /** CI watcher config */
  ciWatch?: Partial<CIWatchConfig>;
  /** Enable enhanced commands (default true) */
  enhancedCommands?: boolean;
}

/**
 * Bundles all 6 pro features with lazy loading.
 * Channels opt in by creating a ProFeatures instance.
 */
export class ProFeatures {
  private _scopedAuth?: ScopedAuthManager;
  private _diffFirst?: DiffFirstManager;
  private _runTracker?: RunTracker;
  private _runCommands?: RunCommands;
  private _enhancedCommands?: EnhancedCommands;
  private _ciWatcher?: CIWatcher;
  private _callbackRouter?: ProCallbackRouter;
  private _formatter?: ChannelProFormatter;

  private config: ProFeaturesConfig;

  constructor(config: ProFeaturesConfig = {}) {
    this.config = config;
  }

  /** Get the formatter */
  get formatter(): ChannelProFormatter {
    if (!this._formatter) {
      this._formatter = this.config.formatter || new TextProFormatter();
    }
    return this._formatter;
  }

  /** Lazy getter for ScopedAuthManager */
  get scopedAuth(): ScopedAuthManager {
    if (!this._scopedAuth) {
      this._scopedAuth = new ScopedAuthManager(this.config.adminUsers || []);
    }
    return this._scopedAuth;
  }

  /** Lazy getter for DiffFirstManager */
  get diffFirst(): DiffFirstManager {
    if (!this._diffFirst) {
      this._diffFirst = new DiffFirstManager(this.config.diffFirst);
    }
    return this._diffFirst;
  }

  /** Lazy getter for RunTracker */
  get runTracker(): RunTracker {
    if (!this._runTracker) {
      this._runTracker = new RunTracker();
    }
    return this._runTracker;
  }

  /** Lazy getter for RunCommands */
  get runCommands(): RunCommands {
    if (!this._runCommands) {
      this._runCommands = new RunCommands(this.runTracker, this._scopedAuth);
    }
    return this._runCommands;
  }

  /** Lazy getter for EnhancedCommands */
  get enhancedCommands(): EnhancedCommands {
    if (!this._enhancedCommands) {
      this._enhancedCommands = new EnhancedCommands(this._scopedAuth);
    }
    return this._enhancedCommands;
  }

  /** Lazy getter for CIWatcher */
  get ciWatcher(): CIWatcher {
    if (!this._ciWatcher) {
      this._ciWatcher = new CIWatcher(
        this.config.ciWatch ? { ...this.config.ciWatch, mutedPatterns: this.config.ciWatch.mutedPatterns || [] } as CIWatchConfig : undefined,
        this._scopedAuth
      );
    }
    return this._ciWatcher;
  }

  /** Lazy getter for ProCallbackRouter */
  get callbackRouter(): ProCallbackRouter {
    if (!this._callbackRouter) {
      this._callbackRouter = new ProCallbackRouter(
        this.diffFirst,
        this.runCommands,
        this.ciWatcher,
        this.enhancedCommands,
        this.formatter,
      );
    }
    return this._callbackRouter;
  }

  /**
   * Route a slash command to the appropriate handler.
   * Returns true if the command was handled.
   */
  async routeCommand(
    cmd: string,
    args: string[],
    chatId: string,
    userId: string,
    sendFn: SendFn
  ): Promise<boolean> {
    if (this.config.enhancedCommands === false) return false;

    switch (cmd) {
      case 'repo': {
        const result = this.enhancedCommands.handleRepo(chatId, args[0]);
        if (result.success) {
          const formatted = this.formatter.formatRepoInfo(result.data);
          await sendFn(chatId, formatted.text, formatted.buttons);
        } else {
          await sendFn(chatId, result.error);
        }
        return true;
      }
      case 'branch': {
        const result = this.enhancedCommands.handleBranch(chatId, args[0]);
        if (result.success) {
          const formatted = this.formatter.formatBranchInfo(result.data);
          await sendFn(chatId, formatted.text, formatted.buttons);
        } else {
          await sendFn(chatId, result.error);
        }
        return true;
      }
      case 'pr': {
        const result = this.enhancedCommands.handlePR(chatId, args[0]);
        if (!result.success) {
          await sendFn(chatId, result.error);
        } else if ('data' in result) {
          const formatted = this.formatter.formatPRInfo(result.data);
          await sendFn(chatId, formatted.text, formatted.buttons);
        } else {
          const formatted = this.formatter.formatPRList(result.list);
          await sendFn(chatId, formatted.text, formatted.buttons);
        }
        return true;
      }
      case 'task': {
        const desc = args.join(' ');
        if (!desc) {
          await sendFn(chatId, 'Usage: /task <description>');
          return true;
        }
        const result = this.enhancedCommands.handleTask(chatId, userId, desc);
        await sendFn(chatId, result.text);
        return true;
      }
      case 'yolo': {
        const result = this.enhancedCommands.handleYolo(chatId, userId, args[0]);
        await sendFn(chatId, result.text);
        return true;
      }
      case 'runs': {
        const result = this.runCommands.handleRunsList(chatId, userId);
        const formatted = this.formatter.formatRunsList(result.runs);
        await sendFn(chatId, formatted.text, formatted.buttons);
        return true;
      }
      case 'run': {
        if (!args[0]) {
          await sendFn(chatId, 'Usage: /run <id>');
          return true;
        }
        const detail = this.runCommands.handleRunDetail(chatId, args[0]);
        if (detail) {
          const formatted = this.formatter.formatRunDetail(detail.run, detail.testSteps, detail.commitRefs);
          await sendFn(chatId, formatted.text, formatted.buttons);
        } else {
          await sendFn(chatId, `Run not found: ${args[0]}`);
        }
        return true;
      }
      case 'pins': {
        const pins = this.enhancedCommands.getPins(chatId);
        if (pins.length === 0) {
          await sendFn(chatId, 'No pinned context.');
        } else {
          const text = pins
            .map((p) => `[${p.id}] ${p.content.slice(0, 100)}${p.tags.length > 0 ? ` (${p.tags.join(', ')})` : ''}`)
            .join('\n');
          await sendFn(chatId, `Pinned Context:\n${text}`);
        }
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * Route a callback query to the correct handler.
   * Returns true if handled.
   */
  async routeCallback(
    data: string,
    userId: string,
    chatId: string,
    sendFn: SendFn,
    emitTask?: EmitTaskFn
  ): Promise<boolean> {
    return this.callbackRouter.route(data, userId, chatId, sendFn, emitTask);
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    if (this._ciWatcher) this._ciWatcher.stop();
    if (this._enhancedCommands) this._enhancedCommands.destroy();
  }
}
