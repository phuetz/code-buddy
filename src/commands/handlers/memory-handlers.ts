import { ChatEntry } from "../../agent/codebuddy-agent.js";
import { getEnhancedMemory, getMemoryManager } from "../../memory/index.js";
import { getCommentWatcher } from "../../tools/comment-watcher.js";
import { getErrorMessage } from "../../errors/index.js";
import type { MemoryWriteResult } from "../../memory/persistent-memory.js";

export interface MemoryCommandContext {
  cwd?: string;
  botId?: string;
}

export interface CommandHandlerResult {
  handled: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
  message?: string; // Add message support for newer handler interface
}

/**
 * Render a relative-time string ("2 minutes ago", "3 hours ago", "just now").
 * Used by `/memory recent` for human-friendly timestamps.
 */
function formatTimeAgo(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 30) return "just now";
  if (sec < 60) return `${sec} seconds ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon} month${mon === 1 ? "" : "s"} ago`;
  const yr = Math.floor(day / 365);
  return `${yr} year${yr === 1 ? "" : "s"} ago`;
}

/**
 * Report a remember operation honestly: the persistent write is the primary
 * result; fact reconciliation and the semantic index are secondary and their
 * failures are shown without hiding (or overstating) the saved memory.
 */
async function describeRememberOutcome(
  write: MemoryWriteResult | undefined,
  requestedKey: string,
  scope: "project" | "user",
  storeSemantic: () => Promise<unknown>,
): Promise<string> {
  const lines = [`✅ Remembered: "${write?.key ?? requestedKey}" in persistent ${scope} memory.`];
  if (write?.reconciliation?.status === "failed") {
    lines.push(`⚠️ Fact reconciliation failed (${write.reconciliation.reason ?? "unknown error"}); the memory was saved directly and existing memories were kept unchanged.`);
  }
  try {
    await storeSemantic();
    lines.push("Semantic index updated.");
  } catch (error) {
    lines.push(`⚠️ Semantic index not updated: ${getErrorMessage(error)}`);
  }
  return lines.join("\n");
}

function clip(text: string, max = 180): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/**
 * Memory - Manage persistent memory using PersistentMemoryManager (Markdown) and EnhancedMemory (SQLite/Vector)
 */
