/**
 * Comprehensive Unit Tests for CodeBuddyAgent
 *
 * This test file covers:
 * 1. Constructor and initialization
 * 2. Message processing (streaming and non-streaming)
 * 3. Tool execution flow
 * 4. Error handling
 * 5. Configuration options
 * 6. Session/checkpoint management
 * 7. YOLO mode behavior
 * 8. Context management
 * 9. Model routing
 */

// All mocks must be defined before imports - Jest hoists jest.mock() calls

// Mock codebuddy client
jest.mock("../../src/codebuddy/client.js", () => ({
  CodeBuddyClient: jest.fn().mockImplementation(() => ({
    chat: jest.fn().mockResolvedValue({
      choices: [{ message: { content: "Test response", tool_calls: null } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
    chatStream: jest.fn().mockImplementation(async function* () {
      yield { choices: [{ delta: { content: "Test " } }] };
      yield { choices: [{ delta: { content: "response" } }] };
    }),
    getCurrentModel: jest.fn().mockReturnValue("grok-code-fast-1"),
    setModel: jest.fn(),
    probeToolSupport: jest.fn().mockResolvedValue(true),
  })),
}));

// Mock codebuddy tools
jest.mock("../../src/codebuddy/tools.js", () => ({
  getAllCodeBuddyTools: jest.fn().mockResolvedValue([
    { type: "function", function: { name: "view_file", description: "View file", parameters: {} } },
    { type: "function", function: { name: "bash", description: "Execute bash", parameters: {} } },
    { type: "function", function: { name: "search", description: "Search files", parameters: {} } },
  ]),
  getRelevantTools: jest.fn().mockResolvedValue({
    selectedTools: [
      { type: "function", function: { name: "view_file", description: "View file", parameters: {} } },
    ],
    classification: { categories: ["file_operations"], confidence: 0.9 },
    reducedTokens: 500,
    originalTokens: 2000,
  }),
  getMCPManager: jest.fn().mockReturnValue({
    getClients: jest.fn().mockReturnValue([]),
    getTools: jest.fn().mockReturnValue([]),
    callTool: jest.fn().mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: "MCP result" }],
    }),
  }),
  initializeMCPServers: jest.fn().mockResolvedValue(undefined),
  classifyQuery: jest.fn().mockReturnValue({ categories: ["general"], confidence: 0.8 }),
  getToolSelector: jest.fn().mockReturnValue({
    classifyQuery: jest.fn().mockReturnValue({ categories: ["general"] }),
    selectTools: jest.fn().mockReturnValue({ tools: [], savedTokens: 0 }),
    getMetrics: jest.fn().mockReturnValue({
      totalSelections: 100,
      successfulSelections: 95,
      missedTools: 5,
      missedToolNames: new Map(),
      successRate: 0.95,
      lastUpdated: new Date(),
    }),
    getMostMissedTools: jest.fn().mockReturnValue([]),
    resetMetrics: jest.fn(),
    getCacheStats: jest.fn().mockReturnValue({
      classificationCache: { size: 50 },
      selectionCache: { size: 10 },
    }),
    clearAllCaches: jest.fn(),
  }),
}));

// Mock tool selector
jest.mock("../../src/tools/tool-selector.js", () => ({
  recordToolRequest: jest.fn(),
  formatToolSelectionMetrics: jest.fn().mockReturnValue("Tool Selection Metrics: OK"),
}));

// Mock MCP config
jest.mock("../../src/mcp/config.js", () => ({
  loadMCPConfig: jest.fn().mockReturnValue({ servers: [] }),
}));

// Mock tools - all inline
jest.mock("../../src/tools/index.js", () => ({
  TextEditorTool: jest.fn().mockImplementation(() => ({
    view: jest.fn().mockResolvedValue({ success: true, output: "file content" }),
    create: jest.fn().mockResolvedValue({ success: true, output: "File created" }),
    strReplace: jest.fn().mockResolvedValue({ success: true, output: "Text replaced" }),
  })),
  MorphEditorTool: jest.fn().mockImplementation(() => ({
    editFile: jest.fn().mockResolvedValue({ success: true, output: "Morph edit done" }),
  })),
  BashTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, output: "command output" }),
    getCurrentDirectory: jest.fn().mockReturnValue("/home/test"),
    setSelfHealing: jest.fn(),
    isSelfHealingEnabled: jest.fn().mockReturnValue(true),
  })),
  TodoTool: jest.fn().mockImplementation(() => ({
    createTodoList: jest.fn().mockResolvedValue({ success: true, output: "Todo created" }),
    updateTodoList: jest.fn().mockResolvedValue({ success: true, output: "Todo updated" }),
  })),
  SearchTool: jest.fn().mockImplementation(() => ({
    search: jest.fn().mockResolvedValue({ success: true, output: "search results" }),
    findSymbols: jest.fn().mockResolvedValue({ success: true, output: "symbols" }),
    findReferences: jest.fn().mockResolvedValue({ success: true, output: "references" }),
    findDefinition: jest.fn().mockResolvedValue({ success: true, output: "definition" }),
    searchMultiple: jest.fn().mockResolvedValue({ success: true, output: "multi results" }),
  })),
  WebSearchTool: jest.fn().mockImplementation(() => ({
    search: jest.fn().mockResolvedValue({ success: true, output: "web results" }),
    fetchPage: jest.fn().mockResolvedValue({ success: true, output: "page content" }),
  })),
  ImageTool: jest.fn().mockImplementation(() => ({
    processImage: jest.fn().mockResolvedValue({ success: true, output: "Image processed" }),
    isImage: jest.fn().mockImplementation((path: string) => /\.(png|jpg|jpeg|gif|webp)$/i.test(path)),
  })),
}));

// Mock token counter
jest.mock("../../src/utils/token-counter.js", () => ({
  createTokenCounter: jest.fn().mockReturnValue({
    countTokens: jest.fn().mockReturnValue(100),
    countMessageTokens: jest.fn().mockReturnValue(50),
    estimateStreamingTokens: jest.fn().mockReturnValue(25),
    dispose: jest.fn(),
  }),
  TokenCounter: jest.fn(),
}));

