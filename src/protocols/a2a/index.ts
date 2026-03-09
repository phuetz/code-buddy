/**
 * A2A Protocol — Agent-to-Agent Communication
 * Implements Google's A2A spec for inter-agent task delegation.
 *
 * Core concepts:
 * - AgentCard: Discovery document describing agent capabilities
 * - Task: Unit of work with lifecycle (submitted → working → completed/failed)
 * - Message: Communication between agents within a task
 * - Artifact: Output produced by a task
 */

import { EventEmitter } from 'events';

/* ── Types ── */

/** Agent capability descriptor */
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  /** Input MIME types accepted */
  inputModes: string[];
  /** Output MIME types produced */
  outputModes: string[];
}

/** Agent discovery document (served at /.well-known/agent.json) */
export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  skills: AgentSkill[];
  /** Authentication requirements */
  authentication?: {
    schemes: string[];
  };
  /** Supported A2A protocol features */
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
  };
}

export enum TaskStatus {
  SUBMITTED = 'submitted',
  WORKING = 'working',
  INPUT_REQUIRED = 'input-required',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

export interface TaskState {
  status: TaskStatus;
  message?: string;
  timestamp: number;
}

export interface TextPart {
  type: 'text';
  text: string;
}

export interface FilePart {
  type: 'file';
  file: {
    name: string;
    mimeType: string;
    /** Base64-encoded content or URI */
    data?: string;
    uri?: string;
  };
}

export type Part = TextPart | FilePart;

export interface A2AMessage {
  role: 'user' | 'agent';
  parts: Part[];
  metadata?: Record<string, string>;
}

export interface Artifact {
  name: string;
  parts: Part[];
  metadata?: Record<string, string>;
}

export interface Task {
  id: string;
  /** Session grouping for multi-turn interactions */
  sessionId: string;
  status: TaskState;
  messages: A2AMessage[];
  artifacts: Artifact[];
  metadata?: Record<string, string>;
  history: TaskState[];
}

/** Callback for executing tasks */
export type TaskExecutor = (task: Task) => Promise<Task>;

/* ── Agent Server ── */

/**
 * A2A Agent Server — receives and executes tasks from other agents.
 * Can be exposed via HTTP (Express/Fastify route) or used in-process.
 */
export class A2AAgentServer extends EventEmitter {
  private card: AgentCard;
  private executor: TaskExecutor;
  private tasks: Map<string, Task> = new Map();

  constructor(card: AgentCard, executor: TaskExecutor) {
    super();
    this.card = card;
    this.executor = executor;
  }

  /** Get the agent card (for discovery) */
  getAgentCard(): AgentCard {
    return this.card;
  }

  /** Submit a new task */
  async submitTask(request: {
    id: string;
    sessionId?: string;
    message: A2AMessage;
    metadata?: Record<string, string>;
  }): Promise<Task> {
    const task: Task = {
      id: request.id,
      sessionId: request.sessionId || request.id,
      status: { status: TaskStatus.SUBMITTED, timestamp: Date.now() },
      messages: [request.message],
      artifacts: [],
      metadata: request.metadata,
      history: [{ status: TaskStatus.SUBMITTED, timestamp: Date.now() }],
    };

    this.tasks.set(task.id, task);
    this.emit('task:submitted', { taskId: task.id });

    // Transition to working
    this.updateTaskStatus(task, TaskStatus.WORKING);

    try {
      const completed = await this.executor(task);
      this.updateTaskStatus(completed, TaskStatus.COMPLETED);
      this.emit('task:completed', { taskId: task.id });
      return completed;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.updateTaskStatus(task, TaskStatus.FAILED, error);
      this.emit('task:failed', { taskId: task.id, error });
      return task;
    }
  }

  /** Get task by ID */
  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /** Cancel a task */
  cancelTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status.status === TaskStatus.COMPLETED || task.status.status === TaskStatus.FAILED) {
      return false;
    }
    this.updateTaskStatus(task, TaskStatus.CANCELED);
    this.emit('task:canceled', { taskId: id });
    return true;
  }

  /** Add a message to an existing task (multi-turn) */
  async sendMessage(taskId: string, message: A2AMessage): Promise<Task> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (task.status.status !== TaskStatus.INPUT_REQUIRED) {
      throw new Error(`Task ${taskId} is not awaiting input (status: ${task.status.status})`);
    }

    task.messages.push(message);
    this.updateTaskStatus(task, TaskStatus.WORKING);

    const completed = await this.executor(task);
    return completed;
  }

  private updateTaskStatus(task: Task, status: TaskStatus, message?: string): void {
    task.status = { status, message, timestamp: Date.now() };
    task.history.push({ ...task.status });
  }
}

/* ── Agent Client ── */

/**
 * A2A Agent Client — sends tasks to other agents.
 * Used by an orchestrator to delegate work to specialist agents.
 */
export class A2AAgentClient {
  private agents: Map<string, A2AAgentServer> = new Map();

  /** Register a local agent (in-process, no HTTP) */
  registerAgent(key: string, agent: A2AAgentServer): void {
    this.agents.set(key, agent);
  }

  /** Discover an agent's capabilities */
  getAgentCard(key: string): AgentCard | undefined {
    return this.agents.get(key)?.getAgentCard();
  }

  /** List all registered agent keys */
  listAgents(): string[] {
    return Array.from(this.agents.keys());
  }

  /** Find agents that can handle a specific skill */
  findAgentsWithSkill(skillId: string): string[] {
    const result: string[] = [];
    for (const [key, agent] of this.agents) {
      const card = agent.getAgentCard();
      if (card.skills.some((s) => s.id === skillId)) {
        result.push(key);
      }
    }
    return result;
  }

  /** Submit a task to a specific agent */
  async submitTask(
    agentKey: string,
    request: string,
    metadata?: Record<string, string>
  ): Promise<Task> {
    const agent = this.agents.get(agentKey);
    if (!agent) throw new Error(`Agent not found: ${agentKey}`);

    return agent.submitTask({
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      message: {
        role: 'user',
        parts: [{ type: 'text', text: request }],
      },
      metadata,
    });
  }

  /** Get task status */
  getTask(agentKey: string, taskId: string): Task | undefined {
    return this.agents.get(agentKey)?.getTask(taskId);
  }
}

/* ── Helpers ── */

/** Create an AgentCard for a Code Buddy agent */
export function createAgentCard(config: {
  name: string;
  description: string;
  skills: AgentSkill[];
  url?: string;
}): AgentCard {
  return {
    name: config.name,
    description: config.description,
    url: config.url || 'local://codebuddy',
    version: '1.0.0',
    skills: config.skills,
    capabilities: {
      streaming: false,
      pushNotifications: false,
    },
  };
}

/** Extract text from a task's last agent message */
export function getTaskResult(task: Task): string {
  // Check artifacts first
  if (task.artifacts.length > 0) {
    const lastArtifact = task.artifacts[task.artifacts.length - 1];
    const textParts = lastArtifact.parts.filter((p): p is TextPart => p.type === 'text');
    if (textParts.length > 0) return textParts.map((p) => p.text).join('\n');
  }

  // Fallback to last agent message
  const agentMessages = task.messages.filter((m) => m.role === 'agent');
  if (agentMessages.length > 0) {
    const last = agentMessages[agentMessages.length - 1];
    const textParts = last.parts.filter((p): p is TextPart => p.type === 'text');
    return textParts.map((p) => p.text).join('\n');
  }

  return task.status.message || '';
}
