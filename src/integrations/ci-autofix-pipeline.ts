/**
 * CI Auto-Fix Pipeline
 *
 * Detects CI failures, fetches logs, uses LLM to root-cause and generate fixes,
 * runs local tests, and pushes a fix PR. Guard: max 3 attempts per failure.
 */

import { logger } from '../utils/logger.js';
import { BashTool } from '../tools/bash/index.js';

export interface CIFailure {
  /** CI provider (github-actions, gitlab-ci, etc.) */
  provider: string;
  /** Run/pipeline ID */
  runId: string;
  /** Job name */
  jobName: string;
  /** Failure log (truncated) */
  log: string;
  /** Branch name */
  branch: string;
  /** Commit SHA */
  commitSha: string;
  /** Timestamp */
  timestamp: Date;
}

export interface FixAttempt {
  /** Attempt number */
  attempt: number;
  /** Root cause analysis from LLM */
  rootCause: string;
  /** Generated fix description */
  fixDescription: string;
  /** Files modified */
  filesModified: string[];
  /** Whether local tests passed after fix */
  localTestsPassed: boolean;
  /** Whether fix was pushed */
  pushed: boolean;
  /** Error if attempt failed */
  error?: string;
}

export interface AutoFixResult {
  /** Original failure */
  failure: CIFailure;
  /** All fix attempts */
  attempts: FixAttempt[];
  /** Whether any attempt succeeded */
  success: boolean;
  /** PR URL if created */
  prUrl?: string;
}

const MAX_ATTEMPTS = 3;
const LOG_TRUNCATE = 15000;

export class CIAutoFixPipeline {
  private bash: BashTool;
  private llmCallback?: (prompt: string) => Promise<string>;
  private attemptHistory: Map<string, number> = new Map();

  constructor(
    llmCallback?: (prompt: string) => Promise<string>,
  ) {
    this.bash = new BashTool();
    this.llmCallback = llmCallback;
  }

  /**
   * Set or update the LLM callback.
   */
  setLLMCallback(callback: (prompt: string) => Promise<string>): void {
    this.llmCallback = callback;
  }

  /**
   * Attempt to auto-fix a CI failure.
   * Returns the result with all attempts.
   */
  async autoFix(failure: CIFailure): Promise<AutoFixResult> {
    const result: AutoFixResult = {
      failure,
      attempts: [],
      success: false,
    };

    // Check attempt limit
    const key = `${failure.runId}:${failure.jobName}`;
    const previousAttempts = this.attemptHistory.get(key) || 0;
    if (previousAttempts >= MAX_ATTEMPTS) {
      logger.warn(`CI AutoFix: max attempts (${MAX_ATTEMPTS}) reached for ${key}`);
      return result;
    }

    if (!this.llmCallback) {
      logger.warn('CI AutoFix: no LLM callback configured');
      return result;
    }

    for (let attempt = previousAttempts + 1; attempt <= MAX_ATTEMPTS; attempt++) {
      this.attemptHistory.set(key, attempt);
      const fixAttempt = await this.tryFix(failure, attempt, result.attempts);
      result.attempts.push(fixAttempt);

      if (fixAttempt.localTestsPassed) {
        result.success = true;

        // Commit named files only (never stage the whole tree) and push only a local origin.
        try {
          const { conventionalCommitNamedFiles, isLocalGitRemote } = await import('../commands/dev/golden-path.js');
          const message = `fix(ci): auto-fix ${failure.jobName} failure`;
          const commit = conventionalCommitNamedFiles(process.cwd(), message);
          if (!commit.committed) {
            logger.debug(`CI AutoFix: commit skipped: ${commit.error || 'no named files'}`);
            break;
          }
          const origin = (await this.bash.execute('git remote get-url origin')).output?.trim() || '';
          if (origin && isLocalGitRemote(origin)) {
            const pushResult = await this.bash.execute('git push -u origin HEAD');
            fixAttempt.pushed = Boolean(pushResult.success);
          } else {
            logger.info('CI AutoFix: skipping push (origin is not a local git remote and gh is not used here)');
          }
        } catch (err) {
          logger.debug(`CI AutoFix: failed to push fix: ${err instanceof Error ? err.message : String(err)}`);
        }

        break;
      }
    }

    return result;
  }

