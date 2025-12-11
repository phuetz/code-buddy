/**
 * Tests for MessageProcessor module
 */

import {
  MessageProcessor,
  sanitizeLLMOutput,
  extractCommentaryToolCalls,
  ChatEntry,
  Message,
} from "../../src/agent/message-processor";

describe("MessageProcessor", () => {
  let processor: MessageProcessor;

  beforeEach(() => {
    processor = new MessageProcessor("You are a helpful assistant.");
  });

  describe("Constructor", () => {
    it("should initialize with system prompt", () => {
      const messages = processor.getMessages();
      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toBe("You are a helpful assistant.");
    });

    it("should initialize without system prompt", () => {
      const noSystemProcessor = new MessageProcessor();
      const messages = noSystemProcessor.getMessages();
      expect(messages.length).toBe(0);
    });
  });

  describe("User Messages", () => {
    it("should add user message", () => {
      processor.addUserMessage("Hello, world!");

      const messages = processor.getMessages();
      const history = processor.getChatHistory();

      expect(messages.length).toBe(2);
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toBe("Hello, world!");

      expect(history.length).toBe(1);
      expect(history[0].type).toBe("user");
    });

    it("should emit message:added event for user messages", () => {
      const handler = jest.fn();
      processor.on("message:added", handler);

      processor.addUserMessage("Test");

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0].type).toBe("user");
    });
  });

  describe("Assistant Messages", () => {
    it("should add assistant message", () => {
      processor.addAssistantMessage("Hello! How can I help?");

      const messages = processor.getMessages();
      expect(messages[1].role).toBe("assistant");
      expect(messages[1].content).toBe("Hello! How can I help?");
    });

    it("should add assistant message with tool calls", () => {
      const toolCalls = [
        {
          id: "call_1",
          type: "function" as const,
          function: {
            name: "view_file",
            arguments: JSON.stringify({ path: "/test/file.ts" }),
          },
        },
      ];

      processor.addAssistantMessage("Let me check that file.", toolCalls);

      const messages = processor.getMessages();
      expect(messages[1].tool_calls).toHaveLength(1);
      expect(messages[1].tool_calls![0].function.name).toBe("view_file");
    });
  });

  describe("Tool Results", () => {
    it("should add tool result", () => {
      const toolCall = {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "view_file",
          arguments: JSON.stringify({ path: "/test/file.ts" }),
        },
      };

      processor.addToolResult(toolCall, { success: true, output: "file content" });

      const messages = processor.getMessages();
      expect(messages[1].role).toBe("tool");
      expect(messages[1].content).toBe("file content");
      expect(messages[1].tool_call_id).toBe("call_1");
    });

    it("should add failed tool result", () => {
      const toolCall = {
        id: "call_2",
        type: "function" as const,
        function: {
          name: "view_file",
          arguments: JSON.stringify({ path: "/nonexistent" }),
        },
      };

      processor.addToolResult(toolCall, { success: false, error: "File not found" });

      const messages = processor.getMessages();
      expect(messages[1].content).toBe("File not found");
    });

    it("should emit tool_result:added event", () => {
      const handler = jest.fn();
      processor.on("tool_result:added", handler);

      const toolCall = {
        id: "call_3",
        type: "function" as const,
        function: { name: "test", arguments: "{}" },
      };

      processor.addToolResult(toolCall, { success: true });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("System Messages", () => {
    it("should get system message", () => {
      const systemMessage = processor.getSystemMessage();
      expect(systemMessage?.role).toBe("system");
      expect(systemMessage?.content).toBe("You are a helpful assistant.");
    });

    it("should update system message", () => {
      processor.updateSystemMessage("New system prompt");
      expect(processor.getSystemMessage()?.content).toBe("New system prompt");
    });

    it("should add system message if none exists", () => {
      const noSystemProcessor = new MessageProcessor();
      noSystemProcessor.updateSystemMessage("Added system prompt");
      expect(noSystemProcessor.getSystemMessage()?.content).toBe("Added system prompt");
    });

    it("should emit system:updated event", () => {
      const handler = jest.fn();
      processor.on("system:updated", handler);
      processor.updateSystemMessage("Updated");
      expect(handler).toHaveBeenCalledWith("Updated");
    });
  });

  describe("History Management", () => {
    it("should clear history keeping system message", () => {
      processor.addUserMessage("Test 1");
      processor.addAssistantMessage("Response 1");
      processor.addUserMessage("Test 2");

      processor.clear();

      const messages = processor.getMessages();
      const history = processor.getChatHistory();

      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe("system");
      expect(history.length).toBe(0);
    });

    it("should emit cleared event", () => {
      const handler = jest.fn();
      processor.on("cleared", handler);
      processor.clear();
      expect(handler).toHaveBeenCalled();
    });

    it("should trim history when exceeds max size", () => {
      for (let i = 0; i < 20; i++) {
        processor.addUserMessage(`Message ${i}`);
      }

      processor.trimHistory(10);

      const history = processor.getChatHistory();
      expect(history.length).toBe(10);
    });

    it("should emit trimmed event", () => {
      const handler = jest.fn();
      processor.on("trimmed", handler);

      for (let i = 0; i < 20; i++) {
        processor.addUserMessage(`Message ${i}`);
      }

      processor.trimHistory(10);
      expect(handler).toHaveBeenCalled();
    });

    it("should get message count", () => {
      processor.addUserMessage("Test");
      expect(processor.getMessageCount()).toBe(2); // system + user
    });

    it("should get recent messages", () => {
      processor.addUserMessage("First");
      processor.addUserMessage("Second");
      processor.addUserMessage("Third");

      const recent = processor.getRecentMessages(2);
      expect(recent.length).toBe(2);
      expect(recent[0].content).toBe("Second");
      expect(recent[1].content).toBe("Third");
    });
  });

  describe("Error Entry", () => {
    it("should create error entry", () => {
      const entry = processor.createErrorEntry("Something went wrong");
      expect(entry.type).toBe("assistant");
      expect(entry.content).toContain("Sorry, I encountered an error");
      expect(entry.content).toContain("Something went wrong");
    });
  });

  describe("Export/Import", () => {
    it("should export history to JSON", () => {
      processor.addUserMessage("Test message");
      const json = processor.exportHistory();
      const parsed = JSON.parse(json);

      expect(parsed.length).toBe(1);
      expect(parsed[0].content).toBe("Test message");
    });

    it("should import history from JSON", () => {
      const history: ChatEntry[] = [
        { type: "user", content: "Imported message", timestamp: new Date() },
      ];

      processor.importHistory(JSON.stringify(history));
      const imported = processor.getChatHistory();

      expect(imported.length).toBe(1);
      expect(imported[0].content).toBe("Imported message");
    });

    it("should emit history:imported event", () => {
      const handler = jest.fn();
      processor.on("history:imported", handler);

      const history: ChatEntry[] = [
        { type: "user", content: "Test", timestamp: new Date() },
      ];

      processor.importHistory(JSON.stringify(history));
      expect(handler).toHaveBeenCalledWith(1);
    });

    it("should throw on invalid JSON import", () => {
      expect(() => processor.importHistory("invalid json")).toThrow("Invalid history JSON");
    });
  });
});

describe("sanitizeLLMOutput", () => {
  it("should remove control tokens", () => {
    const input = "Hello <|channel|> world <|message|>";
    const output = sanitizeLLMOutput(input);
    expect(output).toBe("Hello  world ");
  });

  it("should remove instruction tags", () => {
    const input = "Before [INST]instruction[/INST] After";
    const output = sanitizeLLMOutput(input);
    expect(output).toBe("Before  After");
  });

  it("should pass through clean content", () => {
    const input = "Normal message content";
    const output = sanitizeLLMOutput(input);
    expect(output).toBe("Normal message content");
  });
});

describe("extractCommentaryToolCalls", () => {
  it("should extract commentary-style tool calls", () => {
    const content = 'commentary to=web_search {"query":"typescript tutorial"}';
    const result = extractCommentaryToolCalls(content);

    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0].name).toBe("web_search");
    expect(result.toolCalls[0].arguments).toEqual({ query: "typescript tutorial" });
  });

  it("should extract function-style tool calls", () => {
    const content = 'Let me search: web_search({"query":"test"})';
    const result = extractCommentaryToolCalls(content);

    expect(result.toolCalls.length).toBe(1);
    expect(result.toolCalls[0].name).toBe("web_search");
  });

  it("should ignore console.log calls", () => {
    const content = 'console({"test": true})';
    const result = extractCommentaryToolCalls(content);

    expect(result.toolCalls.length).toBe(0);
  });

  it("should handle invalid JSON gracefully", () => {
    const content = "commentary to=test {invalid json}";
    const result = extractCommentaryToolCalls(content);

    expect(result.toolCalls.length).toBe(0);
  });

  it("should return remaining content after extraction", () => {
    const content = 'Some text commentary to=web_search {"query":"test"} more text';
    const result = extractCommentaryToolCalls(content);

    expect(result.remainingContent).not.toContain('commentary to=web_search');
    expect(result.remainingContent).toContain("Some text");
    expect(result.remainingContent).toContain("more text");
  });

  it("should extract multiple tool calls", () => {
    const content = 'commentary to=search {"query":"a"} commentary to=web_search {"query":"b"}';
    const result = extractCommentaryToolCalls(content);

    expect(result.toolCalls.length).toBe(2);
  });
});
