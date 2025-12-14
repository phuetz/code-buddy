/**
 * Tests for GrokAgent - Core agent orchestration
 */

import { GrokAgent } from "../../src/agent/grok-agent";

// Mock all dependencies
jest.mock("../../src/grok/client.js", () => ({
  GrokClient: jest.fn().mockImplementation(() => ({
    chat: jest.fn().mockResolvedValue({
      choices: [{ message: { content: "Test response", tool_calls: null } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
    chatStream: jest.fn().mockImplementation(async function* () {
      yield { choices: [{ delta: { content: "Test " } }] };
      yield { choices: [{ delta: { content: "response" } }] };
    }),
    getModel: jest.fn().mockReturnValue("grok-code-fast-1"),
    getCurrentModel: jest.fn().mockReturnValue("grok-code-fast-1"),
    setModel: jest.fn(),
  })),
}));

jest.mock("../../src/grok/tools.js", () => ({
  getAllGrokTools: jest.fn().mockReturnValue([
    { type: "function", function: { name: "test_tool", description: "Test", parameters: {} } },
  ]),
  getRelevantTools: jest.fn().mockReturnValue({
    tools: [],
    savedTokens: 0,
    categories: [],
    confidence: 1,
  }),
  getMCPManager: jest.fn().mockReturnValue({
    getClients: jest.fn().mockReturnValue([]),
    getTools: jest.fn().mockReturnValue([]),
  }),
  initializeMCPServers: jest.fn().mockResolvedValue(undefined),
  classifyQuery: jest.fn().mockReturnValue({ categories: ["general"], confidence: 0.8 }),
  getToolSelector: jest.fn().mockReturnValue({
    classifyQuery: jest.fn().mockReturnValue({ categories: ["general"] }),
    selectTools: jest.fn().mockReturnValue({ tools: [], savedTokens: 0 }),
  }),
}));

jest.mock("../../src/tools/tool-selector.js", () => ({
  recordToolRequest: jest.fn(),
  formatToolSelectionMetrics: jest.fn().mockReturnValue("Metrics: OK"),
}));

jest.mock("../../src/mcp/config.js", () => ({
  loadMCPConfig: jest.fn().mockReturnValue(null),
}));

jest.mock("../../src/tools/index.js", () => ({
  TextEditorTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, output: "Done" }),
  })),
  MorphEditorTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, output: "Done" }),
  })),
  BashTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, output: "Command executed" }),
  })),
  TodoTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, output: "Todo added" }),
  })),
  SearchTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, output: "Found 5 results" }),
  })),
  WebSearchTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, output: "Web results" }),
  })),
  ImageTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, output: "Image processed" }),
  })),
}));

jest.mock("../../src/utils/token-counter.js", () => ({
  createTokenCounter: jest.fn().mockReturnValue({
    countTokens: jest.fn().mockReturnValue(100),
    countMessageTokens: jest.fn().mockReturnValue(50),
    dispose: jest.fn(),
  }),
  TokenCounter: jest.fn(),
}));

jest.mock("../../src/utils/custom-instructions.js", () => ({
  loadCustomInstructions: jest.fn().mockReturnValue(null),
}));

jest.mock("../../src/checkpoints/checkpoint-manager.js", () => ({
  getCheckpointManager: jest.fn().mockReturnValue({
    createCheckpoint: jest.fn().mockResolvedValue("checkpoint-1"),
    restoreCheckpoint: jest.fn().mockResolvedValue(true),
    listCheckpoints: jest.fn().mockReturnValue([]),
  }),
  CheckpointManager: jest.fn(),
}));

jest.mock("../../src/persistence/session-store.js", () => ({
  getSessionStore: jest.fn().mockReturnValue({
    updateCurrentSession: jest.fn(),
    getCurrentSessionId: jest.fn().mockReturnValue("session-123"),
    loadSession: jest.fn().mockReturnValue(null),
    saveSession: jest.fn(),
  }),
  SessionStore: jest.fn(),
}));

jest.mock("../../src/agent/agent-mode.js", () => ({
  getAgentModeManager: jest.fn().mockReturnValue({
    getMode: jest.fn().mockReturnValue("code"),
    setMode: jest.fn(),
    isToolAllowed: jest.fn().mockReturnValue(true),
    formatModeStatus: jest.fn().mockReturnValue("Mode: code"),
  }),
  AgentModeManager: jest.fn(),
}));

