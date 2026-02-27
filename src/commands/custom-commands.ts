import fs from "fs-extra";
import * as path from "path";
import os from "os";

/**
 * Represents a user-defined custom command loaded from a file.
 */
export interface CustomCommand {
  /** The command name (without slash). */
  name: string;
  /** Optional description of the command. */
  description?: string;
  /** The command prompt content. */
  prompt: string;
  /** Path to the defining file. */
  filePath: string;
}

/**
 * Loads and manages custom commands from .codebuddy/commands directories.
 * Scans both project-specific and global (user home) directories.
 */
export class CustomCommandLoader {
  private projectCommandsDir: string;
  private globalCommandsDir: string;
  private commandCache: Map<string, CustomCommand> = new Map();
  private lastScanTime: number = 0;
  private scanInterval: number = 5000;  // Re-scan every 5 seconds

  constructor() {
    this.projectCommandsDir = path.join(process.cwd(), ".codebuddy", "commands");
    this.globalCommandsDir = path.join(
      process.env.HOME || process.env.USERPROFILE || os.homedir(),
      ".codebuddy",
      "commands"
    );
  }

  /**
   * Scans directories for command files if the cache is stale.
   */
  private async scanCommands(): Promise<void> {
    const now = Date.now();
    if (now - this.lastScanTime < this.scanInterval) {
      return;  // Use cache
    }

    this.commandCache.clear();

    // Scan global commands first
    await this.scanDirectory(this.globalCommandsDir);

    // Scan project commands (override global)
    await this.scanDirectory(this.projectCommandsDir);

    this.lastScanTime = now;
  }

  /**
   * Scans a specific directory for .md command files.
   *
   * @param dir - Directory path to scan.
   */
  private async scanDirectory(dir: string): Promise<void> {
    if (!(await fs.pathExists(dir))) {
      return;
    }

    try {
      const files = await fs.readdir(dir);

      for (const file of files) {
        if (!file.endsWith(".md")) {
          continue;
        }

        const filePath = path.join(dir, file);
        const name = file.replace(".md", "");

        try {
          const content = await fs.readFile(filePath, "utf-8");
          const command = this.parseCommandFile(name, content, filePath);
          this.commandCache.set(name, command);
        } catch (error) {
          console.warn(`Failed to load command ${name}:`, error);
        }
      }
    } catch (error) {
      console.warn(`Failed to scan commands directory ${dir}:`, error);
    }
  }

  /**
   * Parses the content of a command file.
   *
   * @param name - Command name.
   * @param content - File content.
   * @param filePath - Path to file.
   * @returns Parsed CustomCommand object.
   */
  private parseCommandFile(
    name: string,
    content: string,
    filePath: string
  ): CustomCommand {
    // Check for YAML frontmatter
    let description: string | undefined;
    let prompt = content;

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      prompt = frontmatterMatch[2].trim();

      // Parse description from frontmatter
      const descMatch = frontmatter.match(/description:\s*(.+)/);
      if (descMatch) {
        description = descMatch[1].trim();
      }
    }

