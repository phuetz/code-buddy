/**
 * Every alias in TOOL_ALIASES must point to a tool that actually exists in the
 * built-in registry. An alias whose primary is missing was skipped in silence:
 * the name appeared in documentation and completions, and the call went nowhere.
 */
import { describe, expect, it, vi } from 'vitest';
import { TOOL_ALIASES, createAliasTools } from '../../src/tools/registry/tool-aliases.js';
import { getBuiltinToolNames } from '../../src/codebuddy/tools.js';
import type { ITool } from '../../src/tools/registry/types.js';
import { logger } from '../../src/utils/logger.js';

describe('tool alias table invariant', () => {
  it('every alias target is a registered built-in tool', () => {
    const builtin = new Set(getBuiltinToolNames());
    const orphans = Object.entries(TOOL_ALIASES)
      .filter(([, primary]) => !builtin.has(primary))
      .map(([alias, primary]) => `${alias} → ${primary}`);
    expect(orphans, `aliases pointing to unregistered tools:\n${orphans.join('\n')}`).toEqual([]);
  });

  it('a missing primary is reported, not dropped in silence', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const fake = { name: 'view_file', description: '', schema: { type: 'object', properties: {} }, execute: async () => ({ success: true }) } as unknown as ITool;
    createAliasTools([fake]);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('skipped'))).toBe(true);
    warn.mockRestore();
  });
});