export async function handleMemory(args: string[], context?: MemoryCommandContext): Promise<CommandHandlerResult> {
  const enhancedMemory = getEnhancedMemory();
  const persistentMemory = getMemoryManager(undefined, context?.botId, context?.cwd);
  const action = args[0]?.toLowerCase() || 'list';

  try {
    await persistentMemory.initialize();
    let content: string;

    switch (action) {
      case "recall":
      case "find":
        if (args[1]) {
          const query = args.slice(1).join(" ");
          
          // Try persistent memory first (exact/keyword match)
          const persistentResult = persistentMemory.recall(query);
          
          // Also try enhanced memory (semantic search)
          const enhancedResults = await enhancedMemory.recall({ query, limit: 5 });
          
          if (!persistentResult && enhancedResults.length === 0) {
            content = "No matching memories found.";
          } else {
            let formatted = "";
            if (persistentResult) {
              formatted += `📁 **Persistent Memory (Markdown)**:\n- ${query}: ${persistentResult}\n\n`;
            }
            if (enhancedResults.length > 0) {
              formatted += `🔍 **Enhanced Memory (Semantic)**:\n`;
              formatted += enhancedResults.map(r => {
                const date = new Date(r.createdAt).toLocaleDateString();
                return `- [${r.type}] ${r.content} (score: ${r.importance.toFixed(2)}, ${date})`;
              }).join('\n');
            }
            content = formatted;
          }
        } else {
          content = `Usage: /memory recall <query>`;
        }
        break;

      case "forget":
        if (args[1]) {
          const key = args[1];
          const scope = (args[2] as "project" | "user") || "project";
          
          const forgottenPersistent = await persistentMemory.forget(key, scope);
          
          // For backward compatibility, also try enhanced memory
          let forgottenEnhanced = 0;
          if (!forgottenPersistent) {
            const mems = await enhancedMemory.recall({ query: key, limit: 10 });
            for (const m of mems) {
              await enhancedMemory.forget(m.id);
              forgottenEnhanced++;
            }
          }

          if (forgottenPersistent) {
            content = `🗑️ Forgot "${key}" from persistent ${scope} memory.`;
          } else if (forgottenEnhanced > 0) {
            content = `🗑️ Forgot ${forgottenEnhanced} memories from enhanced memory matching "${key}".`;
          } else {
            content = `No memory found matching "${key}".`;
          }
        } else {
          content = `Usage: /memory forget <key> [project|user]`;
        }
        break;

      case "archived": {
        // The recoverable half of the Ebbinghaus forgetting pass.
        const scope = args[1] === "user" || args[1] === "project" ? (args[1] as "project" | "user") : undefined;
        const archived = await persistentMemory.listArchived(scope);
        if (archived.length === 0) {
          content = "Archive is empty — nothing has been forgotten" + (scope ? ` in ${scope} scope` : "") + ".";
        } else {
          const lines = archived.slice(0, 25).map((e) => {
            const when = e.forgottenAt.slice(0, 10);
            return `- **${e.key}** (${e.category}, ${e.scope}, forgotten ${when}): ${e.value.slice(0, 80)}${e.value.length > 80 ? "…" : ""}`;
          });
          content =
            `🗄️ ${archived.length} forgotten memor${archived.length > 1 ? "ies" : "y"}` +
            (scope ? ` (${scope})` : "") +
            `:\n${lines.join("\n")}` +
            (archived.length > 25 ? `\n… and ${archived.length - 25} more.` : "") +
            `\n\nRestore one: /memory restore <key> [project|user]`;
        }
        break;
      }

      case "restore": {
        if (!args[1]) {
          content = `Usage: /memory restore <key> [project|user]`;
          break;
        }
        const key = args[1];
        const scope = args[2] === "user" || args[2] === "project" ? (args[2] as "project" | "user") : undefined;
        const restored = await persistentMemory.restoreFromArchive(key, scope);
        if (!restored) {
          content = `No archived memory found for "${key}"${scope ? ` in ${scope} scope` : ""}. See /memory archived.`;
        } else if (restored.result.status === "stored" || restored.result.status === "updated") {
          content = `♻️ Restored "${key}" to ${restored.restored.scope} memory (was forgotten ${restored.restored.forgottenAt.slice(0, 10)}). The forgetting curve restarts fresh.`;
        } else {
          content = `"${key}" is already live in ${restored.restored.scope} memory (${restored.result.status}) — archive left untouched.`;
        }
        break;
      }

      case "remember":
      case "store":
        if (args.length >= 3) {
          const key = args[1];
          if (key === undefined) {
            content = `Usage: /memory remember <key> <content> [project|user]`;
            break;
          }
          const scope = (args[args.length - 1] === "user" || args[args.length - 1] === "project")
            ? args.pop() as "project" | "user"
            : "project";
          const value = args.slice(2).join(" ");

          // Store in both for redundancy and better retrieval
          const write = await persistentMemory.remember(key, value, { scope, category: "custom" });
          content = await describeRememberOutcome(write, key, scope, () => enhancedMemory.store({
            type: 'fact',
            content: `${key}: ${value}`,
            tags: [key, scope],
            importance: 0.8
          }));
        } else {
          content = `Usage: /memory remember <key> <content> [project|user]`;
        }
        break;

      case "replace":
      case "update":
        if (args.length >= 3) {
          const key = args[1];
          if (key === undefined) {
            content = `Usage: /memory replace <key> <content> [project|user]`;
            break;
          }
          const scope = (args[args.length - 1] === "user" || args[args.length - 1] === "project")
            ? args.pop() as "project" | "user"
            : "project";
          const value = args.slice(2).join(" ");

          const result = await persistentMemory.replace(key, value, { scope });
          if (result.status === 'missing') {
            content = result.message;
          } else {
            content = `✅ ${result.message}\nCapacity: ${result.usage.used}/${result.usage.limit} chars (${result.usage.percent}%).`;
          }
        } else {
          content = `Usage: /memory replace <key> <content> [project|user]`;
        }
        break;

      case "context":
        const enhancedContext = await enhancedMemory.buildContext({
          includeProject: true,
          includePreferences: true,
          includeRecentSummaries: true
        });
        const persistentContext = persistentMemory.getContextForPrompt();
        
        content = `🧠 **Current Context Injection**:\n\n` +
                 `📁 **Persistent**:\n${persistentContext || "(empty)"}\n\n` +
                 `🔍 **Enhanced**:\n${enhancedContext || "(empty)"}`;
        break;

      case "recent": {
        // Parse limit (default 10, clamped to [1, 50])
        const rawLimit = parseInt(args[1] ?? "10", 10);
        const limit = Math.min(50, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 10));
        const scopeArg = args[2] === "project" || args[2] === "user" ? args[2] : undefined;

        const recent = persistentMemory.getRecentMemories(limit, scopeArg);
        if (recent.length === 0) {
          content = `🧠 No memories yet.\n\nMemories appear here when:\n  • You save them via \`/memory remember <key> <value>\`\n  • The LLM auto-saves via the \`remember\` tool (active when memory is enabled)\n\nSee .codebuddy/CODEBUDDY_MEMORY.md once you have some.`;
        } else {
          const lines = [`🧠 Recent memories (showing ${recent.length})`, "═".repeat(50)];
          for (const m of recent) {
            const ago = formatTimeAgo(m.updatedAt);
            const valuePreview = m.value.length > 200 ? m.value.slice(0, 200) + "…" : m.value;
            lines.push(`[${m.scope}] ${m.key} (${m.category}) — ${ago}`);
            lines.push(`  ${valuePreview}`);
            lines.push("");
          }
          content = lines.join("\n").trimEnd();
        }
        break;
      }

      case "candidates":
      case "candidate":
      case "pending": {
        const { getMemoryCandidateQueue } = await import("../../memory/memory-candidate-queue.js");
        const statusArg = args[1];
        const status = statusArg === "pending" || statusArg === "accepted" || statusArg === "rejected"
          ? statusArg
          : undefined;
        const rawLimit = parseInt(args[status ? 2 : 1] ?? "20", 10);
        const limit = Math.min(50, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));
        const candidates = getMemoryCandidateQueue(context?.cwd ?? process.cwd(), context?.botId).list(status).slice(0, limit);

        if (candidates.length === 0) {
          content = status ? `No ${status} memory candidates.` : "No memory candidates yet.";
        } else {
          const lines = [`🧠 Memory candidates (${candidates.length}${status ? ` ${status}` : ""})`, "═".repeat(50)];
          for (const candidate of candidates) {
            const created = formatTimeAgo(new Date(candidate.createdAt));
            const confidence = typeof candidate.confidence === "number"
              ? ` | confidence ${(candidate.confidence * 100).toFixed(0)}%`
              : "";
            lines.push(`[${candidate.status}] ${candidate.id} | ${candidate.scope}/${candidate.category}${confidence} | ${created}`);
            lines.push(`  ${candidate.key}: ${clip(candidate.value)}`);
            const citation = candidate.citations?.[0];
            if (citation) {
              const label = citation.sessionId
                ? `${citation.sessionId}${citation.messageId ? `#${citation.messageId}` : citation.messageIndex ? `#${citation.messageIndex}` : ""}`
                : citation.messageIndex ? `message ${citation.messageIndex}` : "evidence";
              lines.push(`  citation: ${label}${citation.role ? ` (${citation.role})` : ""} — ${clip(citation.snippet, 140)}`);
            }
            lines.push("");
          }
          lines.push("Approve: /memory accept <id> [reviewer]");
          lines.push("Reject:  /memory reject <id> [reason]");
          content = lines.join("\n").trimEnd();
        }
        break;
      }

      case "accept":
      case "approve": {
        const id = args[1];
        if (!id) {
          content = `Usage: /memory accept <candidate-id> [reviewer]`;
          break;
        }
        const reviewedBy = args.slice(2).join(" ").trim() || "user";
        const { getMemoryCandidateQueue } = await import("../../memory/memory-candidate-queue.js");
        const { candidate, write } = await getMemoryCandidateQueue(context?.cwd ?? process.cwd(), context?.botId).accept(id, { reviewedBy });
        content = `✅ Accepted ${candidate.id} into ${candidate.scope} memory as "${candidate.key}".\n` +
          `Write status: ${write.status}. Capacity: ${write.usage.used}/${write.usage.limit} chars (${write.usage.percent}%).`;
        break;
      }

      case "reject":
      case "discard": {
        const id = args[1];
        if (!id) {
          content = `Usage: /memory reject <candidate-id> [reason]`;
          break;
        }
        const reason = args.slice(2).join(" ").trim();
        const { getMemoryCandidateQueue } = await import("../../memory/memory-candidate-queue.js");
        const candidate = getMemoryCandidateQueue(context?.cwd ?? process.cwd(), context?.botId).reject(id, {
          reviewedBy: "user",
          ...(reason ? { reason } : {}),
        });
        content = `🗑️ Rejected memory candidate ${candidate.id}.`;
        break;
      }

      case "status":
      case "list":
      default:
        content = persistentMemory.formatMemories();
        break;
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
        timestamp: new Date(),
      },
      message: content
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
 * Remember - Quick memory store using PersistentMemoryManager and EnhancedMemory
 */
