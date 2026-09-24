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
  failed?: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
}

const HEADLESS_SCRIPT_TIMEOUT_DEFAULT_MS = 30_000;
const HEADLESS_SCRIPT_TIMEOUT_MAX_MS = 300_000;

export function headlessScriptTimeoutMs(raw = process.env.CODEBUDDY_HEADLESS_SCRIPT_TIMEOUT_MS): number {
  if (raw === undefined || raw.trim() === '') return HEADLESS_SCRIPT_TIMEOUT_DEFAULT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return HEADLESS_SCRIPT_TIMEOUT_DEFAULT_MS;
  return Math.min(Math.floor(parsed), HEADLESS_SCRIPT_TIMEOUT_MAX_MS);
}

function scriptResult(content: string, failed = false): CommandHandlerResult {
  return {
    handled: true,
    ...(failed ? { failed: true } : {}),
    entry: {
      type: 'assistant',
      content,
      timestamp: new Date(),
    },
  };
}

/**
 * Run a script and return its outcome. Headless callers use this so a failure
 * becomes exit code 1. The wait is capped by headlessScriptTimeoutMs.
 */
export async function runScriptForExitCode(fullPath: string): Promise<CommandHandlerResult> {
  const timeoutMs = headlessScriptTimeoutMs();
  const manager = getScriptManager();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    timer.unref();
  });
  const run = manager.execute(fullPath, {
    verbose: false,
    enableAI: true,
    enableBash: true,
    enableFileOps: true,
    timeout: timeoutMs,
  }).then(
    (result) => ({ kind: 'done' as const, result }),
    (error: unknown) => ({ kind: 'error' as const, error }),
  );
  try {
    const outcome = await Promise.race([run, timeout]);
    if (outcome.kind === 'timeout') {
      return scriptResult(
        `❌ Script timed out after ${timeoutMs}ms: ${path.basename(fullPath)}`,
        true,
      );
    }
    if (outcome.kind === 'error') {
      const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      return scriptResult(`❌ Script error: ${message}`, true);
    }
    if (!outcome.result.success) {
      return scriptResult(`❌ Script failed: ${outcome.result.error ?? 'unknown error'}`, true);
    }
    const lines = [
      `✅ Script completed in ${outcome.result.duration}ms`,
      ...outcome.result.output,
    ];
    return scriptResult(lines.join('\n'));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Handle /script. Headless run waits for the script; the TUI still returns at once. */
export function handleScript(args: string[]): CommandHandlerResult | Promise<CommandHandlerResult> {
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

  return scriptResult(content, content.startsWith('❌'));
}

/**
 * Run a script file
 */
function handleScriptRun(filePath: string): CommandHandlerResult | Promise<CommandHandlerResult> {
  if (!filePath) {
    return scriptResult(`❌ Usage: /script run <file.bs>

Examples:
  /script run deploy.bs
  /script run ./scripts/backup.bs
  /script run ~/automation/daily.bs`, true);
  }

  // Resolve path
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    return scriptResult(`❌ Script not found: ${fullPath}`, true);
  }

  // Headless must observe the outcome. The interactive TUI still returns at once.
  if (process.env.CODEBUDDY_HEADLESS === 'true') {
    return runScriptForExitCode(fullPath);
  }

  void executeScriptAsync(fullPath);

  return scriptResult(`🚀 Running script: ${path.basename(fullPath)}...`);
}

/**
 * Execute script asynchronously
 */
async function executeScriptAsync(filePath: string): Promise<void> {
  const manager = getScriptManager();

  try {
    const result = await manager.execute(filePath, {
      verbose: true,
      enableAI: true,
      enableBash: true,
      enableFileOps: true,
    });

    if (result.success) {
      console.log('\n📜 Script Output:');
      console.log('─'.repeat(40));
      result.output.forEach(line => console.log(line));
      console.log('─'.repeat(40));
      console.log(`✅ Script completed in ${result.duration}ms`);
      if (result.returnValue !== null && result.returnValue !== undefined) {
        console.log(`   Return value: ${JSON.stringify(result.returnValue)}`);
      }
    } else {
      console.log(`\n❌ Script failed: ${result.error}`);
    }
  } catch (error) {
    console.log(`\n❌ Script error: ${error instanceof Error ? error.message : error}`);
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
