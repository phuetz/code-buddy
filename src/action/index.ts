import { getProviderDefaultModel } from '../config/model-defaults.js';
/**
 * GitHub Action entry point for Code Buddy AI
 *
 * Supports three modes:
 *   review    — fetches the PR diff and posts inline review comments
 *   implement — runs Code Buddy headless to implement a task from a prompt
 *   triage    — summarises an issue and labels it
 *
 * @actions/core and @actions/github are loaded via dynamic import so that
 * the file is only required at runtime inside a GitHub Actions environment.
 * No hard dependency in package.json is needed.
 */

import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';

// ============================================================================
// Lightweight type stubs (avoids hard dep on @actions/* packages)
// ============================================================================

interface CoreLike {
  getInput(name: string): string;
  setOutput(name: string, value: string): void;
  setFailed(message: string): void;
  info(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

interface OctokitLike {
  rest: {
    pulls: {
      get(params: Record<string, unknown>): Promise<{ data: string }>;
      createReview(params: Record<string, unknown>): Promise<{ data: { id: number } }>;
    };
    issues: {
      addLabels(params: Record<string, unknown>): Promise<unknown>;
      createComment(params: Record<string, unknown>): Promise<unknown>;
    };
  };
}

interface GitHubContextLike {
  repo: { owner: string; repo: string };
  payload: {
    pull_request?: { number: number };
    issue?: { number: number; title?: string; body?: string };
  };
}

interface ReviewComment {
  file: string;
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Run Code Buddy in headless/non-interactive mode and return its stdout.
 * Shells out to `buddy` (must be on PATH in the action environment).
 */
function runBuddyHeadless(
  prompt: string,
  apiKey: string,
  model: string,
  maxTurns: number,
): string {
  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const cmd = [
    'buddy',
    '--print',
    `--api-key "${apiKey}"`,
    `--model "${model}"`,
    `--max-tool-rounds ${maxTurns}`,
    `--output-format json`,
    `'${escapedPrompt}'`,
  ].join(' ');

  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300_000,
    });
    return output.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`buddy headless run failed: ${msg}`);
  }
}

/**
 * Attempt to extract a JSON array from buddy output that may contain
 * leading prose or markdown fences.
 */
function extractJsonArray(raw: string): ReviewComment[] {
  // Try direct parse first
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ReviewComment[];
  } catch { /* fall through */ }

  // Try extracting from markdown code fences
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (Array.isArray(parsed)) return parsed as ReviewComment[];
    } catch { /* fall through */ }
  }

  // Try finding a bare JSON array in the text
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed as ReviewComment[];
    } catch { /* fall through */ }
  }

  return [];
}

// ============================================================================
// Mode handlers
// ============================================================================

