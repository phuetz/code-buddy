/**
 * Unit tests for BaseAgent class
 */

import { EventEmitter } from "events";
import { BaseAgent, createId } from "../../src/agent/multi-agent/base-agent";
import {
  AgentConfig,
  AgentTask,
  SharedContext,
  TaskArtifact,
  AgentMessage,
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

class TestAgent extends BaseAgent {
  getSpecializedPrompt(): string {
    return "Test agent specialized prompt";
  }
}

function createMockConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    role: "coder",
    name: "Test Agent",
    description: "A test agent",
    systemPrompt: "You are a test agent",
    capabilities: ["code_generation"],
    allowedTools: ["view_file", "search"],
    maxRounds: 10,
    timeout: 60000,
    temperature: 0.7,
    ...overrides,
  };
}

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
    { type: "function", function: { name: "view_file", description: "View", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "search", description: "Search", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "bash", description: "Bash", parameters: { type: "object", properties: {}, required: [] } } },
  ];
}

describe("BaseAgent", () => {
  let agent: TestAgent;
  const mockApiKey = "test-api-key";

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new TestAgent(createMockConfig(), mockApiKey);
  });

  afterEach(() => { agent?.removeAllListeners(); });

  describe("Constructor", () => {
    it("should create agent with provided config values", () => {
      const testAgent = new TestAgent(createMockConfig({ maxRounds: 50 }), mockApiKey);
      expect(testAgent.getConfig().maxRounds).toBe(50);
      testAgent.removeAllListeners();
    });

    it("should use default maxRounds when not provided in config", () => {
      // Create a config without maxRounds property at all
      const configWithoutMaxRounds = {
        role: "coder" as const,
        name: "Test Agent",
        description: "A test agent",
        systemPrompt: "You are a test agent",
        capabilities: ["code_generation" as const],
        allowedTools: ["view_file", "search"],
        timeout: 60000,
        temperature: 0.7,
      };
      const testAgent = new TestAgent(configWithoutMaxRounds as any, mockApiKey);
      expect(testAgent.getConfig().maxRounds).toBe(30);
      testAgent.removeAllListeners();
    });

    it("should be an EventEmitter", () => {
      expect(agent).toBeInstanceOf(EventEmitter);
    });

    it("should accept optional baseURL", () => {
      const agentWithUrl = new TestAgent(createMockConfig(), mockApiKey, "https://custom.api.com");
      expect(agentWithUrl).toBeInstanceOf(BaseAgent);
      agentWithUrl.removeAllListeners();
    });
  });

  describe("getConfig", () => {
    it("should return a copy of the config", () => {
      const c1 = agent.getConfig();
      const c2 = agent.getConfig();
      expect(c1).toEqual(c2);
      expect(c1).not.toBe(c2);
    });

    it("should return config with all expected properties", () => {
      const config = agent.getConfig();
      expect(config.role).toBe("coder");
      expect(config.name).toBe("Test Agent");
      expect(config.description).toBe("A test agent");
      expect(config.capabilities).toContain("code_generation");
    });
  });

  describe("getRole", () => {
    it("should return the agent role", () => {
      expect(agent.getRole()).toBe("coder");
    });
  });

  describe("hasCapability", () => {
    it("should return true for capabilities the agent has", () => {
      expect(agent.hasCapability("code_generation")).toBe(true);
    });

    it("should return false for capabilities the agent lacks", () => {
      expect(agent.hasCapability("code_review")).toBe(false);
    });

    it("should handle multiple capabilities", () => {
      const multiCapAgent = new TestAgent(
        createMockConfig({ capabilities: ["code_generation", "code_review", "testing"] }),
        mockApiKey
      );
      expect(multiCapAgent.hasCapability("code_generation")).toBe(true);
      expect(multiCapAgent.hasCapability("code_review")).toBe(true);
      expect(multiCapAgent.hasCapability("testing")).toBe(true);
      expect(multiCapAgent.hasCapability("debugging")).toBe(false);
      multiCapAgent.removeAllListeners();
    });
  });

  describe("filterTools", () => {
    it("should filter tools based on allowed tools", () => {
      const tools = createMockTools();
      const filtered = (agent as any).filterTools(tools);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((t: any) => t.function.name)).toContain("view_file");
      expect(filtered.map((t: any) => t.function.name)).toContain("search");
    });

    it("should exclude tools not in allowed list", () => {
      const tools = createMockTools();
      const filtered = (agent as any).filterTools(tools);
      expect(filtered.map((t: any) => t.function.name)).not.toContain("bash");
    });

    it("should return all tools when allowedTools is empty", () => {
      const agentNoTools = new TestAgent(createMockConfig({ allowedTools: [] }), mockApiKey);
      const tools = createMockTools();
      const filtered = (agentNoTools as any).filterTools(tools);
      // Empty allowedTools means all tools are allowed
      expect(filtered).toHaveLength(tools.length);
      agentNoTools.removeAllListeners();
    });

    it("should return all tools when allowedTools is undefined", () => {
      const agentNoTools = new TestAgent(createMockConfig({ allowedTools: undefined }), mockApiKey);
      const tools = createMockTools();
      const filtered = (agentNoTools as any).filterTools(tools);
      // Undefined allowedTools means all tools are allowed
      expect(filtered).toHaveLength(tools.length);
      agentNoTools.removeAllListeners();
    });
  });

  describe("execute", () => {
    it("should emit agent:start event", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);
      await agent.execute(createMockTask(), createMockContext(), createMockTools(), jest.fn().mockResolvedValue({ success: true }));
      expect(handler).toHaveBeenCalled();
    });

    it("should emit agent:complete event on success", async () => {
      const handler = jest.fn();
      agent.on("agent:complete", handler);
      await agent.execute(createMockTask(), createMockContext(), createMockTools(), jest.fn().mockResolvedValue({ success: true }));
      expect(handler).toHaveBeenCalled();
    });

    it("should return result with success flag", async () => {
      const result = await agent.execute(createMockTask(), createMockContext(), createMockTools(), jest.fn().mockResolvedValue({ success: true }));
      expect(result).toHaveProperty("success");
    });

    it("should return result with role", async () => {
      const result = await agent.execute(createMockTask(), createMockContext(), createMockTools(), jest.fn().mockResolvedValue({ success: true }));
      expect(result.role).toBe("coder");
    });

    it("should return result with taskId", async () => {
      const task = createMockTask();
      const result = await agent.execute(task, createMockContext(), createMockTools(), jest.fn().mockResolvedValue({ success: true }));
      expect(result.taskId).toBe(task.id);
    });

    it("should track rounds", async () => {
      const result = await agent.execute(createMockTask(), createMockContext(), createMockTools(), jest.fn().mockResolvedValue({ success: true }));
      expect(result.rounds).toBeGreaterThanOrEqual(0);
    });

    it("should track duration", async () => {
      const result = await agent.execute(createMockTask(), createMockContext(), createMockTools(), jest.fn().mockResolvedValue({ success: true }));
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("parseArtifacts", () => {
    it("should parse code artifacts", () => {
      const output = '<artifact type="code" name="test.ts" language="typescript">code</artifact>';
      (agent as any).parseArtifacts(output);
      expect((agent as any).artifacts).toHaveLength(1);
    });

    it("should parse multiple artifacts", () => {
      (agent as any).artifacts = [];
      const output = `
        <artifact type="code" name="file1.ts" language="typescript">code1</artifact>
        <artifact type="document" name="doc.md">documentation</artifact>
      `;
      (agent as any).parseArtifacts(output);
      expect((agent as any).artifacts.length).toBeGreaterThanOrEqual(1);
    });

    it("should extract artifact properties", () => {
      (agent as any).artifacts = [];
      const output = '<artifact type="code" name="example.ts" language="typescript">const x = 1;</artifact>';
      (agent as any).parseArtifacts(output);
      const artifact = (agent as any).artifacts[0];
      expect(artifact.type).toBe("code");
      expect(artifact.name).toBe("example.ts");
      expect(artifact.language).toBe("typescript");
    });
  });

  describe("sendMessage", () => {
    it("should create and emit message", () => {
      const handler = jest.fn();
      agent.on("agent:message", handler);
      const msg = agent.sendMessage("reviewer", "request", "Test");
      expect(msg.to).toBe("reviewer");
      expect(handler).toHaveBeenCalled();
    });

    it("should set from field to agent role", () => {
      const msg = agent.sendMessage("reviewer", "request", "Test");
      expect(msg.from).toBe("coder");
    });

    it("should set message type", () => {
      const msg = agent.sendMessage("reviewer", "feedback", "Test feedback");
      expect(msg.type).toBe("feedback");
    });

    it("should set message content", () => {
      const msg = agent.sendMessage("reviewer", "request", "Test content");
      expect(msg.content).toBe("Test content");
    });

    it("should generate unique message IDs", () => {
      const msg1 = agent.sendMessage("reviewer", "request", "Test 1");
      const msg2 = agent.sendMessage("reviewer", "request", "Test 2");
      expect(msg1.id).not.toBe(msg2.id);
    });

    it("should set timestamp", () => {
      const msg = agent.sendMessage("reviewer", "request", "Test");
      expect(msg.timestamp).toBeInstanceOf(Date);
    });
  });

  describe("receiveMessage", () => {
    it("should add message to internal messages", () => {
      const initialLength = (agent as any).messages.length;
      const message: AgentMessage = {
        id: "msg-123",
        from: "reviewer",
        to: "coder",
        type: "feedback",
        content: "Good work",
        timestamp: new Date(),
      };
      agent.receiveMessage(message);
      // Message should be added to messages array
      expect((agent as any).messages.length).toBe(initialLength + 1);
    });

    it("should format received message with sender info", () => {
      const message: AgentMessage = {
        id: "msg-123",
        from: "reviewer",
        to: "coder",
        type: "feedback",
        content: "Good work",
        timestamp: new Date(),
      };
      agent.receiveMessage(message);
      const lastMessage = (agent as any).messages[(agent as any).messages.length - 1];
      expect(lastMessage.content).toContain("reviewer");
      expect(lastMessage.content).toContain("Good work");
    });
  });

  describe("stop", () => {
    it("should stop the agent", () => {
      const handler = jest.fn();
      agent.on("agent:stop", handler);
      agent.stop();
      expect(handler).toHaveBeenCalled();
    });

    it("should set isRunning to false", () => {
      (agent as any).isRunning = true;
      agent.stop();
      expect((agent as any).isRunning).toBe(false);
    });
  });

  describe("reset", () => {
    it("should reset state", () => {
      (agent as any).artifacts = [{ id: "1" }];
      agent.reset();
      expect((agent as any).artifacts).toHaveLength(0);
    });

    it("should reset messages to initial system prompt only", () => {
      const message: AgentMessage = {
        id: "msg-123",
        from: "reviewer",
        to: "coder",
        type: "feedback",
        content: "Test",
        timestamp: new Date(),
      };
      agent.receiveMessage(message);
      agent.reset();
      // After reset, messages should contain only the system prompt
      expect((agent as any).messages.length).toBe(1);
      expect((agent as any).messages[0].role).toBe("system");
    });

    it("should clear toolsUsed", () => {
      (agent as any).toolsUsed = ["view_file", "search"];
      agent.reset();
      expect((agent as any).toolsUsed).toHaveLength(0);
    });

    it("should reset rounds", () => {
      (agent as any).rounds = 5;
      agent.reset();
      expect((agent as any).rounds).toBe(0);
    });

    it("should clear currentTask", () => {
      (agent as any).currentTask = { id: "task-1" };
      agent.reset();
      expect((agent as any).currentTask).toBeNull();
    });
  });

  describe("getSpecializedPrompt", () => {
    it("should return specialized prompt", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toBe("Test agent specialized prompt");
    });
  });
});

describe("createId", () => {
  it("should create unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) ids.add(createId("test"));
    expect(ids.size).toBe(10);
  });

  it("should include prefix", () => {
    const id = createId("agent");
    expect(id.startsWith("agent-")).toBe(true);
  });

  it("should handle different prefixes", () => {
    const taskId = createId("task");
    const messageId = createId("message");
    expect(taskId.startsWith("task-")).toBe(true);
    expect(messageId.startsWith("message-")).toBe(true);
  });
});
