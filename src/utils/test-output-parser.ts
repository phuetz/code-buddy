/**
 * Test Output Parser
 *
 * Parses output from common test frameworks and converts
 * to structured TestResultsData format for rendering.
 */

import { TestResultsData, TestCase } from '../renderers/types.js';

// ============================================================================
// Types
// ============================================================================

export interface ParseResult {
  isTestOutput: boolean;
  data?: TestResultsData;
  rawOutput: string;
}

// ============================================================================
// Jest Parser
// ============================================================================

/** Counters are keyed by their labels, never their display order. */
function summaryCounts(line: string) {
  const count = (label: string) => Number(line.match(new RegExp(`\\b(\\d+)\\s+${label}\\b`, 'i'))?.[1] ?? 0);
  const passed = count('passed');
  const failed = count('failed') + count('errors?');
  const skipped = count('skipped') + count('todo');
  return { total: count('total') || passed + failed + skipped, passed, failed, skipped };
}

const JEST_SUMMARY_REGEX = /^\s*Tests:\s*([^\r\n]*\d+\s+(?:passed|failed|skipped|todo)[^\r\n]*)/im;
const JEST_PASS_REGEX = /✓\s+(.+?)(?:\s+\((\d+)\s*m?s\))?$/gm;
const JEST_FAIL_REGEX = /✕\s+(.+?)(?:\s+\((\d+)\s*m?s\))?$/gm;
const JEST_SKIP_REGEX = /○\s+skipped\s+(.+)$/gm;
const _JEST_SUITE_REGEX = /^\s*(PASS|FAIL)\s+(.+)$/gm;
const JEST_TIME_REGEX = /Time:\s*([\d.]+)\s*s/i;

function parseJestOutput(output: string): ParseResult {
  const summaryMatch = output.match(JEST_SUMMARY_REGEX);
  if (!summaryMatch) {
    return { isTestOutput: false, rawOutput: output };
  }

  const { total, passed, failed, skipped } = summaryCounts(summaryMatch[1]!);

  const tests: TestCase[] = [];

  // Parse passing tests
  let match;
  const passRegex = new RegExp(JEST_PASS_REGEX);
  while ((match = passRegex.exec(output)) !== null) {
    const name = match[1];
    if (name === undefined) continue;
    tests.push({
      name: name.trim(),
      status: 'passed',
      duration: match[2] ? parseInt(match[2], 10) : undefined,
    });
  }

  // Parse failing tests
  const failRegex = new RegExp(JEST_FAIL_REGEX);
  while ((match = failRegex.exec(output)) !== null) {
    const name = match[1];
    if (name === undefined) continue;
    tests.push({
      name: name.trim(),
      status: 'failed',
      duration: match[2] ? parseInt(match[2], 10) : undefined,
    });
  }

  // Parse skipped tests
  const skipRegex = new RegExp(JEST_SKIP_REGEX);
  while ((match = skipRegex.exec(output)) !== null) {
    const name = match[1];
    if (name === undefined) continue;
    tests.push({
      name: name.trim(),
      status: 'skipped',
    });
  }

  // Get duration
  const timeMatch = output.match(JEST_TIME_REGEX);
  const duration = timeMatch && timeMatch[1] !== undefined ? parseFloat(timeMatch[1]) * 1000 : undefined;

  const data: TestResultsData = {
    type: 'test-results',
    summary: { total, passed, failed, skipped },
    tests,
    framework: 'jest',
    duration,
  };

  return { isTestOutput: true, data, rawOutput: output };
}

// ============================================================================
// Vitest Parser
// ============================================================================

const VITEST_SUMMARY_REGEX = /^\s*Tests\s+([^\r\n]*\d+\s+(?:passed|failed|skipped|todo)[^\r\n]*)/im;
const VITEST_DURATION_REGEX = /Duration\s+([\d.]+)s/i;

function parseVitestOutput(output: string): ParseResult {
  const summaryMatch = output.match(VITEST_SUMMARY_REGEX);
  if (!summaryMatch) {
    return { isTestOutput: false, rawOutput: output };
  }

  const { total, passed, failed, skipped } = summaryCounts(summaryMatch[1]!);

  const tests: TestCase[] = [];

  // Parse test lines: ✓ or × with test name
  const lines = output.split('\n');
  for (const line of lines) {
    const passMatch = line.match(/^\s*✓\s+(.+?)(?:\s+(\d+)ms)?$/);
    if (passMatch && passMatch[1] !== undefined) {
      tests.push({
        name: passMatch[1].trim(),
        status: 'passed',
        duration: passMatch[2] ? parseInt(passMatch[2], 10) : undefined,
      });
      continue;
    }

    const failMatch = line.match(/^\s*×\s+(.+?)(?:\s+(\d+)ms)?$/);
    if (failMatch && failMatch[1] !== undefined) {
      tests.push({
        name: failMatch[1].trim(),
        status: 'failed',
        duration: failMatch[2] ? parseInt(failMatch[2], 10) : undefined,
      });
    }
  }

  const durationMatch = output.match(VITEST_DURATION_REGEX);
  const duration = durationMatch && durationMatch[1] !== undefined ? parseFloat(durationMatch[1]) * 1000 : undefined;

  const data: TestResultsData = {
    type: 'test-results',
    summary: { total, passed, failed, skipped },
    tests,
    framework: 'vitest',
    duration,
  };

  return { isTestOutput: true, data, rawOutput: output };
}

