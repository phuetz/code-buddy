/**
 * Script Handlers - Run and manage Buddy Scripts
 *
 * Provides /script command for executing .bs automation scripts
 */

import * as fs from 'fs';
import * as path from 'path';
import { ChatEntry } from "../../agent/codebuddy-agent.js";
import {
  validateScript,
  createScriptTemplate,
  getScriptManager,
  isBuddyScript,
} from "../../scripting/index.js";

export interface CommandHandlerResult {
  handled: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
}

/**
 * Handle /script command
 */
export async function handleScript(args: string[]): Promise<CommandHandlerResult> {
  const action = args[0]?.toLowerCase();
  const target = args.slice(1).join(' ');

  let content: string;

  switch (action) {
    case 'run':
    case 'exec':
      return handleScriptRun(target);

    case 'new':
    case 'create':
      content = handleScriptCreate(target);
      break;

    case 'validate':
    case 'check':
      content = handleScriptValidate(target);
      break;

    case 'list':
    case 'ls':
      content = handleScriptList(target);
      break;

    case 'history':
      content = handleScriptHistory();
      break;

    case 'help':
    default:
      content = getScriptHelp();
      break;
  }

  return {
    handled: true,
    entry: {
      type: "assistant",
      content,
      timestamp: new Date(),
    },
  };
}

/**
 * Run a script file
 */
async function handleScriptRun(filePath: string): Promise<CommandHandlerResult> {
  if (!filePath) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `❌ Usage: /script run <file.bs>

Examples:
  /script run deploy.bs
  /script run ./scripts/backup.bs
  /script run ~/automation/daily.bs`,
        timestamp: new Date(),
      },
    };
  }

  // Resolve path
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `❌ Script not found: ${fullPath}`,
        timestamp: new Date(),
      },
    };
  }

  const manager = getScriptManager();

  try {
    const result = await manager.execute(filePath, {
      verbose: true,
      enableAI: true,
      enableBash: true,
      enableFileOps: true,
    });

    if (result.success) {
      const output = result.output.length > 0 ? result.output.join('\n') : '(no output)';
      const returnValue = result.returnValue !== null && result.returnValue !== undefined
        ? `\nReturn value: ${JSON.stringify(result.returnValue)}`
        : '';

      return {
        handled: true,
        entry: {
          type: "assistant",
          content: `📜 Script Output: ${path.basename(filePath)}
${'─'.repeat(40)}
${output}
${'─'.repeat(40)}
✅ Script completed in ${result.duration}ms${returnValue}`,
          timestamp: new Date(),
        },
      };
    }

    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `❌ Script failed: ${result.error || 'Unknown script error'}`,
        timestamp: new Date(),
      },
    };
  } catch (error) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `❌ Script error: ${error instanceof Error ? error.message : error}`,
        timestamp: new Date(),
      },
    };
  }
}

/**
 * Create a new script file
 */
function handleScriptCreate(filePath: string): string {
  if (!filePath) {
    return `❌ Usage: /script new <name.bs>

Examples:
  /script new deploy.bs
  /script new backup-database.bs`;
  }

  // Ensure .bs extension
  let fullPath = filePath;
  if (!isBuddyScript(fullPath)) {
    fullPath += '.bs';
  }

  // Resolve path
  fullPath = path.isAbsolute(fullPath)
    ? fullPath
    : path.resolve(process.cwd(), fullPath);

  if (fs.existsSync(fullPath)) {
    return `❌ Script already exists: ${fullPath}`;
  }

  const name = path.basename(fullPath, '.bs');
  const template = createScriptTemplate(name, `Automation script for ${name}`);

  try {
    fs.writeFileSync(fullPath, template);
    return `✅ Created script: ${fullPath}

Template includes:
  • Basic structure with main() function
  • File operations (file.read, file.write)
  • Bash commands (bash.exec, bash.run)
  • AI operations (ai.ask, ai.chat)
  • Error handling with try/catch

Edit the script and run with:
  /script run ${path.basename(fullPath)}`;
  } catch (error) {
    return `❌ Failed to create script: ${error instanceof Error ? error.message : error}`;
  }
}

