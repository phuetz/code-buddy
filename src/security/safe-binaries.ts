/**
 * Safe Binaries System
 *
 * Maintains a list of commands that are safe to execute without
 * user approval. These are read-only or informational commands
 * that cannot modify the filesystem or system state.
 */

import { logger } from '../utils/logger.js';
import { parseBashCommand, type ParsedCommand } from './bash-parser.js';

// ============================================================================
// Safe Binaries List
// ============================================================================

export const SAFE_BINARIES: readonly string[] = [
  // Core Unix read-only / informational
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find',
  'which', 'whoami', 'pwd', 'echo', 'date', 'uname', 'hostname',
  'env', 'printenv', 'file', 'stat', 'du', 'df', 'free', 'uptime',
  'id', 'groups', 'locale', 'tty', 'basename', 'dirname',
  'realpath', 'readlink', 'md5sum', 'sha256sum', 'sort', 'uniq',
  'tr', 'cut', 'paste', 'diff', 'comm', 'seq', 'true', 'false',
  'test', 'expr',
  'git',
  // Extra read-only / inspect (CB-PERMISSIONS-MATRICE-1005: ≥100 for plan bash)
  'jq', 'tree', 'column', 'nl', 'od', 'hexdump', 'xxd',
  'whatis', 'apropos', 'cal', 'nproc', 'arch',
  'getconf', 'lscpu', 'lsblk', 'ps', 'pgrep', 'pidof', 'lsof',
  'strings', 'size', 'nm', 'objdump', 'readelf', 'cmp', 'expand',
  'unexpand', 'fmt', 'fold', 'pr', 'tac', 'rev', 'printf',
  'namei', 'getfacl', 'zcat', 'bzcat', 'xzcat', 'lzcat',
  'sha1sum', 'sha512sum', 'cksum', 'sum', 'tsort', 'numfmt', 'pathchk',
  'history',
  'times',
  // Version / metadata probes — subcommand-gated in isParsedCommandSafe
  'go', 'rustc', 'cargo', 'node', 'python3', 'python', 'php', 'ruby', 'perl',
  'java', 'javac', 'dotnet', 'bun', 'deno',
  'getent', 'iconv', 'base64', 'basenc', 'factor',
  'shuf', 'look', 'users', 'who', 'w', 'last',
  'lspci', 'lsusb',
  // PowerShell read-only cmdlets
  'Get-ChildItem', 'Get-Content', 'Select-String', 'Measure-Object',
  'Get-Location', 'Get-Item', 'Test-Path', 'Resolve-Path', 'Get-FileHash',
  'Get-Process', 'Get-Service', 'Get-Command', 'Get-Help', 'Get-Date',
  'Get-Host', 'Get-PSDrive', 'Get-Module', 'Get-Alias', 'Get-Variable',
] as const;

const SAFE_POWERSHELL_BINARIES = new Map(
  SAFE_BINARIES
    .filter(binary => binary.includes('-'))
    .map(binary => [binary.toLowerCase(), binary]),
);

/**
 * Options that turn an otherwise read-only command into a mutating command or
 * an arbitrary command runner. These are deliberately matched after quote
 * removal because quoted shell arguments still reach the binary unchanged.
 */
const UNSAFE_FIND_ACTIONS = new Set([
  '-delete',
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-fls',
  '-fprint',
  '-fprint0',
  '-fprintf',
]);

const SAFE_ENV_OPTIONS_WITH_VALUE = new Set(['-u', '--unset', '-C', '--chdir']);
const SAFE_ENV_OPTIONS = new Set([
  '-i',
  '--ignore-environment',
  '-0',
  '--null',
  '--debug',
  '--help',
  '--version',
]);

// ============================================================================
// SafeBinariesChecker
// ============================================================================

/**
 * GNU getopt_long accepts any unambiguous abbreviation of a long option and bundles
 * short ones (`--out=F`, `-bo F`), so literal `-o` / `--output` comparisons are not
 * enough. True when `arg` could be (an abbreviation of) the long option `name`.
 */
