/**
 * Usage Statistics Display
 *
 * Shows comprehensive usage statistics:
 * - Historical usage trends
 * - Cost breakdown
 * - Tool popularity
 * - Session patterns
 */

export interface DailyUsage {
  date: string;
  sessions: number;
  messages: number;
  toolCalls: number;
  tokens: number;
  cost: number;
}

export interface UsageStats {
  // Totals
  totalSessions: number;
  totalMessages: number;
  totalToolCalls: number;
  totalTokens: number;
  totalCost: number;

  // Averages
  avgSessionDuration: number;
  avgMessagesPerSession: number;
  avgCostPerSession: number;

  // Time-based
  dailyUsage: DailyUsage[];
  peakHours: number[];

  // Tool breakdown
  toolBreakdown: Array<{
    name: string;
    calls: number;
    percentage: number;
    avgDuration: number;
  }>;

  // Model breakdown
  modelBreakdown: Array<{
    model: string;
    sessions: number;
    tokens: number;
    cost: number;
  }>;

  // Trends
  trend: {
    usage: 'increasing' | 'stable' | 'decreasing';
    cost: 'increasing' | 'stable' | 'decreasing';
  };
}

/**
 * Format usage statistics for terminal display
 */
export function formatUsageStatistics(stats: UsageStats): string {
  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════════',
    '              USAGE STATISTICS',
    '═══════════════════════════════════════════════════',
    '',
  ];

  // Overview
  lines.push('OVERVIEW');
  lines.push('─────────────────────────────────────────────────');
  lines.push(`  Sessions:     ${stats.totalSessions}`);
  lines.push(`  Messages:     ${formatNumber(stats.totalMessages)}`);
  lines.push(`  Tool Calls:   ${formatNumber(stats.totalToolCalls)}`);
  lines.push(`  Tokens:       ${formatNumber(stats.totalTokens)}`);
  lines.push(`  Total Cost:   $${stats.totalCost.toFixed(2)}`);
  lines.push('');

  // Averages
  lines.push('AVERAGES');
  lines.push('─────────────────────────────────────────────────');
  lines.push(`  Session Duration:     ${formatDuration(stats.avgSessionDuration)}`);
  lines.push(`  Messages/Session:     ${stats.avgMessagesPerSession.toFixed(1)}`);
  lines.push(`  Cost/Session:         $${stats.avgCostPerSession.toFixed(4)}`);
  lines.push('');

  // Tool breakdown
  if (stats.toolBreakdown.length > 0) {
    lines.push('TOP TOOLS');
    lines.push('─────────────────────────────────────────────────');
    for (const tool of stats.toolBreakdown.slice(0, 8)) {
      const bar = createBar(tool.percentage, 20);
      lines.push(`  ${tool.name.padEnd(20)} ${bar} ${tool.percentage.toFixed(1)}%`);
    }
    lines.push('');
  }

  // Model breakdown
  if (stats.modelBreakdown.length > 0) {
    lines.push('MODEL USAGE');
    lines.push('─────────────────────────────────────────────────');
    for (const model of stats.modelBreakdown) {
      lines.push(`  ${model.model}`);
      lines.push(`    Sessions: ${model.sessions} | Tokens: ${formatNumber(model.tokens)} | Cost: $${model.cost.toFixed(2)}`);
    }
    lines.push('');
  }

  // Daily usage chart (last 7 days)
  if (stats.dailyUsage.length > 0) {
    lines.push('DAILY USAGE (LAST 7 DAYS)');
    lines.push('─────────────────────────────────────────────────');
    const last7 = stats.dailyUsage.slice(-7);
    const maxMessages = Math.max(...last7.map(d => d.messages), 1);

    for (const day of last7) {
      const dayLabel = new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' });
      const bar = createBar((day.messages / maxMessages) * 100, 30);
      lines.push(`  ${dayLabel.padEnd(4)} ${bar} ${day.messages}`);
    }
    lines.push('');
  }

  // Peak hours
  if (stats.peakHours.length > 0) {
    lines.push(`Peak Activity Hours: ${stats.peakHours.map(h => `${h}:00`).join(', ')}`);
    lines.push('');
  }

  // Trends
  lines.push('TRENDS');
  lines.push('─────────────────────────────────────────────────');
  const usageIcon = stats.trend.usage === 'increasing' ? '↑' :
    stats.trend.usage === 'decreasing' ? '↓' : '→';
  const costIcon = stats.trend.cost === 'increasing' ? '↑' :
    stats.trend.cost === 'decreasing' ? '↓' : '→';
  lines.push(`  Usage: ${usageIcon} ${stats.trend.usage}`);
  lines.push(`  Cost:  ${costIcon} ${stats.trend.cost}`);
  lines.push('');

  lines.push('═══════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Format compact usage statistics
 */
export function formatCompactStats(stats: UsageStats): string {
  return [
    `Sessions: ${stats.totalSessions}`,
    `Messages: ${formatNumber(stats.totalMessages)}`,
    `Tokens: ${formatNumber(stats.totalTokens)}`,
    `Cost: $${stats.totalCost.toFixed(2)}`,
  ].join(' | ');
}

/**
 * Create ASCII progress bar
 */
function createBar(percentage: number, width: number): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Format duration
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
 * Format large numbers
 */
function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1000000).toFixed(2)}M`;
}

/**
 * Calculate usage statistics from raw data
 */
export function calculateUsageStats(data: {
  sessions: Array<{
    id: string;
    model: string;
    startTime: Date;
    endTime: Date;
    messages: number;
    toolCalls: Array<{ name: string; durationMs: number }>;
    tokens: number;
    cost: number;
  }>;
}): UsageStats {
  const { sessions } = data;

  if (sessions.length === 0) {
    return createEmptyStats();
  }

  // Calculate totals
  const totalSessions = sessions.length;
  const totalMessages = sessions.reduce((sum, s) => sum + s.messages, 0);
  const totalToolCalls = sessions.reduce((sum, s) => sum + s.toolCalls.length, 0);
  const totalTokens = sessions.reduce((sum, s) => sum + s.tokens, 0);
  const totalCost = sessions.reduce((sum, s) => sum + s.cost, 0);

  // Calculate averages
  const totalDuration = sessions.reduce(
    (sum, s) => sum + (s.endTime.getTime() - s.startTime.getTime()),
    0
  );
  const avgSessionDuration = totalDuration / totalSessions;
  const avgMessagesPerSession = totalMessages / totalSessions;
  const avgCostPerSession = totalCost / totalSessions;

  // Tool breakdown
  const toolCounts = new Map<string, { calls: number; totalDuration: number }>();
  for (const session of sessions) {
    for (const call of session.toolCalls) {
      const existing = toolCounts.get(call.name) || { calls: 0, totalDuration: 0 };
      existing.calls++;
      existing.totalDuration += call.durationMs;
      toolCounts.set(call.name, existing);
    }
  }

  const toolBreakdown = Array.from(toolCounts.entries())
    .map(([name, data]) => ({
      name,
      calls: data.calls,
      percentage: (data.calls / totalToolCalls) * 100,
      avgDuration: data.totalDuration / data.calls,
    }))
    .sort((a, b) => b.calls - a.calls);

  // Model breakdown
  const modelCounts = new Map<string, { sessions: number; tokens: number; cost: number }>();
  for (const session of sessions) {
    const existing = modelCounts.get(session.model) || { sessions: 0, tokens: 0, cost: 0 };
    existing.sessions++;
    existing.tokens += session.tokens;
    existing.cost += session.cost;
    modelCounts.set(session.model, existing);
  }

  const modelBreakdown = Array.from(modelCounts.entries())
    .map(([model, data]) => ({ model, ...data }))
    .sort((a, b) => b.sessions - a.sessions);

  // Daily usage
  const dailyMap = new Map<string, DailyUsage>();
  for (const session of sessions) {
    const date = session.startTime.toISOString().split('T')[0];
    const existing = dailyMap.get(date) || {
      date,
      sessions: 0,
      messages: 0,
      toolCalls: 0,
      tokens: 0,
      cost: 0,
    };
    existing.sessions++;
    existing.messages += session.messages;
    existing.toolCalls += session.toolCalls.length;
    existing.tokens += session.tokens;
    existing.cost += session.cost;
    dailyMap.set(date, existing);
  }

  const dailyUsage = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Peak hours
  const hourCounts = new Array(24).fill(0);
  for (const session of sessions) {
    const hour = session.startTime.getHours();
    hourCounts[hour]++;
  }
  const maxHourCount = Math.max(...hourCounts);
  const peakHours = hourCounts
    .map((count, hour) => ({ hour, count }))
    .filter(h => h.count >= maxHourCount * 0.8)
    .map(h => h.hour);

  // Trends (compare last week to previous week)
  const now = Date.now();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  const lastWeekSessions = sessions.filter(
    s => s.startTime.getTime() > now - oneWeek
  );
  const prevWeekSessions = sessions.filter(
    s => s.startTime.getTime() > now - 2 * oneWeek &&
         s.startTime.getTime() <= now - oneWeek
  );

  const lastWeekUsage = lastWeekSessions.length;
  const prevWeekUsage = prevWeekSessions.length;
  const lastWeekCost = lastWeekSessions.reduce((sum, s) => sum + s.cost, 0);
  const prevWeekCost = prevWeekSessions.reduce((sum, s) => sum + s.cost, 0);

  const usageTrend = lastWeekUsage > prevWeekUsage * 1.2 ? 'increasing' :
    lastWeekUsage < prevWeekUsage * 0.8 ? 'decreasing' : 'stable';
  const costTrend = lastWeekCost > prevWeekCost * 1.2 ? 'increasing' :
    lastWeekCost < prevWeekCost * 0.8 ? 'decreasing' : 'stable';

  return {
    totalSessions,
    totalMessages,
    totalToolCalls,
    totalTokens,
    totalCost,
    avgSessionDuration,
    avgMessagesPerSession,
    avgCostPerSession,
    dailyUsage,
    peakHours,
    toolBreakdown,
    modelBreakdown,
    trend: {
      usage: usageTrend,
      cost: costTrend,
    },
  };
}

/**
 * Create empty stats object
 */
function createEmptyStats(): UsageStats {
  return {
    totalSessions: 0,
    totalMessages: 0,
    totalToolCalls: 0,
    totalTokens: 0,
    totalCost: 0,
    avgSessionDuration: 0,
    avgMessagesPerSession: 0,
    avgCostPerSession: 0,
    dailyUsage: [],
    peakHours: [],
    toolBreakdown: [],
    modelBreakdown: [],
    trend: { usage: 'stable', cost: 'stable' },
  };
}

export default formatUsageStatistics;