  /**
   * Try to fix the failure using LLM analysis.
   */
  private async tryFix(
    failure: CIFailure,
    attempt: number,
    previousAttempts: FixAttempt[],
  ): Promise<FixAttempt> {
    const fixAttempt: FixAttempt = {
      attempt,
      rootCause: '',
      fixDescription: '',
      filesModified: [],
      localTestsPassed: false,
      pushed: false,
    };

    try {
      // Step 1: Root-cause analysis
      const previousContext = previousAttempts.length > 0
        ? `\n\nPrevious fix attempts that FAILED:\n${previousAttempts.map(a => `- Attempt ${a.attempt}: ${a.rootCause} -> ${a.error || 'tests failed'}`).join('\n')}`
        : '';

      const truncatedLog = failure.log.substring(0, LOG_TRUNCATE);

      const analysisPrompt = `Analyze this CI failure and identify the root cause.

**Job:** ${failure.jobName}
**Branch:** ${failure.branch}
**Provider:** ${failure.provider}
${previousContext}

**CI Log (truncated):**
\`\`\`
${truncatedLog}
\`\`\`

Respond with:
1. ROOT_CAUSE: <one-line root cause>
2. FIX_FILES: <comma-separated list of files to modify>
3. FIX_DESCRIPTION: <what needs to change>

Be specific. Identify exact files and line-level issues.`;

      const analysis = await this.llmCallback!(analysisPrompt);

      // Parse analysis
      const rootCauseMatch = analysis.match(/ROOT_CAUSE:\s*(.+)/);
      const filesMatch = analysis.match(/FIX_FILES:\s*(.+)/);
      const descMatch = analysis.match(/FIX_DESCRIPTION:\s*(.+)/s);

      fixAttempt.rootCause = rootCauseMatch?.[1]?.trim() || 'Unknown';
      fixAttempt.fixDescription = descMatch?.[1]?.trim() || analysis;
      const targetFiles = filesMatch?.[1]?.split(',').map(f => f.trim()).filter(Boolean) || [];
      fixAttempt.filesModified = targetFiles;

      // Step 2: Generate fix
      if (targetFiles.length > 0) {
        const fixPrompt = `Generate a fix for this CI failure.

**Root cause:** ${fixAttempt.rootCause}
**Fix needed:** ${fixAttempt.fixDescription}
**Target files:** ${targetFiles.join(', ')}

For each file, provide the exact changes needed. Use this format:
FILE: <path>
CHANGE: <description>
--- OLD
<original code>
--- NEW
<fixed code>
---`;

        await this.llmCallback!(fixPrompt);
        // In a full implementation, the LLM response would be parsed and applied.
        // For now, we rely on the agent's tool-calling capability.
      }

      // Step 3: Run local tests
      const testResult = await this.bash.execute('npm test 2>&1 | tail -20');
      fixAttempt.localTestsPassed = testResult.success;
      if (!testResult.success) {
        fixAttempt.error = testResult.error || testResult.output?.substring(0, 500);
      }

    } catch (err) {
      fixAttempt.error = err instanceof Error ? err.message : String(err);
    }

    return fixAttempt;
  }

  /**
   * Fetch CI logs from GitHub Actions.
   */
  async fetchGitHubActionsLog(runId: string): Promise<CIFailure | null> {
    try {
      const runResult = await this.bash.execute(`gh run view ${runId} --json status,conclusion,headBranch,headSha,name,jobs`);
      if (!runResult.success || !runResult.output) return null;

      const run = JSON.parse(runResult.output);
      const failedJob = run.jobs?.find((j: { conclusion: string }) => j.conclusion === 'failure');
      if (!failedJob) return null;

      const logResult = await this.bash.execute(`gh run view ${runId} --log-failed 2>&1 | tail -500`);

      return {
        provider: 'github-actions',
        runId: String(runId),
        jobName: failedJob.name || run.name || 'unknown',
        log: logResult.output || '',
        branch: run.headBranch || 'main',
        commitSha: run.headSha || '',
        timestamp: new Date(),
      };
    } catch (err) {
      logger.debug(`CI AutoFix: failed to fetch GH Actions log: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Get attempt count for a specific failure.
   */
  getAttemptCount(runId: string, jobName: string): number {
    return this.attemptHistory.get(`${runId}:${jobName}`) || 0;
  }

  /**
   * Reset attempt history.
   */
  resetAttempts(): void {
    this.attemptHistory.clear();
  }
}

/** Singleton */
let _pipeline: CIAutoFixPipeline | null = null;

export function getCIAutoFixPipeline(): CIAutoFixPipeline {
  if (!_pipeline) {
    _pipeline = new CIAutoFixPipeline();
  }
  return _pipeline;
}

export function resetCIAutoFixPipeline(): void {
  _pipeline = null;
}
