/**
 * Run Tracker
 *
 * Records agent execution runs with step-by-step timelines,
 * artifacts, and cost tracking. Supports replay and rollback.
 * Channel-agnostic - formatting is handled by the ChannelProFormatter.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { randomBytes } from 'crypto';
import type { RunStatus, RunStep, RunArtifact, RunRecord } from './types.js';

/** Max runs to retain */
const MAX_RUNS = 100;

/**
 * Tracks agent execution runs with detailed timelines.
 */
export class RunTracker {
  private runs: Map<string, RunRecord> = new Map();
  private activeRunId: string | null = null;
  private runsDir: string;

  constructor(runsDir?: string) {
    this.runsDir = runsDir || join(os.homedir(), '.codebuddy', 'channel-runs');
    this.ensureDir();
    this.loadAll();
  }

  /**
   * Start a new run
   */
  startRun(
    sessionId: string,
    objective: string,
    options?: { chatId?: string; userId?: string }
  ): RunRecord {
    const id = `run_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;

    const run: RunRecord = {
      id,
      sessionId,
      objective,
      status: 'running',
      steps: [],
      artifacts: [],
      tokenCount: 0,
      totalCost: 0,
      startedAt: Date.now(),
      chatId: options?.chatId,
      userId: options?.userId,
    };

    this.runs.set(id, run);
    this.activeRunId = id;
    this.saveRun(run);
    this.pruneOldRuns();

    return run;
  }

  /**
   * Add a step to the active run
   */
  addStep(
    runId: string,
    toolName: string,
    args: Record<string, unknown>,
    options?: { turnId?: number }
  ): RunStep {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    const step: RunStep = {
      stepId: `step_${run.steps.length + 1}`,
      toolName,
      args,
      startedAt: Date.now(),
      turnId: options?.turnId,
    };

    run.steps.push(step);
    return step;
  }

  /**
   * Complete a step with its result
   */
  completeStep(
    runId: string,
    stepId: string,
    result: string,
    success: boolean,
    filesChanged?: string[]
  ): void {
    const run = this.runs.get(runId);
    if (!run) return;

    const step = run.steps.find((s) => s.stepId === stepId);
    if (!step) return;

    step.result = result;
    step.success = success;
    step.endedAt = Date.now();
    step.filesChanged = filesChanged;

    this.saveRun(run);
  }

  /**
   * Add an artifact to a run
   */
  addArtifact(runId: string, artifact: RunArtifact): void {
    const run = this.runs.get(runId);
    if (!run) return;

    run.artifacts.push(artifact);
    this.saveRun(run);
  }

  /**
   * Update token count and cost
   */
  updateUsage(runId: string, tokenCount: number, cost: number): void {
    const run = this.runs.get(runId);
    if (!run) return;

    run.tokenCount = tokenCount;
    run.totalCost = cost;
  }

  /**
   * End a run
   */
  endRun(runId: string, status: RunStatus): RunRecord | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;

    run.status = status;
    run.endedAt = Date.now();

    if (this.activeRunId === runId) {
      this.activeRunId = null;
    }

    this.saveRun(run);
    return run;
  }

  /**
   * Get the active run
   */
  getActiveRun(): RunRecord | undefined {
    if (!this.activeRunId) return undefined;
    return this.runs.get(this.activeRunId);
  }

  /**
   * Get a run by ID
   */
  getRun(id: string): RunRecord | undefined {
    return this.runs.get(id);
  }

  /**
   * List runs, most recent first
   */
  listRuns(limit: number = 20): RunRecord[] {
    return Array.from(this.runs.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  /**
   * Get test steps from a run (for re-running tests)
   */
  getTestSteps(runId: string): RunStep[] {
    const run = this.runs.get(runId);
    if (!run) return [];
    return run.steps.filter(
      (s) => s.toolName === 'bash' &&
        (typeof s.args.command === 'string') &&
        /\b(test|jest|pytest|mocha|vitest|npm\s+test)\b/i.test(s.args.command as string)
    );
  }

  /**
   * Get the git commit refs from a run (for rollback)
   */
  getCommitRefs(runId: string): string[] {
    const run = this.runs.get(runId);
    if (!run) return [];
    return run.artifacts
      .filter((a) => a.type === 'commit' && a.ref)
      .map((a) => a.ref!);
  }

  // Static utility methods (used by formatters)

  static getStatusIcon(status: RunStatus): string {
    switch (status) {
      case 'running': return '[RUN]';
      case 'completed': return '[DONE]';
      case 'failed': return '[FAIL]';
      case 'cancelled': return '[STOP]';
      case 'rolled_back': return '[UNDO]';
    }
  }

  static formatDuration(start: number, end?: number): string {
    const ms = (end || Date.now()) - start;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m${secs}s`;
  }

  static formatArgs(args: Record<string, unknown>): string {
    if (typeof args.command === 'string') {
      return RunTracker.truncate(args.command, 80);
    }
    if (typeof args.path === 'string') {
      return args.path;
    }
    const keys = Object.keys(args);
    if (keys.length === 0) return '';
    return RunTracker.truncate(JSON.stringify(args), 80);
  }

  static truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 3) + '...';
  }

  private ensureDir(): void {
    if (!existsSync(this.runsDir)) {
      mkdirSync(this.runsDir, { recursive: true });
    }
  }

  private saveRun(run: RunRecord): void {
    try {
      const filePath = join(this.runsDir, `${run.id}.json`);
      writeFileSync(filePath, JSON.stringify(run, null, 2));
    } catch {
      // Silently fail
    }
  }

  private loadAll(): void {
    try {
      if (!existsSync(this.runsDir)) return;
      const files = readdirSync(this.runsDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(readFileSync(join(this.runsDir, file), 'utf-8'));
          this.runs.set(data.id, data);
        } catch {
          // Skip malformed files
        }
      }
    } catch {
      // Ignore
    }
  }

  private pruneOldRuns(): void {
    if (this.runs.size <= MAX_RUNS) return;

    const sorted = Array.from(this.runs.entries())
      .sort((a, b) => b[1].startedAt - a[1].startedAt);

    const toRemove = sorted.slice(MAX_RUNS);
    for (const [id] of toRemove) {
      this.runs.delete(id);
      try {
        const filePath = join(this.runsDir, `${id}.json`);
        if (existsSync(filePath)) {
          unlinkSync(filePath);
        }
      } catch {
        // Ignore
      }
    }
  }
}
