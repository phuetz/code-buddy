/**
 * Slash Commands Manager
 *
 * Manages the registration, parsing, and execution of slash commands.
 * Supports both built-in commands and custom commands loaded from
 * `.codebuddy/commands/*.md` files in the project or home directory.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Re-export types for backwards compatibility
export type {
  SlashCommand,
  SlashCommandArgument,
  SlashCommandResult
} from './slash/types.js';

import type { SlashCommand, SlashCommandArgument, SlashCommandResult } from './slash/types.js';
import { builtinCommands } from './slash/builtin-commands.js';

/**
 * Slash Commands Manager - Inspired by Claude Code.
 *
 * Manages the registration, parsing, and execution of slash commands.
 * Supports both built-in commands and custom commands loaded from
 * `.codebuddy/commands/*.md` files in the project or home directory.
 */
export class SlashCommandManager {
  private commands: Map<string, SlashCommand> = new Map();
  private workingDirectory: string;
  private commandsDirs: string[];

  /**
   * Creates a new instance of SlashCommandManager.
   *
   * @param workingDirectory - The current working directory (defaults to process.cwd()).
   */
  constructor(workingDirectory: string = process.cwd()) {
    this.workingDirectory = workingDirectory;
    this.commandsDirs = [
      path.join(workingDirectory, '.codebuddy', 'commands'),
      path.join(os.homedir(), '.codebuddy', 'commands')
    ];

    this.loadBuiltinCommands();
    this.loadCustomCommands();
  }

  /**
   * Loads the set of built-in slash commands.
   * These commands are defined in the builtin-commands module.
   */
  private loadBuiltinCommands(): void {
    for (const cmd of builtinCommands) {
      this.commands.set(cmd.name, cmd);
    }
  }

