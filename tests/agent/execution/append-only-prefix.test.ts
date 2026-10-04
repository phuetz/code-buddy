/**
 * Préfixe strict : la requête N+1 commence par la requête N, octet pour octet,
 * même si le dossier, la date, la mémoire et la liste de tâches changent
 * au milieu de la session. La compaction reste la seule réécriture permise.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentExecutor } from '../../../src/agent/execution/agent-executor.js';
import type { ExecutorConfig, ExecutorDependencies } from '../../../src/agent/execution/agent-executor.js';
import type { ChatEntry } from '../../../src/agent/types.js';
import type { CodeBuddyMessage } from '../../../src/codebuddy/client.js';
import { getTodoTracker } from '../../../src/agent/todo-tracker.js';

const QUERY = 'Corrige le bug du fichier calc.ts puis relance le test unitaire.';

interface Capture {
  messages: CodeBuddyMessage[];
  tools: unknown;
}

function promptFor(state: {
  directory: string;
  date: string;
  project: string;
  note: string;
}): string {
  return [
    'Consignes stables. Ne dépendent ni du jour ni du dossier.',
    '',
    '<persistent_memory>',
    `Project: ${state.project}`,
    `Note: ${state.note}`,
    '</persistent_memory>',
    '',
    '<context>',
    `- Current date: ${state.date}`,
    `- Working directory: ${state.directory}`,
    '- Platform: linux',
    '- Architecture: x64',
    '- Shell: bash',
    '</context>',
  ].join('\n');
}

function createDeps(
  capture: Capture[],
  cwd: () => string,
  rebuilt: () => string,
): ExecutorDependencies {
  return {
    client: {
      chat: vi.fn(),
      chatStream: vi.fn(async function* (messages: CodeBuddyMessage[], tools: unknown) {
        capture.push({
          messages: structuredClone(messages),
          tools: structuredClone(tools),
        });
        yield { choices: [{ delta: { content: 'ok' } }] };
      }),
      getCurrentModel: vi.fn().mockReturnValue('test-model'),
      getProviderName: vi.fn().mockReturnValue('openrouter'),
    } as unknown as ExecutorDependencies['client'],
    toolHandler: {
      executeTool: vi.fn(),
      executeToolStreaming: vi.fn(),
      getWorkingDirectory: () => cwd(),
    } as unknown as ExecutorDependencies['toolHandler'],
    toolSelectionStrategy: {
      selectToolsForQuery: vi.fn().mockResolvedValue({
        tools: [
          { type: 'function', function: { name: 'view_file', description: 'Lire', parameters: { type: 'object', properties: {} } } },
          { type: 'function', function: { name: 'search', description: 'Chercher', parameters: { type: 'object', properties: {} } } },
        ],
        selection: null,
        fromCache: false,
        query: QUERY,
        timestamp: new Date(),
      }),
      cacheTools: vi.fn(),
      shouldUseSearchFor: vi.fn().mockReturnValue(false),
      clearCache: vi.fn(),
      setActiveSkill: vi.fn(),
      expandCachedTools: vi.fn(),
    } as unknown as ExecutorDependencies['toolSelectionStrategy'],
    streamingHandler: {
      reset: vi.fn(),
      accumulateChunk: vi.fn().mockReturnValue({
        displayContent: 'ok',
        rawContent: 'ok',
        hasNewToolCalls: false,
        shouldEmitTokenCount: false,
      }),
      extractToolCalls: vi.fn().mockReturnValue({ toolCalls: [], remainingContent: '' }),
      getAccumulatedMessage: vi.fn().mockReturnValue({ content: 'ok', tool_calls: undefined }),
      getTokenCount: vi.fn().mockReturnValue(1),
      hasYieldedToolCalls: vi.fn().mockReturnValue(false),
    } as unknown as ExecutorDependencies['streamingHandler'],
    contextManager: {
      prepareMessages: vi.fn((msgs: CodeBuddyMessage[]) => msgs),
      prepareMessagesRaw: vi.fn((msgs: CodeBuddyMessage[]) => msgs),
      getContextEngine: vi.fn().mockReturnValue(null),
      shouldWarn: vi.fn().mockReturnValue({ warn: false }),
      shouldAutoCompact: vi.fn().mockReturnValue(false),
      getStats: vi.fn().mockReturnValue({ isNearLimit: false }),
    } as unknown as ExecutorDependencies['contextManager'],
    tokenCounter: {
      countTokens: vi.fn().mockReturnValue(1),
      countMessageTokens: vi.fn().mockReturnValue(1),
      dispose: vi.fn(),
    } as unknown as ExecutorDependencies['tokenCounter'],
    rebuildSystemPromptForQuery: async () => rebuilt(),
  };
}

const config: ExecutorConfig = {
  maxToolRounds: 4,
  isGrokModel: () => false,
  recordSessionCost: vi.fn(),
  isSessionCostLimitReached: () => false,
  estimateSessionCostLimitReached: () => false,
  getSessionCost: () => 0,
  getSessionCostLimit: () => 10,
};

describe('préfixe de requête en ajout seul', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('cinq tours restent un préfixe strict quand le dossier, la date, la mémoire et le todo changent', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T09:00:00Z'));

    const dirAlpha = await mkdtemp(path.join(os.tmpdir(), 'prefixe-alpha-'));
    const dirBeta = await mkdtemp(path.join(os.tmpdir(), 'prefixe-beta-'));
    dirs.push(dirAlpha, dirBeta);

    let directory = dirAlpha;
    let project = 'dossier-alpha';
    let note = 'memoire-stable';
    const capture: Capture[] = [];
    const history: ChatEntry[] = [];
    const messages: CodeBuddyMessage[] = [{
      role: 'system',
      content: promptFor({
        directory,
        date: '2026-10-04',
        project,
        note,
      }),
    }];

    const executor = new AgentExecutor(
      createDeps(capture, () => directory, () => promptFor({
        directory,
        date: new Date().toISOString().slice(0, 10),
        project,
        note,
      })),
      config,
    );

    for (let turn = 1; turn <= 5; turn++) {
      if (turn === 3) {
        vi.setSystemTime(new Date('2026-12-15T12:00:00Z'));
        directory = dirBeta;
        project = 'dossier-beta';
        note = 'memoire-apres-changement';
        getTodoTracker(dirBeta).add('Relancer le test de calcul');
      }
      messages.push({ role: 'user', content: QUERY });
      history.push({ type: 'user', content: QUERY, timestamp: new Date() });
      await executor.processUserMessage(QUERY, history, messages);
    }

    expect(capture).toHaveLength(5);
    const frozenTools = JSON.stringify(capture[0]?.tools);
    for (let i = 0; i < capture.length - 1; i++) {
      const prev = capture[i]?.messages ?? [];
      const next = capture[i + 1]?.messages ?? [];
      const prevJson = JSON.stringify(prev);
      const headJson = JSON.stringify(next.slice(0, prev.length));
      expect(headJson, `la requête ${i + 2} ne commence pas par la requête ${i + 1}`).toBe(prevJson);
      expect(next.length).toBeGreaterThan(prev.length);
      expect(JSON.stringify(capture[i + 1]?.tools)).toBe(frozenTools);
    }

    const first = JSON.stringify(capture[0]?.messages);
    const last = JSON.stringify(capture[4]?.messages);
    expect(first).toContain('memoire-stable');
    expect(first).toContain(dirAlpha);
    expect(first).toContain('2026-10-04');
    expect(first).not.toContain('memoire-apres-changement');
    expect(first).not.toContain(dirBeta);
    expect(last).toContain('memoire-apres-changement');
    expect(last).toContain(dirBeta);
    expect(last).toContain('2026-12-15');
    expect(last).toContain('dossier-beta');
    expect(last).toContain('Relancer le test de calcul');
    expect(JSON.stringify(capture[0]?.messages[0])).toBe(JSON.stringify(capture[4]?.messages[0]));
  }, 60_000);
});
