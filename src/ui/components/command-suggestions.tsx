import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { getSlashCommandManager, SlashCommand } from "../../commands/slash-commands.js";

interface CommandSuggestion {
  command: string;
  description: string;
  isArgument?: boolean;
}

interface CommandSuggestionsProps {
  suggestions: CommandSuggestion[];
  input: string;
  selectedIndex: number;
  isVisible: boolean;
}

export const MAX_SUGGESTIONS = 15;
export const VISIBLE_SUGGESTIONS = 10;

/**
 * Get argument suggestions for a command
 */
function getArgumentSuggestions(command: SlashCommand, currentArgs: string): CommandSuggestion[] {
  if (!command.arguments || command.arguments.length === 0) {
    return [];
  }

  const suggestions: CommandSuggestion[] = [];
  const lowerArgs = currentArgs.toLowerCase().trim();

  for (const arg of command.arguments) {
    // Parse possible values from description
    // e.g., "on, off, status" or "quick (skip expensive), full (all tests)"
    const desc = arg.description;

    // Extract values from patterns like "value1, value2, value3" or "value1 (desc), value2 (desc)"
    const valueMatches = desc.match(/(?:^|,\s*)([a-z0-9_-]+)(?:\s*\([^)]*\))?/gi);

    if (valueMatches) {
      for (const match of valueMatches) {
        const value = match.replace(/^,\s*/, '').replace(/\s*\([^)]*\)$/, '').trim();
        if (value && value.length > 0 && !value.includes(' ')) {
          // Filter by current input
          if (!lowerArgs || value.toLowerCase().startsWith(lowerArgs)) {
            suggestions.push({
              command: value,
              description: `${arg.name}: ${desc}`,
              isArgument: true,
            });
          }
        }
      }
    }
  }

  return suggestions;
}

export function filterCommandSuggestions<T extends { command: string }>(
  suggestions: T[],
  input: string
): T[] {
  const lowerInput = input.toLowerCase();

  // Check if user is typing arguments for a command (e.g., "/ai-test qu")
  const parts = input.trim().split(/\s+/);
  if (parts.length >= 1 && parts[0].startsWith('/')) {
    const cmdName = parts[0].slice(1).toLowerCase();
    const slashManager = getSlashCommandManager();
    const command = slashManager.getCommand(cmdName);

    // If command exists and user has typed space after it, show argument suggestions
    if (command && (parts.length > 1 || input.endsWith(' '))) {
      const currentArg = parts.length > 1 ? parts.slice(1).join(' ') : '';
      const argSuggestions = getArgumentSuggestions(command, currentArg);

      if (argSuggestions.length > 0) {
        return argSuggestions.slice(0, MAX_SUGGESTIONS) as unknown as T[];
      }
    }
  }

  // If just "/" is typed, show most useful commands first
  if (lowerInput === "/") {
    const priorityCommands = [
      '/help', '/model', '/clear', '/ai-test', '/cost',
      '/theme', '/memory', '/context', '/export', '/yolo',
      '/checkpoints', '/restore', '/commit', '/review', '/security'
    ];

    const sorted = [...suggestions].sort((a, b) => {
      const aIndex = priorityCommands.indexOf(a.command.toLowerCase());
      const bIndex = priorityCommands.indexOf(b.command.toLowerCase());
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

    return sorted.slice(0, MAX_SUGGESTIONS);
  }

  return suggestions
    .filter((s) => s.command.toLowerCase().startsWith(lowerInput))
    .slice(0, MAX_SUGGESTIONS);
}

// Memoized individual suggestion item
const SuggestionItem = React.memo(function SuggestionItem({
  command,
  description,
  isSelected,
  isArgument,
}: {
  command: string;
  description: string;
  isSelected: boolean;
  isArgument?: boolean;
}) {
  return (
    <Box paddingLeft={1}>
      {isArgument && <Text color="gray">  → </Text>}
      <Text
        color={isSelected ? "black" : isArgument ? "yellow" : "white"}
        backgroundColor={isSelected ? "cyan" : undefined}
      >
        {command}
      </Text>
      <Box marginLeft={1}>
        <Text color="gray">{description}</Text>
      </Box>
    </Box>
  );
});

export const CommandSuggestions = React.memo(function CommandSuggestions({
  suggestions,
  input,
  selectedIndex,
  isVisible,
}: CommandSuggestionsProps) {
  // Memoize filtered suggestions
  const filteredSuggestions = useMemo(
    () => filterCommandSuggestions(suggestions, input),
    [suggestions, input]
  );

  // Calculate visible window for scrolling
  const visibleWindow = useMemo(() => {
    const total = filteredSuggestions.length;
    if (total <= VISIBLE_SUGGESTIONS) {
      return { start: 0, end: total };
    }

    // Center the selected item in the visible window
    let start = Math.max(0, selectedIndex - Math.floor(VISIBLE_SUGGESTIONS / 2));
    let end = start + VISIBLE_SUGGESTIONS;

    if (end > total) {
      end = total;
      start = Math.max(0, end - VISIBLE_SUGGESTIONS);
    }

    return { start, end };
  }, [filteredSuggestions.length, selectedIndex]);

  // Early return for invisible state
  if (!isVisible) return null;

  const visibleSuggestions = filteredSuggestions.slice(visibleWindow.start, visibleWindow.end);
  const totalMatches = filteredSuggestions.length;
  const totalCommands = suggestions.length;
  const hasMore = visibleWindow.end < totalMatches;
  const hasLess = visibleWindow.start > 0;

  return (
    <Box marginTop={1} flexDirection="column">
      {hasLess && (
        <Box paddingLeft={1}>
          <Text color="gray" dimColor>↑ {visibleWindow.start} more above...</Text>
        </Box>
      )}
      {visibleSuggestions.map((suggestion, index) => (
        <SuggestionItem
          key={suggestion.command}
          command={suggestion.command}
          description={suggestion.description}
          isSelected={index + visibleWindow.start === selectedIndex}
          isArgument={(suggestion as CommandSuggestion).isArgument}
        />
      ))}
      {hasMore && (
        <Box paddingLeft={1}>
          <Text color="gray" dimColor>↓ {totalMatches - visibleWindow.end} more below...</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          ↑↓ navigate • Enter/Tab select • Esc cancel • {totalMatches}/{totalCommands} commands
        </Text>
      </Box>
    </Box>
  );
});