// Mock custom instructions
jest.mock("../../src/utils/custom-instructions.js", () => ({
  loadCustomInstructions: jest.fn().mockReturnValue(null),
}));

// Mock checkpoint manager
jest.mock("../../src/checkpoints/checkpoint-manager.js", () => ({
  getCheckpointManager: jest.fn().mockReturnValue({
    checkpointBeforeCreate: jest.fn(),
    checkpointBeforeEdit: jest.fn(),
    createCheckpoint: jest.fn(),
    rewindToLast: jest.fn().mockReturnValue({
      success: true,
      checkpoint: { description: "test checkpoint" },
      restored: ["file1.ts", "file2.ts"],
      errors: [],
    }),
    formatCheckpointList: jest.fn().mockReturnValue("Checkpoints:\n1. test checkpoint"),
    listCheckpoints: jest.fn().mockReturnValue([]),
  }),
  CheckpointManager: jest.fn(),
}));

// Mock session store
jest.mock("../../src/persistence/session-store.js", () => ({
  getSessionStore: jest.fn().mockReturnValue({
    updateCurrentSession: jest.fn(),
    getCurrentSessionId: jest.fn().mockReturnValue("session-123"),
    loadSession: jest.fn().mockReturnValue(null),
    saveSession: jest.fn(),
    formatSessionList: jest.fn().mockReturnValue("Sessions:\n1. session-123"),
    exportSessionToFile: jest.fn().mockReturnValue("/tmp/session.json"),
  }),
  SessionStore: jest.fn(),
}));

// Mock agent mode
jest.mock("../../src/agent/agent-mode.js", () => ({
  getAgentModeManager: jest.fn().mockReturnValue({
    getMode: jest.fn().mockReturnValue("code"),
    setMode: jest.fn(),
    isToolAllowed: jest.fn().mockReturnValue(true),
    formatModeStatus: jest.fn().mockReturnValue("Mode: code"),
  }),
  AgentModeManager: jest.fn(),
}));

// Mock sandbox
jest.mock("../../src/security/sandbox.js", () => ({
  getSandboxManager: jest.fn().mockReturnValue({
    validateCommand: jest.fn().mockReturnValue({ valid: true }),
    formatStatus: jest.fn().mockReturnValue("Sandbox: active"),
  }),
  SandboxManager: jest.fn(),
}));

// Mock MCP client
jest.mock("../../src/mcp/mcp-client.js", () => ({
  getMCPClient: jest.fn().mockReturnValue({
    connectAll: jest.fn().mockResolvedValue(undefined),
    formatStatus: jest.fn().mockReturnValue("MCP: disconnected"),
    getAllTools: jest.fn().mockResolvedValue(new Map()),
    isConnected: jest.fn().mockReturnValue(false),
  }),
  MCPClient: jest.fn(),
}));

// Mock settings manager
jest.mock("../../src/utils/settings-manager.js", () => ({
  getSettingsManager: jest.fn().mockReturnValue({
    getCurrentModel: jest.fn().mockReturnValue("grok-code-fast-1"),
    setCurrentModel: jest.fn(),
    getSettings: jest.fn().mockReturnValue({}),
  }),
}));

// Mock prompts
jest.mock("../../src/prompts/index.js", () => ({
  getSystemPromptForMode: jest.fn().mockReturnValue("You are a helpful assistant."),
  getChatOnlySystemPrompt: jest.fn().mockReturnValue("You are a chat assistant."),
  getPromptManager: jest.fn().mockReturnValue({
    buildSystemPrompt: jest.fn().mockResolvedValue("System prompt"),
    loadPrompt: jest.fn().mockResolvedValue("Prompt content"),
  }),
  autoSelectPromptId: jest.fn().mockReturnValue("default"),
}));

// Mock cost tracker
jest.mock("../../src/utils/cost-tracker.js", () => ({
  getCostTracker: jest.fn().mockReturnValue({
    calculateCost: jest.fn().mockReturnValue(0.001),
    recordUsage: jest.fn(),
    getTotalCost: jest.fn().mockReturnValue(0.05),
    formatCostSummary: jest.fn().mockReturnValue("Total: $0.05"),
  }),
  CostTracker: jest.fn(),
}));

// Mock autonomy manager - this needs special handling for YOLO mode tests
const mockIsYOLOEnabled = jest.fn().mockReturnValue(false);
jest.mock("../../src/utils/autonomy-manager.js", () => ({
  getAutonomyManager: jest.fn(() => ({
    isYOLOEnabled: mockIsYOLOEnabled,
    enableYOLO: jest.fn(),
    disableYOLO: jest.fn(),
  })),
}));

// Mock context manager
jest.mock("../../src/context/context-manager-v2.js", () => ({
  createContextManager: jest.fn().mockReturnValue({
    getStats: jest.fn().mockReturnValue({
      totalTokens: 1000,
      maxTokens: 100000,
      usagePercent: 1,
      isNearLimit: false,
      isCritical: false,
      messageCount: 5,
      summarizedSessions: 0,
    }),
    addMessage: jest.fn(),
    getMessages: jest.fn().mockReturnValue([]),
    dispose: jest.fn(),
    updateConfig: jest.fn(),
    prepareMessages: jest.fn().mockImplementation((messages) => messages),
    shouldWarn: jest.fn().mockReturnValue({ warn: false }),
  }),
  ContextManagerV2: jest.fn(),
}));

// Mock sanitize
jest.mock("../../src/utils/sanitize.js", () => ({
  sanitizeLLMOutput: jest.fn().mockImplementation((text) => text),
  extractCommentaryToolCalls: jest.fn().mockReturnValue({
    toolCalls: [],
    remainingContent: "",
  }),
}));

// Mock errors
jest.mock("../../src/types/errors.js", () => ({
  getErrorMessage: jest.fn().mockImplementation((err) => err?.message || String(err)),
}));

