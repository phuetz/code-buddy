/** External hooks are data until explicitly enabled; execution stays in UserHooksManager. */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { builtinModules } from 'module';
import ts from 'typescript';
import { buildSkillFirewallReport, scanSkillText, scanSkillFirewall } from '../security/skill-scanner.js';
import { TOOL_ALIASES } from '../tools/registry/tool-alias-map.js';
import type { UserHookEvent, UserHookHandler } from './user-hooks.js';
import { writeJsonAtomicSync } from '../utils/atomic-write.js';
import { hookScriptPolicy } from './hook-import-policy.js';

export const CLAUDE_TOOLS: Record<string, string> = {
  Bash: 'bash', Edit: 'str_replace_editor', Write: 'create_file', Read: 'view_file',
  Grep: 'search', Glob: 'search', WebFetch: 'web_fetch', WebSearch: 'web_search',
};
const EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SessionStart', 'SessionEnd', 'PreCompact']);
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const MAX_FILE = 2 * 1024 * 1024;
const MAX_BUNDLE = 8 * 1024 * 1024;

export interface HookImportRecord {
  schemaVersion: 1;
  id: string;
  event: UserHookEvent;
  enabled: boolean;
  status: 'installed' | 'quarantined';
  handler: UserHookHandler;
  source: string;
  sourceFingerprint: string;
  fingerprint: string;
  originalCommand: string;
  matcher: string;
  files: Record<string, string>;
  reasons: string[];
}

export interface HookImportReport {
  compatibility: string[];
  dryRun: boolean;
  source: string;
  total: number;
  imported: HookImportRecord[];
  quarantined: HookImportRecord[];
  refused: Array<{ event: string; command?: string; reason: string }>;
}

export function hashHookText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object');
  return value as Record<string, unknown>;
}

/** No symlinks (including parents), traversal, special files or unbounded reads. */
function regularFile(root: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error(`Path escapes source: ${relative}`);
  let current = root;
  for (const segment of relative.split(/[\\/]/).filter((s) => s && s !== '.')) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink refused: ${relative}`);
  }
  const fd = fs.openSync(current, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_FILE) throw new Error(`Not a bounded regular file: ${relative}`);
    const bytes = fs.readFileSync(fd);
    if (bytes.includes(0)) throw new Error(`Binary file refused: ${relative}`);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes)) throw new Error(`Non UTF-8 file refused: ${relative}`);
    return text;
  } finally { fs.closeSync(fd); }
}

function rootWithoutSymlinks(root: string): void {
  let current = path.resolve(root);
  for (;;) {
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink directory refused: ${current}`);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/** Restrict matchers to patterns with an exact, explainable translation. */
export function translateHookMatcher(event: string, matcher = ''): string | undefined {
  if (matcher.length > 256) throw new Error('Matcher exceeds the supported length');
  if (!matcher || matcher === '*' || matcher === '.*') return undefined;
  if (!TOOL_EVENTS.has(event)) throw new Error(`Matcher ${matcher} has no equivalent for ${event}`);
  if (matcher === '^mcp__') return matcher;
  if (/^\^?mcp__[a-zA-Z0-9_-]*(?:\.\*)?\$?$/.test(matcher)) {
    return `^${matcher.replace(/^\^/, '').replace(/\$$/, '')}$`;
  }
  const names = new Set<string>();
  for (const term of matcher.split('|')) {
    const legacy = CLAUDE_TOOLS[term] ?? TOOL_ALIASES[term]
      ?? (Object.values(CLAUDE_TOOLS).includes(term) ? term : undefined);
    if (!legacy) throw new Error(`Tool matcher has no equivalent: ${term}`);
    names.add(legacy);
    for (const [alias, target] of Object.entries(TOOL_ALIASES)) if (target === legacy) names.add(alias);
  }
  return `^(?:${[...names].join('|')})$`;
}

