/**
 * Tests for ToolExecutor module
 */

import { ToolExecutor, GrokToolCall, ToolMetrics } from "../../src/agent/tool-executor";

// Mock all dependencies
jest.mock("../../src/tools/index.js", () => ({
  TextEditorTool: jest.fn().mockImplementation(() => ({
    view: jest.fn().mockResolvedValue({ success: true, output: "file content" }),
    create: jest.fn().mockResolvedValue({ success: true }),
    strReplace: jest.fn().mockResolvedValue({ success: true }),
  })),
  BashTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, output: "command output" }),
  })),
  SearchTool: jest.fn().mockImplementation(() => ({
    search: jest.fn().mockResolvedValue({ success: true, output: "search results" }),
  })),
  TodoTool: jest.fn().mockImplementation(() => ({
    createTodoList: jest.fn().mockResolvedValue({ success: true }),
    updateTodoList: jest.fn().mockResolvedValue({ success: true }),
  })),
  ImageTool: jest.fn().mockImplementation(() => ({
    processImage: jest.fn().mockResolvedValue({ success: true }),
  })),
  WebSearchTool: jest.fn().mockImplementation(() => ({
    search: jest.fn().mockResolvedValue({ success: true, output: "web results" }),
    fetchPage: jest.fn().mockResolvedValue({ success: true, output: "page content" }),
  })),
  MorphEditorTool: jest.fn().mockImplementation(() => ({
    editFile: jest.fn().mockResolvedValue({ success: true }),
  })),
}));

jest.mock("../../src/checkpoints/checkpoint-manager.js", () => ({
  CheckpointManager: jest.fn().mockImplementation(() => ({
    checkpointBeforeCreate: jest.fn(),
    checkpointBeforeEdit: jest.fn(),
  })),
}));

jest.mock("../../src/grok/tools.js", () => ({
  getMCPManager: jest.fn().mockReturnValue({
    callTool: jest.fn().mockResolvedValue({
      isError: false,
      content: [{ type: "text", text: "MCP result" }],
    }),
  }),
}));

import { TextEditorTool, BashTool, SearchTool, TodoTool, ImageTool, WebSearchTool, MorphEditorTool } from "../../src/tools/index.js";
import { CheckpointManager } from "../../src/checkpoints/checkpoint-manager.js";

