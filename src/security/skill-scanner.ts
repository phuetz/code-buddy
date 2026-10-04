/**
 * Skill Code Scanner (Enterprise-grade)
 *
 * Static analysis of skill files for dangerous patterns.
 * Scans SKILL.md files and any referenced code for security issues.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import {
  deobfuscateForScanWindows,
  deobfuscateSafeForScanWindows,
  foldUnicodeForScan,
  sliceScanWindows,
} from './text-deobfuscation.js';
import { analyzeShellCommandWords, type ShellWordFindingKind } from './shell-command-words.js';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ScanFinding {
  severity: FindingSeverity;
  pattern: string;
  description: string;
  file: string;
  line: number;
  evidence: string;
  /** Documentary risk retained for review, never an executable authorization. */
  documentary?: boolean;
}

export interface ScanResult {
  file: string;
  findings: ScanFinding[];
  scannedAt: number;
  /**
   * False when this call did not read regular-file text.
   * An empty findings list is not an authorization unless this is true.
   */
  textRead?: boolean;
}

export type SkillFirewallCapability =
  | 'dynamic-code'
  | 'filesystem'
  | 'network'
  | 'prompt-injection'
  | 'prototype-pollution'
  | 'secrets'
  | 'shell';
export type SkillFirewallVerdict = 'allow' | 'review' | 'quarantine';

export interface SkillFirewallReport {
  schemaVersion: 1;
  capabilities: SkillFirewallCapability[];
  findingCounts: Record<FindingSeverity, number>;
  findings: ScanFinding[];
  generatedAt: string;
  quarantineRequired: boolean;
  score: number;
  summary: string;
  target: string;
  verdict: SkillFirewallVerdict;
}

interface DangerousPattern {
  capability: SkillFirewallCapability;
  pattern: RegExp;
  severity: FindingSeverity;
  description: string;
  name: string;
  justification?: string;
}

const SCRIPT_EXTENSIONS = new Set([
  '.bash',
  '.bat',
  '.cmd',
  '.cjs',
  '.ex',
  '.exs',
  '.go',
  '.js',
  '.jsx',
  '.lua',
  '.mjs',
  '.php',
  '.pl',
  '.perl',
  '.ps1',
  '.py',
  '.r',
  '.rb',
  '.rs',
  '.sh',
  '.ts',
  '.tsx',
  '.zsh',
]);

const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;

/** lstat, then stat only to classify a symlink target. Neither call blocks on a fifo. */
function followedFile(filePath: string): fs.Stats | null {
  try {
    const linked = fs.lstatSync(filePath);
    if (!linked.isSymbolicLink()) return linked.isFile() ? linked : null;
    const target = fs.statSync(filePath);
    return target.isFile() ? target : null;
  } catch {
    return null;
  }
}

function unreadFinding(filePath: string, kind: string): ScanResult {
  return {
    file: filePath,
    findings: [{
      severity: 'high',
      pattern: 'special-file-not-read',
      description: `Refused to read a ${kind}; the scan did not follow or block on it`,
      file: filePath,
      line: 0,
      evidence: path.basename(filePath).slice(0, 120),
    }],
    scannedAt: Date.now(),
    textRead: false,
  };
}

/**
 * A missing path stays an empty result. Every other unread path is an
 * explicit refusal, never a clean scan.
 */
function refusalResult(filePath: string): ScanResult {
  let linked: fs.Stats;
  try {
    linked = fs.lstatSync(filePath);
  } catch {
    return { file: filePath, findings: [], scannedAt: Date.now(), textRead: false };
  }
  if (linked.isSymbolicLink()) {
    let targetIsFile = false;
    try {
      targetIsFile = fs.statSync(filePath).isFile();
    } catch {
      targetIsFile = false;
    }
    return unreadFinding(filePath, targetIsFile ? 'file' : 'symlink');
  }
  if (linked.isFile()) return unreadFinding(filePath, 'file');
  return unreadFinding(filePath, 'special');
}

/** A scan that neither read text nor explained why is still a refusal. */
function readOrRefuse(result: ScanResult): ScanResult {
  if (result.textRead === true || result.findings.length > 0) return result;
  return unreadFinding(result.file, 'file');
}

/**
 * Read a regular file, or a symlink whose target is a regular file.
 * A fifo, socket, or device is refused. O_NONBLOCK keeps a raced replacement
 * from blocking; the open fd is checked again before any read.
 */
