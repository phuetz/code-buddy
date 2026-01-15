/**
 * Conversation Branching and Merging (Items 106, 107)
 * Branch and merge conversation threads
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface ConversationBranch {
  id: string;
  name: string;
  parentBranchId: string | null;
  branchPointMessageId: string | null;
  messages: Message[];
  createdAt: Date;
  metadata: Record<string, unknown>;
}

export interface MergeResult {
  success: boolean;
  conflicts: MergeConflict[];
  mergedBranch: ConversationBranch;
}

export interface MergeConflict {
  messageId: string;
  sourceBranch: string;
  targetBranch: string;
  sourceContent: string;
  targetContent: string;
}

export class ConversationBranchManager extends EventEmitter {
  private branches: Map<string, ConversationBranch> = new Map();
  private currentBranchId: string;

  constructor() {
    super();
    const mainBranch = this.createBranch('main', null, null);
    this.currentBranchId = mainBranch.id;
  }

  createBranch(
    name: string,
    parentBranchId: string | null,
    branchPointMessageId: string | null
  ): ConversationBranch {
    const branch: ConversationBranch = {
      id: crypto.randomBytes(8).toString('hex'),
      name,
      parentBranchId,
      branchPointMessageId,
      messages: [],
      createdAt: new Date(),
      metadata: {},
    };

    // Copy messages from parent up to branch point
    if (parentBranchId && branchPointMessageId) {
      const parent = this.branches.get(parentBranchId);
      if (parent) {
        const branchIndex = parent.messages.findIndex(m => m.id === branchPointMessageId);
        if (branchIndex >= 0) {
          branch.messages = parent.messages.slice(0, branchIndex + 1).map(m => ({ ...m }));
        }
      }
    }

    this.branches.set(branch.id, branch);
    this.emit('branch-created', branch);
    return branch;
  }

  switchBranch(branchId: string): ConversationBranch | null {
    const branch = this.branches.get(branchId);
    if (branch) {
      this.currentBranchId = branchId;
      this.emit('branch-switched', branch);
    }
    return branch || null;
  }

  getCurrentBranch(): ConversationBranch {
    return this.branches.get(this.currentBranchId)!;
  }

  addMessage(role: Message['role'], content: string): Message {
    const branch = this.getCurrentBranch();
    const message: Message = {
      id: crypto.randomBytes(8).toString('hex'),
      role,
      content,
      timestamp: new Date(),
    };
    branch.messages.push(message);
    this.emit('message-added', { branchId: branch.id, message });
    return message;
  }

  branchFromMessage(messageId: string, newBranchName: string): ConversationBranch {
    return this.createBranch(newBranchName, this.currentBranchId, messageId);
  }

  mergeBranches(sourceBranchId: string, targetBranchId: string): MergeResult {
    const source = this.branches.get(sourceBranchId);
    const target = this.branches.get(targetBranchId);

    if (!source || !target) {
      throw new Error('Branch not found');
    }

    const conflicts: MergeConflict[] = [];
    const mergedMessages: Message[] = [...target.messages];

    // Find common ancestor
    const _sourceIds = new Set(source.messages.map(m => m.id));
    const targetIds = new Set(target.messages.map(m => m.id));

    // Add unique messages from source
    for (const msg of source.messages) {
      if (!targetIds.has(msg.id)) {
        mergedMessages.push({ ...msg });
      }
    }

    // Sort by timestamp
    mergedMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const mergedBranch: ConversationBranch = {
      ...target,
      messages: mergedMessages,
      metadata: {
        ...target.metadata,
        mergedFrom: sourceBranchId,
        mergedAt: new Date().toISOString(),
      },
    };

    this.branches.set(targetBranchId, mergedBranch);
    this.emit('branches-merged', { sourceBranchId, targetBranchId });

    return { success: true, conflicts, mergedBranch };
  }

  deleteBranch(branchId: string): boolean {
    if (branchId === this.currentBranchId) {
      return false; // Cannot delete current branch
    }
    const deleted = this.branches.delete(branchId);
    if (deleted) this.emit('branch-deleted', branchId);
    return deleted;
  }

  getBranches(): ConversationBranch[] {
    return Array.from(this.branches.values());
  }

  getBranch(branchId: string): ConversationBranch | undefined {
    return this.branches.get(branchId);
  }

  renameBranch(branchId: string, newName: string): boolean {
    const branch = this.branches.get(branchId);
    if (branch) {
      branch.name = newName;
      this.emit('branch-renamed', { branchId, newName });
      return true;
    }
    return false;
  }

  getHistory(branchId: string): ConversationBranch[] {
    const history: ConversationBranch[] = [];
    let current = this.branches.get(branchId);

    while (current) {
      history.unshift(current);
      current = current.parentBranchId ? this.branches.get(current.parentBranchId) : undefined;
    }

    return history;
  }
}

let instance: ConversationBranchManager | null = null;

export function getConversationBranchManager(): ConversationBranchManager {
  if (!instance) instance = new ConversationBranchManager();
  return instance;
}

export default ConversationBranchManager;
