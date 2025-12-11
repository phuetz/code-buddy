/**
 * Message Processor Module
 *
 * Handles message processing, streaming, and tool call extraction.
 * Extracted from GrokAgent for better modularity and testability.
 */

import { EventEmitter } from "events";

/**
 * Chat entry types for history
 */
export interface ChatEntry {
  type: "user" | "assistant" | "tool_result" | "system";
  content: string;
  timestamp: Date;
  toolCalls?: GrokToolCall[];
  toolCall?: GrokToolCall;
  toolResult?: ToolResult;
}

/**
 * Tool call structure from OpenAI/Grok API
 */
export interface GrokToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Result of a tool execution
 */
export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * Message structure for API communication
 */
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: GrokToolCall[];
  tool_call_id?: string;
}

/**
 * Streaming event types
 */
export type StreamEvent =
  | { type: "content"; content: string }
  | { type: "tool_calls"; toolCalls: GrokToolCall[] }
  | { type: "tool_result"; toolCall: GrokToolCall; toolResult: ToolResult }
  | { type: "token_count"; tokenCount: number }
  | { type: "done" };

/**
 * Commentary tool call pattern matching result
 */
export interface ExtractedToolCalls {
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  remainingContent: string;
}

/**
 * LLM output sanitization patterns
 */
const LLM_CONTROL_PATTERNS = [
  /<\|[^|>]+\|>/g,  // Control tokens like <|channel|>, <|message|>
  /\[INST\].*?\[\/INST\]/gs,  // Instruction tags
];

/**
 * Sanitize LLM output by removing control tokens
 */
export function sanitizeLLMOutput(content: string): string {
  let sanitized = content;
  for (const pattern of LLM_CONTROL_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  return sanitized;
}

/**
 * Extract tool calls from commentary-style patterns in content
 *
 * Handles patterns like:
 * - "commentary to=web_search {"query":"..."}"
 * - "web_search({"query":"test"})"
 */
export function extractCommentaryToolCalls(content: string): ExtractedToolCalls {
  const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  let remainingContent = content;

  // Pattern 1: commentary to=tool_name {...}
  const commentaryPattern = /commentary\s+to=(\w+)\s+(\{[^}]+\})/g;
  let match;

  while ((match = commentaryPattern.exec(content)) !== null) {
    try {
      const toolName = match[1];
      const args = JSON.parse(match[2]);
      toolCalls.push({ name: toolName, arguments: args });
      remainingContent = remainingContent.replace(match[0], "").trim();
    } catch {
      // Invalid JSON, skip this match
    }
  }

  // Pattern 2: tool_name({...})
  const functionCallPattern = /(\w+)\s*\(\s*(\{[^}]+\})\s*\)/g;

  while ((match = functionCallPattern.exec(content)) !== null) {
    try {
      const toolName = match[1];
      // Skip if it's a common JavaScript function
      if (["console", "log", "error", "warn", "info", "debug"].includes(toolName)) {
        continue;
      }
      const args = JSON.parse(match[2]);
      toolCalls.push({ name: toolName, arguments: args });
      remainingContent = remainingContent.replace(match[0], "").trim();
    } catch {
      // Invalid JSON, skip this match
    }
  }

  return { toolCalls, remainingContent };
}

/**
 * MessageProcessor handles message creation and history management.
 */
export class MessageProcessor extends EventEmitter {
  private chatHistory: ChatEntry[] = [];
  private messages: Message[] = [];

  constructor(systemPrompt?: string) {
    super();
    if (systemPrompt) {
      this.messages.push({
        role: "system",
        content: systemPrompt,
      });
    }
  }

  /**
   * Add a user message to history
   */
  addUserMessage(content: string): void {
    const entry: ChatEntry = {
      type: "user",
      content,
      timestamp: new Date(),
    };
    this.chatHistory.push(entry);
    this.messages.push({
      role: "user",
      content,
    });
    this.emit("message:added", entry);
  }

  /**
   * Add an assistant message to history
   */
  addAssistantMessage(content: string, toolCalls?: GrokToolCall[]): void {
    const entry: ChatEntry = {
      type: "assistant",
      content,
      timestamp: new Date(),
      toolCalls,
    };
    this.chatHistory.push(entry);
    this.messages.push({
      role: "assistant",
      content,
      tool_calls: toolCalls,
    });
    this.emit("message:added", entry);
  }

