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
  CategorizedSlashCommand
} from './types.js';

// Built-in commands
export { builtinCommands, getCommandsByCategory } from './builtin-commands.js';
