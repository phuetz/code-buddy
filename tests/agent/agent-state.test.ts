/**
 * Tests for AgentState module
 */

import { AgentState, DEFAULT_AGENT_CONFIG, YOLO_CONFIG } from "../../src/agent/agent-state";

// Mock all dependencies
jest.mock("../../src/utils/cost-tracker.js", () => ({
  getCostTracker: jest.fn().mockReturnValue({
    calculateCost: jest.fn().mockReturnValue(0.001),
    recordUsage: jest.fn(),
  }),
  CostTracker: jest.fn(),
}));

jest.mock("../../src/agent/agent-mode.js", () => ({
  getAgentModeManager: jest.fn().mockReturnValue({
    getMode: jest.fn().mockReturnValue("code"),
    setMode: jest.fn(),
    formatModeStatus: jest.fn().mockReturnValue("Mode: code"),
    isToolAllowed: jest.fn().mockReturnValue(true),
  }),
  AgentModeManager: jest.fn(),
}));

jest.mock("../../src/security/sandbox.js", () => ({
  getSandboxManager: jest.fn().mockReturnValue({
    formatStatus: jest.fn().mockReturnValue("Sandbox: enabled"),
    validateCommand: jest.fn().mockReturnValue({ valid: true }),
  }),
  SandboxManager: jest.fn(),
}));

jest.mock("../../src/context/context-manager-v2.js", () => ({
  createContextManager: jest.fn().mockReturnValue({
    getStats: jest.fn().mockReturnValue({
      totalTokens: 1000,
      maxTokens: 100000,
      usagePercent: 1,
      messageCount: 5,
      summarizedSessions: 0,
      isCritical: false,
      isNearLimit: false,
    }),
    updateConfig: jest.fn(),
    dispose: jest.fn(),
  }),
  ContextManagerV2: jest.fn(),
}));

jest.mock("../../src/persistence/session-store.js", () => ({
  getSessionStore: jest.fn().mockReturnValue({
    updateCurrentSession: jest.fn(),
    formatSessionList: jest.fn().mockReturnValue("Sessions: 1"),
    getCurrentSessionId: jest.fn().mockReturnValue("session-123"),
    exportSessionToFile: jest.fn().mockReturnValue("/path/to/export.json"),
  }),
  SessionStore: jest.fn(),
}));

