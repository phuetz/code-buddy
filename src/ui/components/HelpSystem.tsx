/**
 * Enhanced Help System
 *
 * Interactive help with examples-first approach,
 * contextual tips, and keyboard shortcuts reference.
 */

import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";

/**
 * Command category
 */
export interface CommandCategory {
  name: string;
  description: string;
  commands: CommandHelp[];
}

/**
 * Single command help
 */
export interface CommandHelp {
  command: string;
  description: string;
  examples?: string[];
  aliases?: string[];
  args?: Array<{ name: string; description: string; required?: boolean }>;
}

/**
 * Keyboard shortcut definition
 */
export interface KeyboardShortcut {
  keys: string[];
  description: string;
  context?: string;
}

/**
 * Help system configuration
 */
export interface HelpConfig {
  appName: string;
  version: string;
  description: string;
  categories: CommandCategory[];
  shortcuts: KeyboardShortcut[];
  tips: string[];
  docUrl?: string;
  issuesUrl?: string;
}

/**
 * Props for HelpSystem
 */
interface HelpSystemProps {
  config: HelpConfig;
  initialTopic?: string;
  onClose?: () => void;
}

/**
 * Format key combination for display
 */
function formatKeys(keys: string[]): React.ReactNode {
  return keys.map((key, index) => (
    <React.Fragment key={key}>
      {index > 0 && <Text dimColor>+</Text>}
      <Text backgroundColor="gray" color="white">
        {" "}
        {key}{" "}
      </Text>
    </React.Fragment>
  ));
}

/**
 * Help System Component
 */
