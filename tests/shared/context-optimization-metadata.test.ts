import { describe, expect, it } from 'vitest';
import {
  extractContextOptimizationMetadata,
  parseContextOptimizationMetadata,
  presentContextOptimization,
} from '../../src/shared/context-optimization-metadata.js';

const metadata = {
  optimizer: 'lm-resizer',
  reason: 'optimized',
  rawRef: 'call_exact_42',
  originalBytes: 10_000,
  finalBytes: 1_800,
  bytesSaved: 8_200,
  transport: 'http',
} as const;

describe('context optimization UI metadata', () => {
  it('validates the streamed shape and builds a compact recovery presentation', () => {
    const parsed = parseContextOptimizationMetadata(metadata);
    expect(parsed).toEqual(metadata);
    expect(presentContextOptimization(parsed)).toEqual({
      badge: 'lm-resizer · 82% saved',
      percentSaved: 82,
      bytesSaved: 8_200,
      rawRef: 'call_exact_42',
      restoreCommand: 'restore_context({"identifier":"call_exact_42"})',
    });
  });

  it('extracts only the nested contextOptimization field from ToolResult metadata', () => {
    expect(extractContextOptimizationMetadata({
      unrelated: 'kept elsewhere',
      contextOptimization: metadata,
    })).toEqual(metadata);
    expect(extractContextOptimizationMetadata({ contextOptimization: { rawRef: 12 } })).toBeNull();
  });

  it('does not advertise raw failures or zero-saving observations as lm-resizer work', () => {
    expect(presentContextOptimization({ ...metadata, optimizer: 'none' })).toBeNull();
    expect(presentContextOptimization({
      ...metadata,
      finalBytes: metadata.originalBytes,
      bytesSaved: 0,
    })).toBeNull();
  });

  it('escapes unusual call IDs inside the copyable restoration command', () => {
    const presentation = presentContextOptimization({
      ...metadata,
      rawRef: 'call_"quoted"',
    });
    expect(presentation?.rawRef).toBe('call_"quoted"');
    expect(presentation?.restoreCommand).toBe(
      'restore_context({"identifier":"call_\\"quoted\\""})',
    );
  });
});
