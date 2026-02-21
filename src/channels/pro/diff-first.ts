/**
 * Diff-First Manager
 *
 * Preview all code changes before applying them.
 * Channel-agnostic - formatting is handled by the ChannelProFormatter.
 */

import { randomBytes } from 'crypto';
import type {
  DiffFirstConfig,
  FileDiffSummary,
  PendingDiff,
  ApplyResult,
} from './types.js';

/** Default config */
const DEFAULT_CONFIG: DiffFirstConfig = {
  enabled: true,
  planFirst: false,
  maxDiffLines: 30,
  autoApplyThreshold: 0,
};

/** Max pending diffs to keep in memory */
const MAX_PENDING = 50;

/** Default expiry: 30 minutes */
const DEFAULT_EXPIRY_MS = 30 * 60 * 1000;

/**
 * Manages diff previews for channel interactions.
 */
export class DiffFirstManager {
  private pending: Map<string, PendingDiff> = new Map();
  private config: DiffFirstConfig;

  /** Callback invoked when a diff is approved for application */
  onApply?: (diff: PendingDiff) => Promise<ApplyResult>;

  /** Callback invoked when a diff is cancelled */
  onCancel?: (diff: PendingDiff) => Promise<void>;

  constructor(config?: Partial<DiffFirstConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a pending diff for user review
   */
  createPendingDiff(
    chatId: string,
    userId: string,
    turnId: number,
    diffs: FileDiffSummary[],
    plan?: string,
    fullDiff?: string
  ): PendingDiff {
    const id = randomBytes(3).toString('hex');

    const pending: PendingDiff = {
      id,
      chatId,
      userId,
      turnId,
      diffs,
      plan,
      fullDiff,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + DEFAULT_EXPIRY_MS,
    };

    this.pending.set(id, pending);
    this.enforceLimit();

    return pending;
  }

  /**
   * Format the full unified diff for viewing (pure text, no channel-specific formatting)
   */
  formatFullDiff(pending: PendingDiff): string {
    if (pending.fullDiff) {
      return pending.fullDiff;
    }

    const lines: string[] = [];
    for (const diff of pending.diffs) {
      lines.push(`--- a/${diff.path}`);
      lines.push(`+++ b/${diff.path}`);
      if (diff.excerpt) {
        lines.push(diff.excerpt);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  /**
   * Handle apply action
   */
  async handleApply(diffId: string, userId: string): Promise<ApplyResult> {
    const pending = this.pending.get(diffId);
    if (!pending) {
      return { success: false, filesApplied: 0, error: 'Diff not found or expired' };
    }
    if (pending.userId !== userId) {
      return { success: false, filesApplied: 0, error: 'Only the requesting user can apply' };
    }
    if (pending.status !== 'pending') {
      return { success: false, filesApplied: 0, error: `Diff already ${pending.status}` };
    }
    if (Date.now() > pending.expiresAt) {
      pending.status = 'expired';
      return { success: false, filesApplied: 0, error: 'Diff has expired' };
    }

    if (this.onApply) {
      const result = await this.onApply(pending);
      pending.status = result.success ? 'applied' : 'pending';
      return result;
    }

    pending.status = 'applied';
    return { success: true, filesApplied: pending.diffs.length };
  }

  /**
   * Handle cancel action
   */
  async handleCancel(diffId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    const pending = this.pending.get(diffId);
    if (!pending) {
      return { success: false, error: 'Diff not found' };
    }
    if (pending.userId !== userId) {
      return { success: false, error: 'Only the requesting user can cancel' };
    }
    if (pending.status !== 'pending') {
      return { success: false, error: `Diff already ${pending.status}` };
    }

    pending.status = 'cancelled';

    if (this.onCancel) {
      await this.onCancel(pending);
    }

    return { success: true };
  }

  /**
   * Handle view full diff action
   */
  handleViewFull(diffId: string): string | null {
    const pending = this.pending.get(diffId);
    if (!pending) return null;
    return this.formatFullDiff(pending);
  }

  /**
   * Get a pending diff by ID
   */
  getPendingDiff(id: string): PendingDiff | undefined {
    return this.pending.get(id);
  }

  /**
   * Check if auto-apply threshold is met
   */
  shouldAutoApply(diffs: FileDiffSummary[]): boolean {
    if (this.config.autoApplyThreshold <= 0) return false;
    const totalChanges = diffs.reduce(
      (sum, d) => sum + d.linesAdded + d.linesRemoved,
      0
    );
    return totalChanges <= this.config.autoApplyThreshold;
  }

  /**
   * Clean up expired pending diffs
   */
  cleanupExpired(): number {
    let cleaned = 0;
    const now = Date.now();
    for (const [id, diff] of this.pending) {
      if (diff.status === 'pending' && now > diff.expiresAt) {
        diff.status = 'expired';
        cleaned++;
      }
      if (diff.status !== 'pending' && now - diff.createdAt > 3600_000) {
        this.pending.delete(id);
      }
    }
    return cleaned;
  }

  /**
   * Get current config
   */
  getConfig(): DiffFirstConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(updates: Partial<DiffFirstConfig>): void {
    Object.assign(this.config, updates);
  }

  private enforceLimit(): void {
    if (this.pending.size <= MAX_PENDING) return;

    const entries = Array.from(this.pending.entries())
      .sort((a, b) => a[1].createdAt - b[1].createdAt);

    while (this.pending.size > MAX_PENDING && entries.length > 0) {
      const [id, diff] = entries.shift()!;
      if (diff.status !== 'pending') {
        this.pending.delete(id);
      }
    }

    while (this.pending.size > MAX_PENDING && entries.length > 0) {
      const [id] = entries.shift()!;
      this.pending.delete(id);
    }
  }
}
