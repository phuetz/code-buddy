import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const providerMocks = vi.hoisted(() => ({
  detectProviderFromEnv: vi.fn(),
}));

vi.mock('../../src/memory/persistent-memory.js', () => ({
  getMemoryManager: () => ({
    getStats: memoryMocks.getStats,
    getRecentMemories: memoryMocks.getRecentMemories,
  }),
}));

vi.mock('../../src/utils/provider-detector.js', () => ({
  detectProviderFromEnv: providerMocks.detectProviderFromEnv,
  selectModelForDetectedProvider: (
    detected: { provider: string; defaultModel: string } | null,
    configured?: string,
  ) => {
    if (!detected) return configured;
    if (configured && !(detected.provider !== 'grok' && /^grok[-_]/i.test(configured))) {
      return configured;
    }
    return detected.defaultModel;
  },
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

describe('handleStatus — Memory section (rc.2 extension)', () => {
  let envBackup: NodeJS.ProcessEnv;

  beforeEach(() => {
    envBackup = { ...process.env };
    delete process.env.YOLO_MODE;
    delete process.env.GROK_MODEL;
    providerMocks.detectProviderFromEnv.mockReturnValue(null);
    memoryMocks.getStats.mockReset();
    memoryMocks.getRecentMemories.mockReset();
  });

  afterEach(() => {
    process.env = envBackup;
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
    providerMocks.detectProviderFromEnv.mockReturnValue({
      provider: 'chatgpt',
      apiKey: 'oauth-chatgpt',
      baseURL: 'https://chatgpt.com/backend-api/codex',
      defaultModel: 'gpt-5.5',
    });
    memoryMocks.getStats.mockReturnValue({ project: 0, user: 0, total: 0 });
    memoryMocks.getRecentMemories.mockReturnValue([]);

    const c = (await handleStatus()).entry?.content as string;

    expect(c).toContain('Model:           gpt-5.5');
  });
});
