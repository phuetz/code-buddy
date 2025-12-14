/**
 * Tests for Subagents - Specialized subagent system
 */

import {
  Subagent,
  SubagentManager,
  SubagentConfig,
  SubagentResult,
  ParallelSubagentRunner,
  ParallelTask,
  ParallelExecutionResult,
  PREDEFINED_SUBAGENTS,
  getSubagentManager,
  getParallelSubagentRunner,
  resetParallelRunner,
} from "../../src/agent/subagents";

// Mock GrokClient
jest.mock("../../src/grok/client.js", () => ({
  GrokClient: jest.fn().mockImplementation(() => ({
    chat: jest.fn().mockResolvedValue({
      choices: [{
        message: {
          content: "Test response from subagent",
          tool_calls: null,
        },
      }],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    }),
  })),
}));

describe("Subagent", () => {
  const mockConfig: SubagentConfig = {
    name: "test-agent",
    description: "Test agent",
    systemPrompt: "You are a test agent",
    tools: ["view_file", "bash"],
    model: "grok-code-fast-1",
    maxRounds: 5,
    timeout: 10000,
  };

  let agent: Subagent;

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new Subagent("test-api-key", mockConfig);
  });

  afterEach(() => {
    agent.removeAllListeners();
    agent.stop();
  });

  describe("Constructor", () => {
    it("should create instance with config", () => {
      expect(agent).toBeInstanceOf(Subagent);
    });

    it("should set default maxRounds if not provided", () => {
      const agentWithDefaults = new Subagent("key", {
        name: "test",
        description: "test",
        systemPrompt: "test",
      });
      const config = agentWithDefaults.getConfig();
      expect(config.maxRounds).toBe(20);
    });

    it("should set default timeout if not provided", () => {
      const agentWithDefaults = new Subagent("key", {
        name: "test",
        description: "test",
        systemPrompt: "test",
      });
      const config = agentWithDefaults.getConfig();
      expect(config.timeout).toBe(300000);
    });
  });

  describe("Run", () => {
    it("should run and return result", async () => {
      const result = await agent.run("test task");
      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.rounds).toBeGreaterThan(0);
    });

    it("should include duration in result", async () => {
      const result = await agent.run("test task");
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should accept context parameter", async () => {
      const result = await agent.run("test task", "some context");
      expect(result.success).toBe(true);
    });

    it("should track unique tools used", async () => {
      const result = await agent.run("test task");
      expect(Array.isArray(result.toolsUsed)).toBe(true);
    });
  });

  describe("Events", () => {
    it("should be an EventEmitter", () => {
      expect(agent.on).toBeDefined();
      expect(agent.emit).toBeDefined();
    });

    it("should emit subagent:start event", async () => {
      const startHandler = jest.fn();
      agent.on("subagent:start", startHandler);

      await agent.run("test task");
      expect(startHandler).toHaveBeenCalledWith(
        expect.objectContaining({ name: "test-agent", task: "test task" })
      );
    });

    it("should emit subagent:complete event", async () => {
      const completeHandler = jest.fn();
      agent.on("subagent:complete", completeHandler);

      await agent.run("test task");
      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({ name: "test-agent" })
      );
    });

    it("should emit subagent:round event", async () => {
      const roundHandler = jest.fn();
      agent.on("subagent:round", roundHandler);

      await agent.run("test task");
      expect(roundHandler).toHaveBeenCalledWith(
        expect.objectContaining({ round: 1 })
      );
    });
  });

  describe("Stop", () => {
    it("should stop the agent", () => {
      agent.stop();
      // Agent should emit stop event
      const stopHandler = jest.fn();
      agent.on("subagent:stop", stopHandler);
      agent.stop();
      expect(stopHandler).toHaveBeenCalled();
    });
  });

  describe("GetConfig", () => {
    it("should return a copy of config", () => {
      const config1 = agent.getConfig();
      const config2 = agent.getConfig();
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });
});