async function reviewPR(
  core: CoreLike,
  octokit: OctokitLike,
  context: GitHubContextLike,
  apiKey: string,
  model: string,
  maxTurns: number,
): Promise<void> {
  const pr = context.payload.pull_request;
  if (!pr) {
    core.warning('review mode: no pull_request in payload, skipping');
    return;
  }

  core.info(`Fetching diff for PR #${pr.number}`);
  const { data: diff } = await octokit.rest.pulls.get({
    ...context.repo,
    pull_number: pr.number,
    mediaType: { format: 'diff' },
  });

  const customPrompt = core.getInput('custom_prompt');
  const prompt = [
    'Review this pull request diff.',
    'For each issue found, output a JSON array where every element has exactly these fields:',
    '  { "file": "<path>", "line": <number>, "severity": "error"|"warning"|"info", "message": "<text>" }',
    'Output ONLY the JSON array, no other text.',
    customPrompt ? `Additional instructions: ${customPrompt}` : '',
    '',
    'Diff:',
    diff,
  ]
    .filter(Boolean)
    .join('\n');

  core.info('Running Code Buddy review...');
  let rawOutput: string;
  try {
    rawOutput = runBuddyHeadless(prompt, apiKey, model, maxTurns);
  } catch (err) {
    core.error(`Headless run failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }

  const comments = extractJsonArray(rawOutput);
  core.info(`Parsed ${comments.length} review comment(s)`);

  if (comments.length === 0) {
    core.info('No issues found — posting approval review');
    await octokit.rest.pulls.createReview({
      ...context.repo,
      pull_number: pr.number,
      event: 'APPROVE',
      body: 'Code Buddy found no issues.',
    });
    core.setOutput('review_result', 'approved');
    return;
  }

  const reviewComments = comments
    .filter(c => c.file && c.line > 0 && c.message)
    .map(c => ({
      path: c.file,
      line: c.line,
      side: 'RIGHT' as const,
      body: `**[${c.severity.toUpperCase()}]** ${c.message}`,
    }));

  const hasErrors = comments.some(c => c.severity === 'error');

  await octokit.rest.pulls.createReview({
    ...context.repo,
    pull_number: pr.number,
    event: hasErrors ? 'REQUEST_CHANGES' : 'COMMENT',
    body: `Code Buddy found ${comments.length} issue(s).`,
    comments: reviewComments,
  });

  core.setOutput('review_result', hasErrors ? 'changes_requested' : 'commented');
  core.setOutput('comment_count', String(comments.length));
  core.info(`Review posted: ${hasErrors ? 'REQUEST_CHANGES' : 'COMMENT'}`);
}

async function implementTask(
  core: CoreLike,
  apiKey: string,
  model: string,
  maxTurns: number,
): Promise<void> {
  const customPrompt = core.getInput('custom_prompt');
  if (!customPrompt) {
    core.warning('implement mode requires custom_prompt to be set');
    return;
  }

  core.info('Running Code Buddy implementation task...');
  const output = runBuddyHeadless(customPrompt, apiKey, model, maxTurns);
  core.setOutput('implement_result', output.slice(0, 4096));
  core.info('Implementation complete');
}

async function triageIssue(
  core: CoreLike,
  octokit: OctokitLike,
  context: GitHubContextLike,
  apiKey: string,
  model: string,
): Promise<void> {
  const issue = context.payload.issue;
  if (!issue) {
    core.warning('triage mode: no issue in payload, skipping');
    return;
  }

  const customPrompt = core.getInput('custom_prompt');
  const prompt = [
    'Triage this GitHub issue.',
    'Reply with a JSON object with fields:',
    '  { "summary": "<one sentence>", "labels": ["<label>", ...], "priority": "low"|"medium"|"high"|"critical" }',
    'Only output the JSON object.',
    customPrompt ? `Additional instructions: ${customPrompt}` : '',
    '',
    `Title: ${issue.title ?? ''}`,
    `Body:\n${issue.body ?? '(empty)'}`,
  ]
    .filter(Boolean)
    .join('\n');

  core.info(`Triaging issue #${issue.number}`);
  const rawOutput = runBuddyHeadless(prompt, apiKey, model, 5);

  let triage: { summary?: string; labels?: string[]; priority?: string } = {};
  try {
    const objMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (objMatch) triage = JSON.parse(objMatch[0]) as typeof triage;
  } catch { /* ignore parse errors */ }

  if (triage.labels && triage.labels.length > 0) {
    await octokit.rest.issues.addLabels({
      ...context.repo,
      issue_number: issue.number,
      labels: triage.labels,
    });
  }

  const comment = [
    '**Code Buddy Triage**',
    '',
    triage.summary ? `**Summary:** ${triage.summary}` : '',
    triage.priority ? `**Priority:** ${triage.priority}` : '',
    triage.labels?.length ? `**Labels applied:** ${triage.labels.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  await octokit.rest.issues.createComment({
    ...context.repo,
    issue_number: issue.number,
    body: comment,
  });

  core.setOutput('triage_result', JSON.stringify(triage));
  core.info('Triage complete');
}

// ============================================================================
// Entry point
// ============================================================================

export async function run(): Promise<void> {
  // Dynamic imports so the file works without @actions/* in package.json
  let core: CoreLike;
  let github: { getOctokit(token: string): OctokitLike; context: GitHubContextLike };

  try {
    core = (await import('@actions/core')) as unknown as CoreLike;
    github = (await import('@actions/github')) as unknown as typeof github;
  } catch {
    logger.error('GitHub Actions SDK not available — are @actions/core and @actions/github installed?');
    process.exit(1);
  }

  try {
    const mode = core.getInput('mode') || 'review';
    const apiKey = core.getInput('anthropic_api_key') || core.getInput('api_key');
    const model = core.getInput('model') || getProviderDefaultModel('google');
    const maxTurns = Math.max(1, parseInt(core.getInput('max_turns') || '10', 10));
    const githubToken = core.getInput('github_token') || process.env['GITHUB_TOKEN'] || '';

    if (!apiKey) {
      core.setFailed('api_key (or anthropic_api_key) input is required');
      return;
    }

    const octokit = github.getOctokit(githubToken);
    const context = github.context;

    core.info(`Code Buddy Action — mode=${mode}, model=${model}, maxTurns=${maxTurns}`);

    if (mode === 'review') {
      await reviewPR(core, octokit, context, apiKey, model, maxTurns);
    } else if (mode === 'implement') {
      await implementTask(core, apiKey, model, maxTurns);
    } else if (mode === 'triage') {
      await triageIssue(core, octokit, context, apiKey, model);
    } else {
      core.setFailed(`Unknown mode "${mode}". Must be review, implement, or triage.`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.setFailed(`Code Buddy Action failed: ${msg}`);
  }
}

// Run when executed directly (not imported in tests)
// Using import.meta.url comparison to detect direct execution in ESM
const isMain = process.argv[1]
  ? import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
  : false;

if (isMain) {
  run().catch(err => {
    process.stderr.write(`Unhandled error: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
