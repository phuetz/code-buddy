/**
 * Comprehensive Unit Tests for MessageProcessor Module
 *
 * Tests cover:
 * 1. Message parsing
 * 2. Tool call extraction
 * 3. Response formatting
 * 4. Streaming message handling
 * 5. Content sanitization
 * 6. Error handling
 */

import {
  MessageProcessor,
  sanitizeLLMOutput,
  extractCommentaryToolCalls,
  ChatEntry,
  CodeBuddyToolCall,
  ToolResult,
  Message,
  StreamEvent,
  ExtractedToolCalls,
} from "../../src/agent/message-processor";

describe("MessageProcessor", () => {
  let processor: MessageProcessor;

  beforeEach(() => {
    processor = new MessageProcessor("You are a helpful assistant.");
  });

  // ============================================
  // 1. MESSAGE PARSING TESTS
  // ============================================
  describe("Message Parsing", () => {
    describe("Constructor and Initialization", () => {
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

      it("should initialize with empty string system prompt", () => {
        const emptySystemProcessor = new MessageProcessor("");
        const messages = emptySystemProcessor.getMessages();
        // Empty string is falsy, so no system message should be added
        expect(messages.length).toBe(0);
      });

      it("should handle multi-line system prompts", () => {
        const multiLinePrompt = `You are a helpful assistant.
You can help with coding tasks.
Always be polite.`;
        const multiLineProcessor = new MessageProcessor(multiLinePrompt);
        const messages = multiLineProcessor.getMessages();
        expect(messages[0].content).toBe(multiLinePrompt);
      });
    });

    describe("User Message Parsing", () => {
      it("should add user message and update both messages and history", () => {
        processor.addUserMessage("Hello, world!");

        const messages = processor.getMessages();
        const history = processor.getChatHistory();

        expect(messages.length).toBe(2);
        expect(messages[1].role).toBe("user");
        expect(messages[1].content).toBe("Hello, world!");

        expect(history.length).toBe(1);
        expect(history[0].type).toBe("user");
        expect(history[0].content).toBe("Hello, world!");
      });

      it("should parse user message with special characters", () => {
        const specialContent = "Test with <html> & 'quotes' and \"double quotes\"";
        processor.addUserMessage(specialContent);

        const messages = processor.getMessages();
        expect(messages[1].content).toBe(specialContent);
      });

      it("should parse user message with unicode characters", () => {
        const unicodeContent = "Hello in Japanese: \u3053\u3093\u306b\u3061\u306f \u{1F600}";
        processor.addUserMessage(unicodeContent);

        const messages = processor.getMessages();
        expect(messages[1].content).toBe(unicodeContent);
      });

      it("should parse user message with code blocks", () => {
        const codeContent = `Here is some code:
\`\`\`typescript
const x = 1;
function test() {
  return x + 1;
}
\`\`\``;
        processor.addUserMessage(codeContent);

        const messages = processor.getMessages();
        expect(messages[1].content).toBe(codeContent);
      });

      it("should parse empty user message", () => {
        processor.addUserMessage("");

        const messages = processor.getMessages();
        expect(messages[1].content).toBe("");
      });

      it("should add timestamp to user message history entry", () => {
        const before = new Date();
        processor.addUserMessage("Test");
        const after = new Date();

        const history = processor.getChatHistory();
        expect(history[0].timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(history[0].timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
      });
    });

    describe("Assistant Message Parsing", () => {
      it("should add assistant message without tool calls", () => {
        processor.addAssistantMessage("Hello! How can I help?");

        const messages = processor.getMessages();
        expect(messages[1].role).toBe("assistant");
        expect(messages[1].content).toBe("Hello! How can I help?");
        expect(messages[1].tool_calls).toBeUndefined();
      });

      it("should add assistant message with single tool call", () => {
        const toolCalls: CodeBuddyToolCall[] = [
          {
            id: "call_1",
            type: "function",
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
        expect(messages[1].tool_calls![0].id).toBe("call_1");
      });

      it("should add assistant message with multiple tool calls", () => {
        const toolCalls: CodeBuddyToolCall[] = [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "view_file",
              arguments: JSON.stringify({ path: "/test/file1.ts" }),
            },
          },
          {
            id: "call_2",
            type: "function",
            function: {
              name: "list_directory",
              arguments: JSON.stringify({ path: "/test" }),
            },
          },
          {
            id: "call_3",
            type: "function",
            function: {
              name: "grep_search",
              arguments: JSON.stringify({ pattern: "TODO", path: "/src" }),
            },
          },
        ];

        processor.addAssistantMessage("Let me check multiple things.", toolCalls);

        const messages = processor.getMessages();
        expect(messages[1].tool_calls).toHaveLength(3);
        expect(messages[1].tool_calls![0].function.name).toBe("view_file");
        expect(messages[1].tool_calls![1].function.name).toBe("list_directory");
        expect(messages[1].tool_calls![2].function.name).toBe("grep_search");
      });

      it("should store tool calls in chat history entry", () => {
        const toolCalls: CodeBuddyToolCall[] = [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "bash",
              arguments: JSON.stringify({ command: "ls -la" }),
            },
          },
        ];

        processor.addAssistantMessage("Running command...", toolCalls);

        const history = processor.getChatHistory();
        expect(history[0].toolCalls).toHaveLength(1);
        expect(history[0].toolCalls![0].function.name).toBe("bash");
      });

      it("should parse assistant message with null content", () => {
        // Sometimes the API sends null content with tool_calls
        processor.addAssistantMessage("", [
          {
            id: "call_1",
            type: "function",
            function: { name: "test", arguments: "{}" },
          },
        ]);

        const messages = processor.getMessages();
        expect(messages[1].content).toBe("");
        expect(messages[1].tool_calls).toHaveLength(1);
      });
    });

    describe("System Message Parsing", () => {
      it("should add system message to history", () => {
        processor.addSystemMessage("Session context updated");

        const history = processor.getChatHistory();
        expect(history[0].type).toBe("system");
        expect(history[0].content).toBe("Session context updated");
      });

      it("should not add system message to API messages array", () => {
        const initialMessages = processor.getMessages().length;
        processor.addSystemMessage("Internal system note");

        // System messages via addSystemMessage go to history only
        expect(processor.getMessages().length).toBe(initialMessages);
      });

      it("should get existing system message", () => {
        const systemMessage = processor.getSystemMessage();
        expect(systemMessage?.role).toBe("system");
        expect(systemMessage?.content).toBe("You are a helpful assistant.");
      });

      it("should return undefined when no system message exists", () => {
        const noSystemProcessor = new MessageProcessor();
        expect(noSystemProcessor.getSystemMessage()).toBeUndefined();
      });

      it("should update existing system message", () => {
        processor.updateSystemMessage("Updated system prompt");
        expect(processor.getSystemMessage()?.content).toBe("Updated system prompt");
        // Should still have same number of messages
        expect(processor.getMessages().length).toBe(1);
      });

      it("should add system message if none exists on update", () => {
        const noSystemProcessor = new MessageProcessor();
        noSystemProcessor.updateSystemMessage("New system prompt");
        expect(noSystemProcessor.getSystemMessage()?.content).toBe("New system prompt");
        expect(noSystemProcessor.getMessages().length).toBe(1);
      });
    });
  });

  // ============================================
  // 2. TOOL CALL EXTRACTION TESTS
  // ============================================
  describe("Tool Call Extraction", () => {
    describe("extractCommentaryToolCalls", () => {
      describe("Commentary-style extraction", () => {
        it("should extract single commentary-style tool call", () => {
          const content = 'commentary to=web_search {"query":"typescript tutorial"}';
          const result = extractCommentaryToolCalls(content);

          expect(result.toolCalls.length).toBe(1);
          expect(result.toolCalls[0].name).toBe("web_search");
          expect(result.toolCalls[0].arguments).toEqual({ query: "typescript tutorial" });
        });

        it("should extract commentary tool call with complex arguments", () => {
          const content = 'commentary to=edit_file {"path":"/src/test.ts","line":42}';
          const result = extractCommentaryToolCalls(content);

          expect(result.toolCalls.length).toBe(1);
          expect(result.toolCalls[0].name).toBe("edit_file");
          expect(result.toolCalls[0].arguments).toEqual({
            path: "/src/test.ts",
            line: 42,
          });
        });

        it("should extract multiple commentary-style tool calls", () => {
          const content =
            'commentary to=search {"query":"a"} commentary to=web_search {"query":"b"}';
          const result = extractCommentaryToolCalls(content);

          expect(result.toolCalls.length).toBe(2);
          expect(result.toolCalls[0].name).toBe("search");
          expect(result.toolCalls[1].name).toBe("web_search");
        });

        it("should handle whitespace variations in commentary format", () => {
          const content1 = 'commentary to=test {"key":"value"}';
          const content2 = 'commentary  to=test  {"key":"value"}';

          const result1 = extractCommentaryToolCalls(content1);
          const result2 = extractCommentaryToolCalls(content2);

          expect(result1.toolCalls.length).toBe(1);
          expect(result2.toolCalls.length).toBe(1);
        });

        it("should remove extracted tool calls from remaining content", () => {
          const content = 'Some text commentary to=web_search {"query":"test"} more text';
          const result = extractCommentaryToolCalls(content);

          expect(result.remainingContent).not.toContain("commentary to=web_search");
          expect(result.remainingContent).toContain("Some text");
          expect(result.remainingContent).toContain("more text");
        });
      });

      describe("Function-style extraction", () => {
        it("should extract function-style tool call", () => {
          const content = 'Let me search: web_search({"query":"test"})';
          const result = extractCommentaryToolCalls(content);

          expect(result.toolCalls.length).toBe(1);
          expect(result.toolCalls[0].name).toBe("web_search");
          expect(result.toolCalls[0].arguments).toEqual({ query: "test" });
        });

        it("should extract function-style with whitespace", () => {
          const content = 'grep_search( { "pattern": "TODO" } )';
          const result = extractCommentaryToolCalls(content);

          expect(result.toolCalls.length).toBe(1);
          expect(result.toolCalls[0].name).toBe("grep_search");
        });

        it("should extract multiple function-style tool calls", () => {
          const content = 'view_file({"path":"/a.ts"}) and edit_file({"path":"/b.ts"})';
          const result = extractCommentaryToolCalls(content);

          expect(result.toolCalls.length).toBe(2);
        });
      });

      describe("Edge cases and error handling", () => {
        it("should ignore console.log calls", () => {
          const content = 'console({"test": true})';
          const result = extractCommentaryToolCalls(content);

          expect(result.toolCalls.length).toBe(0);
        });

        it("should ignore log function calls", () => {
          const content = 'log({"message": "test"})';
          const result = extractCommentaryToolCalls(content);

          expect(result.toolCalls.length).toBe(0);
        });

        it("should ignore error function calls", () => {
          const content = 'error({"message": "test"})';
          const result = extractCommentaryToolCalls(content);

          expect(result.toolCalls.length).toBe(0);
        });

        it("should ignore warn, info, debug function calls", () => {
          const content =
            'warn({"msg": "a"}) info({"msg": "b"}) debug({"msg": "c"})';
          const result = extractCommentaryToolCalls(content);

          expect(result.toolCalls.length).toBe(0);
        });

        it("should handle invalid JSON in commentary format gracefully", () => {
          const content = "commentary to=test {invalid json}";
          const result = extractCommentaryToolCalls(content);

          expect(result.toolCalls.length).toBe(0);
          expect(result.remainingContent).toBe(content);
        });

        it("should handle invalid JSON in function format gracefully", () => {
          const content = "web_search({not valid json})";
          const result = extractCommentaryToolCalls(content);

          expect(result.toolCalls.length).toBe(0);
        });

        it("should handle empty content", () => {
          const result = extractCommentaryToolCalls("");

          expect(result.toolCalls.length).toBe(0);
          expect(result.remainingContent).toBe("");
        });

        it("should handle content with no tool calls", () => {
          const content = "This is just regular text without any tool calls.";
          const result = extractCommentaryToolCalls(content);

          expect(result.toolCalls.length).toBe(0);
          expect(result.remainingContent).toBe(content);
        });

        it("should handle partial matches that are not valid tool calls", () => {
          const content = "commentary without to= part";
          const result = extractCommentaryToolCalls(content);

          expect(result.toolCalls.length).toBe(0);
        });

        it("should handle nested JSON in arguments", () => {
          const content = 'tool_name({"nested":{"key":"value"}})';
          const result = extractCommentaryToolCalls(content);

          // Note: The current regex only matches simple JSON objects,
          // nested objects may not be fully captured
          expect(result.toolCalls.length).toBe(0); // Due to regex limitation
        });
      });
    });

    describe("Tool Result Handling", () => {
      it("should add successful tool result", () => {
        const toolCall: CodeBuddyToolCall = {
          id: "call_1",
          type: "function",
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

      it("should add failed tool result with error", () => {
        const toolCall: CodeBuddyToolCall = {
          id: "call_2",
          type: "function",
          function: {
            name: "view_file",
            arguments: JSON.stringify({ path: "/nonexistent" }),
          },
        };

        processor.addToolResult(toolCall, {
          success: false,
          error: "File not found",
        });

        const messages = processor.getMessages();
        expect(messages[1].content).toBe("File not found");
      });

      it("should use default success message when output is empty", () => {
        const toolCall: CodeBuddyToolCall = {
          id: "call_3",
          type: "function",
          function: { name: "test", arguments: "{}" },
        };

        processor.addToolResult(toolCall, { success: true });

        const messages = processor.getMessages();
        expect(messages[1].content).toBe("Success");
      });

      it("should use default error message when error is empty", () => {
        const toolCall: CodeBuddyToolCall = {
          id: "call_4",
          type: "function",
          function: { name: "test", arguments: "{}" },
        };

        processor.addToolResult(toolCall, { success: false });

        const messages = processor.getMessages();
        expect(messages[1].content).toBe("Error");
      });

      it("should store tool call and result in history entry", () => {
        const toolCall: CodeBuddyToolCall = {
          id: "call_5",
          type: "function",
          function: { name: "bash", arguments: '{"command":"ls"}' },
        };
        const result: ToolResult = { success: true, output: "file1\nfile2" };

        processor.addToolResult(toolCall, result);

        const history = processor.getChatHistory();
        expect(history[0].type).toBe("tool_result");
        expect(history[0].toolCall).toEqual(toolCall);
        expect(history[0].toolResult).toEqual(result);
      });
    });
  });

  // ============================================
  // 3. RESPONSE FORMATTING TESTS
  // ============================================
  describe("Response Formatting", () => {
    describe("Error Entry Creation", () => {
      it("should create error entry with message", () => {
        const entry = processor.createErrorEntry("Something went wrong");
        expect(entry.type).toBe("assistant");
        expect(entry.content).toContain("Sorry, I encountered an error");
        expect(entry.content).toContain("Something went wrong");
      });

      it("should create error entry with timestamp", () => {
        const before = new Date();
        const entry = processor.createErrorEntry("Test error");
        const after = new Date();

        expect(entry.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(entry.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
      });

      it("should handle empty error message", () => {
        const entry = processor.createErrorEntry("");
        expect(entry.content).toContain("Sorry, I encountered an error");
      });

      it("should handle error message with special characters", () => {
        const entry = processor.createErrorEntry("<script>alert('xss')</script>");
        expect(entry.content).toContain("<script>alert('xss')</script>");
      });
    });

    describe("History Export", () => {
      it("should export history to valid JSON", () => {
        processor.addUserMessage("Test message");
        processor.addAssistantMessage("Response message");

        const json = processor.exportHistory();
        const parsed = JSON.parse(json);

        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBe(2);
      });

      it("should export history with all entry fields", () => {
        processor.addUserMessage("Test");

        const json = processor.exportHistory();
        const parsed = JSON.parse(json);

        expect(parsed[0]).toHaveProperty("type");
        expect(parsed[0]).toHaveProperty("content");
        expect(parsed[0]).toHaveProperty("timestamp");
      });

      it("should export history with tool calls", () => {
        const toolCalls: CodeBuddyToolCall[] = [
          {
            id: "call_1",
            type: "function",
            function: { name: "test", arguments: "{}" },
          },
        ];
        processor.addAssistantMessage("With tools", toolCalls);

        const json = processor.exportHistory();
        const parsed = JSON.parse(json);

        expect(parsed[0].toolCalls).toHaveLength(1);
      });

      it("should export empty history as empty array", () => {
        const json = processor.exportHistory();
        expect(json).toBe("[]");
      });
    });

    describe("History Import", () => {
      it("should import valid history JSON", () => {
        const history: ChatEntry[] = [
          { type: "user", content: "Imported message", timestamp: new Date() },
          { type: "assistant", content: "Response", timestamp: new Date() },
        ];

        processor.importHistory(JSON.stringify(history));
        const imported = processor.getChatHistory();

        expect(imported.length).toBe(2);
        expect(imported[0].content).toBe("Imported message");
        expect(imported[1].content).toBe("Response");
      });

      it("should convert timestamp strings to Date objects", () => {
        const history = [
          {
            type: "user",
            content: "Test",
            timestamp: "2024-01-01T00:00:00.000Z",
          },
        ];

        processor.importHistory(JSON.stringify(history));
        const imported = processor.getChatHistory();

        expect(imported[0].timestamp instanceof Date).toBe(true);
      });

      it("should throw on invalid JSON import", () => {
        expect(() => processor.importHistory("invalid json")).toThrow(
          "Invalid history JSON"
        );
      });

      it("should throw on non-array JSON", () => {
        expect(() => processor.importHistory('{"not": "an array"}')).toThrow();
      });

      it("should import history with tool results", () => {
        const toolCall: CodeBuddyToolCall = {
          id: "call_1",
          type: "function",
          function: { name: "test", arguments: "{}" },
        };
        const history: ChatEntry[] = [
          {
            type: "tool_result",
            content: "Result content",
            timestamp: new Date(),
            toolCall,
            toolResult: { success: true, output: "Output" },
          },
        ];

        processor.importHistory(JSON.stringify(history));
        const imported = processor.getChatHistory();

        expect(imported[0].type).toBe("tool_result");
        expect(imported[0].toolCall).toBeDefined();
        expect(imported[0].toolResult).toBeDefined();
      });
    });

    describe("Message Count and Recent Messages", () => {
      it("should return correct message count", () => {
        expect(processor.getMessageCount()).toBe(1); // system message

        processor.addUserMessage("Test 1");
        expect(processor.getMessageCount()).toBe(2);

        processor.addAssistantMessage("Response 1");
        expect(processor.getMessageCount()).toBe(3);
      });

      it("should get recent messages", () => {
        processor.addUserMessage("First");
        processor.addAssistantMessage("Second");
        processor.addUserMessage("Third");
        processor.addAssistantMessage("Fourth");

        const recent = processor.getRecentMessages(2);
        expect(recent.length).toBe(2);
        expect(recent[0].content).toBe("Third");
        expect(recent[1].content).toBe("Fourth");
      });

      it("should return all messages if count exceeds length", () => {
        processor.addUserMessage("Only one");

        const recent = processor.getRecentMessages(10);
        expect(recent.length).toBe(2); // system + user
      });

      it("should handle zero or negative count with slice behavior", () => {
        // slice(-0) returns the entire array
        const recent = processor.getRecentMessages(0);
        // This reflects the actual slice(-count) behavior where -0 === 0
        expect(recent.length).toBe(1); // Returns system message
      });
    });
  });

  // ============================================
  // 4. STREAMING MESSAGE HANDLING TESTS
  // ============================================
  describe("Streaming Message Handling", () => {
    describe("buildAccumulatedMessage", () => {
      it("should accumulate content from multiple chunks", () => {
        const chunks = [
          { choices: [{ delta: { content: "Hello " } }] },
          { choices: [{ delta: { content: "world" } }] },
          { choices: [{ delta: { content: "!" } }] },
        ];

        const result = processor.buildAccumulatedMessage(chunks);
        expect(result.content).toBe("Hello world!");
      });

      it("should handle empty chunks", () => {
        const chunks = [
          { choices: [{ delta: {} }] },
          { choices: [{ delta: { content: "test" } }] },
          { choices: [{ delta: {} }] },
        ];

        const result = processor.buildAccumulatedMessage(chunks);
        expect(result.content).toBe("test");
      });

      it("should handle chunks with no content", () => {
        const chunks = [
          { choices: [{ delta: {} }] },
          { choices: [{ delta: {} }] },
        ];

        const result = processor.buildAccumulatedMessage(chunks);
        expect(result.content).toBe("");
      });

      it("should handle empty chunks array", () => {
        const result = processor.buildAccumulatedMessage([]);
        expect(result.content).toBe("");
      });

      it("should handle chunks with undefined choices", () => {
        const chunks = [
          { choices: [] },
          { choices: [{ delta: { content: "test" } }] },
        ];

        const result = processor.buildAccumulatedMessage(chunks);
        expect(result.content).toBe("test");
      });

      it("should initialize tool_calls array when tool_calls present", () => {
        const chunks = [
          { choices: [{ delta: { tool_calls: [{ id: "1" }] } }] },
        ];

        const result = processor.buildAccumulatedMessage(chunks);
        // The simplified implementation initializes but doesn't merge
        expect(result.tool_calls).toEqual([]);
      });

      it("should handle mixed content and tool_calls chunks", () => {
        const chunks = [
          { choices: [{ delta: { content: "Calling tool..." } }] },
          { choices: [{ delta: { tool_calls: [{ id: "1" }] } }] },
        ];

        const result = processor.buildAccumulatedMessage(chunks);
        expect(result.content).toBe("Calling tool...");
        expect(result.tool_calls).toEqual([]);
      });
    });

    describe("Streaming Event Types", () => {
      it("should define content stream event type", () => {
        const event: StreamEvent = { type: "content", content: "test" };
        expect(event.type).toBe("content");
        expect(event.content).toBe("test");
      });

      it("should define tool_calls stream event type", () => {
        const toolCalls: CodeBuddyToolCall[] = [
          {
            id: "1",
            type: "function",
            function: { name: "test", arguments: "{}" },
          },
        ];
        const event: StreamEvent = { type: "tool_calls", toolCalls };
        expect(event.type).toBe("tool_calls");
        expect(event.toolCalls).toEqual(toolCalls);
      });

      it("should define tool_result stream event type", () => {
        const toolCall: CodeBuddyToolCall = {
          id: "1",
          type: "function",
          function: { name: "test", arguments: "{}" },
        };
        const toolResult: ToolResult = { success: true, output: "done" };
        const event: StreamEvent = { type: "tool_result", toolCall, toolResult };
        expect(event.type).toBe("tool_result");
      });

      it("should define token_count stream event type", () => {
        const event: StreamEvent = { type: "token_count", tokenCount: 100 };
        expect(event.type).toBe("token_count");
        expect(event.tokenCount).toBe(100);
      });

      it("should define done stream event type", () => {
        const event: StreamEvent = { type: "done" };
        expect(event.type).toBe("done");
      });
    });
  });

  // ============================================
  // 5. CONTENT SANITIZATION TESTS
  // ============================================
  describe("Content Sanitization", () => {
    describe("sanitizeLLMOutput", () => {
      describe("Control token removal", () => {
        it("should remove channel control tokens", () => {
          const input = "Hello <|channel|> world";
          const output = sanitizeLLMOutput(input);
          expect(output).toBe("Hello  world");
        });

        it("should remove message control tokens", () => {
          const input = "Test <|message|> content";
          const output = sanitizeLLMOutput(input);
          expect(output).toBe("Test  content");
        });

        it("should remove multiple control tokens", () => {
          const input = "<|start|>Hello<|end|> <|channel|>World<|message|>";
          const output = sanitizeLLMOutput(input);
          expect(output).toBe("Hello World");
        });

        it("should remove various control token patterns", () => {
          const input = "<|im_start|>user\nHello<|im_end|>";
          const output = sanitizeLLMOutput(input);
          expect(output).toBe("user\nHello");
        });

        it("should handle control tokens at start and end", () => {
          const input = "<|prefix|>content<|suffix|>";
          const output = sanitizeLLMOutput(input);
          expect(output).toBe("content");
        });
      });

      describe("Instruction tag removal", () => {
        it("should remove instruction tags", () => {
          const input = "Before [INST]instruction[/INST] After";
          const output = sanitizeLLMOutput(input);
          expect(output).toBe("Before  After");
        });

        it("should remove multiline instruction tags", () => {
          const input = `Before [INST]
instruction
on multiple lines
[/INST] After`;
          const output = sanitizeLLMOutput(input);
          expect(output).toBe("Before  After");
        });

        it("should remove multiple instruction tag pairs", () => {
          const input = "[INST]first[/INST] middle [INST]second[/INST]";
          const output = sanitizeLLMOutput(input);
          expect(output).toBe(" middle ");
        });
      });

      describe("Clean content passthrough", () => {
        it("should pass through normal message content unchanged", () => {
          const input = "Normal message content without any special tokens";
          const output = sanitizeLLMOutput(input);
          expect(output).toBe(input);
        });

        it("should preserve code blocks", () => {
          const input = "```javascript\nconst x = 1;\n```";
          const output = sanitizeLLMOutput(input);
          expect(output).toBe(input);
        });

        it("should preserve markdown formatting", () => {
          const input = "# Header\n\n- Item 1\n- Item 2\n\n**bold** and *italic*";
          const output = sanitizeLLMOutput(input);
          expect(output).toBe(input);
        });

        it("should preserve HTML-like content that is not control tokens", () => {
          const input = "<div>Hello</div>";
          const output = sanitizeLLMOutput(input);
          expect(output).toBe(input);
        });

        it("should handle empty string", () => {
          const output = sanitizeLLMOutput("");
          expect(output).toBe("");
        });

        it("should preserve unicode and emoji", () => {
          const input = "Hello \u{1F600} \u4E16\u754C";
          const output = sanitizeLLMOutput(input);
          expect(output).toBe(input);
        });
      });

      describe("Edge cases", () => {
        it("should handle malformed control tokens", () => {
          const input = "<|incomplete and <| also |>";
          const output = sanitizeLLMOutput(input);
          // The regex <\|[^|>]+\|> matches <| also |> as a control token
          // So the output removes that part
          expect(output).toBe("<|incomplete and ");
        });

        it("should handle nested-looking patterns", () => {
          const input = "<|outer<|inner|>|>";
          const output = sanitizeLLMOutput(input);
          // Should remove inner but outer may remain malformed
          expect(output).not.toContain("<|inner|>");
        });
      });
    });
  });

  // ============================================
  // 6. ERROR HANDLING TESTS
  // ============================================
  describe("Error Handling", () => {
    describe("Event Emission", () => {
      it("should emit message:added event for user messages", () => {
        const handler = jest.fn();
        processor.on("message:added", handler);

        processor.addUserMessage("Test");

        expect(handler).toHaveBeenCalled();
        expect(handler.mock.calls[0][0].type).toBe("user");
      });

      it("should emit message:added event for assistant messages", () => {
        const handler = jest.fn();
        processor.on("message:added", handler);

        processor.addAssistantMessage("Test response");

        expect(handler).toHaveBeenCalled();
        expect(handler.mock.calls[0][0].type).toBe("assistant");
      });

      it("should emit tool_result:added event", () => {
        const handler = jest.fn();
        processor.on("tool_result:added", handler);

        const toolCall: CodeBuddyToolCall = {
          id: "call_1",
          type: "function",
          function: { name: "test", arguments: "{}" },
        };

        processor.addToolResult(toolCall, { success: true, output: "done" });

        expect(handler).toHaveBeenCalled();
        expect(handler.mock.calls[0][0].type).toBe("tool_result");
      });

      it("should emit system:updated event", () => {
        const handler = jest.fn();
        processor.on("system:updated", handler);

        processor.updateSystemMessage("New system prompt");

        expect(handler).toHaveBeenCalledWith("New system prompt");
      });

      it("should emit cleared event", () => {
        const handler = jest.fn();
        processor.on("cleared", handler);

        processor.clear();

        expect(handler).toHaveBeenCalled();
      });

      it("should emit trimmed event with size info", () => {
        const handler = jest.fn();
        processor.on("trimmed", handler);

        for (let i = 0; i < 20; i++) {
          processor.addUserMessage(`Message ${i}`);
        }

        processor.trimHistory(10);

        expect(handler).toHaveBeenCalled();
        expect(handler.mock.calls[0][0]).toHaveProperty("size");
      });

      it("should emit history:imported event with count", () => {
        const handler = jest.fn();
        processor.on("history:imported", handler);

        const history: ChatEntry[] = [
          { type: "user", content: "Test 1", timestamp: new Date() },
          { type: "user", content: "Test 2", timestamp: new Date() },
        ];

        processor.importHistory(JSON.stringify(history));

        expect(handler).toHaveBeenCalledWith(2);
      });

      it("should allow multiple event listeners", () => {
        const handler1 = jest.fn();
        const handler2 = jest.fn();

        processor.on("message:added", handler1);
        processor.on("message:added", handler2);

        processor.addUserMessage("Test");

        expect(handler1).toHaveBeenCalled();
        expect(handler2).toHaveBeenCalled();
      });

      it("should allow removing event listeners", () => {
        const handler = jest.fn();

        processor.on("message:added", handler);
        processor.off("message:added", handler);

        processor.addUserMessage("Test");

        expect(handler).not.toHaveBeenCalled();
      });
    });

    describe("History Management Edge Cases", () => {
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

      it("should clear history when no system message", () => {
        const noSystemProcessor = new MessageProcessor();
        noSystemProcessor.addUserMessage("Test");

        noSystemProcessor.clear();

        expect(noSystemProcessor.getMessages().length).toBe(0);
        expect(noSystemProcessor.getChatHistory().length).toBe(0);
      });

      it("should trim history respecting max size", () => {
        for (let i = 0; i < 30; i++) {
          processor.addUserMessage(`Message ${i}`);
        }

        processor.trimHistory(10);

        const history = processor.getChatHistory();
        expect(history.length).toBe(10);
        // Should keep the most recent messages
        expect(history[0].content).toBe("Message 20");
        expect(history[9].content).toBe("Message 29");
      });

      it("should not trim if under max size", () => {
        processor.addUserMessage("Message 1");
        processor.addUserMessage("Message 2");

        processor.trimHistory(10);

        expect(processor.getChatHistory().length).toBe(2);
      });

      it("should preserve system message when trimming messages", () => {
        for (let i = 0; i < 20; i++) {
          processor.addUserMessage(`Message ${i}`);
        }

        processor.trimHistory(5);

        const messages = processor.getMessages();
        expect(messages[0].role).toBe("system");
        expect(messages.length).toBe(6); // system + 5 recent
      });

      it("should handle setMessages correctly", () => {
        const newMessages: Message[] = [
          { role: "system", content: "New system" },
          { role: "user", content: "New user message" },
        ];

        processor.setMessages(newMessages);

        const messages = processor.getMessages();
        expect(messages.length).toBe(2);
        expect(messages[0].content).toBe("New system");
      });
    });

    describe("Import Error Handling", () => {
      it("should throw descriptive error for invalid JSON", () => {
        expect(() => processor.importHistory("{broken")).toThrow(
          "Invalid history JSON"
        );
      });

      it("should throw for empty string", () => {
        expect(() => processor.importHistory("")).toThrow();
      });

      it("should throw for null input", () => {
        expect(() => processor.importHistory("null")).toThrow();
      });
    });

    describe("Message Returns", () => {
      it("should return a copy of messages array", () => {
        const messages1 = processor.getMessages();
        const messages2 = processor.getMessages();

        expect(messages1).not.toBe(messages2);
        expect(messages1).toEqual(messages2);
      });

      it("should return a copy of chat history", () => {
        processor.addUserMessage("Test");

        const history1 = processor.getChatHistory();
        const history2 = processor.getChatHistory();

        expect(history1).not.toBe(history2);
        expect(history1).toEqual(history2);
      });

      it("should not allow external modification of messages", () => {
        const messages = processor.getMessages();
        messages.push({
          role: "user",
          content: "External modification",
        });

        expect(processor.getMessages().length).toBe(1);
      });
    });
  });

  // ============================================
  // TYPE INTERFACE TESTS
  // ============================================
  describe("Type Interfaces", () => {
    describe("ChatEntry interface", () => {
      it("should support all message types", () => {
        const userEntry: ChatEntry = {
          type: "user",
          content: "test",
          timestamp: new Date(),
        };

        const assistantEntry: ChatEntry = {
          type: "assistant",
          content: "response",
          timestamp: new Date(),
          toolCalls: [],
        };

        const toolResultEntry: ChatEntry = {
          type: "tool_result",
          content: "result",
          timestamp: new Date(),
          toolCall: {
            id: "1",
            type: "function",
            function: { name: "test", arguments: "{}" },
          },
          toolResult: { success: true },
        };

        const systemEntry: ChatEntry = {
          type: "system",
          content: "system",
          timestamp: new Date(),
        };

        expect(userEntry.type).toBe("user");
        expect(assistantEntry.type).toBe("assistant");
        expect(toolResultEntry.type).toBe("tool_result");
        expect(systemEntry.type).toBe("system");
      });
    });

    describe("Message interface", () => {
      it("should support all role types", () => {
        const systemMsg: Message = { role: "system", content: "system prompt" };
        const userMsg: Message = { role: "user", content: "user input" };
        const assistantMsg: Message = {
          role: "assistant",
          content: "response",
          tool_calls: [],
        };
        const toolMsg: Message = {
          role: "tool",
          content: "result",
          tool_call_id: "call_1",
        };

        expect(systemMsg.role).toBe("system");
        expect(userMsg.role).toBe("user");
        expect(assistantMsg.role).toBe("assistant");
        expect(toolMsg.role).toBe("tool");
      });

      it("should allow null content for assistant with tool_calls", () => {
        const msg: Message = {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "1",
              type: "function",
              function: { name: "test", arguments: "{}" },
            },
          ],
        };

        expect(msg.content).toBeNull();
        expect(msg.tool_calls).toHaveLength(1);
      });
    });

    describe("ToolResult interface", () => {
      it("should support success result", () => {
        const result: ToolResult = {
          success: true,
          output: "Operation completed",
        };

        expect(result.success).toBe(true);
        expect(result.output).toBe("Operation completed");
      });

      it("should support error result", () => {
        const result: ToolResult = {
          success: false,
          error: "Something went wrong",
        };

        expect(result.success).toBe(false);
        expect(result.error).toBe("Something went wrong");
      });

      it("should support minimal result", () => {
        const successResult: ToolResult = { success: true };
        const errorResult: ToolResult = { success: false };

        expect(successResult.output).toBeUndefined();
        expect(errorResult.error).toBeUndefined();
      });
    });

    describe("ExtractedToolCalls interface", () => {
      it("should contain toolCalls array and remainingContent", () => {
        const extracted: ExtractedToolCalls = {
          toolCalls: [{ name: "test", arguments: { key: "value" } }],
          remainingContent: "remaining text",
        };

        expect(extracted.toolCalls).toHaveLength(1);
        expect(extracted.remainingContent).toBe("remaining text");
      });

      it("should support empty toolCalls array", () => {
        const extracted: ExtractedToolCalls = {
          toolCalls: [],
          remainingContent: "no tools here",
        };

        expect(extracted.toolCalls).toHaveLength(0);
      });
    });
  });
});