describe("ToolExecutor", () => {
  let executor: ToolExecutor;
  let mockTextEditor: jest.Mocked<TextEditorTool>;
  let mockBash: jest.Mocked<BashTool>;
  let mockSearch: jest.Mocked<SearchTool>;
  let mockTodoTool: jest.Mocked<TodoTool>;
  let mockImageTool: jest.Mocked<ImageTool>;
  let mockWebSearch: jest.Mocked<WebSearchTool>;
  let mockCheckpointManager: jest.Mocked<CheckpointManager>;
  let mockMorphEditor: jest.Mocked<MorphEditorTool>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTextEditor = new TextEditorTool() as jest.Mocked<TextEditorTool>;
    mockBash = new BashTool() as jest.Mocked<BashTool>;
    mockSearch = new SearchTool() as jest.Mocked<SearchTool>;
    mockTodoTool = new TodoTool() as jest.Mocked<TodoTool>;
    mockImageTool = new ImageTool() as jest.Mocked<ImageTool>;
    mockWebSearch = new WebSearchTool() as jest.Mocked<WebSearchTool>;
    mockCheckpointManager = new CheckpointManager() as jest.Mocked<CheckpointManager>;
    mockMorphEditor = new MorphEditorTool() as jest.Mocked<MorphEditorTool>;

    executor = new ToolExecutor({
      textEditor: mockTextEditor,
      bash: mockBash,
      search: mockSearch,
      todoTool: mockTodoTool,
      imageTool: mockImageTool,
      webSearch: mockWebSearch,
      checkpointManager: mockCheckpointManager,
      morphEditor: mockMorphEditor,
    });
  });

  describe("Tool Execution", () => {
    it("should execute view_file tool", async () => {
      const toolCall: GrokToolCall = {
        id: "call_1",
        type: "function",
        function: {
          name: "view_file",
          arguments: JSON.stringify({ path: "/test/file.ts" }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(mockTextEditor.view).toHaveBeenCalledWith("/test/file.ts", undefined);
    });

    it("should execute view_file with line range", async () => {
      const toolCall: GrokToolCall = {
        id: "call_2",
        type: "function",
        function: {
          name: "view_file",
          arguments: JSON.stringify({ path: "/test/file.ts", start_line: 10, end_line: 20 }),
        },
      };

      await executor.execute(toolCall);

      expect(mockTextEditor.view).toHaveBeenCalledWith("/test/file.ts", [10, 20]);
    });

    it("should execute create_file tool with checkpoint", async () => {
      const toolCall: GrokToolCall = {
        id: "call_3",
        type: "function",
        function: {
          name: "create_file",
          arguments: JSON.stringify({ path: "/test/new.ts", content: "console.log('hello');" }),
        },
      };

      await executor.execute(toolCall);

      expect(mockCheckpointManager.checkpointBeforeCreate).toHaveBeenCalledWith("/test/new.ts");
      expect(mockTextEditor.create).toHaveBeenCalledWith("/test/new.ts", "console.log('hello');");
    });

    it("should execute str_replace_editor tool with checkpoint", async () => {
      const toolCall: GrokToolCall = {
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
      };

      await executor.execute(toolCall);

      expect(mockCheckpointManager.checkpointBeforeEdit).toHaveBeenCalledWith("/test/file.ts");
      expect(mockTextEditor.strReplace).toHaveBeenCalledWith("/test/file.ts", "old", "new", true);
    });

    it("should execute bash tool", async () => {
      const toolCall: GrokToolCall = {
        id: "call_5",
        type: "function",
        function: {
          name: "bash",
          arguments: JSON.stringify({ command: "ls -la" }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(mockBash.execute).toHaveBeenCalledWith("ls -la");
    });

    it("should execute search tool", async () => {
      const toolCall: GrokToolCall = {
        id: "call_6",
        type: "function",
        function: {
          name: "search",
          arguments: JSON.stringify({ query: "function test", case_sensitive: true }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(mockSearch.search).toHaveBeenCalled();
    });

    it("should execute web_search tool", async () => {
      const toolCall: GrokToolCall = {
        id: "call_7",
        type: "function",
        function: {
          name: "web_search",
          arguments: JSON.stringify({ query: "TypeScript tutorial", max_results: 5 }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(mockWebSearch.search).toHaveBeenCalledWith("TypeScript tutorial", { maxResults: 5 });
    });

    it("should execute web_fetch tool", async () => {
      const toolCall: GrokToolCall = {
        id: "call_8",
        type: "function",
        function: {
          name: "web_fetch",
          arguments: JSON.stringify({ url: "https://example.com" }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(mockWebSearch.fetchPage).toHaveBeenCalledWith("https://example.com");
    });

    it("should handle unknown tool", async () => {
      const toolCall: GrokToolCall = {
        id: "call_9",
        type: "function",
        function: {
          name: "unknown_tool",
          arguments: "{}",
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown tool");
    });

    it("should handle invalid JSON arguments", async () => {
      const toolCall: GrokToolCall = {
        id: "call_10",
        type: "function",
        function: {
          name: "view_file",
          arguments: "invalid json",
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tool execution error");
    });
  });

  describe("Morph Editor", () => {
    it("should execute edit_file with morph editor", async () => {
      const toolCall: GrokToolCall = {
        id: "call_morph",
        type: "function",
        function: {
          name: "edit_file",
          arguments: JSON.stringify({
            target_file: "/test/file.ts",
            instructions: "Add type annotation",
            code_edit: "const x: number = 1;",
          }),
        },
      };

      const result = await executor.execute(toolCall);

      expect(result.success).toBe(true);
      expect(mockMorphEditor.editFile).toHaveBeenCalled();
    });

    it("should fail edit_file without morph editor", async () => {
      const executorNoMorph = new ToolExecutor({
        textEditor: mockTextEditor,
        bash: mockBash,
        search: mockSearch,
        todoTool: mockTodoTool,
        imageTool: mockImageTool,
        webSearch: mockWebSearch,
        checkpointManager: mockCheckpointManager,
        morphEditor: null,
      });

      const toolCall: GrokToolCall = {
        id: "call_morph_fail",
        type: "function",
        function: {
          name: "edit_file",
          arguments: JSON.stringify({
            target_file: "/test/file.ts",
            instructions: "Add type annotation",
            code_edit: "const x: number = 1;",
          }),
        },
      };

      const result = await executorNoMorph.execute(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Morph Fast Apply not available");
    });
  });

  describe("Metrics Tracking", () => {
    it("should track tool request counts", async () => {
      const toolCall: GrokToolCall = {
        id: "call_m1",
        type: "function",
        function: {
          name: "view_file",
          arguments: JSON.stringify({ path: "/test/file.ts" }),
        },
      };

      await executor.execute(toolCall);
      await executor.execute(toolCall);

      const metrics = executor.getMetrics();
      expect(metrics.toolRequestCounts.get("view_file")).toBe(2);
      expect(metrics.totalExecutions).toBe(2);
      expect(metrics.successfulExecutions).toBe(2);
    });

    it("should track failed executions", async () => {
      const toolCall: GrokToolCall = {
        id: "call_fail",
        type: "function",
        function: {
          name: "view_file",
          arguments: "invalid",
        },
      };

      await executor.execute(toolCall);

      const metrics = executor.getMetrics();
      expect(metrics.failedExecutions).toBe(1);
    });

    it("should reset metrics", async () => {
      const toolCall: GrokToolCall = {
        id: "call_reset",
        type: "function",
        function: {
          name: "view_file",
          arguments: JSON.stringify({ path: "/test/file.ts" }),
        },
      };

      await executor.execute(toolCall);
      executor.resetMetrics();

      const metrics = executor.getMetrics();
      expect(metrics.totalExecutions).toBe(0);
      expect(metrics.toolRequestCounts.size).toBe(0);
    });

    it("should format tool request counts", async () => {
      const toolCall: GrokToolCall = {
        id: "call_fmt",
        type: "function",
        function: {
          name: "search",
          arguments: JSON.stringify({ query: "test" }),
        },
      };

      await executor.execute(toolCall);

      const formatted = executor.getToolRequestCountsFormatted();
      expect(formatted["search"]).toBe(1);
    });
  });

  describe("Read-Only Tool Detection", () => {
    it("should identify read-only tools", () => {
      expect(executor.isReadOnlyTool("view_file")).toBe(true);
      expect(executor.isReadOnlyTool("search")).toBe(true);
      expect(executor.isReadOnlyTool("web_search")).toBe(true);
      expect(executor.isReadOnlyTool("web_fetch")).toBe(true);
    });

    it("should identify write tools", () => {
      expect(executor.isReadOnlyTool("create_file")).toBe(false);
      expect(executor.isReadOnlyTool("str_replace_editor")).toBe(false);
      expect(executor.isReadOnlyTool("bash")).toBe(false);
    });
  });

  describe("Parallel Execution", () => {
    it("should execute read-only tools in parallel", async () => {
      const toolCalls: GrokToolCall[] = [
        {
          id: "call_p1",
          type: "function",
          function: {
            name: "view_file",
            arguments: JSON.stringify({ path: "/test/file1.ts" }),
          },
        },
        {
          id: "call_p2",
          type: "function",
          function: {
            name: "search",
            arguments: JSON.stringify({ query: "test" }),
          },
        },
      ];

      const results = await executor.executeParallel(toolCalls);

      expect(results.size).toBe(2);
      expect(results.get("call_p1")?.success).toBe(true);
      expect(results.get("call_p2")?.success).toBe(true);
    });

    it("should execute write tools sequentially", async () => {
      const toolCalls: GrokToolCall[] = [
        {
          id: "call_s1",
          type: "function",
          function: {
            name: "create_file",
            arguments: JSON.stringify({ path: "/test/file1.ts", content: "a" }),
          },
        },
        {
          id: "call_s2",
          type: "function",
          function: {
            name: "str_replace_editor",
            arguments: JSON.stringify({ path: "/test/file1.ts", old_str: "a", new_str: "b" }),
          },
        },
      ];

      const results = await executor.executeParallel(toolCalls);

      expect(results.size).toBe(2);
      // Both should succeed but were executed sequentially
      expect(results.get("call_s1")?.success).toBe(true);
      expect(results.get("call_s2")?.success).toBe(true);
    });
  });

  describe("Getters", () => {
    it("should return bash tool instance", () => {
      expect(executor.getBashTool()).toBe(mockBash);
    });

    it("should return image tool instance", () => {
      expect(executor.getImageTool()).toBe(mockImageTool);
    });

    it("should return checkpoint manager", () => {
      expect(executor.getCheckpointManager()).toBe(mockCheckpointManager);
    });
  });
});
