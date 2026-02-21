/**
 * Default Text Formatter
 *
 * Plain-text implementation of ChannelProFormatter.
 * Works with any channel adapter. Uses `pro:<feature>:<action>:<id>`
 * callback data scheme for buttons.
 */

import type {
  ChannelProFormatter,
  ProFormattedMessage,
  CommandEntry,
  PendingDiff,
  RunRecord,
  RunStep,
  CIEvent,
  RepoInfo,
  BranchInfo,
  PRInfo,
  PRSummary,
  MessageButton,
} from './types.js';
import { RunTracker } from './run-tracker.js';
import { CIWatcher } from './ci-watcher.js';

/**
 * Default text-based formatter for pro features.
 * Any channel without a custom formatter gets this automatically.
 */
export class TextProFormatter implements ChannelProFormatter {

  formatDiffMessage(pending: PendingDiff): ProFormattedMessage {
    const lines: string[] = [];

    const totalAdded = pending.diffs.reduce((sum, d) => sum + d.linesAdded, 0);
    const totalRemoved = pending.diffs.reduce((sum, d) => sum + d.linesRemoved, 0);
    lines.push(`Code Changes (Turn #${pending.turnId})`);
    lines.push(`${pending.diffs.length} file(s) | +${totalAdded} -${totalRemoved}`);
    lines.push('');

    for (const diff of pending.diffs) {
      const icon = this.getActionIcon(diff.action);
      lines.push(`${icon} ${diff.path}`);
      lines.push(`  +${diff.linesAdded} -${diff.linesRemoved}`);

      if (diff.excerpt) {
        const excerptLines = diff.excerpt.split('\n');
        const maxLines = Math.min(excerptLines.length, 30);
        for (let i = 0; i < maxLines; i++) {
          lines.push(`  ${excerptLines[i]}`);
        }
        if (excerptLines.length > maxLines) {
          lines.push(`  ... (${excerptLines.length - maxLines} more lines)`);
        }
      }
      lines.push('');
    }

    const buttons: MessageButton[] = [
      { text: 'Apply', type: 'callback', data: `pro:diff:apply:${pending.id}` },
      { text: 'Full Diff', type: 'callback', data: `pro:diff:view:${pending.id}` },
      { text: 'Cancel', type: 'callback', data: `pro:diff:cancel:${pending.id}` },
    ];

    return { text: lines.join('\n'), buttons };
  }

