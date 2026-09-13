import { describe, it, expect } from 'vitest';
import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';
import { expireOldToolResults } from '../../src/context/tool-output-masking.js';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';

describe('context output diagnostics', () => {
  it('preserves the final diagnostic and call ID in emergency truncation', () => {
    const messages: CodeBuddyMessage[] = [{ role: 'tool', tool_call_id: 'call-1', content: 'progress\n'.repeat(500) + 'FINAL_ERROR' }];
    const strategy = ContextManagerV2.prototype as unknown as { truncateToolResults(messages: CodeBuddyMessage[]): CodeBuddyMessage[] };
    const result = strategy.truncateToolResults(messages);
    expect(result[0]?.tool_call_id).toBe('call-1');
    expect(result[0]?.content).toContain('FINAL_ERROR');
    expect(Buffer.byteLength(String(result[0]?.content))).toBeLessThanOrEqual(500);
  });
  it('also bounds giant lines in age-based previews', () => {
    const messages: CodeBuddyMessage[] = [{ role: 'tool', tool_call_id: 'call-1', content: Array(30).fill('x'.repeat(10000)).join('\n') + 'FINAL_ERROR' }];
    expireOldToolResults(messages, 12, 20);
    expect(String(messages[0]?.content)).toContain('FINAL_ERROR');
    expect(Buffer.byteLength(String(messages[0]?.content))).toBeLessThanOrEqual(4000);
  });
});
