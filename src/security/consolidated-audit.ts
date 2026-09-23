/**
 * Consolidated security audit for `buddy security audit`.
 *
 * Aggregates checks that already exist elsewhere. It does not start a second
 * scanner, does not resolve DNS, and does not rewrite secret values.
 *
 * Inventory (the check that already existed, then the stable id used here):
 * - scanSkillFirewall — src/security/skill-scanner.ts:367 → skills.firewall.*
 * - checkProfilePermissions — src/doctor/index.ts:422 → profile.directory.world_writable
 * - isNativeSandboxEnabled / detectNativeSandboxCapabilities — src/security/native-sandbox.ts:91 and :234
 * - SECRET_PATTERNS — src/security/secret-patterns.ts:29 → config.plaintext_secret
 * - SSRFGuard.isSafeUrlSync — src/security/ssrf-guard.ts:347 → mcp.remote.unsafe_url
 * - stdio inheritEnv — src/mcp/transports.ts:46 → mcp.stdio.inherits_environment
 * - ignored "servers" key — src/mcp/config.ts:171 → mcp.config.servers_key_ignored
 */

import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import TOML from '@iarna/toml';
import { isNativeSandboxEnabled, type NativeSandboxCapabilities } from './native-sandbox.js';
import { SECRET_PATTERNS } from './secret-patterns.js';
import { scanSkillFirewall } from './skill-scanner.js';
import { SSRFGuard } from './ssrf-guard.js';

export type SecurityAuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SecurityAuditFinding {
  checkId: string;
  severity: SecurityAuditSeverity;
  title: string;
  detail: string;
  fixable: boolean;
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
  findings: SecurityAuditFinding[];
  suppressedFindings: SecurityAuditFinding[];
  summary: Record<SecurityAuditSeverity | 'total', number>;
  fixes: SecurityAuditFix[];
}

