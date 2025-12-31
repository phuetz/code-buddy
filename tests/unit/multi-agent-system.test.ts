/**
 * Unit tests for MultiAgentSystem class
 */

import { EventEmitter } from "events";
import {
  MultiAgentSystem,
  createMultiAgentSystem,
  getMultiAgentSystem,
  resetMultiAgentSystem,
} from "../../src/agent/multi-agent/multi-agent-system";
import {
  AgentRole,
  AgentTask,
  SharedContext,
  ExecutionPlan,
  PlanPhase,
  WorkflowOptions,
  AgentExecutionResult,
  TaskArtifact,
} from "../../src/agent/multi-agent/types";
import { CodeBuddyTool, CodeBuddyToolCall } from "../../src/codebuddy/client";
import { ToolResult } from "../../src/types/index";

// Mock all agent modules
jest.mock("../../src/agent/multi-agent/agents/orchestrator-agent.js", () => ({
  createOrchestratorAgent: jest.fn().mockImplementation(() => createMockAgent("orchestrator")),
  OrchestratorAgent: jest.fn(),
}));

jest.mock("../../src/agent/multi-agent/agents/coder-agent.js", () => ({
  createCoderAgent: jest.fn().mockImplementation(() => createMockAgent("coder")),
  CoderAgent: jest.fn(),
}));

jest.mock("../../src/agent/multi-agent/agents/reviewer-agent.js", () => ({
  createReviewerAgent: jest.fn().mockImplementation(() => createMockAgent("reviewer")),
  ReviewerAgent: jest.fn(),
}));

jest.mock("../../src/agent/multi-agent/agents/tester-agent.js", () => ({
  createTesterAgent: jest.fn().mockImplementation(() => createMockAgent("tester")),
  TesterAgent: jest.fn(),
}));

jest.mock("../../src/codebuddy/tools.js", () => ({
  getAllCodeBuddyTools: jest.fn().mockResolvedValue([
    { type: "function", function: { name: "view_file", description: "View", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "search", description: "Search", parameters: { type: "object", properties: {}, required: [] } } },
  ]),
}));

jest.mock("../../src/types/index.js", () => ({
  getErrorMessage: jest.fn().mockImplementation((err) => err?.message || String(err)),
}));

// Helper function to create mock agents
function createMockAgent(role: AgentRole): any {
  const emitter = new EventEmitter();
  return {
    ...emitter,
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    removeAllListeners: emitter.removeAllListeners.bind(emitter),
    getRole: jest.fn().mockReturnValue(role),
    getConfig: jest.fn().mockReturnValue({ role, name: role }),
    hasCapability: jest.fn().mockReturnValue(true),
    execute: jest.fn().mockResolvedValue({
      success: true,
      role,
      taskId: "task-123",
      output: "Task completed",
      artifacts: [],
      toolsUsed: ["view_file"],
      rounds: 1,
      duration: 100,
    }),
    receiveMessage: jest.fn(),
    sendMessage: jest.fn(),
    stop: jest.fn(),
    reset: jest.fn(),
    // Orchestrator-specific methods
    createPlan: jest.fn().mockResolvedValue(createMockPlan()),
    synthesizeResults: jest.fn().mockResolvedValue("Workflow completed successfully"),
    getNextTasks: jest.fn().mockReturnValue([]),
    updateTaskStatus: jest.fn(),
    isPlanComplete: jest.fn().mockReturnValue(true),
    // Reviewer-specific methods
    reviewCode: jest.fn().mockResolvedValue({ approved: true, feedbackItems: [], criticalIssues: 0, majorIssues: 0 }),
    // Tester-specific methods
    runTests: jest.fn().mockResolvedValue({ success: true }),
    // Coder-specific methods
    refactorCode: jest.fn().mockResolvedValue({ success: true }),
  };
}

