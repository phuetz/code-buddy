/**
 * Issue-to-PR Pipeline
 *
 * Automates the workflow: GitHub issue → branch → plan → implement → test → PR.
 *
 * Usage:
 *   buddy dev issue <url-or-number> [--yes] [--write-policy <mode>]
 */

import type { CodeBuddyAgent } from '../../agent/codebuddy-agent.js';
import { logger } from '../../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────

export interface IssuePipelineOptions {
  /** Skip confirmation prompts */
  nonInteractive?: boolean;
  /** Write policy mode */
  writePolicyMode?: 'strict' | 'confirm' | 'off';
}

export interface IssueInfo {
  number: number;
  title: string;
  body: string;
  labels: string[];
  url: string;
}

export interface IssuePipelineResult {
  issueNumber: number;
  branch: string;
  runId: string;
  status: 'completed' | 'failed' | 'skipped';
  prUrl?: string;
  error?: string;
}

// ── Label-to-Workflow Mapping ──────────────────────────────────────

type WorkflowType = 'add-feature' | 'fix-tests' | 'refactor' | 'security-audit';

const LABEL_WORKFLOW_MAP: Record<string, WorkflowType> = {
  bug: 'fix-tests',
  fix: 'fix-tests',
  hotfix: 'fix-tests',
  security: 'security-audit',
  vulnerability: 'security-audit',
  refactor: 'refactor',
  cleanup: 'refactor',
  'tech-debt': 'refactor',
  feature: 'add-feature',
  enhancement: 'add-feature',
};

// ── Main Pipeline ──────────────────────────────────────────────────

/**
 * Run the full issue-to-PR pipeline.
 *
 * 1. Fetch issue from GitHub via `gh`
 * 2. Create feature branch
 * 3. Map labels to workflow type
 * 4. Run the workflow (plan → code → test)
 * 5. Create PR with `Closes #<number>`
 */
export async function runIssuePipeline(
  issueRef: string,
  agent: CodeBuddyAgent,
  options: IssuePipelineOptions = {},
): Promise<IssuePipelineResult> {
  const { execSync } = await import('child_process');

  // ── Step 1: Fetch issue ──────────────────────────────────────
  const issue = await fetchIssue(issueRef, execSync);
  logger.info(`Issue #${issue.number}: ${issue.title}`);
  console.log(`\nIssue #${issue.number}: ${issue.title}`);
  console.log(`Labels: ${issue.labels.join(', ') || 'none'}\n`);

  // ── Step 2: Create branch ────────────────────────────────────
  const slug = slugify(issue.title);
  const branch = `feat/${issue.number}-${slug}`;

  try {
    execSync(`git checkout -b ${branch}`, { stdio: 'pipe' });
    console.log(`Created branch: ${branch}`);
  } catch {
    // Branch might already exist
    try {
      execSync(`git checkout ${branch}`, { stdio: 'pipe' });
      console.log(`Switched to existing branch: ${branch}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        issueNumber: issue.number,
        branch,
        runId: '',
        status: 'failed',
        error: `Failed to create/switch branch: ${msg}`,
      };
    }
  }

  // ── Step 3: Map labels to workflow type ───────────────────────
  const workflowType = mapLabelsToWorkflow(issue.labels);
  console.log(`Workflow type: ${workflowType}`);

  // ── Step 4: Run workflow ─────────────────────────────────────
  const { runWorkflow } = await import('./workflows.js');

  const objective = `Resolve GitHub issue #${issue.number}: ${issue.title}\n\n${issue.body}`;

  let result;
  try {
    result = await runWorkflow(workflowType, objective, agent, {
      nonInteractive: options.nonInteractive,
      writePolicyMode: options.writePolicyMode || 'strict',
      tags: ['issue', `issue-${issue.number}`],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      issueNumber: issue.number,
      branch,
      runId: '',
      status: 'failed',
      error: `Workflow failed: ${msg}`,
    };
  }

  if (result.status !== 'completed') {
    return {
      issueNumber: issue.number,
      branch,
      runId: result.runId,
      status: 'failed',
      error: `Workflow finished with status: ${result.status}`,
    };
  }

  // ── Step 5: Create PR ────────────────────────────────────────
  let prUrl: string | undefined;

  try {
    // Stage and commit changes
    execSync('git add -A', { stdio: 'pipe' });

    const commitMsg = `feat: resolve #${issue.number} — ${issue.title}`;
    execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });

    // Push branch
    execSync(`git push -u origin ${branch}`, { stdio: 'pipe' });

    // Create PR
    const prBody = [
      `## Summary`,
      ``,
      `Resolves #${issue.number}.`,
      ``,
      `### Changes`,
      `- Automated implementation via \`buddy dev issue\``,
      `- Workflow type: ${workflowType}`,
      ``,
      `Closes #${issue.number}`,
    ].join('\n');

    const prTitle = `feat: ${issue.title}`.slice(0, 70);
    const prOutput = execSync(
      `gh pr create --title "${prTitle.replace(/"/g, '\\"')}" --body "${prBody.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    prUrl = prOutput;
    console.log(`\nPR created: ${prUrl}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`PR creation failed: ${msg}`);
    console.error(`\nWarning: PR creation failed: ${msg}`);
    console.log('Changes are committed on branch:', branch);
  }

  return {
    issueNumber: issue.number,
    branch,
    runId: result.runId,
    status: 'completed',
    prUrl,
  };
}

// ── Helpers ────────────────────────────────────────────────────────

type ExecSyncFn = (cmd: string, opts?: object) => string | Buffer;

async function fetchIssue(
  issueRef: string,
  execSync: ExecSyncFn,
): Promise<IssueInfo> {
  // Extract issue number from URL or use as-is
  const numMatch = issueRef.match(/(\d+)\s*$/);
  if (!numMatch) {
    throw new Error(`Cannot parse issue reference: ${issueRef}`);
  }
  const issueNumber = parseInt(numMatch[1], 10);

  try {
    const output = execSync(
      `gh issue view ${issueNumber} --json number,title,body,labels`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );

    const data = JSON.parse(typeof output === 'string' ? output : output.toString());
    return {
      number: data.number,
      title: data.title || `Issue #${issueNumber}`,
      body: data.body || '',
      labels: (data.labels || []).map((l: { name: string }) => l.name),
      url: issueRef,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch issue #${issueNumber}: ${msg}`);
  }
}

function mapLabelsToWorkflow(labels: string[]): WorkflowType {
  for (const label of labels) {
    const normalized = label.toLowerCase().trim();
    if (LABEL_WORKFLOW_MAP[normalized]) {
      return LABEL_WORKFLOW_MAP[normalized];
    }
  }
  return 'add-feature';
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}