// ============================================================================
// Mocha Parser
// ============================================================================

const MOCHA_SUMMARY_REGEX = /(\d+)\s+passing(?:\s+\(([^)]+)\))?/i;
const MOCHA_FAIL_REGEX = /(\d+)\s+failing/i;
const MOCHA_PENDING_REGEX = /(\d+)\s+pending/i;

function parseMochaOutput(output: string): ParseResult {
  const summaryMatch = output.match(MOCHA_SUMMARY_REGEX);
  if (!summaryMatch) {
    return { isTestOutput: false, rawOutput: output };
  }

  const passed = parseInt(summaryMatch[1] || '0', 10);
  const failMatch = output.match(MOCHA_FAIL_REGEX);
  const failed = failMatch ? parseInt(failMatch[1] || '0', 10) : 0;
  const pendingMatch = output.match(MOCHA_PENDING_REGEX);
  const skipped = pendingMatch ? parseInt(pendingMatch[1] || '0', 10) : 0;

  const total = passed + failed + skipped;

  // Parse duration from summary
  let duration: number | undefined;
  if (summaryMatch[2]) {
    const durationStr = summaryMatch[2];
    const msMatch = durationStr.match(/(\d+)ms/);
    const sMatch = durationStr.match(/([\d.]+)s/);
    if (msMatch && msMatch[1] !== undefined) {
      duration = parseInt(msMatch[1], 10);
    } else if (sMatch && sMatch[1] !== undefined) {
      duration = parseFloat(sMatch[1]) * 1000;
    }
  }

  // Parse individual test lines
  const tests: TestCase[] = [];
  const lines = output.split('\n');
  for (const line of lines) {
    const passMatch = line.match(/^\s*✓\s+(.+?)(?:\s+\((\d+)ms\))?$/);
    if (passMatch && passMatch[1] !== undefined) {
      tests.push({
        name: passMatch[1].trim(),
        status: 'passed',
        duration: passMatch[2] ? parseInt(passMatch[2], 10) : undefined,
      });
      continue;
    }

    const failMatch = line.match(/^\s*\d+\)\s+(.+)$/);
    if (failMatch && failMatch[1] !== undefined && !line.includes('passing')) {
      tests.push({
        name: failMatch[1].trim(),
        status: 'failed',
      });
    }
  }

  const data: TestResultsData = {
    type: 'test-results',
    summary: { total, passed, failed, skipped },
    tests,
    framework: 'mocha',
    duration,
  };

  return { isTestOutput: true, data, rawOutput: output };
}

// ============================================================================
// Pytest Parser
// ============================================================================

const PYTEST_SUMMARY_REGEX = /^\s*(?:=+\s*)?((?:\d+\s+(?:passed|failed|skipped|xfailed|xpassed|errors?)(?:,\s*)?)+)(?:\s+in\s+([\d.]+)s)?(?:\s*=+)?\s*$/im;

function parsePytestOutput(output: string): ParseResult {
  const summaryMatch = output.match(PYTEST_SUMMARY_REGEX);
  if (!summaryMatch) {
    return { isTestOutput: false, rawOutput: output };
  }
  const { total, passed, failed, skipped } = summaryCounts(summaryMatch[1]!);
  const duration = summaryMatch[2] ? parseFloat(summaryMatch[2]) * 1000 : undefined;

  // Parse test lines
  const tests: TestCase[] = [];
  const lines = output.split('\n');
  for (const line of lines) {
    const passMatch = line.match(/^(.+?)::(.+?)\s+PASSED/);
    if (passMatch && passMatch[1] !== undefined && passMatch[2] !== undefined) {
      tests.push({
        name: passMatch[2].trim(),
        suite: passMatch[1].trim(),
        status: 'passed',
      });
      continue;
    }

    const failMatch = line.match(/^(.+?)::(.+?)\s+FAILED/);
    if (failMatch && failMatch[1] !== undefined && failMatch[2] !== undefined) {
      tests.push({
        name: failMatch[2].trim(),
        suite: failMatch[1].trim(),
        status: 'failed',
      });
      continue;
    }

    const skipMatch = line.match(/^(.+?)::(.+?)\s+SKIPPED/);
    if (skipMatch && skipMatch[1] !== undefined && skipMatch[2] !== undefined) {
      tests.push({
        name: skipMatch[2].trim(),
        suite: skipMatch[1].trim(),
        status: 'skipped',
      });
    }
  }

  const data: TestResultsData = {
    type: 'test-results',
    summary: { total, passed, failed, skipped },
    tests,
    framework: 'pytest',
    duration,
  };

  return { isTestOutput: true, data, rawOutput: output };
}

