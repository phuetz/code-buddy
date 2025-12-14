/**
 * FCS Handlers - FileCommander Script Integration
 *
 * Provides /fcs command for executing .fcs scripts
 * 100% compatible with FileCommander Enhanced Script
 */

import * as fs from 'fs';
import * as path from 'path';
import { ChatEntry } from "../../agent/grok-agent.js";
import { executeFCS, executeFCSFile, parseFCS } from "../../fcs/index.js";
import type { FCSConfig as _FCSConfig } from "../../fcs/index.js"; // Type-only import for documentation

export interface CommandHandlerResult {
  handled: boolean;
  entry?: ChatEntry;
  passToAI?: boolean;
  prompt?: string;
}

/**
 * Handle /fcs command
 */
export function handleFCS(args: string[]): CommandHandlerResult {
  const action = args[0]?.toLowerCase();
  const target = args.slice(1).join(' ');

  let content: string;

  switch (action) {
    case 'run':
    case 'exec':
      return handleFCSRun(target);

    case 'validate':
    case 'check':
      content = handleFCSValidate(target);
      break;

    case 'parse':
    case 'ast':
      content = handleFCSParse(target);
      break;

    case 'repl':
      return handleFCSRepl();

    case 'list':
    case 'ls':
      content = handleFCSList(target);
      break;

    case 'help':
    default:
      content = getFCSHelp();
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
 * Run an FCS script file
 */
function handleFCSRun(filePath: string): CommandHandlerResult {
  if (!filePath) {
    return {
      handled: true,
      entry: {
        type: "assistant",
        content: `Usage: /fcs run <file.fcs>

Examples:
  /fcs run script.fcs
  /fcs run ./scripts/automation.fcs
  /fcs run ~/scripts/deploy.fcs`,
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
        content: `Script not found: ${fullPath}`,
        timestamp: new Date(),
      },
    };
  }

  // Execute asynchronously
  executeFCSAsync(fullPath);

  return {
    handled: true,
    entry: {
      type: "assistant",
      content: `Running FCS script: ${path.basename(fullPath)}...`,
      timestamp: new Date(),
    },
  };
}

/**
 * Execute FCS script asynchronously
 */
async function executeFCSAsync(filePath: string): Promise<void> {
  try {
    const result = await executeFCSFile(filePath, {
      verbose: true,
      enableAI: true,
      enableBash: true,
      enableFileOps: true,
    });

    if (result.success) {
      console.log('\nFCS Script Output:');
      console.log('-'.repeat(40));
      result.output.forEach(line => console.log(line));
      console.log('-'.repeat(40));
      console.log(`Script completed in ${result.duration}ms`);
      if (result.returnValue !== null && result.returnValue !== undefined) {
        console.log(`Return value: ${JSON.stringify(result.returnValue)}`);
      }
    } else {
      console.log(`\nScript failed: ${result.error}`);
    }
  } catch (error) {
    console.log(`\nScript error: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Validate FCS syntax
 */
function handleFCSValidate(filePath: string): string {
  if (!filePath) {
    return `Usage: /fcs validate <file.fcs>`;
  }

  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    return `Script not found: ${fullPath}`;
  }

  try {
    const source = fs.readFileSync(fullPath, 'utf-8');
    const { tokens, ast } = parseFCS(source);

    const stats = {
      tokens: tokens.length,
      statements: ast.statements.length,
      functions: ast.statements.filter((s: { type: string }) => s.type === 'FunctionDeclaration').length,
      classes: ast.statements.filter((s: { type: string }) => s.type === 'ClassDeclaration').length,
      tests: ast.statements.filter((s: { type: string }) => s.type === 'TestDeclaration').length,
    };

    return `FCS Script Valid: ${path.basename(fullPath)}

Statistics:
  Tokens: ${stats.tokens}
  Statements: ${stats.statements}
  Functions: ${stats.functions}
  Classes: ${stats.classes}
  Tests: ${stats.tests}`;
  } catch (error) {
    return `Validation failed: ${error instanceof Error ? error.message : error}`;
  }
}

/**
 * Parse and show AST
 */
function handleFCSParse(source: string): string {
  if (!source) {
    return `Usage: /fcs parse <code or file.fcs>`;
  }

  try {
    let code = source;

    // Check if it's a file path
    if (source.endsWith('.fcs') || source.endsWith('.fc')) {
      const fullPath = path.isAbsolute(source)
        ? source
        : path.resolve(process.cwd(), source);

      if (fs.existsSync(fullPath)) {
        code = fs.readFileSync(fullPath, 'utf-8');
      }
    }

    const { tokens, ast } = parseFCS(code);

    return `FCS Parse Result:

Tokens (${tokens.length}):
${tokens.slice(0, 20).map(t => `  ${t.type}: "${t.value}"`).join('\n')}
${tokens.length > 20 ? `  ... and ${tokens.length - 20} more` : ''}

AST (${ast.statements.length} statements):
${JSON.stringify(ast, null, 2).substring(0, 2000)}
${JSON.stringify(ast).length > 2000 ? '... (truncated)' : ''}`;
  } catch (error) {
    return `Parse failed: ${error instanceof Error ? error.message : error}`;
  }
}

/**
 * Start FCS REPL
 */
function handleFCSRepl(): CommandHandlerResult {
  // REPL would require an interactive session
  // For now, just print instructions
  return {
    handled: true,
    entry: {
      type: "assistant",
      content: `FCS REPL Mode

Enter FCS code directly in the chat. The code will be executed and results displayed.

Examples:
  print("Hello from FCS!")
  let x = 10 + 20; print(x)
  for i in range(5) { print(i) }

Exit REPL with: /fcs exit`,
      timestamp: new Date(),
    },
  };
}

/**
 * List FCS files
 */
function handleFCSList(dir?: string): string {
  const searchDir = dir
    ? (path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir))
    : process.cwd();

  if (!fs.existsSync(searchDir)) {
    return `Directory not found: ${searchDir}`;
  }

  const files = fs.readdirSync(searchDir)
    .filter(f => f.endsWith('.fcs') || f.endsWith('.fc'))
    .map(f => path.join(searchDir, f));

  if (files.length === 0) {
    return `No FCS scripts found in: ${searchDir}

FileCommander Script files have .fcs or .fc extension.`;
  }

  const lines = [
    `FCS Scripts in ${searchDir}`,
    '='.repeat(40),
    '',
  ];

  for (const file of files) {
    const name = path.basename(file);
    const stats = fs.statSync(file);
    const size = formatBytes(stats.size);
    const modified = stats.mtime.toLocaleDateString();

    lines.push(`  ${name}`);
    lines.push(`     Size: ${size} | Modified: ${modified}`);
  }

  lines.push('');
  lines.push(`Total: ${files.length} script(s)`);
  lines.push('');
  lines.push('Run a script with: /fcs run <name.fcs>');

  return lines.join('\n');
}

/**
 * Get FCS help
 */
function getFCSHelp(): string {
  return `FileCommander Script (FCS) - 100% Compatible
================================================

FCS is a scripting language 100% compatible with FileCommander Enhanced.
Use it to automate file operations, run shell commands, and integrate with AI.

Commands:
  /fcs                      Show this help
  /fcs run <file.fcs>       Run an FCS script
  /fcs validate <file.fcs>  Check script syntax
  /fcs parse <code>         Show AST for code
  /fcs list [dir]           List FCS scripts
  /fcs repl                 Enter REPL mode

Language Features:
  Variables:      let x = 10; const PI = 3.14
  Functions:      func greet(name) { print("Hello " + name) }
  Control Flow:   if/else, for x in items, while condition
  Classes:        class Person { func init() { } }
  Pipeline:       data |> transform |> output
  Tests:          test "should work" { assert true }
  Decorators:     @benchmark func slow() { }

Builtins:
  I/O:        print(), input()
  Files:      readFile(), writeFile(), fileExists()
  Shell:      exec(), shell(), bash()
  Math:       abs(), sqrt(), pow(), random()
  Strings:    upper(), lower(), trim(), split()
  Arrays:     range(), map(), filter(), reduce()
  AI:         ai(), grok()

Example Script:
  +---------------------------------
  | // automation.fcs
  | func backup(files) {
  |     for f in files {
  |         copy(f, "backup/" + basename(f))
  |     }
  | }
  |
  | let sources = glob("src/*.ts")
  | sources |> backup
  | print("Backup complete!")
  +---------------------------------

Tip: FCS scripts work seamlessly with FileCommander Enhanced.`;
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Check if a file is an FCS script
 */
export function isFCSScript(filePath: string): boolean {
  return filePath.endsWith('.fcs') || filePath.endsWith('.fc');
}

/**
 * Execute inline FCS code (for REPL mode)
 */
export async function executeInlineFCS(code: string): Promise<{
  success: boolean;
  output: string[];
  error?: string;
}> {
  try {
    const result = await executeFCS(code, {
      verbose: false,
      enableAI: true,
      enableBash: true,
      enableFileOps: true,
    });

    return {
      success: result.success,
      output: result.output,
      error: result.error,
    };
  } catch (error) {
    return {
      success: false,
      output: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
