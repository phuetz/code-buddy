import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

const { runUserDialecticInferenceMock, isFeatureEnabledMock, runSessionEndFlushMock } = vi.hoisted(() => ({
  runUserDialecticInferenceMock: vi.fn<any[], Promise<any>>(),
  isFeatureEnabledMock: vi.fn<[string], boolean>(),
  runSessionEndFlushMock: vi.fn<any[], Promise<any>>(),
}));

vi.mock('../../src/memory/user-model.js', () => ({
  runUserDialecticInference: runUserDialecticInferenceMock,
}));

vi.mock('../../src/agent/session-end-flush.js', () => ({
  runSessionEndFlush: runSessionEndFlushMock,
}));

vi.mock('../../src/config/feature-flags.js', () => ({
  isFeatureEnabled: isFeatureEnabledMock,
}));

import { CodeBuddyAgent } from '../../src/agent/codebuddy-agent.js';
import { createIsolatedHome } from '../helpers/isolated-home.js';

// CodeBuddyAgent starts memory and persona initialization asynchronously.
// Keep their isolated HOME until both have finished and the persona watcher is closed.
const isolatedHome = createIsolatedHome('dialectic-hook-home-');
beforeAll(() => {
  isolatedHome.enter();
});
afterAll(async () => {
  const { getMemoryManager, resetMemoryManagerForTests } = await import('../../src/memory/persistent-memory.js');
  const { getPersonaManager, resetPersonaManager } = await import('../../src/personas/persona-manager.js');
  try {
    await getMemoryManager().initialize().catch(() => undefined);
    await getPersonaManager().ready();
  } finally {
    resetMemoryManagerForTests();
    resetPersonaManager();
    isolatedHome.leave();
  }
});

describe('User Model Dialectic Hook on Session End (GAP-11)', () => {
  let previousHeadless: string | undefined;

  beforeEach(() => {
    previousHeadless = process.env.CODEBUDDY_HEADLESS;
    delete process.env.CODEBUDDY_HEADLESS;
    runUserDialecticInferenceMock.mockReset();
    isFeatureEnabledMock.mockReset();
    runSessionEndFlushMock.mockReset();
    runSessionEndFlushMock.mockResolvedValue({ proposedLessons: 0, openRisks: [], skipped: 'trivial' });
  });

  afterEach(() => {
    if (previousHeadless === undefined) delete process.env.CODEBUDDY_HEADLESS;
    else process.env.CODEBUDDY_HEADLESS = previousHeadless;
  });

  it('does not trigger runUserDialecticInference when USER_MODEL_DIALECTIC_ON_SESSION_END is disabled', async () => {
    isFeatureEnabledMock.mockImplementation((flag) => {
      if (flag === 'USER_MODEL_DIALECTIC_ON_SESSION_END') return false;
      return true;
    });

    const agent = new CodeBuddyAgent('test-api-key');
    // Simulate some messages in history
    agent.historyManager.setChatHistory([
      { type: 'user', content: 'hello', timestamp: new Date() },
      { type: 'assistant', content: 'hi', timestamp: new Date() }
    ]);

    agent.dispose();

    // Small delay to allow any floating promise to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(runUserDialecticInferenceMock).not.toHaveBeenCalled();
  });

  it('triggers runUserDialecticInference when USER_MODEL_DIALECTIC_ON_SESSION_END is enabled and history has messages', async () => {
    isFeatureEnabledMock.mockImplementation((flag) => {
      if (flag === 'USER_MODEL_DIALECTIC_ON_SESSION_END') return true;
      return true;
    });
    runUserDialecticInferenceMock.mockResolvedValue([{ id: '1', kind: 'preference', content: 'test', status: 'pending' }]);

    const agent = new CodeBuddyAgent('test-api-key');
    agent.historyManager.setChatHistory([
      { type: 'user', content: 'hello', timestamp: new Date() },
      { type: 'assistant', content: 'hi', timestamp: new Date() }
    ]);

    agent.dispose();

    // Small delay to allow any floating promise to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(runUserDialecticInferenceMock).toHaveBeenCalled();
    expect(runSessionEndFlushMock).toHaveBeenCalled();
  });

  it('does not trigger runUserDialecticInference if there are no messages in history', async () => {
    isFeatureEnabledMock.mockImplementation((flag) => {
      if (flag === 'USER_MODEL_DIALECTIC_ON_SESSION_END') return true;
      return true;
    });

    const agent = new CodeBuddyAgent('test-api-key');
    agent.historyManager.setChatHistory([]);

    agent.dispose();

    // Small delay to allow any floating promise to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(runUserDialecticInferenceMock).not.toHaveBeenCalled();
  });

  it('does not start async session learning work during headless disposal', async () => {
    process.env.CODEBUDDY_HEADLESS = 'true';
    isFeatureEnabledMock.mockImplementation((flag) => {
      if (flag === 'USER_MODEL_DIALECTIC_ON_SESSION_END') return true;
      return true;
    });
    runUserDialecticInferenceMock.mockResolvedValue([{ id: '1' }]);

    const agent = new CodeBuddyAgent('test-api-key');
    agent.historyManager.setChatHistory([
      { type: 'user', content: 'hello', timestamp: new Date() },
      { type: 'assistant', content: 'hi', timestamp: new Date() },
    ]);

    agent.dispose();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(runUserDialecticInferenceMock).not.toHaveBeenCalled();
    expect(runSessionEndFlushMock).not.toHaveBeenCalled();
  });
});
