/**
 * Cowork conversation branching backed by the same SQLite history consumed by
 * SessionManager. The bridge owns no shadow JSON history.
 */

import type { DatabaseInstance } from '../db/database';
import type { Message } from '../../renderer/types';
import { logWarn } from '../utils/logger';
import {
  SqliteSessionBranchStore,
  type ConversationBranchForkPoint,
  type PersistedConversationBranch,
} from './sqlite-session-branches';
import type { TurnJournalFence } from './turn-journal';

export type BranchSummary = PersistedConversationBranch;

export interface BranchMutationResult {
  success: boolean;
  branch?: BranchSummary;
  /** Exact active history after the transaction, ready for the renderer. */
  messages?: Message[];
  error?: string;
}

export interface SessionBranchingRuntime {
  isBusy(sessionId: string): boolean;
  captureRecoveryJournalFence(sessionId: string): TurnJournalFence | null;
  rotateRecoveryJournal(sessionId: string): void;
  resetConversation(sessionId: string): void;
  getMessages(sessionId: string): Message[];
}

export class SessionBranchingBridge {
  private readonly store: SqliteSessionBranchStore;

  constructor(
    db: Pick<DatabaseInstance, 'raw'>,
    private readonly runtime: SessionBranchingRuntime,
  ) {
    this.store = new SqliteSessionBranchStore(db);
  }

  async listBranches(sessionId: string): Promise<BranchSummary[]> {
    try {
      return this.store.list(sessionId);
    } catch (error) {
      logWarn('[SessionBranchingBridge] listBranches failed:', error);
      return [];
    }
  }

  async fork(
    sessionId: string,
    name: string,
    point: ConversationBranchForkPoint = {},
  ): Promise<BranchMutationResult> {
    return this.mutateHistory(sessionId, (beforeCommit) =>
      this.store.fork(sessionId, name, point, beforeCommit),
    );
  }

  async checkout(sessionId: string, branchId: string): Promise<BranchMutationResult> {
    return this.mutateHistory(sessionId, (beforeCommit) =>
      this.store.checkout(sessionId, branchId, beforeCommit),
    );
  }

  async mergeBranch(
    sessionId: string,
    sourceBranchId: string,
    strategy: 'append' | 'replace' = 'append',
  ): Promise<BranchMutationResult> {
    return this.mutateHistory(sessionId, (beforeCommit) =>
      this.store.merge(sessionId, sourceBranchId, strategy, beforeCommit),
    );
  }

  async deleteBranch(
    sessionId: string,
    branchId: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (this.runtime.isBusy(sessionId)) {
      return { success: false, error: 'Wait for the active turn to finish before deleting a branch.' };
    }
    try {
      this.store.delete(sessionId, branchId);
      return { success: true };
    } catch (error) {
      return this.failure(error);
    }
  }

  async renameBranch(
    sessionId: string,
    branchId: string,
    newName: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      this.store.rename(sessionId, branchId, newName);
      return { success: true };
    } catch (error) {
      return this.failure(error);
    }
  }

  private mutateHistory(
    sessionId: string,
    mutation: (
      beforeCommit: () => TurnJournalFence | null,
    ) => { branch: BranchSummary; messages: unknown[] },
  ): BranchMutationResult {
    if (this.runtime.isBusy(sessionId)) {
      return {
        success: false,
        error: 'Wait for the active turn to finish before switching conversation history.',
      };
    }
    try {
      let journalFenceCaptured = false;
      const result = mutation(() => {
        journalFenceCaptured = true;
        return this.runtime.captureRecoveryJournalFence(sessionId);
      });
      if (journalFenceCaptured) {
        try {
          // This is cleanup only. The SQLite fence committed with the history
          // mutation prevents stale recovery even if rotation fails or the
          // process exits in this post-commit window.
          this.runtime.rotateRecoveryJournal(sessionId);
        } catch (error) {
          logWarn('[SessionBranchingBridge] journal rotation cleanup failed:', error);
        }
      }
      // Drop both the in-memory message cache and any provider-side hidden
      // thread state before reading the newly active SQLite rows.
      this.runtime.resetConversation(sessionId);
      return {
        success: true,
        branch: result.branch,
        messages: this.runtime.getMessages(sessionId),
      };
    } catch (error) {
      return this.failure(error);
    }
  }

  private failure(error: unknown): { success: false; error: string } {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
