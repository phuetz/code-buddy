/**
 * Session Tools
 *
 * Tools for multi-agent session coordination.
 * Enables agents to communicate across sessions.
 *
 * Inspired by OpenClaw's session tools:
 * - sessions_list: List active sessions
 * - sessions_history: Get session transcript
 * - sessions_send: Message another session
 * - sessions_spawn: Create isolated sub-agent
 */

import type { CodeBuddyTool } from '../../codebuddy/client.js';
import {
  SessionRegistry,
  getSessionRegistry,
  SessionKind,
  SessionInfo,
} from './session-registry.js';

// ============================================================================
// Tool Definitions
// ============================================================================

export const SESSIONS_LIST_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'sessions_list',
    description: `List active sessions in the multi-agent system.

Use this to discover other sessions you can communicate with.

Session kinds:
- main: Main DM session with user
- channel: Channel/group session
- cron: Scheduled cron job session
- hook: Webhook-triggered session
- spawn: Spawned sub-agent session
- node: Companion node session

Example: List all active sessions from the last 10 minutes
{ "activeMinutes": 10, "limit": 20 }`,
    parameters: {
      type: 'object',
      properties: {
        kinds: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['main', 'channel', 'cron', 'hook', 'spawn', 'node'],
          },
          description: 'Filter by session kinds',
        },
        limit: {
          type: 'number',
          description: 'Maximum sessions to return (default: 50)',
        },
        activeMinutes: {
          type: 'number',
          description: 'Only sessions active in last N minutes',
        },
        messageLimit: {
          type: 'number',
          description: 'Include last N messages per session in preview',
        },
      },
      required: [],
    },
  },
};

export const SESSIONS_HISTORY_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'sessions_history',
    description: `Get the conversation history of a session.

Use this to understand what happened in another session before sending a message.

You can identify sessions by:
- sessionKey: Human-readable key like "main", "spawn:abc:task1"
- sessionId: UUID of the session

Example: Get last 20 messages from main session
{ "sessionKey": "main", "limit": 20, "includeTools": false }`,
    parameters: {
      type: 'object',
      properties: {
        sessionKey: {
          type: 'string',
          description: 'Session key (e.g., "main", "spawn:parent:label")',
        },
        sessionId: {
          type: 'string',
          description: 'Session UUID (alternative to sessionKey)',
        },
        limit: {
          type: 'number',
          description: 'Maximum messages to return (default: 50)',
        },
        includeTools: {
          type: 'boolean',
          description: 'Include tool call details (default: false)',
        },
      },
      required: [],
    },
  },
};

export const SESSIONS_SEND_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'sessions_send',
    description: `Send a message to another session.

Use this to coordinate with other agents or sessions.

Modes:
- Fire-and-forget (timeoutSeconds=0): Send and continue without waiting
- Wait for response (timeoutSeconds>0): Wait for the target to reply

Example: Send task update to main session
{ "sessionKey": "main", "message": "Task completed successfully", "timeoutSeconds": 0 }

Example: Ask another agent and wait for response
{ "sessionKey": "spawn:abc:researcher", "message": "What did you find?", "timeoutSeconds": 30 }`,
    parameters: {
      type: 'object',
      properties: {
        sessionKey: {
          type: 'string',
          description: 'Target session key',
        },
        message: {
          type: 'string',
          description: 'Message to send',
        },
        timeoutSeconds: {
          type: 'number',
          description: 'Wait timeout (0=fire-and-forget, default: 0)',
        },
      },
      required: ['sessionKey', 'message'],
    },
  },
};

export const SESSIONS_SPAWN_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'sessions_spawn',
    description: `Spawn an isolated sub-agent session for a specific task.

The spawned agent runs in a sandboxed session with its own context.
Use this to delegate subtasks or run parallel work.

The spawned agent will:
- Have its own conversation context
- Run with restricted tools (configurable)
- Report back through session messaging

Example: Spawn a research agent
{
  "task": "Research the latest TypeScript 5.0 features",
  "label": "ts-researcher",
  "runTimeoutSeconds": 120
}

Example: Spawn a code reviewer
{
  "task": "Review the changes in src/api/ for security issues",
  "label": "security-review",
  "allowedTools": ["view_file", "search", "find_symbols"],
  "context": { "focus": "security", "severity": "high" }
}`,
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Task description for the sub-agent',
        },
        label: {
          type: 'string',
          description: 'Label for the session (used in session key)',
        },
        agentId: {
          type: 'string',
          description: 'Agent ID to use (defaults to current agent)',
        },
        model: {
          type: 'string',
          description: 'Model override for the sub-agent',
        },
        runTimeoutSeconds: {
          type: 'number',
          description: 'Maximum runtime in seconds (default: 300)',
        },
        allowedTools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tools the sub-agent can use (defaults to safe subset)',
        },
        context: {
          type: 'object',
          description: 'Initial context/data to pass to the sub-agent',
        },
      },
      required: ['task'],
    },
  },
};

export const SESSION_TOOLS: CodeBuddyTool[] = [
  SESSIONS_LIST_TOOL,
  SESSIONS_HISTORY_TOOL,
  SESSIONS_SEND_TOOL,
  SESSIONS_SPAWN_TOOL,
];

