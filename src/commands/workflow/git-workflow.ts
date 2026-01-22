import { CodeBuddyAgent, ChatEntry } from "../../agent/codebuddy-agent.js";
import { getErrorMessage } from "../../types/index.js";

export interface GitWorkflowContext {
  agent: CodeBuddyAgent;
  setChatHistory: React.Dispatch<React.SetStateAction<ChatEntry[]>>;
  setIsProcessing: (processing: boolean) => void;
  setIsStreaming: (streaming: boolean) => void;
  setInput: (input: string) => void;
}

export class GitWorkflowHandler {
  static async handleCommitAndPush(context: GitWorkflowContext): Promise<void> {
    const { agent, setChatHistory, setIsProcessing, setIsStreaming, setInput } = context;

    const userEntry: ChatEntry = {
      type: "user",
      content: "/commit-and-push",
      timestamp: new Date(),
    };
    setChatHistory((prev) => [...prev, userEntry]);

    setIsProcessing(true);
    setIsStreaming(true);

    try {
      // First check if there are any changes at all
      const initialStatusResult = await agent.executeBashCommand(
        "git status --porcelain"
      );

      if (
        !initialStatusResult.success ||
        !initialStatusResult.output?.trim()
      ) {
        const noChangesEntry: ChatEntry = {
          type: "assistant",
          content: "No changes to commit. Working directory is clean.",
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, noChangesEntry]);
        setIsProcessing(false);
        setIsStreaming(false);
        setInput("");
        return;
      }

      // Add all changes
      const addResult = await agent.executeBashCommand("git add .");

      if (!addResult.success) {
        const addErrorEntry: ChatEntry = {
          type: "assistant",
          content: `Failed to stage changes: ${ addResult.error || "Unknown error" }`,
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, addErrorEntry]);
        setIsProcessing(false);
        setIsStreaming(false);
        setInput("");
        return;
      }

      // Show that changes were staged
      const addEntry: ChatEntry = {
        type: "tool_result",
        content: "Changes staged successfully",
        timestamp: new Date(),
        toolCall: {
          id: `git_add_${Date.now()}`,
          type: "function",
          function: {
            name: "bash",
            arguments: JSON.stringify({ command: "git add ." }),
          },
        },
        toolResult: addResult,
      };
      setChatHistory((prev) => [...prev, addEntry]);

      // Get staged changes for commit message generation
      const diffResult = await agent.executeBashCommand("git diff --cached");

      // Generate commit message using AI
      const commitPrompt = `Generate a concise, professional git commit message for these changes:

Git Status:
${initialStatusResult.output}

Git Diff (staged changes):
${diffResult.output || "No staged changes shown"}

Follow conventional commit format (feat:, fix:, docs:, etc.) and keep it under 72 characters.
Respond with ONLY the commit message, no additional text.`;

      let commitMessage = "";
      let streamingEntry: ChatEntry | null = null;

      for await (const chunk of agent.processUserMessageStream(
        commitPrompt
      )) {
        if (chunk.type === "content" && chunk.content) {
          if (!streamingEntry) {
            const newEntry = {
              type: "assistant" as const,
              content: `Generating commit message...\n\n${chunk.content}`,
              timestamp: new Date(),
              isStreaming: true,
            };
            setChatHistory((prev) => [...prev, newEntry]);
            streamingEntry = newEntry;
            commitMessage = chunk.content;
          } else {
            commitMessage += chunk.content;
            setChatHistory((prev) =>
              prev.map((entry, idx) =>
                idx === prev.length - 1 && entry.isStreaming
                  ? {
                      ...entry,
                      content: `Generating commit message...\n\n${commitMessage}`,
                    }
                  : entry
              )
            );
          }
        } else if (chunk.type === "done") {
          if (streamingEntry) {
            setChatHistory((prev) =>
              prev.map((entry) =>
                entry.isStreaming
                  ? {
                      ...entry,
                      content: `Generated commit message: "${commitMessage.trim()}"`, 
                      isStreaming: false,
                    }
                  : entry
              )
            );
          }
          break;
        }
      }

      // Execute the commit
      const cleanCommitMessage = commitMessage
        .trim()
        .replace(/^["']|["']$/g, "");
      const commitCommand = `git commit -m "${cleanCommitMessage}"`;
      const commitResult = await agent.executeBashCommand(commitCommand);

      const commitEntry: ChatEntry = {
        type: "tool_result",
        content: commitResult.success
          ? commitResult.output || "Commit successful"
          : commitResult.error || "Commit failed",
        timestamp: new Date(),
        toolCall: {
          id: `git_commit_${Date.now()}`,
          type: "function",
          function: {
            name: "bash",
            arguments: JSON.stringify({ command: commitCommand }),
          },
        },
        toolResult: commitResult,
      };
      setChatHistory((prev) => [...prev, commitEntry]);

      // If commit was successful, push to remote
      if (commitResult.success) {
        // First try regular push, if it fails try with upstream setup
        let pushResult = await agent.executeBashCommand("git push");
        let pushCommand = "git push";

        if (
          !pushResult.success &&
          pushResult.error?.includes("no upstream branch")
        ) {
          pushCommand = "git push -u origin HEAD";
          pushResult = await agent.executeBashCommand(pushCommand);
        }

        const pushEntry: ChatEntry = {
          type: "tool_result",
          content: pushResult.success
            ? pushResult.output || "Push successful"
            : pushResult.error || "Push failed",
          timestamp: new Date(),
          toolCall: {
            id: `git_push_${Date.now()}`,
            type: "function",
            function: {
              name: "bash",
              arguments: JSON.stringify({ command: pushCommand }),
            },
          },
          toolResult: pushResult,
        };
        setChatHistory((prev) => [...prev, pushEntry]);
      }
    } catch (error) {
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Error during commit and push: ${getErrorMessage(error)}`,
        timestamp: new Date(),
      };
      setChatHistory((prev) => [...prev, errorEntry]);
    }

    setIsProcessing(false);
    setIsStreaming(false);
    setInput("");
  }
}
