import { CodeBuddyToolCall } from "../codebuddy/client.js";
import { ToolResult } from "../types/index.js";

/**
 * Represents a single entry in the chat history.
 * Used for UI display and history tracking.
 */
export interface ChatEntry {
  /** 
   * Type of chat entry:
   * - `user`: Message from the user
   * - `assistant`: Message from the AI (text content)
   * - `tool_call`: A request to execute a tool (displayed as "Executing...")
   * - `tool_result`: The output or error from a tool execution
   */
  type: "user" | "assistant" | "tool_result" | "tool_call" | "reasoning" | "plan_progress" | "steer";
  
  /** Content of the message. For tool results, this is the output string. */
  content: string;
  
  /** When this entry was created */
  timestamp: Date;
  
  /** Tool calls made by the assistant (if any) associated with this entry */
  toolCalls?: CodeBuddyToolCall[];
  
  /** Single tool call object (populated for `tool_call` and `tool_result` types) */
  toolCall?: CodeBuddyToolCall;
  
  /** Result of tool execution (populated for `tool_result` type) */
  toolResult?: { success: boolean; output?: string; error?: string };
  
  /** Whether this entry is currently being streamed/updated */
  isStreaming?: boolean;
}

/**
 * Represents a chunk of data in a streaming response.
 * The agent emits these chunks to allow real-time UI updates.
 */
export interface StreamingChunk {
  /** 
   * Type of streaming chunk:
   * - `content`: Text content delta
   * - `tool_calls`: List of tool calls to be executed
   * - `tool_result`: Result of a completed tool execution
   * - `token_count`: Update on token usage
   * - `done`: Stream completion signal
   */
  type: "content" | "tool_calls" | "tool_result" | "done" | "token_count" | "reasoning" | "tool_stream" | "ask_user" | "plan_progress" | "steer";
  
  /** Text content delta (for `content` type) */
  content?: string;
  
  /** Tool calls made (for `tool_calls` type) */
  toolCalls?: CodeBuddyToolCall[];
  
  /** Single tool call (for `tool_call` type - legacy/optional) */
  toolCall?: CodeBuddyToolCall;
  
  /** Result of tool execution (for `tool_result` type) */
  toolResult?: ToolResult;
  
  /** Current total token count (for `token_count` type) */
  tokenCount?: number;

  /** Reasoning/thinking content from extended thinking models (for `reasoning` type) */
  reasoning?: string;

  /** Tool streaming data for real-time tool output (for `tool_stream` type) */
  toolStreamData?: {
    toolCallId: string;
    toolName: string;
    delta: string;
  };

  /** Ask user question data (for `ask_user` type) */
  askUser?: {
    question: string;
    options: string[];
  };

  /** Plan progress data (for `plan_progress` type) */
  planProgress?: {
    taskId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    total: number;
    completed: number;
    message?: string;
  };

  /** Steering message data (for `steer` type) */
  steer?: {
    content: string;
    source: string;
  };
}