// ============================================================================
// Tool Executor
// ============================================================================

export interface SessionToolResult {
  success: boolean;
  output?: string;
  error?: string;
  data?: unknown;
}

export class SessionToolExecutor {
  private registry: SessionRegistry;
  private currentSessionId: string;

  constructor(registry?: SessionRegistry, currentSessionId?: string) {
    this.registry = registry || getSessionRegistry();
    this.currentSessionId = currentSessionId || 'main';
  }

  setCurrentSession(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<SessionToolResult> {
    switch (toolName) {
      case 'sessions_list':
        return this.executeSessionsList(args);
      case 'sessions_history':
        return this.executeSessionsHistory(args);
      case 'sessions_send':
        return this.executeSessionsSend(args);
      case 'sessions_spawn':
        return this.executeSessionsSpawn(args);
      default:
        return { success: false, error: `Unknown session tool: ${toolName}` };
    }
  }

  private executeSessionsList(args: Record<string, unknown>): SessionToolResult {
    const sessions = this.registry.listSessions({
      kinds: args.kinds as SessionKind[] | undefined,
      limit: (args.limit as number) || 50,
      activeMinutes: args.activeMinutes as number | undefined,
    });

    const messageLimit = (args.messageLimit as number) || 0;

    const formatted = sessions.map(s => {
      const info: Record<string, unknown> = {
        key: s.key,
        kind: s.kind,
        status: s.status,
        messageCount: s.messageCount,
        lastActivity: this.formatRelativeTime(s.lastActivityAt),
      };

      if (s.label) info.label = s.label;
      if (s.model) info.model = s.model;
      if (s.sandboxed) info.sandboxed = true;

      if (messageLimit > 0) {
        const messages = this.registry.getHistory(s.id, {
          limit: messageLimit,
          includeTools: false,
        });
        info.preview = messages.map(m => ({
          role: m.role,
          content: m.content.substring(0, 100) + (m.content.length > 100 ? '...' : ''),
        }));
      }

      return info;
    });

    return {
      success: true,
      output: `Found ${sessions.length} session(s)`,
      data: { sessions: formatted, total: sessions.length },
    };
  }

  private executeSessionsHistory(args: Record<string, unknown>): SessionToolResult {
    let session: SessionInfo | undefined;

    if (args.sessionKey) {
      session = this.registry.getSessionByKey(args.sessionKey as string);
    } else if (args.sessionId) {
      session = this.registry.getSession(args.sessionId as string);
    }

    if (!session) {
      return {
        success: false,
        error: `Session not found: ${args.sessionKey || args.sessionId}`,
      };
    }

    const messages = this.registry.getHistory(session.id, {
      limit: (args.limit as number) || 50,
      includeTools: (args.includeTools as boolean) || false,
    });

    const formatted = messages.map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp.toISOString(),
      ...(m.toolCalls ? { toolCalls: m.toolCalls.map(t => t.name) } : {}),
    }));

    return {
      success: true,
      output: `Retrieved ${messages.length} message(s) from session ${session.key}`,
      data: {
        session: {
          key: session.key,
          kind: session.kind,
          status: session.status,
          messageCount: session.messageCount,
        },
        messages: formatted,
      },
    };
  }

  private async executeSessionsSend(args: Record<string, unknown>): Promise<SessionToolResult> {
    const sessionKey = args.sessionKey as string;
    const message = args.message as string;
    const timeoutSeconds = (args.timeoutSeconds as number) || 0;

    if (!sessionKey || !message) {
      return { success: false, error: 'sessionKey and message are required' };
    }

    const result = await this.registry.sendToSession(
      this.currentSessionId,
      sessionKey,
      message,
      timeoutSeconds
    );

    if (result.success) {
      if (result.fireAndForget) {
        return {
          success: true,
          output: `Message sent to ${sessionKey} (fire-and-forget)`,
        };
      } else {
        return {
          success: true,
          output: `Response from ${sessionKey}: ${result.response}`,
          data: { response: result.response },
        };
      }
    } else {
      return {
        success: false,
        error: result.error,
      };
    }
  }

  private executeSessionsSpawn(args: Record<string, unknown>): SessionToolResult {
    const task = args.task as string;
    if (!task) {
      return { success: false, error: 'task is required' };
    }

    try {
      const child = this.registry.spawnSession({
        parentSessionId: this.currentSessionId,
        task,
        label: args.label as string | undefined,
        agentId: args.agentId as string | undefined,
        model: args.model as string | undefined,
        allowedTools: args.allowedTools as string[] | undefined,
        context: args.context as Record<string, unknown> | undefined,
      });

      return {
        success: true,
        output: `Spawned session ${child.key}`,
        data: {
          sessionId: child.id,
          sessionKey: child.key,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private formatRelativeTime(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let sessionToolExecutorInstance: SessionToolExecutor | null = null;

export function getSessionToolExecutor(
  registry?: SessionRegistry,
  currentSessionId?: string
): SessionToolExecutor {
  if (!sessionToolExecutorInstance) {
    sessionToolExecutorInstance = new SessionToolExecutor(registry, currentSessionId);
  }
  return sessionToolExecutorInstance;
}

export function resetSessionToolExecutor(): void {
  sessionToolExecutorInstance = null;
}

export default SessionToolExecutor;
