import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  restore: vi.fn(),
  writeToolResult: vi.fn(),
  optimizeToolObservation: vi.fn(),
  getModelToolConfig: vi.fn(),
}));

vi.mock('../../src/context/restorable-compression.js', () => ({
  getRestorableCompressor: () => ({
    restore: mocks.restore,
    writeToolResult: mocks.writeToolResult,
  }),
}));

vi.mock('../../src/context/tool-observation-optimizer.js', () => ({
  optimizeToolObservation: mocks.optimizeToolObservation,
}));

vi.mock('../../src/config/model-tools.js', () => ({
  getModelToolConfig: mocks.getModelToolConfig,
}));

import {
  commandFromToolArguments,
  prepareToolObservationForPrompt,
} from '../../src/agent/prompt-tool-observation.js';

describe('prompt tool observation boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.restore.mockReturnValue({
      found: false,
      content: 'not found',
      identifier: 'missing',
    });
    mocks.getModelToolConfig.mockReturnValue({
      contextWindow: 32_000,
      maxOutputTokens: 2_000,
    });
    mocks.optimizeToolObservation.mockResolvedValue({
      content: 'compact observation',
      rawContent: 'RAW EXACT',
      optimized: true,
      reason: 'optimized',
    });
  });

  it('persists the exact raw observation before model-aware optimization', async () => {
    mocks.optimizeToolObservation.mockImplementation(async () => {
      expect(mocks.writeToolResult).toHaveBeenCalledWith(
        'call_exact',
        'RAW EXACT',
        '/workspace/project',
      );
      return {
        content: 'compact observation',
        optimized: true,
        reason: 'optimized',
      };
    });

    const result = await prepareToolObservationForPrompt({
      toolName: 'bash',
      toolCallId: 'call_exact',
      content: 'RAW EXACT',
      success: true,
      command: 'npm test',
      query: 'repair the test',
      workspaceRoot: '/workspace/project',
      model: 'test-model',
      messages: [{ role: 'user', content: 'repair the test' }],
    });

    expect(result).toMatchObject({
      content: 'compact observation',
      rawContent: 'RAW EXACT',
      optimized: true,
      reason: 'optimized',
    });
    expect(mocks.restore).toHaveBeenCalledWith('call_exact', '/workspace/project');
    expect(mocks.optimizeToolObservation).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'bash',
      toolCallId: 'call_exact',
      content: 'RAW EXACT',
      command: 'npm test',
      query: 'repair the test',
      workspaceRoot: '/workspace/project',
      contextWindow: 32_000,
      responseReserveTokens: 2_000,
      currentInputTokens: expect.any(Number),
    }));
  });

  it('never overwrites a more native copy already persisted by ToolHandler', async () => {
    mocks.restore.mockReturnValueOnce({
      found: true,
      content: '[tool output]\npartial stdout\n\n[tool error]\nlate failure',
      identifier: 'call_native',
    });

    const result = await prepareToolObservationForPrompt({
      toolName: 'bash',
      toolCallId: 'call_native',
      content: 'late failure',
      success: false,
      error: 'late failure',
      workspaceRoot: '/workspace/project',
    });

    expect(mocks.writeToolResult).not.toHaveBeenCalled();
    expect(mocks.optimizeToolObservation).toHaveBeenCalledWith(expect.objectContaining({
      content: '[tool output]\npartial stdout\n\n[tool error]\nlate failure',
    }));
    expect(result.rawContent).toContain('partial stdout');
  });

  it('skips recursive restore_context optimization and duplicate persistence', async () => {
    const result = await prepareToolObservationForPrompt({
      toolName: 'restore_context',
      toolCallId: 'call_restore',
      content: 'restored raw payload',
      workspaceRoot: '/workspace/project',
    });

    expect(result.content).toBe('restored raw payload');
    expect(result.reason).toBe('restore-context');
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.writeToolResult).not.toHaveBeenCalled();
    expect(mocks.optimizeToolObservation).not.toHaveBeenCalled();
  });

  it('persists but keeps raw output when the model has no recovery tool', async () => {
    const result = await prepareToolObservationForPrompt({
      toolName: 'view_file',
      toolCallId: 'call_no_restore',
      content: 'full file',
      workspaceRoot: '/workspace/project',
      allowOptimization: false,
    });

    expect(mocks.writeToolResult).toHaveBeenCalledWith(
      'call_no_restore',
      'full file',
      '/workspace/project',
    );
    expect(mocks.optimizeToolObservation).not.toHaveBeenCalled();
    expect(result).toMatchObject({ content: 'full file', reason: 'recovery-unavailable' });
  });

  it('uses an explicitly bounded model fallback without weakening raw recovery', async () => {
    mocks.optimizeToolObservation.mockResolvedValueOnce({
      content: 'FULL RAW FILE',
      rawContent: 'FULL RAW FILE',
      optimized: false,
      reason: 'disabled',
    });

    const result = await prepareToolObservationForPrompt({
      toolName: 'view_file',
      toolCallId: 'call_bounded',
      content: 'FULL RAW FILE',
      fallbackContent: 'BOUNDED DISPLAY\n[restore call_bounded]',
      workspaceRoot: '/workspace/project',
    });

    expect(mocks.writeToolResult).toHaveBeenCalledWith(
      'call_bounded',
      'FULL RAW FILE',
      '/workspace/project',
    );
    expect(result).toMatchObject({
      content: 'BOUNDED DISPLAY\n[restore call_bounded]',
      rawContent: 'FULL RAW FILE',
      optimized: false,
      reason: 'disabled',
    });
  });

  it('falls back without breaking the agent loop when optimization throws', async () => {
    mocks.optimizeToolObservation.mockRejectedValueOnce(new Error('sidecar failed'));

    const result = await prepareToolObservationForPrompt({
      toolName: 'search',
      toolCallId: 'call_fallback',
      content: 'unmodified search output',
    });

    expect(result).toMatchObject({
      content: 'unmodified search output',
      optimized: false,
      reason: 'boundary-fallback',
    });
  });

  it('extracts only explicit shell command arguments', () => {
    expect(commandFromToolArguments('{"command":"cargo test"}')).toBe('cargo test');
    expect(commandFromToolArguments({ cmd: 'git status' })).toBe('git status');
    expect(commandFromToolArguments({ query: 'not a command' })).toBeUndefined();
    expect(commandFromToolArguments('{broken')).toBeUndefined();
  });
});
