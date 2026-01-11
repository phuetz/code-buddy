/**
 * Enhanced Chat Input Component
 *
 * Improved input with:
 * - Command syntax highlighting
 * - History navigation with search (Ctrl+R)
 * - Keyword highlighting (think, megathink, ultrathink)
 * - File reference highlighting (@file.ts)
 * - Better multiline editing
 * - Keyboard shortcut hints
 */

import React, { useState, useMemo, useCallback } from "react";
import { Box, Text } from "ink";
import { useTheme } from "../context/theme-context.js";

/**
 * Token types for syntax highlighting
 */
type TokenType =
  | "text"
  | "command"
  | "thinking"
  | "file_ref"
  | "url"
  | "code"
  | "mention";

interface Token {
  type: TokenType;
  value: string;
  color?: string;
}

/**
 * Props for EnhancedChatInput
 */
interface EnhancedChatInputProps {
  input: string;
  cursorPosition: number;
  isProcessing: boolean;
  isStreaming: boolean;
  history?: string[];
  onHistorySelect?: (item: string) => void;
  showShortcuts?: boolean;
}

/**
 * Tokenize input for syntax highlighting
 */
function tokenizeInput(text: string): Token[] {
  if (!text) return [];

  const tokens: Token[] = [];
  let remaining = text;
  let _position = 0;

  // Patterns to match
  const patterns: Array<{
    regex: RegExp;
    type: TokenType;
    color: string;
  }> = [
    // Commands starting with /
    { regex: /^\/[a-zA-Z0-9_-]+/, type: "command", color: "cyan" },
    // Thinking keywords
    {
      regex: /^(think|megathink|ultrathink)\b/i,
      type: "thinking",
      color: "magenta",
    },
    // File references @path/to/file.ts
    { regex: /^@[\w./\\-]+/, type: "file_ref", color: "yellow" },
    // URLs
    { regex: /^https?:\/\/[^\s]+/, type: "url", color: "blue" },
    // Inline code `code`
    { regex: /^`[^`]+`/, type: "code", color: "green" },
    // Mentions @user
    { regex: /^@\w+/, type: "mention", color: "cyan" },
  ];

  while (remaining.length > 0) {
    let matched = false;

    for (const pattern of patterns) {
      const match = remaining.match(pattern.regex);
      if (match) {
        tokens.push({
          type: pattern.type,
          value: match[0],
          color: pattern.color,
        });
        remaining = remaining.slice(match[0].length);
        _position += match[0].length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Find next special character or take until next potential pattern
      let nextSpecial = remaining.length;
      for (const pattern of patterns) {
        const idx = remaining.slice(1).search(pattern.regex);
        if (idx !== -1 && idx + 1 < nextSpecial) {
          nextSpecial = idx + 1;
        }
      }

      const textPart = remaining.slice(0, nextSpecial);
      if (textPart) {
        // Merge with previous text token if possible
        const lastToken = tokens[tokens.length - 1];
        if (lastToken && lastToken.type === "text") {
          lastToken.value += textPart;
        } else {
          tokens.push({ type: "text", value: textPart });
        }
      }
      remaining = remaining.slice(nextSpecial);
      _position += nextSpecial;
    }
  }

  return tokens;
}

/**
 * Render tokens with cursor
 */
function TokenRenderer({
  tokens,
  cursorPosition,
  showCursor,
}: {
  tokens: Token[];
  cursorPosition: number;
  showCursor: boolean;
}) {
  let charCount = 0;
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const tokenStart = charCount;
    const tokenEnd = charCount + token.value.length;

    if (cursorPosition >= tokenStart && cursorPosition < tokenEnd && showCursor) {
      // Cursor is in this token
      const cursorOffset = cursorPosition - tokenStart;
      const before = token.value.slice(0, cursorOffset);
      const cursorChar = token.value.slice(cursorOffset, cursorOffset + 1) || " ";
      const after = token.value.slice(cursorOffset + 1);

      elements.push(
        <React.Fragment key={i}>
          <Text color={token.color}>{before}</Text>
          <Text backgroundColor="white" color="black">
            {cursorChar}
          </Text>
          <Text color={token.color}>{after}</Text>
        </React.Fragment>
      );
    } else {
      elements.push(
        <Text key={i} color={token.color}>
          {token.value}
        </Text>
      );
    }

    charCount += token.value.length;
  }

  // Cursor at end
  if (cursorPosition >= charCount && showCursor) {
    elements.push(
      <Text key="cursor" backgroundColor="white" color="black">
        {" "}
      </Text>
    );
  }

  return <>{elements}</>;
}

/**
 * History search component
 */
function HistorySearch({
  history,
  query,
  selectedIndex,
  onSelect: _onSelect,
  onClose: _onClose,
}: {
  history: string[];
  query: string;
  selectedIndex: number;
  onSelect: (item: string) => void;
  onClose: () => void;
}) {
  const filteredHistory = useMemo(() => {
    if (!query) return history.slice(-10).reverse();
    return history
      .filter((item) => item.toLowerCase().includes(query.toLowerCase()))
      .slice(-10)
      .reverse();
  }, [history, query]);

  const clampedIndex = Math.min(selectedIndex, filteredHistory.length - 1);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      padding={1}
      marginBottom={1}
    >
      <Box marginBottom={1}>
        <Text color="yellow">History Search (Ctrl+R): </Text>
        <Text>{query}</Text>
        <Text backgroundColor="white" color="black">
          {" "}
        </Text>
      </Box>

      {filteredHistory.length === 0 ? (
        <Text dimColor>No matching history</Text>
      ) : (
        <Box flexDirection="column">
          {filteredHistory.slice(0, 5).map((item, index) => (
            <Box key={index}>
              <Text color={index === clampedIndex ? "cyan" : undefined}>
                {index === clampedIndex ? "❯ " : "  "}
              </Text>
              <Text
                color={index === clampedIndex ? "cyan" : undefined}
                dimColor={index !== clampedIndex}
              >
                {item.length > 60 ? item.slice(0, 57) + "..." : item}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate • Enter select • Esc cancel</Text>
      </Box>
    </Box>
  );
}

/**
 * Keyboard shortcuts hint bar
 */
function ShortcutsHint({ isMultiline }: { isMultiline: boolean }) {
  return (
    <Box marginTop={1}>
      <Text dimColor>
        Enter send • Shift+Enter newline • ↑↓ history • Ctrl+R search
        {isMultiline && " • Ctrl+L clear"}
      </Text>
    </Box>
  );
}

/**
 * Enhanced Chat Input Component
 */
export function EnhancedChatInput({
  input,
  cursorPosition,
  isProcessing,
  isStreaming,
  history = [],
  onHistorySelect,
  showShortcuts = true,
}: EnhancedChatInputProps) {
  const { colors } = useTheme();
  const [historySearchMode, setHistorySearchMode] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyIndex, _setHistoryIndex] = useState(0);

  // Tokenize input
  const tokens = useMemo(() => tokenizeInput(input), [input]);

  // Calculate cursor data for multiline
  const cursorData = useMemo(() => {
    const lines = input.split("\n");
    const isMultiline = lines.length > 1;

    let currentLineIndex = 0;
    let currentCharIndex = 0;
    let totalChars = 0;

    for (let i = 0; i < lines.length; i++) {
      if (totalChars + lines[i].length >= cursorPosition) {
        currentLineIndex = i;
        currentCharIndex = cursorPosition - totalChars;
        break;
      }
      totalChars += lines[i].length + 1;
    }

    return { lines, isMultiline, currentLineIndex, currentCharIndex };
  }, [input, cursorPosition]);

  const showCursor = !isProcessing && !isStreaming;
  const borderColor = isProcessing || isStreaming ? colors.borderBusy : colors.borderActive;
  const promptColor = colors.primary;

  // Handle history search input (managed separately from main input)
  // This is controlled by the parent component through keyboard handling

  // Placeholder
  const placeholderText = "Ask me anything... (try /help for commands)";
  const isPlaceholder = !input;

  // Multiline rendering
  if (cursorData.isMultiline) {
    return (
      <Box flexDirection="column">
        {/* History search overlay */}
        {historySearchMode && (
          <HistorySearch
            history={history}
            query={historyQuery}
            selectedIndex={historyIndex}
            onSelect={(item) => {
              onHistorySelect?.(item);
              setHistorySearchMode(false);
              setHistoryQuery("");
            }}
            onClose={() => {
              setHistorySearchMode(false);
              setHistoryQuery("");
            }}
          />
        )}

        <Box
          borderStyle="round"
          borderColor={borderColor}
          paddingY={0}
          marginTop={1}
          flexDirection="column"
        >
          {cursorData.lines.map((line, index) => {
            const isCurrentLine = index === cursorData.currentLineIndex;
            const promptChar = index === 0 ? "❯" : "│";
            const lineTokens = tokenizeInput(line);

            // Calculate cursor position within this line
            let lineStartPos = 0;
            for (let i = 0; i < index; i++) {
              lineStartPos += cursorData.lines[i].length + 1;
            }
            const lineCursorPos = cursorPosition - lineStartPos;

            return (
              <Box key={index}>
                <Text color={promptColor}>{promptChar} </Text>
                {isCurrentLine ? (
                  <TokenRenderer
                    tokens={lineTokens}
                    cursorPosition={lineCursorPos}
                    showCursor={showCursor}
                  />
                ) : (
                  <TokenRenderer
                    tokens={lineTokens}
                    cursorPosition={-1}
                    showCursor={false}
                  />
                )}
              </Box>
            );
          })}
        </Box>

        {showShortcuts && <ShortcutsHint isMultiline={true} />}
      </Box>
    );
  }

  // Single line rendering
  return (
    <Box flexDirection="column">
      {/* History search overlay */}
      {historySearchMode && (
        <HistorySearch
          history={history}
          query={historyQuery}
          selectedIndex={historyIndex}
          onSelect={(item) => {
            onHistorySelect?.(item);
            setHistorySearchMode(false);
            setHistoryQuery("");
          }}
          onClose={() => {
            setHistorySearchMode(false);
            setHistoryQuery("");
          }}
        />
      )}

      <Box
        borderStyle="round"
        borderColor={borderColor}
        paddingX={1}
        paddingY={0}
        marginTop={1}
      >
        <Box>
          <Text color={promptColor}>❯ </Text>
          {isPlaceholder ? (
            <>
              <Text color={colors.textMuted} dimColor>
                {placeholderText}
              </Text>
              {showCursor && (
                <Text backgroundColor="white" color="black">
                  {" "}
                </Text>
              )}
            </>
          ) : (
            <TokenRenderer
              tokens={tokens}
              cursorPosition={cursorPosition}
              showCursor={showCursor}
            />
          )}
        </Box>
      </Box>

      {showShortcuts && <ShortcutsHint isMultiline={false} />}
    </Box>
  );
}

/**
 * Hook for managing input history
 */
export function useInputHistory(maxSize = 100) {
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedInput, setSavedInput] = useState("");

  const addToHistory = useCallback(
    (input: string) => {
      if (!input.trim()) return;

      setHistory((prev) => {
        // Don't add duplicates of the last entry
        if (prev[prev.length - 1] === input) return prev;

        const newHistory = [...prev, input];
        if (newHistory.length > maxSize) {
          return newHistory.slice(-maxSize);
        }
        return newHistory;
      });
      setHistoryIndex(-1);
      setSavedInput("");
    },
    [maxSize]
  );

  const navigateHistory = useCallback(
    (direction: "up" | "down", currentInput: string) => {
      if (history.length === 0) return null;

      let newIndex: number;

      if (direction === "up") {
        if (historyIndex === -1) {
          // Save current input before navigating
          setSavedInput(currentInput);
          newIndex = history.length - 1;
        } else if (historyIndex > 0) {
          newIndex = historyIndex - 1;
        } else {
          return null; // Already at oldest
        }
      } else {
        // down
        if (historyIndex === -1) {
          return null; // Already at newest
        } else if (historyIndex < history.length - 1) {
          newIndex = historyIndex + 1;
        } else {
          // Return to saved input
          setHistoryIndex(-1);
          return savedInput;
        }
      }

      setHistoryIndex(newIndex);
      return history[newIndex];
    },
    [history, historyIndex, savedInput]
  );

  const searchHistory = useCallback(
    (query: string): string[] => {
      if (!query) return history.slice(-10);
      return history.filter((item) =>
        item.toLowerCase().includes(query.toLowerCase())
      );
    },
    [history]
  );

  const resetNavigation = useCallback(() => {
    setHistoryIndex(-1);
    setSavedInput("");
  }, []);

  return {
    history,
    addToHistory,
    navigateHistory,
    searchHistory,
    resetNavigation,
    historyIndex,
  };
}

export default EnhancedChatInput;