function readTextForScan(filePath: string): string | null {
  let linked: fs.Stats;
  try {
    linked = fs.lstatSync(filePath);
  } catch {
    return null;
  }
  if (!followedFile(filePath)) return null;
  const flags = fs.constants.O_RDONLY
    | fs.constants.O_NONBLOCK
    | (linked.isSymbolicLink() ? 0 : O_NOFOLLOW);
  let fd: number;
  try {
    fd = fs.openSync(filePath, flags);
  } catch {
    return null;
  }
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile()) return null;
    const buf = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < opened.size) {
      const n = fs.readSync(fd, buf, offset, opened.size - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    return buf.subarray(0, offset).toString('utf8');
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function isExecutableOrShebang(filePath: string): boolean {
  try {
    const linked = fs.lstatSync(filePath);
    const info = linked.isSymbolicLink() ? fs.statSync(filePath) : linked;
    if (!info.isFile()) return false;
    if ((info.mode & 0o111) !== 0) return true;
    const flags = fs.constants.O_RDONLY
      | fs.constants.O_NONBLOCK
      | (linked.isSymbolicLink() ? 0 : O_NOFOLLOW);
    const fd = fs.openSync(filePath, flags);
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile()) return false;
      const prefix = Buffer.alloc(2);
      return fs.readSync(fd, prefix, 0, prefix.length, 0) === 2 && prefix.toString() === '#!';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // Code execution & droppers
  { pattern: /\b(?:curl|wget)\b[^|\n]*\|\s*((?:['"\\]|\$)*(?:(?:\/|\.\.?\/|~\/)(?:[\w.-]+\/)*)?(?:['"\\]|\$)*(?:b(?:['"\\]|\$)*a(?:['"\\]|\$)*s(?:['"\\]|\$)*h|s(?:['"\\]|\$)*h|z(?:['"\\]|\$)*s(?:['"\\]|\$)*h)(?:['"\\]|\$|[a-zA-Z0-9_.-])*(?:\.exe)?(?:['"\\]|\$)*)\b/i, severity: 'critical', description: 'Remote download piped directly to a shell', name: 'remote-download-pipe-shell', capability: 'shell' },
  { pattern: /(?:^|[ \t;&|()])((?:['"\\]|\$)*(?:(?:\/|\.\.?\/|~\/)(?:[\w.-]+\/)*)?(?:['"\\]|\$)*(?:b(?:['"\\]|\$)*a(?:['"\\]|\$)*s(?:['"\\]|\$)*h|s(?:['"\\]|\$)*h|z(?:['"\\]|\$)*s(?:['"\\]|\$)*h|d(?:['"\\]|\$)*a(?:['"\\]|\$)*s(?:['"\\]|\$)*h|k(?:['"\\]|\$)*s(?:['"\\]|\$)*h|f(?:['"\\]|\$)*i(?:['"\\]|\$)*s(?:['"\\]|\$)*h)(?:['"\\]|\$|[a-zA-Z0-9_.-])*(?:\.exe)?(?:['"\\]|\$)*)\s+-c\b[^\n]*\bcurl\b/i, severity: 'critical', description: 'Shell command executes a downloaded curl payload', name: 'bash-curl-command', capability: 'shell' },
  { pattern: /\bpowershell(?:\.exe)?\s+-c(?:ommand)?\b[^\n]*\biwr\b[^|\n]*\|\s*iex\b/i, severity: 'critical', description: 'PowerShell downloads and executes a remote payload', name: 'powershell-download-execute', capability: 'shell' },
  {
    pattern: /\b(?:base64\s+(?:-d|--decode|-D)|openssl\s+base64\s+-d)\b[^|\n]*\|\s*((?:['"\\]|\$)*(?:(?:\/|\.\.?\/|~\/)(?:[\w.-]+\/)*)?(?:['"\\]|\$)*(?:b(?:['"\\]|\$)*a(?:['"\\]|\$)*s(?:['"\\]|\$)*h|s(?:['"\\]|\$)*h|z(?:['"\\]|\$)*s(?:['"\\]|\$)*h|d(?:['"\\]|\$)*a(?:['"\\]|\$)*s(?:['"\\]|\$)*h)(?:['"\\]|\$|[a-zA-Z0-9_.-])*(?:\.exe)?(?:['"\\]|\$)*)\b/i,
    severity: 'critical',
    description: 'Base64 decoding piped directly to shell',
    name: 'base64-decode-pipe-shell',
    capability: 'shell',
    justification: 'Base64 droppers decode obfuscated commands on the fly into an active shell interpreter',
  },
  {
    pattern: /\b(?:printf|echo\s+-e)\s+['"][^'"]*\\x[0-9a-fA-F]{2}[^'"]*['"]\s*\|\s*((?:['"\\]|\$)*(?:(?:\/|\.\.?\/|~\/)(?:[\w.-]+\/)*)?(?:['"\\]|\$)*(?:b(?:['"\\]|\$)*a(?:['"\\]|\$)*s(?:['"\\]|\$)*h|s(?:['"\\]|\$)*h|z(?:['"\\]|\$)*s(?:['"\\]|\$)*h|d(?:['"\\]|\$)*a(?:['"\\]|\$)*s(?:['"\\]|\$)*h)(?:['"\\]|\$|[a-zA-Z0-9_.-])*(?:\.exe)?(?:['"\\]|\$)*)\b/i,
    severity: 'critical',
    description: 'Hex/octal encoded payload piped directly to shell',
    name: 'hex-printf-pipe-shell',
    capability: 'shell',
    justification: 'Hex escape sequences in printf/echo piped into shells reconstruct binary or shell payloads stealthily',
  },
  { pattern: /\beval\s+\$\(\s*[^)]*\)/i, severity: 'critical', description: 'Dynamic evaluation of shell command substitution', name: 'eval-command-substitution', capability: 'shell' },
  { pattern: /\beval\s*\(/, severity: 'critical', description: 'Dynamic code execution via eval()', name: 'eval', capability: 'dynamic-code' },
  { pattern: /\bnew\s+Function\s*\(/, severity: 'critical', description: 'Dynamic function creation', name: 'new-function', capability: 'dynamic-code' },
  { pattern: /\b(?:(?:[A-Za-z_$][\w$]*_)?child_process|[A-Za-z_$][\w$]*ChildProcess)\b/, severity: 'high', description: 'Child process module usage', name: 'child_process', capability: 'shell' },
  { pattern: /\bexecSync\s*\(/, severity: 'high', description: 'Synchronous command execution', name: 'execSync', capability: 'shell' },
  { pattern: /\bexecFile\s*\(/, severity: 'high', description: 'File execution', name: 'execFile', capability: 'shell' },
  { pattern: /\bspawn(?:Sync)?\s*\(\s*['"](?:\/(?:[^/'"]+\/)*)?rm['"]\s*,\s*\[[^\]\r\n]*['"]-(?:[a-z]*r[a-z]*|[a-z]*f[a-z]*)['"]/i, severity: 'critical', description: 'Process launch requests destructive removal', name: 'destructive-process', capability: 'shell' },
  { pattern: /\bspawn\s*\(/, severity: 'medium', description: 'Process spawning', name: 'spawn', capability: 'shell' },
  { pattern: /\bexec\s*\(/, severity: 'high', description: 'Command execution', name: 'exec', capability: 'shell' },

  { pattern: /\b(?:(?:import\s+(?:\w+_)?subprocess\b|(?:\w+_)?subprocess\s*(?:\.|\[))|from\s+(?:\w+_)?subprocess\s+import\b|from\s+os\s+import\s+[^\n]*(?:system|popen|spawn|exec)\b|import\s+os\s+as\s+\w+|os\s*\.\s*(?:system|popen|spawn\w*|exec\w*)\s*\()/, severity: 'high', description: 'Python process execution capability', name: 'python-process', capability: 'shell' },
  { pattern: /\brmtree\s*(?:\?\.\s*)?\(|\bfrom\s+shutil\s+import\s+[^\n]*\brmtree\b|\b(?:rmSync|rm|rmdirSync|rmdir)\s*(?:\?\.\s*)?\(|(?:\.\s*(?:rm|rmdir)|\[\s*['"](?:rmSync|rm|rmdirSync|rmdir)['"]\s*\])\s*(?:\?\.\s*)?\(/s, severity: 'critical', description: 'Recursive deletion in executable code', name: 'script-recursive-delete', capability: 'filesystem' },

  { pattern: /\b(?:exec\s*\.\s*Command(?:Context)?|Command\s*::\s*new|ProcessBuilder|shell_exec|system|popen|spawnSync|execFileSync)\s*\(|\bStart-Process\b/, severity: 'high', description: 'Native process execution', name: 'native-process', capability: 'shell' },

  { pattern: /\bos\s*\[\s*['"](?:system|popen|posix_spawn|exec\w*|spawn\w*)['"]\s*\]\s*\(|\bgetattr\s*\(\s*os\s*,\s*['"](?:system|popen|posix_spawn|exec\w*|spawn\w*)['"]\s*\)\s*\(|\b(?:create_subprocess_(?:shell|exec)|posix_spawn|execv(?:e|p|pe)?|passthru|proc_open|execa)\s*\(|\b(?:pty\s*\.\s*spawn|Open3\s*\.\s*capture\w*|syscall\s*\.\s*Exec|os\s*\.\s*StartProcess|Deno\s*\.\s*Command)\s*\(|\bInvoke-Expression\b|\$\s*`|%x[({/]/, severity: 'high', description: 'Process execution including quoted APIs and language-native launchers', name: 'extended-process', capability: 'shell' },
  { pattern: /`[^`\n]+`/, severity: 'high', description: 'PHP backtick process execution', name: 'php-backtick', capability: 'shell' },
  { pattern: /`[^`\n]+`/, severity: 'high', description: 'Shell backtick process execution', name: 'shell-backtick', capability: 'shell' },

  { pattern: /(?:^|[ \t;&|(])((?:['"\\]|\$)*(?:(?:\/|\.\.?\/|~\/)(?:[\w.-]+\/)*)?(?:['"\\]|\$)*(?:b(?:['"\\]|\$)*a(?:['"\\]|\$)*s(?:['"\\]|\$)*h|s(?:['"\\]|\$)*h|z(?:['"\\]|\$)*s(?:['"\\]|\$)*h|d(?:['"\\]|\$)*a(?:['"\\]|\$)*s(?:['"\\]|\$)*h|k(?:['"\\]|\$)*s(?:['"\\]|\$)*h|f(?:['"\\]|\$)*i(?:['"\\]|\$)*s(?:['"\\]|\$)*h)(?:['"\\]|\$|[a-zA-Z0-9_.-])*(?:\.exe)?(?:['"\\]|\$)*)[ \t]+(?:(?:['"\\])*[-+][^\s;&|()]*|(?:['"\\])*(?:\.\.?\/|\/|~\/|\$)[^\s;&|]+|(?:['"\\])*[A-Za-z_][\w.-]*\b)/i, severity: 'high', description: 'Shell interpreter invocation can execute a copied payload', name: 'shell-interpreter', capability: 'shell' },
  { pattern: /\b[\w$]*(?:api_?key|secret|password|token)[\w$]*['"]?\s*[:=]\s*['"`][^'"`\r\n]+['"`]/i, severity: 'critical', description: 'Literal credential assignment requires quarantine in copied code', name: 'embedded-secret', capability: 'secrets' },

  // File system dangers
  { pattern: /\brm\s+-rf\b/, severity: 'critical', description: 'Recursive force delete', name: 'rm-rf', capability: 'filesystem' },
  { pattern: /\bunlinkSync\s*\(/, severity: 'medium', description: 'Synchronous file deletion', name: 'unlinkSync', capability: 'filesystem' },
  { pattern: /\bwriteFileSync\s*\(/, severity: 'low', description: 'Synchronous file write', name: 'writeFileSync', capability: 'filesystem' },
  { pattern: /\brmdirSync\s*\(/, severity: 'medium', description: 'Directory removal', name: 'rmdirSync', capability: 'filesystem' },

  // Network & Exfiltration
  { pattern: /\bfetch\s*\(\s*['"`]http/, severity: 'medium', description: 'External HTTP request', name: 'fetch-http', capability: 'network' },
  { pattern: /\baxios\b/, severity: 'low', description: 'HTTP client library usage', name: 'axios', capability: 'network' },
  { pattern: /\brequire\s*\(\s*['"`]https?['"`]\s*\)/, severity: 'medium', description: 'HTTP module import', name: 'http-require', capability: 'network' },
  { pattern: /\bWebSocket\b/, severity: 'medium', description: 'WebSocket usage', name: 'websocket', capability: 'network' },
  {
    pattern: /(?:(?:curl|wget)\b[^|\n]*(?:-d|--data|--data-binary|--data-raw|-F|--upload-file|-T)\s+[@<]?(?:~|\$HOME|\/home\/[^/\s]+|\.)?\/?(?:\.ssh\/|\.aws\/|\.codebuddy\/|\.env(?!\.(?:example|sample|template|dist))\b))|(?:\bcat\s+[^|\n]*(?:\.ssh\/|\.aws\/|\.codebuddy\/|\.env(?!\.(?:example|sample|template|dist))\b)[^|\n]*\|\s*(?:curl|wget|nc|ncat|netcat|socat)\b)|(?:\b(?:nc|ncat|netcat|socat)\b[^<\n]*<\s*(?:~|\$HOME|\/home\/[^/\s]+|\.)?\/?(?:\.ssh\/|\.aws\/|\.codebuddy\/|\.env(?!\.(?:example|sample|template|dist))\b))|(?:\bscp\b[^|\n]*(?:~|\$HOME|\/home\/[^/\s]+|\.)?\/?(?:\.ssh\/id_|\.aws\/credentials|\.codebuddy\/[^\s|&;]*\.env|\.env(?!\.(?:example|sample|template|dist))\b)\s+[^\s]+:)/i,
    severity: 'critical',
    description: 'Exfiltration of credentials or sensitive environment files via network',
    name: 'credential-network-exfiltration',
    capability: 'network',
    justification: 'Transmitting private keys, environment files, or credentials via curl/nc/scp to remote destinations is exfiltration',
  },

  // Dynamic imports (JS & Python)
  { pattern: /\brequire\s*\(\s*[a-zA-Z_$[]/, severity: 'high', description: 'Dynamic require with variable', name: 'dynamic-require', capability: 'dynamic-code' },
  { pattern: /(?<!\bfrom\s+[\w.]+\s+)\bimport\s*\(\s*[a-zA-Z_$[]/, severity: 'high', description: 'Dynamic import with variable', name: 'dynamic-import', capability: 'dynamic-code' },
  {
    pattern: /\b__import__\s*\(\s*['"][a-zA-Z0-9_.]+['"]/,
    severity: 'high',
    description: 'Dynamic Python module import via __import__()',
    name: 'py-dunder-import',
    capability: 'dynamic-code',
    justification: 'Python __import__() dynamically loads arbitrary modules at runtime bypassing static import declarations',
  },
  {
    pattern: /\bimportlib\s*\.\s*import_module\s*\(/,
    severity: 'high',
    description: 'Dynamic Python module import via importlib.import_module()',
    name: 'py-importlib-import',
    capability: 'dynamic-code',
    justification: 'importlib.import_module() enables dynamic resolution and execution of arbitrary Python packages at runtime',
  },

  // Environment/secrets
  { pattern: /process\.env\[/, severity: 'low', description: 'Dynamic environment variable access', name: 'env-dynamic', capability: 'secrets' },
  { pattern: /\b(?:[A-Z][A-Z0-9]*_)*(?:API_KEY|SECRET|PASSWORD|TOKEN)(?:_[A-Z0-9]+)*\b/i, severity: 'info', description: 'Possible secret reference', name: 'secret-ref', capability: 'secrets' },
  {
    pattern: /(?<!\bssh-keygen\b[^\n]*)(?:~|\$HOME|\/home\/[^/\s]+)\/\.ssh\/id_(?:rsa|ecdsa|ed25519|dsa)\b(?!\.pub\b)/i,
    severity: 'high',
    description: 'Access or reading of private SSH keys',
    name: 'ssh-private-key-access',
    capability: 'secrets',
    justification: 'Direct access to SSH private keys allows unauthorized server access and identity impersonation',
  },
  {
    pattern: /\b(?:cat|head|tail|grep|source)\s+(?:(?:\.\/)?\.env|~[^\s/]*\/\.env)(?!\.(?:example|sample|template|dist|test|local\.example))\b/i,
    severity: 'high',
    description: 'Access or extraction of sensitive .env environment file',
    name: 'dotenv-file-access',
    capability: 'secrets',
    justification: '.env files contain local application secrets, API keys, and connection credentials',
  },
  {
    pattern: /(?:~|\$HOME|\/home\/[^/\s]+)\/(?:\.aws\/(?:credentials|config)|\.codebuddy\/[^\s|&;]*\.env)\b/i,
    severity: 'high',
    description: 'Access to cloud provider credentials or CodeBuddy environment files',
    name: 'cloud-credential-access',
    capability: 'secrets',
    justification: 'Accessing ~/.aws/credentials or ~/.codebuddy/*.env compromises infrastructure and agent secrets',
  },

  { pattern: /\b[A-Z][A-Z0-9]*_(?:[A-Z0-9]+_)*(?:API_KEY|SECRET|PASSWORD|TOKEN)(?:_[A-Z0-9]+)*\b/i, severity: 'medium', description: 'Prefixed credential reference requires review', name: 'prefixed-secret', capability: 'secrets' },

  // Prototype pollution
  { pattern: /__proto__/, severity: 'high', description: 'Prototype pollution risk', name: 'proto', capability: 'prototype-pollution' },
  { pattern: /\bconstructor\s*\[/, severity: 'high', description: 'Constructor access via bracket notation', name: 'constructor-bracket', capability: 'prototype-pollution' },

  // Shell injection
  { pattern: /`\$\{.*\}`/, severity: 'medium', description: 'Template literal with interpolation (potential injection)', name: 'template-injection', capability: 'shell' },
  { pattern: /\$\(.*\)/, severity: 'medium', description: 'Shell command substitution', name: 'shell-subst', capability: 'shell' },

  // Prompt injection / jailbreak (a skill is injected into the agent context)
  { pattern: /\b(?:ignore|disregard|override|forget)\b.{0,80}\b(?:all|any|previous|prior|system|developer)\b.{0,80}\b(?:instruction|prompt|message)s?\b/i, severity: 'critical', description: 'Instruction to override higher-priority prompts', name: 'prompt-override', capability: 'prompt-injection' },
  { pattern: /\b(?:jailbreak|godmode|g0dm0d3)\b/i, severity: 'critical', description: 'Jailbreak / GODMODE skill content', name: 'jailbreak-godmode', capability: 'prompt-injection' },
  { pattern: /\b(?:disable|bypass)\b.{0,60}\b(?:all|every|any)\b.{0,40}\b(?:safety|guardrail|restriction)s?\b/i, severity: 'critical', description: 'Instruction to disable safety policies', name: 'disable-safety', capability: 'prompt-injection' },
  {
    pattern: /<!--[\s\S]*?\b(?:ignore|disregard|override|forget)\b.{0,80}\b(?:all|any|previous|prior|system|developer)\b.{0,80}\b(?:instruction|prompt|message|rule)s?[\s\S]*?-->/i,
    severity: 'critical',
    description: 'Prompt injection or instruction override hidden inside HTML comment',
    name: 'html-comment-prompt-injection',
    capability: 'prompt-injection',
    justification: 'HTML comments are invisible in rendered markdown but parsed by LLMs, creating a stealth prompt injection vector',
  },
  {
    pattern: /<!--[\s\S]*?\b(?:(?:curl|wget)\b[^|\n]*\|\s*((?:['"\\]|\$)*(?:(?:\/|\.\.?\/|~\/)(?:[\w.-]+\/)*)?(?:['"\\]|\$)*(?:b(?:['"\\]|\$)*a(?:['"\\]|\$)*s(?:['"\\]|\$)*h|s(?:['"\\]|\$)*h|z(?:['"\\]|\$)*s(?:['"\\]|\$)*h|d(?:['"\\]|\$)*a(?:['"\\]|\$)*s(?:['"\\]|\$)*h|k(?:['"\\]|\$)*s(?:['"\\]|\$)*h|f(?:['"\\]|\$)*i(?:['"\\]|\$)*s(?:['"\\]|\$)*h)(?:['"\\]|\$|[a-zA-Z0-9_.-])*(?:\.exe)?(?:['"\\]|\$)*)|rm\s+-rf|base64\s+(?:-d|--decode))\b[\s\S]*?-->/i,
    severity: 'critical',
    description: 'Dangerous shell command or dropper hidden inside HTML comment',
    name: 'html-comment-hidden-command',
    capability: 'prompt-injection',
    justification: 'Hiding shell droppers or destructive commands in HTML comments bypasses visual human review while targeting agents',
  },
];

const DYNAMIC_IMPORT_PATTERN_LEGACY = /\bimport\s*\(\s*[a-zA-Z_$[]/;

function isDeobAllEnabled(): boolean {
  return (
    process.env.CODEBUDDY_SKILL_FIREWALL_DEOB_ALL !== 'false' &&
    process.env.CODEBUDDY_SKILL_FIREWALL_DEOB_ALL !== '0'
  );
}

function getDangerousPatterns(): DangerousPattern[] {
  if (isDeobAllEnabled()) {
    return DANGEROUS_PATTERNS;
  }
  return DANGEROUS_PATTERNS.map((dp) => {
    if (dp.name === 'dynamic-import') {
      return {
        ...dp,
        pattern: DYNAMIC_IMPORT_PATTERN_LEGACY,
      };
    }
    return dp;
  });
}

interface ScanContext { markdown: boolean; language: string; watched: boolean; imperative: boolean; shellLiteral: boolean; supportDocument: boolean }
const SHELL_LANGUAGES = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'shell']);
// A declared, understood language can distinguish an identifier/template from
// interpreter syntax. An unknown copied payload or fence must fail closed.
const DATA_BACKTICK_LANGUAGES = new Set(['py', 'python', 'python3', 'js', 'jsx', 'javascript', 'ts', 'tsx', 'typescript', 'cjs', 'mjs', 'node', 'fsharp', 'fs', 'fsx', 'go', 'rs', 'rust', 'kotlin', 'kt', 'solidity', 'json', 'yaml', 'yml', 'text', 'plaintext', 'swift', 'c', 'cpp', 'java', 'sql', 'css', 'html', 'xml', 'lua', 'r', 'ex', 'exs', 'ps1', 'powershell', 'bat', 'cmd']);
function hasShellBackticks(context: ScanContext): boolean {
  return SHELL_LANGUAGES.has(context.language) || context.language === 'rb' || context.language === 'ruby'
    || (Boolean(context.language) && context.language !== 'php' && !DATA_BACKTICK_LANGUAGES.has(context.language));
}

/** Quotes and comments at this occurrence, not another expression on the line. */
function shellPosition(line: string, offset: number): { quoted: boolean; literal: boolean } {
  let quote = '';
  let escaped = false;
  for (let i = 0; i < offset; i++) {
    const char = line[i]!;
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quote !== "'") { escaped = true; continue; }
    if (char === quote) { quote = ''; continue; }
    if (!quote && (char === "'" || char === '"')) { quote = char; continue; }
    if (!quote && char === '#' && (i === 0 || /[\s;|&()]/.test(line[i - 1]!))) return { quoted: false, literal: true };
  }
  return { quoted: Boolean(quote), literal: escaped || quote === "'" };
}
function scanContexts(content: string, filePath: string, executableContext = false): ScanContext[] {
  const markdown = /\.md$/i.test(filePath) && !executableContext && !content.startsWith('#!');
  const supportDocument = markdown && !/^(?:skill|.*\.skill)\.md$/i.test(path.basename(filePath));
  const shebang = content.match(/^#![^\n]*?\b(php|bash|sh|zsh|dash|ksh|fish|python[\d.]*|node|ruby|perl)\b/i)?.[1]?.toLowerCase();
  const extension = path.extname(filePath).toLowerCase();
  // A caller can choose the interpreter independently of the shebang. Keep
  // every executable backtick interpretation; no inert language may mask one.
  const declaredLanguages = [SCRIPT_EXTENSIONS.has(extension) ? extension.slice(1) : '', shebang ?? ''];
  const executableLanguage = declaredLanguages.find(lang => lang === 'php')
    ?? declaredLanguages.find(lang => SHELL_LANGUAGES.has(lang))
    ?? declaredLanguages.find(lang => ['rb', 'ruby', 'pl', 'perl'].includes(lang));
  let language = markdown ? '' : executableLanguage
    ?? (extension && !SCRIPT_EXTENSIONS.has(extension) ? 'unknown' : declaredLanguages.find(Boolean) ?? 'unknown');
  const imperative = /(?<![\w-])(?:run|execute)\b[^\n]{0,100}\b(?:every|listed|now|immediately|with\s+(?:the\s+)?bash|rm\s+-rf|curl|wget)|\b(?:first\s+run|then\s+comply|you\s+obey|agent\s+runs|follow\s+the\s+description\s+literally|ignore\s+them)\b/i.test(content.replace(/(?:never|don't|do not|must not)\s+(?:run|execute)/gi, 'blocked'));
  let fence = '';
  let watched = false;
  let heredoc: { delimiter: string; stripTabs: boolean } | undefined;
  return content.split('\n').map(line => {
    const shellLiteral = Boolean(heredoc);
    if (heredoc && (heredoc.stripTabs ? line.replace(/^\t+/, '') : line) === heredoc.delimiter) heredoc = undefined;
    const delimiter = markdown && !shellLiteral ? line.match(/^\s*(`{3,}|~{3,})([\w-]*)/) : null;
    if (delimiter) {
      if (fence && delimiter[1]![0] === fence[0]) { fence = ''; language = ''; watched = false; }
      else if (!fence) { fence = delimiter[1]!; language = delimiter[2]!.toLowerCase(); }
    }
    // A fenced script can declare an interpreter too. Keep an executable
    // interpretation even when its fence label describes an inert language.
    const fencedShebang = markdown && fence ? line.match(/^#![^\n]*?\b(php|bash|sh|zsh|dash|ksh|fish|ruby|perl)\b/i)?.[1]?.toLowerCase() : undefined;
    if (fencedShebang) {
      language = [language, fencedShebang].find(lang => lang === 'php')
        ?? [language, fencedShebang].find(lang => SHELL_LANGUAGES.has(lang))
        ?? fencedShebang;
    }
    if (markdown && fence && !language && /^Watched patterns:\s*$/i.test(line.trim())) watched = true;
    if (!shellLiteral && SHELL_LANGUAGES.has(language)) {
      for (const match of line.matchAll(/<<(-?)\s*(?:'([A-Za-z_]\w*)'|"([A-Za-z_]\w*)")/g)) {
        const position = shellPosition(line, match.index);
        if (!position.quoted && !position.literal) {
          heredoc = { delimiter: (match[2] ?? match[3])!, stripTabs: match[1] === '-' };
          break;
        }
      }
    }
    return { markdown, language, watched, imperative, shellLiteral, supportDocument };
  });
}
const PROSE_SYSTEM_REFERENCE = /^system\s+\(\s*(?:Linux|Windows|macOS|OS|DBMS|local\s+disk)(?:\s*,\s*(?:Linux|Windows|macOS|OS|DBMS|local\s+disk))*\s*\)/i;

export function deobfuscateShellWord(word: string): string | null {
  if (!word) return '';
  let result = '';
  let i = 0;
  let state = 'normal'; // normal, single, double, ansi

  while (i < word.length) {
    const c = word[i]!;
    if (state === 'normal') {
      if (c === '\\') {
        if (i + 1 < word.length) {
          result += word[i + 1]!;
          i += 2;
        } else {
          result += c;
          i++;
        }
      } else if (c === "'") {
        state = 'single';
        i++;
      } else if (c === '"') {
        state = 'double';
        i++;
      } else if (c === '$' && word[i + 1] === "'") {
        state = 'ansi';
        i += 2;
      } else if (c === '$') {
        return null;
      } else if (c === '`') {
        return null;
      } else {
        result += c;
        i++;
      }
    } else if (state === 'single') {
      if (c === "'") {
        state = 'normal';
      } else {
        result += c;
      }
      i++;
    } else if (state === 'double') {
      if (c === '\\') {
        if (i + 1 < word.length && ['"', '\\', '$', '`'].includes(word[i + 1]!)) {
          result += word[i + 1]!;
          i += 2;
        } else {
          result += '\\';
          i++;
        }
      } else if (c === '"') {
        state = 'normal';
        i++;
      } else if (c === '$' || c === '`') {
        return null;
      } else {
        result += c;
        i++;
      }
    } else if (state === 'ansi') {
      if (c === "'") {
        state = 'normal';
        i++;
      } else if (c === '\\') {
        if (i + 1 < word.length) {
          const next = word[i + 1]!;
          if (next === 'n') result += '\n';
          else if (next === 't') result += '\t';
          else if (next === 'r') result += '\r';
          else if (next === 'a') result += '\x07';
          else if (next === 'b') result += '\x08';
          else if (next === 'e' || next === 'E') result += '\x1B';
          else if (next === 'f') result += '\x0C';
          else if (next === 'v') result += '\x0B';
          else if (next === '\\') result += '\\';
          else if (next === "'") result += "'";
          else if (next === '"') result += '"';
          else result += next;
          i += 2;
        } else {
          result += c;
          i++;
        }
      } else {
        result += c;
        i++;
      }
    }
  }
  return result;
}

function classifyMention(dp: DangerousPattern, match: RegExpMatchArray, line: string, context: ScanContext, offset: number, length: number): 'active' | 'benign' | 'documentary' {
  if (['remote-download-pipe-shell', 'bash-curl-command', 'base64-decode-pipe-shell', 'hex-printf-pipe-shell', 'shell-interpreter', 'html-comment-hidden-command'].includes(dp.name) && match[1]) {
    const normalCmd = deobfuscateShellWord(match[1]);
    if (normalCmd !== null) {
      const base = path.basename(normalCmd).replace(/\.exe$/i, '').toLowerCase();
      const allowed = dp.name === 'shell-interpreter' ? ['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish'] :
                      dp.name === 'remote-download-pipe-shell' ? ['sh', 'bash', 'zsh'] :
                      ['sh', 'bash', 'zsh', 'dash'];
      if (!allowed.includes(base)) return 'benign';
    }
  }
  if (dp.name === 'php-backtick' && context.language !== 'php') return 'benign';
  if (dp.name === 'shell-backtick' && (!hasShellBackticks(context) ||
      (SHELL_LANGUAGES.has(context.language) && (context.shellLiteral || shellPosition(line, offset).literal)))) return 'benign';
  if (context.markdown && ['php-backtick', 'shell-backtick'].includes(dp.name) && /^\s*(?:`{3,}|~{3,})/.test(line)) return 'benign';
  // In Python this occurrence binds a loop variable; it does not launch it.
  // Match the occurrence, so a second call or a quoted command stays visible.
  if (dp.name === 'shell-interpreter' && /^(?:py|python[\d.]*)$/.test(context.language)
      && /^\s*(?:async\s+)?for(?:\s+[A-Za-z_]\w*\s*,)*$/.test(line.slice(0, offset))
      && /^[ \t](?:bash|sh|zsh|dash|ksh|fish)[ \t]+in\b/.test(line.slice(offset, offset + length))
      && /^\s*(?:async\s+)?for\s+(?:[A-Za-z_]\w*\s*,\s*)*(?:bash|sh|zsh|dash|ksh|fish)\s+in\s+.+:\s*(?:#.*)?$/.test(line)) return 'benign';
  // No prose, secret-token, or documentary exception may authorize copied code.
  if (!context.markdown) return 'active';
  // A Python loop variable inside a quoted diagnostic heredoc is data, not
  // a shell launcher. This syntax exception never applies to copied scripts.
  if (dp.name === 'shell-interpreter' && context.shellLiteral
      && /^\s*for$/.test(line.slice(0, offset))
      && /^\s*for\s+(?:bash|sh|zsh|dash|ksh|fish)\s+in\s+.+:\s*$/.test(line)) return 'benign';
  // Claude's capitalized Bash tool in explicit prose is not a Unix launcher.
  // No command, fence, imperative, or copied script receives this exception.
  if (dp.name === 'shell-interpreter' && !context.language && !context.imperative
      && /\b(?:Use|any|a|on)$/i.test(line.slice(0, offset))
      && /^[ \t]Bash[ \t]+(?:only|command|call|blocks)\b/.test(line.slice(offset, offset + length))) return 'benign';
  // Newly scanned reference documents retain network mentions for review.
  // Credential exfiltration and other critical/high rules keep their treatment.
  if (context.supportDocument && dp.capability === 'network' && !['critical', 'high'].includes(dp.severity)) return 'documentary';
  if (dp.name === 'shell-backtick' && !SHELL_LANGUAGES.has(context.language) && !['rb', 'ruby'].includes(context.language)) return 'documentary';
  if (dp.name === 'child_process' && /\b(?:const|let|var)\s+$/.test(line.slice(0, offset)) && /^child_process\s*=\s*(?:\d+|true|false|null)\s*;?\s*$/.test(line.slice(offset))) return 'benign';
  if (dp.name === 'secret-ref') {
    const token = line.slice(offset, offset + length);
    if (!token.includes('_') && token !== token.toUpperCase() && line[offset - 1] !== '$') return 'benign';
  }
  if (['native-process', 'python-process'].includes(dp.name)) {
    // An inert occurrence never exempts another call on the same line.
    const prefix = line.slice(0, offset);
    const call = line.slice(offset);
    if (dp.name === 'native-process' && /^system\s*\(/.test(call) &&
        ((/\b(?:operating|file|management)\s+$/i.test(prefix) && PROSE_SYSTEM_REFERENCE.test(call)) ||
         (/\.$/.test(prefix) && /^system\s*\(\s*size\s*:\s*\d+(?:\.\d+)?\s*[,)]/.test(call)))) return 'benign';
    return context.imperative ? 'active' : 'documentary';
  }
  if (['secret-ref', 'prefixed-secret', 'template-injection', 'embedded-secret', 'shell-interpreter', 'destructive-process'].includes(dp.name)) return 'documentary';
  if (['script-recursive-delete', 'php-backtick', 'shell-backtick', 'extended-process'].includes(dp.name)) return context.imperative ? 'active' : 'documentary';

  // A property argument in typed documentation can name an assertion or a
  // module. Keep the ambiguity visible; copied code took the strict branch.
  if (dp.name === 'dynamic-require' && ['ts', 'typescript', 'tsx'].includes(context.language) &&
      /^require\s*\(\s*[A-Za-z_]\w*\s*\.\s*[A-Za-z_]\w*/.test(line.slice(offset))) return context.imperative ? 'active' : 'documentary';

  if (dp.name === 'eval' && /\bmodel\s*\.\s*$/.test(line.slice(0, offset)) &&
      /^eval\s*\(\s*\)/.test(line.slice(offset)) &&
      ['', 'python', 'py', 'text', 'plaintext'].includes(context.language)) {
    // PyTorch's zero-argument mode switch is documentary guidance, not an
    // authorization for an unknown evaluator. Scripts retain the critical hit.
    return 'documentary';
  }
  if (dp.name === 'dynamic-require' && ['kotlin', 'kt', 'solidity'].includes(context.language)) {
    // These languages use require as an assertion. A JS-style module load
    // remains suspicious even inside a misleading fence.
    if (/^require\s*\(\s*[A-Za-z_]\w*(?:\.\w+|\[[^\]]+\])?\.isNotBlank\s*\(\s*\)\s*\)/.test(line.slice(offset)) || /^require\s*\([^;]*?(?:>=|<=|>|<)\s*[^;]+\)\s*;?\s*$/.test(line.slice(offset))) return 'benign';
    return 'documentary';
  }
  // Only these inert read/arithmetic examples avoid cumulative quarantine.
  // Unknown substitutions keep their original medium severity and penalties.
  if (dp.name === 'shell-subst') {
    const command = line.slice(offset + 2, offset + length).replace(/\)\s*(?:\)\s*)*$/, '').trim();
    if (/^mktemp$/.test(command) ||
        /^jq\s+'\s*\.[A-Za-z_]\w*(?:\s*\/\/\s*0)?\s*'\s+"\$[A-Za-z_]\w*"$/.test(command) ||
        /^echo\s+"(?:scale=\d+;\s*)?(?:(?:\$[A-Za-z_]\w*|\d+(?:\.\d+)?|[ .<>=*/+%-])+)(?:\s*)"\s*\|\s*bc(?:\s+-l)?$/.test(command)) return 'documentary';
    return 'active';
  }
  const documentaryPatterns = ['prompt-override', 'remote-download-pipe-shell', 'rm-rf'];
  if (!documentaryPatterns.includes(dp.name) || /<!--/.test(line) || context.imperative) return 'active';
  // Require an explicit refusal referring to quoted input, or a catalogued
  // command. A warning elsewhere never grants permission to an active line.
  if (dp.name === 'rm-rf' && context.watched && !/\$\(|https?:|[;&|]/.test(line) && offset === line.indexOf('rm') && /^\s*-\s+rm\s+-rf\b/.test(line)) return 'documentary';
  if (context.language && !['text', 'plaintext'].includes(context.language)) return 'active';
  if (dp.name === 'rm-rf' && /^description:.*intercepts dangerous commands.*confirmation/i.test(line)) return 'documentary';
  const prefix = line.slice(0, offset);
  const quoted = ((prefix.match(/`/g)?.length ?? 0) % 2 === 1) || ((prefix.match(/"/g)?.length ?? 0) % 2 === 1);
  if (quoted && !/["`]/.test(line.slice(offset, offset + length)) && /must be rejected|is an attack, not a repro|content to (?:quote and flag|report), not to (?:obey|execute)/i.test(line)) return 'documentary';
  return 'active';
}

/**
 * Scan a single file for dangerous patterns.
 */
export function scanFile(filePath: string, executableContext = false): ScanResult {
  try {
    const content = readTextForScan(filePath);
    if (content === null) return refusalResult(filePath);
    return scanSkillContent(content, filePath, executableContext);
  } catch (error) {
    logger.debug(`Failed to scan file: ${filePath}`, { error });
    return { file: filePath, findings: [], scannedAt: Date.now(), textRead: false };
  }
}

export function scanSkillContent(content: string, filePath: string, executableContext = false): ScanResult {
  const findings: ScanFinding[] = [];
  const lines = content.split('\n');
  const patterns = getDangerousPatterns();

  const contexts = scanContexts(content, filePath, executableContext);
  for (let i = 0; i < lines.length; i++) {
    const originalLine = lines[i];
    if (originalLine === undefined) continue;
    if (originalLine.trim() === '---') continue;

    let matchLine = originalLine.endsWith('\r') ? originalLine.slice(0, -1) : originalLine;
    let j = i;
    while (matchLine.endsWith('\\') && j + 1 < lines.length) {
      let nextLine = lines[j + 1]!;
      if (nextLine.endsWith('\r')) nextLine = nextLine.slice(0, -1);
      matchLine = matchLine.slice(0, -1) + nextLine;
      j++;
    }

    for (const dp of patterns) {
      for (const match of matchLine.matchAll(new RegExp(dp.pattern.source, dp.pattern.flags.replace('g', '') + 'g'))) {
        const kind = classifyMention(dp, match, matchLine, contexts[i]!, match.index, match[0].length);
        if (kind === 'benign') continue;
        findings.push({
          severity: dp.severity,
          pattern: dp.name, description: dp.description, file: filePath,
          line: i + 1, evidence: originalLine.trim().slice(0, 120),
          ...(kind === 'documentary' ? { documentary: true } : {}),
        });
      }
    }
  }
  // Apply the same context decisions to the full-document deobfuscation
  // pass. Only the matched span is masked; hidden/multiline/encoded attacks
  // and other patterns on the same line remain visible.
  findings.push(...collectMultilineBackticks(content, filePath, contexts, findings));
  findings.push(...collectPromptInjectionFindings(content, filePath, findings, contexts));
  // Last: a launcher already reported on its line by the spelling-based
  // detectors counts once, not twice.
  findings.push(...collectShellCommandWordFindings(content, filePath, contexts, findings));
  return { file: filePath, findings, scannedAt: Date.now(), textRead: true };
}

/** Backticks are interpreter syntax; decoding prose must not manufacture them. */
const STRUCTURAL_SHELL_PATTERNS = new Set<string>(['non-literal-command-word', 'interpreter-command-word', 'unparseable-shell']);
const STRUCTURAL_SHELL_DESCRIPTIONS: Record<ShellWordFindingKind, string> = {
  'non-literal-command-word': 'Shell command word is not a plain literal (expansion, quote, escape, glob or substitution): the executed program cannot be known statically',
  'interpreter-command-word': 'Shell command word is an interpreter or a file-sourcing builtin that can execute a copied payload',
  'unparseable-shell': 'Shell text cannot be split safely into simple commands (fail closed)',
};
const SHELL_EXTENSIONS_WITHOUT_LANGUAGE = new Set(['.ksh', '.fish', '.dash', '.ash', '.csh', '.tcsh']);

/**
 * Structural, closed-by-default check: every word in COMMAND position of a
 * shell script (or of a fenced shell block) must be a plain literal, and a
 * literal must not be an interpreter. No list of forbidden spellings.
 */
function collectShellCommandWordFindings(content: string, filePath: string, contexts: ScanContext[], existing: ScanFinding[]): ScanFinding[] {
  const lines = content.split('\n');
  const regions: Array<{ from: number; text: string }> = [];
  const first = contexts[0];
  if (!first) return [];
  if (!first.markdown) {
    const extension = path.extname(filePath).toLowerCase();
    if (SHELL_LANGUAGES.has(first.language) || SHELL_EXTENSIONS_WITHOUT_LANGUAGE.has(extension)) {
      regions.push({ from: 1, text: content });
    }
  } else {
    let current: { from: number; lines: string[] } | null = null;
    const flush = (): void => {
      if (current) regions.push({ from: current.from, text: current.lines.join('\n') });
      current = null;
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const isFence = /^\s*(?:`{3,}|~{3,})/.test(line);
      if (!isFence && SHELL_LANGUAGES.has(contexts[i]!.language)) {
        if (!current) current = { from: i + 1, lines: [] };
        current.lines.push(line);
      } else {
        flush();
      }
    }
    flush();
  }
  const findings: ScanFinding[] = [];
  for (const region of regions) {
    for (const item of analyzeShellCommandWords(region.text, region.from)) {
      if (!first.markdown && existing.some(f => !f.documentary && f.line === item.line && f.pattern === 'shell-interpreter')) continue;
      findings.push({
        severity: 'high',
        pattern: item.kind,
        description: STRUCTURAL_SHELL_DESCRIPTIONS[item.kind],
        file: filePath,
        line: item.line,
        evidence: `${(lines[item.line - 1] ?? '').trim().slice(0, 100)} [${item.word}]`.slice(0, 120),
        // Same policy as every launcher finding: a fenced block of a document
        // is guidance kept for review; a copied script is an active quarantine.
        ...(first.markdown ? { documentary: true } : {}),
      });
    }
  }
  return findings;
}

function collectMultilineBackticks(content: string, filePath: string, contexts: ScanContext[], existing: ScanFinding[]): ScanFinding[] {
  const lines = content.split('\n');
  const findings: ScanFinding[] = [];
  for (const name of ['php-backtick', 'shell-backtick']) {
    const dp = DANGEROUS_PATTERNS.find(pattern => pattern.name === name)!;
    const scoped = lines.map((line, i) => {
      const context = contexts[i]!;
      const language = name === 'php-backtick' ? context.language === 'php' : hasShellBackticks(context) && !(SHELL_LANGUAGES.has(context.language) && context.shellLiteral);
      if (!language || (context.markdown && /^\s*(?:`{3,}|~{3,})/.test(line))) return ' '.repeat(line.length);
      // A literal delimiter must not consume the opening of a later command.
      return name === 'shell-backtick' && SHELL_LANGUAGES.has(context.language)
        ? line.replace(/`/g, (tick, offset: number) => shellPosition(line, offset).literal ? ' ' : tick)
        : line;
    }).join('\n');
    for (const match of scoped.matchAll(/`[^`]+`/g)) {
      const lineIndex = scoped.slice(0, match.index).split('\n').length - 1;
      const offset = match.index - (scoped.lastIndexOf('\n', match.index - 1) + 1);
      if (!match[0].includes('\n') && existing.some(f => f.pattern === name && f.line === lineIndex + 1)) continue;
      const kind = classifyMention(dp, match, lines[lineIndex]!, contexts[lineIndex]!, offset, match[0].length);
      if (kind === 'benign') continue;
      findings.push({ severity: dp.severity, pattern: dp.name, description: dp.description,
        file: filePath, line: lineIndex + 1, evidence: match[0].trim().slice(0, 120),
        ...(kind === 'documentary' ? { documentary: true } : {}),
      });
    }
  }
  return findings;
}

/** Automatic installation/registration requires allow; review is never automatic. */
export function scanDeniesInstall(result: ScanResult): boolean {
  if (result.textRead !== true) return true;
  return buildSkillFirewallReport(result.file, [result]).verdict !== 'allow';
}

/**
 * Scan a directory of skill files recursively.
 */
export function scanDirectory(dirPath: string, withinScripts = false): ScanResult[] {
  const results: ScanResult[] = [];

  let dirInfo: fs.Stats;
  try {
    dirInfo = fs.lstatSync(dirPath);
  } catch {
    return results;
  }
  if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink()) {
    results.push(unreadFinding(dirPath, dirInfo.isSymbolicLink() ? 'symlink' : 'special'));
    return results;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isSymbolicLink()) {
      let target: fs.Stats | undefined;
      try {
        target = fs.statSync(fullPath);
      } catch {
        target = undefined;
      }
      if (!target?.isFile()) {
        results.push(unreadFinding(fullPath, 'symlink'));
        continue;
      }
    } else if (entry.isFIFO() || entry.isSocket() || entry.isBlockDevice() || entry.isCharacterDevice()) {
      results.push(unreadFinding(fullPath, 'special'));
      continue;
    }

    if (entry.isDirectory()) {
      results.push(...scanDirectory(fullPath, withinScripts || entry.name.toLowerCase() === 'scripts'));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      // The importer copies every support file. A suffix cannot hide a payload.
      const result = scanFile(fullPath, withinScripts || !/\.md$/i.test(entry.name) || isExecutableOrShebang(fullPath));
      if (result.textRead !== true) {
        results.push(result.findings.length > 0 ? result : unreadFinding(fullPath, 'file'));
      } else if (result.findings.length > 0) {
        results.push(result);
      }
    }
  }

  return results;
}

/**
 * Scan all skill locations (bundled, managed, workspace).
 */
export function scanAllSkills(projectRoot: string = process.cwd()): ScanResult[] {
  const skillDirs = [
    path.join(projectRoot, '.codebuddy', 'skills', 'bundled'),
    path.join(projectRoot, '.codebuddy', 'skills', 'managed'),
    path.join(projectRoot, '.codebuddy', 'skills', 'workspace'),
  ];

  const results: ScanResult[] = [];
  for (const dir of skillDirs) {
    results.push(...scanDirectory(dir));
  }

  return results;
}

/**
 * Build an operator-facing firewall report for one skill file or directory.
 *
 * The legacy scanner reports raw pattern hits. This layer turns them into
 * a trust score, capability flags, and an install verdict suitable for
 * marketplace/candidate quarantine flows.
 */
export function scanSkillFirewall(targetPath: string): SkillFirewallReport {
  const normalizedTarget = path.resolve(targetPath);
  let info: fs.Stats | undefined;
  try {
    info = fs.lstatSync(normalizedTarget);
  } catch {
    info = undefined;
  }
  if (!info) return buildSkillFirewallReport(normalizedTarget, []);
  if (info.isSymbolicLink()) {
    let target: fs.Stats | undefined;
    try {
      target = fs.statSync(normalizedTarget);
    } catch {
      target = undefined;
    }
    if (!target?.isFile()) {
      return buildSkillFirewallReport(normalizedTarget, [unreadFinding(normalizedTarget, 'symlink')]);
    }
  } else if (!info.isDirectory() && !info.isFile()) {
    return buildSkillFirewallReport(normalizedTarget, [unreadFinding(normalizedTarget, 'special')]);
  }
  const results = info.isDirectory() && !info.isSymbolicLink()
    ? scanDirectory(normalizedTarget)
    : [readOrRefuse(scanFile(normalizedTarget))];
  return buildSkillFirewallReport(normalizedTarget, results);
}

export function buildSkillFirewallReport(
  targetPath: string,
  results: ScanResult[],
): SkillFirewallReport {
  const findings = results.flatMap((result) => result.findings);
  const findingCounts = countFindings(findings);
  const capabilities = inferCapabilities(findings);
  const score = computeFirewallScore(countFindings(findings.filter(f => !f.documentary)));
  const activeCounts = countFindings(findings.filter(f => !f.documentary));
  const activeScore = computeFirewallScore(activeCounts);
  const activeCapabilities = inferCapabilities(findings.filter(f => !f.documentary));
  const activeVerdict = determineFirewallVerdict(activeCounts, activeCapabilities, activeScore);
  const verdict = activeVerdict === 'allow' && findings.some(f => f.documentary) ? 'review' : activeVerdict;

  return {
    schemaVersion: 1,
    capabilities,
    findingCounts,
    findings,
    generatedAt: new Date().toISOString(),
    quarantineRequired: verdict === 'quarantine',
    score,
    summary: summarizeFirewall(verdict, score, findingCounts, capabilities),
    target: targetPath,
    verdict,
  };
}

/**
 * Format scan results as a human-readable report.
 */
export function formatScanReport(results: ScanResult[]): string {
  if (results.length === 0) {
    return 'Skill scan: No security issues found.';
  }

  const allFindings = results.flatMap(r => r.findings);
  const bySeverity = {
    critical: allFindings.filter(f => f.severity === 'critical'),
    high: allFindings.filter(f => f.severity === 'high'),
    medium: allFindings.filter(f => f.severity === 'medium'),
    low: allFindings.filter(f => f.severity === 'low'),
    info: allFindings.filter(f => f.severity === 'info'),
  };

  const lines: string[] = [];
  lines.push(`Skill Security Scan: ${allFindings.length} findings in ${results.length} files`);
  lines.push(`  Critical: ${bySeverity.critical.length} | High: ${bySeverity.high.length} | Medium: ${bySeverity.medium.length} | Low: ${bySeverity.low.length} | Info: ${bySeverity.info.length}`);
  lines.push('');

  for (const result of results) {
    lines.push(`${path.basename(result.file)}:`);
    for (const finding of result.findings) {
      const sev = finding.severity.toUpperCase().padEnd(8);
      lines.push(`  [${sev}] L${finding.line}: ${finding.description}`);
      lines.push(`           ${finding.evidence}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Full-document de-obfuscation pass across pattern capabilities.
 * Safe de-obfuscation (zero-width, homoglyphs, césures) is applied to all capabilities.
 * Aggressive de-obfuscation (Base64, percent-decoding) is restricted to prompt-injection.
 */
function collectDeobfuscatedFindings(
  content: string,
  filePath: string,
  existing: ScanFinding[],
  contexts: ScanContext[],
): ScanFinding[] {
  const extra: ScanFinding[] = [];
  const seen = new Set(existing.map((finding) => finding.pattern));

  const deobAll = isDeobAllEnabled();
  // Fold compatibility operators while preserving interpreter framing.
  // HTML/whitespace stripping must not erase fences or heredoc delimiters.
  // Rebuild language and literal contexts after NFKC, including folded fences.
  {
    // Minimum interpreter framing is mandatory even when extended decoding is off.
    const folded = foldUnicodeForScan(content);
    if (folded !== content) {
      const foldedContexts = scanContexts(folded, filePath, !contexts[0]?.markdown);
      const launcher = DANGEROUS_PATTERNS.find(dp => dp.name === 'shell-interpreter')!;
      const launcherFindings: ScanFinding[] = [];
      for (const [index, line] of folded.split('\n').entries()) {
        for (const match of line.matchAll(new RegExp(launcher.pattern.source, 'gi'))) {
          const kind = classifyMention(launcher, match, line, foldedContexts[index]!, match.index, match[0].length);
          if (kind === 'benign') continue;
          launcherFindings.push({ severity: launcher.severity, pattern: launcher.name, description: launcher.description,
            file: filePath, line: index + 1, evidence: line.trim().slice(0, 120),
            ...(kind === 'documentary' ? { documentary: true } : {}),
          });
        }
      }
      for (const finding of [...collectMultilineBackticks(folded, filePath, foldedContexts, []), ...launcherFindings]) {
        if (existing.some(f => f.pattern === finding.pattern && Boolean(f.documentary) === Boolean(finding.documentary))) continue;
        extra.push({ ...finding, line: 1, description: `${finding.description} (obfuscated)` });
      }
    }
  }
  const patterns = getDangerousPatterns();

  const originalRawWindows = sliceScanWindows(content);
  let safeWindows: string[] | null = null;
  let aggressiveWindows: string[] | null = null;

  for (const dp of patterns) {
    // Interpreter backticks were folded and checked with language context above.
    if (dp.name === 'php-backtick' || dp.name === 'shell-backtick') continue;
    // A contextual launcher finding is authoritative; don't flatten it again.
    // Keep extended decoding for previously unseen, obfuscated launchers.
    if (dp.name === 'shell-interpreter' && (existing.some(f => f.pattern === dp.name) || extra.some(f => f.pattern === dp.name))) continue;
    const isInjection = dp.capability === 'prompt-injection';
    if (!isInjection && !deobAll) continue;
    if (existing.some(f => f.pattern === dp.name && !f.documentary)) continue;
    const contextualContent = content.split('\n').map((line, i) => {
      return line.replace(new RegExp(dp.pattern.source, dp.pattern.flags.replace('g', '') + 'g'), (...args: unknown[]) => {
        const match = args[0] as string;
        const offset = args[args.length - 2] as number;
        const fullArgs = args.slice(0, args.length - 2) as RegExpMatchArray;
        fullArgs.index = offset;
        fullArgs.input = line;
        return classifyMention(dp, fullArgs, line, contexts[i]!, offset, match.length) === 'active' ? match : ' '.repeat(match.length);
      });
    }).join('\n');
    const rawWindows = contextualContent === content ? originalRawWindows : sliceScanWindows(contextualContent);

    const flags = isInjection && !dp.pattern.flags.includes('s')
      ? `${dp.pattern.flags}s`
      : dp.pattern.flags;
    const re = new RegExp(dp.pattern.source, flags.replace('g', ''));

    // Prompt-injection patterns also match against raw content across lines/comments
    if (isInjection) {
      let rawMatched = false;
      for (const win of rawWindows) {
        const match = re.exec(win);
        if (match && match.index !== undefined) {
          if (['remote-download-pipe-shell', 'bash-curl-command', 'base64-decode-pipe-shell', 'hex-printf-pipe-shell', 'shell-interpreter', 'html-comment-hidden-command'].includes(dp.name) && match[1]) {
            const normalCmd = deobfuscateShellWord(match[1]);
            if (normalCmd !== null) {
              const base = path.basename(normalCmd).replace(/\.exe$/i, '').toLowerCase();
              const allowed = dp.name === 'shell-interpreter' ? ['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish'] :
                              dp.name === 'remote-download-pipe-shell' ? ['sh', 'bash', 'zsh'] :
                              ['sh', 'bash', 'zsh', 'dash'];
              if (!allowed.includes(base)) continue;
            }
          }
          seen.add(dp.name);
          extra.push({
            severity: dp.severity,
            pattern: dp.name,
            description: dp.description,
            file: filePath,
            line: 1,
            evidence: match[0].replace(/\s+/g, ' ').trim().slice(0, 120),
          });
          rawMatched = true;
          break;
        }
      }
      if (rawMatched) continue;
    }

    const targetWindows = isInjection
      ? contextualContent === content
        ? (aggressiveWindows ??= deobfuscateForScanWindows(content))
        : deobfuscateForScanWindows(contextualContent)
      : contextualContent === content
        ? (safeWindows ??= deobfuscateSafeForScanWindows(content))
        : deobfuscateSafeForScanWindows(contextualContent);

    for (const win of targetWindows) {
      const normMatch = re.exec(win);
      if (!normMatch || normMatch.index === undefined) continue;
      if (['remote-download-pipe-shell', 'bash-curl-command', 'base64-decode-pipe-shell', 'hex-printf-pipe-shell', 'shell-interpreter', 'html-comment-hidden-command'].includes(dp.name) && normMatch[1]) {
        const normalCmd = deobfuscateShellWord(normMatch[1]);
        if (normalCmd !== null) {
          const base = path.basename(normalCmd).replace(/\.exe$/i, '').toLowerCase();
          const allowed = dp.name === 'shell-interpreter' ? ['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish'] :
                          dp.name === 'remote-download-pipe-shell' ? ['sh', 'bash', 'zsh'] :
                          ['sh', 'bash', 'zsh', 'dash'];
          if (!allowed.includes(base)) continue;
        }
      }
      seen.add(dp.name);
      extra.push({
        severity: dp.severity,
        pattern: dp.name,
        description: `${dp.description} (obfuscated)`,
        file: filePath,
        line: 1,
        evidence: normMatch[0].replace(/\s+/g, ' ').trim().slice(0, 120),
      });
      break;
    }
  }
  return extra;
}

const collectPromptInjectionFindings = collectDeobfuscatedFindings;

function countFindings(findings: ScanFinding[]): Record<FindingSeverity, number> {
  return {
    critical: findings.filter((finding) => finding.severity === 'critical').length,
    high: findings.filter((finding) => finding.severity === 'high').length,
    medium: findings.filter((finding) => finding.severity === 'medium').length,
    low: findings.filter((finding) => finding.severity === 'low').length,
    info: findings.filter((finding) => finding.severity === 'info').length,
  };
}

function inferCapabilities(findings: ScanFinding[]): SkillFirewallCapability[] {
  const capabilities = new Set<SkillFirewallCapability>();
  for (const finding of findings) {
    const pattern = DANGEROUS_PATTERNS.find((item) => item.name === finding.pattern);
    if (pattern) capabilities.add(pattern.capability);
    else if (STRUCTURAL_SHELL_PATTERNS.has(finding.pattern)) capabilities.add('shell');
  }
  return [...capabilities].sort();
}

function computeFirewallScore(counts: Record<FindingSeverity, number>): number {
  const penalty =
    counts.critical * 45 +
    counts.high * 24 +
    counts.medium * 10 +
    counts.low * 4 +
    counts.info;
  return Math.max(0, 100 - penalty);
}

function determineFirewallVerdict(
  counts: Record<FindingSeverity, number>,
  capabilities: SkillFirewallCapability[],
  score: number,
): SkillFirewallVerdict {
  if (counts.critical > 0 || score < 55) return 'quarantine';
  if (
    counts.high > 0 &&
    (capabilities.includes('dynamic-code') || capabilities.includes('shell') || capabilities.includes('prototype-pollution'))
  ) {
    return 'quarantine';
  }
  if (counts.high > 0 || counts.medium > 0 || score < 85) return 'review';
  return 'allow';
}

function summarizeFirewall(
  verdict: SkillFirewallVerdict,
  score: number,
  counts: Record<FindingSeverity, number>,
  capabilities: SkillFirewallCapability[],
): string {
  if (verdict === 'allow') {
    return `Skill Firewall allow: score ${score}/100; no blocking capability detected.`;
  }
  const findingSummary = [
    counts.critical ? `${counts.critical} critical` : '',
    counts.high ? `${counts.high} high` : '',
    counts.medium ? `${counts.medium} medium` : '',
  ].filter(Boolean).join(', ');
  const capabilitySummary = capabilities.length ? `; capabilities: ${capabilities.join(', ')}` : '';
  if (verdict === 'quarantine') {
    return `Skill Firewall quarantine: score ${score}/100; ${findingSummary || 'blocking pattern detected'}${capabilitySummary}.`;
  }
  return `Skill Firewall review: score ${score}/100; ${findingSummary || 'non-blocking patterns detected'}${capabilitySummary}.`;
}