function isLongOptionPrefix(arg: string, name: string): boolean {
  if (!arg.startsWith('--') || arg.length <= 2) return false;
  const given = arg.slice(2).split('=')[0] ?? '';
  return given.length > 0 && name.startsWith(given);
}

/** Any spelling of an output-file option: `-o`, bundled `-bo`, `-oFILE`, `--o…`, `--output[=]`. */
function isOutputFlag(arg: string): boolean {
  return /^-[A-Za-z]*o/.test(arg) || isLongOptionPrefix(arg, 'output');
}

export class SafeBinariesChecker {
  private static instance: SafeBinariesChecker | null = null;

  private safeBinaries: Set<string>;
  private customized = false;

  private constructor() {
    this.safeBinaries = new Set(SAFE_BINARIES);
  }

  static getInstance(): SafeBinariesChecker {
    if (!SafeBinariesChecker.instance) {
      SafeBinariesChecker.instance = new SafeBinariesChecker();
    }
    return SafeBinariesChecker.instance;
  }

  static resetInstance(): void {
    SafeBinariesChecker.instance = null;
  }

  isSafe(command: string): boolean {
    const trimmed = command.trim();
    if (!trimmed) return false;

    return this.isEntireExpressionSafe(trimmed);
  }

  isSafeChain(command: string): boolean {
    const trimmed = command.trim();
    if (!trimmed) return false;

    return this.isEntireExpressionSafe(trimmed);
  }

  getSafeBinaries(): string[] {
    return Array.from(this.safeBinaries).sort();
  }

  addSafeBinary(name: string): void {
    this.safeBinaries.add(name);
    this.customized = true;
    logger.debug('Added safe binary', { name });
  }

  removeSafeBinary(name: string): void {
    this.safeBinaries.delete(name);
    this.customized = true;
    logger.debug('Removed safe binary', { name });
  }

  isCustomized(): boolean {
    return this.customized;
  }

  private isEntireExpressionSafe(command: string): boolean {
    // The AST parser identifies every command in pipelines/chains. A lexical
    // pre-pass covers shell constructs that the fallback parser intentionally
    // normalizes away (notably redirects and command substitutions).
    if (this.hasUnsafeShellSyntax(command)) return false;

    const parsed = parseBashCommand(command);
    if (parsed.warnings.length > 0 || parsed.commands.length === 0) return false;

    return parsed.commands.every(parsedCommand => this.isParsedCommandSafe(parsedCommand));
  }

