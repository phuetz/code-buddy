import { useState, useMemo, useEffect, useRef } from "react";
import { useInput } from "ink";
import { promises as fsPromises } from "fs";
import path from "path";
import * as yaml from 'js-yaml';
import { CodeBuddyAgent, ChatEntry } from "../agent/codebuddy-agent.js";
import { ConfirmationService } from "../utils/confirmation-service.js";
import { useEnhancedInput, Key } from "./use-enhanced-input.js";
import { getErrorMessage } from "../types/index.js";

import { filterCommandSuggestions } from "../ui/components/CommandSuggestions.js";
import { loadModelConfig } from "../utils/model-config.js";

// Import enhanced features
import { getSlashCommandManager } from "../commands/slash-commands.js";
import { getTTSManager } from "../input/text-to-speech.js";
import { ClientCommandDispatcher, ClientCommandContext } from "../commands/client-dispatcher.js";

// Import file autocomplete
import { extractFileReference, getFileSuggestions, FileSuggestion } from "../ui/components/FileAutocomplete.js";

// Import history manager for persistent command history
import { getHistoryManager } from "../utils/history-manager.js";

interface UseInputHandlerProps {
  agent: CodeBuddyAgent;
  chatHistory: ChatEntry[];
  setChatHistory: React.Dispatch<React.SetStateAction<ChatEntry[]>>;
  setIsProcessing: (processing: boolean) => void;
  setIsStreaming: (streaming: boolean) => void;
  setTokenCount: (count: number) => void;
  setProcessingTime: (time: number) => void;
  processingStartTime: React.MutableRefObject<number>;
  isProcessing: boolean;
  isStreaming: boolean;
  isConfirmationActive?: boolean;
}

interface CommandSuggestion {
  command: string;
  description: string;
}

interface ModelOption {
  model: string;
}

