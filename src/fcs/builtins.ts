/**
 * FileCommander Script (FCS) Builtins
 *
 * Standard library functions compatible with FileCommander
 * plus code-buddy extensions
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import { FCSConfig, FCSValue, FCSFunction } from './types.js';

export function createFCSBuiltins(
  config: FCSConfig,
  print: (msg: string) => void
): Record<string, FCSFunction | FCSValue> {
  const builtins: Record<string, FCSFunction | FCSValue> = {};

  // ============================================
  // Core I/O
  // ============================================

  const printFn = (...args: FCSValue[]) => {
    const message = args.map((a) => stringify(a)).join(' ');
    print(message);
    return null;
  };
  builtins.print = printFn;

  builtins.println = (...args: FCSValue[]) => {
    printFn(...args);
    return null;
  };

  builtins.input = async (prompt?: string): Promise<string> => {
    if (prompt) print(prompt);
    // In CLI context, we'd use readline - simplified for now
    return '';
  };

  // ============================================
  // Type Conversion
  // ============================================

  builtins.int = (value: FCSValue): number => {
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

  builtins.float = (value: FCSValue): number => {
    return parseFloat(String(value));
  };

  builtins.str = (value: FCSValue): string => {
    return stringify(value);
  };

  builtins.bool = (value: FCSValue): boolean => {
    if (value === null || value === undefined || value === false || value === 0 || value === '') {
      return false;
    }
    return true;
  };

  builtins.array = (value: FCSValue): FCSValue[] => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return value.split('');
    if (typeof value === 'object' && value !== null) return Object.values(value);
    return [value];
  };

  // ============================================
  // Collection Functions
  // ============================================

  builtins.len = (value: FCSValue): number => {
    if (typeof value === 'string') return value.length;
    if (Array.isArray(value)) return value.length;
    if (typeof value === 'object' && value !== null) {
      return Object.keys(value as object).length;
    }
    return 0;
  };

  builtins.range = (...args: number[]): number[] => {
    let start = 0;
    let end = 0;
    let step = 1;

    if (args.length === 1) {
      end = args[0];
    } else if (args.length === 2) {
      start = args[0];
      end = args[1];
    } else if (args.length >= 3) {
      start = args[0];
      end = args[1];
      step = args[2];
    }

    const result: number[] = [];
    if (step > 0) {
      for (let i = start; i < end; i += step) {
        result.push(i);
      }
    } else if (step < 0) {
      for (let i = start; i > end; i += step) {
        result.push(i);
      }
    }
    return result;
  };

  builtins.enumerate = (arr: FCSValue[]): [number, FCSValue][] => {
    return arr.map((item, index) => [index, item]);
  };

  builtins.zip = (...arrays: FCSValue[][]): FCSValue[][] => {
    const minLen = Math.min(...arrays.map((a) => a.length));
    const result: FCSValue[][] = [];
    for (let i = 0; i < minLen; i++) {
      result.push(arrays.map((a) => a[i]));
    }
    return result;
  };

  builtins.map = (arr: FCSValue[], fn: FCSFunction): Promise<FCSValue[]> => {
    return Promise.all(arr.map((item, i) => fn(item, i)));
  };

  builtins.filter = async (arr: FCSValue[], fn: FCSFunction): Promise<FCSValue[]> => {
    const results = await Promise.all(arr.map(async (item) => ({
      item,
      keep: await fn(item),
    })));
    return results.filter((r) => r.keep).map((r) => r.item);
  };

  builtins.reduce = async (
    arr: FCSValue[],
    fn: FCSFunction,
    initial?: FCSValue
  ): Promise<FCSValue> => {
    let acc = initial !== undefined ? initial : arr[0];
    const startIdx = initial !== undefined ? 0 : 1;
    for (let i = startIdx; i < arr.length; i++) {
      acc = await fn(acc, arr[i], i);
    }
    return acc;
  };

  builtins.find = async (arr: FCSValue[], fn: FCSFunction): Promise<FCSValue> => {
    for (const item of arr) {
      if (await fn(item)) {
        return item;
      }
    }
    return null;
  };

  builtins.every = async (arr: FCSValue[], fn: FCSFunction): Promise<boolean> => {
    for (const item of arr) {
      if (!(await fn(item))) {
        return false;
      }
    }
    return true;
  };

  builtins.some = async (arr: FCSValue[], fn: FCSFunction): Promise<boolean> => {
    for (const item of arr) {
      if (await fn(item)) {
        return true;
      }
    }
    return false;
  };

  builtins.sort = (arr: FCSValue[], fn?: FCSFunction): FCSValue[] => {
    const copy = [...arr];
    if (fn) {
      copy.sort((a, b) => {
        const result = fn(a, b);
        return typeof result === 'number' ? result : 0;
      });
    } else {
      copy.sort((a, b) => {
        if (typeof a === 'number' && typeof b === 'number') {
          return a - b;
        }
        return String(a).localeCompare(String(b));
      });
    }
    return copy;
  };

  builtins.reverse = (arr: FCSValue[]): FCSValue[] => {
    return [...arr].reverse();
  };

  builtins.slice = (arr: FCSValue[], start: number, end?: number): FCSValue[] => {
    return arr.slice(start, end);
  };

  builtins.concat = (...arrays: FCSValue[][]): FCSValue[] => {
    return arrays.flat();
  };

  builtins.push = (arr: FCSValue[], ...items: FCSValue[]): FCSValue[] => {
    arr.push(...items);
    return arr;
  };

  builtins.pop = (arr: FCSValue[]): FCSValue => {
    return arr.pop();
  };

  builtins.shift = (arr: FCSValue[]): FCSValue => {
    return arr.shift();
  };

  builtins.unshift = (arr: FCSValue[], ...items: FCSValue[]): FCSValue[] => {
    arr.unshift(...items);
    return arr;
  };

  builtins.includes = (arr: FCSValue[], item: FCSValue): boolean => {
    return arr.includes(item);
  };

  builtins.indexOf = (arr: FCSValue[], item: FCSValue): number => {
    return arr.indexOf(item);
  };

  builtins.join = (arr: FCSValue[], separator = ','): string => {
    return arr.map((a) => stringify(a)).join(separator);
  };

  builtins.split = (str: string, separator: string): string[] => {
    return str.split(separator);
  };

  builtins.keys = (obj: Record<string, FCSValue>): string[] => {
    return Object.keys(obj);
  };

  builtins.values = (obj: Record<string, FCSValue>): FCSValue[] => {
    return Object.values(obj);
  };

  builtins.entries = (obj: Record<string, FCSValue>): [string, FCSValue][] => {
    return Object.entries(obj);
  };

  // ============================================
  // String Functions
  // ============================================

  builtins.upper = (str: string): string => str.toUpperCase();
  builtins.lower = (str: string): string => str.toLowerCase();
  builtins.trim = (str: string): string => str.trim();
  builtins.ltrim = (str: string): string => str.trimStart();
  builtins.rtrim = (str: string): string => str.trimEnd();

  builtins.startsWith = (str: string, prefix: string): boolean => str.startsWith(prefix);
  builtins.endsWith = (str: string, suffix: string): boolean => str.endsWith(suffix);
  builtins.contains = (str: string, substr: string): boolean => str.includes(substr);

  builtins.replace = (str: string, search: string, replace: string): string => {
    return str.split(search).join(replace);
  };

  builtins.replaceAll = (str: string, search: string, replace: string): string => {
    return str.split(search).join(replace);
  };

  builtins.substr = (str: string, start: number, length?: number): string => {
    if (length !== undefined) {
      return str.substring(start, start + length);
    }
    return str.substring(start);
  };

  builtins.charAt = (str: string, index: number): string => {
    return str.charAt(index);
  };

  builtins.repeat = (str: string, count: number): string => {
    return str.repeat(count);
  };

  builtins.padStart = (str: string, length: number, char = ' '): string => {
    return str.padStart(length, char);
  };

  builtins.padEnd = (str: string, length: number, char = ' '): string => {
    return str.padEnd(length, char);
  };

  builtins.format = (template: string, ...args: FCSValue[]): string => {
    let result = template;
    for (let i = 0; i < args.length; i++) {
      result = result.replace(`{${i}}`, stringify(args[i]));
      result = result.replace('{}', stringify(args[i]));
    }
    return result;
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
  builtins.min = Math.min;
  builtins.max = Math.max;
  builtins.sin = Math.sin;
  builtins.cos = Math.cos;
  builtins.tan = Math.tan;
  builtins.log = Math.log;
  builtins.log10 = Math.log10;
  builtins.exp = Math.exp;
  builtins.random = Math.random;

  builtins.randomInt = (min: number, max: number): number => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  builtins.sum = (arr: number[]): number => {
    return arr.reduce((a, b) => a + b, 0);
  };

  builtins.avg = (arr: number[]): number => {
    return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  };

  // Constants
  builtins.PI = Math.PI;
  builtins.E = Math.E;

  // ============================================
  // Date/Time Functions
  // ============================================

  builtins.now = (): number => Date.now();

  builtins.date = (): string => new Date().toISOString().split('T')[0];

  builtins.time = (): string => new Date().toISOString().split('T')[1].split('.')[0];

  builtins.datetime = (): string => new Date().toISOString();

  builtins.timestamp = (): number => Math.floor(Date.now() / 1000);

  builtins.formatDate = (timestamp: number, format?: string): string => {
    const d = new Date(timestamp);
    if (!format) {
      return d.toISOString();
    }
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

  builtins.jsonEncode = (value: FCSValue): string => {
    return JSON.stringify(value, null, 2);
  };

  builtins.jsonDecode = (str: string): FCSValue => {
    return JSON.parse(str);
  };

  // ============================================
  // File Operations (FileCommander specific)
  // ============================================

  if (config.enableFileOps) {
    builtins.readFile = (filePath: string): string => {
      const fullPath = path.resolve(config.workdir, filePath);
      return fs.readFileSync(fullPath, 'utf-8');
    };

    builtins.writeFile = (filePath: string, content: string): boolean => {
      if (config.dryRun) {
        print(`[DRY RUN] Would write to: ${filePath}`);
        return true;
      }
      const fullPath = path.resolve(config.workdir, filePath);
      fs.writeFileSync(fullPath, content);
      return true;
    };

    builtins.appendFile = (filePath: string, content: string): boolean => {
      if (config.dryRun) {
        print(`[DRY RUN] Would append to: ${filePath}`);
        return true;
      }
      const fullPath = path.resolve(config.workdir, filePath);
      fs.appendFileSync(fullPath, content);
      return true;
    };

    builtins.fileExists = (filePath: string): boolean => {
      const fullPath = path.resolve(config.workdir, filePath);
      return fs.existsSync(fullPath);
    };

    builtins.isFile = (filePath: string): boolean => {
      const fullPath = path.resolve(config.workdir, filePath);
      try {
        return fs.statSync(fullPath).isFile();
      } catch {
        return false;
      }
    };

    builtins.isDir = (filePath: string): boolean => {
      const fullPath = path.resolve(config.workdir, filePath);
      try {
        return fs.statSync(fullPath).isDirectory();
      } catch {
        return false;
      }
    };

    builtins.mkdir = (dirPath: string): boolean => {
      if (config.dryRun) {
        print(`[DRY RUN] Would create directory: ${dirPath}`);
        return true;
      }
      const fullPath = path.resolve(config.workdir, dirPath);
      fs.mkdirSync(fullPath, { recursive: true });
      return true;
    };

    builtins.rmdir = (dirPath: string): boolean => {
      if (config.dryRun) {
        print(`[DRY RUN] Would remove directory: ${dirPath}`);
        return true;
      }
      const fullPath = path.resolve(config.workdir, dirPath);
      fs.rmSync(fullPath, { recursive: true });
      return true;
    };

    builtins.remove = (filePath: string): boolean => {
      if (config.dryRun) {
        print(`[DRY RUN] Would remove: ${filePath}`);
        return true;
      }
      const fullPath = path.resolve(config.workdir, filePath);
      fs.unlinkSync(fullPath);
      return true;
    };

    builtins.rename = (oldPath: string, newPath: string): boolean => {
      if (config.dryRun) {
        print(`[DRY RUN] Would rename: ${oldPath} -> ${newPath}`);
        return true;
      }
      const fullOld = path.resolve(config.workdir, oldPath);
      const fullNew = path.resolve(config.workdir, newPath);
      fs.renameSync(fullOld, fullNew);
      return true;
    };

    builtins.copy = (src: string, dest: string): boolean => {
      if (config.dryRun) {
        print(`[DRY RUN] Would copy: ${src} -> ${dest}`);
        return true;
      }
      const fullSrc = path.resolve(config.workdir, src);
      const fullDest = path.resolve(config.workdir, dest);
      fs.copyFileSync(fullSrc, fullDest);
      return true;
    };

    builtins.listDir = (dirPath: string): string[] => {
      const fullPath = path.resolve(config.workdir, dirPath);
      return fs.readdirSync(fullPath);
    };

    builtins.glob = (pattern: string): string[] => {
      // Simple glob implementation
      const dir = path.dirname(pattern);
      const filePattern = path.basename(pattern);
      const fullDir = path.resolve(config.workdir, dir);

      if (!fs.existsSync(fullDir)) return [];

      const regex = new RegExp(
        '^' + filePattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
      );

      return fs
        .readdirSync(fullDir)
        .filter((f) => regex.test(f))
        .map((f) => path.join(dir, f));
    };

    builtins.fileSize = (filePath: string): number => {
      const fullPath = path.resolve(config.workdir, filePath);
      return fs.statSync(fullPath).size;
    };

    builtins.fileMtime = (filePath: string): number => {
      const fullPath = path.resolve(config.workdir, filePath);
      return fs.statSync(fullPath).mtimeMs;
    };

    // Path utilities
    builtins.basename = path.basename;
    builtins.dirname = path.dirname;
    builtins.extname = path.extname;
    builtins.joinPath = (...parts: string[]): string => path.join(...parts);
    builtins.resolvePath = (...parts: string[]): string => path.resolve(config.workdir, ...parts);
  }

  // ============================================
  // Shell/Bash Functions
  // ============================================

  if (config.enableBash) {
    builtins.exec = (command: string): string => {
      if (config.dryRun) {
        print(`[DRY RUN] Would execute: ${command}`);
        return '';
      }
      try {
        return execSync(command, {
          cwd: config.workdir,
          encoding: 'utf-8',
          timeout: config.timeout,
        });
      } catch (err) {
        throw new Error(`Command failed: ${(err as Error).message}`);
      }
    };

    builtins.shell = async (command: string): Promise<{ code: number; stdout: string; stderr: string }> => {
      if (config.dryRun) {
        print(`[DRY RUN] Would execute: ${command}`);
        return { code: 0, stdout: '', stderr: '' };
      }

      return new Promise((resolve) => {
        const child = spawn(command, {
          shell: true,
          cwd: config.workdir,
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        child.on('close', (code) => {
          resolve({ code: code ?? 0, stdout, stderr });
        });
      });
    };

    builtins.bash = builtins.shell;
  }

  // ============================================
  // Utility Functions
  // ============================================

  builtins.typeof = (value: FCSValue): string => {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  };

  builtins.isNull = (value: FCSValue): boolean => value === null;
  builtins.isNumber = (value: FCSValue): boolean => typeof value === 'number';
  builtins.isString = (value: FCSValue): boolean => typeof value === 'string';
  builtins.isBool = (value: FCSValue): boolean => typeof value === 'boolean';
  builtins.isArray = (value: FCSValue): boolean => Array.isArray(value);
  builtins.isDict = (value: FCSValue): boolean =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  builtins.isFunction = (value: FCSValue): boolean => typeof value === 'function';

  builtins.sleep = (ms: number): Promise<void> => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  builtins.exit = (code = 0): never => {
    process.exit(code);
  };

  builtins.env = (name: string, defaultValue?: string): string => {
    return process.env[name] ?? defaultValue ?? '';
  };

  builtins.cwd = (): string => config.workdir;

  builtins.assert = (condition: FCSValue, message?: string): void => {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  };

  builtins.expect = (actual: FCSValue, expected: FCSValue, message?: string): void => {
    if (actual !== expected) {
      throw new Error(message || `Expected ${stringify(expected)}, got ${stringify(actual)}`);
    }
  };

  // ============================================
  // Grok-specific Extensions
  // ============================================

  if (config.enableAI) {
    // These will be injected by the code-buddy integration
    builtins.ai = async (prompt: string): Promise<string> => {
      print(`[AI] ${prompt}`);
      return '[AI response would go here]';
    };

    builtins.grok = builtins.ai;
  }

  return builtins;
}

function stringify(value: FCSValue): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'function') return '[Function]';
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stringify(v)).join(', ') + ']';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Object]';
    }
  }
  return String(value);
}
