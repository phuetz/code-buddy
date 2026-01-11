/**
 * Buddy Script Built-in Functions
 *
 * Provides bindings to code-buddy features for scripting
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import { CodeBuddyScriptConfig, CodeBuddyValue, CodeBuddyFunction, ScriptAgentInterface } from './types.js';
import { logger } from '../utils/logger.js';

type PrintFn = (msg: string) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BuiltinFunctions = Record<string, any>;

// Lazy-loaded agent instance for AI operations
let cachedAgent: ScriptAgentInterface | null = null;

/**
 * Get or create the AI agent for script execution
 */
async function getOrCreateAgent(config: CodeBuddyScriptConfig): Promise<ScriptAgentInterface | null> {
  // Use provided agent if available
  if (config.agent) {
    return config.agent;
  }

  // Return cached agent if already created
  if (cachedAgent) {
    return cachedAgent;
  }

  // Try to create a new agent with lazy loading
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) {
    logger.warn('GROK_API_KEY not set, AI operations will not be available');
    return null;
  }

  try {
    const { CodeBuddyAgent } = await import('../agent/codebuddy-agent.js');
    cachedAgent = new CodeBuddyAgent(
      apiKey,
      process.env.GROK_BASE_URL,
      process.env.GROK_MODEL || 'grok-3-latest'
    ) as unknown as ScriptAgentInterface;
    return cachedAgent;
  } catch (error) {
    logger.error('Failed to create AI agent for scripting', {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Create all built-in functions for the Buddy Script runtime
 */
export function createBuiltins(config: CodeBuddyScriptConfig, print: PrintFn): BuiltinFunctions {
  const builtins: BuiltinFunctions = {};

  // ============================================
  // Core Functions
  // ============================================

  builtins.print = (...args: CodeBuddyValue[]) => {
    const message = args.map(a => stringify(a)).join(' ');
    print(message);
    return null;
  };

  builtins.println = (...args: CodeBuddyValue[]) => {
    builtins.print(...args);
    return null;
  };

  builtins.typeof = (value: CodeBuddyValue) => {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  };

  builtins.len = (value: CodeBuddyValue) => {
    if (typeof value === 'string') return value.length;
    if (Array.isArray(value)) return value.length;
    if (typeof value === 'object' && value !== null) return Object.keys(value).length;
    return 0;
  };

  builtins.str = (value: CodeBuddyValue) => stringify(value);
  builtins.num = (value: CodeBuddyValue) => Number(value);
  builtins.bool = (value: CodeBuddyValue) => Boolean(value);
  builtins.int = (value: CodeBuddyValue) => Math.floor(Number(value));
  builtins.float = (value: CodeBuddyValue) => Number(value);

  // ============================================
  // Array/Object Functions
  // ============================================

  builtins.range = (start: CodeBuddyValue, end?: CodeBuddyValue, step?: CodeBuddyValue) => {
    const s = Number(start);
    const e = end !== undefined ? Number(end) : s;
    const st = step !== undefined ? Number(step) : 1;
    const actualStart = end !== undefined ? s : 0;

    const result: number[] = [];
    if (st > 0) {
      for (let i = actualStart; i < e; i += st) result.push(i);
    } else if (st < 0) {
      for (let i = actualStart; i > e; i += st) result.push(i);
    }
    return result;
  };

  builtins.keys = (obj: CodeBuddyValue) => {
    if (typeof obj === 'object' && obj !== null) {
      return Object.keys(obj);
    }
    return [];
  };

  builtins.values = (obj: CodeBuddyValue) => {
    if (typeof obj === 'object' && obj !== null) {
      return Object.values(obj);
    }
    return [];
  };

  builtins.entries = (obj: CodeBuddyValue) => {
    if (typeof obj === 'object' && obj !== null) {
      return Object.entries(obj);
    }
    return [];
  };

  builtins.push = (arr: CodeBuddyValue, ...items: CodeBuddyValue[]) => {
    if (Array.isArray(arr)) {
      arr.push(...items);
      return arr; // Return array for chaining
    }
    throw new Error('push requires an array');
  };

  builtins.pop = (arr: CodeBuddyValue) => {
    if (Array.isArray(arr)) {
      return arr.pop();
    }
    throw new Error('pop requires an array');
  };

  builtins.join = (arr: CodeBuddyValue, separator?: CodeBuddyValue) => {
    if (Array.isArray(arr)) {
      return arr.map(stringify).join(separator !== undefined ? String(separator) : ',');
    }
    throw new Error('join requires an array');
  };

  builtins.split = (str: CodeBuddyValue, separator?: CodeBuddyValue) => {
    return String(str).split(separator !== undefined ? String(separator) : '');
  };

  builtins.slice = (arr: CodeBuddyValue, start?: CodeBuddyValue, end?: CodeBuddyValue) => {
    if (Array.isArray(arr) || typeof arr === 'string') {
      return arr.slice(
        start !== undefined ? Number(start) : undefined,
        end !== undefined ? Number(end) : undefined
      );
    }
    throw new Error('slice requires an array or string');
  };

  builtins.map = async (arr: CodeBuddyValue, fn: CodeBuddyValue) => {
    if (!Array.isArray(arr)) throw new Error('map requires an array');
    if (typeof fn !== 'function') throw new Error('map requires a function');

    const results: CodeBuddyValue[] = [];
    for (let i = 0; i < arr.length; i++) {
      results.push(await (fn as CodeBuddyFunction)(arr[i], i));
    }
    return results;
  };

  builtins.filter = async (arr: CodeBuddyValue, fn: CodeBuddyValue) => {
    if (!Array.isArray(arr)) throw new Error('filter requires an array');
    if (typeof fn !== 'function') throw new Error('filter requires a function');

    const results: CodeBuddyValue[] = [];
    for (let i = 0; i < arr.length; i++) {
      if (await (fn as CodeBuddyFunction)(arr[i], i)) {
        results.push(arr[i]);
      }
    }
    return results;
  };

  builtins.find = async (arr: CodeBuddyValue, fn: CodeBuddyValue) => {
    if (!Array.isArray(arr)) throw new Error('find requires an array');
    if (typeof fn !== 'function') throw new Error('find requires a function');

    for (let i = 0; i < arr.length; i++) {
      if (await (fn as CodeBuddyFunction)(arr[i], i)) {
        return arr[i];
      }
    }
    return null;
  };

  builtins.includes = (arr: CodeBuddyValue, item: CodeBuddyValue) => {
    if (Array.isArray(arr)) return arr.includes(item);
    if (typeof arr === 'string') return arr.includes(String(item));
    return false;
  };

  // ============================================
  // String Functions
  // ============================================

  builtins.trim = (str: CodeBuddyValue) => String(str).trim();
  builtins.lower = (str: CodeBuddyValue) => String(str).toLowerCase();
  builtins.upper = (str: CodeBuddyValue) => String(str).toUpperCase();
  builtins.replace = (str: CodeBuddyValue, search: CodeBuddyValue, replacement: CodeBuddyValue) => {
    return String(str).replace(String(search), String(replacement));
  };
  builtins.replaceAll = (str: CodeBuddyValue, search: CodeBuddyValue, replacement: CodeBuddyValue) => {
    return String(str).replaceAll(String(search), String(replacement));
  };
  builtins.startsWith = (str: CodeBuddyValue, prefix: CodeBuddyValue) => String(str).startsWith(String(prefix));
  builtins.endsWith = (str: CodeBuddyValue, suffix: CodeBuddyValue) => String(str).endsWith(String(suffix));
  builtins.contains = (str: CodeBuddyValue, search: CodeBuddyValue) => String(str).includes(String(search));
  builtins.match = (str: CodeBuddyValue, pattern: CodeBuddyValue) => {
    const match = String(str).match(new RegExp(String(pattern)));
    return match ? Array.from(match) : null;
  };

  // ============================================
  // Math Functions
  // ============================================

  builtins.min = (...args: CodeBuddyValue[]) => {
    const nums = args.flat().map(Number);
    return Math.min(...nums);
  };

  builtins.max = (...args: CodeBuddyValue[]) => {
    const nums = args.flat().map(Number);
    return Math.max(...nums);
  };

  builtins.abs = (n: CodeBuddyValue) => Math.abs(Number(n));
  builtins.floor = (n: CodeBuddyValue) => Math.floor(Number(n));
  builtins.ceil = (n: CodeBuddyValue) => Math.ceil(Number(n));
  builtins.round = (n: CodeBuddyValue) => Math.round(Number(n));
  builtins.sqrt = (n: CodeBuddyValue) => Math.sqrt(Number(n));
  builtins.pow = (base: CodeBuddyValue, exp: CodeBuddyValue) => Math.pow(Number(base), Number(exp));
  builtins.random = (max?: CodeBuddyValue) => {
    if (max !== undefined) {
      return Math.floor(Math.random() * Number(max));
    }
    return Math.random();
  };

  // ============================================
  // Time Functions
  // ============================================

  builtins.time = () => Date.now();
  builtins.now = () => new Date().toISOString();
  builtins.sleep = async (ms: CodeBuddyValue) => {
    await new Promise(resolve => setTimeout(resolve, Number(ms)));
    return null;
  };

  // ============================================
  // File Operations (grok.file namespace)
  // ============================================

  const file = {
    read: (filePath: CodeBuddyValue) => {
      if (!config.enableFileOps) throw new Error('File operations disabled');
      const fullPath = resolvePath(String(filePath), config.workdir);
      if (config.dryRun) {
        print(`[DRY RUN] file.read: ${fullPath}`);
        return '';
      }
      return fs.readFileSync(fullPath, 'utf-8');
    },

    write: (filePath: CodeBuddyValue, content: CodeBuddyValue) => {
      if (!config.enableFileOps) throw new Error('File operations disabled');
      const fullPath = resolvePath(String(filePath), config.workdir);
      if (config.dryRun) {
        print(`[DRY RUN] file.write: ${fullPath}`);
        return true;
      }
      fs.writeFileSync(fullPath, String(content));
      return true;
    },

    append: (filePath: CodeBuddyValue, content: CodeBuddyValue) => {
      if (!config.enableFileOps) throw new Error('File operations disabled');
      const fullPath = resolvePath(String(filePath), config.workdir);
      if (config.dryRun) {
        print(`[DRY RUN] file.append: ${fullPath}`);
        return true;
      }
      fs.appendFileSync(fullPath, String(content));
      return true;
    },

    exists: (filePath: CodeBuddyValue) => {
      const fullPath = resolvePath(String(filePath), config.workdir);
      return fs.existsSync(fullPath);
    },

    delete: (filePath: CodeBuddyValue) => {
      if (!config.enableFileOps) throw new Error('File operations disabled');
      const fullPath = resolvePath(String(filePath), config.workdir);
      if (config.dryRun) {
        print(`[DRY RUN] file.delete: ${fullPath}`);
        return true;
      }
      fs.unlinkSync(fullPath);
      return true;
    },

    copy: (src: CodeBuddyValue, dest: CodeBuddyValue) => {
      if (!config.enableFileOps) throw new Error('File operations disabled');
      const srcPath = resolvePath(String(src), config.workdir);
      const destPath = resolvePath(String(dest), config.workdir);
      if (config.dryRun) {
        print(`[DRY RUN] file.copy: ${srcPath} -> ${destPath}`);
        return true;
      }
      fs.copyFileSync(srcPath, destPath);
      return true;
    },

    move: (src: CodeBuddyValue, dest: CodeBuddyValue) => {
      if (!config.enableFileOps) throw new Error('File operations disabled');
      const srcPath = resolvePath(String(src), config.workdir);
      const destPath = resolvePath(String(dest), config.workdir);
      if (config.dryRun) {
        print(`[DRY RUN] file.move: ${srcPath} -> ${destPath}`);
        return true;
      }
      fs.renameSync(srcPath, destPath);
      return true;
    },

    list: (dirPath: CodeBuddyValue) => {
      const fullPath = resolvePath(String(dirPath), config.workdir);
      return fs.readdirSync(fullPath);
    },

    mkdir: (dirPath: CodeBuddyValue) => {
      if (!config.enableFileOps) throw new Error('File operations disabled');
      const fullPath = resolvePath(String(dirPath), config.workdir);
      if (config.dryRun) {
        print(`[DRY RUN] file.mkdir: ${fullPath}`);
        return true;
      }
      fs.mkdirSync(fullPath, { recursive: true });
      return true;
    },

    stat: (filePath: CodeBuddyValue) => {
      const fullPath = resolvePath(String(filePath), config.workdir);
      const stats = fs.statSync(fullPath);
      return {
        size: stats.size,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString(),
      };
    },

    glob: (pattern: CodeBuddyValue) => {
      // Simple glob implementation
      const fullPath = resolvePath(String(pattern), config.workdir);
      const dir = path.dirname(fullPath);
      const base = path.basename(fullPath);

      if (!fs.existsSync(dir)) return [];

      const files = fs.readdirSync(dir);
      const regex = new RegExp('^' + base.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      return files.filter(f => regex.test(f)).map(f => path.join(dir, f));
    },
  };

  builtins.file = file;

  // ============================================
  // Bash/Shell Operations
  // ============================================

  const bash = {
    run: (command: CodeBuddyValue, options?: CodeBuddyValue) => {
      if (!config.enableBash) throw new Error('Bash commands disabled');
      const opts = (options as Record<string, CodeBuddyValue>) || {};

      if (config.dryRun) {
        print(`[DRY RUN] bash: ${command}`);
        return { stdout: '', stderr: '', code: 0 };
      }

      try {
        const stdout = execSync(String(command), {
          cwd: opts.cwd ? String(opts.cwd) : config.workdir,
          encoding: 'utf-8',
          timeout: opts.timeout ? Number(opts.timeout) : 30000,
          maxBuffer: 10 * 1024 * 1024,
        });

        return {
          stdout: stdout.trim(),
          stderr: '',
          code: 0,
        };
      } catch (error) {
        const execError = error as { stdout?: string; stderr?: string; status?: number };
        return {
          stdout: execError.stdout || '',
          stderr: execError.stderr || String(error),
          code: execError.status || 1,
        };
      }
    },

    exec: (command: CodeBuddyValue) => {
      const result = bash.run(command) as { stdout: string; code: number };
      if (result.code !== 0) {
        throw new Error(`Command failed with code ${result.code}`);
      }
      return result.stdout;
    },

    spawn: async (command: CodeBuddyValue, args?: CodeBuddyValue) => {
      if (!config.enableBash) throw new Error('Bash commands disabled');

      const argList = Array.isArray(args) ? args.map(String) : [];

      return new Promise((resolve, reject) => {
        const proc = spawn(String(command), argList, {
          cwd: config.workdir,
          shell: true,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data) => {
          stdout += data.toString();
          if (config.verbose) print(data.toString());
        });

        proc.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (code) => {
          resolve({ stdout, stderr, code });
        });

        proc.on('error', reject);
      });
    },
  };

  builtins.bash = bash;

  // ============================================
  // AI Operations (placeholder - will integrate with CodeBuddyAgent)
  // ============================================

  const ai = {
    ask: async (prompt: CodeBuddyValue) => {
      if (!config.enableAI) throw new Error('AI operations disabled');
      if (config.dryRun) {
        print(`[DRY RUN] ai.ask: ${prompt}`);
        return '[AI Response Placeholder]';
      }
      const agent = await getOrCreateAgent(config);
      if (!agent) {
        throw new Error('AI agent not available. Ensure GROK_API_KEY is set.');
      }
      const result = await agent.processUserInput(String(prompt));
      return result.content || '';
    },

    chat: async (message: CodeBuddyValue) => {
      if (!config.enableAI) throw new Error('AI operations disabled');
      if (config.dryRun) {
        print(`[DRY RUN] ai.chat: ${message}`);
        return '[AI Response Placeholder]';
      }
      const agent = await getOrCreateAgent(config);
      if (!agent) {
        throw new Error('AI agent not available. Ensure GROK_API_KEY is set.');
      }
      const result = await agent.processUserInput(String(message));
      return result.content || '';
    },

    complete: async (prompt: CodeBuddyValue, options?: CodeBuddyValue) => {
      if (!config.enableAI) throw new Error('AI operations disabled');
      if (config.dryRun) {
        print(`[DRY RUN] ai.complete: ${prompt}`);
        return '[AI Response Placeholder]';
      }
      const agent = await getOrCreateAgent(config);
      if (!agent) {
        throw new Error('AI agent not available. Ensure GROK_API_KEY is set.');
      }
      const opts = typeof options === 'object' && options !== null ? options as Record<string, unknown> : {};
      const result = await agent.processUserInput(String(prompt), opts);
      return result.content || '';
    },
  };

  builtins.ai = ai;

  // ============================================
  // Environment & Config
  // ============================================

  const env = {
    get: (name: CodeBuddyValue) => process.env[String(name)] || null,
    set: (name: CodeBuddyValue, value: CodeBuddyValue) => {
      process.env[String(name)] = String(value);
      return true;
    },
    all: () => ({ ...process.env }),
  };

  builtins.env = env;

  const grok = {
    workdir: () => config.workdir,
    verbose: () => config.verbose,
    dryRun: () => config.dryRun,
    version: () => '1.0.0',
  };

  builtins.grok = grok;

  // ============================================
  // JSON
  // ============================================

  const json = {
    parse: (str: CodeBuddyValue) => JSON.parse(String(str)),
    stringify: (value: CodeBuddyValue, indent?: CodeBuddyValue) => {
      return JSON.stringify(value, null, indent ? Number(indent) : undefined);
    },
  };

  builtins.json = json;
  builtins.JSON = json;

  // ============================================
  // Console (alias for print functions)
  // ============================================

  const console = {
    log: builtins.print,
    info: builtins.print,
    warn: (...args: CodeBuddyValue[]) => {
      print('[WARN] ' + args.map(stringify).join(' '));
      return null;
    },
    error: (...args: CodeBuddyValue[]) => {
      print('[ERROR] ' + args.map(stringify).join(' '));
      return null;
    },
  };

  builtins.console = console;

  // ============================================
  // Math namespace (for compatibility)
  // ============================================

  builtins.Math = {
    min: builtins.min,
    max: builtins.max,
    abs: builtins.abs,
    floor: builtins.floor,
    ceil: builtins.ceil,
    round: builtins.round,
    sqrt: builtins.sqrt,
    pow: builtins.pow,
    random: () => Math.random(),
    PI: Math.PI,
    E: Math.E,
  };

  builtins.Date = {
    now: () => Date.now(),
    parse: (str: CodeBuddyValue) => Date.parse(String(str)),
  };

  return builtins;
}

// ============================================
// Utility Functions
// ============================================

function stringify(value: CodeBuddyValue): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function resolvePath(filePath: string, workdir: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(workdir, filePath);
}