/** Small literal-command grammar, deliberately refusing shell programs we cannot bundle. */
function words(command: string): string[] {
  const result: string[] = [];
  let token = '', quote = '', started = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (c === '\\') throw new Error('Shell escapes are not supported');
    if (quote) {
      if (c === quote) quote = '';
      else token += c;
    } else if (c === '"' || c === "'") { quote = c; started = true; }
    else if (/\s/.test(c)) {
      if (started) { result.push(token); token = ''; started = false; }
    } else if (/[;&|<>`]/.test(c)) throw new Error('Compound shell commands are not supported');
    else { token += c; started = true; }
  }
  if (quote) throw new Error('Unterminated shell quote');
  if (started) result.push(token);
  if (!result.length) throw new Error('Empty command');
  return result;
}

export function quoteHookArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function relativeScript(raw: string): string {
  return raw.replace(/^\$\{CLAUDE_PLUGIN_ROOT\}\//, '').replace(/^\$CLAUDE_PLUGIN_ROOT\//, '').replace(/^\.\//, '');
}

function scriptReferences(text: string, file: string): string[] {
  // JS/TS syntax is parsed, not executed. Variable requires are caught by the firewall
  // and also refused here; external packages cannot be resolved through host node_modules.
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const refs: string[] = [];
  const add = (value: ts.Node | undefined): void => {
    if (!value || !ts.isStringLiteralLike(value)) throw new Error(`Dynamic module dependency: ${file}`);
    const name = value.text;
    if (['module', 'node:module', 'vm', 'node:vm'].includes(name)) throw new Error(`Runtime code loader not supported: ${file}`);
    if (BUILTINS.has(name)) return;
    if (!name.startsWith('.')) throw new Error(`External module dependency not bundled: ${name} (${file})`);
    refs.push(name);
  };
  const visit = (node: ts.Node): void => {
    const indirectLoaders = ['require', 'createRequire', 'getBuiltinModule', 'mainModule', '_load', 'constructor'];
    if (ts.isPropertyAccessExpression(node) && indirectLoaders.includes(node.name.text)
      || ts.isElementAccessExpression(node) && node.argumentExpression
        && ts.isStringLiteralLike(node.argumentExpression) && indirectLoaders.includes(node.argumentExpression.text)
      || ts.isIdentifier(node) && node.text === 'Function') {
      throw new Error(`Indirect runtime code loader not supported: ${file}`);
    }
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && /^CLAUDE_/.test(node.text)
      && !['CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT'].includes(node.text)) {
      throw new Error(`Claude environment variable has no supported equivalent: ${node.text} (${file})`);
    }
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && node.text === 'transcript_path') {
      throw new Error(`Claude transcript file contract is not available: ${file}`);
    }
    if (ts.isStringLiteralLike(node) && (node.text.startsWith('/') && node.text !== '/'
      || /^[a-z]:[\\/]/i.test(node.text))) throw new Error(`Source-machine absolute path in script: ${file}`);
    if (ts.isIdentifier(node) && node.text === 'require' && !(
      ts.isCallExpression(node.parent) && node.parent.expression === node
      || ts.isPropertyAccessExpression(node.parent) && ['main'].includes(node.parent.name.text)
    )) throw new Error(`Indirect module loader not supported: ${file}`);
    if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && node.expression.text === 'require')
      || node.expression.kind === ts.SyntaxKind.ImportKeyword)) add(node.arguments[0]);
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node.moduleSpecifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return refs;
}

/** Shell scripts use the same deliberately literal grammar; every sourced script is copied. */
function shellReferences(text: string, file: string): string[] {
  const refs: string[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const args = words(line);
    if (['echo', 'printf', 'true', 'false', 'exit'].includes(args[0]!)) {
      if (args.some((arg) => arg.includes('$') && !/^\$\{?CLAUDE_PROJECT_DIR\}?$/.test(arg))) {
        throw new Error(`Dynamic shell expansion not supported: ${file}`);
      }
      continue;
    }
    if (['source', '.', 'sh', 'bash', 'node'].includes(args[0]!) && args[1]) {
      if (!/^\$(?:\{CLAUDE_PLUGIN_ROOT\}|CLAUDE_PLUGIN_ROOT)\//.test(args[1])) {
        throw new Error(`Shell dependency must use CLAUDE_PLUGIN_ROOT, not the caller working directory: ${file}`);
      }
      const ref = relativeScript(args[1]);
      if (!/^[a-zA-Z0-9_./-]+$/.test(ref) || path.isAbsolute(ref)) throw new Error(`Dynamic shell dependency: ${file}`);
      if (!(args[0] === 'node' ? /\.[cm]?js$/ : /\.(?:sh|bash)$/).test(ref)) {
        throw new Error(`Interpreter/script extension mismatch: ${ref}`);
      }
      refs.push(`@root/${ref}`);
      continue;
    }
    throw new Error(`Shell statement not supported for dependency bundling: ${file}`);
  }
  return refs;
}

function bundleCommand(command: string, root: string, snapshots: Record<string, string>, reasons: string[] = []): string {
  if (process.platform === 'win32') throw new Error('Imported literal commands require a POSIX shell; Windows import is not supported');
  const args = words(command);
  const executable = args[0]!;
  if (!['node', 'sh', 'bash', 'echo', 'printf', 'true', 'false', 'exit'].includes(executable)) {
    throw new Error(`Command interpreter not supported for safe dependency bundling: ${executable}`);
  }
  const interpreter = ['node', 'sh', 'bash'].includes(executable);
  if (interpreter && (!args[1] || args[1].startsWith('-'))) {
    throw new Error('Inline interpreter programs/options cannot guarantee a copied dependency closure');
  }
  const pending: string[] = [];
  const packageMetadata: Record<string, string> = {};
  const rendered = args.map((arg, index) => {
    if (index === 0) return executable;
    const isScript = interpreter && (index === 1 || /\.(?:c?js|mjs|sh|bash)$/.test(arg));
    if (isScript) {
      const rel = relativeScript(arg);
      if (!(executable === 'node' ? /\.[cm]?js$/ : /\.(?:sh|bash)$/).test(rel)) {
        throw new Error(`Interpreter/script extension mismatch: ${arg}`);
      }
      if (!/^[a-zA-Z0-9_./-]+$/.test(rel) || path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.split(/[\\/]/).includes('..')) {
        throw new Error(`Source-machine or dynamic script path refused: ${arg}`);
      }
      pending.push(rel);
      return `"\${CODEBUDDY_IMPORTED_HOOK_ROOT}/bundle/${rel}"`;
    }
    if (path.isAbsolute(arg) || /^[a-z]:[\\/]/i.test(arg) || arg.startsWith('~')) {
      throw new Error(`Source-machine absolute path refused: ${arg}`);
    }
    if (arg === '${CLAUDE_PROJECT_DIR}' || arg === '$CLAUDE_PROJECT_DIR') return '"$CLAUDE_PROJECT_DIR"';
    if (arg.includes('$')) throw new Error(`Environment expansion not supported: ${arg}`);
    return quoteHookArg(arg);
  });
  let bytes = 0;
  while (pending.length) {
    const rel = pending.pop()!;
    const key = `bundle/${rel}`;
    if (Object.hasOwn(snapshots, key)) continue;
    const text = regularFile(root, rel);
    bytes += Buffer.byteLength(text);
    if (bytes > MAX_BUNDLE || Object.keys(snapshots).length > 128) throw new Error('Dependency bundle exceeds limit');
    snapshots[key] = text;
    for (let parent = path.dirname(rel); parent !== '.'; parent = path.dirname(parent)) {
      const packageFile = `${parent}/package.json`;
      if (fs.existsSync(path.join(root, packageFile))) {
        const packageText = regularFile(root, packageFile);
        const packageJson = object(JSON.parse(packageText));
        const policy = hookScriptPolicy(packageText, packageFile);
        reasons.push(...policy);
        if (policy.length) snapshots[`bundle/${packageFile}`] = packageText;
        packageMetadata[`bundle/${packageFile}`] = JSON.stringify({ type: packageJson.type === 'module' ? 'module' : 'commonjs' });
      }
    }
    const fileScan = buildSkillFirewallReport(rel, [scanSkillText(text, rel)]);
    const policy = hookScriptPolicy(text, rel);
    reasons.push(...policy);
    if (fileScan.verdict !== 'allow') reasons.push(...fileScan.findings.map((f) => `${rel}: ${f.pattern}: ${f.description}`));
    if (fileScan.verdict !== 'allow' || policy.length) continue; // Evidence only; reasons prohibit activation/execution.
    let refs: string[];
    try {
      refs = /\.(?:sh|bash)$/.test(rel) ? shellReferences(text, rel)
        : path.extname(rel) === '.json' ? [] : scriptReferences(text, rel);
    } catch (error) {
      reasons.push(`${rel}: command/dependencies not proven safe: ${error}`);
      continue;
    }
    for (const ref of refs) {
      const dependency = ref.startsWith('@root/') ? ref.slice(6) : path.normalize(path.join(path.dirname(rel), ref));
      const candidates = [dependency, `${dependency}.js`, `${dependency}.cjs`, `${dependency}/index.js`];
      const found = candidates.find((p) => fs.existsSync(path.join(root, p)) && !fs.lstatSync(path.join(root, p)).isDirectory());
      if (!found) throw new Error(`Missing dependency: ${ref} (${rel})`);
      if (!ref.startsWith('@root/') && !/\.(?:[cm]?js|json)$/.test(found)) throw new Error(`Unsupported executable dependency extension: ${found}`);
      pending.push(found);
    }
  }
  // Preserve CommonJS/ESM semantics without inheriting Code Buddy's package scope.
  const packageText = fs.existsSync(path.join(root, 'package.json')) ? regularFile(root, 'package.json') : '{}';
  const rootPolicy = hookScriptPolicy(packageText, 'package.json');
  reasons.push(...rootPolicy);
  const packageType = object(JSON.parse(packageText)).type === 'module' ? 'module' : 'commonjs';
  snapshots['bundle/package.json'] = rootPolicy.length ? packageText : JSON.stringify({ type: packageType });
  for (const [file, metadata] of Object.entries(packageMetadata)) {
    if (!snapshots[file] || !hookScriptPolicy(snapshots[file], file).length) snapshots[file] = metadata;
  }
  return rendered.join(' ');
}

function makeStorageDirectory(base: string): void {
  let existing = base;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  rootWithoutSymlinks(existing);
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  rootWithoutSymlinks(base);
}

function fingerprint(record: Pick<HookImportRecord, 'event' | 'handler' | 'source' | 'sourceFingerprint' | 'originalCommand' | 'matcher' | 'files'>): string {
  return hashHookText(JSON.stringify([record.event, record.handler, record.source, record.sourceFingerprint,
    record.originalCommand, record.matcher, record.files]));
}

function storage(projectRoot: string, quarantine = false): string {
  return path.join(projectRoot, '.codebuddy', quarantine ? 'hook-quarantine' : 'imported-hooks');
}

export function importHooks(options: { file?: string; dir?: string; apply?: boolean; projectRoot?: string }): HookImportReport {
  if (!!options.file === !!options.dir) throw new Error('Specify exactly one of --file or --dir');
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  let file: string;
  if (options.dir) {
    const dir = path.resolve(options.dir);
    file = ['hooks/hooks.json', '.claude/settings.json'].map((p) => path.join(dir, p)).find((p) => fs.existsSync(p)) ?? '';
    if (!file) throw new Error('No hooks/hooks.json or .claude/settings.json in source directory');
  } else file = path.resolve(options.file!);
  const parent = path.dirname(file);
  const root = ['hooks', '.claude'].includes(path.basename(parent)) ? path.dirname(parent) : parent;
  rootWithoutSymlinks(root);
  const raw = regularFile(root, path.relative(root, file));
  const config = object(JSON.parse(raw));
  const events = object(config.hooks);
  const report: HookImportReport = {
    compatibility: [
      'Execution uses UserHooksManager: exit 2 blocks PreToolUse; other supported async-runner events provide feedback only.',
      'PreCompact uses the existing synchronous advisory boundary (5 seconds maximum); it does not block compaction.',
      'POSIX literal commands and statically copied dependencies only; unsupported syntax, fields, matchers and events are refused.',
      'CLAUDE_PLUGIN_ROOT points to the copied bundle; CLAUDE_PROJECT_DIR points to the execution directory. Other Claude variables and transcript_path are refused.',
      'Imported hooks inherit the core shell environment without credentials or interpreter preloads. No background execution is imported.',
    ],
    dryRun: !options.apply, source: file, total: 0, imported: [], quarantined: [], refused: [],
  };
  for (const [event, groups] of Object.entries(events)) {
    if (!Array.isArray(groups)) {
      report.total++;
      report.refused.push({ event, reason: 'Event must contain matcher groups' });
      continue;
    }
    for (const groupValue of groups) {
      let group: Record<string, unknown>;
      try { group = object(groupValue); } catch {
        report.total++; report.refused.push({ event, reason: 'Malformed matcher group' }); continue;
      }
      if (!Array.isArray(group.hooks) || !group.hooks.length) {
        report.total++; report.refused.push({ event, reason: 'Missing hook handlers' }); continue;
      }
      for (const value of group.hooks) {
        report.total++;
        let command: string | undefined;
        try {
          const external = object(value);
          command = typeof external.command === 'string' ? external.command : undefined;
          if (config.env !== undefined && Object.keys(object(config.env)).length) {
            throw new Error('Source settings.env is not imported; migrate environment explicitly before importing hooks');
          }
          if (!EVENTS.has(event)) throw new Error(`Event ${event} has no supported runtime equivalent (Stop is not emitted by the user-hook turn loop)`);
          if (external.type !== 'command' || !command) throw new Error('Only non-empty command handlers are imported');
          if (external.async === true || external.asyncRewake === true) throw new Error('Background hooks are not supported by this importer');
          const unsupported = Object.keys(external).filter((k) => !['type', 'command', 'timeout', 'async'].includes(k));
          if (unsupported.length) throw new Error(`Unsupported handler fields: ${unsupported.join(', ')}`);
          if (group.matcher !== undefined && typeof group.matcher !== 'string') throw new Error('Matcher must be a string');
          if (Object.keys(group).some((k) => !['matcher', 'hooks', 'description'].includes(k))) throw new Error('Unsupported matcher group fields');
          const matcher = String(group.matcher ?? '');
          const pattern = translateHookMatcher(event, matcher);
          if (external.timeout !== undefined && (typeof external.timeout !== 'number' || !Number.isFinite(external.timeout)
            || external.timeout <= 0 || external.timeout > 300)) throw new Error('Timeout must be seconds in (0, 300]');
          const snapshots: Record<string, string> = { 'command.txt': command };
          const commandScan = buildSkillFirewallReport(file, [scanSkillText(command, 'command.txt')]);
          let translated = command;
          const reasons: string[] = [];
          if (commandScan.verdict !== 'allow') reasons.push(...commandScan.findings.map((f) => `${f.pattern}: ${f.description}`));
          // A dangerous command is kept as inert evidence; do not resolve its dynamic dependencies.
          if (!reasons.length) translated = bundleCommand(command, root, snapshots, reasons);
          const firewall = buildSkillFirewallReport(file, Object.entries(snapshots).map(([p, text]) => scanSkillText(text, p)));
          for (const [p, text] of Object.entries(snapshots)) reasons.push(...hookScriptPolicy(text, p));
          for (const f of firewall.findings) if (f.severity === 'critical' || f.severity === 'high' || f.severity === 'medium') {
            const reason = `${f.file}: ${f.pattern}: ${f.description}`;
            if (!reasons.includes(reason)) reasons.push(reason);
          }
          if (firewall.verdict !== 'allow' && !reasons.length) reasons.push(firewall.summary);
          const handler: UserHookHandler = { type: 'command', command: translated, timeout: Number(external.timeout ?? 10) * 1000 };
          if (pattern) handler.pattern = pattern;
          const record: HookImportRecord = {
            schemaVersion: 1, id: '', event: event as UserHookEvent, enabled: false,
            status: reasons.length ? 'quarantined' : 'installed', handler, source: file,
            sourceFingerprint: hashHookText(raw), fingerprint: '', originalCommand: command, matcher,
            files: Object.fromEntries(Object.entries(snapshots).map(([p, text]) => [p, hashHookText(text)])), reasons,
          };
          record.fingerprint = fingerprint(record);
          record.id = `imported-${event.toLowerCase()}-${record.fingerprint.slice(0, 16)}`;
          if (fs.existsSync(path.join(storage(projectRoot), record.id)) || fs.existsSync(path.join(storage(projectRoot, true), record.id))) {
            throw new Error(`Already imported: ${record.id}; existing files were preserved`);
          }
          if (options.apply) {
            const base = storage(projectRoot, record.status === 'quarantined');
            makeStorageDirectory(base);
            const dest = path.join(base, record.id);
            fs.mkdirSync(dest, { mode: 0o700 });
            for (const [p, text] of Object.entries(snapshots)) {
              fs.mkdirSync(path.dirname(path.join(dest, p)), { recursive: true, mode: 0o700 });
              fs.writeFileSync(path.join(dest, p), text, { flag: 'wx', mode: 0o600 });
            }
            fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
          }
          (record.status === 'installed' ? report.imported : report.quarantined).push(record);
        } catch (error) {
          report.refused.push({ event, command, reason: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }
  return report;
}

export function listImportedHooks(projectRoot = process.cwd()): HookImportRecord[] {
  const result: HookImportRecord[] = [];
  for (const quarantined of [false, true]) {
    const base = storage(projectRoot, quarantined);
    try { fs.lstatSync(base); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error; // existsSync would hide EACCES and silently drop an imported guard.
    }
    rootWithoutSymlinks(base);
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.name.startsWith('imported-')) continue;
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Invalid imported hook directory: ${entry.name}`);
      const record = JSON.parse(regularFile(base, `${entry.name}/manifest.json`)) as HookImportRecord;
      if (record.id !== entry.name || record.schemaVersion !== 1 || !EVENTS.has(record.event)
        || typeof record.enabled !== 'boolean' || record.handler.type !== 'command'
        || record.id !== `imported-${record.event.toLowerCase()}-${record.fingerprint.slice(0, 16)}`
        || !Object.hasOwn(record.files, 'command.txt')
        || record.status !== (quarantined ? 'quarantined' : 'installed') || fingerprint(record) !== record.fingerprint) {
        throw new Error(`Invalid imported hook manifest: ${entry.name}`);
      }
      result.push(record);
    }
  }
  return result;
}

