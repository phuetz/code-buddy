/**
 * /dev Slash Command Handler
 *
 * Exposes the golden-path developer workflows (buddy dev plan|run|pr|fix-ci)
 * as an interactive slash command within a session.
 *
 * Subcommands:
 *   /dev plan <objective>  — create a development plan from requirements
 *   /dev run <objective>   — execute the current plan autonomously
 *   /dev pr <objective>    — create a PR from changes
 *   /dev fix-ci            — analyze and fix CI failures
 *   /dev status            — show current dev workflow status
 */

import { CommandHandlerResult } from './branch-handlers.js';
import { logger } from '../../utils/logger.js';
import { failureFlag } from '../slash-failure.js';

/**
 * Handle the /dev slash command.
 */
export async function handleDev(args: string[]): Promise<CommandHandlerResult> {
  const subcommand = args[0]?.toLowerCase() || 'status';
  const rest = args.slice(1).join(' ').trim();

  switch (subcommand) {
    case 'plan':
      return handleDevPlan(rest);
    case 'run':
      return handleDevRun(rest);
    case 'pr':
      return handleDevPR(rest);
    case 'fix-ci':
    case 'fixci':
    case 'fix':
      return handleDevFixCI(rest);
    case 'status':
      return handleDevStatus();
    case 'help':
    default:
      return {
        handled: true,
...failureFlag(`/dev — Golden-path developer workflows

Usage:
  /dev plan <objective>   Create a development plan from requirements
  /dev run <objective>    Execute a plan autonomously (plan + implement + test)
  /dev pr <objective>     Run workflow then create a PR
  /dev fix-ci             Analyze and fix CI failures
  /dev status             Show current dev workflow status

Examples:
  /dev plan add user authentication with JWT
  /dev run implement retry logic for API calls
  /dev pr refactor database connection pooling
  /dev fix-ci`),
        entry: {
          type: 'assistant',
          content: `/dev — Golden-path developer workflows

Usage:
  /dev plan <objective>   Create a development plan from requirements
  /dev run <objective>    Execute a plan autonomously (plan + implement + test)
  /dev pr <objective>     Run workflow then create a PR
  /dev fix-ci             Analyze and fix CI failures
  /dev status             Show current dev workflow status

Examples:
  /dev plan add user authentication with JWT
  /dev run implement retry logic for API calls
  /dev pr refactor database connection pooling
  /dev fix-ci`,
          timestamp: new Date(),
        },
      };
  }
}

async function handleDevPlan(objective: string): Promise<CommandHandlerResult> {
  if (!objective) {
    return {
      handled: true,
...failureFlag('Usage: /dev plan <objective>\n\nExample: /dev plan add user authentication with JWT'),
      entry: {
        type: 'assistant',
        content: 'Usage: /dev plan <objective>\n\nExample: /dev plan add user authentication with JWT',
        timestamp: new Date(),
      },
    };
  }

  // Return as passToAI so the agent executes it
  return {
    handled: true,
...failureFlag(`Planning: ${objective}...`),
    passToAI: true,
    prompt: `[DEV WORKFLOW: PLAN]

Objective: ${objective}

You are executing a development planning workflow. Follow these steps:

1. Analyze the current repository structure using tools (list_directory, view_file, search)
2. Understand the existing codebase patterns and conventions
3. Create a detailed numbered implementation plan using the plan tool
4. For each step list:
   - What file(s) to create or modify
   - What change to make and why
   - Any dependencies between steps
   - Estimated complexity

Do NOT implement yet. Plan only. Create a PLAN.md file with the plan.`,
    entry: {
      type: 'assistant',
      content: `Planning: ${objective}...`,
      timestamp: new Date(),
    },
  };
}

async function handleDevRun(objective: string): Promise<CommandHandlerResult> {
  if (!objective) {
    return {
      handled: true,
...failureFlag('Usage: /dev run <objective>\n\nExample: /dev run implement retry logic for API calls'),
      entry: {
        type: 'assistant',
        content: 'Usage: /dev run <objective>\n\nExample: /dev run implement retry logic for API calls',
        timestamp: new Date(),
      },
    };
  }

  return {
    handled: true,
...failureFlag(`Executing dev workflow: ${objective}...`),
    passToAI: true,
    prompt: `[DEV WORKFLOW: RUN]

Objective: ${objective}

You are executing a full development workflow autonomously. Follow the CodeAct pattern:

1. PLAN: Create a detailed plan (use plan tool to create PLAN.md with checkboxes)
2. THINK: Analyze the codebase to understand patterns and conventions
3. CODE: Implement each step from the plan:
   - Read existing files before modifying
   - Follow existing coding conventions
   - Mark plan items as [/] in-progress, then [x] when done
4. TEST: Run existing tests to verify nothing broke (bash: npm test or equivalent)
5. OBSERVE: Check for errors, fix any issues
6. UPDATE: Update the plan with final status

Work autonomously through all steps. If tests fail, fix and re-test.`,
    entry: {
      type: 'assistant',
      content: `Executing dev workflow: ${objective}...`,
      timestamp: new Date(),
    },
  };
}

