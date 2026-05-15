import { describe, expect, it } from 'vitest';
import { normalizePluginToolResult } from '../../src/agent/tool-handler.js';

describe('normalizePluginToolResult', () => {
  it('preserves plugin ToolResult failures instead of wrapping them as success', () => {
    const result = normalizePluginToolResult({
      success: false,
      error: 'plugin validation failed',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('plugin validation failed');
  });

  it('keeps non-ToolResult plugin values as successful output payloads', () => {
    const result = normalizePluginToolResult({
      message: 'done',
      count: 2,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('"message": "done"');
    expect(result.output).toContain('"count": 2');
  });
});