  /**
   * Add a tool result to history
   */
  addToolResult(toolCall: GrokToolCall, result: ToolResult): void {
    const entry: ChatEntry = {
      type: "tool_result",
      content: result.success ? result.output || "Success" : result.error || "Error",
      timestamp: new Date(),
      toolCall,
      toolResult: result,
    };
    this.chatHistory.push(entry);
    this.messages.push({
      role: "tool",
      content: result.success ? result.output || "Success" : result.error || "Error",
      tool_call_id: toolCall.id,
    });
    this.emit("tool_result:added", entry);
  }

  /**
   * Add a system message
   */
  addSystemMessage(content: string): void {
    const entry: ChatEntry = {
      type: "system",
      content,
      timestamp: new Date(),
    };
    this.chatHistory.push(entry);
    this.emit("message:added", entry);
  }

  /**
   * Get all messages for API call
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Get chat history
   */
  getChatHistory(): ChatEntry[] {
    return [...this.chatHistory];
  }

  /**
   * Set messages (for context management)
   */
  setMessages(messages: Message[]): void {
    this.messages = messages;
  }

  /**
   * Get the system message
   */
  getSystemMessage(): Message | undefined {
    return this.messages.find((m) => m.role === "system");
  }

  /**
   * Update the system message
   */
  updateSystemMessage(content: string): void {
    const systemMessage = this.messages.find((m) => m.role === "system");
    if (systemMessage) {
      systemMessage.content = content;
    } else {
      this.messages.unshift({
        role: "system",
        content,
      });
    }
    this.emit("system:updated", content);
  }

  /**
   * Clear all history except system message
   */
  clear(): void {
    this.chatHistory = [];
    // Keep only the system message
    this.messages = this.messages.filter((m) => m.role === "system");
    this.emit("cleared");
  }

  /**
   * Trim history to prevent unbounded growth
   */
  trimHistory(maxSize: number): void {
    if (this.chatHistory.length > maxSize) {
      this.chatHistory = this.chatHistory.slice(-maxSize);
    }

    // Trim messages, keeping system message
    const maxMessages = maxSize + 1;
    if (this.messages.length > maxMessages) {
      const systemMessage = this.messages.find((m) => m.role === "system");
      const recentMessages = this.messages
        .filter((m) => m.role !== "system")
        .slice(-maxSize);
      this.messages = systemMessage
        ? [systemMessage, ...recentMessages]
        : recentMessages;
    }
    this.emit("trimmed", { size: this.chatHistory.length });
  }

  /**
   * Get message count
   */
  getMessageCount(): number {
    return this.messages.length;
  }

  /**
   * Get the last N messages
   */
  getRecentMessages(count: number): Message[] {
    return this.messages.slice(-count);
  }

  /**
   * Build accumulated message from streaming chunks
   */
  buildAccumulatedMessage(
    chunks: Array<{ choices: Array<{ delta: { content?: string; tool_calls?: unknown[] } }> }>
  ): { content: string; tool_calls?: GrokToolCall[] } {
    let content = "";
    let toolCalls: GrokToolCall[] | undefined;

    for (const chunk of chunks) {
      if (chunk.choices[0]?.delta?.content) {
        content += chunk.choices[0].delta.content;
      }
      if (chunk.choices[0]?.delta?.tool_calls) {
        // Accumulate tool calls
        if (!toolCalls) toolCalls = [];
        // This is simplified - actual implementation needs to merge tool call deltas
      }
    }

    return { content, tool_calls: toolCalls };
  }

  /**
   * Create an error message entry
   */
  createErrorEntry(error: string): ChatEntry {
    return {
      type: "assistant",
      content: `Sorry, I encountered an error: ${error}`,
      timestamp: new Date(),
    };
  }

  /**
   * Export history to JSON
   */
  exportHistory(): string {
    return JSON.stringify(this.chatHistory, null, 2);
  }

  /**
   * Import history from JSON
   */
  importHistory(json: string): void {
    try {
      const history = JSON.parse(json) as ChatEntry[];
      this.chatHistory = history.map((entry) => ({
        ...entry,
        timestamp: new Date(entry.timestamp),
      }));
      this.emit("history:imported", this.chatHistory.length);
    } catch {
      throw new Error("Invalid history JSON");
    }
  }
}