export function HelpSystem({
  config,
  initialTopic,
  onClose,
}: HelpSystemProps) {
  const [view, setView] = useState<"main" | "category" | "command" | "shortcuts">(
    initialTopic ? "command" : "main"
  );
  const [selectedCategory, setSelectedCategory] = useState(0);
  const [selectedCommand, setSelectedCommand] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);

  // Find command by name (used for search)
  const _findCommand = useCallback(
    (name: string): { category: CommandCategory; command: CommandHelp } | null => {
      for (const category of config.categories) {
        const command = category.commands.find(
          (c) =>
            c.command.toLowerCase() === name.toLowerCase() ||
            c.aliases?.some((a) => a.toLowerCase() === name.toLowerCase())
        );
        if (command) {
          return { category, command };
        }
      }
      return null;
    },
    [config.categories]
  );

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery) return [];

    const query = searchQuery.toLowerCase();
    const results: Array<{ category: string; command: CommandHelp; score: number }> = [];

    for (const category of config.categories) {
      for (const command of category.commands) {
        let score = 0;

        if (command.command.toLowerCase().includes(query)) {
          score += command.command.toLowerCase().startsWith(query) ? 100 : 50;
        }
        if (command.description.toLowerCase().includes(query)) {
          score += 30;
        }
        if (command.aliases?.some((a) => a.toLowerCase().includes(query))) {
          score += 40;
        }

        if (score > 0) {
          results.push({ category: category.name, command, score });
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 10);
  }, [searchQuery, config.categories]);

  // Current category and commands
  const currentCategory = config.categories[selectedCategory];
  const currentCommand = currentCategory?.commands[selectedCommand];

  // Handle input
  useInput(
    useCallback(
      (input: string, key) => {
        // Search mode input
        if (searchMode) {
          if (key.escape) {
            setSearchMode(false);
            setSearchQuery("");
            return;
          }
          if (key.return && searchResults.length > 0) {
            const result = searchResults[0];
            const catIndex = config.categories.findIndex(
              (c) => c.name === result.category
            );
            if (catIndex !== -1) {
              setSelectedCategory(catIndex);
              const cmdIndex = config.categories[catIndex].commands.findIndex(
                (c) => c.command === result.command.command
              );
              if (cmdIndex !== -1) {
                setSelectedCommand(cmdIndex);
                setView("command");
              }
            }
            setSearchMode(false);
            setSearchQuery("");
            return;
          }
          if (key.backspace || key.delete) {
            setSearchQuery((prev) => prev.slice(0, -1));
            return;
          }
          if (input && !key.ctrl && !key.meta) {
            setSearchQuery((prev) => prev + input);
          }
          return;
        }

        // Exit
        if (key.escape || input === "q" || input === "Q") {
          if (view === "main") {
            onClose?.();
          } else {
            setView("main");
            setSelectedCommand(0);
          }
          return;
        }

        // Search
        if (input === "/" || input === "s" || input === "S") {
          setSearchMode(true);
          return;
        }

        // Shortcuts view
        if (input === "k" || input === "K") {
          setView(view === "shortcuts" ? "main" : "shortcuts");
          return;
        }

        // Navigation
        if (view === "main") {
          if (key.upArrow) {
            setSelectedCategory((prev) =>
              prev > 0 ? prev - 1 : config.categories.length - 1
            );
          } else if (key.downArrow) {
            setSelectedCategory((prev) =>
              prev < config.categories.length - 1 ? prev + 1 : 0
            );
          } else if (key.return || key.rightArrow) {
            setView("category");
            setSelectedCommand(0);
          }
        } else if (view === "category") {
          const commands = currentCategory?.commands || [];
          if (key.upArrow) {
            setSelectedCommand((prev) =>
              prev > 0 ? prev - 1 : commands.length - 1
            );
          } else if (key.downArrow) {
            setSelectedCommand((prev) =>
              prev < commands.length - 1 ? prev + 1 : 0
            );
          } else if (key.return || key.rightArrow) {
            setView("command");
          } else if (key.leftArrow) {
            setView("main");
          }
        } else if (view === "command") {
          if (key.leftArrow) {
            setView("category");
          }
        }

        // Cycle tips
        if (input === "t" || input === "T") {
          setTipIndex((prev) => (prev + 1) % config.tips.length);
        }
      },
      [
        view,
        searchMode,
        searchResults,
        config.categories,
        config.tips.length,
        currentCategory,
        onClose,
      ]
    )
  );

  // Render main view
  const renderMain = () => (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {config.appName}
        </Text>
        <Text dimColor> v{config.version}</Text>
      </Box>
      <Text dimColor>{config.description}</Text>

      {/* Quick examples */}
      <Box marginTop={1} flexDirection="column">
        <Text bold color="yellow">
          QUICK START
        </Text>
        <Box marginLeft={2} flexDirection="column">
          <Text>
            <Text color="cyan">$</Text> codebuddy "add error handling to server.ts"
          </Text>
          <Text>
            <Text color="cyan">$</Text> codebuddy "find all TODO comments"
          </Text>
          <Text>
            <Text color="cyan">$</Text> codebuddy "refactor UserService to async/await"
          </Text>
        </Box>
      </Box>

      {/* Categories */}
      <Box marginTop={1} flexDirection="column">
        <Text bold color="yellow">
          COMMAND CATEGORIES
        </Text>
        {config.categories.map((category, index) => (
          <Box key={category.name} paddingLeft={2}>
            <Text
              color={selectedCategory === index ? "cyan" : undefined}
              bold={selectedCategory === index}
            >
              {selectedCategory === index ? "❯ " : "  "}
              {category.name}
            </Text>
            <Text dimColor> - {category.description}</Text>
          </Box>
        ))}
      </Box>

      {/* Tip */}
      {config.tips.length > 0 && (
        <Box marginTop={1} borderStyle="round" borderColor="magenta" padding={1}>
          <Text color="magenta">💡 Tip: </Text>
          <Text>{config.tips[tipIndex]}</Text>
          <Text dimColor> (press 't' for next tip)</Text>
        </Box>
      )}

      {/* Links */}
      <Box marginTop={1} flexDirection="column">
        {config.docUrl && (
          <Text dimColor>
            📚 Documentation: <Text color="cyan">{config.docUrl}</Text>
          </Text>
        )}
        {config.issuesUrl && (
          <Text dimColor>
            🐛 Report issues: <Text color="cyan">{config.issuesUrl}</Text>
          </Text>
        )}
      </Box>
    </Box>
  );

  // Render category view
  const renderCategory = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="cyan">← </Text>
        <Text bold>{currentCategory?.name}</Text>
      </Box>
      <Text dimColor>{currentCategory?.description}</Text>

      <Box marginTop={1} flexDirection="column">
        {currentCategory?.commands.map((command, index) => (
          <Box key={command.command} paddingLeft={2}>
            <Text
              color={selectedCommand === index ? "cyan" : undefined}
              bold={selectedCommand === index}
            >
              {selectedCommand === index ? "❯ " : "  "}
              {command.command}
            </Text>
            <Text dimColor> - {command.description}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );

  // Render command detail view
  const renderCommand = () => {
    if (!currentCommand) return null;

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text color="cyan">← </Text>
          <Text bold color="green">
            {currentCommand.command}
          </Text>
          {currentCommand.aliases && currentCommand.aliases.length > 0 && (
            <Text dimColor>
              {" "}
              (aliases: {currentCommand.aliases.join(", ")})
            </Text>
          )}
        </Box>

        <Text>{currentCommand.description}</Text>

        {/* Arguments */}
        {currentCommand.args && currentCommand.args.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold color="yellow">
              ARGUMENTS
            </Text>
            {currentCommand.args.map((arg) => (
              <Box key={arg.name} paddingLeft={2}>
                <Text color={arg.required ? "cyan" : "gray"}>
                  {arg.name}
                  {arg.required && <Text color="red">*</Text>}
                </Text>
                <Text dimColor> - {arg.description}</Text>
              </Box>
            ))}
          </Box>
        )}

        {/* Examples */}
        {currentCommand.examples && currentCommand.examples.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold color="yellow">
              EXAMPLES
            </Text>
            {currentCommand.examples.map((example, index) => (
              <Box key={index} paddingLeft={2}>
                <Text color="cyan">$ </Text>
                <Text>{example}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
  };

  // Render shortcuts view
  const renderShortcuts = () => (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          KEYBOARD SHORTCUTS
        </Text>
      </Box>

      {config.shortcuts.map((shortcut, index) => (
        <Box key={index} paddingLeft={2}>
          <Box width={20}>{formatKeys(shortcut.keys)}</Box>
          <Text>{shortcut.description}</Text>
          {shortcut.context && <Text dimColor> ({shortcut.context})</Text>}
        </Box>
      ))}
    </Box>
  );

  // Render search overlay
  const renderSearch = () => (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Box>
        <Text color="cyan">Search: </Text>
        <Text>{searchQuery}</Text>
        <Text backgroundColor="white" color="black">
          {" "}
        </Text>
      </Box>

      {searchResults.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {searchResults.slice(0, 5).map((result, index) => (
            <Box key={result.command.command}>
              <Text color={index === 0 ? "cyan" : undefined}>
                {index === 0 ? "❯ " : "  "}
              </Text>
              <Text bold>{result.command.command}</Text>
              <Text dimColor> ({result.category})</Text>
            </Box>
          ))}
        </Box>
      )}

      {searchQuery && searchResults.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No results found</Text>
        </Box>
      )}
    </Box>
  );

  return (
    <Box flexDirection="column">
      {searchMode && renderSearch()}

      {!searchMode && (
        <>
          {view === "main" && renderMain()}
          {view === "category" && renderCategory()}
          {view === "command" && renderCommand()}
          {view === "shortcuts" && renderShortcuts()}

          {/* Navigation help */}
          <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
            <Text dimColor>
              ↑↓ navigate • Enter/→ select • ←/Esc back • / search • k shortcuts • q
              quit
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}

/**
 * Default help configuration for Grok CLI
 */
export const DEFAULT_HELP_CONFIG: HelpConfig = {
  appName: "CodeBuddy CLI",
  version: "1.0.0",
  description: "AI-powered terminal agent using CodeBuddy API",
  docUrl: "https://github.com/phuetz/code-buddy#readme",
  issuesUrl: "https://github.com/phuetz/code-buddy/issues",
  categories: [
    {
      name: "Chat",
      description: "Interactive conversation commands",
      commands: [
        {
          command: "/help",
          description: "Show this help",
          aliases: ["/?", "/h"],
          examples: ["/help", "/help model"],
        },
        {
          command: "/clear",
          description: "Clear conversation history",
          aliases: ["/c"],
        },
        {
          command: "/exit",
          description: "Exit the application",
          aliases: ["/quit", "/q"],
        },
      ],
    },
    {
      name: "Model",
      description: "AI model configuration",
      commands: [
        {
          command: "/model",
          description: "Show or change the current model",
          args: [
            { name: "name", description: "Model name to switch to", required: false },
          ],
          examples: ["/model", "/model grok-2", "/model grok-2-vision"],
        },
      ],
    },
    {
      name: "Theme",
      description: "Visual customization",
      commands: [
        {
          command: "/theme",
          description: "Show or change the theme",
          args: [
            { name: "name", description: "Theme name", required: false },
          ],
          examples: ["/theme", "/theme dark", "/theme catppuccin"],
        },
        {
          command: "/avatar",
          description: "Change avatar preset",
          args: [
            { name: "preset", description: "Avatar preset name", required: false },
          ],
          examples: ["/avatar", "/avatar minimal", "/avatar emoji"],
        },
      ],
    },
    {
      name: "Settings",
      description: "Configuration and preferences",
      commands: [
        {
          command: "/config",
          description: "Show or update configuration",
          examples: ["/config", "/config set maxCost 5"],
        },
        {
          command: "/api-key",
          description: "Update API key",
        },
      ],
    },
  ],
  shortcuts: [
    { keys: ["Enter"], description: "Send message" },
    { keys: ["Shift", "Enter"], description: "New line in input" },
    { keys: ["↑", "↓"], description: "Navigate history" },
    { keys: ["Ctrl", "C"], description: "Cancel current operation" },
    { keys: ["Ctrl", "L"], description: "Clear screen" },
    { keys: ["Tab"], description: "Autocomplete command" },
    { keys: ["Shift", "Tab"], description: "Toggle auto-edit mode", context: "in chat" },
    { keys: ["Esc"], description: "Cancel/close dialog" },
  ],
  tips: [
    "Use 'think', 'megathink', or 'ultrathink' keywords for extended reasoning",
    "Press Shift+Tab to toggle auto-edit mode for automatic file changes",
    "You can use @file.ts to reference files in your messages",
    "Set YOLO_MODE=true for full autonomy (no confirmations)",
    "Use /model to switch between Grok models",
  ],
};

export default HelpSystem;
