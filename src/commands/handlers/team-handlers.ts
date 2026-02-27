/**
 * Team Command Handlers
 *
 * Handles /team slash commands for Agent Teams coordination.
 * Mirrors Claude Code's Agent Teams feature with team lead, teammates,
 * shared task list, and mailbox communication.
 */

import { getTeamManager } from '../../agent/multi-agent/team-manager.js';
import type { AgentRole } from '../../agent/multi-agent/types.js';
import type { CommandHandlerResult } from './branch-handlers.js';

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
 *   /team send <to> <message>        - Send a message to a teammate
 *   /team inbox [memberId]           - View messages
 */
export function handleTeam(args: string[]): CommandHandlerResult {
  const subcommand = args[0]?.toLowerCase() || 'status';
  const team = getTeamManager();

  switch (subcommand) {
    case 'start': {
      const goal = args.slice(1).join(' ');
      const result = team.start(goal);
      return reply(result.message);
    }

    case 'stop': {
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

  /team send <to> <message>   Send message to member or "all"
  /team inbox [memberId]      View messages

Roles: orchestrator, coder, reviewer, tester, researcher, debugger, architect, documenter`
      );
    }
  }
}

/**
 * Find a task by partial ID match.
 */
function findTaskByPartialId(team: ReturnType<typeof getTeamManager>, partialId: string) {
  const tasks = team.getTasks();
  return tasks.find(t => t.id === partialId || t.id.startsWith(partialId));
}