const UNSUPPRESSIBLE = new Set([
  'security.audit.suppressions.active',
  'security.audit.suppression.missing_reason',
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

const urlGuard = new SSRFGuard({ resolveDns: false });

function finding(
  checkId: string,
  severity: SecurityAuditSeverity,
  title: string,
  detail: string,
  fixable = false,
): SecurityAuditFinding {
  return { checkId, severity, title, detail, fixable };
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

function insideRoot(abs: string, roots: string[]): boolean {
  const resolved = path.resolve(abs);
  return roots.some((root) => {
    const base = path.resolve(root);
    return resolved === base || resolved.startsWith(base + path.sep);
  });
}

function readText(abs: string): { text: string | null; skip: string | null } {
  let info;
  try {
    info = lstatSync(abs);
  } catch {
    return { text: null, skip: null };
  }
  if (info.isSymbolicLink()) return { text: null, skip: 'symlink' };
  if (!info.isFile()) return { text: null, skip: null };
  if (info.size > 512 * 1024) return { text: null, skip: 'too-large' };
  const text = readFileSync(abs, 'utf8');
  if (text.includes('\u0000')) return { text: null, skip: 'binary' };
  return { text, skip: null };
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
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
    const suppression: SecurityAuditSuppression = { checkId, reason };
    const titleIncludes = typeof record?.titleIncludes === 'string' ? record.titleIncludes.trim() : '';
    const detailIncludes = typeof record?.detailIncludes === 'string' ? record.detailIncludes.trim() : '';
    if (titleIncludes) suppression.titleIncludes = titleIncludes;
    if (detailIncludes) suppression.detailIncludes = detailIncludes;
    accepted.push(suppression);
  });
  return { accepted, rejected };
}

function suppressionMatches(entry: SecurityAuditSuppression, item: SecurityAuditFinding): boolean {
  if (UNSUPPRESSIBLE.has(item.checkId) || entry.checkId !== item.checkId) return false;
  if (entry.titleIncludes && !item.title.toLowerCase().includes(entry.titleIncludes.toLowerCase())) return false;
  if (entry.detailIncludes && !item.detail.toLowerCase().includes(entry.detailIncludes.toLowerCase())) return false;
  return true;
}

function scanPlaintext(abs: string, roots: string[], out: SecurityAuditFinding[]): void {
  const loaded = readText(abs);
  const label = relativeTo(abs, roots);
  if (loaded.skip) {
    out.push(finding(
      'config.file.skipped',
      'info',
      'Configuration file not scanned',
      `${label} was skipped (${loaded.skip}).`,
    ));
    return;
  }
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

function scanMcp(abs: string, roots: string[], out: SecurityAuditFinding[], projectSettings: boolean): void {
  const loaded = readText(abs);
  if (!loaded.text) return;
  const parsed = abs.endsWith('.toml') ? safeToml(loaded.text) : parseJson(loaded.text);
  const root = asRecord(parsed);
  if (projectSettings && root && asRecord(root.servers) && !asRecord(root.mcpServers)) {
    out.push(finding(
      'mcp.config.servers_key_ignored',
      'medium',
      'MCP servers key is not read',
      `${relativeTo(abs, roots)} defines servers but runtime reads mcpServers only.`,
    ));
  }
  for (const server of serverRecords(parsed)) {
    if (server.body.enabled === false) continue;
    const label = `${relativeTo(abs, roots)}:${server.name}`;
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

function safeToml(text: string): unknown {
  try {
    return TOML.parse(text);
  } catch {
    return undefined;
  }
}

function collectSuppressions(profileDir: string, projectDir: string): {
  accepted: SecurityAuditSuppression[];
  rejected: SecurityAuditFinding[];
} {
  const accepted: SecurityAuditSuppression[] = [];
  const rejected: SecurityAuditFinding[] = [];
  const take = (value: unknown) => {
    const parsed = parseSecurityAuditSuppressions(value);
    accepted.push(...parsed.accepted);
    rejected.push(...parsed.rejected);
  };
  const configPath = path.join(profileDir, 'config.toml');
  const configText = readText(configPath).text;
  if (configText) {
    const parsed = asRecord(safeToml(configText));
    const security = asRecord(parsed?.security);
    const audit = asRecord(security?.audit);
    if (audit && 'suppressions' in audit) take(audit.suppressions);
  }
  for (const rel of ['settings.json', 'user-settings.json', '.codebuddy/settings.json', '.codebuddy/settings.local.json']) {
    const root = rel.startsWith('.codebuddy/') ? projectDir : profileDir;
    const text = readText(path.join(root, rel)).text;
    if (!text) continue;
    const security = asRecord(asRecord(parseJson(text))?.security);
    const audit = asRecord(security?.audit);
    if (audit && 'suppressions' in audit) take(audit.suppressions);
  }
  return { accepted, rejected };
}

function permissionFindings(request: ConsolidatedAuditRequest): SecurityAuditFinding[] {
  if ((request.platform ?? process.platform) === 'win32') return [];
  const roots = [request.profileDir, request.projectDir];
  const out: SecurityAuditFinding[] = [];
  const seen = new Set<string>();
  const consider = (abs: string, kind: 'dir' | 'file') => {
    if (!existsSync(abs) || seen.has(path.resolve(abs))) return;
    seen.add(path.resolve(abs));
    const mode = modeBits(abs);
    if (mode === null) return;
    const label = relativeTo(abs, roots);
    if (kind === 'dir' && (mode & 0o002) !== 0) {
      out.push(finding(
        'profile.directory.world_writable',
        'high',
        'Directory is world-writable',
        `${label} mode ${mode.toString(8)} allows every local account to write. Restrict it to 0700.`,
        true,
      ));
    }
    if (kind === 'file' && (mode & 0o077) !== 0) {
      out.push(finding(
        'profile.file.loose_permissions',
        'high',
        'Configuration file is group or world accessible',
        `${label} mode ${mode.toString(8)} is broader than 0600.`,
        true,
      ));
    }
  };
  consider(request.profileDir, 'dir');
  consider(path.join(request.profileDir, 'sessions'), 'dir');
  consider(path.join(request.projectDir, '.codebuddy'), 'dir');
  for (const rel of PROFILE_FILES) consider(path.join(request.profileDir, rel), 'file');
  for (const rel of PROJECT_FILES) consider(path.join(request.projectDir, rel), 'file');
  return out;
}

function skillFindings(request: ConsolidatedAuditRequest): SecurityAuditFinding[] {
  const roots = [request.profileDir, request.projectDir];
  const out: SecurityAuditFinding[] = [];
  const parents = [
    path.join(request.profileDir, 'skills'),
    path.join(request.projectDir, '.codebuddy', 'skills'),
  ];
  for (const parent of parents) {
    if (!existsSync(parent)) continue;
    let entries: string[] = [];
    try {
      entries = readdirSync(parent);
    } catch {
      continue;
    }
    for (const name of entries.slice(0, 40)) {
      const abs = path.join(parent, name);
      let info;
      try {
        info = lstatSync(abs);
      } catch {
        continue;
      }
      const label = relativeTo(abs, roots);
      if (info.isSymbolicLink()) {
        out.push(finding(
          'skills.path.symlink',
          'medium',
          'Skill path is a symlink',
          `${label} was not followed.`,
        ));
        continue;
      }
      if (!info.isDirectory() && name.toLowerCase() !== 'skill.md') continue;
      const report = scanSkillFirewall(abs);
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

function otherFindings(request: ConsolidatedAuditRequest): SecurityAuditFinding[] {
  const roots = [request.profileDir, request.projectDir];
  const out: SecurityAuditFinding[] = [];
  for (const rel of PROFILE_FILES) scanPlaintext(path.join(request.profileDir, rel), roots, out);
  for (const rel of PROJECT_FILES) scanPlaintext(path.join(request.projectDir, rel), roots, out);
  scanMcp(path.join(request.profileDir, 'mcp.json'), roots, out, false);
  scanMcp(path.join(request.projectDir, '.codebuddy', 'mcp.json'), roots, out, false);
  scanMcp(path.join(request.projectDir, '.codebuddy', 'settings.json'), roots, out, true);
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

function applyFixes(
  request: ConsolidatedAuditRequest,
  items: SecurityAuditFinding[],
): SecurityAuditFix[] {
  const targets = items.filter((item) => item.fixable && (
    item.checkId === 'profile.directory.world_writable' || item.checkId === 'profile.file.loose_permissions'
  ));
  if (targets.length === 0) return [];
  const roots = [request.profileDir, request.projectDir];
  const planned: Array<{ abs: string; mode: number; checkId: string; subject: string; next: number }> = [];
  for (const item of targets) {
    const subject = item.detail.split(' ')[0] ?? '';
    const abs = resolveSubject(subject, roots);
    if (!abs || !insideRoot(abs, roots)) continue;
    try {
      if (lstatSync(abs).isSymbolicLink()) continue;
    } catch {
      continue;
    }
    const mode = modeBits(abs);
    if (mode === null) continue;
    const next = item.checkId === 'profile.directory.world_writable' ? 0o700 : 0o600;
    if (mode === next) continue;
    planned.push({ abs, mode, checkId: item.checkId, subject, next });
  }
  if (planned.length === 0) return [];
  const stamp = (request.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(request.profileDir, 'security-audit-backups', stamp);
  try {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const manifest = {
      version: 1,
      entries: planned.map((entry) => ({
        path: relativeTo(entry.abs, roots),
        modeBefore: entry.mode.toString(8),
      })),
    };
    const manifestPath = path.join(backupDir, 'manifest.json');
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const fixes: SecurityAuditFix[] = [];
    for (const entry of planned) {
      try {
        chmodSync(entry.abs, entry.next);
        fixes.push({
          checkId: entry.checkId,
          subject: entry.subject,
          ok: true,
          message: `mode ${entry.mode.toString(8)} -> ${entry.next.toString(8)}`,
          backup: relativeTo(manifestPath, roots),
        });
      } catch (error) {
        fixes.push({
          checkId: entry.checkId,
          subject: entry.subject,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          backup: relativeTo(manifestPath, roots),
        });
      }
    }
    return fixes;
  } catch (error) {
    return planned.map((entry) => ({
      checkId: entry.checkId,
      subject: entry.subject,
      ok: false,
      message: `backup not written, permissions left unchanged: ${error instanceof Error ? error.message : String(error)}`,
    }));
  }
}

function resolveSubject(subject: string, roots: string[]): string | null {
  if (!subject || subject.includes('\0') || path.isAbsolute(subject)) return null;
  if (subject === '.') {
    const abs = path.resolve(roots[0] ?? '');
    return existsSync(abs) ? abs : null;
  }
  for (const root of roots) {
    const abs = path.resolve(root, subject);
    if (!insideRoot(abs, [root]) || !existsSync(abs)) continue;
    try {
      if (lstatSync(abs).isSymbolicLink()) return null;
    } catch {
      return null;
    }
    return abs;
  }
  return null;
}

export function runConsolidatedSecurityAudit(request: ConsolidatedAuditRequest): ConsolidatedAuditReport {
  const collected = [
    ...permissionFindings(request),
    ...skillFindings(request),
    ...otherFindings(request),
  ];
  const suppressions = collectSuppressions(request.profileDir, request.projectDir);
  collected.push(...suppressions.rejected);
  const active: SecurityAuditFinding[] = [];
  const suppressedFindings: SecurityAuditFinding[] = [];
  for (const item of collected) {
    if (suppressions.accepted.some((entry) => suppressionMatches(entry, item))) suppressedFindings.push(item);
    else active.push(item);
  }
  if (suppressions.accepted.length > 0) {
    active.push(finding(
      'security.audit.suppressions.active',
      'info',
      'Audit suppressions are active',
      `${suppressions.accepted.length} accepted suppression(s). Hidden findings stay in suppressedFindings.`,
    ));
  }
  const fixes = request.fix ? applyFixes(request, active) : [];
  const fixedSubjects = new Set(fixes.filter((item) => item.ok).map((item) => item.subject));
  const findings = active.filter((item) => {
    if (!item.fixable || !fixedSubjects.size) return true;
    const subject = item.detail.split(' ')[0] ?? '';
    return !fixedSubjects.has(subject);
  });
  const summary = summarize(findings);
  return {
    passed: summary.critical === 0 && summary.high === 0 && fixes.every((item) => item.ok),
    findings,
    suppressedFindings,
    summary,
    fixes,
  };
}
