/**
 * Comprehensive Unit Tests for Agent Core Modules
 *
 * This test file covers the core agent functionality:
 * 1. Agent Lifecycle - initialization, configuration, disposal
 * 2. Tool Execution - executing tools, parallel execution, error handling
 * 3. Response Handling - streaming, accumulation, message processing
 * 4. Error Handling - graceful degradation, error recovery
 *
 * Uses Jest with proper mocks for all external dependencies.
 */

// =============================================================================
// MOCKS - Must be defined before imports (Jest hoists jest.mock() calls)
// =============================================================================

// Mock codebuddy client
const mockChatResponse = jest.fn().mockResolvedValue({
  choices: [{ message: { content: "Test response", tool_calls: null } }],
  usage: { prompt_tokens: 100, completion_tokens: 50 },
});

const mockChatStreamResponse = jest.fn().mockImplementation(async function* () {
  yield { choices: [{ delta: { content: "Hello " } }] };
  yield { choices: [{ delta: { content: "World" } }] };
});

jest.mock("../../src/codebuddy/client.js", () => ({
  CodeBuddyClient: jest.fn().mockImplementation(() => ({
    chat: mockChatResponse,
    chatStream: mockChatStreamResponse,
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

// Mock tools - configurable for testing different scenarios
const mockViewFile = jest.fn().mockResolvedValue({ success: true, output: "file content" });
const mockCreateFile = jest.fn().mockResolvedValue({ success: true, output: "File created" });
const mockStrReplace = jest.fn().mockResolvedValue({ success: true, output: "Text replaced" });
const mockBashExecute = jest.fn().mockResolvedValue({ success: true, output: "command output" });
const mockSearchTool = jest.fn().mockResolvedValue({ success: true, output: "search results" });
const mockWebSearch = jest.fn().mockResolvedValue({ success: true, output: "web results" });
const mockFetchPage = jest.fn().mockResolvedValue({ success: true, output: "page content" });

jest.mock("../../src/tools/index.js", () => ({
  TextEditorTool: jest.fn().mockImplementation(() => ({
    view: mockViewFile,
    create: mockCreateFile,
    strReplace: mockStrReplace,
  })),
  MorphEditorTool: jest.fn().mockImplementation(() => ({
    editFile: jest.fn().mockResolvedValue({ success: true, output: "Morph edit done" }),
  })),
  BashTool: jest.fn().mockImplementation(() => ({
    execute: mockBashExecute,
    getCurrentDirectory: jest.fn().mockReturnValue("/home/test"),
    setSelfHealing: jest.fn(),
    isSelfHealingEnabled: jest.fn().mockReturnValue(true),
  })),
  TodoTool: jest.fn().mockImplementation(() => ({
    createTodoList: jest.fn().mockResolvedValue({ success: true, output: "Todo created" }),
    updateTodoList: jest.fn().mockResolvedValue({ success: true, output: "Todo updated" }),
  })),
  SearchTool: jest.fn().mockImplementation(() => ({
    search: mockSearchTool,
    findSymbols: jest.fn().mockResolvedValue({ success: true, output: "symbols" }),
    findReferences: jest.fn().mockResolvedValue({ success: true, output: "references" }),
    findDefinition: jest.fn().mockResolvedValue({ success: true, output: "definition" }),
    searchMultiple: jest.fn().mockResolvedValue({ success: true, output: "multi results" }),
  })),
  WebSearchTool: jest.fn().mockImplementation(() => ({
    search: mockWebSearch,
    fetchPage: mockFetchPage,
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
const mockCheckpointBeforeCreate = jest.fn();
const mockCheckpointBeforeEdit = jest.fn();
jest.mock("../../src/checkpoints/checkpoint-manager.js", () => ({
  getCheckpointManager: jest.fn().mockReturnValue({
    checkpointBeforeCreate: mockCheckpointBeforeCreate,
    checkpointBeforeEdit: mockCheckpointBeforeEdit,
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
const mockCalculateCost = jest.fn().mockReturnValue(0.001);
const mockRecordUsage = jest.fn();
jest.mock("../../src/utils/cost-tracker.js", () => ({
  getCostTracker: jest.fn().mockReturnValue({
    calculateCost: mockCalculateCost,
    recordUsage: mockRecordUsage,
    getTotalCost: jest.fn().mockReturnValue(0.05),
    formatCostSummary: jest.fn().mockReturnValue("Total: $0.05"),
  }),
  CostTracker: jest.fn(),
}));

// Mock autonomy manager
const mockIsYOLOEnabled = jest.fn().mockReturnValue(false);
jest.mock("../../src/utils/autonomy-manager.js", () => ({
  getAutonomyManager: jest.fn(() => ({
    isYOLOEnabled: mockIsYOLOEnabled,
    enableYOLO: jest.fn(),
    disableYOLO: jest.fn(),
  })),
}));

// Mock context manager
const mockPrepareMessages = jest.fn().mockImplementation((messages) => messages);
const mockShouldWarn = jest.fn().mockReturnValue({ warn: false });
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
    prepareMessages: mockPrepareMessages,
    shouldWarn: mockShouldWarn,
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
const mockExecuteHooks = jest.fn().mockResolvedValue(undefined);
jest.mock("../../src/hooks/lifecycle-hooks.js", () => ({
  getHooksManager: jest.fn().mockReturnValue({
    executeHooks: mockExecuteHooks,
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

// =============================================================================
// IMPORTS - After all mocks are set up
// =============================================================================
import { CodeBuddyAgent } from "../../src/agent/codebuddy-agent";
import type { ChatEntry, StreamingChunk } from "../../src/agent/types";

// =============================================================================
// TEST SUITES
// =============================================================================

describe("Agent Core Module Tests", () => {
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

  // ===========================================================================
  // AGENT LIFECYCLE TESTS
  // ===========================================================================
  describe("Agent Lifecycle", () => {
    describe("Initialization", () => {
      it("should create agent with minimal configuration", () => {
        agent = new CodeBuddyAgent("test-api-key");
        expect(agent).toBeInstanceOf(CodeBuddyAgent);
      });

      it("should create agent with full configuration", () => {
        agent = new CodeBuddyAgent(
          "test-api-key",
          "https://custom.api.com",
          "grok-2-vision",
          100,
          true,
          "minimal"
        );
        expect(agent).toBeInstanceOf(CodeBuddyAgent);
      });

      it("should initialize with default max tool rounds of 50", () => {
        agent = new CodeBuddyAgent("test-api-key");
        expect((agent as any).maxToolRounds).toBe(50);
      });

      it("should initialize with default session cost limit of $10", () => {
        agent = new CodeBuddyAgent("test-api-key");
        expect((agent as any).sessionCostLimit).toBe(10);
      });

      it("should enable RAG tool selection by default", () => {
        agent = new CodeBuddyAgent("test-api-key");
        expect((agent as any).useRAGToolSelection).toBe(true);
      });

      it("should initialize empty chat history", () => {
        agent = new CodeBuddyAgent("test-api-key");
        expect(agent.getChatHistory()).toEqual([]);
      });

      it("should initialize system message in messages array", () => {
        agent = new CodeBuddyAgent("test-api-key");
        // Wait for async initialization
        return new Promise((resolve) => setTimeout(resolve, 10)).then(() => {
          expect((agent as any).messages.length).toBeGreaterThanOrEqual(1);
        });
      });
    });

    describe("Configuration Updates", () => {
      beforeEach(() => {
        agent = new CodeBuddyAgent("test-api-key");
      });

      it("should update max tool rounds", () => {
        (agent as any).maxToolRounds = 200;
        expect((agent as any).maxToolRounds).toBe(200);
      });

      it("should update session cost limit", () => {
        agent.setSessionCostLimit(50);
        expect(agent.getSessionCostLimit()).toBe(50);
      });

      it("should toggle RAG tool selection", () => {
        expect(agent.isRAGToolSelectionEnabled()).toBe(true);
        agent.setRAGToolSelection(false);
        expect(agent.isRAGToolSelectionEnabled()).toBe(false);
        agent.setRAGToolSelection(true);
        expect(agent.isRAGToolSelectionEnabled()).toBe(true);
      });

      it("should toggle parallel tool execution", () => {
        expect(agent.isParallelToolExecutionEnabled()).toBe(true);
        agent.setParallelToolExecution(false);
        expect(agent.isParallelToolExecutionEnabled()).toBe(false);
      });

      it("should toggle YOLO mode", () => {
        expect(agent.isYoloModeEnabled()).toBe(false);
        agent.setYoloMode(true);
        expect(agent.isYoloModeEnabled()).toBe(true);
        expect((agent as any).maxToolRounds).toBe(400);
        agent.setYoloMode(false);
        expect(agent.isYoloModeEnabled()).toBe(false);
        expect((agent as any).maxToolRounds).toBe(50);
      });
    });

    describe("Environment Variable Handling", () => {
      it("should respect MAX_COST environment variable", () => {
        process.env.MAX_COST = "25";
        agent = new CodeBuddyAgent("test-api-key");
        expect((agent as any).sessionCostLimit).toBe(25);
      });

      it("should not enable YOLO mode with env var alone", () => {
        process.env.YOLO_MODE = "true";
        agent = new CodeBuddyAgent("test-api-key");
        expect((agent as any).yoloMode).toBe(false);
      });

      it("should enable YOLO mode when autonomy manager returns true", () => {
        mockIsYOLOEnabled.mockReturnValue(true);
        agent = new CodeBuddyAgent("test-api-key");
        expect((agent as any).yoloMode).toBe(true);
      });
    });

    describe("Disposal", () => {
      it("should clean up resources on dispose", () => {
        agent = new CodeBuddyAgent("test-api-key");
        expect(() => agent.dispose()).not.toThrow();
      });

      it("should be safe to call dispose multiple times", () => {
        agent = new CodeBuddyAgent("test-api-key");
        agent.dispose();
        expect(() => agent.dispose()).not.toThrow();
      });

      it("should clear chat history on dispose", () => {
        agent = new CodeBuddyAgent("test-api-key");
        (agent as any).chatHistory = [
          { type: "user", content: "test", timestamp: new Date() },
        ];
        agent.dispose();
        expect((agent as any).chatHistory.length).toBe(0);
      });

      it("should clear messages on dispose", () => {
        agent = new CodeBuddyAgent("test-api-key");
        (agent as any).messages = [
          { role: "system", content: "prompt" },
          { role: "user", content: "test" },
        ];
        agent.dispose();
        expect((agent as any).messages.length).toBe(0);
      });

      it("should abort ongoing operations on dispose", () => {
        agent = new CodeBuddyAgent("test-api-key");
        const controller = new AbortController();
        (agent as any).abortController = controller;
        agent.dispose();
        expect(controller.signal.aborted).toBe(true);
      });
    });

    describe("Abort Control", () => {
      beforeEach(() => {
        agent = new CodeBuddyAgent("test-api-key");
      });

      it("should handle abort when no active request", () => {
        expect(() => agent.abortCurrentOperation()).not.toThrow();
      });

      it("should abort active request", () => {
        const controller = new AbortController();
        (agent as any).abortController = controller;
        expect(controller.signal.aborted).toBe(false);
        agent.abortCurrentOperation();
        expect(controller.signal.aborted).toBe(true);
      });
    });
  });

  // ===========================================================================
  // TOOL EXECUTION TESTS
  // ===========================================================================
  describe("Tool Execution", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    describe("Basic Tool Execution", () => {
      it("should execute view_file tool successfully", async () => {
        const result = await (agent as any).executeTool({
          id: "call_1",
          type: "function",
          function: {
            name: "view_file",
            arguments: JSON.stringify({ path: "/test/file.ts" }),
          },
        });
        expect(result.success).toBe(true);
        expect(mockViewFile).toHaveBeenCalledWith("/test/file.ts", undefined);
      });

      it("should execute view_file with line range", async () => {
        const result = await (agent as any).executeTool({
          id: "call_2",
          type: "function",
          function: {
            name: "view_file",
            arguments: JSON.stringify({
              path: "/test/file.ts",
              start_line: 10,
              end_line: 20,
            }),
          },
        });
        expect(result.success).toBe(true);
        expect(mockViewFile).toHaveBeenCalledWith("/test/file.ts", [10, 20]);
      });

      it("should execute create_file with checkpoint", async () => {
        const result = await (agent as any).executeTool({
          id: "call_3",
          type: "function",
          function: {
            name: "create_file",
            arguments: JSON.stringify({
              path: "/test/new.ts",
              content: "const x = 1;",
            }),
          },
        });
        expect(result.success).toBe(true);
        expect(mockCheckpointBeforeCreate).toHaveBeenCalledWith("/test/new.ts");
        expect(mockCreateFile).toHaveBeenCalledWith("/test/new.ts", "const x = 1;");
      });

      it("should execute str_replace_editor with checkpoint", async () => {
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
        expect(mockCheckpointBeforeEdit).toHaveBeenCalledWith("/test/file.ts");
        expect(mockStrReplace).toHaveBeenCalledWith(
          "/test/file.ts",
          "old",
          "new",
          true
        );
      });

      it("should execute bash tool with hooks", async () => {
        const result = await (agent as any).executeTool({
          id: "call_5",
          type: "function",
          function: {
            name: "bash",
            arguments: JSON.stringify({ command: "ls -la" }),
          },
        });
        expect(result.success).toBe(true);
        expect(mockBashExecute).toHaveBeenCalledWith("ls -la");
        expect(mockExecuteHooks).toHaveBeenCalledWith("pre-bash", { command: "ls -la" });
        expect(mockExecuteHooks).toHaveBeenCalledWith("post-bash", expect.objectContaining({
          command: "ls -la",
        }));
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
        expect(mockSearchTool).toHaveBeenCalled();
      });

      it("should execute web_search tool", async () => {
        const result = await (agent as any).executeTool({
          id: "call_7",
          type: "function",
          function: {
            name: "web_search",
            arguments: JSON.stringify({ query: "TypeScript tutorial" }),
          },
        });
        expect(result.success).toBe(true);
        expect(mockWebSearch).toHaveBeenCalled();
      });

      it("should execute web_fetch tool", async () => {
        const result = await (agent as any).executeTool({
          id: "call_8",
          type: "function",
          function: {
            name: "web_fetch",
            arguments: JSON.stringify({ url: "https://example.com" }),
          },
        });
        expect(result.success).toBe(true);
        expect(mockFetchPage).toHaveBeenCalledWith("https://example.com");
      });
    });

    describe("Tool Execution Error Handling", () => {
      it("should handle unknown tool gracefully", async () => {
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

      it("should handle tool execution failure", async () => {
        mockViewFile.mockResolvedValueOnce({ success: false, error: "File not found" });
        const result = await (agent as any).executeTool({
          id: "call_fail",
          type: "function",
          function: {
            name: "view_file",
            arguments: JSON.stringify({ path: "/nonexistent.ts" }),
          },
        });
        expect(result.success).toBe(false);
        expect(result.error).toBe("File not found");
      });

      it("should handle tool throwing exception", async () => {
        mockViewFile.mockRejectedValueOnce(new Error("Unexpected error"));
        const result = await (agent as any).executeTool({
          id: "call_throw",
          type: "function",
          function: {
            name: "view_file",
            arguments: JSON.stringify({ path: "/test.ts" }),
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

    describe("Parallel Tool Execution", () => {
      it("should identify parallelizable read-only tool calls", () => {
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

      it("should not parallelize single tool call", () => {
        const toolCalls = [
          {
            id: "call_1",
            type: "function" as const,
            function: { name: "view_file", arguments: '{"path": "/a.ts"}' },
          },
        ];
        const canParallelize = (agent as any).canParallelizeToolCalls(toolCalls);
        expect(canParallelize).toBe(false);
      });

      it("should not parallelize write operations to same file", () => {
        const toolCalls = [
          {
            id: "call_1",
            type: "function" as const,
            function: {
              name: "str_replace_editor",
              arguments: '{"path": "/a.ts", "old_str": "a", "new_str": "b"}',
            },
          },
          {
            id: "call_2",
            type: "function" as const,
            function: {
              name: "str_replace_editor",
              arguments: '{"path": "/a.ts", "old_str": "c", "new_str": "d"}',
            },
          },
        ];
        const canParallelize = (agent as any).canParallelizeToolCalls(toolCalls);
        expect(canParallelize).toBe(false);
      });

      it("should parallelize write operations to different files", () => {
        const toolCalls = [
          {
            id: "call_1",
            type: "function" as const,
            function: {
              name: "str_replace_editor",
              arguments: '{"path": "/a.ts", "old_str": "a", "new_str": "b"}',
            },
          },
          {
            id: "call_2",
            type: "function" as const,
            function: {
              name: "str_replace_editor",
              arguments: '{"path": "/b.ts", "old_str": "c", "new_str": "d"}',
            },
          },
        ];
        const canParallelize = (agent as any).canParallelizeToolCalls(toolCalls);
        expect(canParallelize).toBe(true);
      });

      it("should execute tools in parallel when enabled", async () => {
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

      it("should handle parallel execution with one failing tool", async () => {
        mockSearchTool.mockRejectedValueOnce(new Error("Search failed"));
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
        expect(results.get("call_2").success).toBe(false);
      });
    });

    describe("MCP Tool Execution", () => {
      it("should execute MCP tool successfully", async () => {
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
  });

  // ===========================================================================
  // RESPONSE HANDLING TESTS
  // ===========================================================================
  describe("Response Handling", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    describe("Non-Streaming Response", () => {
      it("should process user message and add to history", async () => {
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

      it("should update chat history", async () => {
        await agent.processUserMessage("Hello");
        const history = agent.getChatHistory();
        expect(history.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe("Streaming Response", () => {
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

      it("should handle abort during streaming", async () => {
        const chunks: StreamingChunk[] = [];
        // Set up abort after first chunk
        setTimeout(() => agent.abortCurrentOperation(), 5);

        for await (const chunk of agent.processUserMessageStream("Hello")) {
          chunks.push(chunk);
        }
        // Should complete without error
        expect(chunks.find((c) => c.type === "done")).toBeDefined();
      });
    });

    describe("Message Accumulation", () => {
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
        const toolCalls = acc.tool_calls as Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
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

    describe("Tool Call Response Handling", () => {
      it("should process tool calls in response", async () => {
        // Mock a response with tool calls
        mockChatResponse.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: "Let me check that file.",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "view_file",
                      arguments: JSON.stringify({ path: "/test.ts" }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }).mockResolvedValueOnce({
          choices: [{ message: { content: "Here is the file content.", tool_calls: null } }],
          usage: { prompt_tokens: 150, completion_tokens: 75 },
        });

        const entries = await agent.processUserMessage("Show me test.ts");
        expect(entries.length).toBeGreaterThan(2);

        // Find tool result entries
        const toolResultEntries = entries.filter((e) => e.type === "tool_result");
        expect(toolResultEntries.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe("Context Management", () => {
      it("should prepare messages through context manager", async () => {
        await agent.processUserMessage("Hello");
        expect(mockPrepareMessages).toHaveBeenCalled();
      });

      it("should check for context warnings", async () => {
        await agent.processUserMessage("Hello");
        expect(mockShouldWarn).toHaveBeenCalled();
      });

      it("should yield context warning when approaching limit", async () => {
        mockShouldWarn.mockReturnValue({ warn: true, message: "Context warning" });
        const chunks: StreamingChunk[] = [];
        for await (const chunk of agent.processUserMessageStream("Hello")) {
          chunks.push(chunk);
        }
        const contentChunks = chunks.filter((c) => c.type === "content");
        expect(contentChunks.some((c) => c.content?.includes("Context warning"))).toBe(true);
      });
    });
  });

  // ===========================================================================
  // ERROR HANDLING TESTS
  // ===========================================================================
  describe("Error Handling", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    describe("API Error Handling", () => {
      it("should handle chat API errors gracefully", async () => {
        mockChatResponse.mockRejectedValueOnce(new Error("API Error"));
        const entries = await agent.processUserMessage("Hello");
        const errorEntry = entries.find((e) => e.content?.includes("error"));
        expect(errorEntry).toBeDefined();
      });

      it("should handle streaming API errors gracefully", async () => {
        mockChatStreamResponse.mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: "Start " } }] };
          throw new Error("Stream error");
        });
        const chunks: StreamingChunk[] = [];
        for await (const chunk of agent.processUserMessageStream("Hello")) {
          chunks.push(chunk);
        }
        expect(chunks.find((c) => c.type === "done")).toBeDefined();
      });

      it("should add error response to messages for valid conversation structure", async () => {
        mockChatResponse.mockRejectedValueOnce(new Error("API Error"));
        await agent.processUserMessage("Hello");
        const messages = (agent as any).messages;
        const lastMessage = messages[messages.length - 1];
        expect(lastMessage.role).toBe("assistant");
        expect(lastMessage.content).toContain("error");
      });
    });

    describe("Cost Limit Error Handling", () => {
      it("should stop processing when cost limit reached", async () => {
        agent.setSessionCostLimit(0.0001);
        mockCalculateCost.mockReturnValue(0.001);

        // First call sets up the cost
        await agent.processUserMessage("Hello");

        // Next call should hit the limit
        const entries = await agent.processUserMessage("Hello again");
        const costEntry = entries.find((e) => e.content?.includes("cost limit"));
        expect(costEntry).toBeDefined();
      });

      it("should yield cost limit warning in streaming mode", async () => {
        agent.setSessionCostLimit(0.0001);
        mockCalculateCost.mockReturnValue(0.001);

        // Mock a response with tool calls to trigger cost tracking
        mockChatStreamResponse.mockImplementationOnce(async function* () {
          yield { choices: [{ delta: { content: "Let me check that" } }] };
          yield {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "view_file", arguments: '{"path": "/a.ts"}' }
                }]
              }
            }]
          };
        });

        // First call with tool to set up cost
        const chunks1: StreamingChunk[] = [];
        for await (const chunk of agent.processUserMessageStream("Hello")) {
          chunks1.push(chunk);
        }

        // Second call should yield cost warning (cost already exceeded from first call)
        const chunks2: StreamingChunk[] = [];
        for await (const chunk of agent.processUserMessageStream("Hello again")) {
          chunks2.push(chunk);
        }
        const costChunk = chunks2.find((c) => c.content?.includes("cost limit"));
        expect(costChunk).toBeDefined();
      });
    });

    describe("Max Tool Rounds Error Handling", () => {
      it("should stop after max tool rounds", async () => {
        // Create agent with low max tool rounds
        agent = new CodeBuddyAgent("test-api-key", undefined, undefined, 1);

        // Mock response that always returns tool calls
        mockChatResponse.mockResolvedValue({
          choices: [
            {
              message: {
                content: "Using tool",
                tool_calls: [
                  {
                    id: "call_loop",
                    type: "function",
                    function: {
                      name: "view_file",
                      arguments: JSON.stringify({ path: "/test.ts" }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        });

        const entries = await agent.processUserMessage("Loop test");
        const maxRoundsEntry = entries.find((e) =>
          e.content?.includes("Maximum tool execution rounds")
        );
        expect(maxRoundsEntry).toBeDefined();
      });
    });

    describe("History Management Error Prevention", () => {
      it("should trim history when exceeding max size", () => {
        const largeHistory: ChatEntry[] = [];
        for (let i = 0; i < 1100; i++) {
          largeHistory.push({
            type: "user",
            content: `message ${i}`,
            timestamp: new Date(),
          });
        }
        (agent as any).chatHistory = largeHistory;
        (agent as any).trimHistory();
        expect((agent as any).chatHistory.length).toBe(1000);
      });

      it("should preserve system message when trimming", () => {
        const largeMessages = [{ role: "system", content: "system prompt" }];
        for (let i = 0; i < 1100; i++) {
          largeMessages.push({ role: "user", content: `message ${i}` });
        }
        (agent as any).messages = largeMessages;
        (agent as any).trimHistory();
        expect((agent as any).messages[0].role).toBe("system");
        expect((agent as any).messages.length).toBe(1001);
      });
    });

    describe("Graceful Degradation", () => {
      it("should continue working after recoverable errors", async () => {
        // First call fails
        mockChatResponse.mockRejectedValueOnce(new Error("Temporary error"));
        const entries1 = await agent.processUserMessage("First");
        expect(entries1.find((e) => e.content?.includes("error"))).toBeDefined();

        // Reset mock and try again
        mockChatResponse.mockResolvedValueOnce({
          choices: [{ message: { content: "Success", tool_calls: null } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        });
        const entries2 = await agent.processUserMessage("Second");
        expect(entries2.find((e) => e.content === "Success")).toBeDefined();
      });

      it("should handle hook execution failures gracefully", async () => {
        mockExecuteHooks.mockRejectedValueOnce(new Error("Hook failed"));
        const result = await (agent as any).executeTool({
          id: "call_hook_fail",
          type: "function",
          function: {
            name: "bash",
            arguments: JSON.stringify({ command: "echo test" }),
          },
        });
        // Should still execute the command despite hook failure
        expect(result.success).toBe(true);
      });
    });
  });

  // ===========================================================================
  // INTEGRATION TESTS
  // ===========================================================================
  describe("Integration Tests", () => {
    beforeEach(() => {
      agent = new CodeBuddyAgent("test-api-key");
    });

    it("should handle complete conversation flow", async () => {
      // Initial message
      const entries1 = await agent.processUserMessage("Hello");
      expect(entries1.length).toBeGreaterThan(0);

      // Follow-up message
      mockChatResponse.mockResolvedValueOnce({
        choices: [{ message: { content: "Follow-up response", tool_calls: null } }],
        usage: { prompt_tokens: 150, completion_tokens: 75 },
      });
      const entries2 = await agent.processUserMessage("Follow-up");
      expect(entries2.length).toBeGreaterThan(0);

      // Check history
      const history = agent.getChatHistory();
      expect(history.length).toBeGreaterThanOrEqual(4);
    });

    it("should maintain state across multiple operations", async () => {
      // Process a message
      await agent.processUserMessage("Hello");

      // Change some settings
      agent.setRAGToolSelection(false);
      agent.setParallelToolExecution(false);

      // Process another message
      const entries = await agent.processUserMessage("Hello again");
      expect(entries.length).toBeGreaterThan(0);

      // Verify settings persisted
      expect(agent.isRAGToolSelectionEnabled()).toBe(false);
      expect(agent.isParallelToolExecutionEnabled()).toBe(false);
    });

    it("should clear chat and reset for new conversation", async () => {
      // Have a conversation
      await agent.processUserMessage("Hello");
      await agent.processUserMessage("How are you?");
      expect(agent.getChatHistory().length).toBeGreaterThan(0);

      // Clear chat
      agent.clearChat();
      expect(agent.getChatHistory().length).toBe(0);

      // Start new conversation
      mockChatResponse.mockResolvedValueOnce({
        choices: [{ message: { content: "New conversation", tool_calls: null } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      });
      const entries = await agent.processUserMessage("New topic");
      expect(entries.length).toBeGreaterThan(0);
    });
  });
});
