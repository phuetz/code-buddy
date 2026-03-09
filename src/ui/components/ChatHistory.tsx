import React, { useMemo, useState, useEffect } from "react";
import { Box, Text, Static } from "ink";
import { ChatEntry } from "../../agent/codebuddy-agent.js";
import { DiffRenderer } from "./DiffRenderer.js";
import { MarkdownRenderer } from "../utils/markdown-renderer.js";
import { useTheme } from "../context/theme-context.js";
import { ThemeColors, AvatarConfig } from "../../themes/theme.js";
import { getRenderManager, isTestResultsData, isWeatherData, isCodeStructureData } from "../../renderers/index.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { Divider } from "./EnhancedSpinners.js";
import { ReasoningBlock } from "./ReasoningBlock.js";
import { ToolStreamOutput } from "./ToolStreamOutput.js";
import { logger } from "../../utils/logger.js";

interface ChatHistoryProps {
  entries: ChatEntry[];
  isConfirmationActive?: boolean;
  /** Maximum number of messages to display (default: 50) */
  maxMessages?: number;
}

interface MemoizedChatEntryProps {
  entry: ChatEntry;
  index: number;
  colors: ThemeColors;
  avatars: AvatarConfig;
}

// ============================================================================
// Structured Data Detection & Rendering
// ============================================================================

/**
 * Try to parse content as structured data and render it appropriately
 * Returns null if content is not recognized structured data
 */
function tryRenderStructuredData(content: string): string | null {
  try {
    const parsed = JSON.parse(content);
    const manager = getRenderManager();

    // Check if it's a known structured data type
    if (isTestResultsData(parsed) || isWeatherData(parsed) || isCodeStructureData(parsed)) {
      try {
        return manager.render(parsed);
      } catch (renderError) {
        // Render error - return error message instead of crashing
        logger.error('Error rendering structured data', renderError as Error);
        return '⚠ Error rendering structured output';
      }
    }

    // Check if manager can render it (generic check)
    if (manager.canRender(parsed)) {
      try {
        return manager.render(parsed);
      } catch (renderError) {
        // Render error - return error message instead of crashing
        logger.error('Error rendering data', renderError as Error);
        return '⚠ Error rendering output';
      }
    }
  } catch (_err) {
    // Intentionally ignored: content is not valid JSON, so it is not structured data
  }
  return null;
}

/**
 * Component to render structured output with proper line handling
 */
function StructuredContent({ content, color }: { content: string; color?: string }) {
  try {
    const lines = content.split('\n');
    return (
      <Box flexDirection="column">
        {lines.map((line, idx) => (
          <Text key={idx} color={color}>{line}</Text>
        ))}
      </Box>
    );
  } catch (_err) {
    // Intentionally ignored: content rendering may fail for malformed data, show error UI
    return (
      <Text color="yellow">
        ⚠ Error rendering structured content
      </Text>
    );
  }
}