export function verifyImportedHook(record: HookImportRecord, projectRoot: string, rescan = false, approvedFiles?: Record<string, string>): string {
  const root = path.join(storage(projectRoot, record.status === 'quarantined'), record.id);
  rootWithoutSymlinks(root);
  const current = JSON.parse(regularFile(root, 'manifest.json')) as HookImportRecord;
  if (current.fingerprint !== record.fingerprint || (!rescan && current.enabled !== true)) {
    throw new Error(`Hook was changed or disabled: ${record.id}`);
  }
  if (fingerprint(record) !== record.fingerprint) throw new Error(`Hook manifest changed: ${record.id}`);
  for (const [p, expected] of Object.entries(record.files)) {
    const text = regularFile(root, p);
    if (hashHookText(text) !== expected) throw new Error(`Hook file changed: ${record.id}/${p}`);
    const policy = hookScriptPolicy(text, p);
    if (policy.length) throw new Error(`Hook policy refused: ${policy.join('; ')}`);
    if (scanSkillFirewall(path.join(root, p)).verdict !== 'allow') throw new Error(`Hook firewall refused: ${record.id}/${p}`);
    // The execution handoff uses these bytes, not another read of mutable project files.
    if (buildSkillFirewallReport(p, [scanSkillText(text, p)]).verdict !== 'allow') throw new Error(`Hook snapshot firewall refused: ${record.id}/${p}`);
    if (approvedFiles) approvedFiles[p] = text;
  }
  const snapshots: Record<string, string> = { 'command.txt': record.originalCommand };
  const reasons: string[] = [];
  const translated = bundleCommand(record.originalCommand, path.join(root, 'bundle'), snapshots, reasons);
  if (reasons.length) throw new Error(`Hook bundle refused: ${reasons.join('; ')}`);
  if (translated !== record.handler.command || Object.entries(snapshots).some(([file, text]) => record.files[file] !== hashHookText(text))) {
    throw new Error(`Hook command or dependency closure changed: ${record.id}`);
  }
  return root;
}

