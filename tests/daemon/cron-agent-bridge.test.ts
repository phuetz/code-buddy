import type { CronJob } from '../../src/scheduler/cron-scheduler.js';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const mocks = vi.hoisted(() => ({
  agentConstructorMock: vi.fn(),
  agentEntriesMock: vi.fn(() => [{ type: 'assistant', content: 'mock response' }]),
}));

let tmpHome: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => tmpHome };
});

// Mock the CodeBuddyAgent dynamic import used inside executeJob
vi.mock('../../src/agent/codebuddy-agent.js', () => ({
  CodeBuddyAgent: class MockCodeBuddyAgent {
    constructor(
      apiKey: string,
      baseURL?: string,
      model?: string,
      maxToolRounds?: number,
      useRAG?: boolean
    ) {
      mocks.agentConstructorMock(apiKey, baseURL, model, maxToolRounds, useRAG);
    }

    async processUserMessage() {
      return mocks.agentEntriesMock();
    }
  },
}));

import { CronAgentBridge, resetCronAgentBridge } from '../../src/daemon/cron-agent-bridge.js';

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

async function writeChatGptAuth(): Promise<void> {
  const dir = path.join(tmpHome, '.codebuddy');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'codex-auth.json'),
    JSON.stringify({ tokens: { access_token: 'test-access-token' } }),
  );
}

describe('CronAgentBridge', () => {
  let bridge: CronAgentBridge;

  beforeEach(async () => {
    resetCronAgentBridge();
    mocks.agentConstructorMock.mockReset();
    mocks.agentEntriesMock.mockReset();
    mocks.agentEntriesMock.mockReturnValue([{ type: 'assistant', content: 'mock response' }]);
    for (const key of envKeysToReset) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
    process.env.CODEBUDDY_PROVIDER = 'none';
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cron-agent-bridge-home-'));
    bridge = new CronAgentBridge({
      apiKey: 'test-key',
      baseURL: 'http://localhost:3000',
      model: 'test-model',
      maxToolRounds: 5,
      jobTimeoutMs: 10000,
    });
  });

  afterEach(async () => {
    for (const key of envKeysToReset) {
      if (envBackup[key] !== undefined) process.env[key] = envBackup[key];
      else delete process.env[key];
    }
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('should create a task executor function', () => {
    const executor = bridge.createTaskExecutor();
    expect(typeof executor).toBe('function');
  });

  it('should track active job count', () => {
    expect(bridge.getActiveJobCount()).toBe(0);
  });

  it('should cancel non-existent job gracefully', () => {
    expect(bridge.cancelJob('non-existent')).toBe(false);
  });

  it('should emit events on job execution', async () => {
    const events: string[] = [];
    bridge.on('job:start', () => events.push('start'));
    bridge.on('job:error', () => events.push('error'));

    const job: CronJob = {
      id: 'test-job',
      name: 'Test Job',
      type: 'every',
      schedule: { every: 60000 },
      task: { type: 'message', message: 'test' },
      status: 'active',
      createdAt: new Date(),
      runCount: 0,
      errorCount: 0,
      enabled: true,
    };

    // This will fail because CodeBuddyAgent requires a real API key
    // but we can verify events are emitted
    try {
      await bridge.executeJob(job);
    } catch {
      // Expected to fail
    }

    expect(events).toContain('start');
  });

  it('falls back to the detected ChatGPT provider when no bridge key is configured', async () => {
    process.env.CODEBUDDY_PROVIDER = 'chatgpt';
    await writeChatGptAuth();
    bridge = new CronAgentBridge({
      maxToolRounds: 5,
      jobTimeoutMs: 10000,
    });

    const job: CronJob = {
      id: 'test-job',
      name: 'Test Job',
      type: 'every',
      schedule: { every: 60000 },
      task: { type: 'message', message: 'test' },
      status: 'active',
      createdAt: new Date(),
      runCount: 0,
      errorCount: 0,
      enabled: true,
    };

    const result = await bridge.executeJob(job);

    expect(result.output).toBe('mock response');
    expect(mocks.agentConstructorMock).toHaveBeenCalledWith(
      'oauth-chatgpt',
      'https://chatgpt.com/backend-api/codex',
      'gpt-5.5',
      5,
      false
    );
  });

  it('fails the job when the agent produces no assistant response', async () => {
    mocks.agentEntriesMock.mockReturnValueOnce([]);

    const job: CronJob = {
      id: 'empty-job',
      name: 'Empty Job',
      type: 'every',
      schedule: { every: 60000 },
      task: { type: 'message', message: 'test' },
      status: 'active',
      createdAt: new Date(),
      runCount: 0,
      errorCount: 0,
      enabled: true,
    };

    await expect(bridge.executeJob(job)).rejects.toThrow('Cron job agent returned no assistant response');
  });

  it('should handle webhook delivery', async () => {
    const job: CronJob = {
      id: 'test-job',
      name: 'Test Job',
      type: 'every',
      schedule: { every: 60000 },
      task: { type: 'message', message: 'test' },
      delivery: { webhookUrl: 'http://localhost:9999/webhook' },
      status: 'active',
      createdAt: new Date(),
      runCount: 0,
      errorCount: 0,
      enabled: true,
    };

    // Webhook will fail (no server) but should not throw
    const result = await bridge.deliverResult(job, 'test output');
    // May or may not deliver depending on fetch behavior
    expect(result).toBeDefined();
  });

  it('should return not delivered when no delivery config', async () => {
    const job: CronJob = {
      id: 'test-job',
      name: 'Test Job',
      type: 'every',
      schedule: { every: 60000 },
      task: { type: 'message' },
      status: 'active',
      createdAt: new Date(),
      runCount: 0,
      errorCount: 0,
      enabled: true,
    };

    const result = await bridge.deliverResult(job, 'output');
    expect(result.delivered).toBe(false);
  });
});
