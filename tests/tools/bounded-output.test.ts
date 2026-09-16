import { describe, it, expect } from 'vitest';
import { BoundedOutput, truncateOutput } from '../../src/utils/bounded-output.js';

describe('bounded process output', () => {
  it('bounds accumulated data and retains both diagnostics with an omission count', () => {
    const output = new BoundedOutput(128);
    output.append('START\n');
    for (let i = 0; i < 10000; i++) output.append('progress\n');
    output.append('FINAL_ERROR');
    expect(output.retainedBytes).toBe(128);
    expect(output.omittedBytes).toBeGreaterThan(80000);
    expect(output.text()).toMatch(/^START/);
    expect(output.text()).toContain('bytes omitted');
    expect(output.text()).toMatch(/FINAL_ERROR$/);
    expect(output.drain()).toContain('FINAL_ERROR');
    expect(output.retainedBytes).toBe(0);
  });
  it('handles huge chunks and UTF-8 split at retention boundaries', () => {
    const output = new BoundedOutput(17);
    output.append('😀'.repeat(10000));
    expect(output.retainedBytes).toBe(17);
    expect(output.text()).not.toContain('�');
    const small = new BoundedOutput(30);
    small.append(Buffer.from('é😀').subarray(0, 3));
    small.append(Buffer.from('é😀').subarray(3));
    expect(small.text()).toBe('é😀');
  });
  it('preserves short text and budgets long single-line diagnostics including the marker', () => {
    expect(truncateOutput('exact\n😀', 100)).toBe('exact\n😀');
    const result = truncateOutput('START' + '😀'.repeat(1000) + 'FINAL_ERROR', 500);
    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(500);
    expect(result).toMatch(/^START/);
    expect(result).toMatch(/FINAL_ERROR$/);
    expect(result).not.toContain('�');
  });
});