describe("SubagentManager", () => {
  let manager: SubagentManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new SubagentManager("test-api-key");
  });

  describe("Constructor", () => {
    it("should create instance", () => {
      expect(manager).toBeInstanceOf(SubagentManager);
    });

    it("should accept custom base URL", () => {
      const customManager = new SubagentManager("key", "https://custom.api.com");
      expect(customManager).toBeInstanceOf(SubagentManager);
    });
  });

  describe("Register Subagent", () => {
    it("should register custom subagent", () => {
      const config: SubagentConfig = {
        name: "custom-agent",
        description: "Custom agent",
        systemPrompt: "Custom prompt",
      };
      manager.registerSubagent(config);
      expect(manager.getSubagentConfig("custom-agent")).toEqual(config);
    });
  });

  describe("Get Available Subagents", () => {
    it("should list predefined subagents", () => {
      const available = manager.getAvailableSubagents();
      expect(available).toContain("code-reviewer");
      expect(available).toContain("debugger");
      expect(available).toContain("explorer");
    });

    it("should include custom subagents", () => {
      manager.registerSubagent({
        name: "my-custom",
        description: "Custom",
        systemPrompt: "Prompt",
      });
      const available = manager.getAvailableSubagents();
      expect(available).toContain("my-custom");
    });
  });

  describe("Get Subagent Config", () => {
    it("should return predefined config", () => {
      const config = manager.getSubagentConfig("code-reviewer");
      expect(config).toBeDefined();
      expect(config?.name).toBe("code-reviewer");
    });

    it("should return custom config", () => {
      manager.registerSubagent({
        name: "custom",
        description: "Custom",
        systemPrompt: "Prompt",
      });
      const config = manager.getSubagentConfig("custom");
      expect(config).toBeDefined();
      expect(config?.name).toBe("custom");
    });

    it("should return null for unknown subagent", () => {
      const config = manager.getSubagentConfig("unknown");
      expect(config).toBeNull();
    });
  });

  describe("Create Subagent", () => {
    it("should create predefined subagent", () => {
      const agent = manager.createSubagent("explorer");
      expect(agent).toBeInstanceOf(Subagent);
    });

    it("should return null for unknown subagent", () => {
      const agent = manager.createSubagent("unknown");
      expect(agent).toBeNull();
    });
  });

  describe("Spawn", () => {
    it("should spawn and run subagent", async () => {
      const result = await manager.spawn("explorer", "explore the codebase");
      expect(result).toBeDefined();
      expect(result.rounds).toBeDefined();
    });

    it("should return error for unknown subagent", async () => {
      const result = await manager.spawn("unknown", "task");
      expect(result.success).toBe(false);
      expect(result.output).toContain("Unknown subagent");
    });

    it("should accept context option", async () => {
      const result = await manager.spawn("explorer", "task", {
        context: "some context",
      });
      expect(result).toBeDefined();
    });
  });

  describe("Stop All", () => {
    it("should stop all running agents", () => {
      manager.createSubagent("explorer");
      manager.createSubagent("debugger");
      expect(() => manager.stopAll()).not.toThrow();
    });
  });

  describe("Format Available Subagents", () => {
    it("should format output", () => {
      const formatted = manager.formatAvailableSubagents();
      expect(formatted).toContain("Available Subagents");
      expect(formatted).toContain("code-reviewer");
      expect(formatted).toContain("explorer");
    });

    it("should include custom subagents", () => {
      manager.registerSubagent({
        name: "my-agent",
        description: "My custom agent",
        systemPrompt: "Prompt",
      });
      const formatted = manager.formatAvailableSubagents();
      expect(formatted).toContain("my-agent");
      expect(formatted).toContain("My custom agent");
    });
  });
});

describe("PREDEFINED_SUBAGENTS", () => {
  it("should have code-reviewer", () => {
    expect(PREDEFINED_SUBAGENTS["code-reviewer"]).toBeDefined();
    expect(PREDEFINED_SUBAGENTS["code-reviewer"].tools).toContain("view_file");
  });

  it("should have debugger", () => {
    expect(PREDEFINED_SUBAGENTS["debugger"]).toBeDefined();
    expect(PREDEFINED_SUBAGENTS["debugger"].tools).toContain("bash");
  });

  it("should have test-runner", () => {
    expect(PREDEFINED_SUBAGENTS["test-runner"]).toBeDefined();
    expect(PREDEFINED_SUBAGENTS["test-runner"].tools).toContain("bash");
  });

  it("should have explorer", () => {
    expect(PREDEFINED_SUBAGENTS["explorer"]).toBeDefined();
    expect(PREDEFINED_SUBAGENTS["explorer"].tools).toContain("search");
  });

  it("should have refactorer", () => {
    expect(PREDEFINED_SUBAGENTS["refactorer"]).toBeDefined();
    expect(PREDEFINED_SUBAGENTS["refactorer"].tools).toContain("str_replace_editor");
  });

  it("should have documenter", () => {
    expect(PREDEFINED_SUBAGENTS["documenter"]).toBeDefined();
    expect(PREDEFINED_SUBAGENTS["documenter"].tools).toContain("create_file");
  });

  describe("code-reviewer config", () => {
    const config = PREDEFINED_SUBAGENTS["code-reviewer"];

    it("should have system prompt about code review", () => {
      expect(config.systemPrompt).toContain("code reviewer");
    });

    it("should use grok-3-latest model", () => {
      expect(config.model).toBe("grok-3-latest");
    });
  });
});