function createMockPlan(): ExecutionPlan {
  return {
    id: "plan-123",
    goal: "Test goal",
    summary: "Test summary",
    phases: [
      {
        id: "phase-1",
        name: "Implementation",
        description: "Implement the feature",
        tasks: [
          {
            id: "task-1",
            title: "Write code",
            description: "Write the code",
            status: "pending",
            priority: "high",
            assignedTo: "coder",
            dependencies: [],
            subtasks: [],
            artifacts: [],
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        parallelizable: false,
        order: 1,
      },
    ],
    estimatedComplexity: "moderate",
    requiredAgents: ["orchestrator", "coder"],
    createdAt: new Date(),
    status: "draft",
  };
}

function createMockTools(): CodeBuddyTool[] {
  return [
    { type: "function", function: { name: "view_file", description: "View", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "search", description: "Search", parameters: { type: "object", properties: {}, required: [] } } },
  ];
}

function createMockToolExecutor(): (toolCall: CodeBuddyToolCall) => Promise<ToolResult> {
  return jest.fn().mockResolvedValue({ success: true, output: "Tool executed" });
}

describe("MultiAgentSystem", () => {
  let system: MultiAgentSystem;
  const mockApiKey = "test-api-key";

  beforeEach(() => {
    jest.clearAllMocks();
    resetMultiAgentSystem();
    system = new MultiAgentSystem(mockApiKey);
  });

  afterEach(() => {
    system?.dispose();
  });

  describe("Constructor", () => {
    it("should create a MultiAgentSystem instance", () => {
      expect(system).toBeInstanceOf(MultiAgentSystem);
      expect(system).toBeInstanceOf(EventEmitter);
    });

    it("should accept optional baseURL", () => {
      const systemWithUrl = new MultiAgentSystem(mockApiKey, "https://custom.api.com");
      expect(systemWithUrl).toBeInstanceOf(MultiAgentSystem);
      systemWithUrl.dispose();
    });

    it("should accept optional toolExecutor", () => {
      const executor = createMockToolExecutor();
      const systemWithExecutor = new MultiAgentSystem(mockApiKey, undefined, executor);
      expect(systemWithExecutor).toBeInstanceOf(MultiAgentSystem);
      systemWithExecutor.dispose();
    });

    it("should initialize with all agent types", () => {
      expect(system.getAgent("orchestrator")).toBeDefined();
      expect(system.getAgent("coder")).toBeDefined();
      expect(system.getAgent("reviewer")).toBeDefined();
      expect(system.getAgent("tester")).toBeDefined();
    });
  });

  describe("getAgent", () => {
    it("should return agent by role", () => {
      const orchestrator = system.getAgent("orchestrator");
      expect(orchestrator).toBeDefined();
      expect(orchestrator?.getRole()).toBe("orchestrator");
    });

    it("should return undefined for unknown role", () => {
      const unknown = system.getAgent("researcher" as AgentRole);
      expect(unknown).toBeUndefined();
    });
  });

  describe("setToolExecutor", () => {
    it("should set the tool executor", () => {
      const executor = createMockToolExecutor();
      system.setToolExecutor(executor);
      // No error thrown means success
    });
  });

  describe("initializeTools", () => {
    it("should load tools", async () => {
      await system.initializeTools();
      // Tools should be loaded from mocked getAllCodeBuddyTools
    });
  });

  describe("getSharedContext", () => {
    it("should return shared context", () => {
      const context = system.getSharedContext();
      expect(context).toHaveProperty("goal");
      expect(context).toHaveProperty("relevantFiles");
      expect(context).toHaveProperty("conversationHistory");
      expect(context).toHaveProperty("artifacts");
      expect(context).toHaveProperty("decisions");
      expect(context).toHaveProperty("constraints");
    });

    it("should have empty initial values", () => {
      const context = system.getSharedContext();
      expect(context.goal).toBe("");
      expect(context.relevantFiles).toHaveLength(0);
      expect(context.conversationHistory).toHaveLength(0);
      expect(context.decisions).toHaveLength(0);
      expect(context.constraints).toHaveLength(0);
    });
  });

  describe("getCurrentPlan", () => {
    it("should return null initially", () => {
      expect(system.getCurrentPlan()).toBeNull();
    });
  });

  describe("addDecision", () => {
    it("should add decision to shared context", () => {
      system.addDecision(
        "Use TypeScript",
        "architect",
        "Better type safety",
        ["JavaScript", "Python"]
      );
      const context = system.getSharedContext();
      expect(context.decisions).toHaveLength(1);
      expect(context.decisions[0].description).toBe("Use TypeScript");
      expect(context.decisions[0].madeBy).toBe("architect");
      expect(context.decisions[0].rationale).toBe("Better type safety");
      expect(context.decisions[0].alternatives).toContain("JavaScript");
    });

    it("should add multiple decisions", () => {
      system.addDecision("Decision 1", "orchestrator", "Reason 1");
      system.addDecision("Decision 2", "coder", "Reason 2");
      const context = system.getSharedContext();
      expect(context.decisions).toHaveLength(2);
    });
  });

  describe("setCodebaseInfo", () => {
    it("should set codebase info in shared context", () => {
      const info = {
        rootPath: "/project",
        language: "typescript",
        framework: "express",
        structure: { name: "root", type: "directory" as const, path: "/project" },
        dependencies: ["express", "typescript"],
        entryPoints: ["src/index.ts"],
      };
      system.setCodebaseInfo(info);
      const context = system.getSharedContext();
      expect(context.codebaseInfo).toEqual(info);
    });
  });

  describe("addRelevantFiles", () => {
    it("should add files to context", () => {
      system.addRelevantFiles(["file1.ts", "file2.ts"]);
      const context = system.getSharedContext();
      expect(context.relevantFiles).toContain("file1.ts");
      expect(context.relevantFiles).toContain("file2.ts");
    });

    it("should not add duplicate files", () => {
      system.addRelevantFiles(["file1.ts"]);
      system.addRelevantFiles(["file1.ts", "file2.ts"]);
      const context = system.getSharedContext();
      expect(context.relevantFiles).toHaveLength(2);
    });
  });

  describe("addConstraints", () => {
    it("should add constraints to context", () => {
      system.addConstraints(["No external APIs", "Must use async/await"]);
      const context = system.getSharedContext();
      expect(context.constraints).toContain("No external APIs");
      expect(context.constraints).toContain("Must use async/await");
    });

    it("should not add duplicate constraints", () => {
      system.addConstraints(["Constraint 1"]);
      system.addConstraints(["Constraint 1", "Constraint 2"]);
      const context = system.getSharedContext();
      expect(context.constraints).toHaveLength(2);
    });
  });

  describe("stop", () => {
    it("should emit workflow:stopped event", () => {
      const handler = jest.fn();
      system.on("workflow:stopped", handler);
      system.stop();
      expect(handler).toHaveBeenCalled();
    });

    it("should stop all agents", () => {
      const orchestrator = system.getAgent("orchestrator");
      system.stop();
      expect(orchestrator?.stop).toHaveBeenCalled();
    });
  });

  describe("reset", () => {
    it("should reset shared context", () => {
      system.addDecision("Test", "orchestrator", "Test");
      system.addRelevantFiles(["file.ts"]);
      system.addConstraints(["constraint"]);
      system.reset();
      const context = system.getSharedContext();
      expect(context.goal).toBe("");
      expect(context.relevantFiles).toHaveLength(0);
      expect(context.decisions).toHaveLength(0);
      expect(context.constraints).toHaveLength(0);
    });

    it("should reset current plan", () => {
      system.reset();
      expect(system.getCurrentPlan()).toBeNull();
    });

    it("should reset all agents", () => {
      const orchestrator = system.getAgent("orchestrator");
      system.reset();
      expect(orchestrator?.reset).toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("should reset and remove listeners", () => {
      const handler = jest.fn();
      system.on("test", handler);
      system.dispose();
      system.emit("test");
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("runWorkflow", () => {
    it("should emit workflow:start event", async () => {
      const handler = jest.fn();
      system.on("workflow:start", handler);
      await system.runWorkflow("Test goal");
      expect(handler).toHaveBeenCalled();
    });

    it("should emit workflow:complete event on success", async () => {
      const handler = jest.fn();
      system.on("workflow:complete", handler);
      const result = await system.runWorkflow("Test goal");
      expect(handler).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it("should update shared context goal", async () => {
      await system.runWorkflow("My test goal");
      const context = system.getSharedContext();
      expect(context.goal).toBe("My test goal");
    });

    it("should return workflow result with plan", async () => {
      const result = await system.runWorkflow("Test goal");
      expect(result.plan).toBeDefined();
      expect(result.plan.goal).toBeDefined();
    });

    it("should return workflow result with timeline", async () => {
      const result = await system.runWorkflow("Test goal");
      expect(result.timeline).toBeDefined();
      expect(Array.isArray(result.timeline)).toBe(true);
    });

    it("should return workflow result with duration", async () => {
      const result = await system.runWorkflow("Test goal");
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it("should use default options when none provided", async () => {
      const result = await system.runWorkflow("Test goal");
      expect(result).toBeDefined();
    });

    it("should merge custom options with defaults", async () => {
      const result = await system.runWorkflow("Test goal", {
        strategy: "sequential",
        maxIterations: 3,
      });
      expect(result).toBeDefined();
    });

    it("should handle dryRun option", async () => {
      const result = await system.runWorkflow("Test goal", { dryRun: true });
      expect(result).toBeDefined();
    });
  });

  describe("runWorkflow with different strategies", () => {
    it("should support sequential strategy", async () => {
      const result = await system.runWorkflow("Test goal", { strategy: "sequential" });
      expect(result).toBeDefined();
    });

    it("should support parallel strategy", async () => {
      const result = await system.runWorkflow("Test goal", { strategy: "parallel" });
      expect(result).toBeDefined();
    });

    it("should support hierarchical strategy", async () => {
      const result = await system.runWorkflow("Test goal", { strategy: "hierarchical" });
      expect(result).toBeDefined();
    });

    it("should support peer_review strategy", async () => {
      const result = await system.runWorkflow("Test goal", { strategy: "peer_review" });
      expect(result).toBeDefined();
    });

    it("should support iterative strategy", async () => {
      const result = await system.runWorkflow("Test goal", { strategy: "iterative" });
      expect(result).toBeDefined();
    });
  });

  describe("formatResult", () => {
    it("should format successful result", async () => {
      const result = await system.runWorkflow("Test goal");
      const formatted = system.formatResult(result);
      expect(formatted).toContain("MULTI-AGENT WORKFLOW RESULT");
      expect(formatted).toContain("Status:");
    });

    it("should include plan information", async () => {
      const result = await system.runWorkflow("Test goal");
      const formatted = system.formatResult(result);
      expect(formatted).toContain("Plan:");
    });

    it("should include duration", async () => {
      const result = await system.runWorkflow("Test goal");
      const formatted = system.formatResult(result);
      expect(formatted).toContain("Duration:");
    });
  });

  describe("Event forwarding", () => {
    it("should forward agent:start events", () => {
      const handler = jest.fn();
      system.on("agent:start", handler);
      const orchestrator = system.getAgent("orchestrator") as any;
      orchestrator.emit("agent:start", { taskId: "task-1" });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ role: "orchestrator" }));
    });

    it("should forward agent:complete events", () => {
      const handler = jest.fn();
      system.on("agent:complete", handler);
      const coder = system.getAgent("coder") as any;
      coder.emit("agent:complete", { taskId: "task-1" });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ role: "coder" }));
    });

    it("should forward agent:error events", () => {
      const handler = jest.fn();
      system.on("agent:error", handler);
      const reviewer = system.getAgent("reviewer") as any;
      reviewer.emit("agent:error", { error: "Test error" });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ role: "reviewer" }));
    });

    it("should forward agent:tool events", () => {
      const handler = jest.fn();
      system.on("agent:tool", handler);
      const tester = system.getAgent("tester") as any;
      tester.emit("agent:tool", { tool: "view_file" });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ role: "tester" }));
    });

    it("should forward agent:round events", () => {
      const handler = jest.fn();
      system.on("agent:round", handler);
      const coder = system.getAgent("coder") as any;
      coder.emit("agent:round", { round: 1 });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ role: "coder" }));
    });
  });
});

