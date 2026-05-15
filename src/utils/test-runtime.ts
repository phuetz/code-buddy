export function isTestRuntime(): boolean {
  if (typeof process === 'undefined') return false;
  return Boolean(
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST ||
    process.env.VITEST_WORKER_ID ||
    process.env.JEST_WORKER_ID
  );
}

export function assertTestRuntimeFeature(feature: string): void {
  if (isTestRuntime()) return;
  throw new Error(`${feature} is test-only and cannot be used in a normal runtime.`);
}
