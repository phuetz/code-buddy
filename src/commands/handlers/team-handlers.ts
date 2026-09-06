/**
 * Team Command Handlers
 *
 * Handles /team slash commands for Agent Teams coordination.
 * Mirrors Native Engine's Agent Teams feature with team lead, teammates,
 * shared task list, and mailbox communication.
 */

import {
  getTeamManager,
  type TeamMember,
  type TeamTask,
} from '../../agent/multi-agent/team-manager.js';
import type { AgentRole } from '../../agent/multi-agent/types.js';
import type { StreamingChunk } from '../../agent/types.js';
import {
  ThreadTaskRunner,
  type ThreadTaskAgentFactory,
} from '../../agent/delegation/thread-task-runner.js';
import type {
  ThreadDelegationEvent,
  ThreadParentBudget,
} from '../../agent/delegation/thread-delegation.js';
import { getModelToolConfig } from '../../config/model-tools.js';
import { getPermissionModeManager } from '../../security/permission-modes.js';
import type { CommandHandlerResult } from './branch-handlers.js';
import { _resolveAgentsCredentials } from './agents-handler.js';

export interface TeamDelegatedTask {
  task: TeamTask;
  member: TeamMember;
  prompt: string;
}

export interface TeamDelegationOutput {
  type: StreamingChunk['type'] | 'result';
  content?: string;
  chunk?: StreamingChunk;
  success?: boolean;
  summary?: string;
}

export interface TeamHandlerOptions {
  cwd?: string;
  model?: string;
  concurrency?: number;
  parentSignal?: AbortSignal;
  parentBudget?: ThreadParentBudget;
  agentFactory?: ThreadTaskAgentFactory<TeamDelegatedTask, TeamDelegationOutput>;
  eventSink?: (event: ThreadDelegationEvent<TeamDelegationOutput>) => void;
}

interface TeamRuntime {
  runner: ThreadTaskRunner<TeamDelegatedTask, TeamDelegationOutput>;
  eventPump: Promise<void>;
}

let activeTeamRuntime: TeamRuntime | null = null;
let teamRunActive = false;

/**
 * Create a standard command result with an assistant entry.
 */
