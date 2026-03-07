/**
 * Shared test harness types and utilities for real-conditions tests.
 */

// ============================================================================
// Types
// ============================================================================

export interface TestResult {
  name: string;
  category: string;
  status: 'pass' | 'fail' | 'skip' | 'error';
  durationMs: number;
  retries: number;
  error?: string;
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  metadata?: Record<string, unknown>;
}

export interface CategoryResult {
  name: string;
  tests: TestResult[];
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

export interface TestReport {
  timestamp: string;
  model: string;
  totalDurationMs: number;
  categories: CategoryResult[];
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    skipped: number;
    errors: number;
    passRate: string;
    totalTokensUsed: number;
    estimatedCostUSD: number;
  };
}

export interface TestDef {
  name: string;
  fn: () => Promise<{ pass: boolean; tokenUsage?: TestResult['tokenUsage']; metadata?: Record<string, unknown> }>;
  mandatory?: boolean;
  timeout?: number;
  retries?: number;
}

export interface CategoryDef {
  name: string;
  tests: () => TestDef[];
  abortOnFirst?: boolean;
}

// ============================================================================
// Harness
// ============================================================================

const MAX_RETRIES = 2;
const RETRY_DELAYS = [1500, 3000];
const INTER_TEST_DELAY = 800;

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function runWithRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = MAX_RETRIES,
  delays = RETRY_DELAYS,
): Promise<{ result: T; retries: number }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retries: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) break;
      const delayMs = delays[attempt] ?? 3000;
      console.log(`    ↻ Retrying ${label} (${attempt + 1}/${maxRetries}) in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

export async function runTest(
  test: TestDef,
  category: string,
): Promise<TestResult> {
  const start = Date.now();
  const timeout = test.timeout ?? 15000;

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout),
    );

    const { result, retries } = await runWithRetry(
      () => Promise.race([test.fn(), timeoutPromise]),
      test.name,
      test.retries ?? MAX_RETRIES,
    );

    return {
      name: test.name,
      category,
      status: result.pass ? 'pass' : 'fail',
      durationMs: Date.now() - start,
      retries,
      tokenUsage: result.tokenUsage,
      metadata: result.metadata,
      error: result.pass ? undefined : 'Assertion failed',
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      name: test.name,
      category,
      status: 'error',
      durationMs: Date.now() - start,
      retries: 0,
      error: msg,
    };
  }
}

export async function runCategory(
  name: string,
  tests: TestDef[],
  abortOnFirstFailure = false,
): Promise<CategoryResult> {
  const results: TestResult[] = [];
  const catStart = Date.now();

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    const result = await runTest(test, name);
    results.push(result);

    const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : result.status === 'skip' ? '⏭️' : '💥';
    const retryInfo = result.retries > 0 ? ` (${result.retries} retries)` : '';
    const tokenInfo = result.tokenUsage ? ` [${result.tokenUsage.totalTokens} tokens]` : '';
    console.log(`  ${icon} ${result.name} (${result.durationMs}ms)${retryInfo}${tokenInfo}`);
    if (result.error && result.status !== 'pass') {
      console.log(`     → ${result.error.substring(0, 120)}`);
    }

    if (abortOnFirstFailure && result.status !== 'pass') {
      console.log(`  ⛔ Aborting category: ${test.name} failed (mandatory)`);
      for (let j = i + 1; j < tests.length; j++) {
        results.push({
          name: tests[j].name,
          category: name,
          status: 'skip',
          durationMs: 0,
          retries: 0,
          error: 'Skipped due to prior mandatory failure',
        });
      }
      break;
    }

    if (i < tests.length - 1) {
      await sleep(INTER_TEST_DELAY);
    }
  }

  return {
    name,
    tests: results,
    passed: results.filter(r => r.status === 'pass').length,
    failed: results.filter(r => r.status === 'fail').length,
    skipped: results.filter(r => r.status === 'skip').length,
    errors: results.filter(r => r.status === 'error').length,
    durationMs: Date.now() - catStart,
  };
}
