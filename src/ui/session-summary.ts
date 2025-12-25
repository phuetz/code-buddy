/**
 * Session Summary Generator
 *
 * Provides end-of-session summaries including:
 * - Task accomplishments
 * - Tool usage statistics
 * - Token/cost metrics
 * - Duration and performance
 */

export interface ToolUsage {
  name: string;
  calls: number;
  successCount: number;
  failureCount: number;
  totalDurationMs: number;
}

export interface SessionMetrics {
  startTime: Date;
  endTime: Date;
  durationMs: number;
  messageCount: {
    user: number;
    assistant: number;
    total: number;
  };
  tokenCount: {
    input: number;
    output: number;
    total: number;
  };
  cost: {
    input: number;
    output: number;
    total: number;
  };
  toolUsage: ToolUsage[];
  filesModified: string[];
  filesCreated: string[];
  errors: number;
  checkpointsCreated: number;
}

export interface SessionSummary {
  metrics: SessionMetrics;
  highlights: string[];
  warnings: string[];
  suggestions: string[];
}

/**
 * Generate session summary from metrics
 */
export function generateSessionSummary(metrics: SessionMetrics): SessionSummary {
  const highlights: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  // Duration analysis
  const durationMins = Math.round(metrics.durationMs / 60000);
  highlights.push(`Session lasted ${formatDuration(metrics.durationMs)}`);

  // Message analysis
  highlights.push(`${metrics.messageCount.total} messages exchanged`);

  // Tool usage analysis
  const totalToolCalls = metrics.toolUsage.reduce((sum, t) => sum + t.calls, 0);
  if (totalToolCalls > 0) {
    highlights.push(`${totalToolCalls} tool calls executed`);

    // Find most used tool
    const mostUsed = metrics.toolUsage.reduce((max, t) =>
      t.calls > max.calls ? t : max, metrics.toolUsage[0]);
    if (mostUsed && mostUsed.calls > 1) {
      highlights.push(`Most used tool: ${mostUsed.name} (${mostUsed.calls}x)`);
    }

    // Check for failures
    const failedTools = metrics.toolUsage.filter(t => t.failureCount > 0);
    if (failedTools.length > 0) {
      const totalFailures = failedTools.reduce((sum, t) => sum + t.failureCount, 0);
      warnings.push(`${totalFailures} tool calls failed`);
    }
  }

  // File operations
  if (metrics.filesCreated.length > 0) {
    highlights.push(`Created ${metrics.filesCreated.length} file(s)`);
  }
  if (metrics.filesModified.length > 0) {
    highlights.push(`Modified ${metrics.filesModified.length} file(s)`);
  }

  // Token/cost analysis
  if (metrics.cost.total > 0) {
    highlights.push(`Session cost: $${metrics.cost.total.toFixed(4)}`);

    if (metrics.cost.total > 1.0) {
      warnings.push('High session cost - consider using smaller models for simple tasks');
    }
  }

  // Checkpoints
  if (metrics.checkpointsCreated > 0) {
    highlights.push(`${metrics.checkpointsCreated} checkpoint(s) created`);
  }

  // Errors
  if (metrics.errors > 0) {
    warnings.push(`${metrics.errors} error(s) occurred during session`);
  }

  // Suggestions based on usage patterns
  if (metrics.tokenCount.input > 100000) {
    suggestions.push('Large input token count - consider summarizing context');
  }

  if (durationMins > 30 && metrics.checkpointsCreated === 0) {
    suggestions.push('Long session without checkpoints - consider using /checkpoint regularly');
  }

  const avgToolDuration = totalToolCalls > 0
    ? metrics.toolUsage.reduce((sum, t) => sum + t.totalDurationMs, 0) / totalToolCalls
    : 0;
  if (avgToolDuration > 5000) {
    suggestions.push('Slow tool execution detected - check network or complex operations');
  }

  return { metrics, highlights, warnings, suggestions };
}

/**
 * Format session summary for display
 */