describe("AgentState", () => {
  let state: AgentState;
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.YOLO_MODE;
    delete process.env.MAX_COST;
    state = new AgentState();
  });

  afterEach(() => {
    process.env = originalEnv;
    state.dispose();
  });

  describe("Configuration", () => {
    it("should use default configuration", () => {
      const config = state.getConfig();
      expect(config.maxToolRounds).toBe(DEFAULT_AGENT_CONFIG.maxToolRounds);
      expect(config.sessionCostLimit).toBe(DEFAULT_AGENT_CONFIG.sessionCostLimit);
      expect(config.yoloMode).toBe(false);
    });

    it("should accept custom configuration", () => {
      const customState = new AgentState({ maxToolRounds: 100 });
      expect(customState.getConfig().maxToolRounds).toBe(100);
      customState.dispose();
    });

    it("should update configuration", () => {
      state.updateConfig({ maxToolRounds: 75 });
      expect(state.getConfig().maxToolRounds).toBe(75);
    });

    it("should emit config:updated event", () => {
      const handler = jest.fn();
      state.on("config:updated", handler);
      state.updateConfig({ maxToolRounds: 75 });
      expect(handler).toHaveBeenCalled();
    });

    it("should get/set max tool rounds", () => {
      state.setMaxToolRounds(200);
      expect(state.getMaxToolRounds()).toBe(200);
    });
  });

  describe("YOLO Mode", () => {
    it("should enable YOLO mode from environment", () => {
      process.env.YOLO_MODE = "true";
      const yoloState = new AgentState();
      expect(yoloState.isYoloModeEnabled()).toBe(true);
      expect(yoloState.getConfig().maxToolRounds).toBe(YOLO_CONFIG.maxToolRounds);
      yoloState.dispose();
    });

    it("should enable YOLO mode from options", () => {
      const yoloState = new AgentState({ yoloMode: true });
      expect(yoloState.isYoloModeEnabled()).toBe(true);
      yoloState.dispose();
    });

    it("should toggle YOLO mode", () => {
      expect(state.isYoloModeEnabled()).toBe(false);
      state.setYoloMode(true);
      expect(state.isYoloModeEnabled()).toBe(true);
      expect(state.getMaxToolRounds()).toBe(400);

      state.setYoloMode(false);
      expect(state.isYoloModeEnabled()).toBe(false);
      expect(state.getMaxToolRounds()).toBe(DEFAULT_AGENT_CONFIG.maxToolRounds);
    });

    it("should emit yolo:changed event", () => {
      const handler = jest.fn();
      state.on("yolo:changed", handler);
      state.setYoloMode(true);
      expect(handler).toHaveBeenCalledWith(true);
    });
  });

  describe("Cost Tracking", () => {
    it("should start with zero session cost", () => {
      expect(state.getSessionCost()).toBe(0);
    });

    it("should record session cost", () => {
      state.recordSessionCost(1000, 500, "grok-3-latest");
      expect(state.getSessionCost()).toBeGreaterThan(0);
    });

    it("should check cost limit reached", () => {
      expect(state.isSessionCostLimitReached()).toBe(false);
      state.setSessionCostLimit(0.001);
      state.recordSessionCost(1000, 500, "grok-3-latest");
      expect(state.isSessionCostLimitReached()).toBe(true);
    });

    it("should emit cost:recorded event", () => {
      const handler = jest.fn();
      state.on("cost:recorded", handler);
      state.recordSessionCost(100, 50, "grok-3-latest");
      expect(handler).toHaveBeenCalled();
    });

    it("should emit cost:limitReached event", () => {
      const handler = jest.fn();
      state.on("cost:limitReached", handler);
      state.setSessionCostLimit(0.0001);
      state.recordSessionCost(1000, 500, "grok-3-latest");
      expect(handler).toHaveBeenCalled();
    });

    it("should format cost status", () => {
      const status = state.formatCostStatus();
      expect(status).toContain("Safe");
      expect(status).toContain("Session:");
    });

    it("should format YOLO cost status", () => {
      state.setYoloMode(true);
      const status = state.formatCostStatus();
      expect(status).toContain("YOLO");
      expect(status).toContain("unlimited");
    });

    it("should respect MAX_COST environment variable", () => {
      process.env.MAX_COST = "25";
      const costState = new AgentState();
      expect(costState.getSessionCostLimit()).toBe(25);
      costState.dispose();
    });
  });

  describe("Mode Management", () => {
    it("should get current mode", () => {
      expect(state.getMode()).toBe("code");
    });

    it("should set mode", () => {
      const handler = jest.fn();
      state.on("mode:changed", handler);
      state.setMode("plan");
      expect(handler).toHaveBeenCalledWith("plan");
    });

    it("should get mode status", () => {
      expect(state.getModeStatus()).toBe("Mode: code");
    });

    it("should check tool allowed in mode", () => {
      expect(state.isToolAllowedInCurrentMode("view_file")).toBe(true);
    });
  });

  describe("Sandbox Management", () => {
    it("should get sandbox status", () => {
      expect(state.getSandboxStatus()).toBe("Sandbox: enabled");
    });

    it("should validate command", () => {
      const result = state.validateCommand("ls -la");
      expect(result.valid).toBe(true);
    });
  });

  describe("Context Management", () => {
    it("should get context stats", () => {
      const stats = state.getContextStats([]);
      expect(stats.totalTokens).toBe(1000);
      expect(stats.maxTokens).toBe(100000);
    });

    it("should format context stats", () => {
      const formatted = state.formatContextStats([]);
      expect(formatted).toContain("Context:");
      expect(formatted).toContain("Normal");
    });

    it("should update context config", () => {
      // Just verify it doesn't throw
      state.updateContextConfig({ maxContextTokens: 50000 });
    });
  });

  describe("Session Management", () => {
    it("should save current session", () => {
      state.saveCurrentSession([]);
    });

    it("should get session list", () => {
      expect(state.getSessionList()).toBe("Sessions: 1");
    });

    it("should export current session", () => {
      const path = state.exportCurrentSession();
      expect(path).toBe("/path/to/export.json");
    });
  });

  describe("Parallel Execution", () => {
    it("should toggle parallel tool execution", () => {
      expect(state.isParallelToolExecutionEnabled()).toBe(false);
      state.setParallelToolExecution(true);
      expect(state.isParallelToolExecutionEnabled()).toBe(true);
    });

    it("should emit parallel:changed event", () => {
      const handler = jest.fn();
      state.on("parallel:changed", handler);
      state.setParallelToolExecution(true);
      expect(handler).toHaveBeenCalledWith(true);
    });
  });

  describe("RAG Tool Selection", () => {
    it("should toggle RAG tool selection", () => {
      expect(state.isRAGToolSelectionEnabled()).toBe(false);
      state.setRAGToolSelection(true);
      expect(state.isRAGToolSelectionEnabled()).toBe(true);
    });

    it("should get/set last tool selection", () => {
      expect(state.getLastToolSelection()).toBeNull();
      state.setLastToolSelection({ tools: ["view_file"] });
      expect(state.getLastToolSelection()).toEqual({ tools: ["view_file"] });
    });
  });

  describe("Abort Control", () => {
    it("should create abort controller", () => {
      const controller = state.createAbortController();
      expect(controller).toBeInstanceOf(AbortController);
    });

    it("should get abort controller", () => {
      const controller = state.createAbortController();
      expect(state.getAbortController()).toBe(controller);
    });

    it("should abort current operation", () => {
      const controller = state.createAbortController();
      state.abortCurrentOperation();
      expect(controller.signal.aborted).toBe(true);
    });

    it("should check if aborted", () => {
      expect(state.isAborted()).toBe(false);
      state.createAbortController();
      state.abortCurrentOperation();
      expect(state.isAborted()).toBe(true);
    });

    it("should clear abort controller", () => {
      state.createAbortController();
      state.clearAbortController();
      expect(state.getAbortController()).toBeNull();
    });

    it("should emit operation:aborted event", () => {
      const handler = jest.fn();
      state.on("operation:aborted", handler);
      state.createAbortController();
      state.abortCurrentOperation();
      expect(handler).toHaveBeenCalled();
    });
  });

  describe("Dispose", () => {
    it("should dispose resources", () => {
      const handler = jest.fn();
      state.on("disposed", handler);

      state.createAbortController();
      state.recordSessionCost(1000, 500, "grok-3-latest");

      state.dispose();

      expect(handler).toHaveBeenCalled();
      expect(state.getSessionCost()).toBe(0);
      expect(state.getLastToolSelection()).toBeNull();
    });
  });
});
