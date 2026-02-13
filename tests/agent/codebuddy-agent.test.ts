/**
 * Comprehensive Tests for CodeBuddyAgent
 *
 * Tests the main agent orchestrator that coordinates conversation
 * with the LLM, tool execution, model routing, skill matching,
 * YOLO mode, abort handling, and session cost management.
 */

import { CodeBuddyAgent } from '../../src/agent/codebuddy-agent';
import type { ChatEntry, StreamingChunk } from '../../src/agent/types';

// ---------------------------------------------------------------------------
// Mock all external dependencies
// ---------------------------------------------------------------------------

const mockChat = jest.fn();
const mockChatStream = jest.fn();
const mockGetCurrentModel = jest.fn().mockReturnValue('grok-code-fast-1');
const mockSetModel = jest.fn();
const mockProbeToolSupport = jest.fn().mockResolvedValue(true);

jest.mock('../../src/codebuddy/client.js', () => ({
  CodeBuddyClient: jest.fn().mockImplementation(() => ({
    chat: mockChat,
    chatStream: mockChatStream,
    getCurrentModel: mockGetCurrentModel,
    setModel: mockSetModel,
    probeToolSupport: mockProbeToolSupport,
  })),
}));

jest.mock('../../src/codebuddy/tools.js', () => ({
  getAllCodeBuddyTools: jest.fn().mockReturnValue([]),
  getRelevantTools: jest.fn().mockResolvedValue({
    tools: [],
    selectedTools: [],
    savedTokens: 0,
    categories: [],
    confidence: 1,
  }),
  getMCPManager: jest.fn().mockReturnValue({
    getClients: jest.fn().mockReturnValue([]),
    getTools: jest.fn().mockReturnValue([]),
  }),
  initializeMCPServers: jest.fn().mockResolvedValue(undefined),
  classifyQuery: jest.fn().mockReturnValue({ categories: ['general'], confidence: 0.8 }),
  getToolSelector: jest.fn().mockReturnValue({
    classifyQuery: jest.fn().mockReturnValue({ categories: ['general'] }),
    selectTools: jest.fn().mockReturnValue({ tools: [], savedTokens: 0 }),
  }),
  getSkillAugmentedTools: jest.fn().mockReturnValue([]),
}));

jest.mock('../../src/tools/tool-selector.js', () => ({
  recordToolRequest: jest.fn(),
  formatToolSelectionMetrics: jest.fn().mockReturnValue('Metrics: OK'),
  getToolSelector: jest.fn().mockReturnValue({
    classifyQuery: jest.fn().mockReturnValue({ categories: ['general'] }),
    selectTools: jest.fn().mockReturnValue({ tools: [], savedTokens: 0 }),
  }),
}));

jest.mock('../../src/mcp/config.js', () => ({
  loadMCPConfig: jest.fn().mockReturnValue(null),
}));

const mockBashExecute = jest.fn().mockResolvedValue({ success: true, output: 'done' });
const mockBashGetCurrentDirectory = jest.fn().mockReturnValue('/test');
const mockBashSetSelfHealing = jest.fn();
const mockBashIsSelfHealingEnabled = jest.fn().mockReturnValue(true);

jest.mock('../../src/tools/index.js', () => ({
  TextEditorTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, output: 'Done' }),
    view: jest.fn().mockResolvedValue({ success: true, output: 'file content' }),
    create: jest.fn().mockResolvedValue({ success: true, output: 'Created' }),
  })),
  MorphEditorTool: jest.fn().mockImplementation(() => null),
  BashTool: jest.fn().mockImplementation(() => ({
    execute: mockBashExecute,
    executeStreaming: jest.fn(),
    getCurrentDirectory: mockBashGetCurrentDirectory,
    setSelfHealing: mockBashSetSelfHealing,
    isSelfHealingEnabled: mockBashIsSelfHealingEnabled,
  })),
  ImageTool: jest.fn().mockImplementation(() => ({
    processImage: jest.fn().mockResolvedValue({ success: true, output: 'Image processed' }),
    isImage: jest.fn().mockReturnValue(false),
  })),
}));

jest.mock('../../src/utils/token-counter.js', () => ({
  createTokenCounter: jest.fn().mockReturnValue({
    countTokens: jest.fn().mockReturnValue(100),
    countMessageTokens: jest.fn().mockReturnValue(50),
    dispose: jest.fn(),
  }),
  TokenCounter: jest.fn(),
}));

jest.mock('../../src/utils/custom-instructions.js', () => ({
  loadCustomInstructions: jest.fn().mockReturnValue(null),
}));

