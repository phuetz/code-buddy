/**
 * Collective Knowledge Graph injection is opt-in: CODEBUDDY_COLLECTIVE_MEMORY
 * must be the exact string 'true'. Any other value (unset, '1', 'yes') must
 * not put <collective_knowledge> into the chat context.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';
import type { ContextInjectionLevel } from '../../../src/agent/execution/query-classifier.js';

const { formatCollectiveContextMock } = vi.hoisted(() => ({
  formatCollectiveContextMock: vi.fn(async () =>
    '<collective_knowledge>\n- CB20_MARKER\n</collective_knowledge>',
  ),
}));

vi.mock('../../../src/config/feature-flags.js', () => ({
  isFeatureEnabled: () => false,
}));
vi.mock('../../../src/agent/lessons-tracker.js', () => ({
  getLessonsTracker: () => ({ buildContextBlock: () => null }),
}));
vi.mock('../../../src/agent/todo-tracker.js', () => ({
  getTodoTracker: () => ({ buildContextSuffix: () => null }),
}));
vi.mock('../../../src/memory/knowledge-graph.js', () => ({
  getKnowledgeGraph: () => ({
    load: async () => undefined,
    formatContextBlockSmart: () => null,
  }),
}));
vi.mock('../../../src/memory/collective-knowledge-graph.js', () => ({
  getCollectiveKnowledgeGraph: () => ({
    formatCollectiveContext: formatCollectiveContextMock,
  }),
}));

import {
  injectInitialContext,
  injectNextRoundContext,
} from '../../../src/agent/execution/context-pipeline.js';

const ctxLevel: ContextInjectionLevel = {
  workspace: false,
  lessons: false,
  knowledgeGraph: false,
  collectiveGraph: true,
  decisionMemory: false,
  icmMemory: false,
  codeGraph: false,
  docs: false,
  todo: false,
};

function deps() {
  return {
    message: 'how should I route the vocal agent model for production',
    cwd: '/tmp/ckg-gate',
    ctxLevel,
    loadWorkspaceContext: async () => '',
    decisionContextProvider: null,
    icmBridgeProvider: null,
    codeGraphContextProvider: null,
  };
}

describe('injectInitialContext — CODEBUDDY_COLLECTIVE_MEMORY gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    formatCollectiveContextMock.mockClear();
  });

  it('does not inject the collective graph when the env flag is unset', async () => {
    vi.stubEnv('CODEBUDDY_COLLECTIVE_MEMORY', '');
    const messages: CodeBuddyMessage[] = [];
    await injectInitialContext(messages, deps());
    expect(formatCollectiveContextMock).not.toHaveBeenCalled();
    expect(messages.map((m) => String(m.content ?? '')).join('\n')).not.toContain(
      '<collective_knowledge>',
    );
  });

  it('does not inject when the flag is "1" (only the exact string "true" enables it)', async () => {
    vi.stubEnv('CODEBUDDY_COLLECTIVE_MEMORY', '1');
    const messages: CodeBuddyMessage[] = [];
    await injectInitialContext(messages, deps());
    expect(formatCollectiveContextMock).not.toHaveBeenCalled();
    expect(messages.map((m) => String(m.content ?? '')).join('\n')).not.toContain(
      'CB20_MARKER',
    );
  });

  it('injects the collective graph only when the flag is exactly "true"', async () => {
    vi.stubEnv('CODEBUDDY_COLLECTIVE_MEMORY', 'true');
    const messages: CodeBuddyMessage[] = [];
    await injectInitialContext(messages, deps());
    expect(formatCollectiveContextMock).toHaveBeenCalledTimes(1);
    expect(messages.map((m) => String(m.content ?? '')).join('\n')).toContain(
      '<collective_knowledge>',
    );
    expect(messages.map((m) => String(m.content ?? '')).join('\n')).toContain('CB20_MARKER');
  });
});

describe('injectNextRoundContext — collective memory path', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    formatCollectiveContextMock.mockClear();
  });

  const nextDeps = {
    message: 'continue routing the vocal agent',
    cwd: '/tmp/ckg-gate',
    queryComplexity: 'complex' as const,
    collectiveGraph: true,
  };

  it('does not inject CKG on later rounds when the env flag is unset', async () => {
    vi.stubEnv('CODEBUDDY_COLLECTIVE_MEMORY', '');
    const messages: CodeBuddyMessage[] = [];
    await injectNextRoundContext(messages, nextDeps);
    expect(formatCollectiveContextMock).not.toHaveBeenCalled();
    expect(messages.map((m) => String(m.content ?? '')).join('\n')).not.toContain(
      '<collective_knowledge>',
    );
  });

  it('injects CKG on later rounds when the flag is exactly "true"', async () => {
    vi.stubEnv('CODEBUDDY_COLLECTIVE_MEMORY', 'true');
    const messages: CodeBuddyMessage[] = [];
    await injectNextRoundContext(messages, nextDeps);
    expect(formatCollectiveContextMock).toHaveBeenCalledTimes(1);
    expect(messages.map((m) => String(m.content ?? '')).join('\n')).toContain(
      '<collective_knowledge>',
    );
  });
});
