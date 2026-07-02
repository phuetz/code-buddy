/**
 * Dev Workflows — 4 golden-path workflows for buddy dev.
 *
 * Each workflow:
 *   1. Injects repoProfile.contextPack into the agent system prompt
 *   2. Forces plan-first (shows plan, waits for confirmation in interactive mode)
 *   3. Activates WritePolicy.strict → all modifications go through ApplyPatch
 *   4. Records every tool call in RunStore
 *   5. Runs tests/lint after modifications
 *   6. Generates summary.md artefact
 */

import readline from 'readline';
import { RunStore } from '../../observability/run-store.js';
import { WritePolicy } from '../../security/write-policy.js';
import { getRepoProfiler, RepoProfile } from '../../agent/repo-profiler.js';
import type { CodeBuddyAgent } from '../../agent/codebuddy-agent.js';

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

export type WorkflowType = 'add-feature' | 'fix-tests' | 'refactor' | 'security-audit';

export interface WorkflowOptions {
  /** Skip interactive confirmation step (for CI / programmatic use) */
  nonInteractive?: boolean;
  /** Override write policy mode (default: strict) */
  writePolicyMode?: 'strict' | 'confirm' | 'off';
  /** Extra tags for run metadata */
  tags?: string[];
  /** How many times to feed a red test suite back to the agent and re-run (default: 1). 0 disables the fix loop. */
  maxFixRounds?: number;
}

export interface WorkflowResult {
  runId: string;
  status: 'completed' | 'failed' | 'cancelled';
  artifactPaths: string[];
  summary?: string;
}

// ──────────────────────────────────────────────────────────────────
// Workflow system prompts
// ──────────────────────────────────────────────────────────────────

const WORKFLOW_PROMPTS: Record<WorkflowType, string> = {
  'add-feature': `You are implementing a new feature. Follow this strict sequence:
1. PLAN: Output a numbered plan listing each file to create/modify and why.
2. Wait for confirmation before proceeding.
3. IMPLEMENT: Apply changes as unified diffs via apply_patch tool.
4. TEST: Run the test suite and report results.
5. SUMMARIZE: Output a brief summary of what was done and any next steps.
Always use apply_patch for file modifications. Never write files directly.`,

  'fix-tests': `You are fixing failing tests. Follow this strict sequence:
1. DIAGNOSE: Run the test suite, identify failing tests and root causes.
2. PLAN: List the fixes needed (files + what to change).
3. Wait for confirmation before proceeding.
4. FIX: Apply changes as unified diffs via apply_patch tool.
5. VERIFY: Re-run tests to confirm they pass.
6. SUMMARIZE: Report which tests now pass and any remaining issues.
Always use apply_patch for file modifications. Never write files directly.`,

  'refactor': `You are refactoring existing code. Follow this strict sequence:
1. ANALYZE: Identify the code to refactor and what improvements to make.
2. PLAN: List every file/function to change and the refactoring steps.
3. Wait for confirmation before proceeding.
4. REFACTOR: Apply changes as unified diffs via apply_patch tool.
5. TEST: Run tests to confirm no regressions.
6. SUMMARIZE: Describe what was improved and any follow-up work.
Always use apply_patch for file modifications. Never write files directly.`,

  'security-audit': `You are performing a security audit. Follow this strict sequence:
1. SCAN: Review code for security vulnerabilities (injection, XSS, auth, secrets).
2. REPORT: List all findings with severity (Critical/High/Medium/Low) and file locations.
3. PLAN: Prioritize fixes starting with Critical issues.
4. Wait for confirmation before proceeding.
5. FIX: Apply patches for Critical/High issues via apply_patch tool.
6. VERIFY: Re-scan patched files to confirm issues are resolved.
7. SUMMARIZE: Full audit report with findings, fixes applied, and remaining risks.
Always use apply_patch for file modifications. Never write files directly.`,
};

// ──────────────────────────────────────────────────────────────────
// Plan-first confirmation
// ──────────────────────────────────────────────────────────────────

