/**
 * Tests for Terminate Tool (OpenManus-compatible)
 */
import { describe, it, expect } from 'vitest';
import { executeTerminate, TERMINATE_SIGNAL, TERMINATE_TOOL_DEFINITION } from '../../src/tools/terminate-tool.js';

describe('Terminate Tool', () => {
  it('returns output starting with terminate signal', async () => {
    const result = await executeTerminate({ status: 'All tests pass' });
    expect(result.success).toBe(true);
    expect(result.output).toContain(TERMINATE_SIGNAL);
    expect(result.output).toContain('All tests pass');
  });

  it('uses default status when empty', async () => {
    const result = await executeTerminate({ status: '' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Task completed.');
  });

  it('signal is detectable', async () => {
    const result = await executeTerminate({ status: 'Done fixing bug' });
    const raw = result.output || '';
    expect(raw.startsWith(TERMINATE_SIGNAL)).toBe(true);

    // Simulate executor detection
    const message = raw.replace(TERMINATE_SIGNAL, '').trim();
    expect(message).toBe('Done fixing bug');
  });

  it('tool definition has correct schema', () => {
    expect(TERMINATE_TOOL_DEFINITION.function.name).toBe('terminate');
    expect(TERMINATE_TOOL_DEFINITION.function.parameters.required).toContain('status');
  });
});
