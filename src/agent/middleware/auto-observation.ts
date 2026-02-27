/**
 * Auto-Observation Middleware
 *
 * OpenClaw-inspired observe→decide→act→verify loop.
 * After each tool round that contains state-changing actions (click, type, navigate, etc.),
 * this middleware waits for UI stabilization, takes a new snapshot, diffs it against
 * the previous snapshot, and injects a verification message into the conversation
 * so the LLM can confirm the action succeeded.
 *
 * Activated by agent profiles with `metadata.enableAutoObservation: true`.
 *
 * @module agent/middleware
 */

import { ConversationMiddleware, MiddlewareContext, MiddlewareResult } from './types.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Configuration
// ============================================================================

export interface AutoObservationConfig {
  /** Delay (ms) after a state-changing action before taking verification snapshot */
  stabilizationMs: number;
  /** Max verification observations per turn (prevents infinite observe→act loops) */
  maxObservationsPerTurn: number;
  /** Whether to prefer browser snapshots (true) or desktop snapshots (false) */
  preferBrowser: boolean;
}

const DEFAULT_CONFIG: AutoObservationConfig = {
  stabilizationMs: 500,
  maxObservationsPerTurn: 3,
  preferBrowser: true,
};

// ============================================================================
// State-changing action sets
// ============================================================================

/** computer_control actions that mutate UI state */
const DESKTOP_STATE_ACTIONS = new Set([
  'click', 'double_click', 'right_click',
  'type', 'key', 'hotkey',
  'drag', 'scroll',
  'focus_window', 'close_window',
]);

/** browser actions that mutate page state */
const BROWSER_STATE_ACTIONS = new Set([
  'navigate', 'click', 'double_click', 'right_click',
  'fill', 'submit', 'select', 'hover', 'scroll',
  'go_back', 'go_forward', 'reload',
  'evaluate', 'type', 'press',
]);

// ============================================================================
// Middleware
// ============================================================================

export class AutoObservationMiddleware implements ConversationMiddleware {
  readonly name = 'auto-observation';
  readonly priority = 50;

  private config: AutoObservationConfig;
  private observationsThisTurn = 0;
  private previousDesktopSnapshot: unknown = null;
  private previousBrowserSnapshot: unknown = null;