async function waitForConfirmation(prompt: string, nonInteractive: boolean): Promise<boolean> {
  if (nonInteractive) return true;

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${prompt} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

// ──────────────────────────────────────────────────────────────────
// Test runner helper
// ──────────────────────────────────────────────────────────────────

async function runTests(profile: RepoProfile): Promise<string> {
  const testCmd = profile.commands.test;
  if (!testCmd) return 'No test command configured.';

  const { execSync } = await import('child_process');
  try {
    const output = execSync(testCmd, {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 120_000,
    });
    return `Tests passed.\n${output.slice(0, 2000)}`;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    const out = (e.stdout || '') + (e.stderr || '');
    return `Tests failed.\n${out.slice(0, 2000)}`;
  }
}

/**
 * A test run counts as "green" if it passed or if there is no test command to
 * run. Anything else (a `Tests failed.` string from runTests) is a failure the
 * workflow must NOT report as completed.
 */
function testsGreen(results: string): boolean {
  return results.startsWith('Tests passed') || results.startsWith('No test command');
}

// ──────────────────────────────────────────────────────────────────
// Main workflow runner
// ──────────────────────────────────────────────────────────────────

/**
 * Run a golden-path workflow with plan-first, diff-first, and full observability.
 */
export async function runWorkflow(
  type: WorkflowType,
  objective: string,
  agent: CodeBuddyAgent,
  options: WorkflowOptions = {}
): Promise<WorkflowResult> {
  const { nonInteractive = false, writePolicyMode = 'strict', tags = [] } = options;

  // ── Setup ─────────────────────────────────────────────────────
  const runStore = RunStore.getInstance();
  const profiler = getRepoProfiler();
  const profile = await profiler.getProfile();

  // Start a run for observability
  const runId = runStore.startRun(objective, {
    tags: [type, ...tags],
  });

  // Enable WritePolicy (strict by default in workflows)
  const writePolicy = WritePolicy.getInstance();
  const previousMode = writePolicy.getMode();
  writePolicy.setMode(writePolicyMode);

  // Link agent tool calls to this run
  agent.setRunId(runId);

  const artifactPaths: string[] = [];

  try {
    // ── Step 1: Plan ────────────────────────────────────────────
    runStore.emit(runId, { type: 'step_start', data: { step: 'plan', objective } });

    const workflowPrompt = WORKFLOW_PROMPTS[type];
    const planPrompt = `${workflowPrompt}

Repo context: ${profile.contextPack}

Objective: ${objective}

Start with PLAN only. List exactly what you will do.`;

    console.log(`\n[${type}] Planning: ${objective}`);
    console.log('─'.repeat(60));

    let planOutput = '';
    for await (const chunk of agent.processUserMessageStream(planPrompt)) {
      if (chunk.type === 'content' && chunk.content) {
        process.stdout.write(chunk.content);
        planOutput += chunk.content;
      }
    }

    runStore.emit(runId, { type: 'step_end', data: { step: 'plan', outputLength: planOutput.length } });

    // Save plan artifact
    const planPath = runStore.saveArtifact(runId, 'plan.md', `# Plan\n\nObjective: ${objective}\n\n${planOutput}`);
    artifactPaths.push(planPath);

    // ── Step 2: Confirmation ─────────────────────────────────────
    console.log('\n' + '─'.repeat(60));
    const confirmed = await waitForConfirmation(
      '\nProceed with implementation?',
      nonInteractive
    );

    if (!confirmed) {
      runStore.emit(runId, { type: 'decision', data: { description: 'User cancelled at plan review' } });
      runStore.endRun(runId, 'cancelled');
      writePolicy.setMode(previousMode);
      agent.setRunId(undefined);
      return { runId, status: 'cancelled', artifactPaths };
    }

    runStore.emit(runId, { type: 'decision', data: { description: 'Plan confirmed, proceeding with implementation' } });

    // ── Step 3: Implement ────────────────────────────────────────
    runStore.emit(runId, { type: 'step_start', data: { step: 'implement' } });
    console.log('\n[Implementing…]');

    const implementPrompt = `Now proceed with the implementation. Apply all changes using apply_patch with unified diffs.`;

    let patchOutput = '';
    for await (const chunk of agent.processUserMessageStream(implementPrompt)) {
      if (chunk.type === 'content' && chunk.content) {
        process.stdout.write(chunk.content);
        patchOutput += chunk.content;
      }
    }

    runStore.emit(runId, { type: 'step_end', data: { step: 'implement' } });

    // Extract and save patch artifact if any diff markers found
    if (patchOutput.includes('---') && patchOutput.includes('+++')) {
      const diffMatch = patchOutput.match(/^(---.*?\+\+\+.*?^@@.*?)(?=\n---|$)/ms);
      const diffContent = diffMatch ? diffMatch[0] : patchOutput;
      const patchPath = runStore.saveArtifact(runId, 'patch.diff', diffContent);
      artifactPaths.push(patchPath);
    }

    // ── Step 4: Test (with a bounded fix loop) ───────────────────
    runStore.emit(runId, { type: 'step_start', data: { step: 'test' } });
    console.log('\n[Running tests…]');

    let testResults = await runTests(profile);
    console.log(testResults.slice(0, 500));

    // If the suite is red, feed the failure back to the agent for a bounded
    // number of fix rounds and re-run. Previously the workflow ran tests once
    // and reported 'completed' unconditionally — a red suite was silently
    // reported as success (runTests swallows failure and never throws). This
    // makes the "VERIFY: re-run tests to confirm they pass" the prompts promise
    // actually happen. `No test command` is not treated as a failure.
    const maxFixRounds = Math.max(0, options.maxFixRounds ?? 1);
    let fixRound = 0;
    while (!testsGreen(testResults) && fixRound < maxFixRounds) {
      fixRound++;
      runStore.emit(runId, { type: 'decision', data: { description: `Tests failing — fix round ${fixRound}/${maxFixRounds}` } });
      console.log(`\n[Tests failing — attempting fix ${fixRound}/${maxFixRounds}…]`);

      const fixPrompt = `The test suite is FAILING. Here is the output:\n\n${testResults.slice(0, 2000)}\n\nDiagnose the root cause and apply a fix using apply_patch with unified diffs. Then stop — the suite will be re-run automatically to verify.`;
      for await (const chunk of agent.processUserMessageStream(fixPrompt)) {
        if (chunk.type === 'content' && chunk.content) {
          process.stdout.write(chunk.content);
        }
      }

      testResults = await runTests(profile);
      console.log(testResults.slice(0, 500));
    }

    const testsPassed = testsGreen(testResults);
    const testLogPath = runStore.saveArtifact(runId, 'test-results.log', testResults);
    artifactPaths.push(testLogPath);
    runStore.emit(runId, { type: 'step_end', data: { step: 'test', passed: testsPassed } });

    // ── Step 5: Summary ──────────────────────────────────────────
    runStore.emit(runId, { type: 'step_start', data: { step: 'summary' } });

    const summaryPrompt = `Generate a brief summary of what was accomplished:
- What changed (files modified/created)
- Test results
- Any next steps or known issues
Keep it under 300 words.`;

    let summaryOutput = '';
    for await (const chunk of agent.processUserMessageStream(summaryPrompt)) {
      if (chunk.type === 'content' && chunk.content) {
        process.stdout.write(chunk.content);
        summaryOutput += chunk.content;
      }
    }

    const summaryContent = `# Summary\n\nObjective: ${objective}\nWorkflow: ${type}\nRun: ${runId}\n\n## Test Results\n\n${testResults.slice(0, 500)}\n\n## Changes\n\n${summaryOutput}`;
    const summaryPath = runStore.saveArtifact(runId, 'summary.md', summaryContent);
    artifactPaths.push(summaryPath);
    runStore.emit(runId, { type: 'step_end', data: { step: 'summary' } });

    // Fail closed on a red suite: the workflow only reports 'completed' when the
    // tests are actually green (or there are none to run).
    const finalStatus: WorkflowResult['status'] = testsPassed ? 'completed' : 'failed';
    runStore.endRun(runId, finalStatus);
    writePolicy.setMode(previousMode);
    agent.setRunId(undefined);

    return {
      runId,
      status: finalStatus,
      artifactPaths,
      summary: summaryOutput,
    };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    runStore.emit(runId, { type: 'error', data: { message } });
    runStore.endRun(runId, 'failed');
    writePolicy.setMode(previousMode);
    agent.setRunId(undefined);

    return { runId, status: 'failed', artifactPaths };
  }
}