// Memoized ChatEntry component to prevent unnecessary re-renders
const MemoizedChatEntry = React.memo(
  ({ entry, index, colors, avatars }: MemoizedChatEntryProps) => {
    const renderDiff = (diffContent: string, filename?: string) => {
      return (
        <ErrorBoundary
          fallback={
            <Text color="yellow">⚠ Error rendering diff (content too large or invalid format)</Text>
          }
          showDetails={false}
        >
          <DiffRenderer
            diffContent={diffContent}
            filename={filename}
            terminalWidth={80}
          />
        </ErrorBoundary>
      );
    };

    const renderFileContent = (content: string) => {
      try {
        const lines = content.split("\n");

        // Calculate minimum indentation like DiffRenderer does
        let baseIndentation = Infinity;
        for (const line of lines) {
          if (line.trim() === "") continue;
          const firstCharIndex = line.search(/\S/);
          const currentIndent = firstCharIndex === -1 ? 0 : firstCharIndex;
          baseIndentation = Math.min(baseIndentation, currentIndent);
        }
        if (!isFinite(baseIndentation)) {
          baseIndentation = 0;
        }

        return lines.map((line, index) => {
          const displayContent = line.substring(baseIndentation);
          return (
            <Text key={index} color="gray">
              {displayContent}
            </Text>
          );
        });
      } catch (_err) {
        // Intentionally ignored: file content rendering can fail for large or binary files
        return (
          <Text color="yellow">
            ⚠ Error rendering file content (file too large or invalid format)
          </Text>
        );
      }
    };

    switch (entry.type) {
      case "user":
        return (
          <Box key={index} flexDirection="column" marginTop={1}>
            <Divider color={colors.border} title="You" />
            <Box paddingLeft={1}>
              <Text color={colors.userMessage}>
                {avatars.user} {entry.content}
              </Text>
            </Box>
          </Box>
        );

      case "assistant":
        return (
          <Box key={index} flexDirection="column" marginTop={1}>
            <Divider color={colors.border} title="Code Buddy" />
            <Box flexDirection="row" alignItems="flex-start" paddingLeft={1}>
              <Text color={colors.assistantMessage}>{avatars.assistant} </Text>
              <Box flexDirection="column" flexGrow={1}>
                {entry.toolCalls ? (
                  // If there are tool calls, just show plain text
                  <Text color={colors.assistantMessage}>{entry.content.trim()}</Text>
                ) : (
                  // If no tool calls, render as markdown
                  // Pass isStreaming to handle incomplete tables properly
                  <MarkdownRenderer content={entry.content.trim()} isStreaming={entry.isStreaming} />
                )}
                {entry.isStreaming && <Text color={colors.info}>█</Text>}
              </Box>
            </Box>
          </Box>
        );

      case "reasoning":
        return (
          <Box key={index} flexDirection="column">
            <ReasoningBlock content={entry.content} isStreaming={entry.isStreaming} />
          </Box>
        );

      case "plan_progress":
        return (
          <Box key={index} flexDirection="column" marginTop={1}>
            <Box paddingLeft={1}>
              <Text color={colors.info}>
                {avatars.tool} Plan: {entry.content}
              </Text>
            </Box>
          </Box>
        );

      case "tool_call":
      case "tool_result":
        const getToolActionName = (toolName: string) => {
          // Handle MCP tools with mcp__servername__toolname format
          if (toolName.startsWith("mcp__")) {
            const parts = toolName.split("__");
            if (parts.length >= 3) {
              const serverName = parts[1];
              const actualToolName = parts.slice(2).join("__");
              return `${serverName.charAt(0).toUpperCase() + serverName.slice(1)}(${actualToolName.replace(/_/g, " ")})`;
            }
          }

          switch (toolName) {
            case "view_file":
              return "Read";
            case "str_replace_editor":
              return "Update";
            case "create_file":
              return "Create";
            case "bash":
              return "Bash";
            case "search":
              return "Search";
            case "create_todo_list":
              return "Created Todo";
            case "update_todo_list":
              return "Updated Todo";
            default:
              return "Tool";
          }
        };

        const toolName = entry.toolCall?.function?.name || "unknown";
        const actionName = getToolActionName(toolName);

        const getFilePath = (toolCall: { function?: { name?: string; arguments?: string } } | undefined) => {
          if (toolCall?.function?.arguments) {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              if (toolCall.function.name === "search") {
                return args.query;
              }
              return args.path || args.file_path || args.command || "";
            } catch (_err) {
              // Intentionally ignored: tool call arguments may not be valid JSON
              return "";
            }
          }
          return "";
        };

        const filePath = getFilePath(entry.toolCall);
        const isExecuting = entry.type === "tool_call" || !entry.toolResult;
        
        // Format JSON content for better readability
        const formatToolContent = (content: string, toolName: string): { text: string; isStructured: boolean } => {
          try {
            // First, try to render as structured data
            const structuredOutput = tryRenderStructuredData(content);
            if (structuredOutput) {
              return { text: structuredOutput, isStructured: true };
            }

            if (toolName.startsWith("mcp__")) {
              try {
                // Try to parse as JSON and format it
                const parsed = JSON.parse(content);
                if (Array.isArray(parsed)) {
                  // For arrays, show a summary instead of full JSON
                  return { text: `Found ${parsed.length} items`, isStructured: false };
                } else if (typeof parsed === 'object') {
                  // For objects, show a formatted version
                  return { text: JSON.stringify(parsed, null, 2), isStructured: false };
                }
              } catch (_err) {
                // Intentionally ignored: content is not valid JSON, return as plain text
                return { text: content, isStructured: false };
              }
            }
            return { text: content, isStructured: false };
          } catch (error) {
            // Fallback for any unexpected errors
            logger.error('Error formatting tool content', error as Error);
            return { text: '⚠ Error formatting tool output', isStructured: false };
          }
        };
        const shouldShowDiff =
          entry.toolCall?.function?.name === "str_replace_editor" &&
          entry.toolResult?.success &&
          entry.content.includes("Updated") &&
          entry.content.includes("---") &&
          entry.content.includes("+++");

        const shouldShowFileContent =
          (entry.toolCall?.function?.name === "view_file" ||
            entry.toolCall?.function?.name === "create_file") &&
          entry.toolResult?.success &&
          !shouldShowDiff;

        return (
          <Box key={index} flexDirection="column" marginTop={1}>
            <Box>
              <Text color={colors.toolCall}>{avatars.tool}</Text>
              <Text color={colors.text}>
                {" "}
                {filePath ? `${actionName}(${filePath})` : actionName}
              </Text>
            </Box>
            <Box marginLeft={2} flexDirection="column">
              {isExecuting && entry.isStreaming && entry.content !== 'Executing...' ? (
                <ToolStreamOutput
                  output={entry.content}
                  toolName={toolName}
                  isStreaming={true}
                />
              ) : isExecuting ? (
                <Text color={colors.info}>⎿ Executing...</Text>
              ) : shouldShowFileContent ? (
                <Box flexDirection="column">
                  <Text color={colors.toolResult}>⎿ File contents:</Text>
                  <Box marginLeft={2} flexDirection="column">
                    {renderFileContent(entry.content)}
                  </Box>
                </Box>
              ) : shouldShowDiff ? (
                // For diff results, show only the summary line, not the raw content
                <Text color={colors.toolResult}>⎿ {entry.content.split("\n")[0]}</Text>
              ) : (() => {
                const formatted = formatToolContent(entry.content, toolName);
                if (formatted.isStructured) {
                  return (
                    <ErrorBoundary
                      fallback={
                        <Text color="yellow">⎿ ⚠ Error displaying structured output</Text>
                      }
                      showDetails={false}
                    >
                      <Box flexDirection="column">
                        <Text color={colors.toolResult}>⎿ Structured output:</Text>
                        <Box marginLeft={2}>
                          <StructuredContent content={formatted.text} />
                        </Box>
                      </Box>
                    </ErrorBoundary>
                  );
                }
                return <Text color={colors.toolResult}>⎿ {formatted.text}</Text>;
              })()}
            </Box>
            {shouldShowDiff && !isExecuting && (
              <Box marginLeft={4} flexDirection="column">
                {renderDiff(entry.content, filePath)}
              </Box>
            )}
          </Box>
        );

      default:
        return null;
    }
  }
);

