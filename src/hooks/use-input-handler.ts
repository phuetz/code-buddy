import { useState, useMemo, useEffect, useRef } from "react";
import { useInput } from "ink";
import { promises as fsPromises } from "fs";
import path from "path";
import * as yaml from 'js-yaml';
import { CodeBuddyAgent, ChatEntry } from "../agent/codebuddy-agent.js";
import type { AgentMode } from "../agent/agent-mode.js";
import { ConfirmationService } from "../utils/confirmation-service.js";
import { useEnhancedInput, Key } from "./use-enhanced-input.js";
import { getErrorMessage } from "../types/index.js";

import { filterCommandSuggestions } from "../ui/components/CommandSuggestions.js";
import { loadModelConfig, updateCurrentModel } from "../utils/model-config.js";

// Import enhanced features
import { getSlashCommandManager } from "../commands/slash-commands.js";
import { getPersistentCheckpointManager } from "../checkpoints/persistent-checkpoint-manager.js";
import { getHookSystem } from "../hooks/hook-system.js";
import { getSecurityModeManager, SecurityMode } from "../security/security-modes.js";
import { initCodeBuddyProject, formatInitResult } from "../utils/init-project.js";
import { getBackgroundTaskManager } from "../tasks/background-tasks.js";
import { getEnhancedCommandHandler } from "../commands/enhanced-command-handler.js";
import { getTTSManager } from "../input/text-to-speech.js";

