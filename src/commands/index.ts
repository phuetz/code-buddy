/**
 * Commands Module
 *
 * This module manages the CLI command system, including:
 * - Slash commands (e.g., /help, /mode)
 * - Custom commands defined in .codebuddy/commands/
 * - Enhanced command handlers for special features
 * - Specialized command implementations (compression, watch mode, etc.)
 *
 * @module Commands
 */

export * from "./slash-commands.js";
export * from "./custom-commands.js";
export * from "./enhanced-command-handler.js";

// New features inspired by other CLI tools (2025)
// Gemini CLI inspired
export * from "./compress.js";
export * from "./shell-prefix.js";

// Aider inspired
export * from "./watch-mode.js";

// GitHub Copilot CLI inspired
export * from "./delegate.js";