jest.mock('../../src/checkpoints/checkpoint-manager.js', () => ({
  getCheckpointManager: jest.fn().mockReturnValue({
    createCheckpoint: jest.fn().mockResolvedValue('checkpoint-1'),
    restoreCheckpoint: jest.fn().mockResolvedValue(true),
    listCheckpoints: jest.fn().mockReturnValue([]),
  }),
  CheckpointManager: jest.fn(),
}));

jest.mock('../../src/persistence/session-store.js', () => ({
  getSessionStore: jest.fn().mockReturnValue({
    updateCurrentSession: jest.fn(),
    getCurrentSessionId: jest.fn().mockReturnValue('session-123'),
    loadSession: jest.fn().mockReturnValue(null),
    saveSession: jest.fn(),
  }),
  SessionStore: jest.fn(),
}));

jest.mock('../../src/agent/agent-mode.js', () => ({
  getAgentModeManager: jest.fn().mockReturnValue({
    getMode: jest.fn().mockReturnValue('code'),
    setMode: jest.fn(),
    isToolAllowed: jest.fn().mockReturnValue(true),
    formatModeStatus: jest.fn().mockReturnValue('Mode: code'),
  }),
  AgentModeManager: jest.fn(),
}));

jest.mock('../../src/security/sandbox.js', () => ({
  getSandboxManager: jest.fn().mockReturnValue({
    validateCommand: jest.fn().mockReturnValue({ valid: true }),
    formatStatus: jest.fn().mockReturnValue('Sandbox: active'),
  }),
  SandboxManager: jest.fn(),
}));

jest.mock('../../src/mcp/mcp-client.js', () => ({
  getMCPClient: jest.fn().mockReturnValue({
    isConnected: jest.fn().mockReturnValue(false),
    connect: jest.fn().mockResolvedValue(undefined),
    listTools: jest.fn().mockResolvedValue([]),
  }),
  MCPClient: jest.fn(),
}));

jest.mock('../../src/utils/settings-manager.js', () => ({
  getSettingsManager: jest.fn().mockReturnValue({
    getCurrentModel: jest.fn().mockReturnValue('grok-code-fast-1'),
    setCurrentModel: jest.fn(),
    getSettings: jest.fn().mockReturnValue({}),
  }),
}));

jest.mock('../../src/prompts/index.js', () => ({
  getSystemPromptForMode: jest.fn().mockReturnValue('You are a helpful assistant.'),
  getChatOnlySystemPrompt: jest.fn().mockReturnValue('You are a chat assistant.'),
  getPromptManager: jest.fn().mockReturnValue({
    buildSystemPrompt: jest.fn().mockResolvedValue('System prompt'),
    loadPrompt: jest.fn().mockResolvedValue('Prompt content'),
  }),
  autoSelectPromptId: jest.fn().mockReturnValue('default'),
}));

jest.mock('../../src/utils/cost-tracker.js', () => ({
  getCostTracker: jest.fn().mockReturnValue({
    calculateCost: jest.fn().mockReturnValue(0.001),
    recordUsage: jest.fn(),
    getTotalCost: jest.fn().mockReturnValue(0.05),
    formatCostSummary: jest.fn().mockReturnValue('Total: $0.05'),
    getReport: jest.fn().mockReturnValue({
      totalCost: 0.05,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      requestCount: 5,
      recentUsage: [],
    }),
  }),
  CostTracker: jest.fn(),
}));

jest.mock('../../src/utils/autonomy-manager.js', () => ({
  getAutonomyManager: jest.fn().mockReturnValue({
    isYOLOEnabled: jest.fn().mockReturnValue(false),
    enableYOLO: jest.fn(),
    disableYOLO: jest.fn(),
  }),
}));

jest.mock('../../src/context/context-manager-v2.js', () => ({
  createContextManager: jest.fn().mockReturnValue({
    getStats: jest.fn().mockReturnValue({
      totalTokens: 1000,
      maxTokens: 100000,
      usagePercent: 1,
    }),
    addMessage: jest.fn(),
    getMessages: jest.fn().mockReturnValue([]),
    dispose: jest.fn(),
    updateConfig: jest.fn(),
    prepareMessages: jest.fn().mockImplementation((msgs: unknown[]) => msgs),
    shouldWarn: jest.fn().mockReturnValue({ warn: false }),
    forceCleanup: jest.fn().mockReturnValue({ summariesRemoved: 0, tokensFreed: 0 }),
    getMemoryMetrics: jest.fn().mockReturnValue({
      summaryCount: 0,
      summaryTokens: 0,
      peakMessageCount: 0,
      compressionCount: 0,
      totalTokensSaved: 0,
    }),
  }),
  ContextManagerV2: jest.fn(),
}));

jest.mock('../../src/utils/sanitize.js', () => ({
  sanitizeLLMOutput: jest.fn().mockImplementation((text: string) => text),
  extractCommentaryToolCalls: jest.fn().mockReturnValue({ commentary: null, toolCalls: [] }),
  sanitizeToolResult: jest.fn().mockImplementation((text: string) => text),
}));