function reply(content: string): CommandHandlerResult {
  return {
    handled: true,
    entry: {
      type: 'assistant',
      content,
      timestamp: new Date(),
    },
  };
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatTeamEventPayload(payload: unknown): string {
  if (typeof payload === 'object' && payload !== null) {
    const output = payload as TeamDelegationOutput & Record<string, unknown>;
    if (output.type === 'result') return output.summary || (output.success ? 'completed' : 'failed');
    if (output.content) return output.content.replace(/\r?\n/g, '\\n').slice(0, 2_000);
    if (typeof output.message === 'string') return output.message;
    if (typeof output.state === 'string') return output.state;
  }
  try {
    return (JSON.stringify(payload) ?? String(payload)).slice(0, 2_000);
  } catch {
    return String(payload).slice(0, 2_000);
  }
}

function writeTeamEvent(event: ThreadDelegationEvent<TeamDelegationOutput>): void {
  process.stdout.write(
    `[team:${event.agentId}:${event.kind}] ${formatTeamEventPayload(event.payload)}\n`,
  );
}

function teamTaskPrompt(input: Omit<TeamDelegatedTask, 'prompt'>): string {
  const team = getTeamManager();
  const inbox = team.getUnreadMessages(input.member.id);
  return [
    `You are ${input.member.label}, the ${input.member.role} teammate in an Agent Team.`,
    `Team goal: ${team.getTeamGoal() || '(not specified)'}`,
    `Assigned task: ${input.task.title}`,
    input.task.description === input.task.title ? '' : input.task.description,
    inbox.length > 0
      ? `Messages from the team:\n${inbox.map((message) => `- ${message.content}`).join('\n')}`
      : '',
    'Work on this task with your full tool loop. Report what you actually completed and any remaining blocker.',
  ].filter(Boolean).join('\n\n');
}

async function* streamWithTeamPermissionMode(
  agent: import('../../agent/codebuddy-agent.js').CodeBuddyAgent,
  prompt: string,
): AsyncGenerator<TeamDelegationOutput> {
  const permissionManager = getPermissionModeManager();
  const mode = permissionManager.getSubagentMode();
  const iterator = agent.processUserMessageStream(prompt, { surface: 'cli' })[Symbol.asyncIterator]();
  let summary = '';
  let completed = false;
  try {
    while (true) {
      const next = await permissionManager.withModeAsync(mode, () => iterator.next());
      if (next.done) {
        completed = true;
        break;
      }
      const chunk = next.value;
      if (chunk.type === 'content' && chunk.content) summary += chunk.content;
      yield {
        type: chunk.type,
        ...(chunk.content === undefined ? {} : { content: chunk.content }),
        chunk,
      };
    }
  } finally {
    if (!completed && iterator.return) {
      await permissionManager.withModeAsync(mode, () => iterator.return!());
    }
  }
  yield {
    type: 'result',
    success: true,
    summary: summary.trim() || 'Teammate completed without a textual summary.',
  };
}

async function createTeamRuntime(options: TeamHandlerOptions): Promise<TeamRuntime | string> {
  const credentials = _resolveAgentsCredentials();
  if ('error' in credentials && !options.agentFactory) return credentials.error;
  const model = options.model ?? process.env.GROK_MODEL?.trim();
  const configuredRounds = Math.floor(
    positiveNumber(process.env.CODEBUDDY_TEAM_MAX_ROUNDS, 6),
  );
  const modelContext = model ? getModelToolConfig(model).contextWindow ?? 128_000 : 128_000;
  const parentBudget = options.parentBudget ?? {
    maxTurns: configuredRounds * 2,
    maxCostUsd: positiveNumber(process.env.MAX_COST, 10),
    maxContextTokens: Math.floor(
      positiveNumber(process.env.CODEBUDDY_MAX_CONTEXT, modelContext),
    ),
  };
  const rawFactory: ThreadTaskAgentFactory<TeamDelegatedTask, TeamDelegationOutput> =
    options.agentFactory ?? (async ({ agentId, budget }) => {
      const team = getTeamManager();
      const member = team.getMember(agentId);
      if (!member) throw new Error(`Team member ${agentId} no longer exists`);
      const { CodeBuddyAgent } = await import('../../agent/codebuddy-agent.js');
      const { ConfirmationService } = await import('../../utils/confirmation-service.js');
      ConfirmationService.getInstance().setSessionFlag('allOperations', true);
      ConfirmationService.getInstance().setSessionFlag('bashCommands', true);
      const agent = new CodeBuddyAgent(
        'error' in credentials ? 'injected' : credentials.apiKey,
        'error' in credentials ? undefined : credentials.baseURL,
        model,
        budget.maxTurns,
        true,
        undefined,
        options.cwd ?? process.cwd(),
        `You are the independent ${member.role} teammate named ${member.label}.`,
      );
      agent.updateContextConfig({
        maxContextTokens: budget.maxContextTokens,
        responseReserveTokens: Math.max(256, Math.floor(budget.maxContextTokens * 0.125)),
      });
      agent.setSessionCostLimit(budget.maxCostUsd);
      agent.setMemoryEnabled(false);
      await agent.systemPromptReady;
      return {
        execute: (input) => streamWithTeamPermissionMode(agent, input.prompt),
        abortCurrentOperation: () => agent.abortCurrentOperation(),
        dispose: () => agent.dispose({ skipSessionLearning: true }),
        getSessionCost: () => agent.getSessionCost(),
      };
    });
  const concurrency = Math.floor(
    positiveNumber(
      options.concurrency === undefined
        ? process.env.CODEBUDDY_TEAM_CONCURRENCY
        : String(options.concurrency),
      ThreadTaskRunner.DEFAULT_CONCURRENCY,
    ),
  );
  const runner = new ThreadTaskRunner<TeamDelegatedTask, TeamDelegationOutput>({
    createAgent: rawFactory,
    parentBudget,
    concurrency,
    ...(options.parentSignal === undefined ? {} : { parentSignal: options.parentSignal }),
  });
  const eventPump = (async () => {
    for await (const event of runner.events()) {
      try {
        (options.eventSink ?? writeTeamEvent)(event);
      } catch {
        // Rendering is best effort; keep draining every child event.
      }
    }
  })();
  return { runner, eventPump };
}

async function closeTeamRuntime(reason?: string): Promise<void> {
  const runtime = activeTeamRuntime;
  activeTeamRuntime = null;
  if (!runtime) return;
  if (reason) runtime.runner.cancel(reason);
  await runtime.runner.close();
  await runtime.eventPump;
}

function selectRunnableTasks(target: string | undefined): TeamTask[] | string {
  const team = getTeamManager();
  if (target && target !== 'all') {
    const task = findTaskByPartialId(team, target);
    if (!task) return `Task "${target}" not found.`;
    if (!task.assignedTo) return `Task "${task.title}" is unassigned. Use /team assign first.`;
    if (task.status !== 'in_progress') {
      return `Task "${task.title}" is ${task.status}; only assigned in-progress tasks can run.`;
    }
    return [task];
  }
  return team.getTasks().filter(
    (task) => task.status === 'in_progress' && task.assignedTo !== null,
  );
}

async function runTeamTasks(
  target: string | undefined,
  options: TeamHandlerOptions,
): Promise<CommandHandlerResult> {
  const team = getTeamManager();
  if (!team.isActive()) return reply('Team is not active. Use /team start first.');
  if (teamRunActive) return reply('A team run is already active. Stop it with /team stop first.');
  const selected = selectRunnableTasks(target);
  if (typeof selected === 'string') return reply(selected);
  if (selected.length === 0) {
    return reply('No assigned tasks are ready. Use /team task and /team assign first.');
  }

  const runtime = await createTeamRuntime(options);
  if (typeof runtime === 'string') return reply(runtime);
  activeTeamRuntime = runtime;
  teamRunActive = true;
  const rows: string[] = [];
  let succeeded = 0;
  try {
    await Promise.all(selected.map(async (task) => {
      const member = task.assignedTo ? team.getMember(task.assignedTo) : undefined;
      if (!member) {
        const error = `Assigned member ${task.assignedTo ?? '(none)'} not found`;
        team.updateTask(task.id, { status: 'failed', error });
        rows.push(`  [FAIL] ${task.title}: ${error}`);
        return;
      }
      try {
        const input: TeamDelegatedTask = {
          task,
          member,
          prompt: teamTaskPrompt({ task, member }),
        };
        const outcome = await runtime.runner.submit(member.id, input);
        const output = outcome.output;
        if (!outcome.success || output?.type !== 'result' || output.success !== true) {
          const error = [outcome.reason, outcome.message, output?.summary]
            .filter(Boolean)
            .join(': ') || 'Delegate returned no final result';
          team.updateTask(task.id, { status: 'failed', error });
          rows.push(`  [FAIL] ${task.title}: ${error}`);
          return;
        }
        const summary = output.summary || 'Completed';
        team.updateTask(task.id, { status: 'completed', result: summary });
        succeeded += 1;
        rows.push(`  [OK] ${task.title}: ${summary.split('\n')[0]?.slice(0, 120)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        team.updateTask(task.id, { status: 'failed', error: message });
        rows.push(`  [FAIL] ${task.title}: ${message}`);
      }
    }));
  } finally {
    teamRunActive = false;
    await closeTeamRuntime();
  }

  return reply([
    'Team run completed.',
    `Completed: ${succeeded}/${selected.length}`,
    ...rows,
  ].join('\n'));
}

/**
 * Handle the /team command.
 *
 * Subcommands:
 *   /team start [goal]   - Start a team session (current agent becomes lead)
 *   /team add <role>      - Add a teammate with a role
 *   /team remove <id>     - Remove a teammate
 *   /team status          - Show team members and their current tasks
 *   /team stop            - Dissolve the team
 *   /team task <title>    - Add a task to the shared task list
 *   /team assign <taskId> <memberId> - Assign a task to a member
 *   /team complete <taskId>          - Mark a task as completed
 *   /team run [taskId|all]           - Execute assigned tasks with delegated teammates
 *   /team send <to> <message>        - Send a message to a teammate
 *   /team inbox [memberId]           - View messages
 */
export async function handleTeam(
  args: string[],
  options: TeamHandlerOptions = {},
): Promise<CommandHandlerResult> {
  const subcommand = args[0]?.toLowerCase() || 'status';
  const team = getTeamManager();

  switch (subcommand) {
    case 'start': {
      const goal = args.slice(1).join(' ');
      const result = team.start(goal);
      return reply(result.message);
    }

    case 'stop': {
      await closeTeamRuntime('Team lead stopped the run');
      teamRunActive = false;
      const result = team.stop();
      return reply(result.message);
    }

    case 'add': {
      const role = args[1]?.toLowerCase() as AgentRole | undefined;
      if (!role) {
        return reply(
          'Usage: /team add <role> [label]\n\nValid roles: orchestrator, coder, reviewer, tester, researcher, debugger, architect, documenter'
        );
      }
      const label = args[2] || undefined;
      const result = team.addMember(role, label);
      return reply(result.message);
    }

    case 'remove': {
      const memberId = args[1];
      if (!memberId) {
        return reply('Usage: /team remove <memberId>');
      }
      const result = team.removeMember(memberId);
      if (result.success) activeTeamRuntime?.runner.cancelAgent(memberId, 'Member removed');
      return reply(result.message);
    }

    case 'status': {
      if (!team.isActive()) {
        return reply('No active team. Use /team start [goal] to create one.');
      }
      return reply(team.formatStatus());
    }

    case 'task': {
      const title = args.slice(1).join(' ');
      if (!title) {
        // Show task list
        const tasks = team.getTasks();
        if (tasks.length === 0) {
          return reply('No tasks in the shared task list. Use /team task <title> to add one.');
        }
        const lines = tasks.map(t => {
          const mark = t.status === 'completed' ? '[x]' :
            t.status === 'in_progress' ? '[/]' :
            t.status === 'failed' ? '[-]' : '[ ]';
          const assignee = t.assignedTo
            ? team.getMember(t.assignedTo)?.label || t.assignedTo
            : 'unassigned';
          return `${mark} ${t.id.slice(0, 12)} | ${t.title} (${t.priority}) -> ${assignee}`;
        });
        return reply(`Shared Task List (${tasks.length}):\n${lines.join('\n')}`);
      }
      if (!team.isActive()) {
        return reply('Team is not active. Use /team start first.');
      }
      const task = team.addTask(title, title);
      return reply(`Task added: "${task.title}" (${task.id})`);
    }

    case 'assign': {
      const taskId = args[1];
      const memberId = args[2];
      if (!taskId || !memberId) {
        return reply('Usage: /team assign <taskId> <memberId>');
      }
      const matchedTask = findTaskByPartialId(team, taskId);
      if (!matchedTask) {
        return reply(`Task "${taskId}" not found.`);
      }
      const result = team.assignTask(matchedTask.id, memberId);
      return reply(result.message);
    }

    case 'complete': {
      const taskId = args[1];
      if (!taskId) {
        return reply('Usage: /team complete <taskId>');
      }
      const matchedTask = findTaskByPartialId(team, taskId);
      if (!matchedTask) {
        return reply(`Task "${taskId}" not found.`);
      }
      const resultText = args.slice(2).join(' ') || undefined;
      const result = team.updateTask(matchedTask.id, { status: 'completed', result: resultText });
      return reply(result.message);
    }

    case 'run': {
      return runTeamTasks(args[1]?.trim().toLowerCase(), options);
    }

    case 'send': {
      const to = args[1];
      const message = args.slice(2).join(' ');
      if (!to || !message) {
        return reply('Usage: /team send <memberId|all> <message>');
      }
      const msg = team.sendMessage('lead', to, message);
      return reply(`Message sent (${msg.id.slice(0, 12)}) to ${to}.`);
    }

    case 'inbox': {
      const memberId = args[1] || 'lead';
      const messages = team.getInbox(memberId, 20);
      if (messages.length === 0) {
        return reply('No messages in inbox.');
      }
      const lines = messages.map(m => {
        const readMark = m.read ? '  ' : '* ';
        const from = m.from === 'lead' ? 'Lead' : (team.getMember(m.from)?.label || m.from);
        const time = m.timestamp.toLocaleTimeString();
        return `${readMark}[${time}] ${from}: ${m.content}`;
      });
      // Mark as read
      team.markRead(messages.map(m => m.id));
      return reply(`Inbox (${messages.length} messages):\n${lines.join('\n')}`);
    }

    default: {
      return reply(
        `Agent Teams - Multi-Agent Coordination

Commands:
  /team start [goal]          Start a team session (you become team lead)
  /team add <role> [label]    Add a teammate
  /team remove <memberId>     Remove a teammate
  /team status                Show team status, members, and tasks
  /team stop                  Dissolve the team

  /team task [title]          Add a task (no title = list tasks)
  /team assign <task> <member>  Assign task to member
  /team complete <task>       Mark task as completed
  /team run [task|all]        Run assigned task(s) with multiplexed teammates

  /team send <to> <message>   Send message to member or "all"
  /team inbox [memberId]      View messages

Roles: orchestrator, coder, reviewer, tester, researcher, debugger, architect, documenter`
      );
    }
  }
}

export async function _resetTeamHandlerForTests(): Promise<void> {
  teamRunActive = false;
  await closeTeamRuntime('Team handler reset');
}

/**
 * Find a task by partial ID match.
 */
function findTaskByPartialId(team: ReturnType<typeof getTeamManager>, partialId: string) {
  const tasks = team.getTasks();
  return tasks.find(t => t.id === partialId || t.id.startsWith(partialId));
}
