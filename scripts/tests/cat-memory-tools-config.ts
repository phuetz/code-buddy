/**
 * Cat 96: Auto Memory Manager (6 tests, no API)
 * Cat 97: Memory Flush (6 tests, no API)
 * Cat 98: Code Quality Scorer (6 tests, no API)
 * Cat 99: Singleton Utility (6 tests, no API)
 * Cat 100: Config Constants (5 tests, no API)
 */

import type { TestDef } from './types.js';

// ============================================================================
// Cat 96: Auto Memory Manager
// ============================================================================

export function cat96AutoMemory(): TestDef[] {
  return [
    {
      name: '96.1-singleton-access',
      timeout: 5000,
      fn: async () => {
        const { getAutoMemoryManager, resetAutoMemory } = await import('../../src/memory/auto-memory.js');
        resetAutoMemory();
        const m1 = getAutoMemoryManager();
        const m2 = getAutoMemoryManager();
        const same = m1 === m2;
        resetAutoMemory();
        return { pass: same };
      },
    },
    {
      name: '96.2-write-and-list',
      timeout: 5000,
      fn: async () => {
        const { getAutoMemoryManager, resetAutoMemory } = await import('../../src/memory/auto-memory.js');
        resetAutoMemory();
        const mgr = getAutoMemoryManager();
        mgr.writeMemory('test-key', 'test-value', 'project');
        const memories = mgr.listMemories('project');
        const found = memories.some(m => m.key === 'test-key' && m.value === 'test-value');
        resetAutoMemory();
        return {
          pass: found,
          metadata: { count: memories.length },
        };
      },
    },
    {
      name: '96.3-delete-memory',
      timeout: 5000,
      fn: async () => {
        const { getAutoMemoryManager, resetAutoMemory } = await import('../../src/memory/auto-memory.js');
        resetAutoMemory();
        const mgr = getAutoMemoryManager();
        mgr.writeMemory('del-key', 'del-val', 'project');
        const deleted = mgr.deleteMemory('del-key', 'project');
        const memories = mgr.listMemories('project');
        const stillExists = memories.some(m => m.key === 'del-key');
        resetAutoMemory();
        return {
          pass: deleted === true && stillExists === false,
        };
      },
    },
    {
      name: '96.4-recall-memories',
      timeout: 5000,
      fn: async () => {
        const { getAutoMemoryManager, resetAutoMemory } = await import('../../src/memory/auto-memory.js');
        resetAutoMemory();
        const mgr = getAutoMemoryManager();
        mgr.writeMemory('pattern-key', 'use async patterns', 'project');
        const recalled = mgr.recallMemories('async');
        resetAutoMemory();
        return {
          pass: Array.isArray(recalled),
          metadata: { count: recalled.length },
        };
      },
    },
    {
      name: '96.5-get-memory-path',
      timeout: 5000,
      fn: async () => {
        const { getAutoMemoryManager, resetAutoMemory } = await import('../../src/memory/auto-memory.js');
        resetAutoMemory();
        const mgr = getAutoMemoryManager();
        const projectPath = mgr.getMemoryPath('project');
        const userPath = mgr.getMemoryPath('user');
        resetAutoMemory();
        return {
          pass: typeof projectPath === 'string' && typeof userPath === 'string' && projectPath !== userPath,
          metadata: { projectPath, userPath },
        };
      },
    },
    {
      name: '96.6-recall-summary',
      timeout: 5000,
      fn: async () => {
        const { getAutoMemoryManager, resetAutoMemory } = await import('../../src/memory/auto-memory.js');
        resetAutoMemory();
        const mgr = getAutoMemoryManager();
        const summary = mgr.getRecallSummary();
        resetAutoMemory();
        return {
          pass: typeof summary === 'string',
          metadata: { len: summary.length },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 97: Memory Flush
// ============================================================================

export function cat97MemoryFlush(): TestDef[] {
  return [
    {
      name: '97.1-pre-threshold-singleton',
      timeout: 5000,
      fn: async () => {
        const { PreThresholdFlusher } = await import('../../src/memory/memory-flush.js');
        PreThresholdFlusher.resetInstance();
        const f1 = PreThresholdFlusher.getInstance();
        const f2 = PreThresholdFlusher.getInstance();
        const same = f1 === f2;
        PreThresholdFlusher.resetInstance();
        return { pass: same };
      },
    },
    {
      name: '97.2-should-flush-below-threshold',
      timeout: 5000,
      fn: async () => {
        const { PreThresholdFlusher } = await import('../../src/memory/memory-flush.js');
        PreThresholdFlusher.resetInstance();
        const flusher = PreThresholdFlusher.getInstance();
        // At 50% of max, threshold default ~0.8, should NOT flush
        const shouldFlush = flusher.shouldFlush(50000, 100000);
        PreThresholdFlusher.resetInstance();
        return {
          pass: shouldFlush === false,
        };
      },
    },
    {
      name: '97.3-should-flush-above-threshold',
      timeout: 5000,
      fn: async () => {
        const { PreThresholdFlusher } = await import('../../src/memory/memory-flush.js');
        PreThresholdFlusher.resetInstance();
        const flusher = PreThresholdFlusher.getInstance();
        // At 90% of max, threshold ~0.8, should flush
        const shouldFlush = flusher.shouldFlush(90000, 100000);
        PreThresholdFlusher.resetInstance();
        return {
          pass: shouldFlush === true,
        };
      },
    },
    {
      name: '97.4-backend-manager-singleton',
      timeout: 5000,
      fn: async () => {
        const { MemoryBackendManager } = await import('../../src/memory/memory-flush.js');
        MemoryBackendManager.resetInstance();
        const m1 = MemoryBackendManager.getInstance();
        const m2 = MemoryBackendManager.getInstance();
        const same = m1 === m2;
        MemoryBackendManager.resetInstance();
        return { pass: same };
      },
    },
    {
      name: '97.5-register-backend',
      timeout: 5000,
      fn: async () => {
        const { MemoryBackendManager } = await import('../../src/memory/memory-flush.js');
        MemoryBackendManager.resetInstance();
        const mgr = MemoryBackendManager.getInstance();
        mgr.registerBackend({
          name: 'test-backend',
          search: () => [],
          index: () => {},
          clear: () => {},
        });
        const backends = mgr.listBackends();
        MemoryBackendManager.resetInstance();
        return {
          pass: backends.includes('test-backend'),
          metadata: { backends },
        };
      },
    },
    {
      name: '97.6-flush-count-tracking',
      timeout: 5000,
      fn: async () => {
        const { PreThresholdFlusher } = await import('../../src/memory/memory-flush.js');
        PreThresholdFlusher.resetInstance();
        const flusher = PreThresholdFlusher.getInstance();
        const count = flusher.getFlushCount();
        const lastTime = flusher.getLastFlushTime();
        PreThresholdFlusher.resetInstance();
        return {
          pass: typeof count === 'number' && count >= 0 && typeof lastTime === 'number',
          metadata: { count, lastTime },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 98: Code Quality Scorer
// ============================================================================

export function cat98CodeQualityScorer(): TestDef[] {
  return [
    {
      name: '98.1-analyze-simple-code',
      timeout: 5000,
      fn: async () => {
        const { analyzeCodeQualityString } = await import('../../src/tools/code-quality-scorer.js');
        const code = `function hello() {\n  return "world";\n}\n`;
        const report = analyzeCodeQualityString(code, 'typescript');
        return {
          pass: report.score.overall > 0 && report.metrics.linesOfCode > 0,
          metadata: { overall: report.score.overall, grade: report.score.grade, loc: report.metrics.linesOfCode },
        };
      },
    },
    {
      name: '98.2-grade-assignment',
      timeout: 5000,
      fn: async () => {
        const { analyzeCodeQualityString } = await import('../../src/tools/code-quality-scorer.js');
        const goodCode = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;
        const report = analyzeCodeQualityString(goodCode, 'typescript');
        return {
          pass: ['A', 'B', 'C', 'D', 'F'].includes(report.score.grade),
          metadata: { grade: report.score.grade, overall: report.score.overall },
        };
      },
    },
    {
      name: '98.3-detects-code-smells',
      timeout: 5000,
      fn: async () => {
        const { analyzeCodeQualityString } = await import('../../src/tools/code-quality-scorer.js');
        const smellyCode = `function x() {\n  const a = 42;\n  const b = 100;\n  if (true) {\n    if (true) {\n      if (true) {\n        return a + b + 999;\n      }\n    }\n  }\n}\n`;
        const report = analyzeCodeQualityString(smellyCode, 'typescript');
        return {
          pass: report.smells.length > 0 || report.metrics.maxNestingDepth >= 3 || report.metrics.magicNumbers > 0,
          metadata: { smells: report.smells.length, nesting: report.metrics.maxNestingDepth, magic: report.metrics.magicNumbers },
        };
      },
    },
    {
      name: '98.4-generates-suggestions',
      timeout: 5000,
      fn: async () => {
        const { analyzeCodeQualityString } = await import('../../src/tools/code-quality-scorer.js');
        const code = `function veryLongFunctionName() {\n${'  console.log("line");\n'.repeat(50)}}\n`;
        const report = analyzeCodeQualityString(code, 'typescript');
        return {
          pass: report.suggestions.length > 0,
          metadata: { suggestionCount: report.suggestions.length },
        };
      },
    },
    {
      name: '98.5-format-report',
      timeout: 5000,
      fn: async () => {
        const { analyzeCodeQualityString, formatQualityReport } = await import('../../src/tools/code-quality-scorer.js');
        const report = analyzeCodeQualityString('const x = 1;\n', 'typescript');
        const formatted = formatQualityReport({ ...report, filePath: 'test.ts' });
        return {
          pass: typeof formatted === 'string' && formatted.length > 0,
          metadata: { len: formatted.length },
        };
      },
    },
    {
      name: '98.6-metrics-shape',
      timeout: 5000,
      fn: async () => {
        const { analyzeCodeQualityString } = await import('../../src/tools/code-quality-scorer.js');
        const report = analyzeCodeQualityString('const a = 1;\nconst b = 2;\n', 'typescript');
        const m = report.metrics;
        return {
          pass: typeof m.complexity === 'number' &&
                typeof m.linesOfCode === 'number' &&
                typeof m.commentRatio === 'number' &&
                typeof m.functionCount === 'number' &&
                typeof m.maxNestingDepth === 'number',
          metadata: { complexity: m.complexity, loc: m.linesOfCode, functions: m.functionCount },
        };
      },
    },
  ];
}

// ============================================================================
// Cat 99: Singleton Utility
// ============================================================================

export function cat99SingletonUtility(): TestDef[] {
  return [
    {
      name: '99.1-create-singleton',
      timeout: 5000,
      fn: async () => {
        const { createSingleton } = await import('../../src/utils/singleton.js');
        let count = 0;
        const getSingleton = createSingleton(`test-${Date.now()}`, () => ({ id: ++count }));
        const a = getSingleton();
        const b = getSingleton();
        return {
          pass: a === b && a.id === 1,
        };
      },
    },
    {
      name: '99.2-resettable-singleton',
      timeout: 5000,
      fn: async () => {
        const { createResettableSingleton } = await import('../../src/utils/singleton.js');
        let count = 0;
        const { get, reset } = createResettableSingleton(`resettable-${Date.now()}`, () => ({ id: ++count }));
        const a = get();
        reset();
        const b = get();
        return {
          pass: a.id === 1 && b.id === 2 && a !== b,
        };
      },
    },
    {
      name: '99.3-lazy-singleton',
      timeout: 5000,
      fn: async () => {
        const { createLazySingleton } = await import('../../src/utils/singleton.js');
        let initialized = false;
        const lazy = createLazySingleton(() => {
          initialized = true;
          return { ready: true };
        });
        const beforeAccess = initialized;
        const val = lazy.value;
        return {
          pass: beforeAccess === false && val.ready === true && initialized === true,
        };
      },
    },
    {
      name: '99.4-has-singleton',
      timeout: 5000,
      fn: async () => {
        const { createSingleton, hasSingleton } = await import('../../src/utils/singleton.js');
        const key = `has-check-${Date.now()}`;
        const before = hasSingleton(key);
        createSingleton(key, () => 42)();
        const after = hasSingleton(key);
        return {
          pass: before === false && after === true,
        };
      },
    },
    {
      name: '99.5-module-singleton',
      timeout: 5000,
      fn: async () => {
        const { moduleSingleton } = await import('../../src/utils/singleton.js');
        let count = 0;
        const { getInstance, resetInstance, hasInstance } = moduleSingleton(() => ({ n: ++count }));
        const noBefore = hasInstance();
        const a = getInstance();
        const hasAfter = hasInstance();
        resetInstance();
        const noAfterReset = hasInstance();
        const b = getInstance();
        return {
          pass: noBefore === false && hasAfter === true && noAfterReset === false && a.n === 1 && b.n === 2,
        };
      },
    },
    {
      name: '99.6-peek-singleton',
      timeout: 5000,
      fn: async () => {
        const { createSingleton, peekSingleton } = await import('../../src/utils/singleton.js');
        const key = `peek-${Date.now()}`;
        const beforePeek = peekSingleton(key);
        createSingleton(key, () => ({ val: 'peeked' }))();
        const afterPeek = peekSingleton<{ val: string }>(key);
        return {
          pass: beforePeek === undefined && afterPeek?.val === 'peeked',
        };
      },
    },
  ];
}

// ============================================================================
// Cat 100: Config Constants
// ============================================================================

export function cat100ConfigConstants(): TestDef[] {
  return [
    {
      name: '100.1-agent-config-exists',
      timeout: 5000,
      fn: async () => {
        const { AGENT_CONFIG } = await import('../../src/config/constants.js');
        return {
          pass: typeof AGENT_CONFIG.MAX_TOOL_ROUNDS === 'number' &&
                typeof AGENT_CONFIG.DEFAULT_TEMPERATURE === 'number',
          metadata: { maxRounds: AGENT_CONFIG.MAX_TOOL_ROUNDS, temp: AGENT_CONFIG.DEFAULT_TEMPERATURE },
        };
      },
    },
    {
      name: '100.2-supported-models-populated',
      timeout: 5000,
      fn: async () => {
        const { SUPPORTED_MODELS } = await import('../../src/config/constants.js');
        const modelNames = Object.keys(SUPPORTED_MODELS);
        return {
          pass: modelNames.length >= 3,
          metadata: { count: modelNames.length, first3: modelNames.slice(0, 3) },
        };
      },
    },
    {
      name: '100.3-api-config-defaults',
      timeout: 5000,
      fn: async () => {
        const { API_CONFIG } = await import('../../src/config/constants.js');
        return {
          pass: typeof API_CONFIG.DEFAULT_BASE_URL === 'string' &&
                typeof API_CONFIG.DEFAULT_MODEL === 'string' &&
                typeof API_CONFIG.REQUEST_TIMEOUT === 'number' &&
                typeof API_CONFIG.MAX_RETRIES === 'number',
          metadata: { baseUrl: API_CONFIG.DEFAULT_BASE_URL, model: API_CONFIG.DEFAULT_MODEL },
        };
      },
    },
    {
      name: '100.4-server-config',
      timeout: 5000,
      fn: async () => {
        const { SERVER_CONFIG } = await import('../../src/config/constants.js');
        return {
          pass: typeof SERVER_CONFIG.DEFAULT_PORT === 'number' &&
                typeof SERVER_CONFIG.DEFAULT_HOST === 'string',
          metadata: { port: SERVER_CONFIG.DEFAULT_PORT, host: SERVER_CONFIG.DEFAULT_HOST },
        };
      },
    },
    {
      name: '100.5-error-and-success-messages',
      timeout: 5000,
      fn: async () => {
        const { ERROR_MESSAGES, SUCCESS_MESSAGES } = await import('../../src/config/constants.js');
        return {
          pass: Object.keys(ERROR_MESSAGES).length > 0 && Object.keys(SUCCESS_MESSAGES).length > 0,
          metadata: { errors: Object.keys(ERROR_MESSAGES).length, successes: Object.keys(SUCCESS_MESSAGES).length },
        };
      },
    },
  ];
}
