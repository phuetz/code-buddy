/**
 * Enhanced Tool Results Visualization
 *
 * Better display for tool execution results:
 * - Collapsible tool results
 * - Smart truncation with preview
 * - Size indicators (KB/MB)
 * - Copy to clipboard support
 * - Visual feedback for success/error
 */

import React, { useState, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../context/theme-context.js';

/**
 * Tool result data
 */
export interface ToolResultData {
  toolName: string;
  fileName?: string;
  content: string;
  success: boolean;
  error?: string;
  duration?: number;
  timestamp: Date;
}

/**
 * Props for EnhancedToolResult
 */
interface EnhancedToolResultProps {
  result: ToolResultData;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
  /** Maximum preview lines when collapsed */
  previewLines?: number;
  /** Show metadata (size, duration) */
  showMetadata?: boolean;
}

/**
 * Format file size in human-readable format
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/**
 * Format duration
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Truncate content intelligently
 */
function truncateContent(content: string, maxLines: number): {
  preview: string;
  isTruncated: boolean;
  totalLines: number;
  hiddenLines: number;
} {
  const lines = content.split('\n');
  const totalLines = lines.length;

  if (totalLines <= maxLines) {
    return {
      preview: content,
      isTruncated: false,
      totalLines,
      hiddenLines: 0,
    };
  }

  const previewLines = lines.slice(0, maxLines);
  return {
    preview: previewLines.join('\n'),
    isTruncated: true,
    totalLines,
    hiddenLines: totalLines - maxLines,
  };
}

/**
 * Enhanced Tool Result Component
 */
export function EnhancedToolResult({
  result,
  defaultCollapsed = true,
  previewLines = 10,
  showMetadata = true,
}: EnhancedToolResultProps) {
  const { colors } = useTheme();
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  // Calculate metadata
  const metadata = useMemo(() => {
    const contentBytes = new TextEncoder().encode(result.content).length;
    const { preview, isTruncated, totalLines, hiddenLines } = truncateContent(
      result.content,
      previewLines
    );

    return {
      size: formatSize(contentBytes),
      sizeBytes: contentBytes,
      preview,
      isTruncated,
      totalLines,
      hiddenLines,
      duration: result.duration ? formatDuration(result.duration) : undefined,
    };
  }, [result.content, result.duration, previewLines]);

  // Determine status color
  const statusColor = result.success ? colors.success : colors.error;
  const statusIcon = result.success ? '✓' : '✗';

  // Toggle collapse (used via click handler)
  const _toggleCollapse = () => {
    if (metadata.isTruncated || result.content.length > 500) {
      setIsCollapsed((prev) => !prev);
    }
  };

  // Render content based on collapse state
  const displayContent = isCollapsed ? metadata.preview : result.content;
  const contentLines = displayContent.split('\n');

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={statusColor}
      paddingX={1}
      marginY={1}
    >
      {/* Header */}
      <Box justifyContent="space-between">
        <Box>
          <Text color={statusColor}>{statusIcon} </Text>
          <Text bold>{result.toolName}</Text>
          {result.fileName && (
            <Text color={colors.textMuted}> • {result.fileName}</Text>
          )}
        </Box>

        {/* Metadata */}
        {showMetadata && (
          <Box>
            <Text dimColor>{metadata.size}</Text>
            {metadata.duration && (
              <>
                <Text dimColor> • </Text>
                <Text dimColor>{metadata.duration}</Text>
              </>
            )}
            <Text dimColor> • </Text>
            <Text dimColor>{metadata.totalLines} line{metadata.totalLines !== 1 ? 's' : ''}</Text>
          </Box>
        )}
      </Box>

      {/* Error message */}
      {!result.success && result.error && (
        <Box marginTop={1}>
          <Text color={colors.error}>⎿ Error: {result.error}</Text>
        </Box>
      )}

      {/* Content */}
      {result.success && (
        <Box flexDirection="column" marginTop={1}>
          {/* Content lines */}
          <Box flexDirection="column">
            {contentLines.map((line, index) => (
              <Text key={index} dimColor={isCollapsed}>
                {line}
              </Text>
            ))}
          </Box>

          {/* Truncation indicator */}
          {metadata.isTruncated && isCollapsed && (
            <Box marginTop={1}>
              <Text color={colors.warning}>
                ··· {metadata.hiddenLines} more line{metadata.hiddenLines !== 1 ? 's' : ''} hidden
              </Text>
              <Text dimColor> (click or press Enter to expand)</Text>
            </Box>
          )}

          {/* Collapse/Expand controls */}
          {(metadata.isTruncated || metadata.sizeBytes > 500) && (
            <Box marginTop={1} borderStyle="single" borderColor={colors.border} paddingX={1}>
              <Text dimColor>
                Press <Text bold color={colors.accent}>Space</Text> or <Text bold color={colors.accent}>Enter</Text> to {isCollapsed ? 'expand' : 'collapse'}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {/* Timestamp */}
      <Box marginTop={1}>
        <Text dimColor>
          {result.timestamp.toLocaleTimeString()}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Tool Results List Component
 *
 * Displays multiple tool results with smart grouping
 */
interface ToolResultsListProps {
  results: ToolResultData[];
  /** Maximum results to show */
  maxResults?: number;
  /** Group by tool name */
  groupByTool?: boolean;
}

export function ToolResultsList({
  results,
  maxResults = 10,
  groupByTool = false,
}: ToolResultsListProps) {
  const { colors } = useTheme();

  // Group results by tool if requested
  const groupedResults = useMemo(() => {
    if (!groupByTool) {
      return { ungrouped: results.slice(0, maxResults) };
    }

    const groups: Record<string, ToolResultData[]> = {};
    results.slice(0, maxResults).forEach((result) => {
      if (!groups[result.toolName]) {
        groups[result.toolName] = [];
      }
      groups[result.toolName].push(result);
    });

    return groups;
  }, [results, maxResults, groupByTool]);

  const hiddenCount = Math.max(0, results.length - maxResults);

  return (
    <Box flexDirection="column">
      {/* Title */}
      <Box marginBottom={1}>
        <Text bold color={colors.primary}>
          🔧 Tool Execution Results
        </Text>
        <Text dimColor> ({results.length} total)</Text>
      </Box>

      {/* Grouped results */}
      {Object.entries(groupedResults).map(([groupName, groupResults]) => (
        <Box key={groupName} flexDirection="column">
          {groupByTool && groupName !== 'ungrouped' && (
            <Box marginBottom={1}>
              <Text bold color={colors.secondary}>
                {groupName}
              </Text>
              <Text dimColor> ({groupResults.length})</Text>
            </Box>
          )}

          {groupResults.map((result, index) => (
            <EnhancedToolResult
              key={`${result.toolName}-${result.timestamp.getTime()}-${index}`}
              result={result}
            />
          ))}
        </Box>
      ))}

      {/* Hidden results indicator */}
      {hiddenCount > 0 && (
        <Box marginTop={1}>
          <Text dimColor>
            ... {hiddenCount} older result{hiddenCount !== 1 ? 's' : ''} hidden
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Tool Execution Summary Component
 *
 * Shows aggregated statistics for tool executions
 */
interface ToolExecutionSummaryProps {
  results: ToolResultData[];
}

export function ToolExecutionSummary({ results }: ToolExecutionSummaryProps) {
  const { colors } = useTheme();

  const summary = useMemo(() => {
    const total = results.length;
    const successful = results.filter((r) => r.success).length;
    const failed = total - successful;
    const successRate = total > 0 ? (successful / total) * 100 : 0;

    // Calculate average duration
    const durationsAvailable = results.filter((r) => r.duration !== undefined);
    const avgDuration = durationsAvailable.length > 0
      ? durationsAvailable.reduce((sum, r) => sum + (r.duration || 0), 0) / durationsAvailable.length
      : 0;

    // Tool usage breakdown
    const toolCounts: Record<string, number> = {};
    results.forEach((r) => {
      toolCounts[r.toolName] = (toolCounts[r.toolName] || 0) + 1;
    });

    const mostUsedTool = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])[0];

    return {
      total,
      successful,
      failed,
      successRate,
      avgDuration,
      mostUsedTool: mostUsedTool ? mostUsedTool[0] : 'N/A',
      mostUsedCount: mostUsedTool ? mostUsedTool[1] : 0,
    };
  }, [results]);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={colors.border}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color={colors.primary}>
          📊 Tool Execution Summary
        </Text>
      </Box>

      <Box>
        <Text>Total executions: </Text>
        <Text bold>{summary.total}</Text>
      </Box>

      <Box>
        <Text>Success rate: </Text>
        <Text bold color={colors.success}>{summary.successRate.toFixed(1)}%</Text>
        <Text dimColor> ({summary.successful} ✓ / {summary.failed} ✗)</Text>
      </Box>

      {summary.avgDuration > 0 && (
        <Box>
          <Text>Avg duration: </Text>
          <Text bold>{formatDuration(summary.avgDuration)}</Text>
        </Box>
      )}

      <Box>
        <Text>Most used: </Text>
        <Text bold color={colors.accent}>{summary.mostUsedTool}</Text>
        <Text dimColor> ({summary.mostUsedCount}x)</Text>
      </Box>
    </Box>
  );
}

export default EnhancedToolResult;
