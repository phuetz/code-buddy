import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text } from "ink";
import { GrokAgent, ChatEntry } from "../../agent/grok-agent.js";
import { useInputHandler } from "../../hooks/use-input-handler.js";
import { LoadingSpinner } from "./loading-spinner.js";
import { CommandSuggestions } from "./command-suggestions.js";
import { ModelSelection } from "./model-selection.js";
import { ChatHistory } from "./chat-history.js";
import { ChatInput } from "./chat-input.js";
import { MCPStatus } from "./mcp-status.js";
import ConfirmationDialog from "./confirmation-dialog.js";
import {
  ConfirmationService,
  ConfirmationOptions,
} from "../../utils/confirmation-service.js";
import ApiKeyInput from "./api-key-input.js";
import { renderColorBanner } from "../../utils/ascii-banner.js";
import { ThemeProvider, useTheme } from "../context/theme-context.js";

interface ChatInterfaceProps {
  agent?: GrokAgent;
  initialMessage?: string;
}

// Main chat component that handles input when agent is available
function ChatInterfaceWithAgent({
  agent,
  initialMessage,
}: {
  agent: GrokAgent;
  initialMessage?: string;
}) {
  const { colors, theme } = useTheme();
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingTime, setProcessingTime] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [confirmationOptions, setConfirmationOptions] =
    useState<ConfirmationOptions | null>(null);
  const scrollRef = useRef<any>();
  const processingStartTime = useRef<number>(0);

  const confirmationService = ConfirmationService.getInstance();

  // Optimized update functions to avoid O(n²) array spreading on each streaming chunk
  // These use indexed updates instead of mapping the entire array
  const appendStreamingContent = useCallback((content: string) => {
    setChatHistory((prev) => {
      const lastIndex = prev.length - 1;
      const lastEntry = prev[lastIndex];
      if (lastEntry?.isStreaming) {
        // Create new array with only the last element changed
        const updated = [...prev];
        updated[lastIndex] = { ...lastEntry, content: lastEntry.content + content };
        return updated;
      }
      return prev;
    });
  }, []);

  const finalizeStreamingEntry = useCallback((updates?: Partial<ChatEntry>) => {
    setChatHistory((prev) => {
      const lastIndex = prev.length - 1;
      const lastEntry = prev[lastIndex];
      if (lastEntry?.isStreaming) {
        const updated = [...prev];
        updated[lastIndex] = { ...lastEntry, isStreaming: false, ...updates };
        return updated;
      }
      return prev;
    });
  }, []);

  const updateToolCallEntry = useCallback((toolCallId: string, updates: Partial<ChatEntry>) => {
    setChatHistory((prev) => {
      const index = prev.findIndex(
        (entry) => entry.type === "tool_call" && entry.toolCall?.id === toolCallId
      );
      if (index !== -1) {
        const updated = [...prev];
        updated[index] = { ...prev[index], ...updates };
        return updated;
      }
      return prev;
    });
  }, []);

  const {
    input,
    cursorPosition,
    showCommandSuggestions,
    selectedCommandIndex,
    showModelSelection,
    selectedModelIndex,
    commandSuggestions,
    availableModels,
    autoEditEnabled,
  } = useInputHandler({
    agent,
    chatHistory,
    setChatHistory,
    setIsProcessing,
    setIsStreaming,
    setTokenCount,
    setProcessingTime,
    processingStartTime,
    isProcessing,
    isStreaming,
    isConfirmationActive: !!confirmationOptions,
  });

  useEffect(() => {
    // Only clear console on non-Windows platforms or if not PowerShell
    // Windows PowerShell can have issues with console.clear() causing flickering
    const isWindows = process.platform === "win32";
    const isPowerShell =
      process.env.ComSpec?.toLowerCase().includes("powershell") ||
      process.env.PSModulePath !== undefined;

    if (!isWindows || !isPowerShell) {
      console.clear();
    }

    // Add top padding
    console.log("    ");

    // Generate logo with MIT-licensed ascii-banner (replaces GPL cfonts)
    const logoOutput = renderColorBanner("GROK", ["magenta", "cyan"]);

    // Add horizontal margin (2 spaces) to match Ink paddingX={2}
    const logoLines = logoOutput.split("\n");
    logoLines.forEach((line: string) => {
      if (line.trim()) {
        console.log(" " + line); // Add 2 spaces for horizontal margin
      } else {
        console.log(line); // Keep empty lines as-is
      }
    });

    console.log(" "); // Spacing after logo

    setChatHistory([]);
  }, []);

  // Process initial message if provided (streaming for faster feedback)
  useEffect(() => {
    if (initialMessage && agent) {
      const userEntry: ChatEntry = {
        type: "user",
        content: initialMessage,
        timestamp: new Date(),
      };
      setChatHistory([userEntry]);

      const processInitialMessage = async () => {
        setIsProcessing(true);
        setIsStreaming(true);

        try {
          let streamingEntry: ChatEntry | null = null;
          for await (const chunk of agent.processUserMessageStream(initialMessage)) {
            switch (chunk.type) {
              case "content":
                if (chunk.content) {
                  if (!streamingEntry) {
                    // First chunk - add new streaming entry
                    const newStreamingEntry = {
                      type: "assistant" as const,
                      content: chunk.content,
                      timestamp: new Date(),
                      isStreaming: true,
                    };
                    setChatHistory((prev) => [...prev, newStreamingEntry]);
                    streamingEntry = newStreamingEntry;
                  } else {
                    // Subsequent chunks - use optimized append (avoids O(n²) mapping)
                    appendStreamingContent(chunk.content);
                  }
                }
                break;
              case "token_count":
                if (chunk.tokenCount !== undefined) {
                  setTokenCount(chunk.tokenCount);
                }
                break;
              case "tool_calls":
                if (chunk.toolCalls) {
                  // Finalize streaming entry with tool calls
                  finalizeStreamingEntry({ toolCalls: chunk.toolCalls });
                  streamingEntry = null;

                  // Add individual tool call entries to show tools are being executed
                  const toolCallEntries = chunk.toolCalls.map((toolCall) => ({
                    type: "tool_call" as const,
                    content: "Executing...",
                    timestamp: new Date(),
                    toolCall: toolCall,
                  }));
                  setChatHistory((prev) => [...prev, ...toolCallEntries]);
                }
                break;
              case "tool_result":
                if (chunk.toolCall && chunk.toolResult) {
                  // Finalize any streaming entry
                  finalizeStreamingEntry();

                  // Update the specific tool call entry using optimized update
                  updateToolCallEntry(chunk.toolCall.id, {
                    type: "tool_result",
                    content: chunk.toolResult?.success
                      ? chunk.toolResult?.output || "Success"
                      : chunk.toolResult?.error || "Error occurred",
                    toolResult: chunk.toolResult,
                  });
                  streamingEntry = null;
                }
                break;
              case "done":
                if (streamingEntry) {
                  finalizeStreamingEntry();
                }
                setIsStreaming(false);
                break;
            }
          }
        } catch (error: any) {
          const errorEntry: ChatEntry = {
            type: "assistant",
            content: `Error: ${error.message}`,
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, errorEntry]);
          setIsStreaming(false);
        }

        setIsProcessing(false);
        processingStartTime.current = 0;
      };

      processInitialMessage();
    }
  }, [initialMessage, agent]);

  useEffect(() => {
    const handleConfirmationRequest = (options: ConfirmationOptions) => {
      setConfirmationOptions(options);
    };

    confirmationService.on("confirmation-requested", handleConfirmationRequest);

    return () => {
      confirmationService.off(
        "confirmation-requested",
        handleConfirmationRequest
      );
    };
  }, [confirmationService]);

  useEffect(() => {
    if (!isProcessing && !isStreaming) {
      setProcessingTime(0);
      return;
    }

    if (processingStartTime.current === 0) {
      processingStartTime.current = Date.now();
    }

    const interval = setInterval(() => {
      setProcessingTime(
        Math.floor((Date.now() - processingStartTime.current) / 1000)
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [isProcessing, isStreaming]);

  const handleConfirmation = (dontAskAgain?: boolean) => {
    confirmationService.confirmOperation(true, dontAskAgain);
    setConfirmationOptions(null);
  };

  const handleRejection = (feedback?: string) => {
    confirmationService.rejectOperation(feedback);
    setConfirmationOptions(null);

    // Reset processing states when operation is cancelled
    setIsProcessing(false);
    setIsStreaming(false);
    setTokenCount(0);
    setProcessingTime(0);
    processingStartTime.current = 0;
  };

  return (
    <Box flexDirection="column" paddingX={2}>
      {/* Show tips only when no chat history and no confirmation dialog */}
      {chatHistory.length === 0 && !confirmationOptions && (
        <Box flexDirection="column" marginBottom={2}>
          <Text color={colors.primary} bold>
            Tips for getting started:
          </Text>
          <Box marginTop={1} flexDirection="column">
            <Text color={colors.textMuted}>
              1. Ask questions, edit files, or run commands.
            </Text>
            <Text color={colors.textMuted}>2. Be specific for the best results.</Text>
            <Text color={colors.textMuted}>
              3. Create GROK.md files to customize your interactions with Grok.
            </Text>
            <Text color={colors.textMuted}>
              4. Press Shift+Tab to toggle auto-edit mode.
            </Text>
            <Text color={colors.textMuted}>5. /help for more information.</Text>
            <Text color={colors.textMuted}>6. /theme to change the theme, /avatar to change avatars.</Text>
          </Box>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text color={colors.textMuted}>
          Type your request in natural language. Ctrl+C to clear, 'exit' to
          quit.
        </Text>
      </Box>

      <Box flexDirection="column" ref={scrollRef}>
        <ChatHistory
          entries={chatHistory}
          isConfirmationActive={!!confirmationOptions}
        />
      </Box>

      {/* Show confirmation dialog if one is pending */}
      {confirmationOptions && (
        <ConfirmationDialog
          operation={confirmationOptions.operation}
          filename={confirmationOptions.filename}
          showVSCodeOpen={confirmationOptions.showVSCodeOpen}
          content={confirmationOptions.content}
          onConfirm={handleConfirmation}
          onReject={handleRejection}
        />
      )}

      {!confirmationOptions && (
        <>
          <LoadingSpinner
            isActive={isProcessing || isStreaming}
            processingTime={processingTime}
            tokenCount={tokenCount}
          />

          <ChatInput
            input={input}
            cursorPosition={cursorPosition}
            isProcessing={isProcessing}
            isStreaming={isStreaming}
          />

          <Box flexDirection="row" marginTop={1}>
            <Box marginRight={2}>
              <Text color={colors.primary}>
                {autoEditEnabled ? "▶" : "⏸"} auto-edit:{" "}
                {autoEditEnabled ? "on" : "off"}
              </Text>
              <Text color={colors.textMuted} dimColor>
                {" "}
                (shift + tab)
              </Text>
            </Box>
            <Box marginRight={2}>
              <Text color={colors.accent}>≋ {agent.getCurrentModel()}</Text>
            </Box>
            <Box marginRight={2}>
              <Text color={colors.secondary}>◐ {theme.name}</Text>
            </Box>
            <MCPStatus />
          </Box>

          <CommandSuggestions
            suggestions={commandSuggestions}
            input={input}
            selectedIndex={selectedCommandIndex}
            isVisible={showCommandSuggestions}
          />

          <ModelSelection
            models={availableModels}
            selectedIndex={selectedModelIndex}
            isVisible={showModelSelection}
            currentModel={agent.getCurrentModel()}
          />
        </>
      )}
    </Box>
  );
}

// Inner component that handles API key input or chat interface
function ChatInterfaceInner({
  agent,
  initialMessage,
}: ChatInterfaceProps) {
  const [currentAgent, setCurrentAgent] = useState<GrokAgent | null>(
    agent || null
  );

  const handleApiKeySet = (newAgent: GrokAgent) => {
    setCurrentAgent(newAgent);
  };

  if (!currentAgent) {
    return <ApiKeyInput onApiKeySet={handleApiKeySet} />;
  }

  return (
    <ChatInterfaceWithAgent
      agent={currentAgent}
      initialMessage={initialMessage}
    />
  );
}

// Main component wrapped with ThemeProvider
export default function ChatInterface({
  agent,
  initialMessage,
}: ChatInterfaceProps) {
  return (
    <ThemeProvider>
      <ChatInterfaceInner agent={agent} initialMessage={initialMessage} />
    </ThemeProvider>
  );
}