// Mock logger
jest.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock prompt cache
jest.mock("../../src/optimization/prompt-cache.js", () => ({
  getPromptCacheManager: jest.fn().mockReturnValue({
    cacheSystemPrompt: jest.fn(),
    cacheTools: jest.fn(),
    getStats: jest.fn().mockReturnValue({
      hits: 10,
      misses: 2,
      hitRate: 0.83,
    }),
    formatStats: jest.fn().mockReturnValue("Cache: 83% hit rate"),
  }),
  PromptCacheManager: jest.fn(),
}));

// Mock hooks manager
jest.mock("../../src/hooks/lifecycle-hooks.js", () => ({
  getHooksManager: jest.fn().mockReturnValue({
    executeHooks: jest.fn().mockResolvedValue(undefined),
    formatStatus: jest.fn().mockReturnValue("Hooks: 0 registered"),
  }),
  HooksManager: jest.fn(),
}));

// Mock model router
jest.mock("../../src/optimization/model-routing.js", () => ({
  getModelRouter: jest.fn().mockReturnValue({
    route: jest.fn().mockReturnValue({
      recommendedModel: "grok-code-fast-1",
      reason: "Simple query",
      estimatedCost: 0.001,
    }),
    recordUsage: jest.fn(),
    getTotalCost: jest.fn().mockReturnValue(0.05),
    getEstimatedSavings: jest.fn().mockReturnValue({ saved: 0.02, percentage: 28.5 }),
    getUsageStats: jest.fn().mockReturnValue(new Map()),
  }),
  ModelRouter: jest.fn(),
}));

// Now import after all mocks are set up
import { CodeBuddyAgent } from "../../src/agent/codebuddy-agent";
import type { ChatEntry, StreamingChunk } from "../../src/agent/types";