// Import file autocomplete
import { extractFileReference, getFileSuggestions, FileSuggestion } from "../ui/components/FileAutocomplete.js";

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
  const handleEscapeKey = (key: Key): boolean => {
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
      agent.setModel(selectedModel.model);
      updateCurrentModel(selectedModel.model);
      const confirmEntry: ChatEntry = {
        type: "assistant",
        content: `✓ Switched to model: ${selectedModel.model}`,
        timestamp: new Date(),
      };
      setChatHistory((prev) => [...prev, confirmEntry]);
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
      // If suggestions are still shown but not handled, we might want to return false to let typing continue, 
      // but usually navigation keys are handled. 
      // If we return false here, up/down arrows might do something else (like history nav) which we don't want when suggestions are open.
      // But wait, the original logic for up/down returned true.
      // If it wasn't up/down/tab/enter, it returned false.
      // My helper returns false if it wasn't handled.
      // If it returns false, it means it wasn't a navigation key.
      // So we should return false to let handleInput handle it (typing).
      // However, check original logic: 
      // if (showCommandSuggestions) { ... if (key.upArrow) ... return true; ... } 
      // If filteredSuggestions is empty, it hides and returns false.
      
      // Let's match original logic:
      // If filteredSuggestions length == 0: hides and returns false.
      // If length > 0:
      //   Up/Down/Tab/Return -> handled -> returns true.
      //   Other keys -> returns false.
      
      // My helper handleCommandSuggestionsNav follows this.
      // So:
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
        await handleShellBypass(userInput.slice(1).trim());
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

  /**
   * Handle ! shell bypass - execute shell command directly without AI
   */
  const handleShellBypass = async (command: string) => {
    if (!command) {
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: "Usage: !<command> - Execute shell command directly\nExample: !ls -la",
        timestamp: new Date(),
      };
      setChatHistory((prev) => [...prev, errorEntry]);
      clearInput();
      return;
    }

    const userEntry: ChatEntry = {
      type: "user",
      content: `!${command}`,
      timestamp: new Date(),
    };
    setChatHistory((prev) => [...prev, userEntry]);

    try {
      const result = await agent.executeBashCommand(command);

      const commandEntry: ChatEntry = {
        type: "tool_result",
        content: result.success
          ? result.output || "Command completed"
          : result.error || "Command failed",
        timestamp: new Date(),
        toolCall: {
          id: `shell_bypass_${Date.now()}`,
          type: "function",
          function: {
            name: "bash",
            arguments: JSON.stringify({ command }),
          },
        },
        toolResult: result,
      };
      setChatHistory((prev) => [...prev, commandEntry]);
    } catch (error) {
      const errorEntry: ChatEntry = {
        type: "assistant",
        content: `Error executing command: ${getErrorMessage(error)}`,
        timestamp: new Date(),
      };
      setChatHistory((prev) => [...prev, errorEntry]);
    }

    clearInput();
  };

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
    const trimmedInput = input.trim();

    // Handle slash commands via SlashCommandManager
    if (trimmedInput.startsWith("/")) {
      const slashManager = getSlashCommandManager();
      const result = slashManager.execute(trimmedInput);

      if (result.success && result.prompt) {
        // Handle special built-in commands
        if (result.prompt === "__CLEAR_CHAT__") {
          setChatHistory([]);
          setIsProcessing(false);
          setIsStreaming(false);
          setTokenCount(0);
          setProcessingTime(0);
          processingStartTime.current = 0;
          const confirmationService = ConfirmationService.getInstance();
          confirmationService.resetSession();
          clearInput();
          resetHistory();
          return true;
        }

        if (result.prompt === "__CHANGE_MODEL__") {
          setShowModelSelection(true);
          setSelectedModelIndex(0);
          clearInput();
          return true;
        }

        if (result.prompt === "__CHANGE_MODE__") {
          const args = trimmedInput.split(" ").slice(1);
          const mode = args[0] as AgentMode | undefined;
          if (mode && ["plan", "code", "ask"].includes(mode)) {
            agent.setMode(mode);
            const entry: ChatEntry = {
              type: "assistant",
              content: `✓ Switched to ${mode} mode`,
              timestamp: new Date(),
            };
            setChatHistory((prev) => [...prev, entry]);
          } else {
            const entry: ChatEntry = {
              type: "assistant",
              content: `Invalid mode. Available: plan, code, ask`,
              timestamp: new Date(),
            };
            setChatHistory((prev) => [...prev, entry]);
          }
          clearInput();
          return true;
        }

        if (result.prompt === "__LIST_CHECKPOINTS__") {
          const checkpointManager = getPersistentCheckpointManager();
          const entry: ChatEntry = {
            type: "assistant",
            content: checkpointManager.formatCheckpointList(),
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, entry]);
          clearInput();
          return true;
        }

        if (result.prompt === "__RESTORE_CHECKPOINT__") {
          const checkpointManager = getPersistentCheckpointManager();
          const args = trimmedInput.split(" ").slice(1);

          if (args.length === 0) {
            // Show checkpoints list
            const entry: ChatEntry = {
              type: "assistant",
              content: checkpointManager.formatCheckpointList(),
              timestamp: new Date(),
            };
            setChatHistory((prev) => [...prev, entry]);
          } else {
            // Restore specific checkpoint
            const checkpoints = checkpointManager.getCheckpoints();
            const arg = args[0];
            let checkpointId = arg;

            // If arg is a number, use it as index
            const index = parseInt(arg, 10);
            if (!isNaN(index) && index > 0 && index <= checkpoints.length) {
              checkpointId = checkpoints[index - 1].id;
            }

            const restoreResult = checkpointManager.restore(checkpointId);
            const entry: ChatEntry = {
              type: "assistant",
              content: restoreResult.success
                ? `✅ Restored checkpoint!\n\nFiles restored:\n${restoreResult.restored.map(f => `  • ${f}`).join('\n')}`
                : `❌ Failed to restore: ${restoreResult.errors.join(', ')}`,
              timestamp: new Date(),
            };
            setChatHistory((prev) => [...prev, entry]);
          }
          clearInput();
          return true;
        }

        if (result.prompt === "__INIT_GROK__") {
          const initResult = initCodeBuddyProject();
          const entry: ChatEntry = {
            type: "assistant",
            content: formatInitResult(initResult),
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, entry]);
          clearInput();
          return true;
        }

        if (result.prompt === "__FEATURES__") {
          const { handleFeaturesCommand } = await import("../commands/features.js");
          const entry: ChatEntry = {
            type: "assistant",
            content: handleFeaturesCommand(),
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, entry]);
          clearInput();
          return true;
        }

        // Handle enhanced commands with special tokens
        if (result.prompt.startsWith("__") && result.prompt.endsWith("__")) {
          const enhancedHandler = getEnhancedCommandHandler();
          enhancedHandler.setConversationHistory(chatHistory);
          enhancedHandler.setCodeBuddyClient(agent.getClient());

          const args = trimmedInput.split(" ").slice(1);
          const handlerResult = await enhancedHandler.handleCommand(
            result.prompt,
            args,
            trimmedInput
          );

          if (handlerResult.handled) {
            if (handlerResult.entry) {
              setChatHistory((prev) => [...prev, handlerResult.entry!]);
            }

            if (handlerResult.passToAI && handlerResult.prompt) {
              // Pass the generated prompt to the AI
              await processUserMessage(handlerResult.prompt);
            }

            clearInput();
            return true;
          }
        }

        // Handle /security command
        if (trimmedInput.startsWith("/security")) {
          const securityManager = getSecurityModeManager();
          const args = trimmedInput.split(" ").slice(1);

          if (args.length === 0) {
            const entry: ChatEntry = {
              type: "assistant",
              content: securityManager.formatStatus(),
              timestamp: new Date(),
            };
            setChatHistory((prev) => [...prev, entry]);
          } else {
            const mode = args[0] as SecurityMode;
            if (["suggest", "auto-edit", "full-auto"].includes(mode)) {
              securityManager.setMode(mode);
              const entry: ChatEntry = {
                type: "assistant",
                content: `✅ Security mode changed to: ${mode.toUpperCase()}\n\n${securityManager.formatStatus()}`,
                timestamp: new Date(),
              };
              setChatHistory((prev) => [...prev, entry]);
            } else {
              const entry: ChatEntry = {
                type: "assistant",
                content: `Invalid security mode. Available: suggest, auto-edit, full-auto`,
                timestamp: new Date(),
              };
              setChatHistory((prev) => [...prev, entry]);
            }
          }
          clearInput();
          return true;
        }

        // Handle /hooks command
        if (trimmedInput.startsWith("/hooks")) {
          const hookSystem = getHookSystem();
          const entry: ChatEntry = {
            type: "assistant",
            content: hookSystem.formatStatus(),
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, entry]);
          clearInput();
          return true;
        }

        // Handle /tasks command
        if (trimmedInput.startsWith("/tasks")) {
          const taskManager = getBackgroundTaskManager();
          const entry: ChatEntry = {
            type: "assistant",
            content: taskManager.formatTasksList(),
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, entry]);
          clearInput();
          return true;
        }

        // For other slash commands, send the prompt to the AI
        if (!result.prompt.startsWith("__")) {
          await processUserMessage(result.prompt);
          clearInput();
          return true;
        }
      } else if (!result.success) {
        const entry: ChatEntry = {
          type: "assistant",
          content: result.error || "Unknown command",
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, entry]);
        clearInput();
        return true;
      }
    }

    // Legacy command handling for backwards compatibility
    if (trimmedInput === "/exit") {
      process.exit(0);
      return true;
    }

    if (trimmedInput === "/models") {
      setShowModelSelection(true);
      setSelectedModelIndex(0);
      clearInput();
      return true;
    }

    if (trimmedInput.startsWith("/models ")) {
      const modelArg = trimmedInput.split(" ")[1];
      const modelNames = availableModels.map((m) => m.model);

      if (modelNames.includes(modelArg)) {
        agent.setModel(modelArg);
        updateCurrentModel(modelArg);
        const confirmEntry: ChatEntry = {
          type: "assistant",
          content: `✓ Switched to model: ${modelArg}`,
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, confirmEntry]);
      } else {
        const errorEntry: ChatEntry = {
          type: "assistant",
          content: `Invalid model: ${modelArg}\n\nAvailable models: ${modelNames.join(", ")}`,
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, errorEntry]);
      }

      clearInput();
      return true;
    }


    if (trimmedInput === "/commit-and-push") {
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
          return true;
        }

        // Add all changes
        const addResult = await agent.executeBashCommand("git add .");

        if (!addResult.success) {
          const addErrorEntry: ChatEntry = {
            type: "assistant",
            content: `Failed to stage changes: ${
              addResult.error || "Unknown error"
            }`,
            timestamp: new Date(),
          };
          setChatHistory((prev) => [...prev, addErrorEntry]);
          setIsProcessing(false);
          setIsStreaming(false);
          setInput("");
          return true;
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
      clearInput();
      return true;
    }

    const directBashCommands = [
      "ls",
      "pwd",
      "cd",
      "cat",
      "mkdir",
      "touch",
      "echo",
      "grep",
      "find",
      "cp",
      "mv",
      "rm",
    ];
    const firstWord = trimmedInput.split(" ")[0];

    if (directBashCommands.includes(firstWord)) {
      const userEntry: ChatEntry = {
        type: "user",
        content: trimmedInput,
        timestamp: new Date(),
      };
      setChatHistory((prev) => [...prev, userEntry]);

      try {
        const result = await agent.executeBashCommand(trimmedInput);

        const commandEntry: ChatEntry = {
          type: "tool_result",
          content: result.success
            ? result.output || "Command completed"
            : result.error || "Command failed",
          timestamp: new Date(),
          toolCall: {
            id: `bash_${Date.now()}`,
            type: "function",
            function: {
              name: "bash",
              arguments: JSON.stringify({ command: trimmedInput }),
            },
          },
          toolResult: result,
        };
        setChatHistory((prev) => [...prev, commandEntry]);
      } catch (error) {
        const errorEntry: ChatEntry = {
          type: "assistant",
          content: `Error executing command: ${getErrorMessage(error)}`,
          timestamp: new Date(),
        };
        setChatHistory((prev) => [...prev, errorEntry]);
      }

      clearInput();
      return true;
    }

    return false;
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