    return {
      name,
      description,
      prompt,
      filePath,
    };
  }

  /**
   * Retrieves a command by name.
   *
   * @param name - Command name.
   * @returns The custom command or null if not found.
   */
  async getCommand(name: string): Promise<CustomCommand | null> {
    await this.scanCommands();
    return this.commandCache.get(name) || null;
  }

  /**
   * Retrieves all available custom commands.
   *
   * @returns Array of custom commands.
   */
  async getAllCommands(): Promise<CustomCommand[]> {
    await this.scanCommands();
    return Array.from(this.commandCache.values());
  }

  /**
   * Expands a command prompt with provided arguments and environment variables.
   *
   * @param name - Command name.
   * @param args - Arguments string.
   * @returns The expanded prompt string or null if command not found.
   */
  async expandCommand(name: string, args?: string): Promise<string | null> {
    const command = await this.getCommand(name);
    if (!command) {
      return null;
    }

    let expandedPrompt = command.prompt;

    // Replace argument placeholders
    if (args) {
      // Replace $ARGUMENTS with the full argument string (Claude Code style)
      expandedPrompt = expandedPrompt.replace(/\$ARGUMENTS/g, args);

      // Replace $ARGS and {{args}} with the full argument string
      expandedPrompt = expandedPrompt.replace(/\$ARGS/g, args);
      expandedPrompt = expandedPrompt.replace(/\{\{args\}\}/g, args);

      // Replace $@ with all arguments
      expandedPrompt = expandedPrompt.replace(/\$@/g, args);

      // Split args and replace numbered placeholders ($1, $2, etc.)
      const argParts = args.split(/\s+/);
      argParts.forEach((arg, index) => {
        expandedPrompt = expandedPrompt.replace(
          new RegExp(`\\$${index + 1}`, "g"),
          arg
        );
      });
    } else {
      // Clean up placeholders when no args provided
      expandedPrompt = expandedPrompt.replace(/\$ARGUMENTS/g, '');
      expandedPrompt = expandedPrompt.replace(/\$ARGS/g, '');
      expandedPrompt = expandedPrompt.replace(/\{\{args\}\}/g, '');
      expandedPrompt = expandedPrompt.replace(/\$@/g, '');
    }

    // SECURITY: Whitelist of safe environment variables
    // Do NOT expose sensitive variables like API keys, tokens, passwords
    const SAFE_ENV_VARS = new Set([
      "HOME", "USER", "USERNAME", "SHELL", "LANG", "LC_ALL",
      "TERM", "EDITOR", "VISUAL", "PAGER",
      "PATH", "NODE_ENV", "DEBUG",
      "TMPDIR", "TMP", "TEMP",
      "HOSTNAME", "LOGNAME",
    ]);

    // Replace environment-style variables
    expandedPrompt = expandedPrompt.replace(/\$\{?(\w+)\}?/g, (match, varName) => {
      // Special variables
      switch (varName) {
        case "CWD":
        case "PWD":
          return process.cwd();
        case "USER":
          return process.env.USER || process.env.USERNAME || "user";
        case "DATE":
          return new Date().toISOString().split("T")[0];
        case "TIME":
          return new Date().toISOString().split("T")[1].slice(0, 8);
        default:
          // SECURITY: Only allow whitelisted environment variables
          if (SAFE_ENV_VARS.has(varName)) {
            return process.env[varName] || match;
          }
          // Don't expose other env vars (could contain secrets)
          return match;
      }
    });

    return expandedPrompt;
  }

  /**
   * Creates a new custom command file.
   *
   * @param name - Command name.
   * @param prompt - Command prompt content.
   * @param description - Optional description.
   * @param global - Whether to create in global directory (default: false).
   * @returns Path to the created file.
   */
  async createCommand(
    name: string,
    prompt: string,
    description?: string,
    global: boolean = false
  ): Promise<string> {
    const dir = global ? this.globalCommandsDir : this.projectCommandsDir;
    await fs.ensureDir(dir);

    const filePath = path.join(dir, `${name}.md`);

    let content = "";
    if (description) {
      content += `---\ndescription: ${description}\n---\n\n`;
    }
    content += prompt;

    await fs.writeFile(filePath, content, "utf-8");

    // Clear cache to pick up new command
    this.lastScanTime = 0;

    return filePath;
  }

  /**
   * Deletes a custom command.
   *
   * @param name - Command name.
   * @returns True if deleted, false if not found.
   */
  async deleteCommand(name: string): Promise<boolean> {
    // Try project first, then global
    const projectPath = path.join(this.projectCommandsDir, `${name}.md`);
    const globalPath = path.join(this.globalCommandsDir, `${name}.md`);

    if (await fs.pathExists(projectPath)) {
      await fs.remove(projectPath);
      this.commandCache.delete(name);
      return true;
    }

    if (await fs.pathExists(globalPath)) {
      await fs.remove(globalPath);
      this.commandCache.delete(name);
      return true;
    }

    return false;
  }

  /**
   * Formats a list of commands for display.
   *
   * @returns Formatted string.
   */
  formatCommandList(): string {
    if (this.commandCache.size === 0) {
      return "No custom commands found.\n\nCreate commands in:\n  Project: .codebuddy/commands/<name>.md\n  Global: ~/.codebuddy/commands/<name>.md";
    }

    let output = "Custom Commands:\n\n";

    for (const [name, command] of this.commandCache) {
      const location = command.filePath.includes(this.projectCommandsDir)
        ? "(project)"
        : "(global)";
      output += `  /${name} ${location}\n`;
      if (command.description) {
        output += `    ${command.description}\n`;
      }
    }

    output += `\nUsage: /<command> [arguments]\n`;

    return output;
  }

  /**
   * Returns help text explaining the custom command system.
   *
   * @returns Help text string.
   */
  formatHelp(): string {
    return `
Custom Commands System

Create reusable prompts as markdown files:

Location:
  Project-level: .codebuddy/commands/<name>.md
  Global:        ~/.codebuddy/commands/<name>.md

File Format:
  ---
  description: Optional description
  ---

  Your prompt template here.
  Use $ARGUMENTS for all user input after the command name.
  Use $ARGS, {{args}}, or $@ as aliases for $ARGUMENTS.
  Use $1, $2, etc. for specific positional arguments.
  Use $CWD, $USER, $DATE for special values.

Example (.codebuddy/commands/review.md):
  ---
  description: Review code changes
  ---

  Review the following code changes and provide feedback:

  $ARGUMENTS

  Focus on:
  1. Code quality
  2. Potential bugs
  3. Performance

Usage:
  /review "the changes in src/utils.ts"

Commands:
  /commands           List all custom commands
  /command:create     Create a new command
  /command:delete     Delete a command
`;
  }
}

// Singleton instance
let customCommandLoaderInstance: CustomCommandLoader | null = null;

/**
 * Gets the singleton instance of CustomCommandLoader.
 *
 * @returns The singleton instance.
 */
export function getCustomCommandLoader(): CustomCommandLoader {
  if (!customCommandLoaderInstance) {
    customCommandLoaderInstance = new CustomCommandLoader();
  }
  return customCommandLoaderInstance;
}