describe("CodeBuddyAgent", () => {
  let agent: CodeBuddyAgent;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.YOLO_MODE;
    delete process.env.MAX_COST;
    delete process.env.MORPH_API_KEY;
    delete process.env.CODEBUDDY_MAX_CONTEXT;
    mockIsYOLOEnabled.mockReturnValue(false);
  });

  afterEach(() => {
    process.env = originalEnv;
    if (agent) {
      agent.dispose();
    }
  });

  // =============================================================================
  // CONSTRUCTOR TESTS
  // =============================================================================
  describe("Constructor", () => {
    it("should create agent with API key only", () => {
      agent = new CodeBuddyAgent("test-api-key");
      expect(agent).toBeInstanceOf(CodeBuddyAgent);
    });

    it("should create agent with custom base URL", () => {
      agent = new CodeBuddyAgent("test-api-key", "https://custom.api.com");
      expect(agent).toBeInstanceOf(CodeBuddyAgent);
    });

    it("should create agent with custom model", () => {
      agent = new CodeBuddyAgent("test-api-key", undefined, "grok-2-vision");
      expect(agent).toBeInstanceOf(CodeBuddyAgent);
    });

    it("should set default max tool rounds to 50", () => {
      agent = new CodeBuddyAgent("test-api-key");
      expect((agent as any).maxToolRounds).toBe(50);
    });

    it("should accept custom max tool rounds", () => {
      agent = new CodeBuddyAgent("test-api-key", undefined, undefined, 100);
      expect((agent as any).maxToolRounds).toBe(100);
    });

    it("should set default session cost limit to $10", () => {
      agent = new CodeBuddyAgent("test-api-key");
      expect((agent as any).sessionCostLimit).toBe(10);
    });

    it("should use MAX_COST env var for session limit", () => {
      process.env.MAX_COST = "25";
      agent = new CodeBuddyAgent("test-api-key");
      expect((agent as any).sessionCostLimit).toBe(25);
    });

    it("should enable RAG tool selection by default", () => {
      agent = new CodeBuddyAgent("test-api-key");
      expect((agent as any).useRAGToolSelection).toBe(true);
    });

    it("should allow disabling RAG tool selection", () => {
      agent = new CodeBuddyAgent("test-api-key", undefined, undefined, undefined, false);
      expect((agent as any).useRAGToolSelection).toBe(false);
    });

    it("should accept custom system prompt ID", () => {
      agent = new CodeBuddyAgent("test-api-key", undefined, undefined, undefined, true, "minimal");
      expect(agent).toBeInstanceOf(CodeBuddyAgent);
    });
  });

  // =============================================================================
  // YOLO MODE TESTS
  // =============================================================================
  describe("YOLO Mode", () => {
    it("should not enable YOLO mode by default", () => {
      agent = new CodeBuddyAgent("test-api-key");
      expect((agent as any).yoloMode).toBe(false);
    });

    it("should not enable YOLO mode with env var alone", () => {
      process.env.YOLO_MODE = "true";
      agent = new CodeBuddyAgent("test-api-key");
      // YOLO mode requires explicit config, not just env var
      expect((agent as any).yoloMode).toBe(false);
    });

    it("should enable YOLO mode when autonomy manager returns true", () => {
      mockIsYOLOEnabled.mockReturnValue(true);
      agent = new CodeBuddyAgent("test-api-key");
      expect((agent as any).yoloMode).toBe(true);
      expect((agent as any).maxToolRounds).toBe(400);
    });

    it("should set higher cost limit in YOLO mode", () => {
      mockIsYOLOEnabled.mockReturnValue(true);
      agent = new CodeBuddyAgent("test-api-key");
      expect((agent as any).sessionCostLimit).toBe(100);
    });

    it("should allow custom MAX_COST in YOLO mode", () => {
      process.env.MAX_COST = "50";
      mockIsYOLOEnabled.mockReturnValue(true);
      agent = new CodeBuddyAgent("test-api-key");
      expect((agent as any).sessionCostLimit).toBe(50);
    });

    it("should toggle YOLO mode via setYoloMode", () => {
      agent = new CodeBuddyAgent("test-api-key");
      expect(agent.isYoloModeEnabled()).toBe(false);

      agent.setYoloMode(true);
      expect(agent.isYoloModeEnabled()).toBe(true);
      expect((agent as any).maxToolRounds).toBe(400);

      agent.setYoloMode(false);
      expect(agent.isYoloModeEnabled()).toBe(false);
      expect((agent as any).maxToolRounds).toBe(50);
    });
  });

  // =============================================================================
  // EVENT EMITTER TESTS
  // =============================================================================
  describe("EventEmitter", () => {
    it("should be an EventEmitter", () => {
      agent = new CodeBuddyAgent("test-api-key");
      expect(agent.on).toBeDefined();
      expect(agent.emit).toBeDefined();
      expect(agent.off).toBeDefined();
    });

    it("should handle event subscriptions", () => {
      agent = new CodeBuddyAgent("test-api-key");
      const mockHandler = jest.fn();

      agent.on("test-event", mockHandler);
      agent.emit("test-event", { data: "test" });

      expect(mockHandler).toHaveBeenCalledWith({ data: "test" });
    });
  });

  // =============================================================================
  // CHAT HISTORY TESTS
  // =============================================================================
  describe("Chat History", () => {
    it("should start with empty chat history", () => {
      agent = new CodeBuddyAgent("test-api-key");
      expect(agent.getChatHistory()).toEqual([]);
    });

    it("should return a copy of chat history", () => {
      agent = new CodeBuddyAgent("test-api-key");
      const history1 = agent.getChatHistory();
      const history2 = agent.getChatHistory();
      expect(history1).not.toBe(history2);
    });

    it("should clear chat history", () => {
      agent = new CodeBuddyAgent("test-api-key");
      // Access private property to add history
      (agent as any).chatHistory = [
        { type: "user", content: "test", timestamp: new Date() },
      ];
      expect(agent.getChatHistory().length).toBe(1);

      agent.clearChat();
      expect(agent.getChatHistory().length).toBe(0);
    });

    it("should keep only system message after clearChat", () => {
      agent = new CodeBuddyAgent("test-api-key");
      // Simulate having messages
      (agent as any).messages = [
        { role: "system", content: "system prompt" },
        { role: "user", content: "test" },
        { role: "assistant", content: "response" },
      ];

      agent.clearChat();
      expect((agent as any).messages.length).toBe(1);
      expect((agent as any).messages[0].role).toBe("system");
    });
  });

  // =============================================================================
  // ABORT CONTROL TESTS
  // =============================================================================
  describe("Abort Control", () => {
    it("should have abortCurrentOperation method", () => {
      agent = new CodeBuddyAgent("test-api-key");
      expect(agent.abortCurrentOperation).toBeDefined();
    });

    it("should not throw when abort is called with no active request", () => {
      agent = new CodeBuddyAgent("test-api-key");
      expect(() => agent.abortCurrentOperation()).not.toThrow();
    });

    it("should abort ongoing operations", () => {
      agent = new CodeBuddyAgent("test-api-key");
      const controller = new AbortController();
      (agent as any).abortController = controller;

      expect(controller.signal.aborted).toBe(false);
      agent.abortCurrentOperation();
      expect(controller.signal.aborted).toBe(true);
    });
  });

  // =============================================================================
  // MODEL MANAGEMENT TESTS
  // =============================================================================
  describe("Model Management", () => {
    it("should get current model", () => {
      agent = new CodeBuddyAgent("test-api-key");
      const model = agent.getCurrentModel();
      expect(model).toBe("grok-code-fast-1");
    });

    it("should set new model", () => {
      agent = new CodeBuddyAgent("test-api-key");
      agent.setModel("grok-2-vision");
      // The model change is delegated to the client
      const client = agent.getClient();
      expect(client.setModel).toHaveBeenCalledWith("grok-2-vision");
    });

    it("should probe tool support", async () => {
      agent = new CodeBuddyAgent("test-api-key");
      const result = await agent.probeToolSupport();
      expect(result).toBe(true);
    });

    it("should switch to chat-only mode", () => {
      agent = new CodeBuddyAgent("test-api-key");
      agent.switchToChatOnlyMode();
      // Verify the system message was updated
      expect((agent as any).messages[0].content).toBeDefined();
    });
  });

  // =============================================================================
  // TOOL EXECUTION TESTS
  // =============================================================================
  describe("Tool Execution", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should execute view_file tool", async () => {
      const result = await (agent as any).executeTool({
        id: "call_1",
        type: "function",
        function: {
          name: "view_file",
          arguments: JSON.stringify({ path: "/test/file.ts" }),
        },
      });

      expect(result.success).toBe(true);
    });

    it("should execute view_file with line range", async () => {
      const result = await (agent as any).executeTool({
        id: "call_2",
        type: "function",
        function: {
          name: "view_file",
          arguments: JSON.stringify({ path: "/test/file.ts", start_line: 10, end_line: 20 }),
        },
      });

      expect(result.success).toBe(true);
    });

    it("should execute create_file tool", async () => {
      const result = await (agent as any).executeTool({
        id: "call_3",
        type: "function",
        function: {
          name: "create_file",
          arguments: JSON.stringify({ path: "/test/new.ts", content: "const x = 1;" }),
        },
      });

      expect(result.success).toBe(true);
    });

    it("should execute str_replace_editor tool", async () => {
      const result = await (agent as any).executeTool({
        id: "call_4",
        type: "function",
        function: {
          name: "str_replace_editor",
          arguments: JSON.stringify({
            path: "/test/file.ts",
            old_str: "old",
            new_str: "new",
            replace_all: true,
          }),
        },
      });

      expect(result.success).toBe(true);
    });

    it("should execute bash tool", async () => {
      const result = await (agent as any).executeTool({
        id: "call_5",
        type: "function",
        function: {
          name: "bash",
          arguments: JSON.stringify({ command: "ls -la" }),
        },
      });

      expect(result.success).toBe(true);
    });

    it("should execute search tool", async () => {
      const result = await (agent as any).executeTool({
        id: "call_6",
        type: "function",
        function: {
          name: "search",
          arguments: JSON.stringify({ query: "function test" }),
        },
      });

      expect(result.success).toBe(true);
    });

    it("should execute find_symbols tool", async () => {
      const result = await (agent as any).executeTool({
        id: "call_7",
        type: "function",
        function: {
          name: "find_symbols",
          arguments: JSON.stringify({ name: "myFunction" }),
        },
      });

      expect(result.success).toBe(true);
    });

    it("should execute find_references tool", async () => {
      const result = await (agent as any).executeTool({
        id: "call_8",
        type: "function",
        function: {
          name: "find_references",
          arguments: JSON.stringify({ symbol_name: "myVar", context_lines: 3 }),
        },
      });

      expect(result.success).toBe(true);
    });

    it("should execute find_definition tool", async () => {
      const result = await (agent as any).executeTool({
        id: "call_9",
        type: "function",
        function: {
          name: "find_definition",
          arguments: JSON.stringify({ symbol_name: "MyClass" }),
        },
      });

      expect(result.success).toBe(true);
    });

    it("should execute search_multi tool", async () => {
      const result = await (agent as any).executeTool({
        id: "call_10",
        type: "function",
        function: {
          name: "search_multi",
          arguments: JSON.stringify({ patterns: ["foo", "bar"], operator: "AND" }),
        },
      });

      expect(result.success).toBe(true);
    });

    it("should execute web_search tool", async () => {
      const result = await (agent as any).executeTool({
        id: "call_11",
        type: "function",
        function: {
          name: "web_search",
          arguments: JSON.stringify({ query: "TypeScript tutorial" }),
        },
      });

      expect(result.success).toBe(true);
    });

    it("should execute web_fetch tool", async () => {
      const result = await (agent as any).executeTool({
        id: "call_12",
        type: "function",
        function: {
          name: "web_fetch",
          arguments: JSON.stringify({ url: "https://example.com" }),
        },
      });

      expect(result.success).toBe(true);
    });

    it("should execute create_todo_list tool", async () => {
      const result = await (agent as any).executeTool({
        id: "call_13",
        type: "function",
        function: {
          name: "create_todo_list",
          arguments: JSON.stringify({ todos: [{ text: "Task 1" }] }),
        },
      });

      expect(result.success).toBe(true);
    });

    it("should execute update_todo_list tool", async () => {
      const result = await (agent as any).executeTool({
        id: "call_14",
        type: "function",
        function: {
          name: "update_todo_list",
          arguments: JSON.stringify({ updates: [{ id: 1, completed: true }] }),
        },
      });

      expect(result.success).toBe(true);
    });

    it("should handle unknown tool", async () => {
      const result = await (agent as any).executeTool({
        id: "call_unknown",
        type: "function",
        function: {
          name: "unknown_tool",
          arguments: "{}",
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown tool");
    });

    it("should handle invalid JSON arguments", async () => {
      const result = await (agent as any).executeTool({
        id: "call_invalid",
        type: "function",
        function: {
          name: "view_file",
          arguments: "invalid json",
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tool execution error");
    });

    it("should return error when edit_file used without morph editor", async () => {
      const result = await (agent as any).executeTool({
        id: "call_morph",
        type: "function",
        function: {
          name: "edit_file",
          arguments: JSON.stringify({
            target_file: "/test/file.ts",
            instructions: "Add type",
            code_edit: "const x: number = 1;",
          }),
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Morph Fast Apply not available");
    });
  });

  // =============================================================================
  // MCP TOOL EXECUTION TESTS
  // =============================================================================
  describe("MCP Tool Execution", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should execute MCP tool", async () => {
      const result = await (agent as any).executeMCPTool({
        id: "mcp_call",
        type: "function",
        function: {
          name: "mcp__server__tool",
          arguments: JSON.stringify({ param: "value" }),
        },
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe("MCP result");
    });
  });

  // =============================================================================
  // PARALLEL EXECUTION TESTS
  // =============================================================================
  describe("Parallel Tool Execution", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should identify parallelizable tool calls", () => {
      const toolCalls = [
        {
          id: "call_1",
          type: "function" as const,
          function: { name: "view_file", arguments: '{"path": "/a.ts"}' },
        },
        {
          id: "call_2",
          type: "function" as const,
          function: { name: "search", arguments: '{"query": "test"}' },
        },
      ];

      const canParallelize = (agent as any).canParallelizeToolCalls(toolCalls);
      expect(canParallelize).toBe(true);
    });

    it("should not parallelize write operations to same file", () => {
      const toolCalls = [
        {
          id: "call_1",
          type: "function" as const,
          function: { name: "str_replace_editor", arguments: '{"path": "/a.ts", "old_str": "a", "new_str": "b"}' },
        },
        {
          id: "call_2",
          type: "function" as const,
          function: { name: "str_replace_editor", arguments: '{"path": "/a.ts", "old_str": "c", "new_str": "d"}' },
        },
      ];

      const canParallelize = (agent as any).canParallelizeToolCalls(toolCalls);
      expect(canParallelize).toBe(false);
    });

    it("should enable/disable parallel execution", () => {
      expect(agent.isParallelToolExecutionEnabled()).toBe(true);

      agent.setParallelToolExecution(false);
      expect(agent.isParallelToolExecutionEnabled()).toBe(false);

      agent.setParallelToolExecution(true);
      expect(agent.isParallelToolExecutionEnabled()).toBe(true);
    });

    it("should execute tools in parallel", async () => {
      const toolCalls = [
        {
          id: "call_1",
          type: "function" as const,
          function: { name: "view_file", arguments: '{"path": "/a.ts"}' },
        },
        {
          id: "call_2",
          type: "function" as const,
          function: { name: "search", arguments: '{"query": "test"}' },
        },
      ];

      const results = await (agent as any)._executeToolCallsParallel(toolCalls);

      expect(results.size).toBe(2);
      expect(results.get("call_1").success).toBe(true);
      expect(results.get("call_2").success).toBe(true);
    });
  });

  // =============================================================================
  // CHECKPOINT MANAGEMENT TESTS
  // =============================================================================
  describe("Checkpoint Management", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should create checkpoint", () => {
      expect(() => agent.createCheckpoint("test checkpoint")).not.toThrow();
    });

    it("should rewind to last checkpoint", () => {
      const result = agent.rewindToLastCheckpoint();
      expect(result.success).toBe(true);
      expect(result.message).toContain("Rewound to");
    });

    it("should get checkpoint list", () => {
      const list = agent.getCheckpointList();
      expect(list).toContain("Checkpoints");
    });

    it("should expose checkpoint manager", () => {
      const manager = agent.getCheckpointManager();
      expect(manager).toBeDefined();
    });
  });

  // =============================================================================
  // SESSION MANAGEMENT TESTS
  // =============================================================================
  describe("Session Management", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should save current session", () => {
      expect(() => agent.saveCurrentSession()).not.toThrow();
    });

    it("should get session list", () => {
      const list = agent.getSessionList();
      expect(list).toContain("Sessions");
    });

    it("should export current session", () => {
      const path = agent.exportCurrentSession();
      expect(path).toBe("/tmp/session.json");
    });

    it("should expose session store", () => {
      const store = agent.getSessionStore();
      expect(store).toBeDefined();
    });
  });

  // =============================================================================
  // MODE MANAGEMENT TESTS
  // =============================================================================
  describe("Mode Management", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should get current mode", () => {
      const mode = agent.getMode();
      expect(mode).toBe("code");
    });

    it("should set mode", () => {
      agent.setMode("plan" as any);
      // Mode is set through mock
    });

    it("should get mode status", () => {
      const status = agent.getModeStatus();
      expect(status).toBe("Mode: code");
    });

    it("should check if tool is allowed in current mode", () => {
      const allowed = agent.isToolAllowedInCurrentMode("bash");
      expect(allowed).toBe(true);
    });
  });

  // =============================================================================
  // SANDBOX MANAGEMENT TESTS
  // =============================================================================
  describe("Sandbox Management", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should get sandbox status", () => {
      const status = agent.getSandboxStatus();
      expect(status).toBe("Sandbox: active");
    });

    it("should validate command", () => {
      const result = agent.validateCommand("ls -la");
      expect(result.valid).toBe(true);
    });
  });

  // =============================================================================
  // MCP CLIENT TESTS
  // =============================================================================
  describe("MCP Client", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should connect MCP servers", async () => {
      await agent.connectMCPServers();
      // No error means success
    });

    it("should get MCP status", () => {
      const status = agent.getMCPStatus();
      expect(status).toBe("MCP: disconnected");
    });

    it("should get MCP tools", async () => {
      const tools = await agent.getMCPTools();
      expect(tools).toBeInstanceOf(Map);
    });

    it("should expose MCP client", () => {
      const client = agent.getMCPClient();
      expect(client).toBeDefined();
    });
  });

  // =============================================================================
  // RAG TOOL SELECTION TESTS
  // =============================================================================
  describe("RAG Tool Selection", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should enable/disable RAG tool selection", () => {
      expect(agent.isRAGToolSelectionEnabled()).toBe(true);

      agent.setRAGToolSelection(false);
      expect(agent.isRAGToolSelectionEnabled()).toBe(false);

      agent.setRAGToolSelection(true);
      expect(agent.isRAGToolSelectionEnabled()).toBe(true);
    });

    it("should get last tool selection", () => {
      const selection = agent.getLastToolSelection();
      expect(selection).toBeNull(); // No selection yet
    });

    it("should format tool selection stats", () => {
      const formatted = agent.formatToolSelectionStats();
      expect(formatted).toContain("No tool selection data available");
    });

    it("should classify user query", () => {
      const classification = agent.classifyUserQuery("show me the file");
      expect(classification.categories).toContain("general");
    });

    it("should get tool selection metrics", () => {
      const metrics = agent.getToolSelectionMetrics();
      expect(metrics.totalSelections).toBe(100);
    });

    it("should format tool selection metrics", () => {
      const formatted = agent.formatToolSelectionMetrics();
      expect(formatted).toBe("Tool Selection Metrics: OK");
    });

    it("should get most missed tools", () => {
      const missed = agent.getMostMissedTools(5);
      expect(Array.isArray(missed)).toBe(true);
    });

    it("should get cache stats", () => {
      const stats = agent.getCacheStats();
      expect(stats.classificationCache.size).toBe(50);
    });
  });

  // =============================================================================
  // SELF HEALING TESTS
  // =============================================================================
  describe("Self Healing", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should enable/disable self healing", () => {
      agent.setSelfHealing(false);
      // Method is called through mock

      agent.setSelfHealing(true);
      // Method is called through mock
    });

    it("should check self healing status", () => {
      const enabled = agent.isSelfHealingEnabled();
      expect(enabled).toBe(true);
    });
  });

  // =============================================================================
  // IMAGE PROCESSING TESTS
  // =============================================================================
  describe("Image Processing", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should detect image files", () => {
      expect(agent.isImageFile("test.png")).toBe(true);
      expect(agent.isImageFile("test.jpg")).toBe(true);
      expect(agent.isImageFile("test.jpeg")).toBe(true);
      expect(agent.isImageFile("test.txt")).toBe(false);
    });

    it("should process image", async () => {
      const result = await agent.processImage("/path/to/image.png");
      expect(result.success).toBe(true);
    });
  });

  // =============================================================================
  // SYSTEM PROMPT TESTS
  // =============================================================================
  describe("System Prompt", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should set custom system prompt", () => {
      agent.setSystemPrompt("Custom prompt content");
      expect((agent as any).messages[0].content).toBe("Custom prompt content");
    });

    it("should get system prompt", () => {
      const prompt = agent.getSystemPrompt();
      expect(prompt).toBeDefined();
    });

    it("should add system message if none exists", () => {
      (agent as any).messages = [];
      agent.setSystemPrompt("New system prompt");
      expect((agent as any).messages[0]).toEqual({
        role: "system",
        content: "New system prompt",
      });
    });
  });

  // =============================================================================
  // COST TRACKING TESTS
  // =============================================================================
  describe("Cost Tracking", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should get session cost", () => {
      const cost = agent.getSessionCost();
      expect(cost).toBe(0);
    });

    it("should get session cost limit", () => {
      const limit = agent.getSessionCostLimit();
      expect(limit).toBe(10);
    });

    it("should set session cost limit", () => {
      agent.setSessionCostLimit(50);
      expect(agent.getSessionCostLimit()).toBe(50);
    });

    it("should check if session cost limit reached", () => {
      expect(agent.isSessionCostLimitReached()).toBe(false);

      (agent as any).sessionCost = 15;
      expect(agent.isSessionCostLimitReached()).toBe(true);
    });

    it("should format cost status", () => {
      const status = agent.formatCostStatus();
      expect(status).toContain("Session");
      expect(status).toContain("Safe");
    });

    it("should format YOLO cost status", () => {
      agent.setYoloMode(true);
      const status = agent.formatCostStatus();
      expect(status).toContain("YOLO");
    });
  });

  // =============================================================================
  // CONTEXT MANAGEMENT TESTS
  // =============================================================================
  describe("Context Management", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should get context stats", () => {
      const stats = agent.getContextStats();
      expect(stats.totalTokens).toBe(1000);
      expect(stats.maxTokens).toBe(100000);
    });

    it("should format context stats", () => {
      const formatted = agent.formatContextStats();
      expect(formatted).toContain("Context:");
      expect(formatted).toContain("tokens");
    });

    it("should update context config", () => {
      agent.updateContextConfig({ maxContextTokens: 50000 });
      // Method is called through mock
    });
  });

  // =============================================================================
  // PROMPT CACHE TESTS
  // =============================================================================
  describe("Prompt Cache", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should get prompt cache manager", () => {
      const manager = agent.getPromptCacheManager();
      expect(manager).toBeDefined();
    });

    it("should get prompt cache stats", () => {
      const stats = agent.getPromptCacheStats();
      expect(stats.hits).toBe(10);
      expect(stats.hitRate).toBe(0.83);
    });

    it("should format prompt cache stats", () => {
      const formatted = agent.formatPromptCacheStats();
      expect(formatted).toContain("Cache");
    });
  });

  // =============================================================================
  // HOOKS MANAGER TESTS
  // =============================================================================
  describe("Hooks Manager", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should get hooks manager", () => {
      const manager = agent.getHooksManager();
      expect(manager).toBeDefined();
    });

    it("should get hooks status", () => {
      const status = agent.getHooksStatus();
      expect(status).toBe("Hooks: 0 registered");
    });
  });

  // =============================================================================
  // MODEL ROUTING TESTS
  // =============================================================================
  describe("Model Routing", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should enable/disable model routing", () => {
      expect(agent.isModelRoutingEnabled()).toBe(false);

      agent.setModelRouting(true);
      expect(agent.isModelRoutingEnabled()).toBe(true);

      agent.setModelRouting(false);
      expect(agent.isModelRoutingEnabled()).toBe(false);
    });

    it("should get model router", () => {
      const router = agent.getModelRouter();
      expect(router).toBeDefined();
    });

    it("should get last routing decision", () => {
      const decision = agent.getLastRoutingDecision();
      expect(decision).toBeNull(); // No decision yet
    });

    it("should get model routing stats", () => {
      const stats = agent.getModelRoutingStats();
      expect(stats.enabled).toBe(false);
      expect(stats.totalCost).toBe(0.05);
    });

    it("should format model routing stats", () => {
      const formatted = agent.formatModelRoutingStats();
      expect(formatted).toContain("Model Routing Statistics");
    });
  });

  // =============================================================================
  // DISPOSE TESTS
  // =============================================================================
  describe("Dispose", () => {
    it("should clean up resources on dispose", () => {
      agent = new CodeBuddyAgent("test-api-key");
      expect(() => agent.dispose()).not.toThrow();
    });

    it("should be safe to call dispose multiple times", () => {
      agent = new CodeBuddyAgent("test-api-key");
      agent.dispose();
      expect(() => agent.dispose()).not.toThrow();
    });

    it("should clear history on dispose", () => {
      agent = new CodeBuddyAgent("test-api-key");
      (agent as any).chatHistory = [{ type: "user", content: "test", timestamp: new Date() }];
      agent.dispose();
      expect((agent as any).chatHistory.length).toBe(0);
    });

    it("should abort ongoing operations on dispose", () => {
      agent = new CodeBuddyAgent("test-api-key");
      const controller = new AbortController();
      (agent as any).abortController = controller;

      agent.dispose();
      expect(controller.signal.aborted).toBe(true);
    });
  });

  // =============================================================================
  // HELPER METHOD TESTS
  // =============================================================================
  describe("Helper Methods", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should get current directory", () => {
      const dir = agent.getCurrentDirectory();
      expect(dir).toBe("/home/test");
    });

    it("should execute bash command directly", async () => {
      const result = await agent.executeBashCommand("echo hello");
      expect(result.success).toBe(true);
    });

    it("should get client", () => {
      const client = agent.getClient();
      expect(client).toBeDefined();
    });
  });

  // =============================================================================
  // HISTORY TRIMMING TESTS
  // =============================================================================
  describe("History Trimming", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should trim history when exceeding MAX_HISTORY_SIZE", () => {
      // Create history exceeding the limit
      const largeHistory: ChatEntry[] = [];
      for (let i = 0; i < 1100; i++) {
        largeHistory.push({
          type: "user",
          content: `message ${i}`,
          timestamp: new Date(),
        });
      }
      (agent as any).chatHistory = largeHistory;

      // Trigger trim
      (agent as any).trimHistory();

      expect((agent as any).chatHistory.length).toBe(1000);
    });

    it("should preserve system message when trimming messages", () => {
      const largeMessages = [
        { role: "system", content: "system prompt" },
      ];
      for (let i = 0; i < 1100; i++) {
        largeMessages.push({ role: "user", content: `message ${i}` });
      }
      (agent as any).messages = largeMessages;

      // Trigger trim
      (agent as any).trimHistory();

      expect((agent as any).messages[0].role).toBe("system");
      expect((agent as any).messages.length).toBe(1001); // 1 system + 1000 recent
    });
  });

  // =============================================================================
  // STATIC PROPERTIES TESTS
  // =============================================================================
  describe("Static Properties", () => {
    it("should have MAX_HISTORY_SIZE constant", () => {
      expect((CodeBuddyAgent as any).MAX_HISTORY_SIZE).toBe(1000);
    });
  });
});

