/**
 * Unit tests for TesterAgent class
 */

import { EventEmitter } from "events";
import {
  TesterAgent,
  TestResult,
  TestFailure,
  createTesterAgent,
} from "../../src/agent/multi-agent/agents/tester-agent";
import {
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

function createMockContext(): SharedContext {
  return {
    goal: "Run tests",
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
    { type: "function", function: { name: "search", description: "Search", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "bash", description: "Bash", parameters: { type: "object", properties: {}, required: [] } } },
    { type: "function", function: { name: "create_file", description: "Create file (not allowed)", parameters: { type: "object", properties: {}, required: [] } } },
  ];
}

function createMockToolExecutor() {
  return jest.fn().mockResolvedValue({ success: true, output: "Tool executed" });
}

describe("TesterAgent", () => {
  let agent: TesterAgent;
  const mockApiKey = "test-api-key";

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new TesterAgent(mockApiKey);
  });

  afterEach(() => {
    agent?.removeAllListeners();
  });

  describe("Constructor", () => {
    it("should create agent with correct role", () => {
      expect(agent.getRole()).toBe("tester");
    });

    it("should create agent with correct name", () => {
      expect(agent.getConfig().name).toBe("Tester");
    });

    it("should be an EventEmitter", () => {
      expect(agent).toBeInstanceOf(EventEmitter);
    });

    it("should accept optional baseURL", () => {
      const agentWithUrl = new TesterAgent(mockApiKey, "https://custom.api.com");
      expect(agentWithUrl).toBeInstanceOf(TesterAgent);
      expect(agentWithUrl.getRole()).toBe("tester");
      agentWithUrl.removeAllListeners();
    });

    it("should have testing capability", () => {
      expect(agent.hasCapability("testing")).toBe(true);
    });

    it("should have search capability", () => {
      expect(agent.hasCapability("search")).toBe(true);
    });

    it("should have file_operations capability", () => {
      expect(agent.hasCapability("file_operations")).toBe(true);
    });

    it("should not have code_generation capability", () => {
      expect(agent.hasCapability("code_generation")).toBe(false);
    });

    it("should have correct allowed tools", () => {
      const config = agent.getConfig();
      expect(config.allowedTools).toContain("view_file");
      expect(config.allowedTools).toContain("search");
      expect(config.allowedTools).toContain("bash");
      expect(config.allowedTools).not.toContain("create_file");
    });

    it("should have maxRounds set to 30", () => {
      expect(agent.getConfig().maxRounds).toBe(30);
    });

    it("should have temperature set to 0.3", () => {
      expect(agent.getConfig().temperature).toBe(0.3);
    });

    it("should use grok-code-fast-1 model", () => {
      expect(agent.getConfig().model).toBe("grok-code-fast-1");
    });
  });

  describe("getSpecializedPrompt", () => {
    it("should return the tester system prompt", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("You are the Tester");
      expect(prompt).toContain("expert in software testing");
    });

    it("should mention Jest", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("Jest");
    });

    it("should mention Vitest", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("Vitest");
    });

    it("should mention pytest", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("pytest");
    });

    it("should mention test-report format", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("<test-report>");
    });

    it("should mention common test commands", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("npm test");
      expect(prompt).toContain("bun test");
    });
  });

  describe("runTests", () => {
    it("should return TestResult with required properties", async () => {
      const context = createMockContext();
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      const result = await agent.runTests(context, tools, executeTool);

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("passed");
      expect(result).toHaveProperty("failed");
      expect(result).toHaveProperty("skipped");
      expect(result).toHaveProperty("failures");
      expect(result).toHaveProperty("coverageGaps");
      expect(result).toHaveProperty("recommendations");
      expect(result).toHaveProperty("duration");
      expect(result).toHaveProperty("output");
    });

    it("should emit agent:start event", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.runTests(createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalled();
    });

    it("should emit agent:complete event on success", async () => {
      const handler = jest.fn();
      agent.on("agent:complete", handler);

      await agent.runTests(createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalled();
    });

    it("should set task title to 'Run Tests'", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.runTests(createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ title: "Run Tests" })
        })
      );
    });
  });

  describe("runSpecificTests", () => {
    it("should return TestResult with required properties", async () => {
      const testFiles = ["tests/unit/example.test.ts"];
      const context = createMockContext();
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      const result = await agent.runSpecificTests(testFiles, context, tools, executeTool);

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("failures");
    });

    it("should set task title to 'Run Specific Tests'", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.runSpecificTests(["test.ts"], createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ title: "Run Specific Tests" })
        })
      );
    });

    it("should include test files in task metadata", async () => {
      const testFiles = ["test1.ts", "test2.ts"];
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.runSpecificTests(testFiles, createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({
            metadata: expect.objectContaining({ testFiles })
          })
        })
      );
    });
  });

  describe("verifyBugFix", () => {
    it("should return TestResult with required properties", async () => {
      const bugDescription = "Login fails with special characters";
      const fixedFiles = ["src/auth.ts"];
      const context = createMockContext();
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      const result = await agent.verifyBugFix(bugDescription, fixedFiles, context, tools, executeTool);

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("failures");
    });

    it("should set task title to 'Verify Bug Fix'", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.verifyBugFix("bug", ["file.ts"], createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ title: "Verify Bug Fix" })
        })
      );
    });

    it("should include bug description and fixed files in metadata", async () => {
      const bugDescription = "test bug";
      const fixedFiles = ["file1.ts", "file2.ts"];
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.verifyBugFix(bugDescription, fixedFiles, createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({
            metadata: expect.objectContaining({ bugDescription, fixedFiles })
          })
        })
      );
    });
  });

  describe("analyzeCoverage", () => {
    it("should return AgentExecutionResult", async () => {
      const context = createMockContext();
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      const result = await agent.analyzeCoverage(context, tools, executeTool);

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("role", "tester");
      expect(result).toHaveProperty("output");
    });

    it("should set task title to 'Analyze Test Coverage'", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.analyzeCoverage(createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ title: "Analyze Test Coverage" })
        })
      );
    });

    it("should set task priority to medium", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.analyzeCoverage(createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ priority: "medium" })
        })
      );
    });
  });

  describe("parseTestResult", () => {
    it("should parse summary block", () => {
      const mockResult: AgentExecutionResult = {
        success: true,
        role: "tester",
        taskId: "task-123",
        output: `
<test-report>
<summary>
Total: 10 tests
Passed: 8
Failed: 2
Skipped: 0
Coverage: 85.5%
</summary>
</test-report>
`,
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 1000,
      };

      const result = (agent as any).parseTestResult(mockResult);

      expect(result.total).toBe(10);
      expect(result.passed).toBe(8);
      expect(result.failed).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.coverage).toBe(85.5);
    });

    it("should parse Jest-style output", () => {
      const mockResult: AgentExecutionResult = {
        success: true,
        role: "tester",
        taskId: "task-123",
        output: "Tests: 3 failed, 10 passed, 13 total",
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 1000,
      };

      const result = (agent as any).parseTestResult(mockResult);

      expect(result.failed).toBe(3);
      expect(result.passed).toBe(10);
      expect(result.total).toBe(13);
    });

    it("should parse Vitest-style output", () => {
      const mockResult: AgentExecutionResult = {
        success: true,
        role: "tester",
        taskId: "task-123",
        output: "8 passed and 2 failed",
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 1000,
      };

      const result = (agent as any).parseTestResult(mockResult);

      expect(result.passed).toBe(8);
      expect(result.failed).toBe(2);
      expect(result.total).toBe(10);
    });

    it("should parse failures block", () => {
      const mockResult: AgentExecutionResult = {
        success: false,
        role: "tester",
        taskId: "task-123",
        output: `
<failures>
- should validate user input: Expected true to be false
  File: tests/user.test.ts:42
  Reason: Assertion failed
  Suggestion: Check the validation logic
</failures>
`,
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 1000,
      };

      const result = (agent as any).parseTestResult(mockResult);

      expect(result.failures.length).toBeGreaterThanOrEqual(1);
    });

    it("should parse coverage-gaps block", () => {
      const mockResult: AgentExecutionResult = {
        success: true,
        role: "tester",
        taskId: "task-123",
        output: `
<coverage-gaps>
- Untested function: validateEmail in utils.ts
- Missing edge case: empty string input
</coverage-gaps>
`,
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 1000,
      };

      const result = (agent as any).parseTestResult(mockResult);

      expect(result.coverageGaps.length).toBeGreaterThanOrEqual(1);
    });

    it("should parse recommendations block", () => {
      const mockResult: AgentExecutionResult = {
        success: true,
        role: "tester",
        taskId: "task-123",
        output: `
<recommendations>
1. Add tests for error handling
2. Improve coverage of edge cases
</recommendations>
`,
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 1000,
      };

      const result = (agent as any).parseTestResult(mockResult);

      expect(result.recommendations.length).toBeGreaterThanOrEqual(1);
    });

    it("should set success based on failed count", () => {
      const mockResult: AgentExecutionResult = {
        success: true,
        role: "tester",
        taskId: "task-123",
        output: `
<summary>
Total: 5 tests
Passed: 5
Failed: 0
</summary>
`,
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 1000,
      };

      const result = (agent as any).parseTestResult(mockResult);

      expect(result.success).toBe(true);
    });

    it("should set success to false when tests fail", () => {
      const mockResult: AgentExecutionResult = {
        success: true,
        role: "tester",
        taskId: "task-123",
        output: `
<summary>
Total: 5 tests
Passed: 3
Failed: 2
</summary>
`,
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 1000,
      };

      const result = (agent as any).parseTestResult(mockResult);

      expect(result.success).toBe(false);
    });

    it("should include duration from result", () => {
      const mockResult: AgentExecutionResult = {
        success: true,
        role: "tester",
        taskId: "task-123",
        output: "All tests passed",
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 5432,
      };

      const result = (agent as any).parseTestResult(mockResult);

      expect(result.duration).toBe(5432);
    });
  });

  describe("formatTestResult", () => {
    it("should format result with header", () => {
      const result: TestResult = {
        success: true,
        total: 10,
        passed: 10,
        failed: 0,
        skipped: 0,
        failures: [],
        coverageGaps: [],
        recommendations: [],
        duration: 1000,
        output: "",
      };

      const formatted = agent.formatTestResult(result);

      expect(formatted).toContain("TEST RESULTS");
    });

    it("should show PASSED status for successful tests", () => {
      const result: TestResult = {
        success: true,
        total: 5,
        passed: 5,
        failed: 0,
        skipped: 0,
        failures: [],
        coverageGaps: [],
        recommendations: [],
        duration: 1000,
        output: "",
      };

      const formatted = agent.formatTestResult(result);

      expect(formatted).toContain("PASSED");
    });

    it("should show FAILED status for failed tests", () => {
      const result: TestResult = {
        success: false,
        total: 5,
        passed: 3,
        failed: 2,
        skipped: 0,
        failures: [],
        coverageGaps: [],
        recommendations: [],
        duration: 1000,
        output: "",
      };

      const formatted = agent.formatTestResult(result);

      expect(formatted).toContain("FAILED");
    });

    it("should format summary section", () => {
      const result: TestResult = {
        success: true,
        total: 10,
        passed: 8,
        failed: 1,
        skipped: 1,
        failures: [],
        coverageGaps: [],
        recommendations: [],
        duration: 2500,
        output: "",
      };

      const formatted = agent.formatTestResult(result);

      expect(formatted).toContain("Total:   10");
      expect(formatted).toContain("Passed:  8");
      expect(formatted).toContain("Failed:  1");
      expect(formatted).toContain("Skipped: 1");
    });

    it("should format coverage when available", () => {
      const result: TestResult = {
        success: true,
        total: 10,
        passed: 10,
        failed: 0,
        skipped: 0,
        coverage: 87.5,
        failures: [],
        coverageGaps: [],
        recommendations: [],
        duration: 1000,
        output: "",
      };

      const formatted = agent.formatTestResult(result);

      expect(formatted).toContain("Coverage: 87.5%");
    });

    it("should format duration in seconds", () => {
      const result: TestResult = {
        success: true,
        total: 10,
        passed: 10,
        failed: 0,
        skipped: 0,
        failures: [],
        coverageGaps: [],
        recommendations: [],
        duration: 2500,
        output: "",
      };

      const formatted = agent.formatTestResult(result);

      expect(formatted).toContain("Duration: 2.50s");
    });

    it("should format failures section", () => {
      const result: TestResult = {
        success: false,
        total: 5,
        passed: 4,
        failed: 1,
        skipped: 0,
        failures: [
          {
            testName: "should validate input",
            file: "tests/input.test.ts",
            error: "Expected true to be false",
            suggestion: "Check validation logic",
          },
        ],
        coverageGaps: [],
        recommendations: [],
        duration: 1000,
        output: "",
      };

      const formatted = agent.formatTestResult(result);

      expect(formatted).toContain("Failures:");
      expect(formatted).toContain("should validate input");
      expect(formatted).toContain("tests/input.test.ts");
      expect(formatted).toContain("Expected true to be false");
      expect(formatted).toContain("Check validation logic");
    });

    it("should format coverage gaps section", () => {
      const result: TestResult = {
        success: true,
        total: 10,
        passed: 10,
        failed: 0,
        skipped: 0,
        failures: [],
        coverageGaps: ["Untested function: parseConfig", "Missing edge case: empty input"],
        recommendations: [],
        duration: 1000,
        output: "",
      };

      const formatted = agent.formatTestResult(result);

      expect(formatted).toContain("Coverage Gaps:");
      expect(formatted).toContain("Untested function: parseConfig");
      expect(formatted).toContain("Missing edge case: empty input");
    });

    it("should format recommendations section", () => {
      const result: TestResult = {
        success: true,
        total: 10,
        passed: 10,
        failed: 0,
        skipped: 0,
        failures: [],
        coverageGaps: [],
        recommendations: ["Add integration tests", "Improve error handling tests"],
        duration: 1000,
        output: "",
      };

      const formatted = agent.formatTestResult(result);

      expect(formatted).toContain("Recommendations:");
      expect(formatted).toContain("1. Add integration tests");
      expect(formatted).toContain("2. Improve error handling tests");
    });
  });

  describe("detectTestFramework", () => {
    it("should return null initially", async () => {
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      const framework = await agent.detectTestFramework(tools, executeTool);

      expect(framework).toBeNull();
    });
  });

  describe("setTestCommand", () => {
    it("should set the test command", () => {
      agent.setTestCommand("npm test");

      expect(agent.getTestCommand()).toBe("npm test");
    });

    it("should update existing test command", () => {
      agent.setTestCommand("npm test");
      agent.setTestCommand("bun test");

      expect(agent.getTestCommand()).toBe("bun test");
    });
  });

  describe("getTestCommand", () => {
    it("should return null initially", () => {
      expect(agent.getTestCommand()).toBeNull();
    });

    it("should return set command", () => {
      agent.setTestCommand("npx vitest");

      expect(agent.getTestCommand()).toBe("npx vitest");
    });
  });

  describe("Error Handling", () => {
    it("should handle execution errors gracefully", async () => {
      const errorExecutor = jest.fn().mockRejectedValue(new Error("Tool failed"));

      const { CodeBuddyClient } = require("../../src/codebuddy/client.js");
      CodeBuddyClient.mockImplementation(() => ({
        chat: jest.fn()
          .mockResolvedValueOnce({
            choices: [{
              message: {
                content: null,
                tool_calls: [{ id: "1", function: { name: "bash", arguments: "{}" } }]
              }
            }],
          })
          .mockResolvedValueOnce({
            choices: [{ message: { content: "Done", tool_calls: null } }],
          }),
      }));

      const errorAgent = new TesterAgent(mockApiKey);
      const handler = jest.fn();
      errorAgent.on("agent:error", handler);

      const result = await errorAgent.runTests(createMockContext(), createMockTools(), errorExecutor);

      // When a tool execution fails, the agent returns an error result
      // The parseTestResult receives a failed execution result, which sets success=false
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("failed");
      expect(result).toHaveProperty("output");
      errorAgent.removeAllListeners();
    });
  });

  describe("Tool Filtering", () => {
    it("should filter tools based on allowed tools", () => {
      const allTools = createMockTools();
      const filteredTools = (agent as any).filterTools(allTools);

      const toolNames = filteredTools.map((t: CodeBuddyTool) => t.function.name);
      expect(toolNames).toContain("view_file");
      expect(toolNames).toContain("search");
      expect(toolNames).toContain("bash");
      expect(toolNames).not.toContain("create_file");
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
      await agent.runTests(createMockContext(), createMockTools(), createMockToolExecutor());

      agent.reset();

      expect((agent as any).artifacts).toHaveLength(0);
      expect((agent as any).toolsUsed).toHaveLength(0);
      expect((agent as any).rounds).toBe(0);
    });

    it("should preserve test command after reset", () => {
      agent.setTestCommand("npm test");
      agent.reset();

      // Test command is not reset as it's specific to TesterAgent
      expect(agent.getTestCommand()).toBe("npm test");
    });
  });
});

describe("createTesterAgent", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should create a TesterAgent instance", () => {
    const agent = createTesterAgent("test-api-key");
    expect(agent).toBeInstanceOf(TesterAgent);
    agent.removeAllListeners();
  });

  it("should pass apiKey to constructor", () => {
    const agent = createTesterAgent("my-api-key");
    expect(agent.getRole()).toBe("tester");
    agent.removeAllListeners();
  });

  it("should pass baseURL to constructor when provided", () => {
    const agent = createTesterAgent("test-api-key", "https://custom.url.com");
    expect(agent).toBeInstanceOf(TesterAgent);
    agent.removeAllListeners();
  });
});