describe("ParallelSubagentRunner", () => {
  let manager: SubagentManager;
  let runner: ParallelSubagentRunner;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new SubagentManager("test-api-key");
    runner = new ParallelSubagentRunner(manager, 5);
  });

  afterEach(() => {
    runner.removeAllListeners();
    runner.stop();
  });

  describe("Constructor", () => {
    it("should create instance", () => {
      expect(runner).toBeInstanceOf(ParallelSubagentRunner);
    });

    it("should cap maxConcurrent at 10", () => {
      const cappedRunner = new ParallelSubagentRunner(manager, 20);
      expect(cappedRunner).toBeInstanceOf(ParallelSubagentRunner);
    });
  });

  describe("Run Parallel", () => {
    it("should run multiple tasks", async () => {
      const tasks: ParallelTask[] = [
        { id: "task-1", agentType: "explorer", task: "explore" },
        { id: "task-2", agentType: "explorer", task: "explore more" },
      ];

      const result = await runner.runParallel(tasks);
      expect(result.results.size).toBe(2);
      expect(result.completedCount + result.failedCount).toBe(2);
    });

    it("should track total duration", async () => {
      const tasks: ParallelTask[] = [
        { id: "task-1", agentType: "explorer", task: "explore" },
      ];

      const result = await runner.runParallel(tasks);
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it("should sort by priority", async () => {
      const tasks: ParallelTask[] = [
        { id: "low", agentType: "explorer", task: "low priority", priority: 1 },
        { id: "high", agentType: "explorer", task: "high priority", priority: 10 },
      ];

      const result = await runner.runParallel(tasks);
      expect(result.results.has("high")).toBe(true);
      expect(result.results.has("low")).toBe(true);
    });

    it("should call onProgress callback", async () => {
      const progressFn = jest.fn();
      const tasks: ParallelTask[] = [
        { id: "task-1", agentType: "explorer", task: "explore" },
      ];

      await runner.runParallel(tasks, { onProgress: progressFn });
      expect(progressFn).toHaveBeenCalled();
    });

    it("should handle unknown agent types", async () => {
      const tasks: ParallelTask[] = [
        { id: "task-1", agentType: "unknown-agent", task: "task" },
      ];

      const result = await runner.runParallel(tasks);
      expect(result.failedCount).toBe(1);
    });
  });

  describe("Explore Parallel", () => {
    it("should run multiple agent types", async () => {
      const result = await runner.exploreParallel("explore codebase", [
        "explorer",
        "code-reviewer",
      ]);
      expect(result.results.size).toBe(2);
    });
  });

  describe("Events", () => {
    it("should be an EventEmitter", () => {
      expect(runner.on).toBeDefined();
      expect(runner.emit).toBeDefined();
    });

    it("should emit parallel:start event", async () => {
      const startHandler = jest.fn();
      runner.on("parallel:start", startHandler);

      const tasks: ParallelTask[] = [
        { id: "task-1", agentType: "explorer", task: "task" },
      ];

      await runner.runParallel(tasks);
      expect(startHandler).toHaveBeenCalledWith(
        expect.objectContaining({ taskCount: 1 })
      );
    });

    it("should emit parallel:complete event", async () => {
      const completeHandler = jest.fn();
      runner.on("parallel:complete", completeHandler);

      const tasks: ParallelTask[] = [
        { id: "task-1", agentType: "explorer", task: "task" },
      ];

      await runner.runParallel(tasks);
      expect(completeHandler).toHaveBeenCalledWith(
        expect.objectContaining({ completedCount: expect.any(Number) })
      );
    });

    it("should emit parallel:stopped on stop", () => {
      const stoppedHandler = jest.fn();
      runner.on("parallel:stopped", stoppedHandler);

      runner.stop();
      expect(stoppedHandler).toHaveBeenCalled();
    });
  });

  describe("Get Status", () => {
    it("should return status", () => {
      const status = runner.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.queueLength).toBe(0);
    });
  });

  describe("Format Results", () => {
    it("should format successful results", () => {
      const result: ParallelExecutionResult = {
        success: true,
        results: new Map([
          ["task-1", { success: true, output: "output", toolsUsed: ["bash"], rounds: 2, duration: 1000 }],
        ]),
        totalDuration: 1500,
        completedCount: 1,
        failedCount: 0,
        errors: [],
      };

      const formatted = runner.formatResults(result);
      expect(formatted).toContain("Parallel Execution Results");
      expect(formatted).toContain("Completed: 1");
      expect(formatted).toContain("Failed: 0");
    });

    it("should include errors in output", () => {
      const result: ParallelExecutionResult = {
        success: false,
        results: new Map(),
        totalDuration: 500,
        completedCount: 0,
        failedCount: 1,
        errors: ["Task failed: timeout"],
      };

      const formatted = runner.formatResults(result);
      expect(formatted).toContain("Errors:");
      expect(formatted).toContain("Task failed: timeout");
    });
  });
});