  constructor(config: Partial<AutoObservationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  beforeTurn(_context: MiddlewareContext): MiddlewareResult {
    // Reset per-turn observation counter
    this.observationsThisTurn = 0;
    return { action: 'continue' };
  }

  async afterTurn(context: MiddlewareContext): Promise<MiddlewareResult> {
    // Check if we've hit the observation cap
    if (this.observationsThisTurn >= this.config.maxObservationsPerTurn) {
      return { action: 'continue' };
    }

    // Scan messages for state-changing tool results in this turn
    const { hasDesktopAction, hasBrowserAction } = this.detectStateChangingActions(context.messages);

    if (!hasDesktopAction && !hasBrowserAction) {
      return { action: 'continue' };
    }

    // Wait for UI stabilization
    await this.sleep(this.config.stabilizationMs);

    try {
      const verificationParts: string[] = [];

      // Take desktop snapshot if needed
      if (hasDesktopAction) {
        const desktopVerification = await this.verifyDesktop();
        if (desktopVerification) {
          verificationParts.push(desktopVerification);
        }
      }

      // Take browser snapshot if needed
      if (hasBrowserAction) {
        const browserVerification = await this.verifyBrowser();
        if (browserVerification) {
          verificationParts.push(browserVerification);
        }
      }

      // Inject verification message if we have results
      if (verificationParts.length > 0) {
        this.observationsThisTurn++;

        const verificationMessage = [
          '[Auto-Observation] Verification snapshot after state-changing action:',
          '',
          ...verificationParts,
        ].join('\n');

        // Push as user message so the LLM sees it in the next round
        context.messages.push({
          role: 'user',
          content: verificationMessage,
        });

        logger.debug('Auto-observation injected verification', {
          observationNumber: this.observationsThisTurn,
          hasDesktopAction,
          hasBrowserAction,
        });
      }
    } catch (error) {
      // Non-fatal — don't break the agentic loop
      logger.debug('Auto-observation snapshot failed (non-fatal)', { error: String(error) });
    }

    return { action: 'continue' };
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private detectStateChangingActions(messages: MiddlewareContext['messages']): {
    hasDesktopAction: boolean;
    hasBrowserAction: boolean;
  } {
    let hasDesktopAction = false;
    let hasBrowserAction = false;

    // Scan the last few messages for tool call results
    const recentMessages = messages.slice(-10);

    for (const msg of recentMessages) {
      // Check tool_calls in assistant messages
      if (msg.role === 'assistant' && Array.isArray((msg as any).tool_calls)) {
        for (const tc of (msg as any).tool_calls) {
          const name = tc?.function?.name;
          let args: Record<string, unknown> = {};
          try {
            args = typeof tc?.function?.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : (tc?.function?.arguments || {});
          } catch (e) { logger.debug('Failed to parse tool call arguments in auto-observation', { error: String(e) }); }

          const action = args.action as string | undefined;

          if (name === 'computer_control' && action && DESKTOP_STATE_ACTIONS.has(action)) {
            hasDesktopAction = true;
          }
          if (name === 'browser' && action && BROWSER_STATE_ACTIONS.has(action)) {
            hasBrowserAction = true;
          }
        }
      }
    }

    return { hasDesktopAction, hasBrowserAction };
  }

  private async verifyDesktop(): Promise<string | null> {
    try {
      const { getSmartSnapshotManager } = await import('../../desktop-automation/index.js');
      const snapshotManager = getSmartSnapshotManager();

      const previousSnapshot = this.previousDesktopSnapshot;
      const newSnapshot = await snapshotManager.takeSnapshot();
      this.previousDesktopSnapshot = newSnapshot;

      const parts: string[] = ['## Desktop Verification'];

      // Compute diff if we have a previous snapshot
      if (previousSnapshot) {
        const diff = snapshotManager.compareTo(previousSnapshot as any);
        if (diff.hasChanges) {
          parts.push(`Changes detected (similarity: ${(diff.similarity * 100).toFixed(0)}%):`);
          if (diff.newElements.length > 0) {
            parts.push(`  New elements: ${diff.newElements.slice(0, 5).map(e => `[${e.ref}] ${e.name}`).join(', ')}`);
          }
          if (diff.removedElements.length > 0) {
            parts.push(`  Removed elements: ${diff.removedElements.slice(0, 5).map(e => `[${e.ref}] ${e.name}`).join(', ')}`);
          }
        } else {
          parts.push('No significant UI changes detected.');
        }
      }

      // Add current snapshot text
      const textRepr = snapshotManager.toTextRepresentation();
      parts.push('', textRepr);

      return parts.join('\n');
    } catch (error) {
      logger.debug('Desktop verification failed', { error: String(error) });
      return null;
    }
  }

  private async verifyBrowser(): Promise<string | null> {
    try {
      const { getBrowserManager } = await import('../../browser-automation/index.js');
      const manager = getBrowserManager();

      const previousSnapshot = this.previousBrowserSnapshot;
      const newSnapshot = await manager.takeSnapshot();
      this.previousBrowserSnapshot = newSnapshot;

      const parts: string[] = ['## Browser Verification'];

      parts.push(`URL: ${newSnapshot.url}`);
      parts.push(`Title: ${newSnapshot.title}`);
      parts.push(`Elements: ${newSnapshot.elements.length}`);

      // Compute simple diff
      if (previousSnapshot) {
        const prev = previousSnapshot as typeof newSnapshot;
        const prevRefs = new Set(prev.elements.map(e => `${e.role}:${e.name}`));
        const currRefs = new Set(newSnapshot.elements.map(e => `${e.role}:${e.name}`));

        const newElements = newSnapshot.elements.filter(e => !prevRefs.has(`${e.role}:${e.name}`));
        const removedElements = prev.elements.filter(e => !currRefs.has(`${e.role}:${e.name}`));

        if (newElements.length > 0 || removedElements.length > 0 || prev.url !== newSnapshot.url) {
          parts.push('Changes:');
          if (prev.url !== newSnapshot.url) {
            parts.push(`  URL changed: ${prev.url} → ${newSnapshot.url}`);
          }
          if (newElements.length > 0) {
            parts.push(`  New elements: ${newElements.slice(0, 5).map(e => `[${e.ref}] ${e.name}`).join(', ')}`);
          }
          if (removedElements.length > 0) {
            parts.push(`  Removed: ${removedElements.slice(0, 5).map(e => `[${e.ref}] ${e.name}`).join(', ')}`);
          }
        } else {
          parts.push('No significant page changes detected.');
        }
      }

      // Add element listing
      const interactiveElements = newSnapshot.elements
        .filter(e => ['button', 'link', 'textbox', 'checkbox', 'radio', 'select', 'option', 'menuitem'].includes(e.role))
        .slice(0, 50);

      if (interactiveElements.length > 0) {
        parts.push('', 'Interactive Elements:');
        for (const elem of interactiveElements) {
          const valueStr = elem.value ? ` = "${elem.value}"` : '';
          parts.push(`  [${elem.ref}] ${elem.role}: ${elem.name}${valueStr}`);
        }
      }

      return parts.join('\n');
    } catch (error) {
      logger.debug('Browser verification failed', { error: String(error) });
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
