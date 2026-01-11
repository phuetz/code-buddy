/**
 * Automatic Report Generator
 *
 * Generates post-session reports including:
 * - Session overview
 * - Changes made
 * - Tool usage
 * - Recommendations
 * - Export to multiple formats
 */

import { UnifiedVfsRouter } from '../services/vfs/unified-vfs-router.js';
import * as path from 'path';

export interface ReportData {
  session: {
    id: string;
    startTime: Date;
    endTime: Date;
    durationMs: number;
    model: string;
    workingDirectory: string;
  };
  conversation: {
    messageCount: number;
    userMessages: number;
    assistantMessages: number;
    topics: string[];
  };
  changes: {
    filesCreated: string[];
    filesModified: string[];
    filesDeleted: string[];
    linesAdded: number;
    linesRemoved: number;
  };
  tools: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    byTool: Array<{
      name: string;
      calls: number;
      successRate: number;
      avgDurationMs: number;
    }>;
  };
  metrics: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
  };
  checkpoints: {
    count: number;
    restorations: number;
  };
  errors: Array<{
    type: string;
    message: string;
    timestamp: Date;
  }>;
}

export type ReportFormat = 'markdown' | 'html' | 'json' | 'text';

/**
 * Generate a report from session data
 */
export function generateReport(data: ReportData, format: ReportFormat = 'markdown'): string {
  switch (format) {
    case 'markdown':
      return generateMarkdownReport(data);
    case 'html':
      return generateHtmlReport(data);
    case 'json':
      return generateJsonReport(data);
    case 'text':
      return generateTextReport(data);
    default:
      return generateMarkdownReport(data);
  }
}

/**
 * Generate Markdown report
 */
function generateMarkdownReport(data: ReportData): string {
  const lines: string[] = [
    `# Session Report`,
    '',
    `**Generated:** ${new Date().toISOString()}`,
    '',
    '---',
    '',
    '## Session Overview',
    '',
    `| Property | Value |`,
    `|----------|-------|`,
    `| Session ID | \`${data.session.id}\` |`,
    `| Start Time | ${data.session.startTime.toLocaleString()} |`,
    `| Duration | ${formatDuration(data.session.durationMs)} |`,
    `| Model | ${data.session.model} |`,
    `| Working Directory | \`${data.session.workingDirectory}\` |`,
    '',
  ];

  // Conversation summary
  lines.push('## Conversation Summary');
  lines.push('');
  lines.push(`- **Total Messages:** ${data.conversation.messageCount}`);
  lines.push(`- **User Messages:** ${data.conversation.userMessages}`);
  lines.push(`- **Assistant Messages:** ${data.conversation.assistantMessages}`);
  if (data.conversation.topics.length > 0) {
    lines.push(`- **Topics:** ${data.conversation.topics.join(', ')}`);
  }
  lines.push('');

  // File changes
  lines.push('## File Changes');
  lines.push('');
  const totalFiles = data.changes.filesCreated.length +
    data.changes.filesModified.length +
    data.changes.filesDeleted.length;
  lines.push(`**${totalFiles} file(s) affected** (+${data.changes.linesAdded} / -${data.changes.linesRemoved} lines)`);
  lines.push('');

  if (data.changes.filesCreated.length > 0) {
    lines.push('### Created Files');
    for (const file of data.changes.filesCreated) {
      lines.push(`- \`${file}\``);
    }
    lines.push('');
  }

  if (data.changes.filesModified.length > 0) {
    lines.push('### Modified Files');
    for (const file of data.changes.filesModified) {
      lines.push(`- \`${file}\``);
    }
    lines.push('');
  }

  if (data.changes.filesDeleted.length > 0) {
    lines.push('### Deleted Files');
    for (const file of data.changes.filesDeleted) {
      lines.push(`- \`${file}\``);
    }
    lines.push('');
  }

  // Tool usage
  lines.push('## Tool Usage');
  lines.push('');
  lines.push(`**${data.tools.totalCalls} total calls** (${data.tools.successfulCalls} successful, ${data.tools.failedCalls} failed)`);
  lines.push('');

  if (data.tools.byTool.length > 0) {
    lines.push('| Tool | Calls | Success Rate | Avg Duration |');
    lines.push('|------|-------|--------------|--------------|');
    for (const tool of data.tools.byTool.slice(0, 10)) {
      lines.push(`| ${tool.name} | ${tool.calls} | ${tool.successRate.toFixed(0)}% | ${tool.avgDurationMs.toFixed(0)}ms |`);
    }
    lines.push('');
  }

  // Metrics
  lines.push('## Usage Metrics');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Input Tokens | ${formatNumber(data.metrics.inputTokens)} |`);
  lines.push(`| Output Tokens | ${formatNumber(data.metrics.outputTokens)} |`);
  lines.push(`| Total Tokens | ${formatNumber(data.metrics.totalTokens)} |`);
  lines.push(`| Estimated Cost | $${data.metrics.estimatedCost.toFixed(4)} |`);
  lines.push('');

  // Checkpoints
  if (data.checkpoints.count > 0) {
    lines.push('## Checkpoints');
    lines.push('');
    lines.push(`- **Created:** ${data.checkpoints.count}`);
    lines.push(`- **Restored:** ${data.checkpoints.restorations}`);
    lines.push('');
  }

  // Errors
  if (data.errors.length > 0) {
    lines.push('## Errors Encountered');
    lines.push('');
    for (const error of data.errors) {
      lines.push(`- **${error.type}:** ${error.message}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('*Report generated by Code Buddy*');

  return lines.join('\n');
}

