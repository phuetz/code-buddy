import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text, DOMElement } from "ink";
import type { CodeBuddyAgent, ChatEntry } from "../../agent/codebuddy-agent.js";
import { useInputHandler } from "../../hooks/use-input-handler.js";
import { StatusBlock } from "./StatusBlock.js";
import { CommandSuggestions } from "./CommandSuggestions.js";
import { FileAutocomplete } from "./FileAutocomplete.js";
import { ModelSelection } from "./ModelSelection.js";
import { ChatHistory } from "./ChatHistory.js";
import { TabbedQuestion } from "./TabbedQuestion.js";
import { ChatInput } from "./ChatInput.js";
import { MCPStatus } from "./McpStatus.js";
import ConfirmationDialog from "./ConfirmationDialog.js";
import {
  ConfirmationService,
  ConfirmationOptions,
} from "../../utils/confirmation-service.js";
import ApiKeyInput from "./ApiKeyInput.js";
import { ThemeProvider, useTheme } from "../context/theme-context.js";
import { getErrorMessage } from "../../types/index.js";
import { MiniStatusBar } from "./StatusBar.js";
import { KeyboardHelp, useKeyboardHelp } from "./KeyboardHelp.js";
import { ToastProvider } from "./ToastNotifications.js";
import { getTTSManager } from "../../input/text-to-speech.js";
import {
  announceToScreenReader,
  useAccessibilitySettings,
  useKeyboardShortcuts,
} from "../utils/accessibility.js";

interface ChatInterfaceProps {
  agent?: CodeBuddyAgent;
  initialMessage?: string;
  /** History of a resumed session, shown before the first new turn. */
  initialHistory?: ChatEntry[];
}

