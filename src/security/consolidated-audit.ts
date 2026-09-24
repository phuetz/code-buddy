/**
 * Consolidated security audit for `buddy security audit`.
 *
 * Aggregates checks that already exist elsewhere. It does not start a second
 * scanner, does not resolve DNS, and does not rewrite secret values.
 * `--fix` only clears permission bits. It never adds any, never follows a
 * symlink, and never writes a backup outside the profile root.
 *
 * Inventory (the check that already existed, then the stable id used here):
 * - scanSkillFirewall — src/security/skill-scanner.ts:367 → skills.firewall.*
 * - checkProfilePermissions — src/doctor/index.ts:422 → profile.directory.world_writable
 * - isNativeSandboxEnabled / detectNativeSandboxCapabilities — src/security/native-sandbox.ts:91 and :234
 * - SECRET_PATTERNS — src/security/secret-patterns.ts:29 → config.plaintext_secret
 * - SSRFGuard.isSafeUrlSync — src/security/ssrf-guard.ts:347 → mcp.remote.unsafe_url
 * - stdio inheritEnv — src/mcp/transports.ts:46 → mcp.stdio.inherits_environment
 * - ignored "servers" key — src/mcp/config.ts:171 → mcp.config.servers_key_ignored
 * - loadMCPConfig sources — src/mcp/config.ts:68 → project mcp.json, project
 *   settings.json mcpServers, profile mcp.json. Profile settings.json and
 *   project settings.local.json are not runtime MCP server sources.
 */

import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import TOML from '@iarna/toml';
import { isNativeSandboxEnabled, type NativeSandboxCapabilities } from './native-sandbox.js';
import { SECRET_PATTERNS } from './secret-patterns.js';
import { scanSkillFirewall } from './skill-scanner.js';
import { SSRFGuard } from './ssrf-guard.js';

export type SecurityAuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type SecurityAuditStatus = 'passed' | 'passed_with_suppressions' | 'failed';
export type SecurityAuditRoot = 'profile' | 'project';

export interface SecurityAuditFinding {
  checkId: string;
  severity: SecurityAuditSeverity;
  title: string;
  detail: string;
  fixable: boolean;
  /** Relative path used by --fix. Never recovered by splitting detail. */
  subject?: string;
  subjectRoot?: SecurityAuditRoot;
}

export interface SecurityAuditSuppressedFinding extends SecurityAuditFinding {
  reason: string;
}

export interface SecurityAuditSuppression {
  checkId: string;
  reason: string;
  titleIncludes?: string;
  detailIncludes?: string;
}

export interface SecurityAuditFix {
  checkId: string;
  subject: string;
  ok: boolean;
  message: string;
  backup?: string;
}

export interface ConsolidatedAuditRequest {
  profileDir: string;
  projectDir: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  sandbox?: Pick<NativeSandboxCapabilities, 'recommended' | 'reason'>;
  fix?: boolean;
  now?: Date;
}

export interface ConsolidatedAuditReport {
  passed: boolean;
  status: SecurityAuditStatus;
  /** Path asked for. May be missing or relative. */
  profileDir: string;
  projectDir: string;
  /** Canonical directory actually audited, or null when it cannot be read. */
  effectiveProfileDir: string | null;
  effectiveProjectDir: string | null;
  findings: SecurityAuditFinding[];
  suppressedFindings: SecurityAuditSuppressedFinding[];
  summary: Record<SecurityAuditSeverity | 'total', number>;
  fixes: SecurityAuditFix[];
  /** What a passed result does not prove. Always present. */
  limitations: string[];
}

const UNSUPPRESSIBLE = new Set([
  'security.audit.suppressions.active',
  'security.audit.suppression.missing_reason',
  'security.audit.suppression.critical_refused',
  'audit.scope.inaccessible',
]);

const PROFILE_FILES = [
  'config.toml',
  'settings.json',
  'user-settings.json',
  'mcp.json',
  '.env',
  'credentials.json',
];

const PROJECT_FILES = [
  '.codebuddy/settings.json',
  '.codebuddy/settings.local.json',
  '.codebuddy/mcp.json',
  '.codebuddy/config.toml',
];

const SECRET_REF = /\$\{(?:env|file|exec|op):[^}\n]+\}|op:\/\/[A-Za-z0-9][A-Za-z0-9_./-]*/;
const SKILL_CHILD_CAP = 40;
const SKILL_FILE_CAP = 200;
const SKILL_BYTE_CAP = 1024 * 1024;
const CREDENTIAL_DIR_CAP = 500;
const O_NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;

const LIMITATIONS = [
  'Remote MCP hostnames are not resolved. A passed URL is not a guarantee that DNS stays off private networks.',
  'MCP server checks follow the runtime loader: project mcp.json (mcpServers or servers), project settings.json mcpServers, and profile mcp.json. Project settings.local.json and profile settings.json are not runtime MCP server sources.',
  'Skill directories are capped at 40 entries and a bounded file walk. A larger tree fails the audit instead of being reported as clean. A symlink or non-regular file inside a skill is not followed and fails the audit.',
  'exact_failure and same_tool_failure accept 0 as off. idempotent_no_progress does not: 0 keeps the historical default and the minimum is 2. same_tool_failure counts every failure of that tool in the turn, even when the arguments differ. warnings_enabled and hard_stop_enabled can both be turned off by the operator.',
];

const urlGuard = new SSRFGuard({ resolveDns: false });

interface LoadedText {
  text: string | null;
}

interface OpenedFix {
  fd: number;
  mode: number;
  next: number;
  checkId: string;
  subject: string;
}

