/**
 * Cloud Agent Runner — Unit tests
 *
 * Tests task submission, lifecycle tracking, cancellation,
 * timeout handling, and result persistence.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  CloudAgentRunner,
  resetCloudAgentRunner,
} from '../../src/cloud/cloud-agent-runner.js';

let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = { ...actual, homedir: () => tmpHome };
  return { ...mocked, default: mocked };
});

// ──────────────────────────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────────────────────────

// Mock the RunStore
const mockRunStore = {
  startRun: vi.fn().mockReturnValue('run_test123'),
  endRun: vi.fn(),
  emit: vi.fn(),
  getInstance: vi.fn(),
  getEvents: vi.fn().mockReturnValue([
    { ts: Date.now(), runId: 'run_test123', type: 'run_start', data: { objective: 'test' } },
    { ts: Date.now(), runId: 'run_test123', type: 'step_start', data: { round: 1 } },
  ]),
};

vi.mock('../../src/observability/run-store.js', () => ({
  RunStore: {
    getInstance: () => mockRunStore,
  },
}));

// Mock the logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the headless tool executor
vi.mock('../../src/cloud/headless-tool-executor.js', () => ({
  executeToolHeadless: vi.fn().mockResolvedValue({
    success: true,
    output: 'Tool executed successfully',
  }),
}));

// Mock the LLM client — returns a response with no tool calls (single turn)
vi.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: vi.fn().mockImplementation(function () {
    return {
      chat: vi.fn().mockResolvedValue({
        choices: [{
          message: {
            role: 'assistant',
            content: 'Task completed successfully. I have analyzed the code.',
            tool_calls: undefined,
          },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    };
  }),
}));

// Mock the tool definitions
vi.mock('../../src/codebuddy/tools.js', () => ({
  getAllCodeBuddyTools: vi.fn().mockResolvedValue([
    { type: 'function', function: { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: {}, required: [] } } },
  ]),
  getToolDefinitions: vi.fn().mockReturnValue([
    { type: 'function', function: { name: 'read_file', description: 'Read a file' } },
  ]),
}));

// Mock the system prompt
vi.mock('../../src/prompts/system-base.js', () => ({
  getSystemPromptForMode: vi.fn().mockReturnValue('You are a helpful coding assistant.'),
}));

import { CodeBuddyClient } from '../../src/codebuddy/client.js';
import { executeToolHeadless } from '../../src/cloud/headless-tool-executor.js';

const MockCodeBuddyClient = CodeBuddyClient as unknown as ReturnType<typeof vi.fn>;
const MockExecuteToolHeadless = executeToolHeadless as unknown as ReturnType<typeof vi.fn>;

const envKeysToReset = [
  'CODEBUDDY_PROVIDER',
  'GROK_API_KEY',
  'GROK_MODEL',
  'XAI_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'OLLAMA_HOST',
  'OLLAMA_MODEL',
  'CHATGPT_MODEL',
];
const envBackup: Record<string, string | undefined> = {};

function writeChatGptAuth(): void {
  const dir = path.join(tmpHome, '.codebuddy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'codex-auth.json'),
    JSON.stringify({ tokens: { access_token: 'test-access-token' } }),
  );
}

// ──────────────────────────────────────────────────────────────────
// Test Suite
// ──────────────────────────────────────────────────────────────────

describe('CloudAgentRunner', () => {
  let runner: CloudAgentRunner;
  let testDir: string;

  beforeEach(() => {
    for (const key of envKeysToReset) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
    process.env.CODEBUDDY_PROVIDER = 'chatgpt';
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-agent-home-'));
    writeChatGptAuth();
    testDir = path.join(os.tmpdir(), `cloud-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    runner = new CloudAgentRunner(testDir);
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetCloudAgentRunner();
    for (const key of envKeysToReset) {
      if (envBackup[key] !== undefined) process.env[key] = envBackup[key];
      else delete process.env[key];
    }
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ────────────────────────────────────────────────────────────────
  // Task Submission
  // ────────────────────────────────────────────────────────────────

  describe('submitTask', () => {
    it('should return a task ID starting with ctask_', async () => {
      const taskId = await runner.submitTask({ goal: 'Write a test' });
      expect(taskId).toMatch(/^ctask_[a-z0-9]+_[a-f0-9]+$/);
    });

    it('should reject empty goal', async () => {
      await expect(runner.submitTask({ goal: '' })).rejects.toThrow('goal is required');
    });

    it('should reject whitespace-only goal', async () => {
      await expect(runner.submitTask({ goal: '   ' })).rejects.toThrow('goal is required');
    });

    it('should set initial status to pending', async () => {
      const taskId = await runner.submitTask({ goal: 'Analyze code' });
      const status = await runner.getTaskStatus(taskId);
      // Status will be 'pending' or 'running' depending on timing
      expect(['pending', 'running', 'completed']).toContain(status.status);
    });

    it('should persist task to disk', async () => {
      const taskId = await runner.submitTask({ goal: 'Persist test' });
      // Allow async execution to start
      await new Promise((r) => setTimeout(r, 50));

      const taskFile = path.join(testDir, `${taskId}.json`);
      expect(fs.existsSync(taskFile)).toBe(true);

      const persisted = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
      expect(persisted.id).toBe(taskId);
      expect(persisted.goal).toBe('Persist test');
    });

    it('should reject when max concurrent tasks reached', async () => {
      // Submit 5 tasks quickly (max concurrent)
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(runner.submitTask({ goal: `Task ${i}` }));
      }
      await Promise.all(promises);

      // 6th should fail
      await expect(runner.submitTask({ goal: 'One too many' })).rejects.toThrow(
        'Maximum concurrent tasks'
      );
    });

    it('should store model in task result', async () => {
      const taskId = await runner.submitTask({
        goal: 'Test model',
        model: 'grok-3-mini',
      });
      const status = await runner.getTaskStatus(taskId);
      expect(status.model).toBe('grok-3-mini');
    });

    it('should create the LLM client from the detected provider', async () => {
      const taskId = await runner.submitTask({ goal: 'Provider routing test' });
      await waitForCompletion(runner, taskId, 5000);

      expect(MockCodeBuddyClient).toHaveBeenCalledWith(
        'oauth-chatgpt',
        'gpt-5.5',
        'https://chatgpt.com/backend-api/codex',
      );
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Status Tracking
  // ────────────────────────────────────────────────────────────────

  describe('getTaskStatus', () => {
    it('should throw for unknown task ID', async () => {
      await expect(runner.getTaskStatus('ctask_nonexistent')).rejects.toThrow('not found');
    });

    it('should return task goal', async () => {
      const taskId = await runner.submitTask({ goal: 'My specific goal' });
      const status = await runner.getTaskStatus(taskId);
      expect(status.goal).toBe('My specific goal');
    });

    it('should track tokens used after completion', async () => {
      const taskId = await runner.submitTask({ goal: 'Token tracking test' });

      // Wait for execution to complete
      await waitForCompletion(runner, taskId, 5000);

      const status = await runner.getTaskStatus(taskId);
      expect(status.tokensUsed).toBeDefined();
      if (status.status === 'completed') {
        expect(status.tokensUsed!.input).toBeGreaterThan(0);
        expect(status.tokensUsed!.output).toBeGreaterThan(0);
      }
    });

    it('should fail when the LLM returns no choices', async () => {
      MockCodeBuddyClient.mockImplementationOnce(function () {
        return {
          chat: vi.fn().mockResolvedValue({
            choices: [],
            usage: { prompt_tokens: 10, completion_tokens: 0 },
          }),
        };
      });

      const taskId = await runner.submitTask({ goal: 'No choices test' });
      await waitForCompletion(runner, taskId, 5000);

      const status = await runner.getTaskStatus(taskId);
      expect(status.status).toBe('failed');
      expect(status.error).toBe('No response from LLM');
    });

    it('should fail when the LLM returns empty final content', async () => {
      MockCodeBuddyClient.mockImplementationOnce(function () {
        return {
          chat: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                role: 'assistant',
                content: '   ',
                tool_calls: undefined,
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 0 },
          }),
        };
      });

      const taskId = await runner.submitTask({ goal: 'Empty final response test' });
      await waitForCompletion(runner, taskId, 5000);

      const status = await runner.getTaskStatus(taskId);
      expect(status.status).toBe('failed');
      expect(status.error).toBe('LLM returned no final response content');
    });

    it('should fail when max tool rounds are exhausted without a final response', async () => {
      MockCodeBuddyClient.mockImplementationOnce(function () {
        return {
          chat: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [{
                  id: 'call_1',
                  function: { name: 'read_file', arguments: '{}' },
                }],
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        };
      });

      const taskId = await runner.submitTask({
        goal: 'Tool loop test',
        maxToolRounds: 1,
      });
      await waitForCompletion(runner, taskId, 5000);

      const status = await runner.getTaskStatus(taskId);
      expect(status.status).toBe('failed');
      expect(status.error).toContain('Reached max tool rounds');
    });

    it('should record failed tool calls as failed progress events', async () => {
      MockExecuteToolHeadless.mockResolvedValueOnce({
        success: false,
        error: 'tool exploded',
      });
      MockCodeBuddyClient.mockImplementationOnce(function () {
        const chat = vi.fn()
          .mockResolvedValueOnce({
            choices: [{
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [{
                  id: 'call_1',
                  function: { name: 'read_file', arguments: '{}' },
                }],
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          })
          .mockResolvedValueOnce({
            choices: [{
              message: {
                role: 'assistant',
                content: 'Final answer after tool failure.',
                tool_calls: undefined,
              },
            }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          });
        return { chat };
      });

      const taskId = await runner.submitTask({
        goal: 'Failed tool progress test',
        maxToolRounds: 2,
      });
      await waitForCompletion(runner, taskId, 5000);

      const status = await runner.getTaskStatus(taskId);
      expect(status.status).toBe('completed');
      const events = runner.getProgressEvents(taskId);
      const failedToolEvent = events.find((event) =>
        event.type === 'tool_result' &&
        event.data.name === 'read_file'
      );
      expect(failedToolEvent?.data.success).toBe(false);
    });

    it('should pass explicit silent tool success back to the LLM', async () => {
      MockExecuteToolHeadless.mockResolvedValueOnce({
        success: true,
        output: '   ',
      });
      const chat = vi.fn()
        .mockResolvedValueOnce({
          choices: [{
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{
                id: 'call_1',
                function: { name: 'read_file', arguments: '{}' },
              }],
            },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        })
        .mockResolvedValueOnce({
          choices: [{
            message: {
              role: 'assistant',
              content: 'Final answer after silent tool.',
              tool_calls: undefined,
            },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
      MockCodeBuddyClient.mockImplementationOnce(function () {
        return { chat };
      });

      const taskId = await runner.submitTask({
        goal: 'Silent tool output test',
        maxToolRounds: 2,
      });
      await waitForCompletion(runner, taskId, 5000);

      const status = await runner.getTaskStatus(taskId);
      expect(status.status).toBe('completed');
      const secondRoundMessages = chat.mock.calls[1][0] as Array<{ role: string; content?: string }>;
      const toolMessage = [...secondRoundMessages].reverse().find((message) => message.role === 'tool');
      expect(toolMessage).toMatchObject({
        role: 'tool',
        content: 'Tool completed successfully with no output.',
      });
    });

    it('should set completedAt when task finishes', async () => {
      const taskId = await runner.submitTask({ goal: 'Completion time test' });
      await waitForCompletion(runner, taskId, 5000);

      const status = await runner.getTaskStatus(taskId);
      if (status.status === 'completed' || status.status === 'failed') {
        expect(status.completedAt).toBeDefined();
        expect(status.completedAt).toBeInstanceOf(Date);
      }
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Cancellation
  // ────────────────────────────────────────────────────────────────

  describe('cancelTask', () => {
    it('should cancel a running task', async () => {
      const taskId = await runner.submitTask({ goal: 'Cancel me' });
      // Give it a moment to start
      await new Promise((r) => setTimeout(r, 20));

      const cancelled = await runner.cancelTask(taskId);
      // It might already be completed since our mock returns immediately
      if (cancelled) {
        const status = await runner.getTaskStatus(taskId);
        expect(status.status).toBe('cancelled');
      }
    });

    it('should return false for already completed task', async () => {
      const taskId = await runner.submitTask({ goal: 'Quick task' });
      await waitForCompletion(runner, taskId, 5000);

      const cancelled = await runner.cancelTask(taskId);
      expect(cancelled).toBe(false);
    });

    it('should throw for unknown task ID', async () => {
      await expect(runner.cancelTask('ctask_nonexistent')).rejects.toThrow('not found');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Listing
  // ────────────────────────────────────────────────────────────────

  describe('listTasks', () => {
    it('should return empty array when no tasks', async () => {
      const tasks = await runner.listTasks();
      expect(tasks).toEqual([]);
    });

    it('should return submitted tasks', async () => {
      await runner.submitTask({ goal: 'Task 1' });
      await runner.submitTask({ goal: 'Task 2' });

      const tasks = await runner.listTasks();
      expect(tasks.length).toBe(2);
    });

    it('should return most recent first', async () => {
      const id1 = await runner.submitTask({ goal: 'First task' });
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      const id2 = await runner.submitTask({ goal: 'Second task' });

      const tasks = await runner.listTasks();
      expect(tasks[0].id).toBe(id2);
      expect(tasks[1].id).toBe(id1);
    });

    it('should respect limit parameter', async () => {
      await runner.submitTask({ goal: 'Task 1' });
      await runner.submitTask({ goal: 'Task 2' });
      await runner.submitTask({ goal: 'Task 3' });

      const tasks = await runner.listTasks(2);
      expect(tasks.length).toBe(2);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Deletion
  // ────────────────────────────────────────────────────────────────

  describe('deleteTask', () => {
    it('should delete a completed task', async () => {
      const taskId = await runner.submitTask({ goal: 'Delete me' });
      await waitForCompletion(runner, taskId, 5000);

      const deleted = await runner.deleteTask(taskId);
      expect(deleted).toBe(true);

      await expect(runner.getTaskStatus(taskId)).rejects.toThrow('not found');
    });

    it('should throw for unknown task ID', async () => {
      await expect(runner.deleteTask('ctask_nonexistent')).rejects.toThrow('not found');
    });

    it('should remove persisted file on delete', async () => {
      const taskId = await runner.submitTask({ goal: 'Delete file test' });
      await waitForCompletion(runner, taskId, 5000);

      const taskFile = path.join(testDir, `${taskId}.json`);
      expect(fs.existsSync(taskFile)).toBe(true);

      await runner.deleteTask(taskId);
      expect(fs.existsSync(taskFile)).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Timeout Handling
  // ────────────────────────────────────────────────────────────────

  describe('timeout', () => {
    it('should accept custom timeout in config', async () => {
      const taskId = await runner.submitTask({
        goal: 'Timeout test',
        timeout: 60000, // 1 minute
      });
      const status = await runner.getTaskStatus(taskId);
      expect(status.id).toBe(taskId);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Progress Events
  // ────────────────────────────────────────────────────────────────

  describe('progress events', () => {
    it('should track progress events', async () => {
      const taskId = await runner.submitTask({ goal: 'Progress test' });
      await waitForCompletion(runner, taskId, 5000);

      const events = runner.getProgressEvents(taskId);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].taskId).toBe(taskId);
    });

    it('should return empty array for unknown task', () => {
      const events = runner.getProgressEvents('ctask_nonexistent');
      expect(events).toEqual([]);
    });

    it('should support afterIndex parameter', async () => {
      const taskId = await runner.submitTask({ goal: 'Offset test' });
      await waitForCompletion(runner, taskId, 5000);

      const allEvents = runner.getProgressEvents(taskId);
      const laterEvents = runner.getProgressEvents(taskId, 1);
      expect(laterEvents.length).toBe(allEvents.length - 1);
    });

    it('should emit events via EventEmitter', async () => {
      const events: unknown[] = [];
      runner.on('progress', (event) => events.push(event));

      const taskId = await runner.submitTask({ goal: 'Emitter test' });
      await waitForCompletion(runner, taskId, 5000);

      expect(events.length).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Persistence / Recovery
  // ────────────────────────────────────────────────────────────────

  describe('persistence', () => {
    it('should load persisted tasks on construction', async () => {
      const taskId = await runner.submitTask({ goal: 'Persist recovery test' });
      await waitForCompletion(runner, taskId, 5000);

      // Create a new runner with the same directory
      const runner2 = new CloudAgentRunner(testDir);
      const tasks = await runner2.listTasks();
      expect(tasks.length).toBeGreaterThanOrEqual(1);
      expect(tasks.some((t) => t.id === taskId)).toBe(true);
    });

    it('should mark previously running tasks as failed on restart', () => {
      // Write a "running" task to disk
      const fakeTask = {
        id: 'ctask_fake123',
        status: 'running',
        goal: 'I was running when process died',
        startedAt: new Date().toISOString(),
        tokensUsed: { input: 0, output: 0 },
      };
      fs.writeFileSync(
        path.join(testDir, 'ctask_fake123.json'),
        JSON.stringify(fakeTask),
      );

      // Create a new runner — it should mark the task as failed
      const runner2 = new CloudAgentRunner(testDir);
      const tasks = Array.from((runner2 as unknown as { tasks: Map<string, { status: string }> }).tasks.values());
      const recovered = tasks.find((t) => t.status === 'failed');
      expect(recovered).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────
  // RunStore Integration
  // ────────────────────────────────────────────────────────────────

  describe('RunStore integration', () => {
    it('should start a run in RunStore on task execution', async () => {
      const taskId = await runner.submitTask({ goal: 'RunStore test' });
      await waitForCompletion(runner, taskId, 5000);

      expect(mockRunStore.startRun).toHaveBeenCalledWith(
        'RunStore test',
        expect.objectContaining({ tags: ['cloud-task'] }),
      );
    });

    it('should end the run when task completes', async () => {
      const taskId = await runner.submitTask({ goal: 'End run test' });
      await waitForCompletion(runner, taskId, 5000);

      expect(mockRunStore.endRun).toHaveBeenCalledWith(
        'run_test123',
        expect.stringMatching(/completed|failed|cancelled/),
      );
    });

    it('should store runId on task result', async () => {
      const taskId = await runner.submitTask({ goal: 'RunId store test' });
      await waitForCompletion(runner, taskId, 5000);

      const status = await runner.getTaskStatus(taskId);
      expect(status.runId).toBe('run_test123');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Task Logs
  // ────────────────────────────────────────────────────────────────

  describe('getTaskLogs', () => {
    it('should throw for unknown task', () => {
      expect(() => runner.getTaskLogs('ctask_nonexistent')).toThrow('not found');
    });

    it('should return logs for completed task', async () => {
      const taskId = await runner.submitTask({ goal: 'Logs test' });
      await waitForCompletion(runner, taskId, 5000);

      const logs = runner.getTaskLogs(taskId);
      expect(typeof logs).toBe('string');
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

async function waitForCompletion(
  runner: CloudAgentRunner,
  taskId: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await runner.getTaskStatus(taskId);
    if (['completed', 'failed', 'cancelled'].includes(status.status)) {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
