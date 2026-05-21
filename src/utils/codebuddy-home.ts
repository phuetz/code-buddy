/**
 * Code Buddy home - centralized configuration directory management
 *
 * Supports CODEBUDDY_HOME for new installs and GROK_HOME as a backward
 * compatible alias from the historical grok-cli project name.
 *
 * Default: ~/.codebuddy/
 *
 * Usage:
 *   export CODEBUDDY_HOME="/path/to/custom/home"
 *   buddy "your prompt"
 *
 * Directory structure:
 *   $CODEBUDDY_HOME/
 *   ├── config.toml          # Configuration file
 *   ├── user-settings.json   # User settings
 *   ├── .env                 # API keys
 *   ├── codebuddy.db              # SQLite database
 *   ├── agents/              # Custom agents
 *   ├── prompts/             # Custom system prompts
 *   ├── commands/            # Custom slash commands
 *   ├── themes/              # Custom themes
 *   ├── personas/            # AI personas
 *   ├── memory/              # Persistent memory
 *   ├── sessions/            # Session data
 *   ├── checkpoints/         # File checkpoints
 *   ├── tasks/               # Background tasks
 *   ├── branches/            # Conversation branches
 *   ├── cache/               # Cache data
 *   └── logs/                # Log files
 */

import os from 'os';
import path from 'path';
import fs from 'fs';

/**
 * Get the Code Buddy home directory path.
 *
 * Priority:
 * 1. CODEBUDDY_HOME environment variable
 * 2. GROK_HOME legacy environment variable
 * 3. ~/.codebuddy/ (default)
 */
export function getCodeBuddyHome(): string {
  return process.env.CODEBUDDY_HOME || process.env.GROK_HOME || path.join(os.homedir(), '.codebuddy');
}

/**
 * Get a path within Code Buddy home.
 *
 * @param relativePath - Path relative to Code Buddy home (e.g., 'agents', 'config.toml')
 * @returns Absolute path
 */
export function getCodeBuddyPath(...relativePath: string[]): string {
  return path.join(getCodeBuddyHome(), ...relativePath);
}

/**
 * Backward-compatible alias for older grok-cli imports.
 */
export const getGrokPath = getCodeBuddyPath;

/**
 * Get the agents directory path
 */
export function getAgentsDir(): string {
  return getCodeBuddyPath('agents');
}

/**
 * Get the prompts directory path
 */
export function getPromptsDir(): string {
  return getCodeBuddyPath('prompts');
}

/**
 * Get the commands directory path
 */
export function getCommandsDir(): string {
  return getCodeBuddyPath('commands');
}

/**
 * Get the themes directory path
 */
export function getThemesDir(): string {
  return getCodeBuddyPath('themes');
}

/**
 * Get the database path
 */
export function getDatabasePath(): string {
  return getCodeBuddyPath('codebuddy.db');
}

/**
 * Get the user settings path
 */
export function getUserSettingsPath(): string {
  return getCodeBuddyPath('user-settings.json');
}

/**
 * Get the sessions directory path
 */
export function getSessionsDir(): string {
  return getCodeBuddyPath('sessions');
}

/**
 * Get the memory directory path
 */
export function getMemoryDir(): string {
  return getCodeBuddyPath('memory');
}

/**
 * Get the checkpoints directory path
 */
export function getCheckpointsDir(): string {
  return getCodeBuddyPath('checkpoints');
}

/**
 * Get the cache directory path
 */
export function getCacheDir(): string {
  return getCodeBuddyPath('cache');
}

/**
 * Get the tasks directory path
 */
export function getTasksDir(): string {
  return getCodeBuddyPath('tasks');
}

/**
 * Get the branches directory path
 */
export function getBranchesDir(): string {
  return getCodeBuddyPath('branches');
}

/**
 * Get the personas directory path
 */
export function getPersonasDir(): string {
  return getCodeBuddyPath('personas');
}

/**
 * Get the offline data directory path
 */
export function getOfflineDir(): string {
  return getCodeBuddyPath('offline');
}

/**
 * Ensure Code Buddy home directory exists
 */
export function ensureCodeBuddyHome(): void {
  const codebuddyHome = getCodeBuddyHome();
  if (!fs.existsSync(codebuddyHome)) {
    fs.mkdirSync(codebuddyHome, { recursive: true });
  }
}

/**
 * Ensure a subdirectory exists within Code Buddy home
 */
export function ensureGrokDir(...relativePath: string[]): string {
  const dir = getCodeBuddyPath(...relativePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Check if a custom Code Buddy home is set
 */
export function isCustomCodeBuddyHome(): boolean {
  return !!(process.env.CODEBUDDY_HOME || process.env.GROK_HOME);
}

/**
 * Format Code Buddy home info for display
 */
export function formatCodeBuddyHomeInfo(): string {
  const codebuddyHome = getCodeBuddyHome();
  const isCustom = isCustomCodeBuddyHome();
  const source = process.env.CODEBUDDY_HOME
    ? 'CODEBUDDY_HOME'
    : process.env.GROK_HOME
      ? 'GROK_HOME'
      : 'default';

  return `CODEBUDDY_HOME: ${codebuddyHome}${isCustom ? ` (custom via ${source})` : ' (default)'}`;
}
