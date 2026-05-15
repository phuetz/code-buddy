import { describe, expect, it } from 'vitest';
import {
  ensureResearchAggregationOutput,
  ensureResearchWorkerOutput,
  formatResearchWorkerFailureOutput,
  formatWideResearchToolResult,
  type WideResearchResult,
} from '@/agent/wide-research.js';

function makeResult(successCount: number): WideResearchResult {
  return {
    topic: 'audit topic',
    subtopics: ['alpha', 'beta'],
    workerResults: [
      {
        subtopic: 'alpha',
        workerIndex: 0,
        output: successCount > 0 ? 'Alpha findings' : '',
        success: successCount > 0,
        error: successCount > 0 ? undefined : 'Worker produced no output',
        durationMs: 10,
      },
      {
        subtopic: 'beta',
        workerIndex: 1,
        output: 'Worker failed: Worker produced no output',
        success: false,
        error: 'Worker produced no output',
        durationMs: 10,
      },
    ],
    report: successCount > 0
      ? 'Aggregated report'
      : 'All research workers failed. No report available.',
    durationMs: 25,
    successCount,
  };
}

describe('wide research result handling', () => {
  it('rejects empty worker output instead of counting it as success', () => {
    expect(() => ensureResearchWorkerOutput('   ')).toThrow('Worker produced no output');
    expect(ensureResearchWorkerOutput('Findings')).toBe('Findings');
  });

  it('rejects empty aggregation output instead of returning a fake report', () => {
    expect(() => ensureResearchAggregationOutput(undefined)).toThrow('Aggregation produced no output');
    expect(() => ensureResearchAggregationOutput('')).toThrow('Aggregation produced no output');
    expect(() => ensureResearchAggregationOutput('   ')).toThrow('Aggregation produced no output');
    expect(ensureResearchAggregationOutput('Synthesized report')).toBe('Synthesized report');
  });

  it('keeps failed worker output explicit', () => {
    expect(formatResearchWorkerFailureOutput('Worker produced no output')).toBe(
      'Worker failed: Worker produced no output'
    );
    expect(formatResearchWorkerFailureOutput('')).toBe('Worker failed without output or error details.');
  });

  it('returns a failed ToolResult when no research worker succeeded', () => {
    const result = formatWideResearchToolResult(makeResult(0));

    expect(result.success).toBe(false);
    expect(result.error).toContain('no research workers succeeded');
    expect(result.output).toContain('**Workers:** 0/2 succeeded');
    expect(result.output).toContain('All research workers failed');
  });

  it('keeps partial research success when at least one worker returns content', () => {
    const result = formatWideResearchToolResult(makeResult(1));

    expect(result.success).toBe(true);
    expect(result.output).toContain('**Workers:** 1/2 succeeded');
    expect(result.output).toContain('Aggregated report');
  });
});
