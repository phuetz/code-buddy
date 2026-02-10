import { ChatEntry } from "../../agent/codebuddy-agent.js";
import { getEnhancedMemory } from "../../memory/index.js";
import { getCommentWatcher } from "../../tools/comment-watcher.js";
import { getErrorMessage } from "../../errors/index.js";

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
        if (args[1]) {
          const searchTerm = args.slice(1).join(" ");

          // Special case: "forget last" or "forget last N"
          if (searchTerm.toLowerCase().startsWith("last")) {
            const countMatch = searchTerm.match(/last\s+(\d+)/i);
            const count = countMatch ? parseInt(countMatch[1], 10) : 1;

            // Get all memories sorted by creation date (most recent first)
            const allMems = await memory.recall({ limit: 10000 });
            const sortedByDate = allMems.sort((a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );

            const toForget = sortedByDate.slice(0, count);
            if (toForget.length > 0) {
              for (const m of toForget) {
                await memory.forget(m.id);
              }
              content = `🗑️ Forgot ${toForget.length} most recent ${toForget.length === 1 ? 'memory' : 'memories'}`;
            } else {
              content = `No memories to forget`;
            }
          } else {
            // Fuzzy search: try tag match first, then content match
            let mems = await memory.recall({ tags: [searchTerm] });

            // If no exact tag match, try fuzzy content search
            if (mems.length === 0) {
              mems = await memory.recall({ query: searchTerm, limit: 50 });

              // Further filter for fuzzy matching on tags and content
              const searchLower = searchTerm.toLowerCase();
              mems = mems.filter(m => {
                // Check if any tag contains the search term (fuzzy)
                const tagMatch = m.tags.some(tag =>
                  tag.toLowerCase().includes(searchLower) ||
                  searchLower.includes(tag.toLowerCase())
                );
                // Check if content contains the search term
                const contentMatch = m.content.toLowerCase().includes(searchLower);
                return tagMatch || contentMatch;
              });
            }

            if (mems.length > 0) {
              // Show preview of what will be forgotten
              if (mems.length > 5) {
                // For many matches, ask for confirmation by showing count
                const preview = mems.slice(0, 3).map(m =>
                  `  - ${m.content.slice(0, 50)}${m.content.length > 50 ? '...' : ''}`
                ).join('\n');
                content = `🗑️ Found ${mems.length} memories matching "${searchTerm}":\n${preview}\n  ... and ${mems.length - 3} more.\n\nTo forget all, run: /memory forget-confirm ${searchTerm}`;
              } else {
                let forgotCount = 0;
                for (const m of mems) {
                  await memory.forget(m.id);
                  forgotCount++;
                }
                content = `🗑️ Forgot ${forgotCount} ${forgotCount === 1 ? 'memory' : 'memories'} matching "${searchTerm}"`;
              }
            } else {
              content = `No memories found matching "${searchTerm}"`;
            }
          }
        } else {
          content = `Usage: /memory forget <tag|query>
Also supported: /memory forget last [N]`;
        }
        break;

      case "forget-confirm":
        // Force forget all matches without preview
        if (args[1]) {
          const searchTerm = args.slice(1).join(" ");
          let mems = await memory.recall({ tags: [searchTerm] });

          if (mems.length === 0) {
            mems = await memory.recall({ query: searchTerm, limit: 1000 });
            const searchLower = searchTerm.toLowerCase();
            mems = mems.filter(m => {
              const tagMatch = m.tags.some(tag =>
                tag.toLowerCase().includes(searchLower) ||
                searchLower.includes(tag.toLowerCase())
              );
              const contentMatch = m.content.toLowerCase().includes(searchLower);
              return tagMatch || contentMatch;
            });
          }

          if (mems.length > 0) {
            let forgotCount = 0;
            for (const m of mems) {
              await memory.forget(m.id);
              forgotCount++;
            }
            content = `🗑️ Forgot ${forgotCount} ${forgotCount === 1 ? 'memory' : 'memories'} matching "${searchTerm}"`;
          } else {
            content = `No memories found matching "${searchTerm}"`;
          }
        } else {
          content = `Usage: /memory forget-confirm <query>`;
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
