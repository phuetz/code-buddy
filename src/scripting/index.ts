/**
 * Grok Script - Scripting Language for grok-cli automation
 *
 * Inspired by FileCommander Enhanced Script (FCS)
 *
 * Usage:
 *   grok --script myscript.gs
 *   /script run myscript.gs
 *   /script new myscript.gs
 */

import * as fs from 'fs';
import * as path from 'path';
import { Lexer, tokenize } from './lexer.js';
import { Parser, parse } from './parser.js';
import { Runtime } from './runtime.js';
import {
  GrokScriptConfig,
  DEFAULT_SCRIPT_CONFIG,
  ScriptResult,
  ProgramNode,
  Token,
} from './types.js';

export * from './types.js';
export { Lexer, tokenize } from './lexer.js';
export { Parser, parse } from './parser.js';
export { Runtime } from './runtime.js';
export { createBuiltins } from './builtins.js';

/**
 * Execute a Grok Script from source code
 */
export async function executeScript(
  source: string,
  config: Partial<GrokScriptConfig> = {}
): Promise<ScriptResult> {
  const startTime = Date.now();

  try {
    // Tokenize
    const tokens = tokenize(source);

    // Parse
    const ast = parse(tokens);

    // Execute
    const runtime = new Runtime({ ...DEFAULT_SCRIPT_CONFIG, ...config });
    const result = await runtime.execute(ast);

    return {
      success: true,
      output: result.output,
      returnValue: result.returnValue,
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
 * Execute a Grok Script from a file
 */
export async function executeScriptFile(
  filePath: string,
  config: Partial<GrokScriptConfig> = {}
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

  // Set workdir to script's directory if not specified
  const scriptDir = path.dirname(fullPath);
  const mergedConfig = {
    workdir: scriptDir,
    ...config,
  };

  return executeScript(source, mergedConfig);
}

/**
 * Validate a Grok Script without executing it
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
 * Format/pretty-print a Grok Script AST
 */
export function formatAST(ast: ProgramNode): string {
  return JSON.stringify(ast, null, 2);
}

/**
 * Create a new script template
 */
export function createScriptTemplate(name: string, description: string = ''): string {
  return `#!/usr/bin/env grok-script
// ============================================
// ${name}
// ${description || 'Grok Script'}
// ============================================

// Import grok-cli bindings
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
    print("Hello from Grok Script!")

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
  return '.gs';
}

/**
 * Check if a file is a Grok Script
 */
export function isGrokScript(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.gs' || ext === '.grok' || ext === '.grokscript';
}

/**
 * Script Manager - singleton for managing scripts
 */
class GrokScriptManager {
  private scripts: Map<string, ProgramNode> = new Map();
  private history: Array<{ script: string; result: ScriptResult; timestamp: Date }> = [];

  /**
   * Load and cache a script
   */
  async load(filePath: string): Promise<ProgramNode> {
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

  /**
   * Execute a cached or new script
   */
  async execute(
    filePath: string,
    config: Partial<GrokScriptConfig> = {}
  ): Promise<ScriptResult> {
    const result = await executeScriptFile(filePath, config);

    this.history.push({
      script: filePath,
      result,
      timestamp: new Date(),
    });

    // Keep only last 100 executions
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }

    return result;
  }

  /**
   * Clear cached scripts
   */
  clearCache(): void {
    this.scripts.clear();
  }

  /**
   * Get execution history
   */
  getHistory(): Array<{ script: string; result: ScriptResult; timestamp: Date }> {
    return [...this.history];
  }

  /**
   * List available scripts in a directory
   */
  listScripts(dir: string = process.cwd()): string[] {
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
      .filter(f => isGrokScript(f))
      .map(f => path.join(dir, f));
  }
}

// Singleton instance
let scriptManager: GrokScriptManager | null = null;

export function getScriptManager(): GrokScriptManager {
  if (!scriptManager) {
    scriptManager = new GrokScriptManager();
  }
  return scriptManager;
}

export function resetScriptManager(): void {
  scriptManager = null;
}
