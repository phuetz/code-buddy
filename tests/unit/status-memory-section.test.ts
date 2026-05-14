import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Tests for the Memory section added to `/status` in this commit.
 *
 * The full `handleStatus` lives in `src/commands/handlers/missing-handlers.ts`
 * and was already shipped — this commit only EXTENDS it with a Memory line
 * surfacing the auto-memory writeback (a2a4f72). These tests focus on the
 * new section behavior, mocking the memory manager but letting the rest of
 * the handler exercise its real env-var paths.
 */

const memoryMocks = vi.hoisted(() => ({
  getStats: vi.fn(),
  getRecentMemories: vi.fn(),
}));

const testPaths = vi.hoisted(() => ({ tmpHome: '' }));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return { ...actual, homedir: () => testPaths.tmpHome || actual.homedir() };
});

vi.mock('../../src/memory/persistent-memory.js', () => ({
  getMemoryManager: () => ({
    getStats: memoryMocks.getStats,
    getRecentMemories: memoryMocks.getRecentMemories,
  }),
}));

// Heavy optional deps the handler tries to import — no-op them so we don't
// boot the whole agent runtime.
vi.mock('../../src/agent/operating-modes.js', () => ({
  getOperatingModeManager: () => ({ formatModeStatus: () => 'code' }),
}));
vi.mock('../../src/utils/cost-tracker.js', () => ({
  getCostTracker: () => ({
    getReport: () => ({ sessionCost: 0 }),
  }),
}));
vi.mock('../../src/config/model-tools.js', () => ({
  getModelToolConfig: () => ({ contextWindow: 131072 }),
}));
vi.mock('../../src/personas/persona-manager.js', () => ({
  getPersonaManager: () => ({ getActivePersona: () => null }),
}));
vi.mock('../../src/security/security-modes.js', () => ({
  getSecurityModeManager: () => ({ getMode: () => 'suggest' }),
}));
vi.mock('../../src/utils/autonomy-manager.js', () => ({
  getAutonomyManager: () => ({ getLevel: () => 'normal' }),
}));

import { handleStatus } from '../../src/commands/handlers/missing-handlers.js';

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

function writeChatGptAuth(): void {
  const dir = path.join(testPaths.tmpHome, '.codebuddy');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'codex-auth.json'),
    JSON.stringify({ tokens: { access_token: 'test-access-token' } }),
  );
}

function configureChatGptProvider(): void {
  process.env.CODEBUDDY_PROVIDER = 'chatgpt';
  writeChatGptAuth();
}

describe('handleStatus — Memory section (rc.2 extension)', () => {
  let envBackup: NodeJS.ProcessEnv;

  beforeEach(() => {
    envBackup = { ...process.env };
    for (const key of envKeysToReset) delete process.env[key];
    process.env.CODEBUDDY_PROVIDER = 'none';
    delete process.env.YOLO_MODE;
    testPaths.tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'status-memory-section-'));
    memoryMocks.getStats.mockReset();
    memoryMocks.getRecentMemories.mockReset();
  });

  afterEach(() => {
    process.env = envBackup;
    fs.rmSync(testPaths.tmpHome, { recursive: true, force: true });
    testPaths.tmpHome = '';
  });

  it('renders a Memory line with project + user counts and "never" when no entries', async () => {
    memoryMocks.getStats.mockReturnValue({ project: 0, user: 0, total: 0 });
    memoryMocks.getRecentMemories.mockReturnValue([]);

    const result = await handleStatus();
    expect(result.handled).toBe(true);
    const c = result.entry?.content as string;

    expect(c).toContain('Memory:');
    expect(c).toContain('0 project');
    expect(c).toContain('0 user');
    expect(c).toContain('last update: never');
  });

  it('renders the relative time of the most recent memory', async () => {
    memoryMocks.getStats.mockReturnValue({ project: 12, user: 4, total: 16 });
    memoryMocks.getRecentMemories.mockReturnValue([
      { updatedAt: new Date(Date.now() - 120_000) }, // 2 minutes ago
    ]);

    const c = (await handleStatus()).entry?.content as string;
    expect(c).toContain('12 project');
    expect(c).toContain('4 user');
    expect(c).toContain('2m ago');
  });

  it('omits the Memory line silently when getMemoryManager throws', async () => {
    memoryMocks.getStats.mockImplementation(() => {
      throw new Error('not initialized');
    });
    memoryMocks.getRecentMemories.mockImplementation(() => {
      throw new Error('not initialized');
    });

    const result = await handleStatus();
    // Status still returns successfully — Memory section is best-effort.
    expect(result.handled).toBe(true);
    const c = result.entry?.content as string;
    // Other sections still present
    expect(c).toContain('Status Dashboard');
    expect(c).toContain('Model:');
    // Memory line MUST be absent (silent skip on error)
    expect(c).not.toMatch(/Memory:\s+\d+/);
  });

  it('hint footer references /memory recent (UX guidance to the new feature)', async () => {
    memoryMocks.getStats.mockReturnValue({ project: 1, user: 1, total: 2 });
    memoryMocks.getRecentMemories.mockReturnValue([{ updatedAt: new Date() }]);

    const c = (await handleStatus()).entry?.content as string;
    expect(c).toContain('/memory recent');
  });

  it('shows the detected ChatGPT model instead of a stale Grok env default', async () => {
    process.env.GROK_MODEL = 'grok-code-fast-1';
    configureChatGptProvider();
    memoryMocks.getStats.mockReturnValue({ project: 0, user: 0, total: 0 });
    memoryMocks.getRecentMemories.mockReturnValue([]);

    const c = (await handleStatus()).entry?.content as string;

    expect(c).toContain('Model:           gpt-5.5');
  });
});