export function manageImportedHook(action: 'enable' | 'disable' | 'remove', id: string, projectRoot = process.cwd()): HookImportRecord {
  const record = listImportedHooks(projectRoot).find((r) => r.id === id);
  if (!record) throw new Error(`Imported hook not found: ${id}`);
  const root = path.join(storage(projectRoot, record.status === 'quarantined'), record.id);
  rootWithoutSymlinks(root);
  if (action === 'remove') { fs.rmSync(root, { recursive: true }); return record; }
  if (action === 'enable') {
    if (process.platform !== 'linux') throw new Error('Imported hook execution requires Linux child-subreaper supervision');
    if (record.status !== 'installed') throw new Error(`Quarantined hook cannot be enabled: ${record.reasons.join('; ')}`);
    verifyImportedHook(record, projectRoot, true);
  }
  record.enabled = action === 'enable';
  writeJsonAtomicSync(path.join(root, 'manifest.json'), record, { mode: 0o600 });
  return record;
}

export function importedHookHandlers(projectRoot: string): Array<{ event: UserHookEvent; handler: UserHookHandler }> {
  return listImportedHooks(projectRoot).filter((r) => r.status === 'installed').map((record) => ({
    event: record.event,
    handler: { ...record.handler, enabled: record.enabled, importedHook: record },
  }));
}
