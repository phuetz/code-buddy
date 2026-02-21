/**
 * Run Commands
 *
 * Handles /runs and /run <id> commands, providing timeline views,
 * re-run, test re-run, and rollback functionality.
 * Channel-agnostic - returns structured data for formatters.
 */

import type { RunTracker } from './run-tracker.js';
import type { ScopedAuthManager } from './scoped-auth.js';
import type { RunRecord, RunStep } from './types.js';

/**
 * Handles run-related commands and callbacks.
 */
export class RunCommands {
  constructor(
    private runTracker: RunTracker,
    private authManager?: ScopedAuthManager
  ) {}

  /**
   * Handle /runs command - list recent runs (returns structured data)
   */
  handleRunsList(
    _chatId: string,
    _userId: string,
    limit: number = 10
  ): { runs: RunRecord[] } {
    const runs = this.runTracker.listRuns(limit);
    return { runs };
  }

  /**
   * Handle /run <id> command - show run detail (returns structured data)
   */
  handleRunDetail(
    _chatId: string,
    runId: string
  ): { run: RunRecord; testSteps: RunStep[]; commitRefs: string[] } | null {
    const run = this.findRun(runId);
    if (!run) return null;

    const testSteps = this.runTracker.getTestSteps(run.id);
    const commitRefs = this.runTracker.getCommitRefs(run.id);

    return { run, testSteps, commitRefs };
  }

  /**
   * Handle re-run request
   */
  async handleRerun(
    runId: string,
    userId: string,
    _chatId: string
  ): Promise<{ text: string; objective?: string }> {
    const run = this.findRun(runId);
    if (!run) {
      return { text: 'Run not found.' };
    }

    if (this.authManager) {
      const decision = this.authManager.checkScope(userId, 'run-tests');
      if (!decision.allowed) {
        return { text: `Permission denied: ${decision.reason}` };
      }
    }

    return {
      text: `Re-running: ${run.objective}`,
      objective: run.objective,
    };
  }

  /**
   * Handle re-run tests from a run
   */
  async handleRerunTests(
    runId: string,
    userId: string,
    _chatId: string
  ): Promise<{ text: string; commands?: string[] }> {
    const run = this.findRun(runId);
    if (!run) {
      return { text: 'Run not found.' };
    }

    if (this.authManager) {
      const decision = this.authManager.checkScope(userId, 'run-tests');
      if (!decision.allowed) {
        return { text: `Permission denied: ${decision.reason}` };
      }
    }

    const testSteps = this.runTracker.getTestSteps(run.id);
    if (testSteps.length === 0) {
      return { text: 'No test commands found in this run.' };
    }

    const commands = testSteps
      .map((s) => s.args.command as string)
      .filter(Boolean);

    return {
      text: `Re-running ${commands.length} test command(s)...`,
      commands,
    };
  }

  /**
   * Handle rollback request
   */
  async handleRollback(
    runId: string,
    userId: string,
    _chatId: string
  ): Promise<{ text: string; needsConfirm?: boolean; confirmId?: string; commitRef?: string }> {
    const run = this.findRun(runId);
    if (!run) {
      return { text: 'Run not found.' };
    }

    if (this.authManager) {
      const decision = this.authManager.checkScope(userId, 'deploy');
      if (!decision.allowed) {
        return { text: `Permission denied: requires 'deploy' scope. ${decision.reason || ''}` };
      }

      const confirm = this.authManager.requireDoubleConfirm(
        userId,
        'rollback',
        `Rollback run ${runId} to previous state`
      );

      return {
        text: `Rollback requires confirmation. Press confirm within 2 minutes.`,
        needsConfirm: true,
        confirmId: confirm.id,
        commitRef: this.runTracker.getCommitRefs(run.id)[0],
      };
    }

    const commits = this.runTracker.getCommitRefs(run.id);
    if (commits.length === 0) {
      return { text: 'No commit refs found for rollback.' };
    }

    return {
      text: `Ready to rollback to before ${commits[0]}`,
      commitRef: commits[0],
    };
  }

  /**
   * Find a run by full or partial ID
   */
  private findRun(idOrPartial: string): RunRecord | undefined {
    let run = this.runTracker.getRun(idOrPartial);
    if (run) return run;

    const runs = this.runTracker.listRuns(100);
    return runs.find(
      (r) => r.id.startsWith(idOrPartial) || r.id.includes(idOrPartial)
    );
  }
}