  /**
   * Loads custom commands from `.codebuddy/commands/*.md` files.
   * Scans both the project directory and the user's home directory.
   */
  private loadCustomCommands(): void {
    for (const commandsDir of this.commandsDirs) {
      if (!fs.existsSync(commandsDir)) {
        continue;
      }

      try {
        const files = fs.readdirSync(commandsDir);

        for (const file of files) {
          if (!file.endsWith('.md')) continue;

          const filePath = path.join(commandsDir, file);
          const commandName = path.basename(file, '.md');

          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const { description, prompt, arguments: args } = this.parseCommandFile(content);

            // Custom commands override builtin commands
            this.commands.set(commandName, {
              name: commandName,
              description: description || `Custom command: ${commandName}`,
              prompt,
              filePath,
              isBuiltin: false,
              arguments: args
            });
          } catch {
            // Silently skip invalid command files, logging would be too noisy
          }
        }
      } catch (_error) {
        // Directory doesn't exist or can't be read
      }
    }
  }

  /**
   * Parses the content of a command markdown file.
   * Extracts YAML frontmatter for metadata and uses the rest as the prompt.
   *
   * @param content - The raw content of the markdown file.
   * @returns An object containing description, prompt, and optional arguments.
   */
  private parseCommandFile(content: string): {
    description: string;
    prompt: string;
    arguments?: SlashCommandArgument[];
  } {
    const lines = content.split('\n');
    let description = '';
    let prompt = '';
    const args: SlashCommandArgument[] = [];

    let inFrontmatter = false;
    let frontmatterDone = false;
    const promptLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Handle YAML frontmatter
      if (line.trim() === '---') {
        if (!frontmatterDone) {
          inFrontmatter = !inFrontmatter;
          if (!inFrontmatter) {
            frontmatterDone = true;
          }
          continue;
        }
      }

      if (inFrontmatter) {
        // Parse frontmatter
        const descMatch = line.match(/^description:\s*(.+)$/);
        if (descMatch) {
          description = descMatch[1].trim().replace(/^["']|["']$/g, '');
        }

        const argMatch = line.match(/^argument:\s*(.+)$/);
        if (argMatch) {
          const argParts = argMatch[1].split(',').map(s => s.trim());
          args.push({
            name: argParts[0] || 'arg',
            description: argParts[1] || '',
            required: argParts[2] === 'required'
          });
        }
      } else {
        // Everything after frontmatter is the prompt
        promptLines.push(line);
      }
    }

    prompt = promptLines.join('\n').trim();

    // If no frontmatter, first line starting with # is description
    if (!description && prompt.startsWith('#')) {
      const firstLineEnd = prompt.indexOf('\n');
      if (firstLineEnd > 0) {
        description = prompt.substring(1, firstLineEnd).trim();
        prompt = prompt.substring(firstLineEnd + 1).trim();
      }
    }

    return { description, prompt, arguments: args.length > 0 ? args : undefined };
  }

  /**
   * Retrieves all available slash commands.
   *
   * @returns An array of all registered commands.
   */
  getCommands(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Retrieves a specific command by name.
   *
   * @param name - The name of the command to retrieve.
   * @returns The command definition or undefined if not found.
   */
  getCommand(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }

  /**
   * Retrieves all registered commands.
   * Alias for `getCommands()`.
   *
   * @returns An array of all registered commands.
   */
  getAllCommands(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Executes a slash command string.
   * Handles argument substitution and checks for command existence.
   *
   * @param input - The full command string (e.g., "/help", "/mode code").
   * @returns The result of the execution, including the prompt to send or an error.
   */
  execute(input: string): SlashCommandResult {
    // Validate input
    if (!input || typeof input !== 'string') {
      return {
        success: false,
        error: 'Command input is required and must be a non-empty string'
      };
    }
    if (input.trim().length === 0) {
      return {
        success: false,
        error: 'Command input cannot be empty or whitespace only'
      };
    }
    // Validate input length to prevent abuse
    if (input.length > 10000) {
      return {
        success: false,
        error: 'Command input exceeds maximum length of 10000 characters'
      };
    }

    // Parse command and arguments
    const parts = input.trim().split(/\s+/);
    const commandName = parts[0].replace(/^\//, '');
    const args = parts.slice(1);

    // Validate command name
    if (!commandName || commandName.length === 0) {
      return {
        success: false,
        error: 'Command name is required. Usage: /<command> [arguments]'
      };
    }
    // Validate command name format (alphanumeric, hyphens, underscores)
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(commandName)) {
      return {
        success: false,
        error: `Invalid command name '${commandName}'. Command names must start with a letter and contain only letters, numbers, underscores, or hyphens`
      };
    }

    const command = this.commands.get(commandName);

    if (!command) {
      // Check for partial matches
      const matches = Array.from(this.commands.keys())
        .filter(name => name.startsWith(commandName));

      if (matches.length === 1) {
        return this.execute(`/${matches[0]} ${args.join(' ')}`);
      }

      return {
        success: false,
        error: `Unknown command: /${commandName}. Use /help to see available commands.`
      };
    }

    // Handle special built-in commands
    if (command.prompt.startsWith('__')) {
      return {
        success: true,
        prompt: command.prompt,
        command
      };
    }

    // Replace argument placeholders in prompt
    let prompt = command.prompt;

    if (args.length > 0) {
      // Replace $1, $2, etc. with arguments
      args.forEach((arg, index) => {
        prompt = prompt.replace(new RegExp(`\\$${index + 1}`, 'g'), arg);
      });

      // Replace $@ with all arguments
      prompt = prompt.replace(/\$@/g, args.join(' '));

      // Append arguments if no placeholders
      if (!command.prompt.includes('$')) {
        prompt = `${prompt}\n\nContext: ${args.join(' ')}`;
      }
    }

    return {
      success: true,
      prompt,
      command
    };
  }

  /**
   * Formats a user-friendly list of all available commands.
   * Separates built-in commands from custom commands.
   *
   * @returns A formatted string ready for display.
   */
  formatCommandsList(): string {
    const builtinCmds = Array.from(this.commands.values())
      .filter(cmd => cmd.isBuiltin);
    const customCmds = Array.from(this.commands.values())
      .filter(cmd => !cmd.isBuiltin);

    let output = '📚 Available Slash Commands\n' + '═'.repeat(50) + '\n\n';

    output += '🔧 Built-in Commands:\n' + '─'.repeat(30) + '\n';
    for (const cmd of builtinCmds) {
      const argsStr = cmd.arguments
        ? cmd.arguments.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ')
        : '';
      output += `  /${cmd.name}${argsStr ? ' ' + argsStr : ''}\n`;
      output += `    ${cmd.description}\n\n`;
    }

    if (customCmds.length > 0) {
      output += '\n📁 Custom Commands:\n' + '─'.repeat(30) + '\n';
      for (const cmd of customCmds) {
        const argsStr = cmd.arguments
          ? cmd.arguments.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ')
          : '';
        output += `  /${cmd.name}${argsStr ? ' ' + argsStr : ''}\n`;
        output += `    ${cmd.description}\n`;
        output += `    📄 ${cmd.filePath}\n\n`;
      }
    }

    output += '\n💡 Create custom commands in .codebuddy/commands/*.md';

    return output;
  }

  /**
   * Reloads all commands from disk.
   * Useful after adding or editing custom command files.
   */
  reload(): void {
    this.commands.clear();
    this.loadBuiltinCommands();
    this.loadCustomCommands();
  }

  /**
   * Creates a new custom command template file.
   *
   * @param name - The name of the new command.
   * @param description - The description of the new command.
   * @returns The file path of the created command template.
   */
  createCommandTemplate(name: string, description: string): string {
    // Validate name
    if (!name || typeof name !== 'string') {
      throw new Error('Command name is required and must be a non-empty string');
    }
    if (name.trim().length === 0) {
      throw new Error('Command name cannot be empty or whitespace only');
    }
    // Validate name format
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
      throw new Error('Command name must start with a letter and contain only letters, numbers, underscores, or hyphens');
    }
    if (name.length > 50) {
      throw new Error('Command name must not exceed 50 characters');
    }

    // Validate description
    if (!description || typeof description !== 'string') {
      throw new Error('Command description is required and must be a non-empty string');
    }
    if (description.trim().length === 0) {
      throw new Error('Command description cannot be empty or whitespace only');
    }
    if (description.length > 500) {
      throw new Error('Command description must not exceed 500 characters');
    }

    const commandsDir = path.join(this.workingDirectory, '.codebuddy', 'commands');

    // Ensure directory exists
    if (!fs.existsSync(commandsDir)) {
      fs.mkdirSync(commandsDir, { recursive: true });
    }

    const filePath = path.join(commandsDir, `${name}.md`);

    const template = `---
description: ${description}
---

# ${name}

Your prompt instructions here.

You can use $1, $2, etc. for arguments, or $@ for all arguments.

Example usage: /${name} argument1 argument2
`;

    fs.writeFileSync(filePath, template);
    this.reload();

    return filePath;
  }
}

// Singleton instance
let slashCommandManagerInstance: SlashCommandManager | null = null;

/**
 * Gets the singleton instance of SlashCommandManager.
 *
 * @param workingDirectory - Optional working directory to initialize with.
 * @returns The singleton instance.
 */
export function getSlashCommandManager(workingDirectory?: string): SlashCommandManager {
  if (!slashCommandManagerInstance || workingDirectory) {
    slashCommandManagerInstance = new SlashCommandManager(workingDirectory);
  }
  return slashCommandManagerInstance;
}

/**
 * Resets the singleton instance of SlashCommandManager.
 * Primarily used for testing.
 */
export function resetSlashCommandManager(): void {
  slashCommandManagerInstance = null;
}
