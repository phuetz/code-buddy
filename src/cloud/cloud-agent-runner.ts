/**
 * Cloud Agent Runner — Headless background agent task execution
 *
 * Accepts task descriptions (goal, context files, environment) and runs
 * the agent loop in headless mode (no Ink UI). Streams results via SSE
 * or polling. Saves results to disk (.codebuddy/runs/).
 *
 * Closes the gap with Cursor Background Agents, Codex CLI, and Native Engine.
 */

import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger.js';
import { RunStore } from '../observability/run-store.js';

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

export interface CloudTaskConfig {
  goal: string;
  model?: string;
  maxToolRounds?: number;
  contextFiles?: string[];
  environment?: Record<string, string>;
  timeout?: number; // ms, default 10 minutes
  notifyOnComplete?: string; // webhook URL
}

export type CloudTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface CloudTaskResult {
  id: string;
  status: CloudTaskStatus;
  goal: string;
  model?: string;
  startedAt: Date;
  completedAt?: Date;
  result?: string;
  error?: string;
  filesChanged?: string[];
  tokensUsed?: { input: number; output: number };
  cost?: number;
  toolCalls?: number;
  runId?: string;
}

export interface CloudTaskProgressEvent {
  taskId: string;
  type: 'status_change' | 'tool_call' | 'tool_result' | 'progress' | 'error' | 'completed';
  timestamp: number;
  data: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CONCURRENT_TASKS = 5;
const MAX_TOOL_ROUNDS_DEFAULT = 50;
const TASKS_DIR_NAME = 'cloud-tasks';

// ──────────────────────────────────────────────────────────────────
// CloudAgentRunner
// ──────────────────────────────────────────────────────────────────

export class CloudAgentRunner extends EventEmitter {
  private tasks: Map<string, CloudTaskResult> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private timeoutTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private progressEvents: Map<string, CloudTaskProgressEvent[]> = new Map();
  private tasksDir: string;
  private runStore: RunStore;

  constructor(tasksDir?: string) {
    super();
    this.tasksDir = tasksDir || path.join(os.homedir(), '.codebuddy', TASKS_DIR_NAME);
    this.ensureDir(this.tasksDir);
    this.runStore = RunStore.getInstance();
    this.loadPersistedTasks();
  }

  // ────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────

  /**
   * Submit a new background task. Returns the task ID immediately.
   */
  async submitTask(config: CloudTaskConfig): Promise<string> {
    // Validate
    if (!config.goal || typeof config.goal !== 'string' || config.goal.trim().length === 0) {
      throw new Error('Task goal is required and must be a non-empty string');
    }

    // Check concurrent task limit
    const runningCount = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'running' || t.status === 'pending'
    ).length;
    if (runningCount >= MAX_CONCURRENT_TASKS) {
      throw new Error(`Maximum concurrent tasks (${MAX_CONCURRENT_TASKS}) reached. Cancel or wait for existing tasks.`);
    }

    const taskId = this.generateTaskId();
    const now = new Date();

    const task: CloudTaskResult = {
      id: taskId,
      status: 'pending',
      goal: config.goal,
      model: config.model,
      startedAt: now,
      tokensUsed: { input: 0, output: 0 },
      cost: 0,
      toolCalls: 0,
    };

    this.tasks.set(taskId, task);
    this.progressEvents.set(taskId, []);
    this.persistTask(task);

    // Start execution asynchronously
    this.executeTask(taskId, config).catch((err) => {
      logger.error(`Cloud task ${taskId} execution error`, { error: String(err) });
    });

    return taskId;
  }

