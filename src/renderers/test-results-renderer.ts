/**
 * TestResultsRenderer - Render test execution results
 *
 * Displays test results in a clear, scannable format with:
 * - Summary line at top (Passed: X  Failed: Y  Total: Z)
 * - Detailed list of tests below
 * - Error details for failed tests
 */

import stringWidth from 'string-width';
import {
  Renderer,
  RenderContext,
  TestResultsData,
  TestCase,
  isTestResultsData,
} from './types.js';

// ============================================================================
// Renderer Implementation
// ============================================================================

export const testResultsRenderer: Renderer<TestResultsData> = {
  id: 'test-results',
  name: 'Test Results Renderer',
  priority: 10,

  canRender(data: unknown): data is TestResultsData {
    return isTestResultsData(data);
  },

  render(data: TestResultsData, ctx: RenderContext): string {
    if (ctx.mode === 'plain') {
      return renderPlain(data);
    }
    return renderFancy(data, ctx);
  },
};

// ============================================================================
// Plain Mode Rendering
// ============================================================================

function renderPlain(data: TestResultsData): string {
  const lines: string[] = [];
  const { summary, tests, framework, duration } = data;

  // Header
  lines.push(`Test Results${framework ? ` (${framework})` : ''}`);
  lines.push('='.repeat(40));

  // Summary
  lines.push(`Passed: ${summary.passed}  Failed: ${summary.failed}  Skipped: ${summary.skipped}  Total: ${summary.total}`);
  if (duration) {
    lines.push(`Duration: ${formatDuration(duration)}`);
  }
  lines.push('');

  // Tests
  for (const test of tests) {
    const status = test.status.toUpperCase().padEnd(7);
    const name = test.suite ? `${test.suite} > ${test.name}` : test.name;
    const time = test.duration ? ` (${formatDuration(test.duration)})` : '';
    lines.push(`[${status}] ${name}${time}`);

    if (test.error) {
      lines.push(`  Error: ${test.error}`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Fancy Mode Rendering
// ============================================================================

function renderFancy(data: TestResultsData, ctx: RenderContext): string {
  const lines: string[] = [];
  const { summary, tests, framework, duration } = data;
  const W = Math.min(ctx.width, 80);

  // Status icons
  const icons = ctx.emoji
    ? { pass: '✅', fail: '❌', skip: '⏭️ ', pending: '⏳' }
    : { pass: '[PASS]', fail: '[FAIL]', skip: '[SKIP]', pending: '[PEND]' };

  // Header box
  lines.push('┌' + '─'.repeat(W - 2) + '┐');
  const title = ctx.emoji ? '🧪 TEST RESULTS' : 'TEST RESULTS';
  const titleWithFramework = framework ? `${title} (${framework})` : title;
  lines.push('│' + centerText(titleWithFramework, W - 2) + '│');
  lines.push('├' + '─'.repeat(W - 2) + '┤');

  // Summary line with colors
  const passText = ctx.color ? `\x1b[32m${summary.passed} passed\x1b[0m` : `${summary.passed} passed`;
  const failText = summary.failed > 0
    ? (ctx.color ? `\x1b[31m${summary.failed} failed\x1b[0m` : `${summary.failed} failed`)
    : `${summary.failed} failed`;
  const skipText = summary.skipped > 0 ? `${summary.skipped} skipped` : '';

  const summaryParts = [passText, failText];
  if (skipText) summaryParts.push(skipText);
  const summaryLine = summaryParts.join('  ');

  // Calculate visible width for padding (strip ANSI codes)
  const visibleWidth = stringWidth(summaryLine);
  const padding = Math.max(0, W - 4 - visibleWidth);

  lines.push('│  ' + summaryLine + ' '.repeat(padding) + '│');

  if (duration) {
    const durationLine = `Duration: ${formatDuration(duration)}`;
    lines.push('│  ' + durationLine.padEnd(W - 4) + '│');
  }

  lines.push('├' + '─'.repeat(W - 2) + '┤');

  // Group tests by suite
  const suites = groupBySuite(tests);

  for (const [suite, suiteTests] of Object.entries(suites)) {
    if (suite && suite !== '_root') {
      lines.push('│  ' + padEnd(`📁 ${suite}`, W - 4) + '│');
    }

    for (const test of suiteTests) {
      // Map status to icon key (status 'failed' -> icon 'fail', etc.)
      const iconKey = test.status === 'failed' ? 'fail'
        : test.status === 'passed' ? 'pass'
        : test.status === 'skipped' ? 'skip'
        : 'pending';
      const icon = icons[iconKey];
      const time = test.duration ? formatDuration(test.duration) : '';
      const name = truncate(test.name, W - 20);

      let line = `  ${icon} ${name}`;
      if (time) {
        const availableSpace = W - 4 - stringWidth(line) - time.length - 1;
        if (availableSpace > 0) {
          line += ' '.repeat(availableSpace) + time;
        }
      }

      // Color failed tests
      if (test.status === 'failed' && ctx.color) {
        line = `  ${icon} \x1b[31m${name}\x1b[0m`;
        if (time) {
          line += ' '.repeat(Math.max(1, W - 4 - stringWidth(line) - time.length - 2)) + time;
        }
      }

      lines.push('│' + padEnd(line, W - 2) + '│');

      // Show error for failed tests
      if (test.error && test.status === 'failed') {
        const errorLine = truncate(`     └─ ${test.error}`, W - 6);
        const errorDisplay = ctx.color ? `\x1b[90m${errorLine}\x1b[0m` : errorLine;
        lines.push('│' + padEnd('  ' + errorDisplay, W - 2) + '│');
      }
    }
  }

  // Footer
  lines.push('└' + '─'.repeat(W - 2) + '┘');

  return lines.join('\n');
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

function groupBySuite(tests: TestCase[]): Record<string, TestCase[]> {
  const groups: Record<string, TestCase[]> = {};

  for (const test of tests) {
    const suite = test.suite || '_root';
    if (!groups[suite]) {
      groups[suite] = [];
    }
    groups[suite].push(test);
  }

  return groups;
}

function centerText(text: string, width: number): string {
  const textWidth = stringWidth(text);
  if (textWidth >= width) return text.slice(0, width);
  const leftPad = Math.floor((width - textWidth) / 2);
  const rightPad = width - textWidth - leftPad;
  return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
}

function padEnd(str: string, width: number): string {
  const currentWidth = stringWidth(str);
  if (currentWidth >= width) return str;
  return str + ' '.repeat(width - currentWidth);
}

function truncate(str: string, maxWidth: number): string {
  if (stringWidth(str) <= maxWidth) return str;
  return str.slice(0, maxWidth - 1) + '…';
}

export default testResultsRenderer;