async function handleDevPR(objective: string): Promise<CommandHandlerResult> {
  if (!objective) {
    return {
      handled: true,
...failureFlag('Usage: /dev pr <objective>\n\nExample: /dev pr refactor database connection pooling'),
      entry: {
        type: 'assistant',
        content: 'Usage: /dev pr <objective>\n\nExample: /dev pr refactor database connection pooling',
        timestamp: new Date(),
      },
    };
  }

  return {
    handled: true,
...failureFlag(`Dev workflow with PR: ${objective}...`),
    passToAI: true,
    prompt: `[DEV WORKFLOW: PR]

Objective: ${objective}

You are executing a full development workflow that ends with a PR. Steps:

1. PLAN: Create a plan for the objective
2. IMPLEMENT: Execute the plan (create/modify files, run tests)
3. COMMIT: Stage and commit changes with a conventional commit message
4. PR: Generate a PR description with:
   - Title (max 70 chars)
   - Summary (bullet points of changes)
   - Test plan (what to verify)

Use bash to run: git status, git add, git commit, and then create the PR.`,
    entry: {
      type: 'assistant',
      content: `Dev workflow with PR: ${objective}...`,
      timestamp: new Date(),
    },
  };
}

async function handleDevFixCI(_args: string): Promise<CommandHandlerResult> {
  return {
    handled: true,
...failureFlag('Analyzing and fixing CI failures...'),
    passToAI: true,
    prompt: `[DEV WORKFLOW: FIX-CI]

You are diagnosing and fixing CI/test failures. Steps:

1. Check recent test output: run the test suite (bash: npm test, or check CI logs)
2. Read any failing test files and the source code they test
3. Identify root causes of failures
4. Fix each issue:
   - Read the failing file
   - Understand the expected behavior
   - Apply the fix
5. Re-run tests to verify the fix
6. If tests still fail, iterate

Be systematic: fix one issue at a time, verify, then move to the next.`,
    entry: {
      type: 'assistant',
      content: 'Analyzing and fixing CI failures...',
      timestamp: new Date(),
    },
  };
}

async function handleDevStatus(): Promise<CommandHandlerResult> {
  let status = '/dev workflow status:\n\n';

  // Check for PLAN.md
  try {
    const fs = await import('fs');
    const path = await import('path');
    const planPath = path.join(process.cwd(), 'PLAN.md');

    if (fs.existsSync(planPath)) {
      const content = fs.readFileSync(planPath, 'utf-8');
      const lines = content.split('\n');
      const total = lines.filter(l => /^\s*-\s*\[/.test(l)).length;
      const done = lines.filter(l => /^\s*-\s*\[x\]/.test(l)).length;
      const inProgress = lines.filter(l => /^\s*-\s*\[\/\]/.test(l)).length;
      const pending = lines.filter(l => /^\s*-\s*\[ \]/.test(l)).length;
      const skipped = lines.filter(l => /^\s*-\s*\[-\]/.test(l)).length;

      status += `Plan: PLAN.md found\n`;
      status += `  Total steps: ${total}\n`;
      status += `  Done: ${done}, In-progress: ${inProgress}, Pending: ${pending}, Skipped: ${skipped}\n`;
      const progress = total > 0 ? Math.round((done / total) * 100) : 0;
      status += `  Progress: ${progress}%\n`;
    } else {
      status += 'Plan: No PLAN.md found. Use /dev plan <objective> to create one.\n';
    }
  } catch (error) {
    logger.debug('Failed to read PLAN.md', { error });
    status += 'Plan: Could not read PLAN.md\n';
  }

  // Check git status
  try {
    const { execSync } = await import('child_process');
    const gitStatus = execSync('git status --short', { encoding: 'utf-8', timeout: 5000 });
    const changedFiles = gitStatus.trim().split('\n').filter(Boolean).length;
    status += `\nGit: ${changedFiles} changed file(s)\n`;

    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', timeout: 5000 }).trim();
    status += `Branch: ${branch}\n`;
  } catch {
    status += '\nGit: Not a git repository or git not available\n';
  }

  return {
    handled: true,
...failureFlag(status.trim()),
    entry: {
      type: 'assistant',
      content: status.trim(),
      timestamp: new Date(),
    },
  };
}
