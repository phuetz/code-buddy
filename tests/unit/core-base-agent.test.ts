import { BaseAgent } from "../../src/agent/base-agent";
import { ChatEntry, StreamingChunk } from "../../src/agent/types";
import { CodeBuddyToolCall } from "../../src/codebuddy/client";
import { ToolResult } from "../../src/types";
import { EventEmitter } from "events";

// Mock infrastructure
const mockTokenCounter = { dispose: jest.fn() };
const mockContextManager = { dispose: jest.fn(), prepareMessages: jest.fn(), getStats: jest.fn(), updateConfig: jest.fn() };
const mockModeManager = { getMode: jest.fn(), setMode: jest.fn() };

class TestAgent extends BaseAgent {
  constructor() {
    super();
    this.tokenCounter = mockTokenCounter as any;
    this.contextManager = mockContextManager as any;
    this.modeManager = mockModeManager as any;
  }

  async processUserMessage(message: string): Promise<ChatEntry[]> {
    const entry: ChatEntry = { type: "assistant", content: "response", timestamp: new Date() };
    this.chatHistory.push(entry);
    return [entry];
  }

  async *processUserMessageStream(message: string): AsyncGenerator<StreamingChunk, void, unknown> {
    yield { type: "content", content: "test" };
  }

  protected async executeTool(toolCall: CodeBuddyToolCall): Promise<ToolResult> {
    return { success: true, output: "tool output" };
  }

  // Expose protected methods for testing
  public testTrimHistory(maxSize?: number) {
    this.trimHistory(maxSize);
  }

  public setMessages(messages: any[]) {
    this.messages = messages;
  }

  public getMessages() {
    return this.messages;
  }

  public setChatHistory(history: ChatEntry[]) {
    this.chatHistory = history;
  }
}

describe("BaseAgent", () => {
  let agent: TestAgent;

  beforeEach(() => {
    jest.clearAllMocks();
    agent = new TestAgent();
  });

  it("should be an EventEmitter", () => {
    expect(agent).toBeInstanceOf(EventEmitter);
  });

  it("should get chat history", () => {
    const history: ChatEntry[] = [{ type: "user", content: "hi", timestamp: new Date() }];
    agent.setChatHistory(history);
    expect(agent.getChatHistory()).toEqual(history);
  });

  it("should clear chat", () => {
    agent.setChatHistory([{ type: "user", content: "hi", timestamp: new Date() }]);
    agent.setMessages([{ role: "system", content: "sys" }, { role: "user", content: "hi" }]);
    
    agent.clearChat();
    
    expect(agent.getChatHistory()).toEqual([]);
    expect(agent.getMessages()).toEqual([{ role: "system", content: "sys" }]);
  });

  it("should handle mode", () => {
    mockModeManager.getMode.mockReturnValue("code");
    expect(agent.getMode()).toBe("code");
    
    agent.setMode("ask" as any);
    expect(mockModeManager.setMode).toHaveBeenCalledWith("ask");
  });

  it("should handle session cost and limit", () => {
    expect(agent.getSessionCost()).toBe(0);
    agent.setSessionCostLimit(50);
    expect(agent.getSessionCostLimit()).toBe(50);
    expect(agent.isSessionCostLimitReached()).toBe(false);
  });

  it("should trim history", () => {
    const history = new Array(1100).fill(null).map((_, i) => ({
      type: "user",
      content: `msg ${i}`,
      timestamp: new Date()
    })) as ChatEntry[];
    
    agent.setChatHistory(history);
    agent.testTrimHistory(1000);
    
    expect(agent.getChatHistory().length).toBe(1000);
    expect(agent.getChatHistory()[0].content).toBe("msg 100");
  });

  it("should dispose resources", () => {
    agent.dispose();
    expect(mockTokenCounter.dispose).toHaveBeenCalled();
    expect(mockContextManager.dispose).toHaveBeenCalled();
    expect(agent.getChatHistory()).toEqual([]);
  });

  it("should abort current operation", () => {
    const abortSpy = jest.fn();
    (agent as any).abortController = { abort: abortSpy };
    
    agent.abortCurrentOperation();
    
    expect(abortSpy).toHaveBeenCalled();
  });
});