  private isParsedCommandSafe(parsedCommand: ParsedCommand): boolean {
    if (parsedCommand.isSubshell) return false;

    const binary = this.basename(parsedCommand.command);
    const canonicalPowerShellBinary = SAFE_POWERSHELL_BINARIES.get(binary.toLowerCase());
    const safeBinary = this.safeBinaries.has(binary)
      ? binary
      : canonicalPowerShellBinary && this.safeBinaries.has(canonicalPowerShellBinary)
        ? canonicalPowerShellBinary
        : null;
    if (!safeBinary) return false;

    const args = parsedCommand.args.map(arg => this.stripOuterQuotes(arg));

    switch (safeBinary) {
      case 'find':
        return !args.some(arg => UNSAFE_FIND_ACTIONS.has(arg.toLowerCase()));
      case 'rg':
        return !args.some(arg => {
          const option = arg.toLowerCase();
          return option === '--pre'
            || option.startsWith('--pre=')
            || option === '--hostname-bin'
            || option.startsWith('--hostname-bin=')
            // Compressed search delegates to external decompression tools.
            || option === '--search-zip'
            || option === '-z';
        });
      case 'sort':
        return !args.some(arg => {
          const option = arg.toLowerCase();
          return isOutputFlag(arg)
            || isLongOptionPrefix(option, 'compress-program');
        });
      case 'file':
        return !args.some(arg => arg === '-C' || arg === '--compile');
      case 'hostname':
        return this.isHostnameQuery(args);
      case 'date':
        return !args.some(arg => arg === '-s' || arg === '--set' || arg.startsWith('--set='));
      case 'env':
        return this.isEnvironmentQuery(args);
      case 'git':
        return this.isGitQuery(args);
      case 'base64':
      case 'basenc':
        return !args.some(isOutputFlag);
      case 'shuf':
        return !args.some(isOutputFlag);
      case 'go':
        return this.isGoQuery(args);
      case 'cargo':
        return this.isCargoQuery(args);
      case 'rustc':
      case 'node':
      case 'python3':
      case 'python':
      case 'php':
      case 'ruby':
      case 'perl':
      case 'java':
      case 'javac':
      case 'dotnet':
      case 'bun':
      case 'deno':
        return this.isVersionProbe(args);
      case 'tree':
        // `tree -o FILE` writes the listing to a file.
        return !args.some(isOutputFlag);
      case 'history':
        // `history -w/-a/-n/-r FILE` read or write the history file; only a bare count is a read.
        return args.every(arg => /^\d+$/.test(arg));
      case 'iconv':
        // `iconv -o FILE` writes a file.
        return !args.some(isOutputFlag);
      case 'xxd':
        // `xxd INFILE OUTFILE` writes OUTFILE; at most one positional argument.
        return args.filter(arg => !arg.startsWith('-')).length <= 1;
      default:
        return true;
    }
  }

