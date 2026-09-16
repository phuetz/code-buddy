/**
 * Slash Command Types
 *
 * Shared type definitions for the slash command system.
 */

/**
 * Definition of an argument for a slash command.
 */
export interface SlashCommandArgument {
  /** The name of the argument. */
  name: string;
  /** Description of the argument. */
  description: string;
  /** Whether the argument is required. */
  required: boolean;
  /** Default value for the argument if not provided. */
  default?: string;
}

/**
 * Definition of a slash command.
 */
export interface SlashCommand {
  /** The name of the command (without the slash). */
  name: string;
  /** A brief description of what the command does. */
  description: string;
  /** The prompt text or special token associated with the command. */
  prompt: string;
  /** The file path where the command is defined (empty for built-ins). */
  filePath: string;
  /** Whether the command is built-in or custom. */
  isBuiltin: boolean;
  /** List of arguments accepted by the command. */
  arguments?: SlashCommandArgument[];
  /**
   * Optional per-surface restriction (P4). Resolution lives in `surfaces.ts`;
   * a declaration can hide or disable a command on a surface, never widen the
   * Cowork default-deny token allowlist.
   */
  surfaces?: Partial<Record<SlashSurface, SlashAvailability>>;
}

/** Surfaces that expose slash commands. */
export type SlashSurface = 'cli' | 'cowork' | 'channels';

/** Availability of a command on a surface. */
export type SlashAvailability =
  | { status: 'available' }
  | { status: 'hidden' }
  | { status: 'unavailable'; reason: string };

/**
 * Result of executing or parsing a slash command.
 */
export interface SlashCommandResult {
  /** Whether the command execution/parsing was successful. */
  success: boolean;
  /** The generated prompt or context to be sent to the AI (if applicable). */
  prompt?: string;
  /** Error message if the command failed. */
  error?: string;
  /** The command definition that was matched. */
  command?: SlashCommand;
}

/**
 * Command category for grouping related commands.
 */
export type SlashCommandCategory =
  | 'core'           // Core commands: help, clear
  | 'mode'           // Mode management: mode, model
  | 'checkpoint'     // Checkpoint: checkpoints, restore, diff
  | 'git'            // Git integration: review, commit
  | 'dev'            // Development: test, lint, debug
  | 'docs'           // Documentation: explain, docs
  | 'security'       // Security: security audit
  | 'context'        // Context management: add, context
  | 'session'        // Session: sessions, fork, branches
  | 'memory'         // Memory: memory, remember
  | 'autonomy'       // Autonomy: yolo, autonomy, permissions
  | 'tools'          // Tools: tools, pipeline, skill
  | 'voice'          // Voice: voice, speak, tts
  | 'theme'          // UI: theme, avatar
  | 'advanced';      // Advanced: workflow, hooks, track

/**
 * Extended command definition with category.
 */
export interface CategorizedSlashCommand extends SlashCommand {
  /** The category this command belongs to. */
  category?: SlashCommandCategory;
}
