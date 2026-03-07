/**
 * Approvals Command
 *
 * Manage pending and historical tool/action approvals.
 * Inspired by OpenClaw's `openclaw approvals` CLI.
 *
 * Usage:
 *   buddy approvals list [--pending|--approved|--denied]
 *   buddy approvals approve <id>
 *   buddy approvals deny <id>
 *   buddy approvals policy [show|set <mode>]
 *   buddy approvals history [--limit N]
 */

import type { Command } from 'commander';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ApprovalRequest {
  id: string;
  action: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  status: ApprovalStatus;
  createdAt: Date;
  decidedAt?: Date;
  decidedBy?: string;
  sessionId?: string;
}

// ============================================================================
// In-Memory Approvals Store (production would persist)
// ============================================================================

class ApprovalsStore {
  private static instance: ApprovalsStore | null = null;
  private requests: Map<string, ApprovalRequest> = new Map();
  private idCounter = 0;

  static getInstance(): ApprovalsStore {
    if (!ApprovalsStore.instance) {
      ApprovalsStore.instance = new ApprovalsStore();
    }
    return ApprovalsStore.instance;
  }

  static resetInstance(): void {
    ApprovalsStore.instance = null;
  }

  create(req: Omit<ApprovalRequest, 'id' | 'status' | 'createdAt'>): ApprovalRequest {
    const id = `apr_${++this.idCounter}_${Date.now()}`;
    const approval: ApprovalRequest = {
      ...req,
      id,
      status: 'pending',
      createdAt: new Date(),
    };
    this.requests.set(id, approval);
    return approval;
  }

  approve(id: string, decidedBy?: string): boolean {
    const req = this.requests.get(id);
    if (!req || req.status !== 'pending') return false;
    req.status = 'approved';
    req.decidedAt = new Date();
    req.decidedBy = decidedBy || 'cli';
    return true;
  }

  deny(id: string, decidedBy?: string): boolean {
    const req = this.requests.get(id);
    if (!req || req.status !== 'pending') return false;
    req.status = 'denied';
    req.decidedAt = new Date();
    req.decidedBy = decidedBy || 'cli';
    return true;
  }

  list(filter?: { status?: ApprovalStatus }): ApprovalRequest[] {
    let reqs = Array.from(this.requests.values());
    if (filter?.status) {
      reqs = reqs.filter(r => r.status === filter.status);
    }
    return reqs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  get(id: string): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  expireOld(maxAgeMs: number = 3600_000): number {
    const now = Date.now();
    let expired = 0;
    for (const req of this.requests.values()) {
      if (req.status === 'pending' && now - req.createdAt.getTime() > maxAgeMs) {
        req.status = 'expired';
        expired++;
      }
    }
    return expired;
  }
}

export { ApprovalsStore };

// ============================================================================
// Command Registration
// ============================================================================

export function registerApprovalsCommands(program: Command): void {
  const approvals = program
    .command('approvals')
    .description('Manage tool/action approval requests');

  approvals
    .command('list')
    .description('List approval requests')
    .option('--pending', 'Show only pending requests')
    .option('--approved', 'Show only approved requests')
    .option('--denied', 'Show only denied requests')
    .option('--limit <n>', 'Limit results', '20')
    .action(async (opts) => {
      const store = ApprovalsStore.getInstance();
      store.expireOld();

      const status = opts.pending ? 'pending'
        : opts.approved ? 'approved'
        : opts.denied ? 'denied'
        : undefined;

      const reqs = store.list({ status: status as ApprovalStatus | undefined })
        .slice(0, parseInt(opts.limit, 10));

      if (reqs.length === 0) {
        console.log('No approval requests found.');
        return;
      }

      console.log(`\nApproval Requests (${reqs.length}):\n`);
      for (const req of reqs) {
        const icon = req.status === 'approved' ? '✓'
          : req.status === 'denied' ? '✗'
          : req.status === 'expired' ? '⏰'
          : '?';
        console.log(`  ${icon} [${req.id}] ${req.tool} — ${req.action}`);
        console.log(`    Risk: ${req.riskLevel} | Status: ${req.status} | ${req.createdAt.toISOString()}`);
        if (req.reason) console.log(`    Reason: ${req.reason}`);
        console.log();
      }
    });

  approvals
    .command('approve')
    .description('Approve a pending request')
    .argument('<id>', 'Approval request ID')
    .action(async (id) => {
      const store = ApprovalsStore.getInstance();
      if (store.approve(id)) {
        console.log(`Request ${id} approved.`);
      } else {
        console.error(`Request ${id} not found or not pending.`);
        process.exit(1);
      }
    });

  approvals
    .command('deny')
    .description('Deny a pending request')
    .argument('<id>', 'Approval request ID')
    .action(async (id) => {
      const store = ApprovalsStore.getInstance();
      if (store.deny(id)) {
        console.log(`Request ${id} denied.`);
      } else {
        console.error(`Request ${id} not found or not pending.`);
        process.exit(1);
      }
    });

  approvals
    .command('policy')
    .description('Show or set the approval policy')
    .argument('[action]', 'Action: show or set')
    .argument('[mode]', 'Mode: suggest, auto-edit, full-auto')
    .action(async (action, mode) => {
      if (!action || action === 'show') {
        const currentMode = process.env.SECURITY_MODE || 'suggest';
        console.log(`Current approval policy: ${currentMode}`);
        console.log(`\nAvailable modes:`);
        console.log(`  suggest    — Confirm all destructive operations`);
        console.log(`  auto-edit  — Auto-approve file edits, confirm bash`);
        console.log(`  full-auto  — No confirmations (YOLO mode required)`);
        return;
      }
      if (action === 'set' && mode) {
        const valid = ['suggest', 'auto-edit', 'full-auto'];
        if (!valid.includes(mode)) {
          console.error(`Invalid mode: ${mode}. Must be one of: ${valid.join(', ')}`);
          process.exit(1);
        }
        console.log(`Approval policy set to: ${mode}`);
        console.log(`Note: Set SECURITY_MODE=${mode} in your environment to persist.`);
      }
    });
}