MemoizedChatEntry.displayName = "MemoizedChatEntry";

export function ChatHistory({
  entries,
  isConfirmationActive = false,
  maxMessages = 50,
}: ChatHistoryProps) {
  const { colors, avatars } = useTheme();

  // Number of entries permanently committed to <Static> (monotonically increasing)
  // Entries start in the dynamic section and move to static AFTER being finalized
  // for at least one render cycle. This prevents duplicate rendering during the
  // dynamic → static transition (especially on Windows terminals).
  const [committedCount, setCommittedCount] = useState(0);

  // Filter out tool_call entries with "Executing..." when confirmation is active
  const allEntries = useMemo(() => {
    return isConfirmationActive
      ? entries.filter(
          (entry) =>
            !(entry.type === "tool_call" && entry.content === "Executing...")
        )
      : entries;
  }, [entries, isConfirmationActive]);

  // If entries shrunk (shouldn't happen normally), cap committedCount
  const safeCommitted = Math.min(committedCount, allEntries.length);

  // Static entries: [0, safeCommitted) — already written permanently to stdout
  // These are never windowed because they're already in the terminal scrollback
  const staticItems = useMemo(() => {
    return allEntries.slice(0, safeCommitted).map((entry, index) => ({
      ...entry,
      uniqueKey: `s-${entry.timestamp.getTime()}-${index}`,
    }));
  }, [allEntries, safeCommitted]);

  // Dynamic entries: [safeCommitted, end) — managed by Ink's live viewport
  // Apply windowing only to the dynamic portion to prevent perf issues
  const dynamicItems = useMemo(() => {
    const remaining = allEntries.slice(safeCommitted);
    const windowSize = Math.max(10, Math.min(maxMessages, 100));
    const windowed = remaining.length > windowSize
      ? remaining.slice(-windowSize)
      : remaining;
    return windowed.map((entry, index) => ({
      ...entry,
      uniqueKey: `d-${entry.timestamp.getTime()}-${safeCommitted + index}`,
    }));
  }, [allEntries, safeCommitted, maxMessages]);

  // After each render, commit consecutive finalized entries from the dynamic
  // section to static. This ensures entries are fully rendered in dynamic
  // before moving to static, preventing the duplicate-render flash.
  useEffect(() => {
    let newCommitted = safeCommitted;
    while (newCommitted < allEntries.length) {
      const entry = allEntries[newCommitted];
      const isStable = !entry.isStreaming &&
        !(entry.type === "tool_call" && entry.content === "Executing...");
      if (isStable) {
        newCommitted++;
      } else {
        break;
      }
    }
    if (newCommitted > safeCommitted) {
      setCommittedCount(newCommitted);
    }
  }, [allEntries, safeCommitted]);

  // Calculate truncation for display
  const truncatedDynamic = allEntries.length - safeCommitted - dynamicItems.length;

  return (
    <Box flexDirection="column">
      {/* Truncation indicator for dynamic windowing */}
      {truncatedDynamic > 0 && (
        <Box marginBottom={1}>
          <Text color="gray" dimColor>
            ··· {truncatedDynamic} message{truncatedDynamic !== 1 ? 's' : ''} in scrollback
          </Text>
        </Box>
      )}

      {/* Static: permanently rendered entries (written once to stdout, never re-rendered) */}
      <Static items={staticItems}>
        {(entry) => (
          <MemoizedChatEntry
            key={entry.uniqueKey}
            entry={entry}
            index={0}
            colors={colors}
            avatars={avatars}
          />
        )}
      </Static>

      {/* Dynamic: live entries managed by Ink (streaming, pending, or not yet committed) */}
      {dynamicItems.map((entry, index) => (
        <MemoizedChatEntry
          key={entry.uniqueKey}
          entry={entry}
          index={index}
          colors={colors}
          avatars={avatars}
        />
      ))}
    </Box>
  );
}
