/**
 * Unit tests for OrchestratorAgent class
 */

import { EventEmitter } from "events";
import {
  OrchestratorAgent,
  createOrchestratorAgent,
} from "../../src/agent/multi-agent/agents/orchestrator-agent";
import {
  AgentTask,
  SharedContext,
  ExecutionPlan,
  PlanPhase,
  AgentExecutionResult,
  TaskArtifact,
} from "../../src/agent/multi-agent/types";
import { CodeBuddyTool, CodeBuddyToolCall } from "../../src/codebuddy/client";
import { ToolResult } from "../../src/types/index";

jest.mock("../../src/codebuddy/client.js", () => ({
  CodeBuddyClient: jest.fn().mockImplementation(() => ({
    chat: jest.fn().mockResolvedValue({
      choices: [{ message: { content: "Test response", tool_calls: null } }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
  })),
}));

jest.mock("../../src/types/index.js", () => ({
  getErrorMessage: jest.fn().mockImplementation((err) => err?.message || String(err)),
}));

function createMockContext(): SharedContext {
  return {
    goal: "Test goal",
    relevantFiles: [],
    conversationHistory: [],
    artifacts: new Map(),
    decisions: [],
    constraints: [],
  };
}

function createMockTools(): CodeBuddyTool[] {
  return [
    { type: "function", function: { name: "view_file", description: "View", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "search", description: "Search", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "bash", description: "Bash", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "codebase_map", description: "Map codebase", parameters: { type: "object", properties: {}, required: [] } } },
  ];
}

function createMockToolExecutor(): (toolCall: CodeBuddyToolCall) => Promise<ToolResult> {
  return jest.fn().mockResolvedValue({ success: true, output: "Tool executed" });
}

function createMockTask(): AgentTask {
  return {
    id: "task-123",
    title: "Test Task",
    description: "A test task",
    status: "pending",
    priority: "medium",
    assignedTo: "orchestrator",
    dependencies: [],
    subtasks: [],
    artifacts: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
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
        name: "Phase 1",
        description: "First phase",
        tasks: [
          {
            id: "task-1",
            title: "Task 1",
            description: "First task",
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
          {
            id: "task-2",
            title: "Task 2",
            description: "Second task",
            status: "pending",
            priority: "medium",
            assignedTo: "reviewer",
            dependencies: ["task-1"],
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
      {
        id: "phase-2",
        name: "Phase 2",
        description: "Second phase",
        tasks: [
          {
            id: "task-3",
            title: "Task 3",
            description: "Third task",
            status: "pending",
            priority: "medium",
            assignedTo: "tester",
            dependencies: ["task-2"],
            subtasks: [],
            artifacts: [],
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        parallelizable: true,
        order: 2,
      },
    ],
    estimatedComplexity: "moderate",
    requiredAgents: ["coder", "reviewer", "tester"],
    createdAt: new Date(),
    status: "draft",
  };
}

describe("OrchestratorAgent", () => {
  let agent: OrchestratorAgent;
  const mockApiKey = "test-api-key";

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new OrchestratorAgent(mockApiKey);
  });

  afterEach(() => {
    agent?.removeAllListeners();
  });

  describe("Constructor", () => {
    it("should create an OrchestratorAgent instance", () => {
      expect(agent).toBeInstanceOf(OrchestratorAgent);
      expect(agent).toBeInstanceOf(EventEmitter);
    });

    it("should accept optional baseURL", () => {
      const agentWithUrl = new OrchestratorAgent(mockApiKey, "https://custom.api.com");
      expect(agentWithUrl).toBeInstanceOf(OrchestratorAgent);
      agentWithUrl.removeAllListeners();
    });

    it("should have orchestrator role", () => {
      expect(agent.getRole()).toBe("orchestrator");
    });

    it("should have planning capability", () => {
      expect(agent.hasCapability("planning")).toBe(true);
    });

    it("should have search capability", () => {
      expect(agent.hasCapability("search")).toBe(true);
    });

    it("should have file_operations capability", () => {
      expect(agent.hasCapability("file_operations")).toBe(true);
    });
  });

  describe("getSpecializedPrompt", () => {
    it("should return orchestrator system prompt", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("Orchestrator");
      expect(prompt).toContain("RESPONSIBILITIES");
    });

    it("should mention specialist agents", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("Coder");
      expect(prompt).toContain("Reviewer");
      expect(prompt).toContain("Tester");
    });

    it("should include planning format", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("PLANNING FORMAT");
      expect(prompt).toContain("<plan");
    });
  });

  describe("getExecutionPlan", () => {
    it("should return null initially", () => {
      expect(agent.getExecutionPlan()).toBeNull();
    });
  });

  describe("getNextTasks", () => {
    it("should return tasks with no dependencies", () => {
      const plan = createMockPlan();
      const nextTasks = agent.getNextTasks(plan);
      expect(nextTasks).toHaveLength(1);
      expect(nextTasks[0].id).toBe("task-1");
    });

    it("should return tasks when dependencies are completed", () => {
      const plan = createMockPlan();
      plan.phases[0].tasks[0].status = "completed";
      const nextTasks = agent.getNextTasks(plan);
      expect(nextTasks).toHaveLength(1);
      expect(nextTasks[0].id).toBe("task-2");
    });

    it("should return multiple tasks when all dependencies are met", () => {
      const plan = createMockPlan();
      plan.phases[0].tasks[0].status = "completed";
      plan.phases[0].tasks[1].status = "completed";
      const nextTasks = agent.getNextTasks(plan);
      expect(nextTasks).toHaveLength(1);
      expect(nextTasks[0].id).toBe("task-3");
    });

    it("should return empty array when all tasks are completed", () => {
      const plan = createMockPlan();
      for (const phase of plan.phases) {
        for (const task of phase.tasks) {
          task.status = "completed";
        }
      }
      const nextTasks = agent.getNextTasks(plan);
      expect(nextTasks).toHaveLength(0);
    });

    it("should not return tasks that are in progress", () => {
      const plan = createMockPlan();
      plan.phases[0].tasks[0].status = "in_progress";
      const nextTasks = agent.getNextTasks(plan);
      expect(nextTasks).toHaveLength(0);
    });

    it("should not return tasks that have failed", () => {
      const plan = createMockPlan();
      plan.phases[0].tasks[0].status = "failed";
      const nextTasks = agent.getNextTasks(plan);
      expect(nextTasks).toHaveLength(0);
    });
  });

  describe("updateTaskStatus", () => {
    it("should update task status", () => {
      const plan = createMockPlan();
      agent.updateTaskStatus(plan, "task-1", "in_progress");
      expect(plan.phases[0].tasks[0].status).toBe("in_progress");
    });

    it("should update task updatedAt", () => {
      const plan = createMockPlan();
      const beforeUpdate = plan.phases[0].tasks[0].updatedAt;
      agent.updateTaskStatus(plan, "task-1", "in_progress");
      expect(plan.phases[0].tasks[0].updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
    });

    it("should set completedAt when status is completed", () => {
      const plan = createMockPlan();
      agent.updateTaskStatus(plan, "task-1", "completed");
      expect(plan.phases[0].tasks[0].completedAt).toBeDefined();
    });

    it("should store artifacts when result is provided", () => {
      const plan = createMockPlan();
      const artifact: TaskArtifact = {
        id: "artifact-1",
        type: "code",
        name: "test.ts",
        content: "code content",
        metadata: {},
      };
      const result: AgentExecutionResult = {
        success: true,
        role: "coder",
        taskId: "task-1",
        output: "Done",
        artifacts: [artifact],
        toolsUsed: [],
        rounds: 1,
        duration: 100,
      };
      agent.updateTaskStatus(plan, "task-1", "completed", result);
      expect(plan.phases[0].tasks[0].artifacts).toContain(artifact);
    });

    it("should store error when result has error", () => {
      const plan = createMockPlan();
      const result: AgentExecutionResult = {
        success: false,
        role: "coder",
        taskId: "task-1",
        output: "",
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 100,
        error: "Task failed",
      };
      agent.updateTaskStatus(plan, "task-1", "failed", result);
      expect(plan.phases[0].tasks[0].error).toBe("Task failed");
    });

    it("should handle non-existent task gracefully", () => {
      const plan = createMockPlan();
      // Should not throw
      expect(() => agent.updateTaskStatus(plan, "non-existent", "completed")).not.toThrow();
    });
  });

  describe("isPhaseComplete", () => {
    it("should return true when all tasks are completed", () => {
      const phase: PlanPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: "Test",
        tasks: [
          { ...createMockTask(), id: "task-1", status: "completed" },
          { ...createMockTask(), id: "task-2", status: "completed" },
        ],
        parallelizable: false,
        order: 1,
      };
      expect(agent.isPhaseComplete(phase)).toBe(true);
    });

    it("should return false when some tasks are pending", () => {
      const phase: PlanPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: "Test",
        tasks: [
          { ...createMockTask(), id: "task-1", status: "completed" },
          { ...createMockTask(), id: "task-2", status: "pending" },
        ],
        parallelizable: false,
        order: 1,
      };
      expect(agent.isPhaseComplete(phase)).toBe(false);
    });

    it("should return false when some tasks are in progress", () => {
      const phase: PlanPhase = {
        id: "phase-1",
        name: "Test Phase",
        description: "Test",
        tasks: [
          { ...createMockTask(), id: "task-1", status: "completed" },
          { ...createMockTask(), id: "task-2", status: "in_progress" },
        ],
        parallelizable: false,
        order: 1,
      };
      expect(agent.isPhaseComplete(phase)).toBe(false);
    });

    it("should return true for empty phase", () => {
      const phase: PlanPhase = {
        id: "phase-1",
        name: "Empty Phase",
        description: "Test",
        tasks: [],
        parallelizable: false,
        order: 1,
      };
      expect(agent.isPhaseComplete(phase)).toBe(true);
    });
  });

  describe("isPlanComplete", () => {
    it("should return true when all phases are complete", () => {
      const plan = createMockPlan();
      for (const phase of plan.phases) {
        for (const task of phase.tasks) {
          task.status = "completed";
        }
      }
      expect(agent.isPlanComplete(plan)).toBe(true);
    });

    it("should return false when any phase is incomplete", () => {
      const plan = createMockPlan();
      plan.phases[0].tasks[0].status = "completed";
      // Leave other tasks pending
      expect(agent.isPlanComplete(plan)).toBe(false);
    });

    it("should return true for empty plan", () => {
      const plan: ExecutionPlan = {
        id: "plan-empty",
        goal: "Empty",
        summary: "Empty plan",
        phases: [],
        estimatedComplexity: "simple",
        requiredAgents: [],
        createdAt: new Date(),
        status: "draft",
      };
      expect(agent.isPlanComplete(plan)).toBe(true);
    });
  });

  describe("determineRecoveryStrategy", () => {
    it("should return retry for timeout errors", () => {
      const task = createMockTask();
      const strategy = agent.determineRecoveryStrategy(task, "Operation timeout");
      expect(strategy).toBe("retry");
    });

    it("should return abort for permission errors", () => {
      const task = createMockTask();
      const strategy = agent.determineRecoveryStrategy(task, "permission denied");
      expect(strategy).toBe("abort");
    });

    it("should return abort for access denied errors", () => {
      const task = createMockTask();
      const strategy = agent.determineRecoveryStrategy(task, "access denied");
      expect(strategy).toBe("abort");
    });

    it("should return abort for critical priority tasks", () => {
      const task = { ...createMockTask(), priority: "critical" as const };
      const strategy = agent.determineRecoveryStrategy(task, "Generic error");
      expect(strategy).toBe("abort");
    });

    it("should return skip for low priority tasks", () => {
      const task = { ...createMockTask(), priority: "low" as const };
      const strategy = agent.determineRecoveryStrategy(task, "Generic error");
      expect(strategy).toBe("skip");
    });

    it("should return delegate for medium priority tasks", () => {
      const task = { ...createMockTask(), priority: "medium" as const };
      const strategy = agent.determineRecoveryStrategy(task, "Generic error");
      expect(strategy).toBe("delegate");
    });

    it("should return delegate for high priority tasks (not critical)", () => {
      const task = { ...createMockTask(), priority: "high" as const };
      const strategy = agent.determineRecoveryStrategy(task, "Generic error");
      expect(strategy).toBe("delegate");
    });
  });

  describe("createPlan", () => {
    it("should create an execution plan", async () => {
      const context = createMockContext();
      const tools = createMockTools();
      const executor = createMockToolExecutor();

      const plan = await agent.createPlan("Build a feature", context, tools, executor);

      expect(plan).toBeDefined();
      expect(plan.id).toBeDefined();
      expect(plan.goal).toBeDefined();
      expect(plan.phases).toBeDefined();
      expect(Array.isArray(plan.phases)).toBe(true);
    });

    it("should store plan in agent", async () => {
      const context = createMockContext();
      const tools = createMockTools();
      const executor = createMockToolExecutor();

      await agent.createPlan("Build a feature", context, tools, executor);
      const storedPlan = agent.getExecutionPlan();

      expect(storedPlan).not.toBeNull();
    });

    it("should create default phase when parsing fails", async () => {
      const context = createMockContext();
      const tools = createMockTools();
      const executor = createMockToolExecutor();

      const plan = await agent.createPlan("Simple task", context, tools, executor);

      // Should have at least one phase with default structure
      expect(plan.phases.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("synthesizeResults", () => {
    it("should synthesize results from all agents", async () => {
      const plan = createMockPlan();
      const results = new Map<string, AgentExecutionResult>();
      results.set("task-1", {
        success: true,
        role: "coder",
        taskId: "task-1",
        output: "Code written",
        artifacts: [],
        toolsUsed: ["view_file"],
        rounds: 1,
        duration: 100,
      });
      const context = createMockContext();
      const tools = createMockTools();
      const executor = createMockToolExecutor();

      const summary = await agent.synthesizeResults(plan, results, context, tools, executor);

      expect(summary).toBeDefined();
      expect(typeof summary).toBe("string");
    });
  });

  describe("execute", () => {
    it("should emit agent:start event", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);
      const task = createMockTask();
      const context = createMockContext();
      const tools = createMockTools();
      const executor = createMockToolExecutor();

      await agent.execute(task, context, tools, executor);

      expect(handler).toHaveBeenCalled();
    });

    it("should emit agent:complete event", async () => {
      const handler = jest.fn();
      agent.on("agent:complete", handler);
      const task = createMockTask();
      const context = createMockContext();
      const tools = createMockTools();
      const executor = createMockToolExecutor();

      await agent.execute(task, context, tools, executor);

      expect(handler).toHaveBeenCalled();
    });

    it("should return execution result", async () => {
      const task = createMockTask();
      const context = createMockContext();
      const tools = createMockTools();
      const executor = createMockToolExecutor();

      const result = await agent.execute(task, context, tools, executor);

      expect(result).toBeDefined();
      expect(result.role).toBe("orchestrator");
      expect(result.taskId).toBe(task.id);
    });
  });
});

describe("createOrchestratorAgent", () => {
  it("should create a new OrchestratorAgent instance", () => {
    const agent = createOrchestratorAgent("test-key");
    expect(agent).toBeInstanceOf(OrchestratorAgent);
    agent.removeAllListeners();
  });

  it("should accept baseURL parameter", () => {
    const agent = createOrchestratorAgent("test-key", "https://api.example.com");
    expect(agent).toBeInstanceOf(OrchestratorAgent);
    agent.removeAllListeners();
  });
});
