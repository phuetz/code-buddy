/**
 * Cloud Background Agent Handlers
 *
 * CLI and slash command handlers for submitting and managing
 * cloud background agent tasks.
 *
 * CLI:  buddy cloud submit|status|list|cancel|logs
 * Slash: /cloud submit|status|list|cancel
 */

import { logger } from '../../utils/logger.js';
import type { CommandHandlerResult } from './branch-handlers.js';
import { failureFlag } from '../slash-failure.js';

function textResult(text: string): CommandHandlerResult {
  return { handled: true,
  ...failureFlag(text), entry: { type: 'assistant', content: text, timestamp: new Date() } };
}

/**
 * Handle `/cloud` slash command and `buddy cloud` CLI command.
 */
export async function handleCloud(
  args: string | string[],
  _context?: Record<string, unknown>,
): Promise<CommandHandlerResult> {
  const parts = Array.isArray(args) ? args : args.trim().split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() || 'list';
  const rest = parts.slice(1);

  switch (subcommand) {
    case 'submit':
      return handleCloudSubmit(rest);
    case 'status':
      return handleCloudStatus(rest);
    case 'list':
    case 'ls':
      return handleCloudList(rest);
    case 'cancel':
      return handleCloudCancel(rest);
    case 'logs':
    case 'log':
      return handleCloudLogs(rest);
    case 'delete':
    case 'rm':
      return handleCloudDelete(rest);
    default:
      return textResult(formatHelp());
  }
}

// ──────────────────────────────────────────────────────────────────
// Subcommand Handlers
// ──────────────────────────────────────────────────────────────────