// ============================================================================
// Go Test Parser
// ============================================================================

const GO_SUMMARY_REGEX = /^(ok|FAIL)\s+(.+?)\s+([\d.]+)s/gm;
const GO_PASS_REGEX = /^---\s+PASS:\s+(\S+)\s+\(([\d.]+)s\)/gm;
const GO_FAIL_REGEX = /^---\s+FAIL:\s+(\S+)\s+\(([\d.]+)s\)/gm;
const GO_SKIP_REGEX = /^---\s+SKIP:\s+(\S+)/gm;

function parseGoTestOutput(output: string): ParseResult {
  // Check if this looks like go test output
  if (!output.includes('--- PASS:') && !output.includes('--- FAIL:') && !output.match(/^(ok|FAIL)\s+/m)) {
    return { isTestOutput: false, rawOutput: output };
  }

  const tests: TestCase[] = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  // Parse passing tests
  let match;
  const passRegex = new RegExp(GO_PASS_REGEX);
  while ((match = passRegex.exec(output)) !== null) {
    const name = match[1];
    const dur = match[2];
    if (name === undefined || dur === undefined) continue;
    tests.push({
      name,
      status: 'passed',
      duration: parseFloat(dur) * 1000,
    });
    passed++;
  }

  // Parse failing tests
  const failRegex = new RegExp(GO_FAIL_REGEX);
  while ((match = failRegex.exec(output)) !== null) {
    const name = match[1];
    const dur = match[2];
    if (name === undefined || dur === undefined) continue;
    tests.push({
      name,
      status: 'failed',
      duration: parseFloat(dur) * 1000,
    });
    failed++;
  }

  // Parse skipped tests
  const skipRegex = new RegExp(GO_SKIP_REGEX);
  while ((match = skipRegex.exec(output)) !== null) {
    const name = match[1];
    if (name === undefined) continue;
    tests.push({
      name,
      status: 'skipped',
    });
    skipped++;
  }

  // Calculate duration from summary line
  let duration: number | undefined;
  const summaryRegex = new RegExp(GO_SUMMARY_REGEX);
  while ((match = summaryRegex.exec(output)) !== null) {
    const dur = match[3];
    if (dur === undefined) continue;
    duration = (duration || 0) + parseFloat(dur) * 1000;
  }

  const total = passed + failed + skipped;

  const data: TestResultsData = {
    type: 'test-results',
    summary: { total, passed, failed, skipped },
    tests,
    framework: 'go test',
    duration,
  };

  return { isTestOutput: true, data, rawOutput: output };
}

// ============================================================================
// Main Parser
// ============================================================================

/**
 * Parse test output from various frameworks
 */
export function parseTestOutput(output: string): ParseResult {
  // Try each parser in order of likelihood

  // Jest (very common in JavaScript)
  let result = parseJestOutput(output);
  if (result.isTestOutput) return result;

  // Vitest (modern Vite projects)
  result = parseVitestOutput(output);
  if (result.isTestOutput) return result;

  // Mocha (classic JavaScript)
  result = parseMochaOutput(output);
  if (result.isTestOutput) return result;

  // Pytest (Python)
  result = parsePytestOutput(output);
  if (result.isTestOutput) return result;

  // Go test
  result = parseGoTestOutput(output);
  if (result.isTestOutput) return result;

  // No parser matched
  return { isTestOutput: false, rawOutput: output };
}

/**
 * Check if output looks like test output without full parsing
 */
export function isLikelyTestOutput(output: string): boolean {
  const testIndicators = [
    /^\s*Tests:?\s*\d+/im,
    /\d+\s+passing/i,
    /\d+\s+(?:passed|failed|skipped)/i,
    PYTEST_SUMMARY_REGEX,
    /---\s+(PASS|FAIL):/,
    /PASSED|FAILED/,
    /✓|✕|○/,
    /test.*result/i,
  ];

  return testIndicators.some((pattern) => pattern.test(output));
}

/**
 * Create a TestResultsData object manually
 */
export function createTestResultsData(options: {
  passed: number;
  failed: number;
  skipped?: number;
  tests?: TestCase[];
  framework?: string;
  duration?: number;
}): TestResultsData {
  const { passed, failed, skipped = 0, tests = [], framework, duration } = options;

  return {
    type: 'test-results',
    summary: {
      total: passed + failed + skipped,
      passed,
      failed,
      skipped,
    },
    tests,
    framework,
    duration,
  };
}
