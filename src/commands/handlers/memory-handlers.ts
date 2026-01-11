import { ChatEntry } from "../../agent/codebuddy-agent.js";
import { getEnhancedMemory } from "../../memory/index.js";
import { getCommentWatcher } from "../../tools/comment-watcher.js";
import { getErrorMessage } from "../../types/errors.js";

export interface CommandHandlerResult {
  handled: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
  message?: string; // Add message support for newer handler interface
}

/**
 * Memory - Manage persistent memory using EnhancedMemory (SQLite/Vector)
 */
export async function handleMemory(args: string[]): Promise<CommandHandlerResult> {
  const memory = getEnhancedMemory();
  const action = args[0]?.toLowerCase() || 'list';

  try {
    let content: string;

    switch (action) {
      case "recall":
      case "find":
        if (args[1]) {
          const query = args.slice(1).join(" ");
          const results = await memory.recall({ query, limit: 5 });
          
          if (results.length === 0) {
            content = "No matching memories found.";
          } else {
            const formatted = results.map(r => {
              const date = new Date(r.createdAt).toLocaleDateString();
              return `- [${r.type}] ${r.content} (score: ${r.importance.toFixed(2)}, ${date})`;
            }).join('\n');
            content = `🔍 **Recall Results**:\n${formatted}`;
          }
        } else {
          content = `Usage: /memory recall <query>`;
        }
        break;

      case "forget":
        // TODO: Enhance to support forgetting by query or last added
        if (args[1]) {
           const tag = args[1];
           // Try to forget by tag for now as we don't expose IDs easily
           const mems = await memory.recall({ tags: [tag] });
           if (mems.length > 0) {
             let count = 0;
             for (const m of mems) {
               await memory.forget(m.id);
               count++;
             }
             content = `🗑️ Forgot ${count} memories with tag "${tag}"`;
           } else {
             content = `No memories found with tag "${tag}"`;
           }
        } else {
          content = `Usage: /memory forget <tag>`;
        }
        break;

      case "remember":
      case "store":
        if (args.length >= 3) {
          const key = args[1];
          const value = args.slice(2).join(" ");
          await memory.store({
            type: 'fact',
            content: value,
            tags: [key],
            importance: 0.8
          });
          content = `✅ Remembered: "${value}" (tag: ${key})`;
        } else {
          content = `Usage: /memory remember <key/tag> <content>`;
        }
        break;

      case "context":
        content = await memory.buildContext({
          includeProject: true,
          includePreferences: true,
          includeRecentSummaries: true
        });
        content = `🧠 **Current Context Injection**:\n\n${content}`;
        break;

      case "status":
      case "list":
      default:
        content = memory.formatStatus();
        break;
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
      message: content // Compatibility with newer interface
    };
  } catch (error) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `Error accessing memory: ${getErrorMessage(error)}`,
        timestamp: new Date(),
      },
    };
  }
}

/**
 * Remember - Quick memory store using EnhancedMemory
 */
export async function handleRemember(args: string[]): Promise<CommandHandlerResult> {
  const memory = getEnhancedMemory();

  if (args.length < 2) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `Usage: /remember <key> <value>`,
        timestamp: new Date(),
      },
    };
  }

  const key = args[0];
  const value = args.slice(1).join(" ");

  try {
    await memory.store({
      type: 'fact',
      content: value,
      tags: [key],
      importance: 0.8
    });

    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `✅ Remembered: "${value}" (tag: ${key})`,
        timestamp: new Date(),
      },
    };
  } catch (error) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `Error storing memory: ${getErrorMessage(error)}`,
        timestamp: new Date(),
      },
    };
  }
}

/**
 * Scan Todos - Find AI-directed comments
 */
export async function handleScanTodos(): Promise<CommandHandlerResult> {
  const commentWatcher = getCommentWatcher();

  await commentWatcher.scanProject();
  const content = commentWatcher.formatComments();

  return {
    handled: true,
    entry: {
      type: "assistant",
      content,
      timestamp: new Date(),
    },
  };
}

/**
 * Address Todo - Handle specific AI comment
 */
export async function handleAddressTodo(
  args: string[]
): Promise<CommandHandlerResult> {
  const commentWatcher = getCommentWatcher();
  const index = parseInt(args[0], 10);

  if (isNaN(index)) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `Usage: /address-todo <index>

Run /scan-todos first to see available items`,
        timestamp: new Date(),
      },
    };
  }

  const comments = commentWatcher.getDetectedComments();

  if (index < 1 || index > comments.length) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `❌ Invalid index. Available: 1-${comments.length}`,
        timestamp: new Date(),
      },
    };
  }

  const comment = comments[index - 1];
  const prompt = commentWatcher.generatePromptForComment(comment);

  return {
    handled: true,
    passToAI: true,
    prompt,
  };
}
