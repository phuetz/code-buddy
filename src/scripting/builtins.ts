/**
 * Unified Script Built-in Functions
 *
 * Merged from FCS builtins (100+ functions, date/time, format, enumerate/zip)
 * and Buddy Script builtins (ai.*, console.*, lazy agent loading, sandboxing)
 *
 * Extensions: .bs (primary), .fcs (backward-compatible alias)
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
  if (config.agent) {
    return config.agent;
  }

  if (cachedAgent) {
    return cachedAgent;
  }

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
 * Create all built-in functions for the unified scripting runtime
 */
export function createBuiltins(config: CodeBuddyScriptConfig, print: PrintFn): BuiltinFunctions {
  const builtins: BuiltinFunctions = {};

  // ============================================
  // Core I/O
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

  builtins.input = async (prompt?: string): Promise<string> => {
    if (prompt) print(prompt);
    return '';
  };

  // ============================================
  // Type Conversion
  // ============================================

  builtins.int = (value: CodeBuddyValue): number => {
    if (typeof value === 'string') {
      if (value.startsWith('0x') || value.startsWith('0X')) {
        return parseInt(value, 16);
      }
      if (value.startsWith('0b') || value.startsWith('0B')) {
        return parseInt(value.substring(2), 2);
      }
      return parseInt(value, 10);
    }
    return Math.floor(Number(value));
  };

  builtins.float = (value: CodeBuddyValue): number => parseFloat(String(value));
  builtins.num = (value: CodeBuddyValue): number => Number(value);
  builtins.str = (value: CodeBuddyValue): string => stringify(value);
  builtins.bool = (value: CodeBuddyValue): boolean => {
    if (value === null || value === undefined || value === false || value === 0 || value === '') {
      return false;
    }
    return true;
  };

  builtins.array = (value: CodeBuddyValue): CodeBuddyValue[] => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return value.split('');
    if (typeof value === 'object' && value !== null) return Object.values(value);
    return [value];
  };

  // ============================================
  // Collection Functions
  // ============================================

  builtins.len = (value: CodeBuddyValue): number => {
    if (typeof value === 'string') return value.length;
    if (Array.isArray(value)) return value.length;
    if (typeof value === 'object' && value !== null) return Object.keys(value as object).length;
    return 0;
  };

  builtins.range = (...args: number[]): number[] => {
    let start = 0, end = 0, step = 1;
    if (args.length === 1) { end = args[0] ?? 0; }
    else if (args.length === 2) { start = args[0] ?? 0; end = args[1] ?? 0; }
    else if (args.length >= 3) { start = args[0] ?? 0; end = args[1] ?? 0; step = args[2] ?? 1; }

    const result: number[] = [];
    const maxItems = Math.max(1, Math.floor(Number(config.maxLoopIterations)) || 10000);
    const pushBounded = (value: number) => {
      if (result.length >= maxItems) {
        throw new Error(`range() exceeded maxLoopIterations (${maxItems})`);
      }
      result.push(value);
    };

    if (step > 0) { for (let i = start; i < end; i += step) pushBounded(i); }
    else if (step < 0) { for (let i = start; i > end; i += step) pushBounded(i); }
    return result;
  };

  builtins.enumerate = (arr: CodeBuddyValue[]): [number, CodeBuddyValue][] => {
    return arr.map((item, index) => [index, item]);
  };

  builtins.zip = (...arrays: CodeBuddyValue[][]): CodeBuddyValue[][] => {
    const minLen = Math.min(...arrays.map(a => a.length));
    const result: CodeBuddyValue[][] = [];
    for (let i = 0; i < minLen; i++) {
      result.push(arrays.map(a => a[i]));
    }
    return result;
  };

  builtins.map = async (arr: CodeBuddyValue[], fn: CodeBuddyFunction): Promise<CodeBuddyValue[]> => {
    if (!Array.isArray(arr)) throw new Error('map() requires an array as first argument');
    if (typeof fn !== 'function') throw new Error('map() requires a function as second argument');
    const results: CodeBuddyValue[] = [];
    for (let i = 0; i < arr.length; i++) {
      results.push(await fn(arr[i], i));
    }
    return results;
  };

  builtins.filter = async (arr: CodeBuddyValue[], fn: CodeBuddyFunction): Promise<CodeBuddyValue[]> => {
    if (!Array.isArray(arr)) throw new Error('filter() requires an array as first argument');
    if (typeof fn !== 'function') throw new Error('filter() requires a function as second argument');
    const results: CodeBuddyValue[] = [];
    for (let i = 0; i < arr.length; i++) {
      if (await fn(arr[i], i)) results.push(arr[i]);
    }
    return results;
  };

  builtins.reduce = async (arr: CodeBuddyValue[], fn: CodeBuddyFunction, initial?: CodeBuddyValue): Promise<CodeBuddyValue> => {
    let acc = initial !== undefined ? initial : arr[0];
    const startIdx = initial !== undefined ? 0 : 1;
    for (let i = startIdx; i < arr.length; i++) {
      acc = await fn(acc, arr[i], i);
    }
    return acc;
  };

  builtins.find = async (arr: CodeBuddyValue[], fn: CodeBuddyFunction): Promise<CodeBuddyValue> => {
    if (!Array.isArray(arr)) throw new Error('find() requires an array as first argument');
    if (typeof fn !== 'function') throw new Error('find() requires a function as second argument');
    for (let i = 0; i < arr.length; i++) {
      if (await fn(arr[i], i)) return arr[i];
    }
    return null;
  };

  builtins.every = async (arr: CodeBuddyValue[], fn: CodeBuddyFunction): Promise<boolean> => {
    for (const item of arr) { if (!(await fn(item))) return false; }
    return true;
  };

  builtins.some = async (arr: CodeBuddyValue[], fn: CodeBuddyFunction): Promise<boolean> => {
    for (const item of arr) { if (await fn(item)) return true; }
    return false;
  };

  builtins.sort = (arr: CodeBuddyValue[], fn?: CodeBuddyFunction): CodeBuddyValue[] => {
    const copy = [...arr];
    if (fn) {
      copy.sort((a, b) => {
        const result = fn(a, b);
        return typeof result === 'number' ? result : 0;
      });
    } else {
      copy.sort((a, b) => {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        return String(a).localeCompare(String(b));
      });
    }
    return copy;
  };

  builtins.reverse = (arr: CodeBuddyValue[]): CodeBuddyValue[] => [...arr].reverse();

  builtins.slice = (arr: CodeBuddyValue[], start: number, end?: number): CodeBuddyValue[] => arr.slice(start, end);

  builtins.concat = (...arrays: CodeBuddyValue[][]): CodeBuddyValue[] => arrays.flat();

  builtins.push = (arr: CodeBuddyValue[], ...items: CodeBuddyValue[]): CodeBuddyValue[] => {
    if (!Array.isArray(arr)) throw new Error('push() requires an array as first argument');
    arr.push(...items);
    return arr;
  };

  builtins.pop = (arr: CodeBuddyValue[]): CodeBuddyValue => {
    if (!Array.isArray(arr)) throw new Error('pop() requires an array as first argument');
    return arr.pop();
  };

  builtins.shift = (arr: CodeBuddyValue[]): CodeBuddyValue => arr.shift();
  builtins.unshift = (arr: CodeBuddyValue[], ...items: CodeBuddyValue[]): CodeBuddyValue[] => { arr.unshift(...items); return arr; };

  builtins.includes = (arr: CodeBuddyValue, item: CodeBuddyValue): boolean => {
    if (Array.isArray(arr)) return arr.includes(item);
    if (typeof arr === 'string') return arr.includes(String(item));
    return false;
  };

  builtins.indexOf = (arr: CodeBuddyValue[], item: CodeBuddyValue): number => arr.indexOf(item);

  builtins.join = (arr: CodeBuddyValue[], separator = ','): string => {
    if (!Array.isArray(arr)) throw new Error('join() requires an array as first argument');
    return arr.map(a => stringify(a)).join(separator);
  };

  builtins.split = (str: string, separator: string): string[] => String(str).split(separator);

  builtins.keys = (obj: CodeBuddyValue): string[] => {
    if (typeof obj === 'object' && obj !== null) return Object.keys(obj);
    return [];
  };

  builtins.values = (obj: CodeBuddyValue): CodeBuddyValue[] => {
    if (typeof obj === 'object' && obj !== null) return Object.values(obj);
    return [];
  };

  builtins.entries = (obj: CodeBuddyValue): [string, CodeBuddyValue][] => {
    if (typeof obj === 'object' && obj !== null) return Object.entries(obj);
    return [];
  };

  // ============================================
  // String Functions
  // ============================================

  builtins.upper = (str: string): string => String(str).toUpperCase();
  builtins.lower = (str: string): string => String(str).toLowerCase();
  builtins.trim = (str: string): string => String(str).trim();
  builtins.ltrim = (str: string): string => String(str).trimStart();
  builtins.rtrim = (str: string): string => String(str).trimEnd();

  builtins.startsWith = (str: string, prefix: string): boolean => String(str).startsWith(prefix);
  builtins.endsWith = (str: string, suffix: string): boolean => String(str).endsWith(suffix);
  builtins.contains = (str: string, substr: string): boolean => String(str).includes(substr);

  builtins.replace = (str: string, search: string, replace: string): string => String(str).split(search).join(replace);
  builtins.replaceAll = (str: string, search: string, replace: string): string => String(str).split(search).join(replace);

  builtins.substr = (str: string, start: number, length?: number): string => {
    if (length !== undefined) return String(str).substring(start, start + length);
    return String(str).substring(start);
  };

  builtins.charAt = (str: string, index: number): string => String(str).charAt(index);
  builtins.repeat = (str: string, count: number): string => String(str).repeat(count);
  builtins.padStart = (str: string, length: number, char = ' '): string => String(str).padStart(length, char);
  builtins.padEnd = (str: string, length: number, char = ' '): string => String(str).padEnd(length, char);

  builtins.format = (template: string, ...args: CodeBuddyValue[]): string => {
    let result = template;
    for (let i = 0; i < args.length; i++) {
      result = result.replace(`{${i}}`, stringify(args[i]));
      result = result.replace('{}', stringify(args[i]));
    }
    return result;
  };

  builtins.match = (str: CodeBuddyValue, pattern: CodeBuddyValue) => {
    const m = String(str).match(new RegExp(String(pattern)));
    return m ? Array.from(m) : null;
  };

  // ============================================
  // Math Functions
  // ============================================

  builtins.abs = Math.abs;
  builtins.ceil = Math.ceil;
  builtins.floor = Math.floor;
  builtins.round = Math.round;
  builtins.sqrt = Math.sqrt;
  builtins.pow = Math.pow;
  builtins.min = (...args: CodeBuddyValue[]) => {
    const nums = args.flat().map(Number);
    return Math.min(...nums);
  };
  builtins.max = (...args: CodeBuddyValue[]) => {
    const nums = args.flat().map(Number);
    return Math.max(...nums);
  };
  builtins.sin = Math.sin;
  builtins.cos = Math.cos;
  builtins.tan = Math.tan;
  builtins.log = Math.log;
  builtins.log10 = Math.log10;
  builtins.exp = Math.exp;
  builtins.random = (max?: CodeBuddyValue) => {
    if (max !== undefined) return Math.floor(Math.random() * Number(max));
    return Math.random();
  };

  builtins.randomInt = (min: number, max: number): number => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  builtins.sum = (arr: number[]): number => arr.reduce((a, b) => a + b, 0);
  builtins.avg = (arr: number[]): number => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  // Constants
  builtins.PI = Math.PI;
  builtins.E = Math.E;

  // ============================================
  // Date/Time Functions
  // ============================================

  builtins.now = (): number => Date.now();
  builtins.date = (): string => new Date().toISOString().split('T')[0] ?? '';
  builtins.time = (): string => (new Date().toISOString().split('T')[1] ?? '').split('.')[0] ?? '';
  builtins.datetime = (): string => new Date().toISOString();
  builtins.timestamp = (): number => Math.floor(Date.now() / 1000);

  builtins.formatDate = (timestamp: number, format?: string): string => {
    const d = new Date(timestamp);
    if (!format) return d.toISOString();
    return format
      .replace('YYYY', String(d.getFullYear()))
      .replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
      .replace('DD', String(d.getDate()).padStart(2, '0'))
      .replace('HH', String(d.getHours()).padStart(2, '0'))
      .replace('mm', String(d.getMinutes()).padStart(2, '0'))
      .replace('ss', String(d.getSeconds()).padStart(2, '0'));
  };

  // ============================================
  // JSON Functions
  // ============================================

  builtins.jsonEncode = (value: CodeBuddyValue): string => JSON.stringify(value, null, 2);
  builtins.jsonDecode = (str: string): CodeBuddyValue => JSON.parse(str);

  const json = {
    parse: (str: CodeBuddyValue) => JSON.parse(String(str)),
    stringify: (value: CodeBuddyValue, indent?: CodeBuddyValue) => {
      return JSON.stringify(value, null, indent ? Number(indent) : undefined);
    },
  };
  builtins.json = json;
  builtins.JSON = json;

  // ============================================
  // Console (from Buddy Script)
  // ============================================

  builtins.console = {
    log: builtins.print,
    info: builtins.print,
    warn: (...args: CodeBuddyValue[]) => { print('[WARN] ' + args.map(stringify).join(' ')); return null; },
    error: (...args: CodeBuddyValue[]) => { print('[ERROR] ' + args.map(stringify).join(' ')); return null; },
  };

  // ============================================
  // Math namespace (from Buddy Script)
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

  // ============================================
  // File Operations (merged FCS flat + BS namespaced)
  // ============================================

  if (config.enableFileOps) {
    // Flat FCS-style file functions
    builtins.readFile = (filePath: string): string => {
      const fullPath = resolvePath(String(filePath), config.workdir);
      return fs.readFileSync(fullPath, 'utf-8');
    };

    builtins.writeFile = (filePath: string, content: string): boolean => {
      if (config.dryRun) { print(`[DRY RUN] Would write to: ${filePath}`); return true; }
      const fullPath = resolvePath(String(filePath), config.workdir);
      fs.writeFileSync(fullPath, content);
      return true;
    };

    builtins.appendFile = (filePath: string, content: string): boolean => {
      if (config.dryRun) { print(`[DRY RUN] Would append to: ${filePath}`); return true; }
      const fullPath = resolvePath(String(filePath), config.workdir);
      fs.appendFileSync(fullPath, content);
      return true;
    };

    builtins.fileExists = (filePath: string): boolean => fs.existsSync(resolvePath(String(filePath), config.workdir));

    builtins.isFile = (filePath: string): boolean => {
      try { return fs.statSync(resolvePath(String(filePath), config.workdir)).isFile(); } catch { return false; }
    };

    builtins.isDir = (filePath: string): boolean => {
      try { return fs.statSync(resolvePath(String(filePath), config.workdir)).isDirectory(); } catch { return false; }
    };

    builtins.mkdir = (dirPath: string): boolean => {
      if (config.dryRun) { print(`[DRY RUN] Would create directory: ${dirPath}`); return true; }
      fs.mkdirSync(resolvePath(String(dirPath), config.workdir), { recursive: true });
      return true;
    };

    builtins.rmdir = (dirPath: string): boolean => {
      if (config.dryRun) { print(`[DRY RUN] Would remove directory: ${dirPath}`); return true; }
      fs.rmSync(resolvePath(String(dirPath), config.workdir), { recursive: true });
      return true;
    };

    builtins.remove = (filePath: string): boolean => {
      if (config.dryRun) { print(`[DRY RUN] Would remove: ${filePath}`); return true; }
      fs.unlinkSync(resolvePath(String(filePath), config.workdir));
      return true;
    };

    builtins.rename = (oldPath: string, newPath: string): boolean => {
      if (config.dryRun) { print(`[DRY RUN] Would rename: ${oldPath} -> ${newPath}`); return true; }
      fs.renameSync(resolvePath(String(oldPath), config.workdir), resolvePath(String(newPath), config.workdir));
      return true;
    };

    builtins.copy = (src: string, dest: string): boolean => {
      if (config.dryRun) { print(`[DRY RUN] Would copy: ${src} -> ${dest}`); return true; }
      fs.copyFileSync(resolvePath(String(src), config.workdir), resolvePath(String(dest), config.workdir));
      return true;
    };

    builtins.listDir = (dirPath: string): string[] => fs.readdirSync(resolvePath(String(dirPath), config.workdir));

    builtins.glob = (pattern: string): string[] => {
      const dir = path.dirname(pattern);
      const filePattern = path.basename(pattern);
      const fullDir = resolvePath(dir, config.workdir);
      if (!fs.existsSync(fullDir)) return [];
      const regex = new RegExp('^' + filePattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      return fs.readdirSync(fullDir).filter(f => regex.test(f)).map(f => path.join(dir, f));
    };

    builtins.fileSize = (filePath: string): number => fs.statSync(resolvePath(String(filePath), config.workdir)).size;
    builtins.fileMtime = (filePath: string): number => fs.statSync(resolvePath(String(filePath), config.workdir)).mtimeMs;

    // Path utilities
    builtins.basename = path.basename;
    builtins.dirname = path.dirname;
    builtins.extname = path.extname;
    builtins.joinPath = (...parts: string[]): string => path.join(...parts);
    builtins.resolvePath = (...parts: string[]): string => path.resolve(config.workdir, ...parts);

    // BS-style namespaced file object
    builtins.file = {
      read: (filePath: CodeBuddyValue) => builtins.readFile(String(filePath)),
      write: (filePath: CodeBuddyValue, content: CodeBuddyValue) => builtins.writeFile(String(filePath), String(content)),
      append: (filePath: CodeBuddyValue, content: CodeBuddyValue) => builtins.appendFile(String(filePath), String(content)),
      exists: (filePath: CodeBuddyValue) => builtins.fileExists(String(filePath)),
      delete: (filePath: CodeBuddyValue) => builtins.remove(String(filePath)),
      copy: (src: CodeBuddyValue, dest: CodeBuddyValue) => builtins.copy(String(src), String(dest)),
      move: (src: CodeBuddyValue, dest: CodeBuddyValue) => builtins.rename(String(src), String(dest)),
      list: (dirPath: CodeBuddyValue) => builtins.listDir(String(dirPath)),
      mkdir: (dirPath: CodeBuddyValue) => builtins.mkdir(String(dirPath)),
      stat: (filePath: CodeBuddyValue) => {
        const stats = fs.statSync(resolvePath(String(filePath), config.workdir));
        return { size: stats.size, isFile: stats.isFile(), isDirectory: stats.isDirectory(), created: stats.birthtime.toISOString(), modified: stats.mtime.toISOString() };
      },
      glob: (pattern: CodeBuddyValue) => builtins.glob(String(pattern)),
    };
  }

  // ============================================
  // Shell/Bash Functions (merged FCS flat + BS namespaced)
  // ============================================

  if (config.enableBash) {
    builtins.exec = (command: string): string => {
      if (config.dryRun) { print(`[DRY RUN] Would execute: ${command}`); return ''; }
      try {
        return execSync(command, { cwd: config.workdir, encoding: 'utf-8', timeout: config.timeout });
      } catch (err) {
        throw new Error(`Command failed: ${(err as Error).message}`);
      }
    };

    builtins.shell = async (command: string): Promise<{ code: number; stdout: string; stderr: string }> => {
      if (config.dryRun) { print(`[DRY RUN] Would execute: ${command}`); return { code: 0, stdout: '', stderr: '' }; }
      return new Promise((resolve) => {
        const child = spawn(command, { shell: true, cwd: config.workdir });
        let stdout = '', stderr = '';
        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });
        child.on('close', (code) => { resolve({ code: code ?? 0, stdout, stderr }); });
      });
    };

    // BS-style namespaced bash object
    builtins.bash = {
      run: (command: CodeBuddyValue, options?: CodeBuddyValue) => {
        if (!config.enableBash) throw new Error('Bash commands are disabled');
        const opts = (options as Record<string, CodeBuddyValue>) || {};
        if (config.dryRun) { print(`[DRY RUN] bash: ${command}`); return { stdout: '', stderr: '', code: 0 }; }
        try {
          const stdout = execSync(String(command), {
            cwd: opts.cwd ? String(opts.cwd) : config.workdir,
            encoding: 'utf-8',
            timeout: opts.timeout ? Number(opts.timeout) : 30000,
            maxBuffer: 10 * 1024 * 1024,
          });
          return { stdout: stdout.trim(), stderr: '', code: 0 };
        } catch (error) {
          const execError = error as { stdout?: string; stderr?: string; status?: number };
          return { stdout: execError.stdout || '', stderr: execError.stderr || String(error), code: execError.status || 1 };
        }
      },
      exec: (command: CodeBuddyValue) => {
        const result = builtins.bash.run(command) as { stdout: string; code: number };
        if (result.code !== 0) throw new Error(`Command failed with code ${result.code}`);
        return result.stdout;
      },
      spawn: async (command: CodeBuddyValue, args?: CodeBuddyValue) => {
        if (!config.enableBash) throw new Error('Bash commands are disabled');
        const argList = Array.isArray(args) ? args.map(String) : [];
        return new Promise((resolve, reject) => {
          const proc = spawn(String(command), argList, { cwd: config.workdir, shell: true });
          let stdout = '', stderr = '';
          proc.stdout?.on('data', (data) => { stdout += data.toString(); if (config.verbose) print(data.toString()); });
          proc.stderr?.on('data', (data) => { stderr += data.toString(); });
          proc.on('close', (code) => { resolve({ stdout, stderr, code }); });
          proc.on('error', reject);
        });
      },
    };
  }

  // ============================================
  // AI Operations (from Buddy Script with lazy agent)
  // ============================================

  if (config.enableAI) {
    const ai = {
      ask: async (prompt: CodeBuddyValue) => {
        if (config.dryRun) { print(`[DRY RUN] ai.ask: ${prompt}`); return '[AI Response Placeholder]'; }
        const agent = await getOrCreateAgent(config);
        if (!agent) throw new Error('AI agent not available. Ensure GROK_API_KEY is set.');
        const result = await agent.processUserInput(String(prompt));
        return result.content || '';
      },
      chat: async (message: CodeBuddyValue) => {
        if (config.dryRun) { print(`[DRY RUN] ai.chat: ${message}`); return '[AI Response Placeholder]'; }
        const agent = await getOrCreateAgent(config);
        if (!agent) throw new Error('AI agent not available. Ensure GROK_API_KEY is set.');
        const result = await agent.processUserInput(String(message));
        return result.content || '';
      },
      complete: async (prompt: CodeBuddyValue, options?: CodeBuddyValue) => {
        if (config.dryRun) { print(`[DRY RUN] ai.complete: ${prompt}`); return '[AI Response Placeholder]'; }
        const agent = await getOrCreateAgent(config);
        if (!agent) throw new Error('AI agent not available. Ensure GROK_API_KEY is set.');
        const opts = typeof options === 'object' && options !== null ? options as Record<string, unknown> : {};
        const result = await agent.processUserInput(String(prompt), opts);
        return result.content || '';
      },
    };
    builtins.ai = ai;

    // FCS-style flat ai/grok function
    builtins.grok = async (prompt: string): Promise<string> => {
      return ai.ask(prompt);
    };
  }

  // ============================================
  // Environment & Config
  // ============================================

  builtins.env = {
    get: (name: CodeBuddyValue) => process.env[String(name)] || null,
    set: (name: CodeBuddyValue, value: CodeBuddyValue) => { process.env[String(name)] = String(value); return true; },
    all: () => ({ ...process.env }),
  };

  builtins.cwd = (): string => config.workdir;

  // ============================================
  // Utility Functions
  // ============================================

  builtins.typeof = (value: CodeBuddyValue): string => {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  };

  builtins.isNull = (value: CodeBuddyValue): boolean => value === null;
  builtins.isNumber = (value: CodeBuddyValue): boolean => typeof value === 'number';
  builtins.isString = (value: CodeBuddyValue): boolean => typeof value === 'string';
  builtins.isBool = (value: CodeBuddyValue): boolean => typeof value === 'boolean';
  builtins.isArray = (value: CodeBuddyValue): boolean => Array.isArray(value);
  builtins.isDict = (value: CodeBuddyValue): boolean => typeof value === 'object' && value !== null && !Array.isArray(value);
  builtins.isFunction = (value: CodeBuddyValue): boolean => typeof value === 'function';

  builtins.sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

  builtins.exit = (code = 0): never => process.exit(code);

  builtins.assert = (condition: CodeBuddyValue, message?: string): void => {
    if (!condition) throw new Error(message || 'Assertion failed');
  };

  builtins.expect = (actual: CodeBuddyValue, expected: CodeBuddyValue, message?: string): void => {
    if (actual !== expected) throw new Error(message || `Expected ${stringify(expected)}, got ${stringify(actual)}`);
  };

  return builtins;
}

// ============================================
// Utility Functions
// ============================================

function stringify(value: CodeBuddyValue): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'function') return '[Function]';
  if (Array.isArray(value)) {
    return '[' + value.map(v => stringify(v)).join(', ') + ']';
  }
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return '[Object]'; }
  }
  return String(value);
}

function resolvePath(filePath: string, workdir: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(workdir, filePath);
}

/** @deprecated Use createBuiltins instead */
export const createFCSBuiltins = createBuiltins;
