/**
 * Tests for command handler validation in `hooks-bridge.ts:test()`.
 */
import { describe, expect, it } from 'vitest';
import { HooksBridge, type UserHookHandler } from '../src/main/hooks/hooks-bridge';

describe('HooksBridge / command dry-run validation', () => {
  it('rejects an empty command instead of reporting a successful no-op', async () => {
    const bridge = new HooksBridge();

    const result = await bridge.test({
      type: 'command',
      command: '',
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe('Empty command');
  });

  it('rejects unsupported handler types instead of reporting a successful no-op', async () => {
    const bridge = new HooksBridge();
    const handler = { type: 'websocket' } as unknown as UserHookHandler;

    const result = await bridge.test(handler);

    expect(result.success).toBe(false);
    expect(result.exitCode).toBeNull();
    expect(result.error).toBe('Unsupported hook handler type: websocket');
  });
});
