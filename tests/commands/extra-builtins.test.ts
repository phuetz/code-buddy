import { describe, expect, it } from 'vitest';
import { extraBuiltinCommands } from '../../src/commands/slash/extra-builtins.js';

describe('extraBuiltinCommands', () => {
  it('registers /companion-loops on the engine token', () => {
    const command = extraBuiltinCommands.find((c) => c.name === 'companion-loops');
    expect(command?.prompt).toBe('__COMPANION_LOOPS__');
    expect(command?.isBuiltin).toBe(true);
  });
});
