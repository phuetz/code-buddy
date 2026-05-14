/**
 * Unified Scripting Module for Code Buddy
 *
 * Merges FileCommander Script (FCS) and Buddy Script into a single system.
 * Extensions: .bs (primary), .fcs (backward-compatible alias)
 *
 * Usage:
 *   buddy --script myscript.bs
 *   /script run myscript.bs
 *   /script new myscript.bs
 */

import * as fs from 'fs';
import * as path from 'path';
import { tokenize } from './lexer.js';
import { parse } from './parser.js';
import { Runtime } from './runtime.js';
import {
  CodeBuddyScriptConfig,
  DEFAULT_SCRIPT_CONFIG,
  ScriptResult,
  Program,
} from './types.js';

// Re-export everything
export * from './types.js';
export { FCSLexer, Lexer, tokenize } from './lexer.js';
export { FCSParser, Parser, parse } from './parser.js';
export { FCSRuntime, Runtime, createRuntime } from './runtime.js';
export { createBuiltins, createFCSBuiltins } from './builtins.js';

// CodeBuddy Bindings
export { createGrokBindings, setCodeBuddyClient, setMCPManager } from './codebuddy-bindings.js';
export type { CodeBuddyBindingsConfig } from './codebuddy-bindings.js';

// Script Registry
export {
  ScriptRegistry,
  getScriptRegistry,
  initScriptRegistry,
  type ScriptTemplate,
  type ScriptCategory,
} from './script-registry.js';

// Sync Bindings
export {
  createSyncBindings,
  getWorkspaceTracker,
  resetWorkspaceTracker,
  WorkspaceStateTracker,
  type WorkspaceSnapshot,
  type FileState,
  type SessionContext,
  type FileDiff,
  type SyncBindingsConfig,
} from './sync-bindings.js';

/**
 * Execute script from source code
 */
export async function executeScript(
  source: string,
  config: Partial<CodeBuddyScriptConfig> = {}
): Promise<ScriptResult> {
  const startTime = Date.now();

  try {
    const tokens = tokenize(source);
    const ast = parse(tokens);
    const runtime = new Runtime({ ...DEFAULT_SCRIPT_CONFIG, ...config });
    const result = await runtime.execute(ast);

    return {
      success: result.success,
      output: result.output,
      error: result.error,
      returnValue: result.returnValue,
      testResults: result.testResults,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      output: [],
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Execute script from a file
 */
export async function executeScriptFile(
  filePath: string,
  config: Partial<CodeBuddyScriptConfig> = {}
): Promise<ScriptResult> {
  const fullPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(config.workdir || process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    return {
      success: false,
      output: [],
      error: `Script file not found: ${fullPath}`,
      duration: 0,
    };
  }

  const source = fs.readFileSync(fullPath, 'utf-8');
  const scriptDir = path.dirname(fullPath);
  const mergedConfig = {
    workdir: scriptDir,
    ...config,
  };

  return executeScript(source, mergedConfig);
}

/**
 * Validate a script without executing it
 */
export function validateScript(source: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  try {
    const tokens = tokenize(source);
    parse(tokens);
    return { valid: true, errors: [] };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return { valid: false, errors };
  }
}

/**
 * Format/pretty-print a script AST
 */
export function formatAST(ast: Program): string {
  return JSON.stringify(ast, null, 2);
}

/**
 * Create a new script template
 */
export function createScriptTemplate(name: string, description: string = ''): string {
  return `#!/usr/bin/env buddy-script
// ============================================
// ${name}
// ${description || 'Code Buddy Script'}
// ============================================

// Import code-buddy bindings
import grok

// Script configuration
let config = {
    verbose: false,
    dryRun: false
}

// Main function
function main() {
    print("=" * 50)
    print(" ${name}")
    print("=" * 50)
    print("")

    // Your code here
    print("Hello from Code Buddy Script!")

    // Example: File operations
    // let content = file.read("README.md")
    // print("File content: " + content)

    // Example: Bash commands
    // let result = bash.exec("ls -la")
    // print("Directory listing:\\n" + result)

    // Example: AI operations
    // let response = await ai.ask("Explain this code")
    // print("AI says: " + response)

    return 0
}

// Run main
try {
    let exitCode = main()
    print("\\nScript completed with code: " + exitCode)
} catch (error) {
    print("\\nError: " + error.message)
}
`;
}

/**
 * Get script file extension
 */
export function getScriptExtension(): string {
  return '.bs';
}

/**
 * Check if a file is a Code Buddy Script
 */
export function isBuddyScript(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.bs' || ext === '.fcs' || ext === '.codebuddy' || ext === '.codebuddyscript';
}

/**
 * Parse source and return AST (for debugging/analysis)
 */
export function parseScript(source: string) {
  const tokens = tokenize(source);
  return {
    tokens,
    ast: parse(tokens),
  };
}

// Backward-compatible aliases
/** @deprecated Use executeScript instead */
export const executeFCS = executeScript;
/** @deprecated Use executeScriptFile instead */
export const executeFCSFile = executeScriptFile;
/** @deprecated Use parseScript instead */
export const parseFCS = parseScript;

/**
 * Script Manager - singleton for managing scripts
 */
class CodeBuddyScriptManager {
  private scripts: Map<string, Program> = new Map();
  private history: Array<{ script: string; result: ScriptResult; timestamp: Date }> = [];

  async load(filePath: string): Promise<Program> {
    const fullPath = path.resolve(filePath);

    if (this.scripts.has(fullPath)) {
      return this.scripts.get(fullPath)!;
    }

    const source = fs.readFileSync(fullPath, 'utf-8');
    const tokens = tokenize(source);
    const ast = parse(tokens);

    this.scripts.set(fullPath, ast);
    return ast;
  }

  async execute(
    filePath: string,
    config: Partial<CodeBuddyScriptConfig> = {}
  ): Promise<ScriptResult> {
    const result = await executeScriptFile(filePath, config);

    this.history.push({
      script: filePath,
      result,
      timestamp: new Date(),
    });

    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }

    return result;
  }

  clearCache(): void {
    this.scripts.clear();
  }

  getHistory(): Array<{ script: string; result: ScriptResult; timestamp: Date }> {
    return [...this.history];
  }

  listScripts(dir: string = process.cwd()): string[] {
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
      .filter(f => isBuddyScript(f))
      .map(f => path.join(dir, f));
  }
}

let scriptManager: CodeBuddyScriptManager | null = null;

export function getScriptManager(): CodeBuddyScriptManager {
  if (!scriptManager) {
    scriptManager = new CodeBuddyScriptManager();
  }
  return scriptManager;
}

export function resetScriptManager(): void {
  scriptManager = null;
}