/**
 * Generate HTML report
 */
function generateHtmlReport(data: ReportData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session Report - ${data.session.id}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; color: #333; }
    h1 { color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 0.5rem; }
    h2 { color: #1e40af; margin-top: 2rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f3f4f6; font-weight: 600; }
    code { background: #f3f4f6; padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9em; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 1rem 0; }
    .stat-card { background: #f9fafb; padding: 1rem; border-radius: 8px; border: 1px solid #e5e7eb; }
    .stat-value { font-size: 1.5rem; font-weight: bold; color: #2563eb; }
    .stat-label { color: #6b7280; font-size: 0.875rem; }
    .file-list { list-style: none; padding: 0; }
    .file-list li { padding: 0.5rem 0; border-bottom: 1px solid #f3f4f6; }
    .file-list code { font-size: 0.85em; }
    .error { background: #fef2f2; border: 1px solid #fecaca; padding: 0.75rem; border-radius: 4px; margin: 0.5rem 0; }
    footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 0.875rem; }
  </style>
</head>
<body>
  <h1>Session Report</h1>
  <p>Generated: ${new Date().toLocaleString()}</p>

  <h2>Session Overview</h2>
  <div class="stat-grid">
    <div class="stat-card">
      <div class="stat-value">${formatDuration(data.session.durationMs)}</div>
      <div class="stat-label">Duration</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${data.conversation.messageCount}</div>
      <div class="stat-label">Messages</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${data.tools.totalCalls}</div>
      <div class="stat-label">Tool Calls</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">$${data.metrics.estimatedCost.toFixed(4)}</div>
      <div class="stat-label">Estimated Cost</div>
    </div>
  </div>

  <table>
    <tr><th>Property</th><th>Value</th></tr>
    <tr><td>Session ID</td><td><code>${data.session.id}</code></td></tr>
    <tr><td>Model</td><td>${data.session.model}</td></tr>
    <tr><td>Working Directory</td><td><code>${data.session.workingDirectory}</code></td></tr>
  </table>

  <h2>File Changes</h2>
  <p><strong>${data.changes.filesCreated.length + data.changes.filesModified.length + data.changes.filesDeleted.length} files affected</strong> (+${data.changes.linesAdded} / -${data.changes.linesRemoved} lines)</p>

  ${data.changes.filesCreated.length > 0 ? `
  <h3>Created (${data.changes.filesCreated.length})</h3>
  <ul class="file-list">
    ${data.changes.filesCreated.map(f => `<li><code>${f}</code></li>`).join('')}
  </ul>
  ` : ''}

  ${data.changes.filesModified.length > 0 ? `
  <h3>Modified (${data.changes.filesModified.length})</h3>
  <ul class="file-list">
    ${data.changes.filesModified.map(f => `<li><code>${f}</code></li>`).join('')}
  </ul>
  ` : ''}

  <h2>Tool Usage</h2>
  <table>
    <tr><th>Tool</th><th>Calls</th><th>Success Rate</th><th>Avg Duration</th></tr>
    ${data.tools.byTool.slice(0, 10).map(t => `
    <tr>
      <td>${t.name}</td>
      <td>${t.calls}</td>
      <td>${t.successRate.toFixed(0)}%</td>
      <td>${t.avgDurationMs.toFixed(0)}ms</td>
    </tr>
    `).join('')}
  </table>

  <h2>Usage Metrics</h2>
  <table>
    <tr><th>Metric</th><th>Value</th></tr>
    <tr><td>Input Tokens</td><td>${formatNumber(data.metrics.inputTokens)}</td></tr>
    <tr><td>Output Tokens</td><td>${formatNumber(data.metrics.outputTokens)}</td></tr>
    <tr><td>Total Tokens</td><td>${formatNumber(data.metrics.totalTokens)}</td></tr>
  </table>

  ${data.errors.length > 0 ? `
  <h2>Errors (${data.errors.length})</h2>
  ${data.errors.map(e => `<div class="error"><strong>${e.type}:</strong> ${e.message}</div>`).join('')}
  ` : ''}

  <footer>Report generated by Code Buddy</footer>
</body>
</html>`;
}

/**
 * Generate JSON report
 */
function generateJsonReport(data: ReportData): string {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    ...data,
  }, null, 2);
}

/**
 * Generate plain text report
 */
function generateTextReport(data: ReportData): string {
  const lines: string[] = [
    '═══════════════════════════════════════════════════════════════',
    '                      SESSION REPORT',
    '═══════════════════════════════════════════════════════════════',
    '',
    `Generated: ${new Date().toLocaleString()}`,
    '',
    '───────────────────────────────────────────────────────────────',
    'SESSION OVERVIEW',
    '───────────────────────────────────────────────────────────────',
    `  Session ID:        ${data.session.id}`,
    `  Duration:          ${formatDuration(data.session.durationMs)}`,
    `  Model:             ${data.session.model}`,
    `  Working Directory: ${data.session.workingDirectory}`,
    '',
    '───────────────────────────────────────────────────────────────',
    'CONVERSATION',
    '───────────────────────────────────────────────────────────────',
    `  Total Messages:    ${data.conversation.messageCount}`,
    `  User Messages:     ${data.conversation.userMessages}`,
    `  Assistant:         ${data.conversation.assistantMessages}`,
    '',
    '───────────────────────────────────────────────────────────────',
    'FILE CHANGES',
    '───────────────────────────────────────────────────────────────',
    `  Created:  ${data.changes.filesCreated.length}`,
    `  Modified: ${data.changes.filesModified.length}`,
    `  Deleted:  ${data.changes.filesDeleted.length}`,
    `  Lines:    +${data.changes.linesAdded} / -${data.changes.linesRemoved}`,
    '',
    '───────────────────────────────────────────────────────────────',
    'TOOL USAGE',
    '───────────────────────────────────────────────────────────────',
    `  Total Calls:  ${data.tools.totalCalls}`,
    `  Successful:   ${data.tools.successfulCalls}`,
    `  Failed:       ${data.tools.failedCalls}`,
    '',
  ];

  if (data.tools.byTool.length > 0) {
    lines.push('  Top Tools:');
    for (const tool of data.tools.byTool.slice(0, 5)) {
      lines.push(`    - ${tool.name}: ${tool.calls}x (${tool.successRate.toFixed(0)}% success)`);
    }
    lines.push('');
  }

  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('USAGE METRICS');
  lines.push('───────────────────────────────────────────────────────────────');
  lines.push(`  Input Tokens:   ${formatNumber(data.metrics.inputTokens)}`);
  lines.push(`  Output Tokens:  ${formatNumber(data.metrics.outputTokens)}`);
  lines.push(`  Total Tokens:   ${formatNumber(data.metrics.totalTokens)}`);
  lines.push(`  Estimated Cost: $${data.metrics.estimatedCost.toFixed(4)}`);
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Save report to file
 */
export async function saveReport(
  data: ReportData,
  outputPath: string,
  format?: ReportFormat
): Promise<void> {
  // Detect format from extension if not specified
  if (!format) {
    const ext = path.extname(outputPath).toLowerCase();
    format = ext === '.html' ? 'html' :
             ext === '.json' ? 'json' :
             ext === '.txt' ? 'text' : 'markdown';
  }

  const content = generateReport(data, format);
  await UnifiedVfsRouter.Instance.ensureDir(path.dirname(outputPath));
  await UnifiedVfsRouter.Instance.writeFile(outputPath, content, 'utf-8');
}

/**
 * Format duration
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;

  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);

  if (mins < 60) return `${mins}m ${secs}s`;

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

export default generateReport;
