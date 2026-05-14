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

/** Yield payload for pause/resume orchestration */
export interface YieldPayload {
  /** Reason for yielding control */
  reason: string;
  /** State snapshot to inject into the next turn */
  state?: Record<string, unknown>;
  /** Suggested next action or prompt */
  resumeHint?: string;
  /** When the yield was issued */
  timestamp: number;
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
  /** Yield payload for orchestrator pause/resume (sessions_yield) */
  yieldPayload?: YieldPayload;
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

  /**
   * Yield a task — pause execution and save state for later resumption.
   * The orchestrator can inject a payload into the next turn.
   */
  yieldTask(taskId: string, payload: Omit<YieldPayload, 'timestamp'>): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status.status !== TaskStatus.WORKING) {
      return false;
    }

    task.yieldPayload = { ...payload, timestamp: Date.now() };
    this.updateTaskStatus(task, TaskStatus.INPUT_REQUIRED, `Yielded: ${payload.reason}`);
    this.emit('task:yielded', { taskId, reason: payload.reason });
    return true;
  }

  /**
   * Resume a yielded task with optional state injection.
   * Clears the yield payload and re-enters the executor.
   */
  async resumeTask(taskId: string, resumeMessage?: A2AMessage, injectedState?: Record<string, unknown>): Promise<Task> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    if (!task.yieldPayload) {
      throw new Error(`Task ${taskId} was not yielded`);
    }

    // Inject state into metadata for the executor to consume
    if (injectedState) {
      task.metadata = {
        ...(task.metadata || {}),
        __yield_state: JSON.stringify(injectedState),
      };
    }

    // Clear yield payload
    task.yieldPayload = undefined;

    if (resumeMessage) {
      task.messages.push(resumeMessage);
    }

    this.updateTaskStatus(task, TaskStatus.WORKING, 'Resumed after yield');
    this.emit('task:resumed', { taskId });

    try {
      const completed = await this.executor(task);
      this.updateTaskStatus(completed, TaskStatus.COMPLETED);
      this.emit('task:completed', { taskId });
      return completed;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.updateTaskStatus(task, TaskStatus.FAILED, error);
      this.emit('task:failed', { taskId, error });
      return task;
    }
  }

  private updateTaskStatus(task: Task, status: TaskStatus, message?: string): void {
    task.status = { status, message, timestamp: Date.now() };
    task.history.push({ ...task.status });
  }
}

/* ── Agent Client ── */

/** Remote agent advertised by another host (registered via HTTP, not in-process) */
export interface RemoteAgent {
  /** URL where the agent's tasks/send endpoint is reachable */
  url: string;
  /** Agent card as advertised at registration time */
  card: AgentCard;
  /** Last heartbeat timestamp (ms since epoch) */
  lastHeartbeat: number;
}