function finding(
  checkId: string,
  severity: SecurityAuditSeverity,
  title: string,
  detail: string,
  fixable = false,
  subject?: { path: string; root: SecurityAuditRoot },
): SecurityAuditFinding {
  const item: SecurityAuditFinding = {
    checkId,
    severity,
    title,
    detail: redactSecrets(detail),
    fixable,
  };
  if (subject) {
    item.subject = subject.path;
    item.subjectRoot = subject.root;
  }
  return item;
}

export function redactSecrets(value: string): string {
  let text = value;
  for (const pattern of SECRET_PATTERNS) {
    const flags = pattern.pattern.flags.includes('g')
      ? pattern.pattern.flags
      : `${pattern.pattern.flags}g`;
    text = text.replace(new RegExp(pattern.pattern.source, flags), '[redacted]');
  }
  return text;
}

function relativeTo(abs: string, roots: string[]): string {
  const resolved = path.resolve(abs);
  for (let index = 0; index < roots.length; index++) {
    const base = path.resolve(roots[index] ?? '');
    const rel = path.relative(base, resolved);
    if (rel === '') return index === 0 ? '.' : path.basename(resolved);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  }
  return path.basename(resolved);
}

function errno(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: string }).code ?? '')
    : '';
}

function classifyPath(root: string, abs: string): 'ok' | 'missing' | 'symlink' | 'escape' {
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return 'escape';
  const parts = rel === '' ? [] : rel.split(path.sep);
  let cursor = root;
  for (const part of parts) {
    if (!part || part === '.' || part === '..') return 'escape';
    cursor = path.join(cursor, part);
    try {
      if (lstatSync(cursor).isSymbolicLink()) return 'symlink';
    } catch (error) {
      return errno(error) === 'ENOENT' ? 'missing' : 'escape';
    }
  }
  return 'ok';
}

function insideRoot(abs: string, roots: string[]): boolean {
  const resolved = path.resolve(abs);
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

export function inspectAuditRoot(input: string): { ok: true; effective: string } | { ok: false; reason: string } {
  if (!input || input.includes('\0')) return { ok: false, reason: 'empty or invalid path' };
  let stated;
  try {
    stated = lstatSync(input);
  } catch (error) {
    return { ok: false, reason: errno(error) === 'ENOENT' ? 'not found' : 'not accessible' };
  }
  if (!stated.isDirectory() && !stated.isSymbolicLink()) return { ok: false, reason: 'not a directory' };
  let effective: string;
  try {
    effective = realpathSync(input);
  } catch {
    return { ok: false, reason: 'not resolvable' };
  }
  let info;
  try {
    info = lstatSync(effective);
  } catch {
    return { ok: false, reason: 'not accessible' };
  }
  if (!info.isDirectory() || info.isSymbolicLink()) return { ok: false, reason: 'not a directory' };
  try {
    readdirSync(effective);
  } catch {
    return { ok: false, reason: 'not readable' };
  }
  return { ok: true, effective };
}

const CONFIG_TEXT_MAX_BYTES = 512 * 1024;

function pushWrongType(
  out: SecurityAuditFinding[],
  announced: Set<string>,
  abs: string,
  roots: string[],
): void {
  const key = `wrong-type:${path.resolve(abs)}`;
  if (announced.has(key)) return;
  announced.add(key);
  out.push(finding(
    'config.file.wrong_type',
    'high',
    'Expected configuration path is not a regular file',
    `${redactSecrets(relativeTo(abs, roots))} is not a regular file. The audit did not treat it as clean.`,
  ));
}

/** Open with O_NONBLOCK and read only after fstat proves a regular file. */
function readRegularText(abs: string, maxBytes: number): { text: string | null; error: 'unreadable' | 'too-large' | 'binary' | null } {
  const flags = constants.O_RDONLY | constants.O_NONBLOCK | O_NOFOLLOW;
  let fd: number;
  try {
    fd = openSync(abs, flags);
  } catch {
    return { text: null, error: 'unreadable' };
  }
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile()) return { text: null, error: 'unreadable' };
    if (opened.size > maxBytes) return { text: null, error: 'too-large' };
    const buf = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < opened.size) {
      const n = readSync(fd, buf, offset, opened.size - offset, offset);
      if (n === 0) break;
      offset += n;
    }
    const text = buf.subarray(0, offset).toString('utf8');
    if (text.includes('\u0000')) return { text: null, error: 'binary' };
    return { text, error: null };
  } catch {
    return { text: null, error: 'unreadable' };
  } finally {
    closeSync(fd);
  }
}

function readText(abs: string): { text: string | null; skip: string | null; error: string | null } {
  let info;
  try {
    info = lstatSync(abs);
  } catch (error) {
    if (errno(error) === 'ENOENT') return { text: null, skip: null, error: null };
    return { text: null, skip: null, error: 'unreadable' };
  }
  if (info.isSymbolicLink()) return { text: null, skip: 'symlink', error: null };
  if (!info.isFile()) return { text: null, skip: 'wrong-type', error: null };
  if (info.size > CONFIG_TEXT_MAX_BYTES) return { text: null, skip: 'too-large', error: null };
  const loaded = readRegularText(abs, CONFIG_TEXT_MAX_BYTES);
  if (loaded.error === 'too-large' || loaded.error === 'binary') {
    return { text: null, skip: loaded.error, error: null };
  }
  if (loaded.error) return { text: null, skip: null, error: 'unreadable' };
  return { text: loaded.text, skip: null, error: null };
}