describe("createMultiAgentSystem", () => {
  afterEach(() => {
    resetMultiAgentSystem();
  });

  it("should create a new instance", () => {
    const system = createMultiAgentSystem("test-key");
    expect(system).toBeInstanceOf(MultiAgentSystem);
    system.dispose();
  });

  it("should accept baseURL parameter", () => {
    const system = createMultiAgentSystem("test-key", "https://api.example.com");
    expect(system).toBeInstanceOf(MultiAgentSystem);
    system.dispose();
  });

  it("should accept toolExecutor parameter", () => {
    const executor = jest.fn();
    const system = createMultiAgentSystem("test-key", undefined, executor);
    expect(system).toBeInstanceOf(MultiAgentSystem);
    system.dispose();
  });
});

describe("getMultiAgentSystem", () => {
  afterEach(() => {
    resetMultiAgentSystem();
  });

  it("should return singleton instance", () => {
    const system1 = getMultiAgentSystem("test-key");
    const system2 = getMultiAgentSystem("test-key");
    expect(system1).toBe(system2);
  });

  it("should create instance on first call", () => {
    const system = getMultiAgentSystem("test-key");
    expect(system).toBeInstanceOf(MultiAgentSystem);
  });
});

describe("resetMultiAgentSystem", () => {
  it("should reset singleton instance", () => {
    const system1 = getMultiAgentSystem("test-key");
    resetMultiAgentSystem();
    const system2 = getMultiAgentSystem("test-key");
    expect(system1).not.toBe(system2);
  });

  it("should not throw when no instance exists", () => {
    expect(() => resetMultiAgentSystem()).not.toThrow();
  });
});