interface RemoteTaskResponse {
  id?: unknown;
  status?: unknown;
  result?: unknown;
  artifacts?: unknown;
  messages?: unknown;
  error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRemoteStatus(response: RemoteTaskResponse): TaskState {
  const status = response.status;
  let rawStatus: string | undefined;
  let message: string | undefined;

  if (typeof status === 'string') {
    rawStatus = status;
  } else if (isRecord(status)) {
    rawStatus = typeof status.status === 'string' ? status.status : undefined;
    message = typeof status.message === 'string' ? status.message : undefined;
  }

  if (!message && typeof response.error === 'string') {
    message = response.error;
  }

  switch ((rawStatus ?? '').toLowerCase()) {
    case 'submitted':
      return { status: TaskStatus.SUBMITTED, message, timestamp: Date.now() };
    case 'working':
      return { status: TaskStatus.WORKING, message, timestamp: Date.now() };
    case 'input-required':
    case 'input_required':
      return { status: TaskStatus.INPUT_REQUIRED, message, timestamp: Date.now() };
    case 'failed':
    case 'error':
      return { status: TaskStatus.FAILED, message, timestamp: Date.now() };
    case 'canceled':
    case 'cancelled':
      return { status: TaskStatus.CANCELED, message, timestamp: Date.now() };
    case 'completed':
    case '':
      break;
  }

  if (message && !response.result && !response.artifacts && !response.messages) {
    return { status: TaskStatus.FAILED, message, timestamp: Date.now() };
  }

  return { status: TaskStatus.COMPLETED, message, timestamp: Date.now() };
}

function extractRemoteResultText(response: RemoteTaskResponse): string | undefined {
  if (typeof response.result !== 'string') return undefined;
  const trimmed = response.result.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeRemoteArtifacts(response: RemoteTaskResponse): Artifact[] {
  if (Array.isArray(response.artifacts)) {
    return response.artifacts as Artifact[];
  }

  const resultText = extractRemoteResultText(response);
  if (!resultText) return [];

  return [{
    name: 'response',
    parts: [{ type: 'text', text: resultText }],
  }];
}

function normalizeRemoteMessages(request: string, response: RemoteTaskResponse): A2AMessage[] {
  const messages: A2AMessage[] = [
    { role: 'user', parts: [{ type: 'text', text: request }] },
  ];

  if (Array.isArray(response.messages)) {
    messages.push(...response.messages as A2AMessage[]);
    return messages;
  }

  const resultText = extractRemoteResultText(response);
  if (resultText) {
    messages.push({ role: 'agent', parts: [{ type: 'text', text: resultText }] });
  }

  return messages;
}

/**
 * A2A Agent Client — sends tasks to other agents.
 * Used by an orchestrator to delegate work to specialist agents.
 */
export class A2AAgentClient {
  private agents: Map<string, A2AAgentServer> = new Map();
  private remoteCards: Map<string, RemoteAgent> = new Map();

  /** Register a local agent (in-process, no HTTP) */
  registerAgent(key: string, agent: A2AAgentServer): void {
    this.agents.set(key, agent);
  }

  /** Register a remote agent advertised over HTTP (cross-host fleet) */
  registerRemoteCard(key: string, info: RemoteAgent): void {
    this.remoteCards.set(key, info);
  }

  /** Update lastHeartbeat for a registered remote agent — returns false if unknown */
  touchRemoteAgent(key: string): boolean {
    const e = this.remoteCards.get(key);
    if (!e) return false;
    e.lastHeartbeat = Date.now();
    return true;
  }

  /** List remote agents (cross-host) */
  listRemoteAgents(): Array<{ name: string } & RemoteAgent> {
    return Array.from(this.remoteCards.entries()).map(([name, info]) => ({ name, ...info }));
  }

  /** Drop a remote agent (e.g. on graceful shutdown notice) */
  unregisterRemoteAgent(key: string): boolean {
    return this.remoteCards.delete(key);
  }

  /** Discover an agent's capabilities */
  getAgentCard(key: string): AgentCard | undefined {
    return this.agents.get(key)?.getAgentCard() ?? this.remoteCards.get(key)?.card;
  }

  /** List all registered agent keys */
  listAgents(): string[] {
    return Array.from(this.agents.keys());
  }

  /** Find agents that can handle a specific skill (local + remote) */
  findAgentsWithSkill(skillId: string): string[] {
    const result: string[] = [];
    for (const [key, agent] of this.agents) {
      const card = agent.getAgentCard();
      if (card.skills.some((s) => s.id === skillId)) {
        result.push(key);
      }
    }
    for (const [key, info] of this.remoteCards) {
      if (info.card.skills.some((s) => s.id === skillId)) {
        result.push(key);
      }
    }
    return result;
  }

  /**
   * Resolve a task target from caller-supplied {agent, skill}.
   * V0.1 strategy: 'first' (deterministic, no hub state). V0.1.1 will
   * add round-robin (counter), V0.2 least-loaded.
   *
   * Returns either {agentKey} on success, or {error, status} on failure.
   * Pure function — no side effects, fully unit-testable. The HTTP
   * handler layer wraps this and translates {error, status} to res.
   */
  resolveTarget(opts: { agent?: string; skill?: string }): { agentKey: string } | { error: string; status: 400 | 404 } {
    const { agent, skill } = opts;
    if (agent && skill) {
      return { error: 'Provide either `agent` or `skill`, not both', status: 400 };
    }
    if (agent) {
      return { agentKey: agent };
    }
    if (skill) {
      // POC Niveau 3: Smart skill selection — find best spoke for this skill
      const best = this.findBestSpokeForSkill(skill);
      if (!best) {
        return { error: `No agents found for skill: ${skill}`, status: 404 };
      }
      return { agentKey: best };
    }
    return { error: 'Missing required field: `agent` or `skill`', status: 400 };
  }

  /** Score a spoke for a given skill (higher = better) */
  private scoreSpokeForSkill(spokeName: string, skillId: string): number {
    const remote = this.remoteCards.get(spokeName);
    if (!remote) return 0;

    // Base score: has the skill
    let score = 10;

    // Bonus for always-on spokes (assume names with "ministar" or "linux" are always-on)
    if (spokeName.toLowerCase().includes('ministar') || spokeName.toLowerCase().includes('linux')) {
      score += 5;
    }

    // Bonus for fresh heartbeat (last registered < 1 min ago)
    const heartbeatAge = Date.now() - remote.lastHeartbeat;
    if (heartbeatAge < 60000) {
      score += 3;
    }

    return score;
  }

  /** Find best spoke for a skill (smart selection) */
  findBestSpokeForSkill(skillId: string): string | null {
    const candidates = this.findAgentsWithSkill(skillId);
    if (candidates.length === 0) return null;

    // Score all spokes
    const scored = candidates
      .map((name) => ({ name, score: this.scoreSpokeForSkill(name, skillId) }))
      .sort((a, b) => b.score - a.score);

    return scored.length > 0 ? scored[0].name : null;
  }

  /** Submit a task to a specific agent (local or remote) */
  async submitTask(
    agentKey: string,
    request: string,
    metadata?: Record<string, string>
  ): Promise<Task> {
    // Try local agent first
    const agent = this.agents.get(agentKey);
    if (agent) {
      return agent.submitTask({
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        message: {
          role: 'user',
          parts: [{ type: 'text', text: request }],
        },
        metadata,
      });
    }

    // Try remote agent (spoke)
    const remote = this.remoteCards.get(agentKey);
    if (remote) {
      return this.submitTaskToRemote(agentKey, remote, request, metadata);
    }

    throw new Error(`Agent not found (local or remote): ${agentKey}`);
  }

  /** Submit a task to a remote agent via HTTP */
  private async submitTaskToRemote(
    agentKey: string,
    remote: RemoteAgent,
    request: string,
    metadata?: Record<string, string>
  ): Promise<Task> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const baseUrl = remote.url.replace(/\/+$/, '');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);

    try {
      // Forward the task to the remote spoke
      const response = await fetch(`${baseUrl}/api/a2a/tasks/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: taskId,
          message: { role: 'user', parts: [{ type: 'text', text: request }] },
          metadata,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const suffix = detail ? ` — ${detail.slice(0, 500)}` : '';
        throw new Error(`Remote task submission failed: ${response.status} ${response.statusText}${suffix}`);
      }

      const result = await response.json() as RemoteTaskResponse;
      const status = normalizeRemoteStatus(result);
      const remoteTaskId = typeof result.id === 'string' ? result.id : undefined;
      const taskMetadata: Record<string, string> = { ...metadata, agent: agentKey };
      if (remoteTaskId) taskMetadata.remoteTaskId = remoteTaskId;

      // Wrap remote response in a local Task object for consistency
      return {
        id: taskId,
        sessionId: `${agentKey}_${taskId}`,
        status,
        messages: normalizeRemoteMessages(request, result),
        artifacts: normalizeRemoteArtifacts(result),
        metadata: taskMetadata,
        history: [
          { status: TaskStatus.SUBMITTED, timestamp: Date.now() },
          status,
        ],
      };
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const error = isAbort
        ? `Remote task timed out after 120s (${agentKey})`
        : err instanceof Error ? err.message : String(err);
      return {
        id: taskId,
        sessionId: `${agentKey}_${taskId}`,
        status: { status: TaskStatus.FAILED, message: error, timestamp: Date.now() },
        messages: [{ role: 'user', parts: [{ type: 'text', text: request }] }],
        artifacts: [],
        metadata: { ...metadata, agent: agentKey },
        history: [
          { status: TaskStatus.SUBMITTED, timestamp: Date.now() },
          { status: TaskStatus.FAILED, message: error, timestamp: Date.now() },
        ],
      };
    } finally {
      clearTimeout(timeoutId);
    }
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
/**
 * Select one agent key from a list of candidates (POC Niveau 3 — skill routing).
 *
 * V0.1 strategy: 'first' (deterministic, zero hub state, debug-friendly).
 * V0.1.1 will add round-robin (hub-side counter), V0.2 least-loaded
 * (probe-based). The signature stays simple in V0.1 to ease testing.
 */
export function selectAgent(candidates: string[]): string {
  if (candidates.length === 0) {
    throw new Error('selectAgent: empty candidate list');
  }
  return candidates[0];
}

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
