/**
 * Pattern-based approval learning for ConfirmationService.
 * After N identical approvals (default 3), auto-approves silently.
 * Persisted to .codebuddy/approval-patterns.json.
 */

import { join } from 'path';
import { readJsonAtomic, writeJsonAtomic } from './atomic-write.js';
import { logger } from './logger.js';

export interface ApprovalPattern {
  /** Tool name */
  tool: string;
  /** Normalized argument pattern (e.g., "npm test", "git status") */
  argsPattern: string;
  /** Number of consecutive approvals */
  approvalCount: number;
  /** Last approved timestamp */
  lastApproved: string;
}

const DEFAULT_THRESHOLD = 3;
const PATTERNS_FILE = '.codebuddy/approval-patterns.json';

export class ApprovalPatternTracker {
  private patterns: Map<string, ApprovalPattern> = new Map();
  private threshold: number;
  private loaded = false;
  private cwd: string;

  constructor(cwd: string = process.cwd(), threshold = DEFAULT_THRESHOLD) {
    this.cwd = cwd;
    this.threshold = threshold;
  }

  private getKey(tool: string, argsPattern: string): string {
    return `${tool}::${argsPattern}`;
  }

  /**
   * Normalize tool arguments into a stable pattern.
   * Strips variable parts (timestamps, UUIDs, temp paths) to match recurring patterns.
   */
  normalizeArgs(args: Record<string, unknown> | string): string {
    const str = typeof args === 'string' ? args : JSON.stringify(args);
    return str
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.Z-]+/g, '<timestamp>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
      .replace(/\/tmp\/[^\s"']+/g, '<tmppath>')
      .substring(0, 500);
  }

  /**
   * Record an approval. Returns true if the pattern has now crossed the auto-approve threshold.
   */
  async recordApproval(tool: string, args: Record<string, unknown> | string): Promise<boolean> {
    await this.ensureLoaded();
    const argsPattern = this.normalizeArgs(args);
    const key = this.getKey(tool, argsPattern);
    const existing = this.patterns.get(key);

    if (existing) {
      existing.approvalCount++;
      existing.lastApproved = new Date().toISOString();
    } else {
      this.patterns.set(key, {
        tool,
        argsPattern,
        approvalCount: 1,
        lastApproved: new Date().toISOString(),
      });
    }

    await this.save();
    const pattern = this.patterns.get(key)!;
    return pattern.approvalCount >= this.threshold;
  }

  /**
   * Check if a tool+args pattern should be auto-approved.
   */
  async shouldAutoApprove(tool: string, args: Record<string, unknown> | string): Promise<boolean> {
    await this.ensureLoaded();
    const argsPattern = this.normalizeArgs(args);
    const key = this.getKey(tool, argsPattern);
    const pattern = this.patterns.get(key);
    return !!pattern && pattern.approvalCount >= this.threshold;
  }

  /**
   * List all learned patterns.
   */
  async listPatterns(): Promise<ApprovalPattern[]> {
    await this.ensureLoaded();
    return [...this.patterns.values()];
  }

  /**
   * Clear all learned patterns.
   */
  async clearPatterns(): Promise<void> {
    this.patterns.clear();
    await this.save();
  }

  /**
   * Get the auto-approve threshold.
   */
  getThreshold(): number {
    return this.threshold;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const filePath = join(this.cwd, PATTERNS_FILE);
    try {
      const data = await readJsonAtomic<ApprovalPattern[]>(filePath, []);
      for (const p of data) {
        this.patterns.set(this.getKey(p.tool, p.argsPattern), p);
      }
    } catch (err) {
      logger.debug(`Failed to load approval patterns: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async save(): Promise<void> {
    const filePath = join(this.cwd, PATTERNS_FILE);
    try {
      const data = [...this.patterns.values()];
      await writeJsonAtomic(filePath, data);
    } catch (err) {
      logger.debug(`Failed to save approval patterns: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Singleton */
let _instance: ApprovalPatternTracker | null = null;

export function getApprovalPatternTracker(cwd?: string): ApprovalPatternTracker {
  if (!_instance) {
    _instance = new ApprovalPatternTracker(cwd);
  }
  return _instance;
}

export function resetApprovalPatternTracker(): void {
  _instance = null;
}