async function handleCloudSubmit(args: string[]): Promise<CommandHandlerResult> {
  const goal = args.join(' ').trim();
  if (!goal) {
    return {
      handled: true,
...failureFlag('Usage: cloud submit "<goal>"\nExample: cloud submit "Add unit tests for the auth module"'),
      entry: { type: 'assistant' as const, content: 'Usage: cloud submit "<goal>"\nExample: cloud submit "Add unit tests for the auth module"', timestamp: new Date() },
    };
  }

  try {
    const { getCloudAgentRunner } = await import('../../cloud/cloud-agent-runner.js');
    const runner = getCloudAgentRunner();
    const taskId = await runner.submitTask({ goal });

    return textResult([
      `Task submitted successfully.`,
      `  ID:   ${taskId}`,
      `  Goal: ${goal.length > 80 ? goal.slice(0, 80) + '...' : goal}`,
      '',
      `Track progress: buddy cloud status ${taskId}`,
      `View logs:      buddy cloud logs ${taskId}`,
      `Cancel:         buddy cloud cancel ${taskId}`,
    ].join('\n'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Cloud submit failed', { error: msg });
    return textResult(`Failed to submit task: ${msg}`);
  }
}

async function handleCloudStatus(args: string[]): Promise<CommandHandlerResult> {
  const taskId = args[0];
  if (!taskId) {
    return {
      handled: true,
...failureFlag('Usage: cloud status <taskId>\nOmit taskId to list all: cloud list'),
      entry: { type: 'assistant' as const, content: 'Usage: cloud status <taskId>\nOmit taskId to list all: cloud list', timestamp: new Date() },
    };
  }

  try {
    const { getCloudAgentRunner } = await import('../../cloud/cloud-agent-runner.js');
    const runner = getCloudAgentRunner();
    const task = await runner.getTaskStatus(taskId);

    const statusIcon = {
      pending: '...',
      running: '>>>',
      completed: '[ok]',
      failed: '[!!]',
      cancelled: '[--]',
    }[task.status] || '???';

    const lines = [
      `${statusIcon} Task ${task.id}`,
      `  Status:  ${task.status}`,
      `  Goal:    ${task.goal.length > 100 ? task.goal.slice(0, 100) + '...' : task.goal}`,
    ];

    if (task.model) lines.push(`  Model:   ${task.model}`);
    lines.push(`  Started: ${task.startedAt.toISOString()}`);
    if (task.completedAt) lines.push(`  Ended:   ${task.completedAt.toISOString()}`);
    if (task.tokensUsed) {
      lines.push(`  Tokens:  ${task.tokensUsed.input} in / ${task.tokensUsed.output} out`);
    }
    if (task.toolCalls) lines.push(`  Tools:   ${task.toolCalls} calls`);
    if (task.filesChanged && task.filesChanged.length > 0) {
      lines.push(`  Changed: ${task.filesChanged.length} files`);
      for (const f of task.filesChanged.slice(0, 10)) {
        lines.push(`    - ${f}`);
      }
      if (task.filesChanged.length > 10) {
        lines.push(`    ... and ${task.filesChanged.length - 10} more`);
      }
    }
    if (task.error) lines.push(`  Error:   ${task.error}`);
    if (task.result) {
      const resultPreview = task.result.length > 300 ? task.result.slice(0, 300) + '...' : task.result;
      lines.push('', '  Result:', '  ' + resultPreview.replace(/\n/g, '\n  '));
    }

    return textResult(lines.join('\n'));
  } catch (err) {
    return {
      handled: true,
...failureFlag(`Task not found: ${err instanceof Error ? err.message : String(err)}`),
      entry: { type: 'assistant' as const, content: `Task not found: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date() },
    };
  }
}

async function handleCloudList(_args: string[]): Promise<CommandHandlerResult> {
  try {
    const { getCloudAgentRunner } = await import('../../cloud/cloud-agent-runner.js');
    const runner = getCloudAgentRunner();
    const tasks = await runner.listTasks();

    if (tasks.length === 0) {
      return textResult('No cloud tasks found.\nSubmit one with: cloud submit "<goal>"');
    }

    const lines = [`Cloud Tasks (${tasks.length})`, ''];

    for (const task of tasks) {
      const statusIcon = {
        pending: '...',
        running: '>>>',
        completed: '[ok]',
        failed: '[!!]',
        cancelled: '[--]',
      }[task.status] || '???';

      const goalPreview = task.goal.length > 60 ? task.goal.slice(0, 60) + '...' : task.goal;
      const elapsed = task.completedAt
        ? `${Math.round((task.completedAt.getTime() - task.startedAt.getTime()) / 1000)}s`
        : 'in progress';

      lines.push(`  ${statusIcon} ${task.id}  ${goalPreview}  (${elapsed})`);
    }

    return textResult(lines.join('\n'));
  } catch (err) {
    return {
      handled: true,
...failureFlag(`Failed to list tasks: ${err instanceof Error ? err.message : String(err)}`),
      entry: { type: 'assistant' as const, content: `Failed to list tasks: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date() },
    };
  }
}

async function handleCloudCancel(args: string[]): Promise<CommandHandlerResult> {
  const taskId = args[0];
  if (!taskId) {
    return textResult('Usage: cloud cancel <taskId>');
  }

  try {
    const { getCloudAgentRunner } = await import('../../cloud/cloud-agent-runner.js');
    const runner = getCloudAgentRunner();
    const cancelled = await runner.cancelTask(taskId);

    if (cancelled) {
      return textResult(`Task ${taskId} cancelled.`);
    } else {
      return textResult(`Task ${taskId} is not in a cancellable state.`);
    }
  } catch (err) {
    return {
      handled: true,
...failureFlag(`Failed to cancel: ${err instanceof Error ? err.message : String(err)}`),
      entry: { type: 'assistant' as const, content: `Failed to cancel: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date() },
    };
  }
}

async function handleCloudLogs(args: string[]): Promise<CommandHandlerResult> {
  const taskId = args[0];
  if (!taskId) {
    return textResult('Usage: cloud logs <taskId>');
  }

  try {
    const { getCloudAgentRunner } = await import('../../cloud/cloud-agent-runner.js');
    const runner = getCloudAgentRunner();
    const logs = runner.getTaskLogs(taskId);

    return textResult(`Logs for ${taskId}:\n\n${logs}`);
  } catch (err) {
    return {
      handled: true,
...failureFlag(`Failed to get logs: ${err instanceof Error ? err.message : String(err)}`),
      entry: { type: 'assistant' as const, content: `Failed to get logs: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date() },
    };
  }
}

async function handleCloudDelete(args: string[]): Promise<CommandHandlerResult> {
  const taskId = args[0];
  if (!taskId) {
    return textResult('Usage: cloud delete <taskId>');
  }

  try {
    const { getCloudAgentRunner } = await import('../../cloud/cloud-agent-runner.js');
    const runner = getCloudAgentRunner();
    await runner.deleteTask(taskId);

    return textResult(`Task ${taskId} deleted.`);
  } catch (err) {
    return {
      handled: true,
...failureFlag(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`),
      entry: { type: 'assistant' as const, content: `Failed to delete: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date() },
    };
  }
}

// ──────────────────────────────────────────────────────────────────
// Help
// ──────────────────────────────────────────────────────────────────

function formatHelp(): string {
  return [
    'Cloud Background Agent Tasks',
    '',
    'Usage: cloud <subcommand> [args]',
    '',
    'Subcommands:',
    '  submit "<goal>"    Submit a new background task',
    '  status <taskId>    Check task status and result',
    '  list               List all tasks',
    '  cancel <taskId>    Cancel a running task',
    '  logs <taskId>      View task execution logs',
    '  delete <taskId>    Delete a task record',
    '',
    'Examples:',
    '  cloud submit "Add tests for the auth module"',
    '  cloud submit "Refactor the payment service to use async/await"',
    '  cloud status ctask_abc123',
    '',
    'HTTP API:',
    '  POST   /api/cloud/tasks          Submit a task',
    '  GET    /api/cloud/tasks          List tasks',
    '  GET    /api/cloud/tasks/:id      Get status',
    '  GET    /api/cloud/tasks/:id/stream  SSE progress stream',
    '  POST   /api/cloud/tasks/:id/cancel  Cancel',
    '  DELETE /api/cloud/tasks/:id      Delete',
  ].join('\n');
}