function loadConfigText(
  abs: string,
  roots: string[],
  out: SecurityAuditFinding[],
  announced: Set<string>,
): LoadedText {
  const kinds = roots.map((root) => classifyPath(root, abs));
  const kind = kinds.includes('ok')
    ? 'ok'
    : kinds.includes('missing')
      ? 'missing'
      : kinds.includes('symlink')
        ? 'symlink'
        : 'escape';
  if (kind === 'symlink') {
    const key = `symlink:${path.resolve(abs)}`;
    if (!announced.has(key)) {
      announced.add(key);
      out.push(finding(
        'config.file.skipped',
        'high',
        'Configuration file not scanned',
        `${redactSecrets(relativeTo(abs, roots))} was skipped (symlink). The audit did not treat it as clean.`,
      ));
    }
    return { text: null };
  }
  if (kind === 'missing' || kind === 'escape') return { text: null };
  const loaded = readText(abs);
  const label = redactSecrets(relativeTo(abs, roots));
  if (loaded.error) {
    const key = `error:${path.resolve(abs)}`;
    if (!announced.has(key)) {
      announced.add(key);
      out.push(finding(
        'config.file.unreadable',
        'high',
        'Configuration file could not be read',
        `${label} could not be read. The audit did not treat it as empty.`,
      ));
    }
    return { text: null };
  }
  if (loaded.skip === 'wrong-type') {
    pushWrongType(out, announced, abs, roots);
    return { text: null };
  }
  if (loaded.skip) {
    const key = `skip:${path.resolve(abs)}:${loaded.skip}`;
    if (!announced.has(key)) {
      announced.add(key);
      out.push(finding(
        'config.file.skipped',
        'high',
        'Configuration file not scanned',
        `${label} was skipped (${loaded.skip}). The audit did not treat it as clean.`,
      ));
    }
    return { text: null };
  }
  return { text: loaded.text };
}

