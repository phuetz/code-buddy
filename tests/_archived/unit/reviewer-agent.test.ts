/**
 * Unit tests for ReviewerAgent class
 */

import { EventEmitter } from "events";
import {
  ReviewerAgent,
  ReviewResult,
  createReviewerAgent,
} from "../../src/agent/multi-agent/agents/reviewer-agent";
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

function createMockContext(): SharedContext {
  return {
    goal: "Review code quality",
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

describe("ReviewerAgent", () => {
  let agent: ReviewerAgent;
  const mockApiKey = "test-api-key";

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new ReviewerAgent(mockApiKey);
  });

  afterEach(() => {
    agent?.removeAllListeners();
  });

  describe("Constructor", () => {
    it("should create agent with correct role", () => {
      expect(agent.getRole()).toBe("reviewer");
    });

    it("should create agent with correct name", () => {
      expect(agent.getConfig().name).toBe("Reviewer");
    });

    it("should be an EventEmitter", () => {
      expect(agent).toBeInstanceOf(EventEmitter);
    });

    it("should accept optional baseURL", () => {
      const agentWithUrl = new ReviewerAgent(mockApiKey, "https://custom.api.com");
      expect(agentWithUrl).toBeInstanceOf(ReviewerAgent);
      expect(agentWithUrl.getRole()).toBe("reviewer");
      agentWithUrl.removeAllListeners();
    });

    it("should have code_review capability", () => {
      expect(agent.hasCapability("code_review")).toBe(true);
    });

    it("should have search capability", () => {
      expect(agent.hasCapability("search")).toBe(true);
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

    it("should have maxRounds set to 25", () => {
      expect(agent.getConfig().maxRounds).toBe(25);
    });

    it("should have temperature set to 0.5", () => {
      expect(agent.getConfig().temperature).toBe(0.5);
    });
  });

  describe("getSpecializedPrompt", () => {
    it("should return the reviewer system prompt", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("You are the Reviewer");
      expect(prompt).toContain("expert code reviewer");
    });

    it("should mention security review", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("Security");
    });

    it("should mention OWASP", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("OWASP");
    });

    it("should mention feedback format", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("<feedback");
    });

    it("should mention severity levels", () => {
      const prompt = agent.getSpecializedPrompt();
      expect(prompt).toContain("critical");
      expect(prompt).toContain("major");
      expect(prompt).toContain("minor");
      expect(prompt).toContain("info");
    });
  });

  describe("reviewCode", () => {
    it("should return ReviewResult with required properties", async () => {
      const files = ["src/test.ts"];
      const context = createMockContext();
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      const result = await agent.reviewCode(files, context, tools, executeTool);

      expect(result).toHaveProperty("approved");
      expect(result).toHaveProperty("feedbackItems");
      expect(result).toHaveProperty("criticalIssues");
      expect(result).toHaveProperty("majorIssues");
      expect(result).toHaveProperty("minorIssues");
      expect(result).toHaveProperty("summary");
    });

    it("should emit agent:start event", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.reviewCode(["file.ts"], createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalled();
    });

    it("should emit agent:complete event on success", async () => {
      const handler = jest.fn();
      agent.on("agent:complete", handler);

      await agent.reviewCode(["file.ts"], createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalled();
    });

    it("should handle multiple files", async () => {
      const files = ["src/a.ts", "src/b.ts", "src/c.ts"];
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.reviewCode(files, createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({
            metadata: expect.objectContaining({ files })
          })
        })
      );
    });
  });

  describe("reviewDiff", () => {
    it("should return ReviewResult with required properties", async () => {
      const diff = `
--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,4 @@
+import { newFeature } from './new';
 export function test() {
   return 'test';
 }
`;
      const context = createMockContext();
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      const result = await agent.reviewDiff(diff, context, tools, executeTool);

      expect(result).toHaveProperty("approved");
      expect(result).toHaveProperty("feedbackItems");
      expect(result).toHaveProperty("summary");
    });

    it("should set task title to 'Review Diff'", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.reviewDiff("some diff", createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ title: "Review Diff" })
        })
      );
    });

    it("should set task metadata type to diff_review", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.reviewDiff("some diff", createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ metadata: { type: "diff_review" } })
        })
      );
    });
  });

  describe("securityReview", () => {
    it("should return ReviewResult with required properties", async () => {
      const files = ["src/auth.ts"];
      const context = createMockContext();
      const tools = createMockTools();
      const executeTool = createMockToolExecutor();

      const result = await agent.securityReview(files, context, tools, executeTool);

      expect(result).toHaveProperty("approved");
      expect(result).toHaveProperty("feedbackItems");
      expect(result).toHaveProperty("summary");
    });

    it("should set task title to 'Security Review'", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.securityReview(["auth.ts"], createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ title: "Security Review" })
        })
      );
    });

    it("should set task priority to critical", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.securityReview(["auth.ts"], createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ priority: "critical" })
        })
      );
    });

    it("should set task metadata type to security_review", async () => {
      const handler = jest.fn();
      agent.on("agent:start", handler);

      await agent.securityReview(["auth.ts"], createMockContext(), createMockTools(), createMockToolExecutor());

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ metadata: { type: "security_review" } })
        })
      );
    });
  });

  describe("parseReviewResult", () => {
    it("should parse feedback blocks from output", () => {
      const mockResult: AgentExecutionResult = {
        success: true,
        role: "reviewer",
        taskId: "task-123",
        output: `
<feedback type="issue" severity="critical">
SQL injection vulnerability on line 42
</feedback>
<feedback type="suggestion" severity="minor">
Consider using const instead of let
</feedback>
`,
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 1000,
      };

      const result = (agent as any).parseReviewResult(mockResult, "task-123");

      expect(result.feedbackItems).toHaveLength(2);
      expect(result.criticalIssues).toBe(1);
      expect(result.minorIssues).toBe(1);
    });

    it("should set approved to true when no critical or major issues", () => {
      const mockResult: AgentExecutionResult = {
        success: true,
        role: "reviewer",
        taskId: "task-123",
        output: `
<feedback type="suggestion" severity="minor">
Minor formatting issue
</feedback>
`,
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 1000,
      };

      const result = (agent as any).parseReviewResult(mockResult, "task-123");

      expect(result.approved).toBe(true);
    });

    it("should set approved to false when critical issues exist", () => {
      const mockResult: AgentExecutionResult = {
        success: true,
        role: "reviewer",
        taskId: "task-123",
        output: `
<feedback type="issue" severity="critical">
Critical security issue
</feedback>
`,
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 1000,
      };

      const result = (agent as any).parseReviewResult(mockResult, "task-123");

      expect(result.approved).toBe(false);
    });

    it("should set approved to false when major issues exist", () => {
      const mockResult: AgentExecutionResult = {
        success: true,
        role: "reviewer",
        taskId: "task-123",
        output: `
<feedback type="issue" severity="major">
Major bug found
</feedback>
`,
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 1000,
      };

      const result = (agent as any).parseReviewResult(mockResult, "task-123");

      expect(result.approved).toBe(false);
    });

    it("should count issues by severity correctly", () => {
      const mockResult: AgentExecutionResult = {
        success: true,
        role: "reviewer",
        taskId: "task-123",
        output: `
<feedback type="issue" severity="critical">Critical 1</feedback>
<feedback type="issue" severity="critical">Critical 2</feedback>
<feedback type="issue" severity="major">Major 1</feedback>
<feedback type="suggestion" severity="minor">Minor 1</feedback>
<feedback type="suggestion" severity="minor">Minor 2</feedback>
<feedback type="suggestion" severity="minor">Minor 3</feedback>
`,
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 1000,
      };

      const result = (agent as any).parseReviewResult(mockResult, "task-123");

      expect(result.criticalIssues).toBe(2);
      expect(result.majorIssues).toBe(1);
      expect(result.minorIssues).toBe(3);
    });

    it("should generate appropriate summary", () => {
      const mockResult: AgentExecutionResult = {
        success: true,
        role: "reviewer",
        taskId: "task-123",
        output: `
<feedback type="suggestion" severity="minor">Minor issue</feedback>
`,
        artifacts: [],
        toolsUsed: [],
        rounds: 1,
        duration: 1000,
      };

      const result = (agent as any).parseReviewResult(mockResult, "task-123");

      expect(result.summary).toContain("approved");
    });
  });

  describe("extractCodeLocations", () => {
    it("should extract file:line patterns", () => {
      const message = "Found issue in test.ts:42";
      const locations = (agent as any).extractCodeLocations(message);

      expect(locations).toContainEqual(
        expect.objectContaining({
          file: "test.ts",
          startLine: 42,
        })
      );
    });

    it("should extract Line N patterns", () => {
      const message = "Problem on Line 123";
      const locations = (agent as any).extractCodeLocations(message);

      expect(locations).toContainEqual(
        expect.objectContaining({
          startLine: 123,
        })
      );
    });

    it("should extract line range patterns", () => {
      // The pattern uses "Line" (singular), not "Lines"
      const message = "Issues on Line 10-20";
      const locations = (agent as any).extractCodeLocations(message);

      expect(locations).toContainEqual(
        expect.objectContaining({
          startLine: 10,
          endLine: 20,
        })
      );
    });

    it("should handle multiple locations in one message", () => {
      const message = "Found issues in file.ts:10 and also in util.ts:42";
      const locations = (agent as any).extractCodeLocations(message);

      expect(locations.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("formatReview", () => {
    it("should format review with header", () => {
      const review: ReviewResult = {
        approved: true,
        feedbackItems: [],
        criticalIssues: 0,
        majorIssues: 0,
        minorIssues: 0,
        summary: "Code approved",
      };

      const formatted = agent.formatReview(review);

      expect(formatted).toContain("CODE REVIEW RESULT");
    });

    it("should format approved review correctly", () => {
      const review: ReviewResult = {
        approved: true,
        feedbackItems: [],
        criticalIssues: 0,
        majorIssues: 0,
        minorIssues: 0,
        summary: "Code approved",
      };

      const formatted = agent.formatReview(review);

      expect(formatted).toContain("Code approved");
    });

    it("should format critical issues section", () => {
      const review: ReviewResult = {
        approved: false,
        feedbackItems: [
          {
            id: "fb-1",
            from: "reviewer",
            to: "coder",
            taskId: "task-1",
            type: "rejection",
            severity: "critical",
            message: "Critical bug found",
            suggestions: [],
          },
        ],
        criticalIssues: 1,
        majorIssues: 0,
        minorIssues: 0,
        summary: "Needs revision",
      };

      const formatted = agent.formatReview(review);

      expect(formatted).toContain("CRITICAL");
      expect(formatted).toContain("Critical bug found");
    });

    it("should format major issues section", () => {
      const review: ReviewResult = {
        approved: false,
        feedbackItems: [
          {
            id: "fb-1",
            from: "reviewer",
            to: "coder",
            taskId: "task-1",
            type: "revision_request",
            severity: "major",
            message: "Major issue found",
            suggestions: [],
          },
        ],
        criticalIssues: 0,
        majorIssues: 1,
        minorIssues: 0,
        summary: "Needs revision",
      };

      const formatted = agent.formatReview(review);

      expect(formatted).toContain("MAJOR");
      expect(formatted).toContain("Major issue found");
    });

    it("should format minor issues section", () => {
      const review: ReviewResult = {
        approved: true,
        feedbackItems: [
          {
            id: "fb-1",
            from: "reviewer",
            to: "coder",
            taskId: "task-1",
            type: "suggestion",
            severity: "minor",
            message: "Minor suggestion",
            suggestions: [],
          },
        ],
        criticalIssues: 0,
        majorIssues: 0,
        minorIssues: 1,
        summary: "Approved with suggestions",
      };

      const formatted = agent.formatReview(review);

      expect(formatted).toContain("MINOR");
      expect(formatted).toContain("Minor suggestion");
    });

    it("should format info section", () => {
      const review: ReviewResult = {
        approved: true,
        feedbackItems: [
          {
            id: "fb-1",
            from: "reviewer",
            to: "coder",
            taskId: "task-1",
            type: "approval",
            severity: "info",
            message: "Good implementation",
            suggestions: [],
          },
        ],
        criticalIssues: 0,
        majorIssues: 0,
        minorIssues: 0,
        summary: "Approved",
      };

      const formatted = agent.formatReview(review);

      expect(formatted).toContain("INFO");
      expect(formatted).toContain("Good implementation");
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
                tool_calls: [{ id: "1", function: { name: "view_file", arguments: "{}" } }]
              }
            }],
          })
          .mockResolvedValueOnce({
            choices: [{ message: { content: "Done", tool_calls: null } }],
          }),
      }));

      const errorAgent = new ReviewerAgent(mockApiKey);
      const handler = jest.fn();
      errorAgent.on("agent:error", handler);

      const result = await errorAgent.reviewCode(["file.ts"], createMockContext(), createMockTools(), errorExecutor);

      expect(result.approved).toBe(true); // Default when no feedback parsed
      expect(result.criticalIssues).toBe(0);
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
      await agent.reviewCode(["file.ts"], createMockContext(), createMockTools(), createMockToolExecutor());

      agent.reset();

      expect((agent as any).artifacts).toHaveLength(0);
      expect((agent as any).toolsUsed).toHaveLength(0);
      expect((agent as any).rounds).toBe(0);
    });
  });
});

describe("createReviewerAgent", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should create a ReviewerAgent instance", () => {
    const agent = createReviewerAgent("test-api-key");
    expect(agent).toBeInstanceOf(ReviewerAgent);
    agent.removeAllListeners();
  });

  it("should pass apiKey to constructor", () => {
    const agent = createReviewerAgent("my-api-key");
    expect(agent.getRole()).toBe("reviewer");
    agent.removeAllListeners();
  });

  it("should pass baseURL to constructor when provided", () => {
    const agent = createReviewerAgent("test-api-key", "https://custom.url.com");
    expect(agent).toBeInstanceOf(ReviewerAgent);
    agent.removeAllListeners();
  });
});
