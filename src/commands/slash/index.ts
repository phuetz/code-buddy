/**
 * Slash Command Module
 *
 * Exports types, built-in commands, and utilities for the slash command system.
 */

// Types
export type {
  SlashCommand,
  SlashCommandArgument,
  SlashCommandResult,
  SlashCommandCategory,
  CategorizedSlashCommand,
  SlashSurface,
  SlashAvailability
} from './types.js';

// Built-in commands
export { builtinCommands, getCommandsByCategory } from './builtin-commands.js';
export { extraBuiltinCommands } from './extra-builtins.js';

// Per-surface availability (single declaration for CLI, Cowork and the wiki)
export {
  CHANNEL_SLASH_SURFACES,
  channelPlatformsFor,
  COWORK_TOKEN_SURFACES,
  COWORK_UNAVAILABLE_REASON,
  coworkHeadlessAllowlist,
  coworkUiEffectTokens,
  isEngineToken,
  resolveSlashAvailability,
  withAvailability,
} from './surfaces.js';
export type { ChannelSlashSpec, CoworkTokenMode, SlashCommandWithAvailability } from './surfaces.js';