  formatFullDiff(pending: PendingDiff): string {
    if (pending.fullDiff) {
      return pending.fullDiff;
    }

    const lines: string[] = [];
    for (const diff of pending.diffs) {
      lines.push(`--- a/${diff.path}`);
      lines.push(`+++ b/${diff.path}`);
      if (diff.excerpt) {
        lines.push(diff.excerpt);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  formatPlanMessage(plan: string, filesTouched: string[], commands: string[]): ProFormattedMessage {
    const lines: string[] = [];
    lines.push('Execution Plan');
    lines.push('');
    lines.push(plan);
    lines.push('');

    if (filesTouched.length > 0) {
      lines.push(`Files: ${filesTouched.join(', ')}`);
    }
    if (commands.length > 0) {
      lines.push(`Commands: ${commands.join(', ')}`);
    }

    const buttons: MessageButton[] = [
      { text: 'Approve Plan', type: 'callback', data: `pro:plan:approve:${Date.now().toString(36)}` },
      { text: 'Reject', type: 'callback', data: `pro:plan:reject:${Date.now().toString(36)}` },
    ];

    return { text: lines.join('\n'), buttons };
  }

  formatRunsList(runs: RunRecord[]): ProFormattedMessage {
    if (runs.length === 0) {
      return { text: 'No runs recorded yet.' };
    }

    const lines: string[] = ['Recent Runs:', ''];

    for (const run of runs) {
      const statusIcon = RunTracker.getStatusIcon(run.status);
      const duration = RunTracker.formatDuration(run.startedAt, run.endedAt);
      const cost = run.totalCost > 0 ? ` | $${run.totalCost.toFixed(4)}` : '';

      lines.push(`${statusIcon} ${run.id.slice(0, 16)}`);
      lines.push(`  ${RunTracker.truncate(run.objective, 60)}`);
      lines.push(`  ${run.steps.length} steps | ${duration}${cost}`);
      lines.push('');
    }

    const buttons: MessageButton[] = runs.slice(0, 5).map((run) => ({
      text: `Details: ${run.id.slice(0, 12)}`,
      type: 'callback' as const,
      data: `pro:run:detail:${run.id.slice(0, 16)}`,
    }));

    return { text: lines.join('\n'), buttons: buttons.length > 0 ? buttons : undefined };
  }

  formatRunTimeline(run: RunRecord): ProFormattedMessage {
    const lines: string[] = [];
    const statusIcon = RunTracker.getStatusIcon(run.status);
    const duration = RunTracker.formatDuration(run.startedAt, run.endedAt);

    lines.push(`${statusIcon} Run: ${run.id}`);
    lines.push(`Objective: ${run.objective}`);
    lines.push(`Status: ${run.status} | Duration: ${duration}`);
    if (run.totalCost > 0) {
      lines.push(`Tokens: ${run.tokenCount} | Cost: $${run.totalCost.toFixed(4)}`);
    }
    lines.push('');
    lines.push('Timeline:');

    for (const step of run.steps) {
      const stepDuration = step.endedAt
        ? RunTracker.formatDuration(step.startedAt, step.endedAt)
        : 'running...';
      const icon = step.success === true ? '[OK]' : step.success === false ? '[FAIL]' : '[...]';

      lines.push(`  ${icon} ${step.toolName} (${stepDuration})`);

      const argsStr = RunTracker.formatArgs(step.args);
      if (argsStr) {
        lines.push(`    ${argsStr}`);
      }

      if (step.filesChanged && step.filesChanged.length > 0) {
        lines.push(`    Files: ${step.filesChanged.join(', ')}`);
      }
    }

    if (run.artifacts.length > 0) {
      lines.push('');
      lines.push('Artifacts:');
      for (const art of run.artifacts) {
        const ref = art.ref ? ` (${art.ref})` : '';
        const artPath = art.path ? ` ${art.path}` : '';
        lines.push(`  [${art.type}]${artPath}${ref} - ${art.description}`);
      }
    }

    return { text: lines.join('\n') };
  }

  formatRunDetail(run: RunRecord, testSteps: RunStep[], commitRefs: string[]): ProFormattedMessage {
    const formatted = this.formatRunTimeline(run);
    const buttons: MessageButton[] = [];

    if (run.status !== 'running') {
      buttons.push({
        text: 'Re-run',
        type: 'callback',
        data: `pro:run:rerun:${run.id.slice(0, 16)}`,
      });
    }

    if (testSteps.length > 0) {
      buttons.push({
        text: 'Tests',
        type: 'callback',
        data: `pro:run:tests:${run.id.slice(0, 16)}`,
      });
    }

    if (commitRefs.length > 0 && run.status !== 'rolled_back') {
      buttons.push({
        text: 'Rollback',
        type: 'callback',
        data: `pro:run:rollback:${run.id.slice(0, 16)}`,
      });
    }

    return {
      text: formatted.text,
      buttons: buttons.length > 0 ? buttons : undefined,
    };
  }

  formatCIAlert(event: CIEvent, analysis?: string): ProFormattedMessage {
    const severityIcon = CIWatcher.getSeverityIcon(event.severity);
    const lines: string[] = [];

    lines.push(`${severityIcon} CI Alert: ${event.title}`);
    lines.push(`Repo: ${event.repo} | Branch: ${event.branch}`);
    if (event.commit) {
      lines.push(`Commit: ${event.commit}`);
    }
    lines.push('');
    lines.push(event.details.slice(0, 500));

    if (analysis) {
      lines.push('');
      lines.push('Analysis:');
      lines.push(analysis.slice(0, 300));
    }

    const buttons: MessageButton[] = [
      { text: 'Fix it', type: 'callback', data: `pro:ci:fix:${event.id}` },
      { text: 'Mute', type: 'callback', data: `pro:ci:mute:${event.id}` },
    ];

    if (event.logUrl) {
      buttons.splice(1, 0, { text: 'Logs', type: 'url', url: event.logUrl });
    }

    return { text: lines.join('\n'), buttons };
  }

  formatRepoInfo(info: RepoInfo): ProFormattedMessage {
    const lines: string[] = [];
    lines.push('Repository Info');
    lines.push(`Remote: ${info.remote}`);
    lines.push(`Branch: ${info.branch}`);
    lines.push(`Commits: ${info.commitCount}`);
    lines.push(`Latest: ${info.lastCommit}`);

    if (info.recentCommits) {
      lines.push('');
      lines.push('Recent Commits:');
      lines.push(info.recentCommits);
    }

    if (info.openPRs) {
      lines.push('');
      lines.push(`Open PRs: ~${info.openPRs}`);
    }

    return { text: lines.join('\n') };
  }

  formatBranchInfo(info: BranchInfo): ProFormattedMessage {
    const lines: string[] = [];
    lines.push(`Branch: ${info.branch}`);

    if (info.diffStat) {
      lines.push('');
      lines.push(`Changes vs ${info.mainBranch}:`);
      lines.push(info.diffStat);
    }

    lines.push('');
    lines.push(`Ahead: ${info.commitsAhead} | Behind: ${info.commitsBehind}`);

    return { text: lines.join('\n') };
  }

  formatPRInfo(pr: PRInfo): ProFormattedMessage {
    const lines = [
      `PR #${pr.number}: ${pr.title}`,
      `State: ${pr.state} | Author: ${pr.author}`,
      `+${pr.additions} -${pr.deletions} | ${pr.changedFiles} files`,
      '',
      pr.body.slice(0, 500),
    ];

    const buttons: MessageButton[] = [];
    if (pr.url) {
      buttons.push({ text: 'View on GitHub', type: 'url', url: pr.url });
    }
    if (pr.state === 'OPEN') {
      buttons.push(
        { text: 'Merge', type: 'callback', data: `pro:pr:merge:${pr.number}` },
        { text: 'Review', type: 'callback', data: `pro:pr:review:${pr.number}` },
      );
    }

    return { text: lines.join('\n'), buttons: buttons.length > 0 ? buttons : undefined };
  }

  formatPRList(prs: PRSummary[]): ProFormattedMessage {
    if (prs.length === 0) {
      return { text: 'No open PRs.' };
    }

    const lines = ['Open PRs:', ''];
    for (const pr of prs) {
      lines.push(`#${pr.number} ${pr.title} (${pr.author})`);
    }

    return { text: lines.join('\n') };
  }

  getCommandList(): CommandEntry[] {
    return [
      { command: 'repo', description: 'Repository info' },
      { command: 'branch', description: 'Branch info and diff stats' },
      { command: 'pr', description: 'List or view pull requests' },
      { command: 'task', description: 'Create an agent task' },
      { command: 'runs', description: 'List recent agent runs' },
      { command: 'run', description: 'View run details' },
      { command: 'yolo', description: 'Timed full access mode' },
      { command: 'pins', description: 'View pinned context' },
      { command: 'status', description: 'Bot and session status' },
    ];
  }

  private getActionIcon(action: string): string {
    switch (action) {
      case 'create': return '[NEW]';
      case 'modify': return '[MOD]';
      case 'delete': return '[DEL]';
      case 'rename': return '[REN]';
      default: return '[???]';
    }
  }
}