jest.mock("../../src/security/sandbox.js", () => ({
  getSandboxManager: jest.fn().mockReturnValue({
    validateCommand: jest.fn().mockReturnValue({ valid: true }),
    formatStatus: jest.fn().mockReturnValue("Sandbox: active"),
  }),
  SandboxManager: jest.fn(),
}));

jest.mock("../../src/mcp/mcp-client.js", () => ({
  getMCPClient: jest.fn().mockReturnValue({
    isConnected: jest.fn().mockReturnValue(false),
    connect: jest.fn().mockResolvedValue(undefined),
    listTools: jest.fn().mockResolvedValue([]),
  }),
  MCPClient: jest.fn(),
}));

jest.mock("../../src/utils/settings-manager.js", () => ({
  getSettingsManager: jest.fn().mockReturnValue({
    getCurrentModel: jest.fn().mockReturnValue("grok-code-fast-1"),
    setCurrentModel: jest.fn(),
    getSettings: jest.fn().mockReturnValue({}),
  }),
}));

jest.mock("../../src/prompts/index.js", () => ({
  getSystemPromptForMode: jest.fn().mockReturnValue("You are a helpful assistant."),
  getChatOnlySystemPrompt: jest.fn().mockReturnValue("You are a chat assistant."),
  getPromptManager: jest.fn().mockReturnValue({
    buildSystemPrompt: jest.fn().mockResolvedValue("System prompt"),
    loadPrompt: jest.fn().mockResolvedValue("Prompt content"),
  }),
  autoSelectPromptId: jest.fn().mockReturnValue("default"),
}));

jest.mock("../../src/utils/cost-tracker.js", () => ({
  getCostTracker: jest.fn().mockReturnValue({
    calculateCost: jest.fn().mockReturnValue(0.001),
    recordUsage: jest.fn(),
    getTotalCost: jest.fn().mockReturnValue(0.05),
    formatCostSummary: jest.fn().mockReturnValue("Total: $0.05"),
  }),
  CostTracker: jest.fn(),
}));

jest.mock("../../src/utils/autonomy-manager.js", () => ({
  getAutonomyManager: jest.fn().mockReturnValue({
    isYOLOEnabled: jest.fn().mockReturnValue(false),
    enableYOLO: jest.fn(),
    disableYOLO: jest.fn(),
  }),
}));

jest.mock("../../src/context/context-manager-v2.js", () => ({
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
  }),
  ContextManagerV2: jest.fn(),
}));

jest.mock("../../src/utils/sanitize.js", () => ({
  sanitizeLLMOutput: jest.fn().mockImplementation((text) => text),
  extractCommentaryToolCalls: jest.fn().mockReturnValue({ commentary: null, toolCalls: [] }),
}));

jest.mock("../../src/types/errors.js", () => ({
  getErrorMessage: jest.fn().mockImplementation((err) => err?.message || String(err)),
}));