jest.mock('../../src/errors/index.js', () => ({
  getErrorMessage: jest.fn().mockImplementation((err: unknown) => (err as Error)?.message || String(err)),
}));

jest.mock('../../src/concurrency/lane-queue.js', () => ({
  getLaneQueue: jest.fn().mockReturnValue({
    enqueue: jest.fn().mockImplementation((_lane: string, fn: () => unknown) => fn()),
    pause: jest.fn(),
    resume: jest.fn(),
    getStats: jest.fn(),
  }),
  resetLaneQueue: jest.fn(),
}));

jest.mock('../../src/skills/index.js', () => ({
  findSkill: jest.fn().mockReturnValue(null),
}));

jest.mock('../../src/skills/adapters/index.js', () => ({
  skillMdToUnified: jest.fn().mockReturnValue({
    name: 'test-skill',
    description: 'Test',
    systemPrompt: 'Skill prompt',
  }),
}));

jest.mock('../../src/optimization/prompt-cache.js', () => ({
  getPromptCacheManager: jest.fn().mockReturnValue({
    getCacheStats: jest.fn().mockReturnValue({ hits: 0, misses: 0 }),
    formatStats: jest.fn().mockReturnValue('Cache: empty'),
  }),
  PromptCacheManager: jest.fn(),
}));

jest.mock('../../src/hooks/lifecycle-hooks.js', () => ({
  getHooksManager: jest.fn().mockReturnValue({
    runHook: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockReturnValue('Hooks: none'),
  }),
  HooksManager: jest.fn(),
}));

jest.mock('../../src/optimization/model-routing.js', () => ({
  getModelRouter: jest.fn().mockReturnValue({
    route: jest.fn().mockReturnValue({
      recommendedModel: 'grok-code-fast-1',
      reason: 'default',
      estimatedCost: 0.001,
    }),
    recordUsage: jest.fn(),
    getStats: jest.fn().mockReturnValue({}),
    formatStats: jest.fn().mockReturnValue('Router: idle'),
  }),
  ModelRouter: jest.fn(),
}));

jest.mock('../../src/plugins/marketplace.js', () => ({
  getPluginMarketplace: jest.fn().mockReturnValue({
    getTools: jest.fn().mockReturnValue([]),
    executeTool: jest.fn().mockResolvedValue({ success: false, error: 'not found' }),
  }),
  PluginMarketplace: jest.fn(),
}));

jest.mock('../../src/agent/execution/repair-coordinator.js', () => ({
  getRepairCoordinator: jest.fn().mockReturnValue({
    isRepairEnabled: jest.fn().mockReturnValue(false),
    setRepairEnabled: jest.fn(),
    attemptRepair: jest.fn().mockResolvedValue({ attempted: false, success: false, fixes: [] }),
    setExecutors: jest.fn(),
    dispose: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  }),
  RepairCoordinator: jest.fn(),
}));

jest.mock('../../src/hooks/moltbot-hooks.js', () => ({
  getMoltbotHooksManager: jest.fn().mockReturnValue({
    getIntroManager: jest.fn().mockReturnValue({
      loadIntro: jest.fn().mockResolvedValue({ content: null, sources: [] }),
    }),
  }),
  MoltbotHooksManager: jest.fn(),
}));

jest.mock('../../src/services/prompt-builder.js', () => ({
  PromptBuilder: jest.fn().mockImplementation(() => ({
    buildSystemPrompt: jest.fn().mockResolvedValue('You are a helpful AI coding assistant.'),
    updateConfig: jest.fn(),
  })),
}));

jest.mock('../../src/analytics/cost-predictor.js', () => ({
  CostPredictor: jest.fn().mockImplementation(() => ({
    predict: jest.fn().mockReturnValue({
      model: 'grok-code-fast-1',
      estimatedCost: 0.001,
      estimatedInputTokens: 500,
      estimatedOutputTokens: 200,
      confidence: 0.8,
    }),
  })),
}));

jest.mock('../../src/analytics/budget-alerts.js', () => {
  const EventEmitter = require('events');
  return {
    BudgetAlertManager: jest.fn().mockImplementation(() => {
      const emitter = new EventEmitter();
      emitter.check = jest.fn().mockReturnValue([]);
      emitter.setThresholds = jest.fn();
      emitter.getThresholds = jest.fn().mockReturnValue([]);
      return emitter;
    }),
  };
});

jest.mock('../../src/memory/index.js', () => ({
  getEnhancedMemory: jest.fn().mockReturnValue({
    setProjectContext: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn(),
    store: jest.fn().mockResolvedValue({}),
    search: jest.fn().mockResolvedValue([]),
    getStats: jest.fn().mockReturnValue({ totalMemories: 0, byType: {}, projects: 0, summaries: 0 }),
  }),
  EnhancedMemory: jest.fn(),
}));