// Main chat component that handles input when agent is available
function ChatInterfaceWithAgent({
  agent,
  initialMessage,
  initialHistory,
}: {
  agent: CodeBuddyAgent;
  initialMessage?: string;
  initialHistory?: ChatEntry[];
}) {
  const { colors } = useTheme();
  const { settings } = useAccessibilitySettings();
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>(() => initialHistory ?? []);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingTime, setProcessingTime] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentActivity, setCurrentActivity] = useState<string>('');
  const [confirmationOptions, setConfirmationOptions] =
    useState<ConfirmationOptions | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<{
    question: string;
    options: string[];
    resolve: (answer: string) => void;
  } | null>(null);
  const [_sessionStartTime] = useState(new Date());
  const scrollRef = useRef<DOMElement>(null);
  const processingStartTime = useRef<number>(0);

  const confirmationService = ConfirmationService.getInstance();
  const keyboardHelp = useKeyboardHelp();

  // Help overlay now triggered via /help command (? removed — it interfered with typing)

  // Keyboard shortcuts with accessibility support
  useKeyboardShortcuts([
    {
      keys: ['ctrl', 'h'],
      description: 'Show help',
      handler: () => {
        // This would trigger help display
        announceToScreenReader('Opening help', 'polite');
      },
      enabled: !confirmationOptions && !isProcessing,
    },
    {
      keys: ['ctrl', '/'],
      description: 'Toggle accessibility settings',
      handler: () => {
        announceToScreenReader('Accessibility settings', 'polite');
      },
      enabled: !confirmationOptions,
    },
  ]);

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
      const target = prev[index];
      if (index !== -1 && target) {
        const updated = [...prev];
        updated[index] = { ...target, ...updates };
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
    showFileAutocomplete,
    selectedFileIndex,
    fileSuggestions,
    commandSuggestions,
    availableModels,
    autoEditEnabled,
    queuedMessageCount,
    handleInputSubmit,
  } = useInputHandler({
    agent,
    chatHistory,
    setChatHistory,
    setIsProcessing,
    setIsStreaming,
    setTokenCount,
    setProcessingTime,
    setCurrentActivity,
    processingStartTime,
    isProcessing,
    isStreaming,
    isConfirmationActive: !!confirmationOptions || !!pendingQuestion || keyboardHelp.isVisible,
    appendStreamingContent,
    finalizeStreamingEntry,
    updateToolCallEntry,
  });

  useEffect(() => {
    // Announce to screen readers
    if (settings.screenReader) {
      announceToScreenReader(
        'Code Buddy started. Chat interface ready. Type /help for commands.',
        'polite'
      );
    }
  }, [settings.screenReader]);

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
        setCurrentActivity('Sending to LLM...');

        try {
          let streamingEntry: ChatEntry | null = null;
          for await (const chunk of agent.processUserMessageStream(initialMessage, {
            surface: 'cli',
          })) {
            switch (chunk.type) {
              case "reasoning":
                setCurrentActivity('Reasoning...');
                if (chunk.reasoning) {
                  // Handle reasoning/thinking content
                  setChatHistory((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.type === 'reasoning' && last.isStreaming) {
                      const updated = [...prev];
                      updated[prev.length - 1] = { ...last, content: last.content + chunk.reasoning };
                      return updated;
                    }
                    return [...prev, {
                      type: 'reasoning' as const,
                      content: chunk.reasoning!,
                      timestamp: new Date(),
                      isStreaming: true,
                    }];
                  });
                }
                break;
              case "content":
                setCurrentActivity('Generating response...');
                if (chunk.content) {
                  // Finalize any streaming reasoning entry
                  setChatHistory((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.type === 'reasoning' && last.isStreaming) {
                      const updated = [...prev];
                      updated[prev.length - 1] = { ...last, isStreaming: false };
                      return updated;
                    }
                    return prev;
                  });

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
                  const toolNames = chunk.toolCalls.map((tc: any) => tc.function?.name || 'tool').join(', ');
                  setCurrentActivity(`Executing: ${toolNames}`);
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
              case "tool_stream":
                if (chunk.toolStreamData) {
                  const { toolCallId, toolName, delta } = chunk.toolStreamData;
                  // Update the tool_call entry with streaming output
                  setChatHistory((prev) => {
                    const idx = prev.findIndex(
                      (e) => e.type === 'tool_call' && e.toolCall?.id === toolCallId
                    );
                    const existing = idx !== -1 ? prev[idx] : undefined;
                    if (existing) {
                      const updated = [...prev];
                      updated[idx] = {
                        ...existing,
                        content: (existing.content === 'Executing...' ? '' : existing.content) + delta,
                        isStreaming: true,
                      };
                      return updated;
                    }
                    return prev;
                  });
                }
                break;
              case "tool_result":
                setCurrentActivity('Processing tool results...');
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
              case "plan_progress":
                if (chunk.planProgress) {
                  const { taskId, status, total, completed, message } = chunk.planProgress;
                  const progressText = message || `Task ${taskId}: ${status} (${completed}/${total})`;
                  setChatHistory((prev) => [...prev, {
                    type: 'plan_progress' as const,
                    content: progressText,
                    timestamp: new Date(),
                  }]);
                }
                break;
              case "steer":
                if (chunk.steer) {
                  setChatHistory((prev) => [...prev, {
                    type: 'user' as const,
                    content: `[${chunk.steer!.source}] ${chunk.steer!.content}`,
                    timestamp: new Date(),
                  }]);
                }
                break;
              case "ask_user":
                if (chunk.askUser) {
                  // Add question entry to chat history
                  setChatHistory((prev) => [...prev, {
                    type: 'assistant' as const,
                    content: chunk.askUser!.question,
                    timestamp: new Date(),
                  }]);
                  // Show tabbed question UI (the streaming loop will wait for resolution)
                  const answer = await new Promise<string>((resolve) => {
                    setPendingQuestion({
                      question: chunk.askUser!.question,
                      options: chunk.askUser!.options,
                      resolve,
                    });
                  });
                  // Add user's answer to history
                  setChatHistory((prev) => [...prev, {
                    type: 'user' as const,
                    content: answer,
                    timestamp: new Date(),
                  }]);
                  setPendingQuestion(null);

                  // Auto-submit the answer so the agent continues
                  setTimeout(() => handleInputSubmit(answer), 50);
                }
                break;              case "done":
                setCurrentActivity('');
                if (streamingEntry) {
                  finalizeStreamingEntry();
                }
                setIsStreaming(false);

                // Auto-speak the response if TTS autoSpeak is enabled
                try {
                  const ttsManager = getTTSManager();
                  if (ttsManager.getConfig().autoSpeak) {
                    // Get the accumulated response content from the last assistant entry
                    setChatHistory((prev) => {
                      const lastAssistant = [...prev].reverse().find(e => e.type === 'assistant');
                      if (lastAssistant?.content?.trim()) {
                        const textToSpeak = lastAssistant.content
                          .replace(/```[\s\S]*?```/g, '')
                          .replace(/`[^`]+`/g, '')
                          .replace(/\*\*([^*]+)\*\*/g, '$1')
                          .replace(/\*([^*]+)\*/g, '$1')
                          .replace(/#+\s/g, '')
                          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                          .replace(/\n+/g, '. ')
                          .trim();
                        if (textToSpeak) {
                          ttsManager.speak(textToSpeak).catch(() => {});
                        }
                      }
                      return prev; // No mutation
                    });
                  }
                } catch (_error) {
                  // TTS not available — ignore
                }
                break;
            }
          }
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          const errorEntry: ChatEntry = {
            type: "assistant",
            content: `Error: ${errorMessage}`,
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, errorEntry]);
          setIsStreaming(false);

          // Announce errors to screen readers
          if (settings.screenReader) {
            announceToScreenReader(`Error occurred: ${errorMessage}`, 'assertive');
          }
        }

        await agent.persistInteractiveSession();
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

    // Announce to screen readers
    if (settings.screenReader) {
      announceToScreenReader('Operation confirmed', 'polite');
    }
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

    // Announce to screen readers
    if (settings.screenReader) {
      announceToScreenReader('Operation cancelled', 'polite');
    }
  };

  return (
    <Box flexDirection="column" paddingX={2}>
      {chatHistory.length === 0 && !confirmationOptions && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={colors.primary}>Code Buddy</Text>
          <Text color={colors.textMuted} wrap="truncate-middle">{process.cwd()}</Text>
          <Text color={colors.textMuted}>Ask a question or describe a change. /help commands · /model choose a model</Text>
        </Box>
      )}

      <Box flexDirection="column" ref={scrollRef}>
        <ChatHistory
          entries={chatHistory}
          isConfirmationActive={!!confirmationOptions}
        />
      </Box>

      {/* Show tabbed question if one is pending */}
      {pendingQuestion && (
        <TabbedQuestion
          question={pendingQuestion.question}
          options={pendingQuestion.options}
          onAnswer={(answer) => {
            pendingQuestion.resolve(answer);
          }}
        />
      )}

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

      {!confirmationOptions && !pendingQuestion && !keyboardHelp.isVisible && (
        <>
          <StatusBlock
            isActive={isProcessing || isStreaming}
            processingTime={processingTime}
            tokenCount={tokenCount}
            activity={currentActivity}
          />

          {queuedMessageCount > 0 && <Text color={colors.info}>{queuedMessageCount} message(s) queued · sent after the current reply</Text>}
          <ChatInput
            input={input}
            cursorPosition={cursorPosition}
            isProcessing={isProcessing}
            isStreaming={isStreaming}
            mode={agent.getMode()}
          />

          <Text color={colors.textMuted} dimColor>
            {isProcessing || isStreaming ? 'Enter queue' : 'Enter send'} · Ctrl+J newline · Esc cancel · Ctrl+C quit
          </Text>

          <Box flexDirection="row" flexWrap="wrap" marginTop={1} justifyContent="space-between">
            <Box flexDirection="row" flexWrap="wrap">
              <Box marginRight={2}>
                <Text color={colors.primary}>
                  {autoEditEnabled ? "Edits: automatic" : "Edits: ask first"}
                </Text>
                <Text color={colors.textMuted} dimColor>
                  {" "}
                  (shift + tab)
                </Text>
              </Box>
              <MCPStatus />
            </Box>
            <Box>
              <MiniStatusBar
                tokenCount={tokenCount}
                modelName={agent.getCurrentModel()}
                providerName={agent.getClient().getProviderName()}
                mode={agent.getMode()}
                yolo={agent.isYoloModeEnabled()}
              />
            </Box>
          </Box>

          <CommandSuggestions
            suggestions={commandSuggestions}
            input={input}
            selectedIndex={selectedCommandIndex}
            isVisible={showCommandSuggestions}
          />

          <FileAutocomplete
            input={input}
            visible={showFileAutocomplete}
            selectedIndex={selectedFileIndex}
            suggestions={fileSuggestions}
          />

          <ModelSelection
            models={availableModels}
            selectedIndex={selectedModelIndex}
            isVisible={showModelSelection}
            currentModel={agent.getCurrentModel()}
          />
        </>
      )}

      {/* Keyboard Help Overlay - Toggle with ? */}
      <KeyboardHelp
        isVisible={keyboardHelp.isVisible}
        onClose={keyboardHelp.hide}
      />
    </Box>
  );
}

// Inner component that handles API key input or chat interface
function ChatInterfaceInner({
  agent,
  initialMessage,
  initialHistory,
}: ChatInterfaceProps) {
  const [currentAgent, setCurrentAgent] = useState<CodeBuddyAgent | null>(
    agent || null
  );

  const handleApiKeySet = (newAgent: CodeBuddyAgent) => {
    setCurrentAgent(newAgent);
  };

  if (!currentAgent) {
    return <ApiKeyInput onApiKeySet={handleApiKeySet} />;
  }

  return (
    <ChatInterfaceWithAgent
      agent={currentAgent}
      initialMessage={initialMessage}
      initialHistory={initialHistory}
    />
  );
}

// Main component wrapped with ThemeProvider and ToastProvider
export default function ChatInterface({
  agent,
  initialMessage,
  initialHistory,
}: ChatInterfaceProps) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ChatInterfaceInner agent={agent} initialMessage={initialMessage} initialHistory={initialHistory} />
      </ToastProvider>
    </ThemeProvider>
  );
}