// =============================================================================
// PROCESS USER MESSAGE TESTS
// =============================================================================
describe("CodeBuddyAgent Message Processing", () => {
  let agent: CodeBuddyAgent;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsYOLOEnabled.mockReturnValue(false);
    agent = new CodeBuddyAgent("test-api-key");
  });

  afterEach(() => {
    if (agent) {
      agent.dispose();
    }
  });

  describe("processUserMessage", () => {
    it("should add user message to history", async () => {
      const entries = await agent.processUserMessage("Hello");

      expect(entries.length).toBeGreaterThan(0);
      expect(entries[0].type).toBe("user");
      expect(entries[0].content).toBe("Hello");
    });

    it("should return assistant response", async () => {
      const entries = await agent.processUserMessage("Hello");

      const assistantEntry = entries.find((e) => e.type === "assistant");
      expect(assistantEntry).toBeDefined();
      expect(assistantEntry?.content).toBe("Test response");
    });
  });

  describe("processUserMessageStream", () => {
    it("should yield content chunks", async () => {
      const chunks: StreamingChunk[] = [];

      for await (const chunk of agent.processUserMessageStream("Hello")) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      const contentChunks = chunks.filter((c) => c.type === "content");
      expect(contentChunks.length).toBeGreaterThan(0);
    });

    it("should yield done chunk at the end", async () => {
      const chunks: StreamingChunk[] = [];

      for await (const chunk of agent.processUserMessageStream("Hello")) {
        chunks.push(chunk);
      }

      const doneChunk = chunks.find((c) => c.type === "done");
      expect(doneChunk).toBeDefined();
    });

    it("should yield token count chunks", async () => {
      const chunks: StreamingChunk[] = [];

      for await (const chunk of agent.processUserMessageStream("Hello")) {
        chunks.push(chunk);
      }

      const tokenChunks = chunks.filter((c) => c.type === "token_count");
      expect(tokenChunks.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// MESSAGE REDUCER TESTS
// =============================================================================
describe("Message Reducer", () => {
  let agent: CodeBuddyAgent;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsYOLOEnabled.mockReturnValue(false);
    agent = new CodeBuddyAgent("test-api-key");
  });

  afterEach(() => {
    if (agent) {
      agent.dispose();
    }
  });

  it("should accumulate string content", () => {
    const reducer = (agent as any).messageReducer.bind(agent);

    let acc: Record<string, unknown> = {};
    acc = reducer(acc, { choices: [{ delta: { content: "Hello " } }] });
    acc = reducer(acc, { choices: [{ delta: { content: "World" } }] });

    expect(acc.content).toBe("Hello World");
  });

  it("should accumulate tool calls array", () => {
    const reducer = (agent as any).messageReducer.bind(agent);

    let acc: Record<string, unknown> = {};
    acc = reducer(acc, {
      choices: [
        {
          delta: {
            tool_calls: [{ id: "call_1", function: { name: "view" } }],
          },
        },
      ],
    });
    acc = reducer(acc, {
      choices: [
        {
          delta: {
            tool_calls: [{ function: { arguments: '{"path":"/test.ts"}' } }],
          },
        },
      ],
    });

    expect(acc.tool_calls).toBeDefined();
    const toolCalls = acc.tool_calls as Array<{ id: string; function: { name: string; arguments: string } }>;
    expect(toolCalls[0].id).toBe("call_1");
    expect(toolCalls[0].function.name).toBe("view");
    expect(toolCalls[0].function.arguments).toBe('{"path":"/test.ts"}');
  });

  it("should handle empty delta", () => {
    const reducer = (agent as any).messageReducer.bind(agent);

    let acc: Record<string, unknown> = { content: "existing" };
    acc = reducer(acc, { choices: [{ delta: {} }] });

    expect(acc.content).toBe("existing");
  });

  it("should handle null delta", () => {
    const reducer = (agent as any).messageReducer.bind(agent);

    let acc: Record<string, unknown> = { content: "existing" };
    acc = reducer(acc, { choices: [{ delta: null }] });

    expect(acc.content).toBe("existing");
  });
});

// =============================================================================
// SEARCH KEYWORD DETECTION TESTS
// =============================================================================
describe("Search Keyword Detection", () => {
  let agent: CodeBuddyAgent;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsYOLOEnabled.mockReturnValue(false);
    agent = new CodeBuddyAgent("test-api-key");
  });

  afterEach(() => {
    if (agent) {
      agent.dispose();
    }
  });

  it("should detect search keywords", () => {
    const shouldSearch = (agent as any).shouldUseSearchFor.bind(agent);

    expect(shouldSearch("what is the latest news")).toBe(true);
    expect(shouldSearch("current price of bitcoin")).toBe(true);
    expect(shouldSearch("trending topics today")).toBe(true);
    expect(shouldSearch("what happened in 2024")).toBe(true);
    expect(shouldSearch("check x.com for updates")).toBe(true);
  });

  it("should not detect search keywords in regular queries", () => {
    const shouldSearch = (agent as any).shouldUseSearchFor.bind(agent);

    expect(shouldSearch("how to create a function")).toBe(false);
    expect(shouldSearch("explain this code")).toBe(false);
    expect(shouldSearch("refactor this class")).toBe(false);
  });
});