export function useInputHandler({
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
  isConfirmationActive = false,
}: UseInputHandlerProps) {
  const [showCommandSuggestions, setShowCommandSuggestions] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [showModelSelection, setShowModelSelection] = useState(false);
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);
  const [showFileAutocomplete, setShowFileAutocomplete] = useState(false);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [fileSuggestions, setFileSuggestions] = useState<FileSuggestion[]>([]);
  const [autoEditEnabled, setAutoEditEnabled] = useState(() => {
    const confirmationService = ConfirmationService.getInstance();
    const sessionFlags = confirmationService.getSessionFlags();
    return sessionFlags.allOperations;
  });

  // Track last escape time for double-escape detection
  const lastEscapeTimeRef = useRef<number>(0);
  const DOUBLE_ESCAPE_THRESHOLD = 500; // ms

  /**
   * Save instruction to .codebuddyrules file (Claude Code-style # capture)
   */
  const saveInstructionToCodeBuddyRules = async (instruction: string): Promise<string> => {
    const codebuddyrulesPath = path.join(process.cwd(), '.codebuddyrules');

    try {
      let rules: { instructions?: string[] } = {};

      // Load existing rules if file exists
      const exists = await fsPromises.access(codebuddyrulesPath).then(() => true).catch(() => false);
      if (exists) {
        const content = await fsPromises.readFile(codebuddyrulesPath, 'utf-8');
        try {
          rules = yaml.load(content) as { instructions?: string[] } || {};
        } catch {
          // If parsing fails, treat existing content as raw
          rules = { instructions: [] };
        }
      }

      // Ensure instructions array exists
      if (!rules.instructions) {
        rules.instructions = [];
      }

      // Add the new instruction if not already present
      if (!rules.instructions.includes(instruction)) {
        rules.instructions.push(instruction);
      }

      // Write back to file
      await fsPromises.writeFile(codebuddyrulesPath, yaml.dump(rules, { lineWidth: -1 }));

      return `Instruction saved to .codebuddyrules:\n  "${instruction}"`;
    } catch (error) {
      return `Failed to save instruction: ${getErrorMessage(error)}`;
    }
  };

  /**
   * Get the last user message from chat history for editing
   */
  const getLastUserMessage = (): string | null => {
    for (let i = chatHistory.length - 1; i >= 0; i--) {
      if (chatHistory[i].type === 'user') {
        return chatHistory[i].content;
      }
    }
    return null;
  };

  // Helper functions for handleSpecialKey
  const handleEscapeKey = (_key: Key): boolean => {
    if (showCommandSuggestions) {
      setShowCommandSuggestions(false);
      setSelectedCommandIndex(0);
      return true;
    }
    if (showModelSelection) {
      setShowModelSelection(false);
      setSelectedModelIndex(0);
      return true;
    }
    if (showFileAutocomplete) {
      setShowFileAutocomplete(false);
      setSelectedFileIndex(0);
      return true;
    }
    if (isProcessing || isStreaming) {
      agent.abortCurrentOperation();
      setIsProcessing(false);
      setIsStreaming(false);
      setTokenCount(0);
      setProcessingTime(0);
      processingStartTime.current = 0;
      return true;
    }

    // Double-escape detection for editing previous prompt
    const now = Date.now();
    const timeSinceLastEscape = now - lastEscapeTimeRef.current;
    lastEscapeTimeRef.current = now;

    if (timeSinceLastEscape < DOUBLE_ESCAPE_THRESHOLD && input.trim() === '') {
      // Double escape with empty input - load last user message for editing
      const lastMessage = getLastUserMessage();
      if (lastMessage) {
        setInput(lastMessage);
        setCursorPosition(lastMessage.length);
        return true;
      }
    }

    return false; // Let default escape handling work
  };

  const handleCommandSuggestionsNav = (key: Key): boolean => {
    const filteredSuggestions = filterCommandSuggestions(
      commandSuggestions,
      input
    );

    if (filteredSuggestions.length === 0) {
      setShowCommandSuggestions(false);
      setSelectedCommandIndex(0);
      return false; // Continue processing
    } else {
      if (key.upArrow) {
        setSelectedCommandIndex((prev) =>
          prev === 0 ? filteredSuggestions.length - 1 : prev - 1
        );
        return true;
      }
      if (key.downArrow) {
        setSelectedCommandIndex(
          (prev) => (prev + 1) % filteredSuggestions.length
        );
        return true;
      }
      if (key.tab || key.return) {
        const safeIndex = Math.min(
          selectedCommandIndex,
          filteredSuggestions.length - 1
        );
        const selectedSuggestion = filteredSuggestions[safeIndex] as { command: string; isArgument?: boolean };

        let newInput: string;
        if (selectedSuggestion.isArgument) {
          // For arguments, keep the command and add the argument
          const parts = input.trim().split(/\s+/);
          const baseCommand = parts[0]; // e.g., "/ai-test"
          newInput = `${baseCommand} ${selectedSuggestion.command}`;

          // If Enter was pressed, execute the full command directly
          if (key.return) {
            setShowCommandSuggestions(false);
            setSelectedCommandIndex(0);
            clearInput();
            // Execute the full command directly
            handleDirectCommand(newInput);
            return true;
          }
        } else {
          // For commands, just use the command
          newInput = selectedSuggestion.command + " ";
        }

        setInput(newInput);
        setCursorPosition(newInput.length);
        setShowCommandSuggestions(false);
        setSelectedCommandIndex(0);
        return true;
      }
    }
    return false;
  };

  const handleModelSelectionNav = (key: Key): boolean => {
    if (key.upArrow) {
      setSelectedModelIndex((prev) =>
        prev === 0 ? availableModels.length - 1 : prev - 1
      );
      return true;
    }
    if (key.downArrow) {
      setSelectedModelIndex((prev) => (prev + 1) % availableModels.length);
      return true;
    }
    if (key.tab || key.return) {
      const selectedModel = availableModels[selectedModelIndex];
      // Delegate to Dispatcher implicitly via handleDirectCommand? 
      // No, UI navigation logic remains here, but the action can be manual.
      // Or we can construct a command string and let dispatcher handle it.
      // But we have state setters here.
      // Let's keep UI state manipulation here for selection, but action execution via command if possible.
      // Actually, standard behavior:
      // agent.setModel(selectedModel.model);
      // updateCurrentModel(selectedModel.model);
      // ...
      
      // We can use a helper, but for now let's leave this UI logic as is, or use handleDirectCommand("/models " + model)
      handleDirectCommand(`/models ${selectedModel.model}`);
      
      setShowModelSelection(false);
      setSelectedModelIndex(0);
      return true;
    }
    return false;
  };

  const handleFileAutocompleteNav = (key: Key): boolean => {
    if (fileSuggestions.length > 0) {
      if (key.upArrow) {
        setSelectedFileIndex((prev) =>
          prev === 0 ? fileSuggestions.length - 1 : prev - 1
        );
        return true;
      }
      if (key.downArrow) {
        setSelectedFileIndex((prev) => (prev + 1) % fileSuggestions.length);
        return true;
      }
      if (key.tab || key.return) {
        const selectedFile = fileSuggestions[selectedFileIndex];
        const { startPos } = extractFileReference(input);

        if (startPos >= 0) {
          // Replace the @ reference with the selected file path
          const beforeAt = input.slice(0, startPos);
          const filePath = selectedFile.isDirectory
            ? `@${selectedFile.path}/`
            : `@${selectedFile.path}`;
          const newInput = beforeAt + filePath + (selectedFile.isDirectory ? '' : ' ');

          setInput(newInput);
          setCursorPosition(newInput.length);
          setShowFileAutocomplete(false);
          setSelectedFileIndex(0);

          // If it's a directory and Enter was pressed, refresh suggestions
          if (selectedFile.isDirectory && key.return) {
            // Keep autocomplete open for directory navigation
            setTimeout(() => {
              const newSuggestions = getFileSuggestions(selectedFile.path + '/');
              setFileSuggestions(newSuggestions.slice(0, 8));
              if (newSuggestions.length > 0) {
                setShowFileAutocomplete(true);
              }
            }, 0);
          }
        }
        return true;
      }
      if (key.escape) {
        setShowFileAutocomplete(false);
        setSelectedFileIndex(0);
        return true;
      }
    }
    return false;
  };

  const handleSpecialKey = (key: Key): boolean => {
    // Don't handle input if confirmation dialog is active
    if (isConfirmationActive) {
      return true; // Prevent default handling
    }

    // Handle shift+tab to toggle auto-edit mode
    if (key.shift && key.tab) {
      const newAutoEditState = !autoEditEnabled;
      setAutoEditEnabled(newAutoEditState);

      const confirmationService = ConfirmationService.getInstance();
      if (newAutoEditState) {
        // Enable auto-edit: set all operations to be accepted
        confirmationService.setSessionFlag("allOperations", true);
      } else {
        // Disable auto-edit: reset session flags
        confirmationService.resetSession();
      }
      return true; // Handled
    }

    // Handle escape key
    if (key.escape) {
      return handleEscapeKey(key);
    }

    // Handle command suggestions navigation
    if (showCommandSuggestions) {
      const handled = handleCommandSuggestionsNav(key);
      if (handled) return true;
      return handled;
    }

    // Handle model selection navigation
    if (showModelSelection) {
      const handled = handleModelSelectionNav(key);
      if (handled) return true;
    }

    // Handle file autocomplete navigation
    if (showFileAutocomplete) {
      const handled = handleFileAutocompleteNav(key);
      if (handled) return true;
    }

    return false; // Let default handling proceed
  };

  const handleInputSubmit = async (userInput: string) => {
    if (userInput === "exit" || userInput === "quit") {
      process.exit(0);
      return;
    }

    if (userInput.trim()) {
      // Add to persistent history (for Ctrl+R and /history command)
      const historyManager = getHistoryManager();
      historyManager.add(userInput);

      // Handle # instruction capture - save to .codebuddyrules (Claude Code-style)
      if (userInput.startsWith("#")) {
        const instruction = userInput.slice(1).trim();
        if (instruction) {
          const result = await saveInstructionToCodeBuddyRules(instruction);
          const entry: ChatEntry = {
            type: "assistant",
            content: result,
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, entry]);
        } else {
          const helpEntry: ChatEntry = {
            type: "assistant",
            content: `# Instruction Capture\n\nUsage: #<instruction>\n\nSave a project-specific instruction to .codebuddyrules.\n\nExamples:\n  # Always use TypeScript strict mode\n  # Prefer functional components over class components\n  # Use conventional commits format`,
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, helpEntry]);
        }
        clearInput();
        return;
      }

      // Handle ! shell bypass prefix - execute command directly without AI
      if (userInput.startsWith("!")) {
        // Delegate to dispatcher for consistency?
        // Or keep direct call? Dispatcher handles it too.
        await handleDirectCommand(userInput);
        return;
      }

      // For slash commands, handleDirectCommand handles clearInput
      // For regular messages, we need to handle it here
      if (userInput.startsWith("/")) {
        await handleDirectCommand(userInput);
      } else {
        // Process @ file references before sending to AI
        const processedInput = await processFileReferences(userInput);
        await processUserMessage(processedInput);
      }
    }
  };

  // Removed handleShellBypass as it's now in ClientCommandDispatcher

  /**
   * Process @ file references in input
   * Replaces @path with file content or adds context about the file
   */
  const processFileReferences = async (input: string): Promise<string> => {
    // Match @path patterns (not preceded by non-whitespace, not followed by space within the reference)
    const fileRefPattern = /(?:^|(?<=\s))@([^\s@]+)/g;
    const matches = [...input.matchAll(fileRefPattern)];

    if (matches.length === 0) {
      return input;
    }

    let processedInput = input;
    const fileContents: string[] = [];

    for (const match of matches) {
      const filePath = match[1];
      const fullMatch = match[0];

      try {
        const resolvedPath = path.isAbsolute(filePath)
          ? filePath
          : path.resolve(process.cwd(), filePath);

        const exists = await fsPromises.access(resolvedPath).then(() => true).catch(() => false);
        if (exists) {
          const stats = await fsPromises.stat(resolvedPath);

          if (stats.isDirectory()) {
            // For directories, list contents
            const entries = await fsPromises.readdir(resolvedPath);
            const listing = entries.slice(0, 50).join('\n');
            fileContents.push(`📁 Directory: ${filePath}\n${listing}${entries.length > 50 ? '\n... and more files' : ''}`);
          } else if (stats.isFile()) {
            // For files, read content (with size limit)
            const maxSize = 100 * 1024; // 100KB limit
            if (stats.size > maxSize) {
              const content = (await fsPromises.readFile(resolvedPath, 'utf-8')).slice(0, maxSize);
              fileContents.push(`📄 File: ${filePath} (truncated to 100KB)\n\`\`\`\n${content}\n\`\`\``);
            } else {
              const content = await fsPromises.readFile(resolvedPath, 'utf-8');
              const ext = path.extname(filePath).slice(1) || 'txt';
              fileContents.push(`📄 File: ${filePath}\n\`\`\`${ext}\n${content}\n\`\`\``);
            }
          }

          // Remove the @reference from the input text
          processedInput = processedInput.replace(fullMatch, `[${filePath}]`);
        }
      } catch {
        // File doesn't exist or can't be read - leave the @reference as is
      }
    }

    if (fileContents.length > 0) {
      // Append file contents as context
      processedInput = `${processedInput}\n\n---\nReferenced files:\n\n${fileContents.join('\n\n')}`;
    }

    return processedInput;
  };

  const handleInputChange = (newInput: string) => {
    // Update command suggestions based on input
    if (newInput.startsWith("/")) {
      setShowCommandSuggestions(true);
      setSelectedCommandIndex(0);
      setShowFileAutocomplete(false);
    } else {
      setShowCommandSuggestions(false);
      setSelectedCommandIndex(0);

      // Check for @ file references
      const { found, partial } = extractFileReference(newInput);
      if (found) {
        const suggestions = getFileSuggestions(partial);
        setFileSuggestions(suggestions.slice(0, 8));
        setShowFileAutocomplete(suggestions.length > 0);
        setSelectedFileIndex(0);
      } else {
        setShowFileAutocomplete(false);
        setFileSuggestions([]);
      }
    }
  };

  const {
    input,
    cursorPosition,
    setInput,
    setCursorPosition,
    clearInput,
    resetHistory,
    handleInput,
  } = useEnhancedInput({
    onSubmit: handleInputSubmit,
    onSpecialKey: handleSpecialKey,
    disabled: isConfirmationActive,
  });

  // Hook up the actual input handling
  useInput((inputChar: string, key: Key) => {
    handleInput(inputChar, key);
  });

  // Update command suggestions when input changes
  useEffect(() => {
    handleInputChange(input);
  }, [input]);

  // Load commands from SlashCommandManager
  const commandSuggestions: CommandSuggestion[] = useMemo(() => {
    const slashManager = getSlashCommandManager();
    return slashManager.getCommands().map(cmd => ({
      command: `/${cmd.name}`,
      description: cmd.description
    }));
  }, []);

  // Load models from configuration with fallback to defaults
  const availableModels: ModelOption[] = useMemo(() => {
    return loadModelConfig(); // Return directly, interface already matches
  }, []);

  const handleDirectCommand = async (input: string): Promise<boolean> => {
    const context: ClientCommandContext = {
      agent,
      chatHistory,
      setChatHistory,
      setIsProcessing,
      setIsStreaming,
      setTokenCount,
      setProcessingTime,
      processingStartTime,
      setInput,
      clearInput,
      resetHistory,
      setShowModelSelection,
      setSelectedModelIndex,
      availableModels,
      processUserMessage: processUserMessage // Using the function defined below
    };

    return await ClientCommandDispatcher.dispatch(input, context);
  };

  const processUserMessage = async (userInput: string) => {
    const userEntry: ChatEntry = {
      type: "user",
      content: userInput,
      timestamp: new Date(),
    };
    setChatHistory((prev) => [...prev, userEntry]);

    setIsProcessing(true);
    clearInput();

    try {
      setIsStreaming(true);
      let streamingEntry: ChatEntry | null = null;
      let fullResponseContent = "";

      for await (const chunk of agent.processUserMessageStream(userInput)) {
        switch (chunk.type) {
          case "content":
            if (chunk.content) {
              fullResponseContent += chunk.content;
              if (!streamingEntry) {
                const newStreamingEntry = {
                  type: "assistant" as const,
                  content: chunk.content,
                  timestamp: new Date(),
                  isStreaming: true,
                };
                setChatHistory((prev) => [...prev, newStreamingEntry]);
                streamingEntry = newStreamingEntry;
              } else {
                setChatHistory((prev) =>
                  prev.map((entry, idx) =>
                    idx === prev.length - 1 && entry.isStreaming
                      ? { ...entry, content: entry.content + chunk.content }
                      : entry
                  )
                );
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
              // Stop streaming for the current assistant message
              setChatHistory((prev) =>
                prev.map((entry) =>
                  entry.isStreaming
                    ? {
                        ...entry,
                        isStreaming: false,
                        toolCalls: chunk.toolCalls,
                      }
                    : entry
                )
              );
              streamingEntry = null;

              // Add individual tool call entries to show tools are being executed
              chunk.toolCalls.forEach((toolCall) => {
                const toolCallEntry: ChatEntry = {
                  type: "tool_call",
                  content: "Executing...",
                  timestamp: new Date(),
                  toolCall: toolCall,
                };
                setChatHistory((prev) => [...prev, toolCallEntry]);
              });
            }
            break;

          case "tool_result":
            if (chunk.toolCall && chunk.toolResult) {
              setChatHistory((prev) =>
                prev.map((entry) => {
                  if (entry.isStreaming) {
                    return { ...entry, isStreaming: false };
                  }
                  // Update the existing tool_call entry with the result
                  if (
                    entry.type === "tool_call" &&
                    entry.toolCall?.id === chunk.toolCall?.id
                  ) {
                    return {
                      ...entry,
                      type: "tool_result",
                      content: chunk.toolResult?.success
                        ? chunk.toolResult?.output || "Success"
                        : chunk.toolResult?.error || "Error occurred",
                      toolResult: chunk.toolResult,
                    };
                  }
                  return entry;
                })
              );
              streamingEntry = null;
            }
            break;

          case "done":
            if (streamingEntry) {
              setChatHistory((prev) =>
                prev.map((entry) =>
                  entry.isStreaming ? { ...entry, isStreaming: false } : entry
                )
              );
            }
            setIsStreaming(false);

            // Auto-speak the response if enabled
            const ttsManager = getTTSManager();
            if (ttsManager.getConfig().autoSpeak && fullResponseContent.trim()) {
              // Strip markdown formatting for cleaner speech
              const textToSpeak = fullResponseContent
                .replace(/```[\s\S]*?```/g, '') // Remove code blocks
                .replace(/`[^`]+`/g, '') // Remove inline code
                .replace(/\*\*([^*]+)\*\*/g, '$1') // Bold to plain
                .replace(/\*([^*]+)\*/g, '$1') // Italic to plain
                .replace(/#+\s/g, '') // Remove headers
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Links to text
                .replace(/\n+/g, '. ') // Newlines to pauses
                .trim();
              if (textToSpeak) {
                // Fire-and-forget with error handling
                ttsManager.speak(textToSpeak, 'fr').catch(() => {
                  // Errors are emitted via 'error' event, no need to handle here
                });
              }
            }
            break;
        }
      }
    } catch (error) {
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Error: ${getErrorMessage(error)}`,
        timestamp: new Date(),
      };
      setChatHistory((prev) => [...prev, errorEntry]);
      setIsStreaming(false);
    }

    setIsProcessing(false);
    processingStartTime.current = 0;
  };


  return {
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
    agent,
    autoEditEnabled,
  };
}