jest.mock('../../src/security/tool-policy/index.js', () => ({
  getPolicyManager: jest.fn().mockReturnValue({
    evaluate: jest.fn().mockReturnValue({ allowed: true }),
  }),
}));

jest.mock('../../src/security/trust-folders.js', () => ({
  getTrustFolderManager: jest.fn().mockReturnValue({
    isTrusted: jest.fn().mockReturnValue(true),
  }),
}));

jest.mock('../../src/tools/hooks/index.js', () => ({
  getToolHooksManager: jest.fn().mockReturnValue({
    runBeforeHooks: jest.fn().mockResolvedValue({ proceed: true }),
    runAfterHooks: jest.fn().mockResolvedValue(undefined),
  }),
  registerDefaultHooks: jest.fn(),
  setCurrentProvider: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CodeBuddyAgent', () => {
  let agent: CodeBuddyAgent;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.YOLO_MODE;
    delete process.env.MAX_COST;
    delete process.env.MORPH_API_KEY;
    delete process.env.CODEBUDDY_MAX_CONTEXT;

    // Default mock: simple response with no tool calls
    mockChat.mockResolvedValue({
      choices: [{ message: { content: 'Hello! How can I help?', tool_calls: null } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    mockChatStream.mockImplementation(async function* () {
      yield { choices: [{ delta: { content: 'Hello' } }] };
      yield { choices: [{ delta: { content: '!' } }] };
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    if (agent) {
      try { agent.dispose(); } catch { /* ignore */ }
    }
  });

  // =========================================================================
  // Constructor
  // =========================================================================

  describe('Constructor', () => {
    it('should create agent with API key', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent).toBeInstanceOf(CodeBuddyAgent);
    });

    it('should create agent with custom model', () => {
      agent = new CodeBuddyAgent('test-api-key', undefined, 'grok-2');
      expect(agent).toBeInstanceOf(CodeBuddyAgent);
    });

    it('should create agent with custom base URL', () => {
      agent = new CodeBuddyAgent('test-api-key', 'https://custom.api.com');
      expect(agent).toBeInstanceOf(CodeBuddyAgent);
    });

    it('should set default max tool rounds to 50', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect((agent as any).maxToolRounds).toBe(50);
    });

    it('should set custom max tool rounds', () => {
      agent = new CodeBuddyAgent('test-api-key', undefined, undefined, 100);
      expect((agent as any).maxToolRounds).toBe(100);
    });

    it('should set default session cost limit to $10', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect((agent as any).sessionCostLimit).toBe(10);
    });

    it('should use MAX_COST env var for session limit', () => {
      process.env.MAX_COST = '25';
      agent = new CodeBuddyAgent('test-api-key');
      expect((agent as any).sessionCostLimit).toBe(25);
    });

    it('should enable RAG tool selection by default', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect((agent as any).useRAGToolSelection).toBe(true);
    });

    it('should allow disabling RAG tool selection', () => {
      agent = new CodeBuddyAgent('test-api-key', undefined, undefined, undefined, false);
      expect((agent as any).useRAGToolSelection).toBe(false);
    });

    it('should resolve systemPromptReady after initialization', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await expect(agent.systemPromptReady).resolves.toBeUndefined();
    });

    it('should have a system message after systemPromptReady resolves', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;
      const messages = (agent as any).messages;
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages[0].role).toBe('system');
    });
  });

  // =========================================================================
  // YOLO Mode
  // =========================================================================

  describe('YOLO Mode', () => {
    it('should not enable YOLO mode by default', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect((agent as any).yoloMode).toBe(false);
    });

    it('should not enable YOLO mode with env var alone (requires config)', () => {
      process.env.YOLO_MODE = 'true';
      agent = new CodeBuddyAgent('test-api-key');
      expect((agent as any).yoloMode).toBe(false);
    });

    it('should update maxToolRounds when YOLO is toggled on', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.setYoloMode(true);
      expect((agent as any).maxToolRounds).toBe(400);
    });

    it('should restore maxToolRounds when YOLO is toggled off', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.setYoloMode(true);
      agent.setYoloMode(false);
      expect((agent as any).maxToolRounds).toBe(50);
    });

    it('should set sessionCostLimit to Infinity when YOLO is on', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.setYoloMode(true);
      expect((agent as any).sessionCostLimit).toBe(Infinity);
    });

    it('should restore sessionCostLimit to $10 when YOLO is off', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.setYoloMode(true);
      agent.setYoloMode(false);
      expect((agent as any).sessionCostLimit).toBe(10);
    });

    it('should report YOLO mode status', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.isYoloModeEnabled()).toBe(false);
      agent.setYoloMode(true);
      expect(agent.isYoloModeEnabled()).toBe(true);
    });
  });

  // =========================================================================
  // processUserMessage (sequential)
  // =========================================================================

  describe('processUserMessage', () => {
    it('should return user entry and assistant entry for simple message', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      const entries = await agent.processUserMessage('Hello');
      expect(entries.length).toBeGreaterThanOrEqual(2);
      expect(entries[0].type).toBe('user');
      expect(entries[0].content).toBe('Hello');
      // There should be an assistant entry somewhere in the result
      const assistantEntry = entries.find(e => e.type === 'assistant');
      expect(assistantEntry).toBeDefined();
      expect(assistantEntry!.content).toBe('Hello! How can I help?');
    });

    it('should add user message to chat history', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      await agent.processUserMessage('Test message');
      const history = agent.getChatHistory();
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history.some(e => e.type === 'user' && e.content === 'Test message')).toBe(true);
    });

    it('should add user message to LLM messages', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      await agent.processUserMessage('Test message');
      const messages = (agent as any).messages;
      const userMsg = messages.find((m: any) => m.role === 'user' && m.content === 'Test message');
      expect(userMsg).toBeDefined();
    });

    it('should handle tool calls from LLM', async () => {
      const toolCalls = [{
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'read_file', arguments: '{"path":"/test.txt"}' },
      }];

      // First call returns tool call, second call returns final response
      mockChat
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Let me read that file.', tool_calls: toolCalls } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Here is the file content.', tool_calls: null } }],
          usage: { prompt_tokens: 200, completion_tokens: 60 },
        });

      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      const entries = await agent.processUserMessage('Read test.txt');
      // Should have: user, assistant(tool call), tool_result, assistant(final)
      const toolResultEntry = entries.find(e => e.type === 'tool_result');
      expect(toolResultEntry).toBeDefined();

      const finalAssistant = entries.filter(e => e.type === 'assistant');
      expect(finalAssistant.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle API errors gracefully', async () => {
      mockChat.mockRejectedValueOnce(new Error('API rate limited'));

      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      const entries = await agent.processUserMessage('Hello');
      // User entry + error entry
      expect(entries.length).toBeGreaterThanOrEqual(1);
      const errorEntry = entries.find(e => e.type === 'assistant' && e.content.includes('error'));
      expect(errorEntry).toBeDefined();
    });

    it('should clear tool selection cache on each new message', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      const clearCache = jest.spyOn((agent as any).toolSelectionStrategy, 'clearCache');
      await agent.processUserMessage('Hello');
      expect(clearCache).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // processUserMessageStream (streaming)
  // =========================================================================

  describe('processUserMessageStream', () => {
    it('should yield streaming chunks', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      const chunks: StreamingChunk[] = [];
      for await (const chunk of agent.processUserMessageStream('Hello')) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
    });

    it('should yield a token_count chunk first', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      const chunks: StreamingChunk[] = [];
      for await (const chunk of agent.processUserMessageStream('Hello')) {
        chunks.push(chunk);
      }

      expect(chunks[0].type).toBe('token_count');
    });

    it('should yield a done chunk at the end', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      const chunks: StreamingChunk[] = [];
      for await (const chunk of agent.processUserMessageStream('Hello')) {
        chunks.push(chunk);
      }

      const doneChunk = chunks.find(c => c.type === 'done');
      expect(doneChunk).toBeDefined();
    });

    it('should set abortController during streaming', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      let controllerDuringStream: AbortController | null = null;
      const gen = agent.processUserMessageStream('Hello');
      const first = await gen.next();
      controllerDuringStream = (agent as any).abortController;
      // consume remaining
      while (!(await gen.next()).done) { /* drain */ }

      expect(controllerDuringStream).not.toBeNull();
    });

    it('should clean up abortController after streaming completes', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      for await (const _ of agent.processUserMessageStream('Hello')) {
        // consume all
      }

      expect((agent as any).abortController).toBeNull();
    });

    it('should add user message to history during streaming', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      for await (const _ of agent.processUserMessageStream('Stream test')) {
        // consume
      }

      const history = agent.getChatHistory();
      expect(history.some(e => e.type === 'user' && e.content === 'Stream test')).toBe(true);
    });

    it('should handle abort during streaming', async () => {
      // Create a slow stream
      mockChatStream.mockImplementation(async function* () {
        yield { choices: [{ delta: { content: 'Hello' } }] };
        await new Promise(r => setTimeout(r, 500));
        yield { choices: [{ delta: { content: ' world' } }] };
      });

      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      const chunks: StreamingChunk[] = [];
      for await (const chunk of agent.processUserMessageStream('Hello')) {
        chunks.push(chunk);
        // Abort after first content chunk
        if (chunk.type === 'content') {
          agent.abortCurrentOperation();
        }
      }

      // Should contain a cancellation message
      const cancelChunk = chunks.find(c => c.content?.includes('cancelled'));
      expect(cancelChunk).toBeDefined();
    });
  });

  // =========================================================================
  // Model Routing
  // =========================================================================

  describe('Model Routing', () => {
    it('should not route by default (useModelRouting is false)', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;
      expect((agent as any).useModelRouting).toBe(false);
    });

    it('should call modelRouter.route when routing is enabled', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;
      (agent as any).useModelRouting = true;

      const mockRoute = jest.spyOn((agent as any).modelRouter, 'route').mockReturnValue({
        recommendedModel: 'grok-code-fast-1',
        reason: 'default',
        estimatedCost: 0.001,
      });

      for await (const _ of agent.processUserMessageStream('Hello')) { /* consume */ }

      expect(mockRoute).toHaveBeenCalled();
    });

    it('should switch model when routing recommends a different one', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;
      (agent as any).useModelRouting = true;

      const mockRoute = jest.spyOn((agent as any).modelRouter, 'route').mockReturnValue({
        recommendedModel: 'grok-2-fast',
        reason: 'complex task',
        estimatedCost: 0.01,
      });

      // Track model changes
      const setModelCalls: string[] = [];
      mockSetModel.mockImplementation((model: string) => setModelCalls.push(model));
      mockGetCurrentModel.mockReturnValue('grok-code-fast-1');

      for await (const _ of agent.processUserMessageStream('Complex analysis')) { /* consume */ }

      // Should have switched to recommended model
      expect(setModelCalls).toContain('grok-2-fast');
    });

    it('should restore original model after streaming completes', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;
      (agent as any).useModelRouting = true;

      jest.spyOn((agent as any).modelRouter, 'route').mockReturnValue({
        recommendedModel: 'grok-2-fast',
        reason: 'complex task',
        estimatedCost: 0.01,
      });

      const setModelCalls: string[] = [];
      mockSetModel.mockImplementation((model: string) => setModelCalls.push(model));
      // Simulate: first call returns original, then returns the switched model
      mockGetCurrentModel
        .mockReturnValueOnce('grok-code-fast-1') // initial check
        .mockReturnValueOnce('grok-code-fast-1') // routing comparison
        .mockReturnValue('grok-2-fast'); // after switch

      for await (const _ of agent.processUserMessageStream('Complex')) { /* consume */ }

      // Last setModel call should restore original
      expect(setModelCalls[setModelCalls.length - 1]).toBe('grok-code-fast-1');
    });
  });

  // =========================================================================
  // needsOrchestration
  // =========================================================================

  describe('needsOrchestration', () => {
    it('should return true for messages with parallel keywords', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.needsOrchestration('Build and test the application in parallel')).toBe(true);
    });

    it('should return true for "and also" pattern', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.needsOrchestration('Fix the bug and also update the docs')).toBe(true);
    });

    it('should return true for "review and fix"', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.needsOrchestration('Please review and fix the code')).toBe(true);
    });

    it('should return true for messages with 3+ distinct verbs', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.needsOrchestration('create the component, test it, and deploy')).toBe(true);
    });

    it('should return false for simple messages', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.needsOrchestration('Read the file')).toBe(false);
    });

    it('should return false for messages with fewer than 3 verbs and no keywords', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.needsOrchestration('Fix the login page')).toBe(false);
    });
  });

  // =========================================================================
  // Skill Matching
  // =========================================================================

  describe('Skill Matching', () => {
    it('should call findSkill during processUserMessage', async () => {
      const { findSkill } = require('../../src/skills/index.js');
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      await agent.processUserMessage('Hello');
      expect(findSkill).toHaveBeenCalledWith('Hello');
    });

    it('should inject skill system prompt when skill matched with high confidence', async () => {
      const { findSkill } = require('../../src/skills/index.js');
      findSkill.mockReturnValueOnce({
        confidence: 0.8,
        reason: 'matched git',
        skill: { name: 'git-workflow', description: 'Git helper' },
      });

      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      await agent.processUserMessage('Create a PR');
      const messages = (agent as any).messages;
      const skillMsg = messages.find((m: any) =>
        m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[Skill:')
      );
      expect(skillMsg).toBeDefined();
    });

    it('should not inject skill when confidence is below threshold', async () => {
      const { findSkill } = require('../../src/skills/index.js');
      findSkill.mockReturnValueOnce({
        confidence: 0.1,
        reason: 'weak match',
        skill: { name: 'git-workflow', description: 'Git helper' },
      });

      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      await agent.processUserMessage('Hello');
      const messages = (agent as any).messages;
      const skillMsg = messages.find((m: any) =>
        m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[Skill:')
      );
      expect(skillMsg).toBeUndefined();
    });

    it('should handle skill matching errors gracefully', async () => {
      const { findSkill } = require('../../src/skills/index.js');
      findSkill.mockImplementationOnce(() => { throw new Error('Skill error'); });

      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      // Should not throw
      const entries = await agent.processUserMessage('Hello');
      expect(entries.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Abort
  // =========================================================================

  describe('Abort Control', () => {
    it('should support abortCurrentOperation method', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.abortCurrentOperation).toBeDefined();
    });

    it('should abort ongoing operations', () => {
      agent = new CodeBuddyAgent('test-api-key');
      const controller = new AbortController();
      (agent as any).abortController = controller;
      expect(controller.signal.aborted).toBe(false);

      agent.abortCurrentOperation();
      expect(controller.signal.aborted).toBe(true);
    });

    it('should not throw if no operation is in progress', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(() => agent.abortCurrentOperation()).not.toThrow();
    });
  });

  // =========================================================================
  // Model Management
  // =========================================================================

  describe('Model Management', () => {
    it('should get current model', () => {
      agent = new CodeBuddyAgent('test-api-key');
      const model = agent.getCurrentModel();
      expect(model).toBe('grok-code-fast-1');
    });

    it('should delegate setModel to client', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.setModel('grok-2');
      expect(mockSetModel).toHaveBeenCalledWith('grok-2');
    });

    it('should update context manager on model change', () => {
      agent = new CodeBuddyAgent('test-api-key');
      const updateConfig = jest.spyOn((agent as any).contextManager, 'updateConfig');
      agent.setModel('grok-2');
      expect(updateConfig).toHaveBeenCalledWith({ model: 'grok-2' });
    });

    it('should probe tool support', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      const result = await agent.probeToolSupport();
      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // System Prompt
  // =========================================================================

  describe('System Prompt', () => {
    it('should set custom system prompt', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.setSystemPrompt('Custom prompt');
      expect(agent.getSystemPrompt()).toBe('Custom prompt');
    });

    it('should get system prompt', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;
      const prompt = agent.getSystemPrompt();
      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe('string');
    });

    it('should switch to chat only mode', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.switchToChatOnlyMode();
      const prompt = agent.getSystemPrompt();
      expect(prompt).toBe('You are a chat assistant.');
    });

    it('should add system context after system prompt', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;
      agent.addSystemContext('Project context here');
      const messages = (agent as any).messages;
      // Context should be inserted after the system message
      expect(messages[1].role).toBe('system');
      expect(messages[1].content).toBe('Project context here');
    });
  });

  // =========================================================================
  // Session Cost
  // =========================================================================

  describe('Session Cost', () => {
    it('should start with zero session cost', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.getSessionCost()).toBe(0);
    });

    it('should report cost limit', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.getSessionCostLimit()).toBe(10);
    });

    it('should not be at cost limit initially', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.isSessionCostLimitReached()).toBe(false);
    });

    it('should format cost status', () => {
      agent = new CodeBuddyAgent('test-api-key');
      const status = agent.formatCostStatus();
      expect(status).toContain('$0.0000');
      expect(status).toContain('$10.00');
    });

    it('should update session cost limit', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.setSessionCostLimit(50);
      expect(agent.getSessionCostLimit()).toBe(50);
    });
  });

  // =========================================================================
  // RAG Tool Selection
  // =========================================================================

  describe('RAG Tool Selection', () => {
    it('should toggle RAG tool selection', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.isRAGToolSelectionEnabled()).toBe(true);
      agent.setRAGToolSelection(false);
      expect(agent.isRAGToolSelectionEnabled()).toBe(false);
    });

    it('should return last tool selection result', () => {
      agent = new CodeBuddyAgent('test-api-key');
      // The selection strategy may have an initial state based on the mock
      const selection = agent.getLastToolSelection();
      // It returns either null or a result object
      expect(selection === null || typeof selection === 'object').toBe(true);
    });

    it('should format tool selection stats without throwing', () => {
      agent = new CodeBuddyAgent('test-api-key');
      // Calling formatToolSelectionStats should not throw
      expect(() => agent.formatToolSelectionStats()).not.toThrow();
    });
  });

  // =========================================================================
  // Parallel Tool Execution
  // =========================================================================

  describe('Parallel Tool Execution', () => {
    it('should enable parallel tool execution by default', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.isParallelToolExecutionEnabled()).toBe(true);
    });

    it('should toggle parallel execution', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.setParallelToolExecution(false);
      expect(agent.isParallelToolExecutionEnabled()).toBe(false);
    });
  });

  // =========================================================================
  // Self-Healing
  // =========================================================================

  describe('Self-Healing', () => {
    it('should delegate setSelfHealing to bash tool', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.setSelfHealing(false);
      expect(mockBashSetSelfHealing).toHaveBeenCalledWith(false);
    });

    it('should report self-healing status', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.isSelfHealingEnabled()).toBe(true);
    });
  });

  // =========================================================================
  // Peer Routing
  // =========================================================================

  describe('Peer Routing', () => {
    it('should start with no peer routing config', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.getPeerRoutingConfig()).toBeNull();
    });

    it('should apply peer routing config', () => {
      agent = new CodeBuddyAgent('test-api-key');
      const config = { model: 'grok-2', systemPrompt: 'Custom', maxToolRounds: 10 };
      agent.applyPeerRouting(config);
      expect(agent.getPeerRoutingConfig()).toEqual(config);
    });

    it('should clear peer routing config', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.applyPeerRouting({ model: 'grok-2' });
      agent.clearPeerRouting();
      expect(agent.getPeerRoutingConfig()).toBeNull();
    });

    it('should forward to agent when agentId is set', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.applyPeerRouting({ agentId: 'agent-2' });
      expect(agent.shouldForwardToAgent()).toBe('agent-2');
    });

    it('should not forward when no peer routing', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.shouldForwardToAgent()).toBeNull();
    });
  });

  // =========================================================================
  // Dispose
  // =========================================================================

  describe('Dispose', () => {
    it('should clean up resources on dispose', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(() => agent.dispose()).not.toThrow();
    });

    it('should be safe to call dispose multiple times', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.dispose();
      expect(() => agent.dispose()).not.toThrow();
    });

    it('should emit disposed event', () => {
      agent = new CodeBuddyAgent('test-api-key');
      const disposedHandler = jest.fn();
      agent.on('disposed', disposedHandler);
      agent.dispose();
      expect(disposedHandler).toHaveBeenCalled();
    });

    it('should clear peer routing on dispose', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.applyPeerRouting({ model: 'grok-2' });
      agent.dispose();
      expect(agent.getPeerRoutingConfig()).toBeNull();
    });
  });

  // =========================================================================
  // History Management
  // =========================================================================

  describe('History Management', () => {
    it('should start with empty chat history', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.getChatHistory()).toEqual([]);
    });

    it('should clear chat and emit event', () => {
      agent = new CodeBuddyAgent('test-api-key');
      const clearHandler = jest.fn();
      agent.on('chat:cleared', clearHandler);
      agent.clearChat();
      expect(clearHandler).toHaveBeenCalled();
    });

    it('should accumulate entries across multiple messages', async () => {
      agent = new CodeBuddyAgent('test-api-key');
      await agent.systemPromptReady;

      await agent.processUserMessage('First');
      await agent.processUserMessage('Second');

      const history = agent.getChatHistory();
      const userEntries = history.filter(e => e.type === 'user');
      expect(userEntries.length).toBe(2);
    });
  });

  // =========================================================================
  // Message Queue
  // =========================================================================

  describe('Message Queue', () => {
    it('should expose message queue', () => {
      agent = new CodeBuddyAgent('test-api-key');
      const queue = agent.getMessageQueue();
      expect(queue).toBeDefined();
    });

    it('should set message queue mode', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.setMessageQueueMode('steer');
      const queue = agent.getMessageQueue();
      expect(queue.getMode()).toBe('steer');
    });
  });

  // =========================================================================
  // Auto Repair
  // =========================================================================

  describe('Auto Repair', () => {
    it('should check auto repair status', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(typeof agent.isAutoRepairEnabled()).toBe('boolean');
    });

    it('should toggle auto repair', () => {
      agent = new CodeBuddyAgent('test-api-key');
      agent.setAutoRepair(true);
      const repairCoordinator = (agent as any).repairCoordinator;
      expect(repairCoordinator.setRepairEnabled).toHaveBeenCalledWith(true);
    });
  });

  // =========================================================================
  // Events
  // =========================================================================

  describe('Events', () => {
    it('should be an EventEmitter', () => {
      agent = new CodeBuddyAgent('test-api-key');
      expect(agent.on).toBeDefined();
      expect(agent.emit).toBeDefined();
      expect(agent.off).toBeDefined();
    });

    it('should emit peer-routing:applied on applyPeerRouting', () => {
      agent = new CodeBuddyAgent('test-api-key');
      const handler = jest.fn();
      agent.on('peer-routing:applied', handler);
      agent.applyPeerRouting({ model: 'grok-2' });
      expect(handler).toHaveBeenCalled();
    });

    it('should emit peer-routing:cleared on clearPeerRouting', () => {
      agent = new CodeBuddyAgent('test-api-key');
      const handler = jest.fn();
      agent.on('peer-routing:cleared', handler);
      agent.clearPeerRouting();
      expect(handler).toHaveBeenCalled();
    });
  });
});
