/**
 * Status Bar Component
 *
 * Displays comprehensive session metrics:
 * - Token usage with progress bar
 * - Cost tracking with budget indicator
 * - Performance metrics (tokens/sec, latency)
 * - Session time
 * - Model info
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../context/theme-context.js';
import { formatTokenCount } from '../../utils/token-counter.js';

/**
 * Props for StatusBar
 */
interface StatusBarProps {
  /** Current token count */
  tokenCount: number;
  /** Maximum tokens allowed (for progress bar) */
  maxTokens?: number;
  /** Current cost in USD */
  cost?: number;
  /** Budget limit in USD */
  budget?: number;
  /** Current model name */
  modelName?: string;
  /** Processing time in seconds */
  processingTime?: number;
  /** Session start time */
  sessionStartTime?: Date;
  /** Show detailed metrics */
  showDetails?: boolean;
  /** Compact mode (single line) */
  compact?: boolean;
}

/**
 * Format duration in human-readable format
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

/**
 * Format cost in USD
 */
function formatCost(cost: number): string {
  if (cost < 0.01) return `$${(cost * 1000).toFixed(2)}m`; // Show in millicents
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Calculate tokens per second
 */
function calculateTokensPerSecond(tokens: number, seconds: number): number {
  if (seconds === 0) return 0;
  return Math.round(tokens / seconds);
}

/**
 * Status Bar Component
 */
export function StatusBar({
  tokenCount,
  maxTokens = 128000,
  cost = 0,
  budget = 10,
  modelName = 'grok-beta',
  processingTime = 0,
  sessionStartTime,
  showDetails = false,
  compact = false,
}: StatusBarProps) {
  const { colors } = useTheme();
  const [sessionDuration, setSessionDuration] = useState(0);

  // Update session duration every second
  useEffect(() => {
    if (!sessionStartTime) return;

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - sessionStartTime.getTime()) / 1000);
      setSessionDuration(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionStartTime]);

  // Calculate metrics
  const metrics = useMemo(() => {
    const tokenProgress = maxTokens > 0 ? (tokenCount / maxTokens) * 100 : 0;
    const costProgress = budget > 0 ? (cost / budget) * 100 : 0;
    const tokensPerSec = calculateTokensPerSecond(tokenCount, processingTime);

    // Determine token usage color based on percentage
    let tokenColor: string;
    if (tokenProgress < 50) tokenColor = colors.success;
    else if (tokenProgress < 80) tokenColor = colors.warning;
    else tokenColor = colors.error;

    // Determine cost color based on budget
    let costColor: string;
    if (costProgress < 50) costColor = colors.success;
    else if (costProgress < 80) costColor = colors.warning;
    else costColor = colors.error;

    return {
      tokenProgress,
      costProgress,
      tokensPerSec,
      tokenColor,
      costColor,
    };
  }, [tokenCount, maxTokens, cost, budget, processingTime, colors]);

  // Render progress bar
  const renderProgressBar = (progress: number, width: number = 10, color: string = colors.success) => {
    const filledWidth = Math.round((progress / 100) * width);
    const emptyWidth = width - filledWidth;

    const filled = '█'.repeat(Math.max(0, filledWidth));
    const empty = '░'.repeat(Math.max(0, emptyWidth));

    return (
      <>
        <Text color={color}>{filled}</Text>
        <Text dimColor>{empty}</Text>
      </>
    );
  };

  // Compact mode - single line
  if (compact) {
    return (
      <Box borderStyle="single" borderColor={colors.border} paddingX={1}>
        <Text color={colors.textMuted}>
          {modelName}
        </Text>
        <Text dimColor> • </Text>
        <Text color={metrics.tokenColor}>
          {formatTokenCount(tokenCount)}
        </Text>
        <Text dimColor> tokens</Text>
        {cost > 0 && (
          <>
            <Text dimColor> • </Text>
            <Text color={metrics.costColor}>{formatCost(cost)}</Text>
          </>
        )}
        {sessionStartTime && (
          <>
            <Text dimColor> • </Text>
            <Text>{formatDuration(sessionDuration)}</Text>
          </>
        )}
      </Box>
    );
  }

  // Detailed mode
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={colors.border} paddingX={1}>
      {/* Header */}
      <Box>
        <Text bold color={colors.primary}>
          📊 Session Status
        </Text>
        {sessionStartTime && (
          <Text dimColor> • {formatDuration(sessionDuration)}</Text>
        )}
      </Box>

      {/* Token Usage */}
      <Box marginTop={1}>
        <Box width={15}>
          <Text color={colors.textMuted}>Tokens:</Text>
        </Box>
        <Box width={12}>
          {renderProgressBar(metrics.tokenProgress, 10, metrics.tokenColor)}
        </Box>
        <Text color={metrics.tokenColor}> {formatTokenCount(tokenCount)}</Text>
        <Text dimColor>/{formatTokenCount(maxTokens)}</Text>
        <Text dimColor> ({metrics.tokenProgress.toFixed(0)}%)</Text>
      </Box>

      {/* Cost Tracking */}
      {cost > 0 && (
        <Box>
          <Box width={15}>
            <Text color={colors.textMuted}>Cost:</Text>
          </Box>
          <Box width={12}>
            {renderProgressBar(metrics.costProgress, 10, metrics.costColor)}
          </Box>
          <Text color={metrics.costColor}> {formatCost(cost)}</Text>
          <Text dimColor>/{formatCost(budget)}</Text>
          <Text dimColor> ({metrics.costProgress.toFixed(0)}%)</Text>
        </Box>
      )}

      {/* Performance Metrics */}
      {showDetails && (
        <>
          <Box>
            <Box width={15}>
              <Text color={colors.textMuted}>Model:</Text>
            </Box>
            <Text>{modelName}</Text>
          </Box>

          {processingTime > 0 && (
            <>
              <Box>
                <Box width={15}>
                  <Text color={colors.textMuted}>Speed:</Text>
                </Box>
                <Text color={colors.success}>{metrics.tokensPerSec}</Text>
                <Text dimColor> tokens/sec</Text>
              </Box>

              <Box>
                <Box width={15}>
                  <Text color={colors.textMuted}>Latency:</Text>
                </Box>
                <Text>{processingTime}</Text>
                <Text dimColor>s</Text>
              </Box>
            </>
          )}
        </>
      )}

      {/* Budget Warning */}
      {metrics.costProgress > 80 && (
        <Box marginTop={1}>
          <Text color={colors.warning}>⚠ Approaching budget limit</Text>
        </Box>
      )}

      {/* Token Warning */}
      {metrics.tokenProgress > 80 && (
        <Box>
          <Text color={colors.warning}>⚠ High token usage</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Mini Status Bar - For inline display in chat interface
 */
export function MiniStatusBar({
  tokenCount,
  cost,
  modelName,
}: {
  tokenCount: number;
  cost?: number;
  modelName?: string;
}) {
  const { colors } = useTheme();

  return (
    <Box>
      {modelName && (
        <>
          <Text color={colors.accent}>≋ {modelName}</Text>
          <Text dimColor> • </Text>
        </>
      )}
      <Text color={colors.info}>↑ {formatTokenCount(tokenCount)}</Text>
      {cost !== undefined && cost > 0 && (
        <>
          <Text dimColor> • </Text>
          <Text color={colors.success}>{formatCost(cost)}</Text>
        </>
      )}
    </Box>
  );
}

export default StatusBar;
