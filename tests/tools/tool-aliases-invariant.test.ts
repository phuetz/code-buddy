/**
 * Every alias in TOOL_ALIASES must point to a tool that actually exists in the
 * built-in registry. An alias whose primary is missing was skipped in silence:
 * the name appeared in documentation and completions, and the call went nowhere.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TOOL_ALIASES, createAliasTools } from '../../src/tools/registry/tool-aliases.js';
import { TOOL_ALIASES as MAP_ALIASES } from '../../src/tools/registry/tool-alias-map.js';
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

  it('the alias map is Node-free so the Cowork renderer can import tool groups', () => {
    const mapSrc = readFileSync('src/tools/registry/tool-alias-map.ts', 'utf8');
    const groupsSrc = readFileSync('src/security/tool-policy/tool-groups.ts', 'utf8');
    expect(mapSrc).not.toMatch(/from ['"][^'"]*logger/);
    expect(mapSrc).not.toMatch(/from ['"]node:|from ['"]fs['"]|from ['"]os['"]/);
    expect(groupsSrc).not.toMatch(/registry\/tool-aliases\.js/);
    expect(groupsSrc).toMatch(/registry\/tool-alias-map\.js/);
    expect(MAP_ALIASES.file_read).toBe('view_file');
  });

  it('a missing primary is reported, not dropped in silence', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const fake = { name: 'view_file', description: '', schema: { type: 'object', properties: {} }, execute: async () => ({ success: true }) } as unknown as ITool;
    createAliasTools([fake]);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('skipped'))).toBe(true);
    warn.mockRestore();
  });
});
