/**
 * Agent Module
 *
 * The core intelligence of the application. This module contains:
 *
 * - `CodeBuddyAgent`: The main agent implementation that orchestrates the LLM loop.
 * - `BaseAgent`: The abstract base class providing common infrastructure.
 * - `AgentState`: Management of agent configuration and runtime state.
 * - `MessageProcessor`: Handling of chat history and message formatting.
 *
 * @module agent
 */

// Agent Interfaces
export type {
  // Chat types
  ChatEntryType,
  IChatEntry,
  StreamingChunkType,
  IStreamingChunk,
  // Tool types
  IToolCall,
  IParsedToolCall,
  // Core agent
  IAgent,
  // Extended agent
  AgentModeType,
  IExtendedAgent,
  // Specialized agent
  AgentCapabilityType,
  IAgentTask,
  IAgentResult,
  ISpecializedAgentConfig,
  ISpecializedAgent,
  // Factory
  IAgentOptions,
  IAgentFactory,
} from './interfaces/index.js';

// Re-export new modules
export { BaseAgent } from "./base-agent.js";
export {
  ToolExecutor,
  type ToolExecutorDependencies,
  type ToolMetrics,
} from "./tool-executor.js";

export {
  MessageProcessor,
  sanitizeLLMOutput,
  extractCommentaryToolCalls,
  type ChatEntry as ProcessorChatEntry,
  type Message,
  type StreamEvent,
  type ExtractedToolCalls,
} from "./message-processor.js";

export {
  AgentState,
  DEFAULT_AGENT_CONFIG,
  YOLO_CONFIG,
  type AgentConfig,
} from "./agent-state.js";

export { CodeBuddyAgent } from "./codebuddy-agent.js";
export type * from "./types.js";

// Streaming Module
export * from "./streaming/index.js";

// Execution Module
export * from "./execution/index.js";

// Context Module
export * from "./context/index.js";

// Legacy imports
import { TextEditorTool, BashTool } from '../tools/index.js';
import { ToolResult, AgentState as LegacyAgentState } from '../types/index.js';

/**
 * Legacy Agent class - kept for backwards compatibility.
 * Implements a simple command-pattern agent without LLM integration.
 * 
 * @deprecated Use `CodeBuddyAgent` for full AI capabilities.
 */
export class Agent {
  private textEditor: TextEditorTool;
  private bash: BashTool;
  private state: LegacyAgentState;

  constructor() {
    this.textEditor = new TextEditorTool();
    this.bash = new BashTool();
    this.state = {
      currentDirectory: process.cwd(),
      editHistory: [],
      tools: [],
    };
  }

  async processCommand(input: string): Promise<ToolResult> {
    const trimmedInput = input.trim();

    if (trimmedInput.startsWith('view ')) {
      const args = this.parseViewCommand(trimmedInput);
      return this.textEditor.view(args.path, args.range);
    }

    if (trimmedInput.startsWith('str_replace ')) {
      const args = this.parseStrReplaceCommand(trimmedInput);
      if (!args) {
        return { success: false, error: 'Invalid str_replace command format' };
      }
      return this.textEditor.strReplace(args.path, args.oldStr, args.newStr);
    }

    if (trimmedInput.startsWith('create ')) {
      const args = this.parseCreateCommand(trimmedInput);
      if (!args) {
        return { success: false, error: 'Invalid create command format' };
      }
      return this.textEditor.create(args.path, args.content);
    }

    if (trimmedInput.startsWith('insert ')) {
      const args = this.parseInsertCommand(trimmedInput);
      if (!args) {
        return { success: false, error: 'Invalid insert command format' };
      }
      return this.textEditor.insert(args.path, args.line, args.content);
    }

    if (trimmedInput === 'undo_edit') {
      return this.textEditor.undoEdit();
    }

    if (trimmedInput.startsWith('bash ') || trimmedInput.startsWith('$ ')) {
      const command = trimmedInput.startsWith('bash ')
        ? trimmedInput.substring(5)
        : trimmedInput.substring(2);
      return this.bash.execute(command);
    }

    if (trimmedInput === 'pwd') {
      return {
        success: true,
        output: this.bash.getCurrentDirectory(),
      };
    }

    if (trimmedInput === 'history') {
      const history = this.textEditor.getEditHistory();
      return {
        success: true,
        output: history.length > 0 ? JSON.stringify(history, null, 2) : 'No edit history',
      };
    }

    if (trimmedInput === 'help') {
      return this.getHelp();
    }

    return this.bash.execute(trimmedInput);
  }

  private parseViewCommand(input: string): { path: string; range?: [number, number] } {
    const parts = input.split(' ');
    const path = parts[1];

    if (parts.length > 2) {
      const rangePart = parts[2];
      if (rangePart.includes('-')) {
        const [start, end] = rangePart.split('-').map(Number);
        return { path, range: [start, end] };
      }
    }

    return { path };
  }

  private parseStrReplaceCommand(
    input: string
  ): { path: string; oldStr: string; newStr: string } | null {
    const match = input.match(/str_replace\s+(\S+)\s+"([^"]+)"\s+"([^"]*)"/);
    if (!match) return null;

    return {
      path: match[1],
      oldStr: match[2],
      newStr: match[3],
    };
  }

  private parseCreateCommand(input: string): { path: string; content: string } | null {
    const match = input.match(/create\s+(\S+)\s+"([^"]*)"/);
    if (!match) return null;

    return {
      path: match[1],
      content: match[2],
    };
  }

  private parseInsertCommand(
    input: string
  ): { path: string; line: number; content: string } | null {
    const match = input.match(/insert\s+(\S+)\s+(\d+)\s+"([^"]*)"/);
    if (!match) return null;

    return {
      path: match[1],
      line: parseInt(match[2]),
      content: match[3],
    };
  }

  private getHelp(): ToolResult {
    return {
      success: true,
      output: `Available commands:
  view <path> [start-end]     - View file contents or directory
  str_replace <path> "old" "new" - Replace text in file
  create <path> "content"     - Create new file with content
  insert <path> <line> "text" - Insert text at specific line
  undo_edit                   - Undo last edit operation
  bash <command>              - Execute bash command
  $ <command>                 - Execute bash command (shorthand)
  pwd                         - Show current directory
  history                     - Show edit history
  help                        - Show this help message`,
    };
  }

  getCurrentState(): LegacyAgentState {
    return {
      ...this.state,
      currentDirectory: this.bash.getCurrentDirectory(),
      editHistory: this.textEditor.getEditHistory(),
    };
  }
}
