import { ChatEntry, StreamingChunk } from "../agent/types.js";

/**
 * Base interface for all agents
 */
export interface Agent {
  processUserMessage(message: string): Promise<ChatEntry[]>;
  processUserMessageStream(message: string): AsyncGenerator<StreamingChunk, void, unknown>;
  getChatHistory(): ChatEntry[];
  clearChat(): void;
  dispose(): void;
}
