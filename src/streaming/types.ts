import { CodeBuddyToolCall } from '../codebuddy/client.js';
import { ToolResult } from '../types/index.js';

export type StreamEventType = 
  | 'content' 
  | 'tool_call' 
  | 'tool_result' 
  | 'token_count' 
  | 'error' 
  | 'done';

export interface StreamEvent {
  type: StreamEventType;
  content?: string;
  toolCall?: CodeBuddyToolCall;
  toolCalls?: CodeBuddyToolCall[];
  toolResult?: ToolResult;
  tokenCount?: number;
  error?: string;
}

export interface StreamStats {
  chunkCount: number;
  contentLength: number;
  toolCallCount: number;
  startTime: number;
  duration?: number;
}

export interface ChunkProcessorOptions {
  /** Sanitize content to remove LLM control tokens */
  sanitize?: boolean;
  /** Automatically extract commentary-style tool calls */
  extractCommentaryTools?: boolean;
}