  /**
   * Get the current status and result of a task.
   */
  async getTaskStatus(taskId: string): Promise<CloudTaskResult> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task '${taskId}' not found`);
    }
    return { ...task };
  }

  /**
   * Cancel a running or pending task.
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task '${taskId}' not found`);
    }

    if (task.status !== 'running' && task.status !== 'pending') {
      return false; // Cannot cancel a completed/failed/cancelled task
    }

    // Signal abort
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
    }

    // Clear timeout
    const timer = this.timeoutTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(taskId);
    }

    task.status = 'cancelled';
    task.completedAt = new Date();
    this.persistTask(task);

    this.emitProgress(taskId, 'status_change', { status: 'cancelled' });

    logger.info(`Cloud task ${taskId} cancelled`);
    return true;
  }

  /**
   * List all tasks, most recent first.
   */
  async listTasks(limit = 50): Promise<CloudTaskResult[]> {
    return Array.from(this.tasks.values())
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit)
      .map((t) => ({ ...t }));
  }

  /**
   * Delete a task record (only if not running).
   */
  async deleteTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task '${taskId}' not found`);
    }

    if (task.status === 'running' || task.status === 'pending') {
      throw new Error('Cannot delete a running or pending task. Cancel it first.');
    }

    this.tasks.delete(taskId);
    this.progressEvents.delete(taskId);
    this.abortControllers.delete(taskId);

    // Remove persisted file
    const taskFile = path.join(this.tasksDir, `${taskId}.json`);
    try {
      if (fs.existsSync(taskFile)) {
        fs.unlinkSync(taskFile);
      }
    } catch {
      // Ignore
    }

    return true;
  }

  /**
   * Get progress events for a task (for SSE streaming).
   */
  getProgressEvents(taskId: string, afterIndex = 0): CloudTaskProgressEvent[] {
    const events = this.progressEvents.get(taskId);
    if (!events) return [];
    return events.slice(afterIndex);
  }

  /**
   * Get the logs for a task from the RunStore.
   */
  getTaskLogs(taskId: string): string {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task '${taskId}' not found`);
    }

    if (!task.runId) {
      return 'No run data available for this task.';
    }

    const events = this.runStore.getEvents(task.runId);
    if (events.length === 0) {
      return 'No events recorded for this run.';
    }

    return events
      .map((e) => {
        const ts = new Date(e.ts).toISOString();
        const dataStr = JSON.stringify(e.data);
        const truncated = dataStr.length > 200 ? dataStr.slice(0, 200) + '...' : dataStr;
        return `[${ts}] ${e.type}: ${truncated}`;
      })
      .join('\n');
  }

  // ────────────────────────────────────────────────────────────────
  // Task Execution
  // ────────────────────────────────────────────────────────────────

  private async executeTask(taskId: string, config: CloudTaskConfig): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const abortController = new AbortController();
    this.abortControllers.set(taskId, abortController);

    // Set timeout
    const timeoutMs = config.timeout ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      if (task.status === 'running' || task.status === 'pending') {
        logger.warn(`Cloud task ${taskId} timed out after ${timeoutMs}ms`);
        abortController.abort();
        task.status = 'failed';
        task.error = `Task timed out after ${Math.round(timeoutMs / 1000)}s`;
        task.completedAt = new Date();
        this.persistTask(task);
        this.emitProgress(taskId, 'error', { error: task.error });
      }
    }, timeoutMs);
    this.timeoutTimers.set(taskId, timer);

    // Transition to running
    task.status = 'running';
    this.persistTask(task);
    this.emitProgress(taskId, 'status_change', { status: 'running' });

    // Start a run in the RunStore
    const runId = this.runStore.startRun(config.goal, {
      tags: ['cloud-task'],
      sessionId: taskId,
    });
    task.runId = runId;

    try {
      // Check abort before heavy imports
      if (abortController.signal.aborted) {
        throw new Error('Task was cancelled');
      }

      // Lazy-load the agent infrastructure
      const { CodeBuddyClient } = await import('../codebuddy/client.js');
      const { getAllCodeBuddyTools } = await import('../codebuddy/tools.js');
      const { getSystemPromptForMode } = await import('../prompts/system-base.js');

      // Build system prompt
      const systemPrompt = getSystemPromptForMode('code');

      // Read context files
      let contextContent = '';
      if (config.contextFiles && config.contextFiles.length > 0) {
        for (const filePath of config.contextFiles) {
          try {
            const absPath = path.resolve(filePath);
            if (fs.existsSync(absPath)) {
              const content = fs.readFileSync(absPath, 'utf-8');
              const truncated = content.length > 50000 ? content.slice(0, 50000) + '\n... (truncated)' : content;
              contextContent += `\n\n--- ${filePath} ---\n${truncated}`;
            }
          } catch {
            // Skip unreadable files
          }
        }
      }

      // Build messages
      const userMessage = contextContent
        ? `${config.goal}\n\n<context_files>${contextContent}\n</context_files>`
        : config.goal;

      const messages: Array<Record<string, unknown>> = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ];

      // Get tool definitions
      const tools = await getAllCodeBuddyTools();

      // Set environment overrides
      if (config.environment) {
        for (const [key, value] of Object.entries(config.environment)) {
          // Only allow safe env var names
          if (/^[A-Z_][A-Z0-9_]*$/.test(key) && !['PATH', 'HOME', 'USER', 'SHELL'].includes(key)) {
            process.env[key] = value;
          }
        }
      }

      // Create client after environment overrides so background tasks can
      // provide provider credentials without mutating the parent process first.
      const { detectProviderFromEnv, selectModelForDetectedProvider } = await import('../utils/provider-detector.js');
      const provider = detectProviderFromEnv();
      if (!provider) {
        throw new Error('No AI provider configured. Run `buddy login chatgpt` or set a provider API key.');
      }
      const model = selectModelForDetectedProvider(provider, config.model) || provider.defaultModel;
      const client = new CodeBuddyClient(provider.apiKey, model, provider.baseURL);
      const maxRounds = config.maxToolRounds ?? MAX_TOOL_ROUNDS_DEFAULT;

      // Agent loop — simplified headless version
      let round = 0;
      const filesChanged = new Set<string>();

      while (round < maxRounds) {
        if (abortController.signal.aborted) {
          throw new Error('Task was cancelled');
        }

        round++;
        this.runStore.emit(runId, {
          type: 'step_start',
          data: { round, maxRounds },
        });

        this.emitProgress(taskId, 'progress', {
          round,
          maxRounds,
          message: `Round ${round}/${maxRounds}`,
        });

        // Call the LLM
        const response = await client.chat(
          messages as unknown as import('../codebuddy/client.js').CodeBuddyMessage[],
          tools,
          { model },
        );

        const choice = response?.choices?.[0];
        if (!choice) {
          task.error = 'No response from LLM';
          break;
        }

        // Track tokens
        if (response.usage) {
          task.tokensUsed = {
            input: (task.tokensUsed?.input || 0) + (response.usage.prompt_tokens || 0),
            output: (task.tokensUsed?.output || 0) + (response.usage.completion_tokens || 0),
          };
        }

        const assistantMsg = choice.message;
        messages.push(assistantMsg as Record<string, unknown>);

        // If no tool calls, we're done
        if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
          task.result = assistantMsg.content || '';
          break;
        }

        // Execute tool calls
        for (const toolCall of assistantMsg.tool_calls) {
          if (abortController.signal.aborted) {
            throw new Error('Task was cancelled');
          }

          const toolName = toolCall.function?.name;
          const toolArgs = toolCall.function?.arguments;
          task.toolCalls = (task.toolCalls || 0) + 1;

          this.runStore.emit(runId, {
            type: 'tool_call',
            data: { name: toolName, round },
          });

          this.emitProgress(taskId, 'tool_call', {
            name: toolName,
            round,
          });

          let toolResult: string;
          let toolSucceeded = false;
          try {
            // Lazy-load tool execution
            const { executeToolHeadless } = await import('./headless-tool-executor.js');
            const result = await executeToolHeadless(toolName, toolArgs, abortController.signal);
            toolSucceeded = result.success;
            toolResult = result.success
              ? (result.output || '(tool returned no output)')
              : `Error: ${result.error || 'tool failed without details'}`;

            // Track file changes
            if (result.filesChanged) {
              for (const f of result.filesChanged) {
                filesChanged.add(f);
              }
            }
          } catch (toolErr) {
            toolResult = `Error: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`;
          }

          this.runStore.emit(runId, {
            type: 'tool_result',
            data: { name: toolName, truncated: toolResult.slice(0, 500) },
          });

          this.emitProgress(taskId, 'tool_result', {
            name: toolName,
            success: toolSucceeded,
          });

          messages.push({
            role: 'tool',
            content: toolResult,
            tool_call_id: toolCall.id,
          });
        }
      }

      // Success
      if (task.status === 'running') {
        if (task.error) {
          task.status = 'failed';
        } else if (task.result === undefined) {
          task.status = 'failed';
          task.error = `Reached max tool rounds (${maxRounds}) without a final LLM response`;
        } else {
          task.status = 'completed';
        }
        task.completedAt = new Date();
        task.filesChanged = Array.from(filesChanged);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const currentStatus = task.status as string;
      if (currentStatus === 'running' || currentStatus === 'pending') {
        task.status = errorMsg.includes('cancelled') ? 'cancelled' : 'failed';
        task.error = errorMsg;
        task.completedAt = new Date();
      }
      logger.error(`Cloud task ${taskId} failed`, { error: errorMsg });
    } finally {
      // Cleanup
      clearTimeout(this.timeoutTimers.get(taskId));
      this.timeoutTimers.delete(taskId);
      this.abortControllers.delete(taskId);

      // End the run
      if (task.runId) {
        const runStatus = task.status === 'completed' ? 'completed'
          : task.status === 'cancelled' ? 'cancelled' : 'failed';
        this.runStore.endRun(task.runId, runStatus);
      }

      this.persistTask(task);
      this.emitProgress(taskId, 'completed', {
        status: task.status,
        result: task.result?.slice(0, 1000),
        error: task.error,
        filesChanged: task.filesChanged,
      });

      // Fire webhook if configured
      if (config.notifyOnComplete) {
        this.fireWebhook(config.notifyOnComplete, task).catch((err) => {
          logger.debug('Cloud task webhook failed', { error: String(err) });
        });
      }

      logger.info(`Cloud task ${taskId} finished with status: ${task.status}`);
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────

  private generateTaskId(): string {
    return `ctask_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  }

  private emitProgress(taskId: string, type: CloudTaskProgressEvent['type'], data: Record<string, unknown>): void {
    const event: CloudTaskProgressEvent = {
      taskId,
      type,
      timestamp: Date.now(),
      data,
    };

    const events = this.progressEvents.get(taskId);
    if (events) {
      events.push(event);
      // Keep max 500 events per task
      if (events.length > 500) {
        events.splice(0, events.length - 500);
      }
    }

    this.emit('progress', event);
  }

  private persistTask(task: CloudTaskResult): void {
    try {
      const taskFile = path.join(this.tasksDir, `${task.id}.json`);
      const serializable = {
        ...task,
        startedAt: task.startedAt.toISOString(),
        completedAt: task.completedAt?.toISOString(),
      };
      fs.writeFileSync(taskFile, JSON.stringify(serializable, null, 2));
    } catch {
      // Ignore persistence errors
    }
  }

  private loadPersistedTasks(): void {
    try {
      if (!fs.existsSync(this.tasksDir)) return;

      const files = fs.readdirSync(this.tasksDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(this.tasksDir, file), 'utf-8');
          const data = JSON.parse(content);

          const task: CloudTaskResult = {
            ...data,
            startedAt: new Date(data.startedAt),
            completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
          };

          // Mark any previously-running tasks as failed (they didn't complete cleanly)
          if (task.status === 'running' || task.status === 'pending') {
            task.status = 'failed';
            task.error = 'Task interrupted by process restart';
            task.completedAt = new Date();
          }

          this.tasks.set(task.id, task);
        } catch {
          // Skip malformed task files
        }
      }
    } catch {
      // Ignore
    }
  }

  private async fireWebhook(url: string, task: CloudTaskResult): Promise<void> {
    try {
      // Validate URL
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return;
      }

      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'cloud_task_completed',
          taskId: task.id,
          status: task.status,
          goal: task.goal,
          result: task.result?.slice(0, 2000),
          error: task.error,
          filesChanged: task.filesChanged,
          tokensUsed: task.tokensUsed,
          completedAt: task.completedAt?.toISOString(),
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      // Webhook fire-and-forget
    }
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Singleton
// ──────────────────────────────────────────────────────────────────

let _instance: CloudAgentRunner | null = null;

export function getCloudAgentRunner(): CloudAgentRunner {
  if (!_instance) {
    _instance = new CloudAgentRunner();
  }
  return _instance;
}

export function resetCloudAgentRunner(): void {
  _instance = null;
}