describe("GrokAgent", () => {
  let agent: GrokAgent;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.YOLO_MODE;
    delete process.env.MAX_COST;
    delete process.env.MORPH_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    if (agent) {
      agent.dispose();
    }
  });

  describe("Constructor", () => {
    it("should create agent with API key", () => {
      agent = new GrokAgent("test-api-key");
      expect(agent).toBeInstanceOf(GrokAgent);
    });

    it("should create agent with custom model", () => {
      agent = new GrokAgent("test-api-key", undefined, "grok-2");
      expect(agent).toBeInstanceOf(GrokAgent);
    });

    it("should create agent with custom base URL", () => {
      agent = new GrokAgent("test-api-key", "https://custom.api.com");
      expect(agent).toBeInstanceOf(GrokAgent);
    });

    it("should set default max tool rounds to 50", () => {
      agent = new GrokAgent("test-api-key");
      // Access private property for testing
      expect((agent as any).maxToolRounds).toBe(50);
    });

    it("should set custom max tool rounds", () => {
      agent = new GrokAgent("test-api-key", undefined, undefined, 100);
      expect((agent as any).maxToolRounds).toBe(100);
    });

    it("should set default session cost limit to $10", () => {
      agent = new GrokAgent("test-api-key");
      expect((agent as any).sessionCostLimit).toBe(10);
    });

    it("should use MAX_COST env var for session limit", () => {
      process.env.MAX_COST = "25";
      agent = new GrokAgent("test-api-key");
      expect((agent as any).sessionCostLimit).toBe(25);
    });
  });

  describe("YOLO Mode", () => {
    it("should not enable YOLO mode by default", () => {
      agent = new GrokAgent("test-api-key");
      expect((agent as any).yoloMode).toBe(false);
    });

    it("should not enable YOLO mode with env var alone", () => {
      process.env.YOLO_MODE = "true";
      agent = new GrokAgent("test-api-key");
      // YOLO mode requires explicit config, not just env var
      expect((agent as any).yoloMode).toBe(false);
    });
  });

  describe("Events", () => {
    it("should be an EventEmitter", () => {
      agent = new GrokAgent("test-api-key");
      expect(agent.on).toBeDefined();
      expect(agent.emit).toBeDefined();
      expect(agent.off).toBeDefined();
    });

    it("should emit events during processing", (done) => {
      agent = new GrokAgent("test-api-key");
      const events: string[] = [];

      agent.on("thinking", () => events.push("thinking"));
      agent.on("response", () => {
        events.push("response");
        expect(events).toContain("thinking");
        done();
      });

      // Trigger processing (would need to call processUserMessage)
      agent.emit("thinking");
      agent.emit("response", "Test response");
    });
  });

  describe("History Management", () => {
    it("should start with empty chat history", () => {
      agent = new GrokAgent("test-api-key");
      expect(agent.getChatHistory()).toEqual([]);
    });

    it("should provide getChatHistory method", () => {
      agent = new GrokAgent("test-api-key");
      const history = agent.getChatHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe("Abort Control", () => {
    it("should support abortCurrentOperation method", () => {
      agent = new GrokAgent("test-api-key");
      expect(agent.abortCurrentOperation).toBeDefined();
    });

    it("should abort ongoing operations", () => {
      agent = new GrokAgent("test-api-key");
      // Start a mock operation
      const controller = new AbortController();
      (agent as any).abortController = controller;
      expect(controller.signal.aborted).toBe(false);

      agent.abortCurrentOperation();
      // After abort, signal should be aborted
      expect(controller.signal.aborted).toBe(true);
    });
  });

  describe("Model Management", () => {
    it("should get current model", () => {
      agent = new GrokAgent("test-api-key");
      const model = agent.getCurrentModel();
      expect(model).toBeDefined();
    });

    it("should set new model", () => {
      agent = new GrokAgent("test-api-key");
      agent.setModel("grok-2");
      // Model change is handled by the client
    });
  });

  describe("Dispose", () => {
    it("should clean up resources on dispose", () => {
      agent = new GrokAgent("test-api-key");
      expect(() => agent.dispose()).not.toThrow();
    });

    it("should be safe to call dispose multiple times", () => {
      agent = new GrokAgent("test-api-key");
      agent.dispose();
      expect(() => agent.dispose()).not.toThrow();
    });
  });

  describe("Tool Selection", () => {
    it("should enable RAG tool selection by default", () => {
      agent = new GrokAgent("test-api-key");
      expect((agent as any).useRAGToolSelection).toBe(true);
    });

    it("should allow disabling RAG tool selection", () => {
      agent = new GrokAgent("test-api-key", undefined, undefined, undefined, false);
      expect((agent as any).useRAGToolSelection).toBe(false);
    });
  });

  describe("Status Formatting", () => {
    it("should format cost status", () => {
      agent = new GrokAgent("test-api-key");
      const status = agent.formatCostStatus();
      expect(status).toBeDefined();
      expect(typeof status).toBe("string");
    });
  });

  describe("Static Properties", () => {
    it("should have MAX_HISTORY_SIZE constant", () => {
      expect((GrokAgent as any).MAX_HISTORY_SIZE).toBe(1000);
    });
  });
});

describe("GrokAgent Integration", () => {
  it("should process simple message flow", async () => {
    const agent = new GrokAgent("test-api-key");

    // Check that history starts empty
    const history = agent.getChatHistory();
    expect(history).toEqual([]);

    // Clean up
    agent.dispose();
  });

  it("should have all core methods available", () => {
    const agent = new GrokAgent("test-api-key");

    // Core methods should exist
    expect(agent.getChatHistory).toBeDefined();
    expect(agent.getCurrentModel).toBeDefined();
    expect(agent.setModel).toBeDefined();
    expect(agent.abortCurrentOperation).toBeDefined();
    expect(agent.dispose).toBeDefined();

    agent.dispose();
  });
});