  /**
   * Reject syntax that can write, spawn hidden commands, or hide additional
   * commands from a simple command list. Quote-aware scanning avoids treating
   * literals such as `echo "a > b"` as redirections.
   */
  private hasUnsafeShellSyntax(command: string): boolean {
    let quote: 'none' | 'single' | 'double' = 'none';
    let escaped = false;

    for (let index = 0; index < command.length; index++) {
      const char = command[index];
      const next = command[index + 1];

      if (escaped) {
        if (char === '\n' || char === '\r') return true;
        escaped = false;
        continue;
      }

      if (quote === 'single') {
        if (char === "'") quote = 'none';
        continue;
      }

      if (char === '\\') {
        // Outside quotes a backslash makes bash rewrite the word (`-\o` is `-o`), which
        // defeats every literal flag guard below: refuse, the user is asked instead.
        if (quote === 'none') return true;
        escaped = true;
        continue;
      }

      if (quote === 'none' && char === '$' && (next === "'" || next === '"')) {
        // ANSI-C / locale quoting: `$'\x2do'` is `-o`.
        return true;
      }

      // Parameter expansion defeats literal flag guards (`printf -v x o; sort -$x f`).
      if (char === '$' && next !== undefined && /[A-Za-z_{0-9@*#?!$-]/.test(next)) return true;

      if (quote === 'double') {
        if (char === '"') {
          quote = 'none';
          continue;
        }
        if (char === '`' || (char === '$' && next === '(')) return true;
        continue;
      }

      if (char === "'") {
        quote = 'single';
        continue;
      }
      if (char === '"') {
        quote = 'double';
        continue;
      }

      if (char === '`' || (char === '$' && next === '(')) return true;
      // Brace expansion rewrites words (`sort -{,o} OUT IN` is `sort - -o OUT IN`).
      if (char === '{' || char === '}') return true;
      if ((char === '<' || char === '>') && next === '(') return true;
      if (char === '(' || char === ')') return true;

      // Any output redirect can create/truncate a file. Input redirects remain
      // eligible, except heredocs/FD duplication which have richer semantics.
      if (char === '>') return true;
      if (char === '<' && (next === '<' || next === '&')) return true;

      // The fallback AST parser does not split newlines or background jobs.
      if (char === '\n' || char === '\r') return true;
      if (char === '&') {
        if (next !== '&') return true;
        index++;
      }
    }

    return escaped || quote !== 'none';
  }

  private isEnvironmentQuery(args: string[]): boolean {
    for (let index = 0; index < args.length; index++) {
      const arg = args[index] ?? '';

      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) continue;
      if (SAFE_ENV_OPTIONS.has(arg)) continue;
      if (arg.startsWith('--unset=') || arg.startsWith('--chdir=')) continue;

      if (SAFE_ENV_OPTIONS_WITH_VALUE.has(arg)) {
        if (index + 1 >= args.length) return false;
        index++;
        continue;
      }

      // `env -S`/`--split-string` and the first non-option argument launch a
      // utility, so they cannot inherit env's read-only classification.
      return false;
    }

    return true;
  }

  private isHostnameQuery(args: string[]): boolean {
    const mutatingOptions = new Set(['-b', '--boot', '-F', '--file']);
    if (args.some(arg => mutatingOptions.has(arg) || arg.startsWith('--file='))) {
      return false;
    }

    // A positional hostname asks the utility to change the system hostname.
    return args.every(arg => arg.startsWith('-'));
  }

  private isVersionProbe(args: string[]): boolean {
    if (args.length === 0) return true;
    const allowed = new Set([
      '--version', '-v', '-V', 'version', '--help', '-h', '--info', 'info',
    ]);
    return args.every(arg => allowed.has(arg));
  }

  private isGoQuery(args: string[]): boolean {
    if (args.length === 0) return true;
    const [subcommand, ...rest] = args;
    if (subcommand === 'env') {
      // `go env -w NAME=VALUE` / `-u NAME` write or edit the Go environment file.
      return !rest.some(arg => arg === '-w' || arg === '-u' || /^-[a-z]*[wu]/.test(arg) && !arg.startsWith('--'));
    }
    if (subcommand === 'version' || subcommand === 'help') {
      return true;
    }
    if (subcommand === 'list') {
      return !rest.includes('get');
    }
    if (subcommand === 'doc') return true;
    return this.isVersionProbe(args);
  }

  private isCargoQuery(args: string[]): boolean {
    if (args.length === 0) return true;
    const [subcommand] = args;
    return subcommand === 'metadata'
      || subcommand === 'tree'
      || subcommand === 'version'
      || subcommand === '--version'
      || subcommand === '-V'
      || subcommand === 'help'
      || this.isVersionProbe(args);
  }

  private isGitQuery(args: string[]): boolean {
    const [subcommand, ...rest] = args;
    if (!subcommand || subcommand.startsWith('-')) return false;
    const safe = new Set([
      'status', 'diff', 'show', 'rev-parse', 'describe', 'ls-files',
      'ls-tree', 'cat-file', 'blame', 'shortlog',
    ]);
    if (safe.has(subcommand)) return true;
    if (subcommand === 'log') {
      return !rest.some(isOutputFlag);
    }
    if (subcommand === 'remote') {
      return rest.length === 0 || (rest.length === 1 && rest[0] === '-v');
    }
    if (subcommand === 'branch') {
      const readOnlyOptions = new Set([
        '--list', '--show-current', '--contains', '--no-contains',
        '--merged', '--no-merged',
      ]);
      return rest.length === 0 || rest.every(arg => arg.startsWith('-') && readOnlyOptions.has(arg));
    }
    if (subcommand === 'tag') {
      return rest.length === 0 || rest[0] === '--list';
    }
    return false;
  }

  private stripOuterQuotes(value: string): string {
    if (value.length >= 2) {
      const first = value[0];
      const last = value[value.length - 1];
      if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
        return value.slice(1, -1);
      }
    }
    return value;
  }

  private basename(command: string): string {
    if (!command.includes('/') && !command.includes('\\')) return command;
    const normalized = command.replace(/\\/g, '/');
    const trustedPrefixes = ['/bin/', '/usr/bin/', '/usr/local/bin/', '/sbin/', '/usr/sbin/'];
    if (!trustedPrefixes.some(prefix => normalized.startsWith(prefix))) return normalized;
    return normalized.split('/').pop() || normalized;
  }
}