export async function handleRemember(args: string[], context?: MemoryCommandContext): Promise<CommandHandlerResult> {
  if (args.length < 2) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `Usage: /remember <key> <value> [project|user]`,
        timestamp: new Date(),
      },
    };
  }

  const key = args[0];
  if (key === undefined) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `Usage: /remember <key> <value> [project|user]`,
        timestamp: new Date(),
      },
    };
  }
  const scope = (args[args.length - 1] === "user" || args[args.length - 1] === "project")
    ? args.pop() as "project" | "user"
    : "project";
  const value = args.slice(1).join(" ");

  try {
    const persistentMemory = getMemoryManager(undefined, context?.botId, context?.cwd);
    const enhancedMemory = getEnhancedMemory();

    await persistentMemory.initialize();
    const write = await persistentMemory.remember(key, value, { scope, category: "custom" });
    const content = await describeRememberOutcome(write, key, scope, () => enhancedMemory.store({
      type: 'fact',
      content: `${key}: ${value}`,
      tags: [key, scope],
      importance: 0.8
    }));

    return {
      handled: true,
      entry: {
        type: "assistant",
        content,
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
  const index = parseInt(args[0] ?? "", 10);

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
  if (comment === undefined) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `❌ Invalid index. Available: 1-${comments.length}`,
        timestamp: new Date(),
      },
    };
  }
  const prompt = commentWatcher.generatePromptForComment(comment);

  return {
    handled: true,
    passToAI: true,
    prompt,
  };
}
