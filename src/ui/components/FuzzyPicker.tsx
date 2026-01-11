/**
 * Fuzzy Picker Component
 *
 * Interactive fuzzy search picker for file selection and other lists.
 * Supports keyboard navigation, search filtering, and multi-select mode.
 */

import React, { useState, useMemo, useCallback } from "react";
import { Box, Text, useInput } from "ink";

/**
 * Item with optional metadata
 */
export interface PickerItem {
  value: string;
  label?: string;
  description?: string;
  icon?: string;
  disabled?: boolean;
}

/**
 * Props for FuzzyPicker
 */
interface FuzzyPickerProps {
  items: (string | PickerItem)[];
  onSelect: (item: string) => void;
  onCancel: () => void;
  placeholder?: string;
  maxVisible?: number;
  showCount?: boolean;
  showHelp?: boolean;
  highlightColor?: string;
  title?: string;
}

/**
 * Simple fuzzy matching score
 * Returns -1 if no match, otherwise a score (higher is better)
 */
function fuzzyMatch(query: string, text: string): number {
  if (!query) return 1; // Empty query matches everything

  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();

  // Exact match gets highest score
  if (lowerText === lowerQuery) return 1000;

  // Starts with query gets high score
  if (lowerText.startsWith(lowerQuery)) return 500 + (query.length / text.length) * 100;

  // Contains query gets medium score
  if (lowerText.includes(lowerQuery)) return 200 + (query.length / text.length) * 100;

  // Fuzzy character matching
  let queryIndex = 0;
  let score = 0;
  let consecutiveBonus = 0;

  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      score += 10 + consecutiveBonus;
      consecutiveBonus += 5; // Bonus for consecutive matches
      queryIndex++;
    } else {
      consecutiveBonus = 0;
    }
  }

  // Return -1 if not all query characters were matched
  if (queryIndex < lowerQuery.length) return -1;

  return score;
}

/**
 * Normalize item to PickerItem
 */
function normalizeItem(item: string | PickerItem): PickerItem {
  if (typeof item === "string") {
    return { value: item, label: item };
  }
  return { ...item, label: item.label || item.value };
}

/**
 * Highlight matched characters in text
 */
function HighlightedText({
  text,
  query,
  highlightColor = "cyan",
}: {
  text: string;
  query: string;
  highlightColor?: string;
}) {
  if (!query) {
    return <Text>{text}</Text>;
  }

  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();

  // Find match start position
  const matchIndex = lowerText.indexOf(lowerQuery);

  if (matchIndex === -1) {
    // Fuzzy highlight
    let result: React.ReactNode[] = [];
    let queryIdx = 0;

    for (let i = 0; i < text.length; i++) {
      if (queryIdx < lowerQuery.length && lowerText[i] === lowerQuery[queryIdx]) {
        result.push(
          <Text key={i} color={highlightColor} bold>
            {text[i]}
          </Text>
        );
        queryIdx++;
      } else {
        result.push(<Text key={i}>{text[i]}</Text>);
      }
    }

    return <>{result}</>;
  }

  // Substring highlight
  const before = text.slice(0, matchIndex);
  const match = text.slice(matchIndex, matchIndex + query.length);
  const after = text.slice(matchIndex + query.length);

  return (
    <>
      <Text>{before}</Text>
      <Text color={highlightColor} bold>
        {match}
      </Text>
      <Text>{after}</Text>
    </>
  );
}

/**
 * Fuzzy Picker Component
 */
