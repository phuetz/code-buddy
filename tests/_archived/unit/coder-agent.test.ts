/**
 * Unit tests for CoderAgent class
 */

import { EventEmitter } from "events";
import { CoderAgent, createCoderAgent } from "../../src/agent/multi-agent/agents/coder-agent";
import {
  AgentTask,
  SharedContext,
  AgentExecutionResult,
} from "../../src/agent/multi-agent/types";
import { CodeBuddyTool } from "../../src/codebuddy/client";

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

function createMockTask(): AgentTask {
  return {
    id: "task-123",
    title: "Test Task",
    description: "A test task",
    status: "pending",
    priority: "medium",
    assignedTo: "coder",
    dependencies: [],
    subtasks: [],
    artifacts: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockContext(): SharedContext {
  return {
    goal: "Complete the test",
    relevantFiles: [],
    conversationHistory: [],
    artifacts: new Map(),
    decisions: [],
    constraints: [],
  };
}

function createMockTools(): CodeBuddyTool[] {
  return [
    { type: "function", function: { name: "view_file", description: "View file", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "create_file", description: "Create file", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "str_replace_editor", description: "Edit file", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "search", description: "Search", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "bash", description: "Bash", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "multi_edit", description: "Multi edit", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "web_search", description: "Web search (not allowed)", parameters: { type: "object", properties: {}, required: [] } } },
  ];
}

function createMockToolExecutor() {
  return jest.fn().mockResolvedValue({ success: true, output: "Tool executed" });
}

describe("CoderAgent", () => {
  let agent: CoderAgent;
  const mockApiKey = "test-api-key";

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new CoderAgent(mockApiKey);
  });

  afterEach(() => {
    agent?.removeAllListeners();
  });

  describe("Constructor", () => {
    it("should create agent with correct role", () => {
      expect(agent.getRole()).toBe("coder");
    });

    it("should create agent with correct name", () => {
      expect(agent.getConfig().name).toBe("Coder");
    });

    it("should be an EventEmitter", () => {
      expect(agent).toBeInstanceOf(EventEmitter);
    });

    it("should accept optional baseURL", () => {
      const agentWithUrl = new CoderAgent(mockApiKey, "https://custom.api.com");
      expect(agentWithUrl).toBeInstanceOf(CoderAgent);
      expect(agentWithUrl.getRole()).toBe("coder");
      agentWithUrl.removeAllListeners();
    });

    it("should have code_generation capability", () => {
      expect(agent.hasCapability("code_generation")).toBe(true);
    });

    it("should have code_editing capability", () => {
      expect(agent.hasCapability("code_editing")).toBe(true);
    });

    it("should have file_operations capability", () => {
      expect(agent.hasCapability("file_operations")).toBe(true);
    });

    it("should not have code_review capability", () => {
      expect(agent.hasCapability("code_review")).toBe(false);
    });

    it("should have correct allowed tools", () => {
      const config = agent.getConfig();
      expect(config.allowedTools).toContain("view_file");
      expect(config.allowedTools).toContain("create_file");
      expect(config.allowedTools).toContain("str_replace_editor");
      expect(config.allowedTools).toContain("search");
      expect(config.allowedTools).toContain("bash");
      expect(config.allowedTools).toContain("multi_edit");
    });

    it("should have maxRounds set to 40", () => {
      expect(agent.getConfig().maxRounds).toBe(40);
    });

    it("should have temperature set to 0.3", () => {
      expect(agent.getConfig().temperature).toBe(0.3);
    });
  });

  describe("getSpecializedPrompt", () => {
    it("should return the coder system prompt", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("You are the Coder");
      expect(prompt).toContain("expert software developer");
    });

    it("should mention SOLID principles", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("SOLID");
    });

    it("should mention DRY principle", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("DRY");
    });

    it("should mention KISS principle", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("KISS");
    });

    it("should mention artifact format", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("artifact");
    });
  });

  describe("generateCode", () => {
    it("should call execute with enhanced task", async () => {
      const task = createMockTask();
      const context = createMockContext();
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      const result = await agent.generateCode(task, context, tools, executeTool);

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("role", "coder");
      expect(result).toHaveProperty("taskId", task.id);
    });

    it("should emit agent:start event", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.generateCode(createMockTask(), createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalled();
    });

    it("should emit agent:complete event on success", async () => {
      const handler = jest.fn();
      agent.on("agent:complete", handler);

      await agent.generateCode(createMockTask(), createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalled();
    });

    it("should track duration", async () => {
      const result = await agent.generateCode(createMockTask(), createMockContext(), createMockTools(), createMockToolExecutor());

      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("implementFeature", () => {
    it("should create task with feature specification", async () => {
      const specification = "Add a new user authentication feature";
      const context = createMockContext();
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      const result = await agent.implementFeature(specification, context, tools, executeTool);

      expect(result).toHaveProperty("success");
      expect(result.role).toBe("coder");
    });

    it("should set task title to 'Implement Feature'", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.implementFeature("Test spec", createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ title: "Implement Feature" })
        })
      );
    });

    it("should set task priority to high", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.implementFeature("Test spec", createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ priority: "high" })
        })
      );
    });

    it("should set task assignedTo to coder", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.implementFeature("Test spec", createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ assignedTo: "coder" })
        })
      );
    });
  });

  describe("fixBug", () => {
    it("should create task with bug analysis and suggested fix", async () => {
      const bugAnalysis = "Null pointer exception in user service";
      const suggestedFix = "Add null check before accessing user data";
      const context = createMockContext();
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      const result = await agent.fixBug(bugAnalysis, suggestedFix, context, tools, executeTool);

      expect(result).toHaveProperty("success");
      expect(result.role).toBe("coder");
    });

    it("should set task title to 'Fix Bug'", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.fixBug("bug analysis", "suggested fix", createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ title: "Fix Bug" })
        })
      );
    });

    it("should set task metadata type to bug_fix", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.fixBug("bug analysis", "suggested fix", createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ metadata: { type: "bug_fix" } })
        })
      );
    });
  });

  describe("refactorCode", () => {
    it("should create task with feedback and target files", async () => {
      const feedback = "Extract common logic to utility functions";
      const targetFiles = ["src/utils.ts", "src/helpers.ts"];
      const context = createMockContext();
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      const result = await agent.refactorCode(feedback, targetFiles, context, tools, executeTool);

      expect(result).toHaveProperty("success");
      expect(result.role).toBe("coder");
    });

    it("should set task title to 'Refactor Code'", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.refactorCode("feedback", ["file.ts"], createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ title: "Refactor Code" })
        })
      );
    });

    it("should set task priority to medium", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.refactorCode("feedback", ["file.ts"], createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ priority: "medium" })
        })
      );
    });

    it("should set task metadata type to refactoring", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.refactorCode("feedback", ["file.ts"], createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ metadata: { type: "refactoring" } })
        })
      );
    });
  });

  describe("writeTests", () => {
    it("should create task with target code and test framework", async () => {
      const targetCode = "src/services/user-service.ts";
      const testFramework = "jest";
      const context = createMockContext();
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      const result = await agent.writeTests(targetCode, testFramework, context, tools, executeTool);

      expect(result).toHaveProperty("success");
      expect(result.role).toBe("coder");
    });

    it("should set task title to 'Write Tests'", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.writeTests("code", "jest", createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ title: "Write Tests" })
        })
      );
    });

    it("should set task metadata type to test_writing", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.writeTests("code", "jest", createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ metadata: { type: "test_writing" } })
        })
      );
    });
  });

  describe("learnCodeStyle", () => {
    it("should store file path in codeStyle map", async () => {
      const filePath = "src/example.ts";
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      await agent.learnCodeStyle(filePath, tools, executeTool);

      const codeStyle = agent.getCodeStyle();
      expect(codeStyle.get(filePath)).toBe("learned");
    });

    it("should handle multiple file paths", async () => {
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      await agent.learnCodeStyle("file1.ts", tools, executeTool);
      await agent.learnCodeStyle("file2.ts", tools, executeTool);

      const codeStyle = agent.getCodeStyle();
      expect(codeStyle.size).toBe(2);
      expect(codeStyle.get("file1.ts")).toBe("learned");
      expect(codeStyle.get("file2.ts")).toBe("learned");
    });
  });

  describe("getCodeStyle", () => {
    it("should return a copy of the code style map", async () => {
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      await agent.learnCodeStyle("file.ts", tools, executeTool);

      const codeStyle1 = agent.getCodeStyle();
      const codeStyle2 = agent.getCodeStyle();

      expect(codeStyle1).not.toBe(codeStyle2);
      expect(codeStyle1).toEqual(codeStyle2);
    });

    it("should return empty map initially", () => {
      const codeStyle = agent.getCodeStyle();
      expect(codeStyle.size).toBe(0);
    });
  });

  describe("Error Handling", () => {
    it("should handle execution errors gracefully", async () => {
      const errorExecutor = jest.fn().mockRejectedValue(new Error("Tool failed"));

      // Mock the client to return tool calls that will trigger the error executor
      const { CodeBuddyClient } = require("../../src/codebuddy/client.js");
      CodeBuddyClient.mockImplementation(() => ({
        chat: jest.fn()
          .mockResolvedValueOnce({
            choices: [{
              message: {
                content: null,
                tool_calls: [{ id: "1", function: { name: "view_file", arguments: "{}" } }]
              }
            }],
          })
          .mockResolvedValueOnce({
            choices: [{ message: { content: "Done", tool_calls: null } }],
          }),
      }));

      const errorAgent = new CoderAgent(mockApiKey);
      const handler = jest.fn();
      errorAgent.on("agent:error", handler);

      const result = await errorAgent.generateCode(createMockTask(), createMockContext(), createMockTools(), errorExecutor);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Tool failed");
      errorAgent.removeAllListeners();
    });
  });

  describe("Tool Filtering", () => {
    it("should filter tools based on allowed tools", () => {
      const allTools = createMockTools();
      const filteredTools = (agent as any).filterTools(allTools);

      // web_search should be filtered out
      const toolNames = filteredTools.map((t: CodeBuddyTool) => t.function.name);
      expect(toolNames).toContain("view_file");
      expect(toolNames).toContain("create_file");
      expect(toolNames).not.toContain("web_search");
    });
  });

  describe("stop", () => {
    it("should emit agent:stop event", () => {
      const handler = jest.fn();
      agent.on("agent:stop", handler);

      agent.stop();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("reset", () => {
    it("should reset agent state", async () => {
      // First execute something to populate state
      await agent.generateCode(createMockTask(), createMockContext(), createMockTools(), createMockToolExecutor());

      // Reset
      agent.reset();

      // Verify code style is preserved (it's not part of reset)
      // but other state should be cleared
      expect((agent as any).artifacts).toHaveLength(0);
      expect((agent as any).toolsUsed).toHaveLength(0);
      expect((agent as any).rounds).toBe(0);
    });
  });
});

describe("createCoderAgent", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should create a CoderAgent instance", () => {
    const agent = createCoderAgent("test-api-key");
    expect(agent).toBeInstanceOf(CoderAgent);
    agent.removeAllListeners();
  });

  it("should pass apiKey to constructor", () => {
    const agent = createCoderAgent("my-api-key");
    expect(agent.getRole()).toBe("coder");
    agent.removeAllListeners();
  });

  it("should pass baseURL to constructor when provided", () => {
    const agent = createCoderAgent("test-api-key", "https://custom.url.com");
    expect(agent).toBeInstanceOf(CoderAgent);
    agent.removeAllListeners();
  });
});
