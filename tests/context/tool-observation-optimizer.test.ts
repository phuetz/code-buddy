import { describe, expect, it, vi } from 'vitest';
import {
  calculateObservationBudget,
  ToolObservationOptimizer,
} from '../../src/context/tool-observation-optimizer.js';
import type {
  LmResizerToolOutputResult,
} from '../../src/context/lm-resizer-compressor.js';

function report(
  original: string,
  compressed: string,
  overrides: Partial<LmResizerToolOutputResult> = {},
): LmResizerToolOutputResult {
  const originalBytes = Buffer.byteLength(original);
  const compressedBytes = Buffer.byteLength(compressed);
  return {
    compressed,
    originalBytes,
    compressedBytes,
    bytesSaved: Math.max(0, originalBytes - compressedBytes),
    hash: 'ccr-hash',
    toolName: 'bash',
    command: '',
    exitCode: 0,
    filter: 'test',
    filteredBytes: compressedBytes,
    savingsRatio: originalBytes === 0 ? 0 : (originalBytes - compressedBytes) / originalBytes,
    candidateBytes: compressedBytes,
    candidateDeltaBytes: compressedBytes - originalBytes,
    compressionSteps: ['test'],
    cacheKeys: ['ccr-hash'],
    accepted: true,
    transport: 'cli',
    ...overrides,
  };
}

describe('ToolObservationOptimizer', () => {
  it('uses lower semantic thresholds while leaving small generic observations raw', async () => {
    const raw = 'noisy output\n'.repeat(150);
    const runner = vi.fn(async () => report(raw, 'signal only'));
    const optimizer = new ToolObservationOptimizer({ enabled: true, lmResizer: runner });

    const semantic = await optimizer.optimize({
      toolName: 'bash',
      toolCallId: 'call_semantic',
      content: raw,
      success: true,
    });
    const generic = await optimizer.optimize({
      toolName: 'custom_widget',
      toolCallId: 'call_generic',
      content: raw,
      success: true,
    });

    expect(semantic.optimized).toBe(true);
    expect(semantic.thresholdBytes).toBe(1_024);
    expect(generic).toMatchObject({ optimized: false, reason: 'below-threshold' });
    expect(generic.thresholdBytes).toBe(4_096);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]![0]).toMatchObject({
      minSavingsBytes: 256,
      minSavingsRatio: 0.10,
    });
  });

  it('keeps ordinary source reads intact because they are fidelity-sensitive', async () => {
    const raw = 'const important = true; // keep this context\n'.repeat(250);
    const runner = vi.fn();
    const optimizer = new ToolObservationOptimizer({ enabled: true, lmResizer: runner });

    const result = await optimizer.optimize({
      toolName: 'view_file',
      toolCallId: 'call_source',
      content: raw,
      success: true,
      contextWindow: 128_000,
      currentInputTokens: 1_000,
    });

    expect(Buffer.byteLength(raw)).toBeLessThan(20_000);
    expect(result).toMatchObject({
      content: raw,
      optimized: false,
      reason: 'below-threshold',
      semantic: false,
      thresholdBytes: 20_000,
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('shrinks the lm-resizer budget as the context approaches saturation', () => {
    const relaxed = calculateObservationBudget({
      contextWindow: 100_000,
      currentInputTokens: 10_000,
      responseReserveTokens: 0,
    }, 100_000);
    const pressured = calculateObservationBudget({
      contextWindow: 100_000,
      currentInputTokens: 95_000,
      responseReserveTokens: 0,
    }, 100_000);

    expect(relaxed.tokenBudget).toBeGreaterThan(pressured.tokenBudget);
    expect(pressured.pressure).toBeGreaterThan(relaxed.pressure);
    expect(pressured.tokenBudget).toBeGreaterThanOrEqual(256);
  });

  it('keeps failed observations raw by default and preserves error plus partial output', async () => {
    const runner = vi.fn();
    const optimizer = new ToolObservationOptimizer({ enabled: true, lmResizer: runner });
    const result = await optimizer.optimize({
      toolName: 'bash',
      toolCallId: 'call_failure',
      error: 'tests failed',
      output: 'stdout before failure',
      success: false,
    });

    expect(result).toMatchObject({
      optimized: false,
      reason: 'error-raw',
      rawRef: 'call_failure',
      content: 'tests failed\n\n[partial tool output]\nstdout before failure',
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('never optimizes restore_context output', async () => {
    const runner = vi.fn();
    const optimizer = new ToolObservationOptimizer({ enabled: true, lmResizer: runner });
    const raw = 'restored raw context\n'.repeat(1_000);
    const result = await optimizer.optimize({
      toolName: 'restore_context',
      toolCallId: 'call_restore',
      content: raw,
      success: true,
    });

    expect(result).toMatchObject({
      content: raw,
      rawRef: 'call_restore',
      reason: 'restore-context',
      optimized: false,
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('uses the caller callId verbatim as rawRef and in the recovery note', async () => {
    const raw = 'verbose\n'.repeat(1_000);
    const runner = vi.fn(async () => report(raw, 'the useful signal'));
    const optimizer = new ToolObservationOptimizer({ enabled: true, lmResizer: runner });
    const result = await optimizer.optimize({
      toolName: 'bash',
      toolCallId: 'call_exact_ABC123',
      content: raw,
      success: true,
    });

    expect(result).toMatchObject({
      rawRef: 'call_exact_ABC123',
      optimized: true,
      reason: 'optimized',
      recoveryHash: 'ccr-hash',
    });
    expect(result.content).toContain('restore_context(identifier="call_exact_ABC123")');
    expect(result.finalBytes).toBeLessThan(result.originalBytes);
    expect(result.finalTokens).toBeLessThan(result.originalTokens);
  });

  it('rejects a candidate that grows after the Code Buddy recovery note', async () => {
    const raw = 'x'.repeat(3_000);
    const runner = vi.fn(async () => report(raw, 'y'.repeat(2_950)));
    const optimizer = new ToolObservationOptimizer({ enabled: true, lmResizer: runner });
    const result = await optimizer.optimize({
      toolName: 'bash',
      toolCallId: 'call_growth',
      content: raw,
      success: true,
    });

    expect(result).toMatchObject({
      content: raw,
      optimized: false,
      reason: 'no-net-savings',
      bytesSaved: 0,
    });
  });

  it('also rejects byte savings when the final estimated token count grows', async () => {
    const raw = '🧠'.repeat(1_000);
    const runner = vi.fn(async () => report(raw, 'a'.repeat(2_500)));
    const optimizer = new ToolObservationOptimizer({ enabled: true, lmResizer: runner });
    const result = await optimizer.optimize({
      toolName: 'bash',
      toolCallId: 'call_token_growth',
      content: raw,
      success: true,
    });

    expect(Buffer.byteLength('a'.repeat(2_500))).toBeLessThan(Buffer.byteLength(raw));
    expect(result).toMatchObject({
      content: raw,
      optimized: false,
      reason: 'no-net-savings',
    });
  });

  it('keeps the raw observation when lm-resizer rejects its own candidate', async () => {
    const raw = 'noise\n'.repeat(1_000);
    const runner = vi.fn(async () => report(raw, raw, {
      accepted: false,
      rejectionReason: 'below-min-savings-ratio',
      hash: undefined,
    }));
    const optimizer = new ToolObservationOptimizer({ enabled: true, lmResizer: runner });
    const result = await optimizer.optimize({
      toolName: 'bash',
      toolCallId: 'call_rejected',
      content: raw,
      success: true,
    });

    expect(result).toMatchObject({
      content: raw,
      optimized: false,
      reason: 'lm-resizer-rejected',
    });
  });
});
