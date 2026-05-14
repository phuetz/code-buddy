/**
 * A2ABridge — Claude Cowork parity Phase 3 step 19 + GAP 1 (task polling)
 *
 * Local registry for remote A2A (Agent-to-Agent) agents. Resolves a
 * remote AgentCard by fetching `<url>/.well-known/agent.json`, persists
 * the card in `<userData>/a2a-registry.json`, and exposes:
 *
 *   - `invoke()` — POSTs a task payload to `<url>/tasks/send`, then
 *     polls `<url>/tasks/:taskId` (or subscribes via SSE if the agent
 *     advertises `capabilities.streaming`) until the task reaches a
 *     terminal status. Each transition is emitted as an
 *     `a2a.task.update` ServerEvent so Cowork's UI can render the
 *     full lifecycle (submitted → working → input-required → completed
 *     / failed / canceled).
 *   - `cancelTask()` — POSTs to `<url>/tasks/:taskId/cancel`.
 *   - `listTasks()` — returns currently-tracked tasks.
 *
 * The bridge does not depend on the core `A2AAgentClient` so Cowork
 * can manage its own remote-agent list without pulling the runtime
 * HTTP server into the Electron main process.
 *
 * @module main/a2a/a2a-bridge
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { app } from 'electron';
import { log, logWarn } from '../utils/logger';
import type { ServerEvent, A2ATask, A2ATaskStatus } from '../../renderer/types';

export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
}

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  skills: AgentSkill[];
  authentication?: { schemes: string[] };
  capabilities?: { streaming?: boolean; pushNotifications?: boolean };
}

export interface RegisteredAgent {
  id: string;
  url: string;
  addedAt: number;
  lastPingAt?: number;
  lastStatus?: 'ok' | 'error' | 'unknown';
  lastError?: string;
  card: AgentCard;
}

interface RegistryFile {
  agents: RegisteredAgent[];
}

interface TaskResponse {
  id?: string;
  status?: { status?: string; message?: string };
  messages?: Array<{ role?: string; parts?: Array<{ type?: string; text?: string }> }>;
}

interface TrackedTask {
  task: A2ATask;
  agentUrl: string;
  pollTimer?: NodeJS.Timeout;
  abortController?: AbortController;
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 10 * 60_000; // 10 min
const TERMINAL_STATUSES: ReadonlySet<A2ATaskStatus> = new Set([
  'completed',
  'failed',
  'canceled',
]);

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').slice(0, 64);
}

function normalizeStatus(raw: string | undefined): A2ATaskStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'submitted':
      return 'submitted';
    case 'working':
      return 'working';
    case 'input-required':
    case 'input_required':
      return 'input-required';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    default:
      return 'working';
  }
}

function extractAgentReply(task: TaskResponse | undefined): string | undefined {
  const reply = task?.messages?.find((m) => m.role === 'agent');
  if (!reply?.parts) return undefined;
  return reply.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n')
    .trim() || undefined;
}

export class A2ABridge {
  private readonly registryPath: string;
  private readonly sendToRenderer: ((event: ServerEvent) => void) | null;
  private agents: Map<string, RegisteredAgent> = new Map();
  private loaded = false;
  private tasks: Map<string, TrackedTask> = new Map();

  constructor(sendToRenderer?: (event: ServerEvent) => void) {
    this.sendToRenderer = sendToRenderer ?? null;
    const userData = app.isReady()
      ? app.getPath('userData')
      : path.join(os.homedir(), '.codebuddy-cowork');
    this.registryPath = path.join(userData, 'a2a-registry.json');
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.registryPath, 'utf-8');
      const parsed = JSON.parse(raw) as RegistryFile;
      for (const agent of parsed.agents ?? []) {
        this.agents.set(agent.id, agent);
      }
    } catch {
      // First launch
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
      const file: RegistryFile = { agents: Array.from(this.agents.values()) };
      await fs.writeFile(this.registryPath, JSON.stringify(file, null, 2), 'utf-8');
    } catch (err) {
      logWarn('[A2ABridge] save failed:', err);
    }
  }

  async list(): Promise<RegisteredAgent[]> {
    await this.load();
    return Array.from(this.agents.values()).sort((a, b) => b.addedAt - a.addedAt);
  }

  async discover(url: string): Promise<{ success: boolean; card?: AgentCard; error?: string }> {
    try {
      const base = url.replace(/\/$/, '');
      const cardUrl = `${base}/.well-known/agent.json`;
      const res = await fetch(cardUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status} ${res.statusText}` };
      }
      const card = (await res.json()) as AgentCard;
      if (!card.name || !card.url) {
        return { success: false, error: 'Invalid AgentCard (missing name or url)' };
      }
      return { success: true, card };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async add(
    url: string
  ): Promise<{ success: boolean; agent?: RegisteredAgent; error?: string }> {
    await this.load();
    const discovery = await this.discover(url);
    if (!discovery.success || !discovery.card) {
      return { success: false, error: discovery.error ?? 'Discovery failed' };
    }
    const id = sanitizeId(discovery.card.name);
    const registered: RegisteredAgent = {
      id,
      url,
      addedAt: Date.now(),
      lastPingAt: Date.now(),
      lastStatus: 'ok',
      card: discovery.card,
    };
    this.agents.set(id, registered);
    await this.save();
    log(`[A2ABridge] Registered agent ${id} from ${url}`);
    return { success: true, agent: registered };
  }

  async remove(id: string): Promise<{ success: boolean; removedTaskIds?: string[] }> {
    await this.load();
    if (!this.agents.has(id)) {
      return { success: false };
    }
    // Drop tasks owned by this agent so removed agents do not reappear in task history.
    const removedTaskIds: string[] = [];
    for (const [taskId, tracked] of this.tasks.entries()) {
      if (tracked.task.agentId === id) {
        this.stopPolling(taskId);
        this.tasks.delete(taskId);
        removedTaskIds.push(taskId);
      }
    }
    this.agents.delete(id);
    await this.save();
    return { success: true, removedTaskIds };
  }

  async ping(id: string): Promise<{ success: boolean; status?: string; error?: string }> {
    await this.load();
    const agent = this.agents.get(id);
    if (!agent) return { success: false, error: 'Agent not found' };
    const discovery = await this.discover(agent.url);
    agent.lastPingAt = Date.now();
    agent.lastStatus = discovery.success ? 'ok' : 'error';
    agent.lastError = discovery.error;
    if (discovery.card) {
      agent.card = discovery.card;
    }
    await this.save();
    return {
      success: discovery.success,
      status: agent.lastStatus,
      error: discovery.error,
    };
  }

  /**
   * Submit a task to a remote A2A agent. Returns immediately with the
   * task identifier. The terminal result (or failure) is delivered via
   * `a2a.task.update` ServerEvents — `result` is set on completion.
   */
  async invoke(
    id: string,
    message: string
  ): Promise<{ success: boolean; taskId?: string; status?: A2ATaskStatus; error?: string }> {
    await this.load();
    const agent = this.agents.get(id);
    if (!agent) return { success: false, error: 'Agent not found' };

    try {
      const base = agent.url.replace(/\/$/, '');
      const res = await fetch(`${base}/tasks/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: { role: 'user', parts: [{ type: 'text', text: message }] },
        }),
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status} ${res.statusText}` };
      }
      const taskResp = (await res.json()) as TaskResponse;
      const taskId = taskResp.id ?? `local-${Date.now()}`;
      const status = normalizeStatus(taskResp.status?.status);
      const result = extractAgentReply(taskResp);
      const now = Date.now();
      const task: A2ATask = {
        taskId,
        agentId: id,
        agentName: agent.card.name,
        status,
        startedAt: now,
        updatedAt: now,
        result,
      };
      const tracked: TrackedTask = { task, agentUrl: base };
      this.tasks.set(taskId, tracked);
      this.emitTaskUpdate(task);

      if (!TERMINAL_STATUSES.has(status)) {
        // Server returned non-terminal — start polling (or SSE if streaming).
        if (agent.card.capabilities?.streaming) {
          this.subscribeSSE(tracked);
        } else {
          this.startPolling(tracked);
        }
      }
      return { success: true, taskId, status };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async cancelTask(
    id: string,
    taskId: string
  ): Promise<{ success: boolean; error?: string }> {
    await this.load();
    const agent = this.agents.get(id);
    if (!agent) return { success: false, error: 'Agent not found' };
    const tracked = this.tasks.get(taskId);
    try {
      const base = agent.url.replace(/\/$/, '');
      const res = await fetch(`${base}/tasks/${encodeURIComponent(taskId)}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status} ${res.statusText}` };
      }
      if (tracked) {
        const updated: A2ATask = {
          ...tracked.task,
          status: 'canceled',
          updatedAt: Date.now(),
        };
        tracked.task = updated;
        this.stopPolling(taskId);
        this.emitTaskUpdate(updated);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async listTasks(): Promise<A2ATask[]> {
    return Array.from(this.tasks.values())
      .map((t) => ({ ...t.task }))
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  async clearTask(taskId: string): Promise<{ success: boolean }> {
    const tracked = this.tasks.get(taskId);
    if (!tracked) return { success: false };
    this.stopPolling(taskId);
    this.tasks.delete(taskId);
    return { success: true };
  }

  private emitTaskUpdate(task: A2ATask): void {
    if (!this.sendToRenderer) return;
    this.sendToRenderer({ type: 'a2a.task.update', payload: { ...task } });
  }

  private startPolling(tracked: TrackedTask): void {
    const taskId = tracked.task.taskId;
    const startedAt = Date.now();

    const poll = async () => {
      if (!this.tasks.has(taskId)) return; // removed
      try {
        const res = await fetch(
          `${tracked.agentUrl}/tasks/${encodeURIComponent(taskId)}`
        );
        if (!res.ok) {
          this.completeWithError(tracked, `HTTP ${res.status} ${res.statusText}`);
          return;
        }
        const data = (await res.json()) as TaskResponse;
        const newStatus = normalizeStatus(data.status?.status);
        const result = extractAgentReply(data);
        const changed =
          newStatus !== tracked.task.status ||
          (result && result !== tracked.task.result);
        if (changed) {
          const updated: A2ATask = {
            ...tracked.task,
            status: newStatus,
            updatedAt: Date.now(),
            result: result ?? tracked.task.result,
            error: data.status?.message && newStatus === 'failed'
              ? data.status.message
              : undefined,
          };
          tracked.task = updated;
          this.emitTaskUpdate(updated);
        }
        if (TERMINAL_STATUSES.has(newStatus)) {
          this.stopPolling(taskId);
          return;
        }
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          this.completeWithError(tracked, 'Polling timeout (10 min)');
          return;
        }
      } catch (err) {
        // Transient error — log but keep polling, the next tick may succeed
        logWarn(`[A2ABridge] poll(${taskId}) failed:`, err);
      }
    };

    tracked.pollTimer = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
  }

  private subscribeSSE(tracked: TrackedTask): void {
    // EventSource is browser API; in main process we use fetch + ReadableStream.
    const taskId = tracked.task.taskId;
    const ac = new AbortController();
    tracked.abortController = ac;

    void (async () => {
      try {
        const res = await fetch(
          `${tracked.agentUrl}/tasks/${encodeURIComponent(taskId)}/stream`,
          {
            headers: { accept: 'text/event-stream' },
            signal: ac.signal,
          }
        );
        if (!res.ok || !res.body) {
          // Fall back to polling
          logWarn(`[A2ABridge] SSE stream failed for ${taskId}, falling back to poll`);
          this.startPolling(tracked);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';
          for (const evt of events) {
            const dataLine = evt.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) continue;
            try {
              const data = JSON.parse(dataLine.slice(5).trim()) as TaskResponse;
              const newStatus = normalizeStatus(data.status?.status);
              const result = extractAgentReply(data);
              const updated: A2ATask = {
                ...tracked.task,
                status: newStatus,
                updatedAt: Date.now(),
                result: result ?? tracked.task.result,
              };
              tracked.task = updated;
              this.emitTaskUpdate(updated);
              if (TERMINAL_STATUSES.has(newStatus)) {
                this.stopPolling(taskId);
                return;
              }
            } catch {
              /* ignore parse errors */
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        logWarn(`[A2ABridge] SSE error for ${taskId}:`, err);
        this.startPolling(tracked); // fall back
      }
    })();
  }

  private completeWithError(tracked: TrackedTask, message: string): void {
    const updated: A2ATask = {
      ...tracked.task,
      status: 'failed',
      updatedAt: Date.now(),
      error: message,
    };
    tracked.task = updated;
    this.stopPolling(tracked.task.taskId);
    this.emitTaskUpdate(updated);
  }

  private stopPolling(taskId: string): void {
    const tracked = this.tasks.get(taskId);
    if (!tracked) return;
    if (tracked.pollTimer) {
      clearInterval(tracked.pollTimer);
      tracked.pollTimer = undefined;
    }
    if (tracked.abortController) {
      try {
        tracked.abortController.abort();
      } catch {
        /* ignore */
      }
      tracked.abortController = undefined;
    }
  }
}

let singleton: A2ABridge | null = null;

export function getA2ABridge(sendToRenderer?: (event: ServerEvent) => void): A2ABridge {
  if (!singleton) {
    singleton = new A2ABridge(sendToRenderer);
  }
  return singleton;
}