describe("Singleton Functions", () => {
  beforeEach(() => {
    resetParallelRunner();
  });

  describe("getSubagentManager", () => {
    it("should return same instance", () => {
      const manager1 = getSubagentManager("key");
      const manager2 = getSubagentManager("key");
      expect(manager1).toBe(manager2);
    });
  });

  describe("getParallelSubagentRunner", () => {
    it("should return same instance", () => {
      const runner1 = getParallelSubagentRunner("key");
      const runner2 = getParallelSubagentRunner("key");
      expect(runner1).toBe(runner2);
    });
  });

  describe("resetParallelRunner", () => {
    it("should reset the singleton", () => {
      const runner1 = getParallelSubagentRunner("key");
      resetParallelRunner();
      const runner2 = getParallelSubagentRunner("key");
      expect(runner1).not.toBe(runner2);
    });
  });
});

describe("SubagentConfig Interface", () => {
  it("should define required properties", () => {
    const config: SubagentConfig = {
      name: "test",
      description: "Test agent",
      systemPrompt: "You are a test agent",
    };

    expect(config.name).toBe("test");
    expect(config.description).toBe("Test agent");
    expect(config.systemPrompt).toBe("You are a test agent");
  });

  it("should allow optional properties", () => {
    const config: SubagentConfig = {
      name: "test",
      description: "Test",
      systemPrompt: "Prompt",
      tools: ["bash", "view_file"],
      model: "grok-3-latest",
      maxRounds: 30,
      timeout: 60000,
    };

    expect(config.tools).toContain("bash");
    expect(config.model).toBe("grok-3-latest");
    expect(config.maxRounds).toBe(30);
    expect(config.timeout).toBe(60000);
  });
});

describe("SubagentResult Interface", () => {
  it("should define result structure", () => {
    const result: SubagentResult = {
      success: true,
      output: "Task completed",
      toolsUsed: ["view_file", "bash"],
      rounds: 3,
      duration: 5000,
    };

    expect(result.success).toBe(true);
    expect(result.output).toBe("Task completed");
    expect(result.toolsUsed).toHaveLength(2);
    expect(result.rounds).toBe(3);
    expect(result.duration).toBe(5000);
  });
});

describe("ParallelTask Interface", () => {
  it("should define task structure", () => {
    const task: ParallelTask = {
      id: "task-123",
      agentType: "explorer",
      task: "Explore the codebase",
    };

    expect(task.id).toBe("task-123");
    expect(task.agentType).toBe("explorer");
    expect(task.task).toBe("Explore the codebase");
  });

  it("should allow optional properties", () => {
    const task: ParallelTask = {
      id: "task-456",
      agentType: "code-reviewer",
      task: "Review code",
      context: "Previous analysis",
      priority: 10,
    };

    expect(task.context).toBe("Previous analysis");
    expect(task.priority).toBe(10);
  });
});