export function FuzzyPicker({
  items,
  onSelect,
  onCancel,
  placeholder = "Type to search...",
  maxVisible = 10,
  showCount = true,
  showHelp = true,
  highlightColor = "cyan",
  title,
}: FuzzyPickerProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Normalize and filter items
  const normalizedItems = useMemo(
    () => items.map(normalizeItem),
    [items]
  );

  const filteredItems = useMemo(() => {
    if (!query) return normalizedItems.filter((i) => !i.disabled);

    return normalizedItems
      .map((item) => ({
        item,
        score: Math.max(
          fuzzyMatch(query, item.value),
          item.label ? fuzzyMatch(query, item.label) : -1,
          item.description ? fuzzyMatch(query, item.description) * 0.5 : -1
        ),
      }))
      .filter(({ score, item }) => score > 0 && !item.disabled)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);
  }, [query, normalizedItems]);

  // Clamp selected index to filtered items
  const clampedIndex = Math.min(selectedIndex, Math.max(0, filteredItems.length - 1));

  // Handle input
  useInput(
    useCallback(
      (input: string, key) => {
        if (key.escape) {
          onCancel();
          return;
        }

        if (key.return) {
          if (filteredItems[clampedIndex]) {
            onSelect(filteredItems[clampedIndex].value);
          }
          return;
        }

        if (key.upArrow) {
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          return;
        }

        if (key.downArrow) {
          setSelectedIndex((prev) => Math.min(filteredItems.length - 1, prev + 1));
          return;
        }

        if (key.backspace || key.delete) {
          setQuery((prev) => prev.slice(0, -1));
          setSelectedIndex(0);
          return;
        }

        // Tab cycles through items
        if (key.tab) {
          if (key.shift) {
            setSelectedIndex((prev) =>
              prev > 0 ? prev - 1 : filteredItems.length - 1
            );
          } else {
            setSelectedIndex((prev) =>
              prev < filteredItems.length - 1 ? prev + 1 : 0
            );
          }
          return;
        }

        // Regular character input
        if (input && !key.ctrl && !key.meta) {
          setQuery((prev) => prev + input);
          setSelectedIndex(0);
        }
      },
      [filteredItems, clampedIndex, onSelect, onCancel]
    )
  );

  // Calculate visible window
  const halfVisible = Math.floor(maxVisible / 2);
  let startIndex = Math.max(0, clampedIndex - halfVisible);
  const endIndex = Math.min(filteredItems.length, startIndex + maxVisible);

  // Adjust start if we're near the end
  if (endIndex - startIndex < maxVisible) {
    startIndex = Math.max(0, endIndex - maxVisible);
  }

  const visibleItems = filteredItems.slice(startIndex, endIndex);
  const hasItemsAbove = startIndex > 0;
  const hasItemsBelow = endIndex < filteredItems.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      {/* Title */}
      {title && (
        <Box marginBottom={1}>
          <Text bold color="white">
            {title}
          </Text>
        </Box>
      )}

      {/* Search input */}
      <Box marginBottom={1}>
        <Text color="cyan">Search: </Text>
        <Text>{query || <Text dimColor>{placeholder}</Text>}</Text>
        <Text color="white">█</Text>
      </Box>

      {/* Results count */}
      {showCount && (
        <Box marginBottom={1}>
          <Text dimColor>
            {filteredItems.length} of {normalizedItems.length} items
          </Text>
        </Box>
      )}

      {/* Items above indicator */}
      {hasItemsAbove && (
        <Box>
          <Text dimColor>  ↑ {startIndex} more above</Text>
        </Box>
      )}

      {/* Item list */}
      <Box flexDirection="column">
        {visibleItems.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No matches found</Text>
          </Box>
        ) : (
          visibleItems.map((item, displayIndex) => {
            const actualIndex = startIndex + displayIndex;
            const isSelected = actualIndex === clampedIndex;

            return (
              <Box key={item.value} paddingLeft={1}>
                <Text color={isSelected ? highlightColor : undefined}>
                  {isSelected ? "❯ " : "  "}
                </Text>
                {item.icon && <Text>{item.icon} </Text>}
                <Text
                  color={isSelected ? highlightColor : undefined}
                  bold={isSelected}
                >
                  <HighlightedText
                    text={item.label || item.value}
                    query={query}
                    highlightColor={isSelected ? "white" : highlightColor}
                  />
                </Text>
                {item.description && (
                  <Text dimColor> - {item.description}</Text>
                )}
              </Box>
            );
          })
        )}
      </Box>

      {/* Items below indicator */}
      {hasItemsBelow && (
        <Box>
          <Text dimColor>  ↓ {filteredItems.length - endIndex} more below</Text>
        </Box>
      )}

      {/* Help text */}
      {showHelp && (
        <Box marginTop={1}>
          <Text dimColor>↑↓ navigate • Enter select • Tab cycle • Esc cancel</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Multi-Select Fuzzy Picker Component
 */
interface MultiSelectPickerProps extends Omit<FuzzyPickerProps, "onSelect"> {
  onSubmit: (items: string[]) => void;
  initialSelected?: string[];
}

export function MultiSelectPicker({
  items,
  onSubmit,
  onCancel,
  initialSelected = [],
  placeholder = "Type to filter, Space to toggle...",
  maxVisible = 10,
  showCount = true,
  showHelp = true,
  highlightColor = "cyan",
  title,
}: MultiSelectPickerProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));

  // Normalize and filter items
  const normalizedItems = useMemo(
    () => items.map(normalizeItem),
    [items]
  );

  const filteredItems = useMemo(() => {
    if (!query) return normalizedItems.filter((i) => !i.disabled);

    return normalizedItems
      .map((item) => ({
        item,
        score: Math.max(
          fuzzyMatch(query, item.value),
          item.label ? fuzzyMatch(query, item.label) : -1
        ),
      }))
      .filter(({ score, item }) => score > 0 && !item.disabled)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item);
  }, [query, normalizedItems]);

  const clampedIndex = Math.min(selectedIndex, Math.max(0, filteredItems.length - 1));

  useInput(
    useCallback(
      (input: string, key) => {
        if (key.escape) {
          onCancel();
          return;
        }

        if (key.return) {
          onSubmit(Array.from(selected));
          return;
        }

        if (key.upArrow) {
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          return;
        }

        if (key.downArrow) {
          setSelectedIndex((prev) => Math.min(filteredItems.length - 1, prev + 1));
          return;
        }

        if (key.backspace || key.delete) {
          setQuery((prev) => prev.slice(0, -1));
          setSelectedIndex(0);
          return;
        }

        // Space toggles selection
        if (input === " ") {
          const item = filteredItems[clampedIndex];
          if (item) {
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(item.value)) {
                next.delete(item.value);
              } else {
                next.add(item.value);
              }
              return next;
            });
          }
          return;
        }

        // Tab cycles
        if (key.tab) {
          if (key.shift) {
            setSelectedIndex((prev) =>
              prev > 0 ? prev - 1 : filteredItems.length - 1
            );
          } else {
            setSelectedIndex((prev) =>
              prev < filteredItems.length - 1 ? prev + 1 : 0
            );
          }
          return;
        }

        // Regular character input
        if (input && !key.ctrl && !key.meta) {
          setQuery((prev) => prev + input);
          setSelectedIndex(0);
        }
      },
      [filteredItems, clampedIndex, selected, onSubmit, onCancel]
    )
  );

  // Calculate visible window
  const halfVisible = Math.floor(maxVisible / 2);
  let startIndex = Math.max(0, clampedIndex - halfVisible);
  const endIndex = Math.min(filteredItems.length, startIndex + maxVisible);

  if (endIndex - startIndex < maxVisible) {
    startIndex = Math.max(0, endIndex - maxVisible);
  }

  const visibleItems = filteredItems.slice(startIndex, endIndex);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      {title && (
        <Box marginBottom={1}>
          <Text bold color="white">
            {title}
          </Text>
        </Box>
      )}

      <Box marginBottom={1}>
        <Text color="cyan">Filter: </Text>
        <Text>{query || <Text dimColor>{placeholder}</Text>}</Text>
        <Text color="white">█</Text>
      </Box>

      {showCount && (
        <Box marginBottom={1}>
          <Text dimColor>
            {selected.size} selected • {filteredItems.length} of {normalizedItems.length} items
          </Text>
        </Box>
      )}

      <Box flexDirection="column">
        {visibleItems.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No matches found</Text>
          </Box>
        ) : (
          visibleItems.map((item, displayIndex) => {
            const actualIndex = startIndex + displayIndex;
            const isSelected = actualIndex === clampedIndex;
            const isChecked = selected.has(item.value);

            return (
              <Box key={item.value} paddingLeft={1}>
                <Text color={isSelected ? highlightColor : undefined}>
                  {isSelected ? "❯" : " "}
                </Text>
                <Text color={isChecked ? "green" : "gray"}>
                  {isChecked ? " ☑ " : " ☐ "}
                </Text>
                {item.icon && <Text>{item.icon} </Text>}
                <Text
                  color={isSelected ? highlightColor : undefined}
                  bold={isSelected}
                >
                  <HighlightedText
                    text={item.label || item.value}
                    query={query}
                    highlightColor={isSelected ? "white" : highlightColor}
                  />
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      {showHelp && (
        <Box marginTop={1}>
          <Text dimColor>↑↓ navigate • Space toggle • Enter confirm • Esc cancel</Text>
        </Box>
      )}
    </Box>
  );
}

export default FuzzyPicker;