function modeBits(abs: string): number | null {
  try {
    const info = lstatSync(abs);
    if (info.isSymbolicLink()) return null;
    return info.mode & 0o777;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseSecurityAuditSuppressions(value: unknown): {
  accepted: SecurityAuditSuppression[];
  rejected: SecurityAuditFinding[];
} {
  const accepted: SecurityAuditSuppression[] = [];
  const rejected: SecurityAuditFinding[] = [];
  if (value === undefined) return { accepted, rejected };
  if (!Array.isArray(value)) {
    rejected.push(finding(
      'security.audit.suppression.missing_reason',
      'medium',
      'Suppression list is not an array',
      'security.audit.suppressions must be a list of checkId and reason.',
    ));
    return { accepted, rejected };
  }
  value.forEach((item, index) => {
    const record = asRecord(item);
    const checkId = typeof record?.checkId === 'string' ? record.checkId.trim() : '';
    const reason = typeof record?.reason === 'string' ? record.reason.trim() : '';
    if (!checkId || !reason) {
      rejected.push(finding(
        'security.audit.suppression.missing_reason',
        'medium',
        'Suppression ignored',
        `Entry ${index + 1} needs both a checkId and a non-empty reason, so it hides nothing.`,
      ));
      return;
    }
    if (UNSUPPRESSIBLE.has(checkId)) return;
    const suppression: SecurityAuditSuppression = { checkId, reason: redactSecrets(reason) };
    const titleIncludes = typeof record?.titleIncludes === 'string' ? record.titleIncludes.trim() : '';
    const detailIncludes = typeof record?.detailIncludes === 'string' ? record.detailIncludes.trim() : '';
    if (titleIncludes) suppression.titleIncludes = titleIncludes;
    if (detailIncludes) suppression.detailIncludes = detailIncludes;
    accepted.push(suppression);
  });
  return { accepted, rejected };
}

function scanPlaintext(
  abs: string,
  roots: string[],
  out: SecurityAuditFinding[],
  announced: Set<string>,
): void {
  const loaded = loadConfigText(abs, roots, out, announced);
  const label = redactSecrets(relativeTo(abs, roots));
  if (loaded.text === null) return;
  const seen = new Set<string>();
  const lines = loaded.text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (SECRET_REF.test(line) && !SECRET_PATTERNS.some((pattern) => {
      const flags = pattern.pattern.flags.replace('g', '');
      const outside = line.replace(SECRET_REF, '');
      return new RegExp(pattern.pattern.source, flags).test(outside);
    })) {
      continue;
    }
    for (const pattern of SECRET_PATTERNS) {
      const flags = pattern.pattern.flags.replace('g', '');
      if (!new RegExp(pattern.pattern.source, flags).test(line)) continue;
      const key = `${pattern.type}:${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(finding(
        'config.plaintext_secret',
        pattern.severity,
        'Plaintext secret in configuration',
        `${label}:${index + 1} matches ${pattern.type}. Replace it with a secret reference. The value is not repeated here.`,
      ));
    }
  }
}

function serverRecords(parsed: unknown): Array<{ name: string; body: Record<string, unknown> }> {
  const root = asRecord(parsed);
  if (!root) return [];
  const map = asRecord(root.mcpServers) ?? asRecord(root.servers);
  if (map) {
    return Object.entries(map).flatMap(([name, body]) => {
      const record = asRecord(body);
      return record ? [{ name, body: record }] : [];
    });
  }
  if (Array.isArray(root.servers)) {
    return root.servers.flatMap((body, index) => {
      const record = asRecord(body);
      if (!record) return [];
      const name = typeof record.name === 'string' ? record.name : `server-${index + 1}`;
      return [{ name, body: record }];
    });
  }
  return [];
}

function remoteUrl(body: Record<string, unknown>): string | null {
  if (typeof body.url === 'string') return body.url;
  const transport = asRecord(body.transport);
  if (transport && typeof transport.url === 'string') return transport.url;
  return null;
}

function stdioInherits(body: Record<string, unknown>): boolean {
  const transport = asRecord(body.transport);
  const inherit = transport && 'inheritEnv' in transport ? transport.inheritEnv : body.inheritEnv;
  if (inherit === false) return false;
  const type = typeof body.type === 'string'
    ? body.type
    : typeof transport?.type === 'string'
      ? transport.type
      : '';
  const command = typeof body.command === 'string'
    ? body.command
    : typeof transport?.command === 'string'
      ? transport.command
      : '';
  return type === 'stdio' || (command.length > 0 && !remoteUrl(body));
}

function readStructured(text: string, kind: 'json' | 'toml'): { value: unknown; ok: boolean } {
  try {
    return { value: kind === 'json' ? JSON.parse(text) as unknown : TOML.parse(text), ok: true };
  } catch {
    return { value: undefined, ok: false };
  }
}

function scanMcp(
  abs: string,
  roots: string[],
  out: SecurityAuditFinding[],
  announced: Set<string>,
  projectSettings: boolean,
): void {
  const loaded = loadConfigText(abs, roots, out, announced);
  if (loaded.text === null) return;
  const parsed = readStructured(loaded.text, abs.endsWith('.toml') ? 'toml' : 'json');
  if (!parsed.ok) {
    const key = `parse:${path.resolve(abs)}`;
    if (!announced.has(key)) {
      announced.add(key);
      out.push(finding(
        'config.file.unparseable',
        'high',
        'Configuration file could not be parsed',
        `${redactSecrets(relativeTo(abs, roots))} is not valid ${abs.endsWith('.toml') ? 'TOML' : 'JSON'}. It was not treated as having no servers.`,
      ));
    }
    return;
  }
  const root = asRecord(parsed.value);
  if (projectSettings && root && asRecord(root.servers) && !asRecord(root.mcpServers)) {
    out.push(finding(
      'mcp.config.servers_key_ignored',
      'medium',
      'MCP servers key is not read',
      `${redactSecrets(relativeTo(abs, roots))} defines servers but runtime reads mcpServers only.`,
    ));
  }
  for (const server of serverRecords(parsed.value)) {
    if (server.body.enabled === false) continue;
    const label = redactSecrets(`${relativeTo(abs, roots)}:${server.name}`);
    const url = remoteUrl(server.body);
    if (url) {
      let unsafe = '';
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.username || parsedUrl.password) unsafe = 'credentials in the URL';
        else if (parsedUrl.search || parsedUrl.hash) unsafe = 'query or fragment in the URL';
        else {
          const check = urlGuard.isSafeUrlSync(url);
          if (!check.safe) unsafe = check.reason ?? 'refused by the request guard';
        }
      } catch {
        unsafe = 'URL could not be parsed';
      }
      if (unsafe) {
        out.push(finding(
          'mcp.remote.unsafe_url',
          'high',
          'Remote MCP URL is not safe',
          `${label} was refused (${unsafe}).`,
        ));
      }
    }
    if (stdioInherits(server.body)) {
      out.push(finding(
        'mcp.stdio.inherits_environment',
        'medium',
        'MCP stdio server inherits the process environment',
        `${label} does not set inheritEnv to false, so the server receives the process environment.`,
      ));
    }
  }
}

function collectSuppressions(
  profileDir: string,
  projectDir: string,
  out: SecurityAuditFinding[],
  announced: Set<string>,
): { accepted: SecurityAuditSuppression[]; rejected: SecurityAuditFinding[] } {
  const accepted: SecurityAuditSuppression[] = [];
  const rejected: SecurityAuditFinding[] = [];
  const roots = [profileDir, projectDir];
  const take = (value: unknown) => {
    const parsed = parseSecurityAuditSuppressions(value);
    accepted.push(...parsed.accepted);
    rejected.push(...parsed.rejected);
  };
  const readParsed = (abs: string, kind: 'json' | 'toml'): unknown => {
    const loaded = loadConfigText(abs, roots, out, announced);
    if (loaded.text === null) return undefined;
    const parsed = readStructured(loaded.text, kind);
    if (!parsed.ok) {
      const key = `parse:${path.resolve(abs)}`;
      if (!announced.has(key)) {
        announced.add(key);
        out.push(finding(
          'config.file.unparseable',
          'high',
          'Configuration file could not be parsed',
          `${redactSecrets(relativeTo(abs, roots))} is not valid ${kind === 'toml' ? 'TOML' : 'JSON'}. Suppressions in it were not applied.`,
        ));
      }
      return undefined;
    }
    return parsed.value;
  };
  const configPath = path.join(profileDir, 'config.toml');
  const parsedConfig = asRecord(readParsed(configPath, 'toml'));
  const security = asRecord(parsedConfig?.security);
  const audit = asRecord(security?.audit);
  if (audit && 'suppressions' in audit) take(audit.suppressions);
  const guard = asRecord(parsedConfig?.tool_loop_guardrails);
  if (guard && guard.warnings_enabled === false && guard.hard_stop_enabled === false) {
    out.push(finding(
      'agent.loop_guard.disabled',
      'high',
      'Tool loop guard is switched off',
      'warnings_enabled and hard_stop_enabled are both false. Identical calls and failure counters will not warn or stop. This is an operator choice, not a clean profile.',
    ));
  }
  for (const rel of ['settings.json', 'user-settings.json', '.codebuddy/settings.json', '.codebuddy/settings.local.json']) {
    const root = rel.startsWith('.codebuddy/') ? projectDir : profileDir;
    const parsed = asRecord(readParsed(path.join(root, rel), 'json'));
    const fileSecurity = asRecord(parsed?.security);
    const fileAudit = asRecord(fileSecurity?.audit);
    if (fileAudit && 'suppressions' in fileAudit) take(fileAudit.suppressions);
  }
  return { accepted, rejected };
}

function permissionFindings(
  request: ConsolidatedAuditRequest,
  announced: Set<string>,
): SecurityAuditFinding[] {
  if ((request.platform ?? process.platform) === 'win32') return [];
  const out: SecurityAuditFinding[] = [];
  const seen = new Set<string>();
  const symlinkSeen = new Set<string>();
  const consider = (abs: string, kind: 'dir' | 'file', rootName: SecurityAuditRoot, base: string) => {
    const gate = classifyPath(base, abs);
    const label = redactSecrets(path.relative(base, abs) || '.');
    if (gate === 'symlink') {
      const key = path.resolve(abs);
      if (!symlinkSeen.has(key)) {
        symlinkSeen.add(key);
        out.push(finding(
          'audit.path.symlink',
          'high',
          'Path contains a symlink',
          `${label} was not followed, so a target outside this root was not changed or treated as clean.`,
        ));
      }
      return;
    }
    if (gate !== 'ok' || seen.has(path.resolve(abs))) return;
    seen.add(path.resolve(abs));
    if (kind === 'file') {
      let listed;
      try {
        listed = lstatSync(abs);
      } catch {
        return;
      }
      if (!listed.isSymbolicLink() && !listed.isFile()) {
        pushWrongType(out, announced, abs, [base]);
        return;
      }
    }
    const mode = modeBits(abs);
    if (mode === null) return;
    const subject = { path: label, root: rootName };
    if ((mode & 0o700) === 0) {
      out.push(finding(
        'profile.owner.no_access',
        'info',
        'Owner has no permission bits',
        `${label} mode ${mode.toString(8)} gives the owner no access. A fix will not add owner bits.`,
        false,
        subject,
      ));
    }
    if (kind === 'dir' && (mode & 0o002) !== 0) {
      out.push(finding(
        'profile.directory.world_writable',
        'high',
        'Directory is world-writable',
        `${label} mode ${mode.toString(8)} allows every local account to write. The fix removes other-write only.`,
        true,
        subject,
      ));
    }
    if (kind === 'file' && (mode & 0o077) !== 0) {
      out.push(finding(
        'profile.file.loose_permissions',
        'high',
        'Configuration file is group or world accessible',
        `${label} mode ${mode.toString(8)} is broader than owner-only. The fix removes group and world bits and does not add owner bits.`,
        true,
        subject,
      ));
    }
  };
  consider(request.profileDir, 'dir', 'profile', request.profileDir);
  consider(path.join(request.profileDir, 'sessions'), 'dir', 'profile', request.profileDir);
  consider(path.join(request.projectDir, '.codebuddy'), 'dir', 'project', request.projectDir);
  for (const rel of PROFILE_FILES) consider(path.join(request.profileDir, rel), 'file', 'profile', request.profileDir);
  for (const rel of PROJECT_FILES) consider(path.join(request.projectDir, rel), 'file', 'project', request.projectDir);
  let childNames: string[] = [];
  try {
    childNames = readdirSync(request.profileDir);
  } catch {
    childNames = [];
  }
  const childDirs = childNames.filter((name) => {
    if (!name || name.includes('\0') || name === '.' || name === '..') return false;
    return classifyPath(request.profileDir, path.join(request.profileDir, name)) === 'ok'
      && (() => {
        try {
          return lstatSync(path.join(request.profileDir, name)).isDirectory();
        } catch {
          return false;
        }
      })();
  });
  if (childDirs.length > CREDENTIAL_DIR_CAP) {
    out.push(finding(
      'profile.credentials.truncated',
      'high',
      'Profile credential walk stopped',
      `${childDirs.length} child directories; credentials.json past the first ${CREDENTIAL_DIR_CAP} was not checked.`,
    ));
  }
  for (const name of childDirs.slice(0, CREDENTIAL_DIR_CAP)) {
    consider(path.join(request.profileDir, name, 'credentials.json'), 'file', 'profile', request.profileDir);
  }
  return out;
}

function measureSkill(root: string): { overflow: boolean; refused: 'symlink' | 'special' | null } {
  let files = 0;
  let bytes = 0;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return { overflow: true, refused: null };
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      let info;
      try {
        info = lstatSync(abs);
      } catch {
        return { overflow: true, refused: null };
      }
      // Every level of the walk refuses a link or a special file. Neither is opened.
      if (info.isSymbolicLink()) return { overflow: false, refused: 'symlink' };
      if (info.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!info.isFile()) return { overflow: false, refused: 'special' };
      files += 1;
      bytes += info.size;
      if (files > SKILL_FILE_CAP || bytes > SKILL_BYTE_CAP) return { overflow: true, refused: null };
    }
  }
  return { overflow: false, refused: null };
}

function skillFindings(request: ConsolidatedAuditRequest): SecurityAuditFinding[] {
  const out: SecurityAuditFinding[] = [];
  const parents = [
    { abs: path.join(request.profileDir, 'skills'), base: request.profileDir },
    { abs: path.join(request.projectDir, '.codebuddy', 'skills'), base: request.projectDir },
  ];
  for (const parent of parents) {
    if (classifyPath(parent.base, parent.abs) === 'symlink') {
      out.push(finding(
        'audit.path.symlink',
        'high',
        'Path contains a symlink',
        `${redactSecrets(path.relative(parent.base, parent.abs))} was not followed.`,
      ));
      continue;
    }
    if (classifyPath(parent.base, parent.abs) !== 'ok') continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(parent.abs);
    } catch {
      out.push(finding(
        'skills.scan.unreadable',
        'high',
        'Skill directory could not be listed',
        `${redactSecrets(path.relative(parent.base, parent.abs))} could not be listed. It was not treated as empty.`,
      ));
      continue;
    }
    if (entries.length > SKILL_CHILD_CAP) {
      out.push(finding(
        'skills.scan.truncated',
        'high',
        'Skill directory was not fully listed',
        `${redactSecrets(path.relative(parent.base, parent.abs))} has ${entries.length} entries; ${entries.length - SKILL_CHILD_CAP} were not scanned.`,
      ));
    }
    for (const name of entries.slice(0, SKILL_CHILD_CAP)) {
      const abs = path.join(parent.abs, name);
      const gate = classifyPath(parent.base, abs);
      const label = redactSecrets(path.relative(parent.base, abs));
      if (gate === 'symlink') {
        out.push(finding(
          'skills.path.symlink',
          'medium',
          'Skill path is a symlink',
          `${label} was not followed.`,
        ));
        continue;
      }
      if (gate !== 'ok') continue;
      let info;
      try {
        info = lstatSync(abs);
      } catch {
        continue;
      }
      if (!info.isDirectory() && name.toLowerCase() !== 'skill.md') continue;
      const measured = measureSkill(abs);
      if (measured.refused) {
        out.push(finding(
          measured.refused === 'symlink' ? 'skills.tree.symlink' : 'skills.tree.special',
          'high',
          measured.refused === 'symlink' ? 'Skill tree contains a symlink' : 'Skill tree contains a special file',
          `${label} contains a ${measured.refused === 'symlink' ? 'symbolic link' : 'non-regular file'} that was not followed. The audit did not treat it as clean.`,
        ));
        continue;
      }
      if (measured.overflow) {
        out.push(finding(
          'skills.scan.bounded',
          'high',
          'Skill tree exceeds the scan bound',
          `${label} has more than ${SKILL_FILE_CAP} files or ${SKILL_BYTE_CAP} bytes. It was not reported as clean.`,
        ));
        continue;
      }
      let report;
      try {
        report = scanSkillFirewall(abs);
      } catch {
        out.push(finding(
          'skills.scan.unreadable',
          'high',
          'Skill could not be scanned',
          `${label} could not be scanned. It was not treated as allowed.`,
        ));
        continue;
      }
      if (report.verdict === 'quarantine') {
        out.push(finding(
          'skills.firewall.quarantine',
          'critical',
          'Skill firewall quarantines this skill',
          `${label}: ${report.summary}`,
        ));
      } else if (report.verdict === 'review') {
        out.push(finding(
          'skills.firewall.review',
          'medium',
          'Skill firewall asks for review',
          `${label}: ${report.summary}`,
        ));
      }
    }
  }
  return out;
}

function otherFindings(request: ConsolidatedAuditRequest, announced: Set<string>): SecurityAuditFinding[] {
  const roots = [request.profileDir, request.projectDir];
  const out: SecurityAuditFinding[] = [];
  for (const rel of PROFILE_FILES) scanPlaintext(path.join(request.profileDir, rel), roots, out, announced);
  for (const rel of PROJECT_FILES) scanPlaintext(path.join(request.projectDir, rel), roots, out, announced);
  scanMcp(path.join(request.profileDir, 'mcp.json'), roots, out, announced, false);
  scanMcp(path.join(request.projectDir, '.codebuddy', 'mcp.json'), roots, out, announced, false);
  scanMcp(path.join(request.projectDir, '.codebuddy', 'settings.json'), roots, out, announced, true);
  const env = request.env ?? process.env;
  if (isNativeSandboxEnabled(env)) {
    const recommended = request.sandbox?.recommended ?? 'none';
    if (recommended === 'none') {
      out.push(finding(
        'sandbox.native.unavailable',
        'high',
        'Native sandbox was requested but no backend is usable',
        request.sandbox?.reason || 'No bubblewrap, Landlock, or seatbelt backend is usable.',
      ));
    }
  }
  return out;
}

function summarize(items: SecurityAuditFinding[]): ConsolidatedAuditReport['summary'] {
  const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: items.length };
  for (const item of items) summary[item.severity] += 1;
  return summary;
}

function restrictMode(mode: number, checkId: string): number | null {
  const next = checkId === 'profile.directory.world_writable' ? (mode & ~0o002) : (mode & ~0o077);
  if ((next & ~mode) !== 0 || next === mode) return null;
  return next;
}

/**
 * Prove that an opened descriptor is still the file named by `abs` inside a root.
 *
 * Every platform: the descriptor and the path must be the same inode, and the
 * path must still be a symlink-free child of a root. Linux additionally reads
 * `/proc/self/fd`. macOS has no `/proc`: relying on it alone refused every fix.
 */
function fdInside(fd: number, abs: string, roots: string[], platform: NodeJS.Platform): boolean {
  try {
    const opened = fstatSync(fd);
    const named = lstatSync(abs);
    if (named.isSymbolicLink() || opened.dev !== named.dev || opened.ino !== named.ino) return false;
  } catch {
    return false;
  }
  if (!roots.some((root) => (abs === root || insideRoot(abs, [root])) && classifyPath(root, abs) === 'ok')) {
    return false;
  }
  if (platform !== 'linux') return true;
  try {
    const via = realpathSync(`/proc/self/fd/${fd}`);
    return insideRoot(via, roots) || roots.some((root) => via === root);
  } catch {
    return false;
  }
}

function backupReady(
  roots: string[],
  stamp: string,
  body: string,
  platform: NodeJS.Platform,
): { ok: true; relative: string } | { ok: false; message: string } {
  if (!/^[0-9TZt-]+$/.test(stamp)) return { ok: false, message: 'backup name was refused' };
  let skipped = 'backup directory is not writable';
  for (const profile of roots) {
    const attempt = backupInRoot(profile, stamp, body, platform);
    if (attempt.ok) {
      return { ok: true, relative: path.relative(profile, attempt.manifestPath) };
    }
    if (attempt.kind === 'refuse') return { ok: false, message: attempt.message };
    skipped = attempt.message;
  }
  return { ok: false, message: skipped };
}

function backupInRoot(
  profile: string,
  stamp: string,
  body: string,
  platform: NodeJS.Platform,
): { ok: true; manifestPath: string } | { ok: false; kind: 'skip' | 'refuse'; message: string } {
  const backups = path.join(profile, 'security-audit-backups');
  try {
    const existing = lstatSync(backups);
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      return { ok: false, kind: 'refuse', message: 'backup directory is not a real directory' };
    }
  } catch (error) {
    if (errno(error) !== 'ENOENT') return { ok: false, kind: 'refuse', message: 'backup directory is not accessible' };
    try {
      mkdirSync(backups, { mode: 0o700 });
    } catch (mkdirError) {
      const code = errno(mkdirError);
      const message = mkdirError instanceof Error ? mkdirError.message : String(mkdirError);
      if (code === 'EACCES' || code === 'EPERM') return { ok: false, kind: 'skip', message };
      return { ok: false, kind: 'refuse', message };
    }
  }
  if (classifyPath(profile, backups) !== 'ok') {
    return { ok: false, kind: 'refuse', message: 'backup directory is not inside the profile' };
  }
  let backupsReal: string;
  try {
    backupsReal = realpathSync(backups);
  } catch {
    return { ok: false, kind: 'refuse', message: 'backup directory is not resolvable' };
  }
  if (!insideRoot(backupsReal, [profile]) && backupsReal !== profile) {
    return { ok: false, kind: 'refuse', message: 'backup directory escapes the profile' };
  }
  const dir = path.join(backupsReal, stamp);
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    return {
      ok: false,
      kind: 'refuse',
      message: `backup directory already exists or could not be created: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (classifyPath(profile, dir) !== 'ok') {
    return { ok: false, kind: 'refuse', message: 'backup directory is not a real directory inside the profile' };
  }
  const manifestPath = path.join(dir, 'manifest.json');
  let fd: number;
  try {
    fd = openSync(manifestPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | O_NOFOLLOW, 0o600);
  } catch (error) {
    return {
      ok: false,
      kind: 'refuse',
      message: `manifest was not created exclusively: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  try {
    if (!fdInside(fd, manifestPath, [profile], platform)) {
      return { ok: false, kind: 'refuse', message: 'manifest would have been written outside the profile' };
    }
    writeSync(fd, body);
  } catch (error) {
    return { ok: false, kind: 'refuse', message: error instanceof Error ? error.message : String(error) };
  } finally {
    closeSync(fd);
  }
  return { ok: true, manifestPath };
}

function applyFixes(request: ConsolidatedAuditRequest, items: SecurityAuditFinding[]): SecurityAuditFix[] {
  const targets = items.filter((item) => item.fixable && item.subject && item.subjectRoot && (
    item.checkId === 'profile.directory.world_writable' || item.checkId === 'profile.file.loose_permissions'
  ));
  if (targets.length === 0) return [];
  const roots = { profile: request.profileDir, project: request.projectDir };
  const platform = request.platform ?? process.platform;
  const opened: OpenedFix[] = [];
  const refused: SecurityAuditFix[] = [];
  for (const item of targets) {
    const subject = item.subject ?? '';
    const base = roots[item.subjectRoot ?? 'profile'];
    if (!subject || subject.includes('\0') || path.isAbsolute(subject)) {
      refused.push({ checkId: item.checkId, subject, ok: false, message: 'path was refused' });
      continue;
    }
    const abs = subject === '.' ? base : path.resolve(base, subject);
    if (classifyPath(base, abs) !== 'ok' || !insideRoot(abs, [base])) {
      refused.push({ checkId: item.checkId, subject, ok: false, message: 'path is outside the audited root or is a symlink' });
      continue;
    }
    const mode = modeBits(abs);
    const next = mode === null ? null : restrictMode(mode, item.checkId);
    if (mode === null || next === null) continue;
    let fd: number;
    try {
      const info = lstatSync(abs);
      if (info.isSymbolicLink()) {
        refused.push({ checkId: item.checkId, subject, ok: false, message: 'symlink was not followed' });
        continue;
      }
      const flags = constants.O_RDONLY | O_NOFOLLOW | (info.isDirectory() ? constants.O_DIRECTORY : 0);
      fd = openSync(abs, flags);
    } catch (error) {
      refused.push({
        checkId: item.checkId,
        subject,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!fdInside(fd, abs, [request.profileDir, request.projectDir], platform)) {
      closeSync(fd);
      refused.push({ checkId: item.checkId, subject, ok: false, message: 'open file is outside the audited roots' });
      continue;
    }
    opened.push({ fd, mode, next, checkId: item.checkId, subject });
  }
  if (opened.length === 0) return refused;
  const stamp = (request.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const manifest = {
    version: 1,
    entries: opened.map((entry) => ({ path: entry.subject, modeBefore: entry.mode.toString(8) })),
  };
  const backup = backupReady(
    [request.profileDir],
    stamp,
    `${JSON.stringify(manifest, null, 2)}\n`,
    platform,
  );
  if (!backup.ok) {
    for (const entry of opened) closeSync(entry.fd);
    return [
      ...refused,
      ...opened.map((entry) => ({
        checkId: entry.checkId,
        subject: entry.subject,
        ok: false,
        message: `backup not written, permissions left unchanged: ${backup.message}`,
      })),
    ];
  }
  const fixes: SecurityAuditFix[] = [...refused];
  for (const entry of opened) {
    try {
      const current = modeBitsFromFd(entry.fd);
      const narrowed = current === null ? null : restrictMode(current, entry.checkId);
      if (narrowed === null || (narrowed & ~entry.mode) !== 0) {
        fixes.push({
          checkId: entry.checkId,
          subject: entry.subject,
          ok: false,
          message: 'mode changed before the fix; permissions left unchanged',
          backup: backup.relative,
        });
        continue;
      }
      fchmodSync(entry.fd, narrowed);
      fixes.push({
        checkId: entry.checkId,
        subject: entry.subject,
        ok: true,
        message: `mode ${entry.mode.toString(8)} -> ${narrowed.toString(8)}`,
        backup: backup.relative,
      });
    } catch (error) {
      fixes.push({
        checkId: entry.checkId,
        subject: entry.subject,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        backup: backup.relative,
      });
    } finally {
      closeSync(entry.fd);
    }
  }
  return fixes;
}

function modeBitsFromFd(fd: number): number | null {
  try {
    return fstatSync(fd).mode & 0o777;
  } catch {
    return null;
  }
}

function scopeFinding(which: 'profile' | 'project', requested: string, reason: string): SecurityAuditFinding {
  return finding(
    'audit.scope.inaccessible',
    'critical',
    'Audit scope is not accessible',
    `${which} (${redactSecrets(requested)}) is ${reason}. The audit did not treat that root as empty.`,
  );
}

export function runConsolidatedSecurityAudit(request: ConsolidatedAuditRequest): ConsolidatedAuditReport {
  const profile = inspectAuditRoot(request.profileDir);
  const project = inspectAuditRoot(request.projectDir);
  const base: Pick<
    ConsolidatedAuditReport,
    'profileDir' | 'projectDir' | 'effectiveProfileDir' | 'effectiveProjectDir' | 'limitations'
  > = {
    profileDir: request.profileDir,
    projectDir: request.projectDir,
    effectiveProfileDir: profile.ok ? profile.effective : null,
    effectiveProjectDir: project.ok ? project.effective : null,
    limitations: [...LIMITATIONS],
  };
  const scope: SecurityAuditFinding[] = [];
  if (!profile.ok) scope.push(scopeFinding('profile', request.profileDir, profile.reason));
  if (!project.ok) scope.push(scopeFinding('project', request.projectDir, project.reason));
  if (!profile.ok || !project.ok) {
    const summary = summarize(scope);
    return redactReport({
      ...base,
      passed: false,
      status: 'failed',
      findings: scope,
      suppressedFindings: [],
      summary,
      fixes: [],
    });
  }
  const scoped: ConsolidatedAuditRequest = {
    ...request,
    profileDir: profile.effective,
    projectDir: project.effective,
  };
  const announced = new Set<string>();
  const collected = [
    ...permissionFindings(scoped, announced),
    ...skillFindings(scoped),
    ...otherFindings(scoped, announced),
  ];
  const suppressions = collectSuppressions(profile.effective, project.effective, collected, announced);
  collected.push(...suppressions.rejected);
  const active: SecurityAuditFinding[] = [];
  const suppressedFindings: SecurityAuditSuppressedFinding[] = [];
  for (const item of collected) {
    const match = suppressions.accepted.find((entry) => entry.checkId === item.checkId
      && (entry.titleIncludes || entry.detailIncludes || entry.reason)
      && (UNSUPPRESSIBLE.has(item.checkId) ? false : entry.checkId === item.checkId)
      && (!entry.titleIncludes || item.title.toLowerCase().includes(entry.titleIncludes.toLowerCase()))
      && (!entry.detailIncludes || item.detail.toLowerCase().includes(entry.detailIncludes.toLowerCase())));
    if (!match || UNSUPPRESSIBLE.has(item.checkId)) {
      active.push(item);
      continue;
    }
    if (item.severity === 'critical') {
      active.push(item);
      active.push(finding(
        'security.audit.suppression.critical_refused',
        'high',
        'Critical finding cannot be suppressed',
        `${item.checkId} stays visible (${item.severity}). Reason offered: ${match.reason}`,
      ));
      continue;
    }
    suppressedFindings.push({ ...item, reason: match.reason });
  }
  if (suppressions.accepted.length > 0) {
    active.push(finding(
      'security.audit.suppressions.active',
      'info',
      'Audit suppressions are active',
      `${suppressions.accepted.length} accepted suppression(s). Hidden non-critical findings stay in suppressedFindings with their reason. Critical findings stay visible.`,
    ));
  }
  const fixes = request.fix ? applyFixes(scoped, active) : [];
  const fixedSubjects = new Set(fixes.filter((item) => item.ok).map((item) => item.subject));
  const findings = active.filter((item) => {
    if (!item.fixable || !item.subject || !fixedSubjects.size) return true;
    return !fixedSubjects.has(item.subject);
  });
  const summary = summarize(findings);
  const passed = summary.critical === 0 && summary.high === 0 && fixes.every((item) => item.ok);
  const status: SecurityAuditStatus = !passed
    ? 'failed'
    : suppressedFindings.length > 0
      ? 'passed_with_suppressions'
      : 'passed';
  return redactReport({
    ...base,
    effectiveProfileDir: profile.effective,
    effectiveProjectDir: project.effective,
    passed,
    status,
    findings,
    suppressedFindings,
    summary,
    fixes,
  });
}

function redactPath(value: string | null): string | null {
  return value === null ? null : redactSecrets(value);
}

function redactFinding(item: SecurityAuditFinding): SecurityAuditFinding {
  const next: SecurityAuditFinding = { ...item, detail: redactSecrets(item.detail) };
  if (item.subject !== undefined) next.subject = redactSecrets(item.subject);
  return next;
}

function redactReport(report: ConsolidatedAuditReport): ConsolidatedAuditReport {
  return {
    ...report,
    profileDir: redactSecrets(report.profileDir),
    projectDir: redactSecrets(report.projectDir),
    effectiveProfileDir: redactPath(report.effectiveProfileDir),
    effectiveProjectDir: redactPath(report.effectiveProjectDir),
    findings: report.findings.map(redactFinding),
    suppressedFindings: report.suppressedFindings.map((item) => ({
      ...redactFinding(item),
      reason: redactSecrets(item.reason),
    })),
    fixes: report.fixes.map((item) => {
      const next: SecurityAuditFix = {
        ...item,
        subject: redactSecrets(item.subject),
        message: redactSecrets(item.message),
      };
      if (item.backup !== undefined) next.backup = redactSecrets(item.backup);
      return next;
    }),
  };
}