/**
 * Validate a script without running it
 */
function handleScriptValidate(filePath: string): string {
  if (!filePath) {
    return `❌ Usage: /script validate <file.bs>`;
  }

  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    return `❌ Script not found: ${fullPath}`;
  }

  try {
    const source = fs.readFileSync(fullPath, 'utf-8');
    const result = validateScript(source);

    if (result.valid) {
      return `✅ Script is valid: ${path.basename(fullPath)}`;
    } else {
      return `❌ Script has errors:\n${result.errors.map(e => `  • ${e}`).join('\n')}`;
    }
  } catch (error) {
    return `❌ Failed to validate: ${error instanceof Error ? error.message : error}`;
  }
}

/**
 * List available scripts
 */
function handleScriptList(dir?: string): string {
  const searchDir = dir
    ? (path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir))
    : process.cwd();

  const manager = getScriptManager();
  const scripts = manager.listScripts(searchDir);

  if (scripts.length === 0) {
    return `📁 No scripts found in: ${searchDir}

Create a new script with:
  /script new myscript.bs`;
  }

  const lines = [
    `📁 Scripts in ${searchDir}`,
    '═'.repeat(40),
    '',
  ];

  for (const script of scripts) {
    const name = path.basename(script);
    const stats = fs.statSync(script);
    const size = formatBytes(stats.size);
    const modified = stats.mtime.toLocaleDateString();

    lines.push(`  📜 ${name}`);
    lines.push(`     Size: ${size} | Modified: ${modified}`);
  }

  lines.push('');
  lines.push(`Total: ${scripts.length} script(s)`);
  lines.push('');
  lines.push('Run a script with: /script run <name.bs>');

  return lines.join('\n');
}

/**
 * Show script execution history
 */
function handleScriptHistory(): string {
  const manager = getScriptManager();
  const history = manager.getHistory();

  if (history.length === 0) {
    return `📜 No script execution history yet.

Run a script with:
  /script run <file.bs>`;
  }

  const lines = [
    '📜 Script Execution History',
    '═'.repeat(40),
    '',
  ];

  // Show last 10 executions
  const recent = history.slice(-10).reverse();

  for (const entry of recent) {
    const name = path.basename(entry.script);
    const status = entry.result.success ? '✅' : '❌';
    const time = entry.timestamp.toLocaleTimeString();
    const duration = `${entry.result.duration}ms`;

    lines.push(`${status} ${name}`);
    lines.push(`   Time: ${time} | Duration: ${duration}`);
    if (!entry.result.success && entry.result.error) {
      lines.push(`   Error: ${entry.result.error.substring(0, 50)}...`);
    }
    lines.push('');
  }

  lines.push(`Showing ${recent.length} of ${history.length} executions`);

  return lines.join('\n');
}

/**
 * Get help for script command
 */
function getScriptHelp(): string {
  return `📜 Buddy Script - Automation Language
═══════════════════════════════════════════════════

Run automation scripts written in Buddy Script (.bs files).
Inspired by FileCommander Enhanced Script (FCS).

📋 Commands:
  /script                      - Show this help
  /script run <file.bs>        - Run a script
  /script new <name.bs>        - Create new script
  /script validate <file.bs>   - Check script syntax
  /script list [dir]           - List available scripts
  /script history              - Show execution history

📌 Examples:
  /script run deploy.bs
  /script new backup-db.bs
  /script validate test.bs
  /script list ./scripts

🔧 Script Features:
  • Variables: let x = 10
  • Functions: function greet(name) { ... }
  • Control flow: if/else, for, while
  • File ops: file.read(), file.write()
  • Bash: bash.exec("ls -la")
  • AI: ai.ask("question")
  • JSON: json.parse(), json.stringify()

📝 Example Script:
  ┌─────────────────────────────────
  │ // backup.bs
  │ let files = file.list("./src")
  │ for f in files {
  │     print("Backing up: " + f)
  │     file.copy(f, "./backup/" + f)
  │ }
  │ print("Done!")
  └─────────────────────────────────

💡 Tip: Use /script new to create a template script.`;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