export function formatSessionSummary(summary: SessionSummary): string {
  const lines: string[] = [
    '',
    '═══════════════════════════════════════',
    '          SESSION SUMMARY',
    '═══════════════════════════════════════',
    '',
  ];

  // Duration
  const { metrics } = summary;
  lines.push(`Duration: ${formatDuration(metrics.durationMs)}`);
  lines.push(`Started: ${metrics.startTime.toLocaleString()}`);
  lines.push('');

  // Highlights
  if (summary.highlights.length > 0) {
    lines.push('Highlights:');
    for (const h of summary.highlights) {
      lines.push(`  ✓ ${h}`);
    }
    lines.push('');
  }

  // Tool usage breakdown
  if (metrics.toolUsage.length > 0) {
    lines.push('Tool Usage:');
    const sortedTools = [...metrics.toolUsage].sort((a, b) => b.calls - a.calls);
    for (const tool of sortedTools.slice(0, 5)) {
      const successRate = tool.calls > 0
        ? Math.round((tool.successCount / tool.calls) * 100)
        : 0;
      lines.push(`  ${tool.name}: ${tool.calls}x (${successRate}% success)`);
    }
    if (sortedTools.length > 5) {
      lines.push(`  ... and ${sortedTools.length - 5} more`);
    }
    lines.push('');
  }

  // Token/Cost
  if (metrics.tokenCount.total > 0) {
    lines.push('Token Usage:');
    lines.push(`  Input: ${formatNumber(metrics.tokenCount.input)}`);
    lines.push(`  Output: ${formatNumber(metrics.tokenCount.output)}`);
    lines.push(`  Total: ${formatNumber(metrics.tokenCount.total)}`);
    lines.push('');
  }

  if (metrics.cost.total > 0) {
    lines.push(`Cost: $${metrics.cost.total.toFixed(4)}`);
    lines.push('');
  }

  // Warnings
  if (summary.warnings.length > 0) {
    lines.push('Warnings:');
    for (const w of summary.warnings) {
      lines.push(`  ⚠ ${w}`);
    }
    lines.push('');
  }

  // Suggestions
  if (summary.suggestions.length > 0) {
    lines.push('Suggestions:');
    for (const s of summary.suggestions) {
      lines.push(`  → ${s}`);
    }
    lines.push('');
  }

  lines.push('═══════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Format compact session summary (one line)
 */
export function formatCompactSummary(summary: SessionSummary): string {
  const { metrics } = summary;
  const parts: string[] = [];

  parts.push(formatDuration(metrics.durationMs));
  parts.push(`${metrics.messageCount.total} msgs`);

  const toolCalls = metrics.toolUsage.reduce((sum, t) => sum + t.calls, 0);
  if (toolCalls > 0) {
    parts.push(`${toolCalls} tools`);
  }

  if (metrics.cost.total > 0) {
    parts.push(`$${metrics.cost.total.toFixed(3)}`);
  }

  return parts.join(' | ');
}

/**
 * Format duration in human readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;

  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);

  if (mins < 60) {
    return `${mins}m ${secs}s`;
  }

  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

/**
 * Format large numbers with K/M suffixes
 */
function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1000000).toFixed(2)}M`;
}

/**
 * Create metrics from session data
 */
export function createSessionMetrics(data: {
  startTime: Date;
  messages: Array<{ type: string; tokenCount?: number }>;
  toolCalls: Array<{ name: string; success: boolean; durationMs: number }>;
  filesModified: string[];
  filesCreated: string[];
  errors: number;
  checkpoints: number;
  inputTokens: number;
  outputTokens: number;
  costPerInputToken: number;
  costPerOutputToken: number;
}): SessionMetrics {
  const endTime = new Date();

  // Aggregate tool usage
  const toolMap = new Map<string, ToolUsage>();
  for (const call of data.toolCalls) {
    let usage = toolMap.get(call.name);
    if (!usage) {
      usage = {
        name: call.name,
        calls: 0,
        successCount: 0,
        failureCount: 0,
        totalDurationMs: 0,
      };
      toolMap.set(call.name, usage);
    }
    usage.calls++;
    if (call.success) {
      usage.successCount++;
    } else {
      usage.failureCount++;
    }
    usage.totalDurationMs += call.durationMs;
  }

  const userMessages = data.messages.filter(m => m.type === 'user').length;
  const assistantMessages = data.messages.filter(m => m.type === 'assistant').length;

  return {
    startTime: data.startTime,
    endTime,
    durationMs: endTime.getTime() - data.startTime.getTime(),
    messageCount: {
      user: userMessages,
      assistant: assistantMessages,
      total: data.messages.length,
    },
    tokenCount: {
      input: data.inputTokens,
      output: data.outputTokens,
      total: data.inputTokens + data.outputTokens,
    },
    cost: {
      input: data.inputTokens * data.costPerInputToken,
      output: data.outputTokens * data.costPerOutputToken,
      total: (data.inputTokens * data.costPerInputToken) + (data.outputTokens * data.costPerOutputToken),
    },
    toolUsage: Array.from(toolMap.values()),
    filesModified: data.filesModified,
    filesCreated: data.filesCreated,
    errors: data.errors,
    checkpointsCreated: data.checkpoints,
  };
}

export default generateSessionSummary;
