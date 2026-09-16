import { describe, expect, it } from 'vitest';
import { builtinCommands } from '../../src/commands/slash/builtin-commands.js';
import { EnhancedCommandHandler } from '../../src/commands/enhanced-command-handler.js';
import { getSlashCommands } from '../../src/utils/shell-completions.js';

const TOKEN_PATTERN = /^__[A-Z0-9_]+__$/;
const SHELL_FALLBACKS = new Set(['/exit', '/quit']);

describe('slash command announcements', () => {
  it('registers every token emitted by builtin commands', () => {
    const emittedTokens = builtinCommands
      .map(command => command.prompt)
      .filter((prompt): prompt is string => typeof prompt === 'string' && TOKEN_PATTERN.test(prompt));
    const registeredTokens = new Set(new EnhancedCommandHandler().getRegisteredTokens());
    const orphanedTokens = emittedTokens.filter(token => !registeredTokens.has(token));

    expect(orphanedTokens).toEqual([]);
  });

  it('keeps shell completion commands in the builtin catalog or explicit fallbacks', () => {
    const builtinNames = new Set(builtinCommands.map(command => `/${command.name}`));
    const orphanedCommands = getSlashCommands()
      .map(command => command.name)
      .filter(command => !builtinNames.has(command) && !SHELL_FALLBACKS.has(command));

    expect(orphanedCommands).toEqual([]);
  });
});
