/**
 * `buddy triage` — local, redacted support bundle (P7).
 *
 * Collects the offline doctor report, versions, recent failed runs, a bounded
 * log tail and configuration KEY NAMES, then writes `triage.json` and a
 * prompt (≤ 8 KiB) into a fresh 0700 directory. Nothing is sent anywhere and
 * no agent is launched: the suggested command is printed for the user.
 *
 * Fail closed: every string goes through literal masking of known secret
 * values, then the redaction engine; the serialized bundle and prompt are
 * scanned again and any section still flagged is withheld. If the scan itself
 * fails, nothing is written.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { DoctorCheck } from './index.js';
import type { DoctorJsonReport } from './integrations.js';

export const TRIAGE_PROMPT_MAX_BYTES = 8192;
const DEFAULT_LOG_LINES = 200;
const LOG_TAIL_READ_BYTES = 256 * 1024;
const LOG_LINE_MAX_CHARS = 400;
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|AUTH|CREDENTIAL|COOKIE|SESSION|PRIVATE)/i;
const PLACEHOLDER = /\[REDACTED(?::[A-Z0-9_]+)?\]/g;

export interface TriageFailedRun {
  runId: string;
  status: string;
  startedAt: string;
  eventCount: number;
  objective: string;
}

export interface TriageBundle {
  version: 1;
  generatedAt: string;
  networkUsed: false;
  versions: { node: string; buddy: string; os: string };
  doctor: DoctorJsonReport | { withheld: true; reason: string };
  failedRuns: TriageFailedRun[] | { withheld: true; reason: string };
  logs: { file: string | null; lines: string[] } | { withheld: true; reason: string };
  config: { files: Array<{ file: string; keys: string[] }> } | { withheld: true; reason: string };
  redactions: number;
  withheld: string[];
}

export interface TriageDeps {
  runDoctor?: () => Promise<{ checks: DoctorCheck[]; report: DoctorJsonReport }>;
  listRuns?: (limit: number) => Array<{ runId: string; status: string; startedAt: number; eventCount: number; objective: string }>;
  redact?: (text: string) => { redacted: string; count: number };
}

export interface TriageOptions {
  cwd: string;
  homeDir?: string;
  outParent?: string;
  logFile?: string | null;
  logLines?: number;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  buddyVersion?: string;
  deps?: TriageDeps;
}

export interface TriageResult {
  dir: string;
  jsonPath: string;
  promptPath: string;
  promptBytes: number;
  redactions: number;
  withheld: string[];
  suggestedCommand: string;
  bundle: TriageBundle;
}

// ── Masking ─────────────────────────────────────────────────────────────────

function parseEnvFile(file: string): Map<string, string> {
  const entries = new Map<string, string>();
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return entries;
  }
  for (const raw of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(raw);
    if (!match) continue;
    const value = match[2]!.trim().replace(/^(['"])(.*)\1$/, '$2');
    entries.set(match[1]!, value);
  }
  return entries;
}

function envFiles(cwd: string, home: string): string[] {
  return [path.join(cwd, '.env'), path.join(cwd, '.env.local'), path.join(home, '.codebuddy', '.env')];
}

/** Literal values that must never leave the machine, longest first. */
export function collectSecretValues(cwd: string, home: string, env: NodeJS.ProcessEnv): string[] {
  const values = new Set<string>();
  const consider = (name: string, value: string | undefined) => {
    if (!value) return;
    const trimmed = value.trim();
    if (trimmed.length < 6) return;
    if (SECRET_NAME.test(name) || /:\/\/[^\s/@]+:[^\s/@]+@/.test(trimmed)) values.add(trimmed);
  };
  for (const file of envFiles(cwd, home)) {
    for (const [name, value] of parseEnvFile(file)) consider(name, value);
  }
  for (const [name, value] of Object.entries(env)) consider(name, value);
  return [...values].sort((a, b) => b.length - a.length);
}

export function createMasker(secretValues: string[], redact: NonNullable<TriageDeps['redact']>, home?: string) {
  let total = 0;
  const mask = (input: string): string => {
    let text = input;
    for (const value of secretValues) {
      if (text.includes(value)) {
        const parts = text.split(value);
        total += parts.length - 1;
        text = parts.join('[REDACTED:VALUE]');
      }
    }
    // The home path carries the account name; keep paths readable as `~`.
    if (home && home.length > 1) text = text.split(home).join('~');
    text = text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, (_m, scheme: string) => {
      total += 1;
      return `${scheme}[REDACTED:USERINFO]@`;
    });
    // Fixed point: replacements can expose a new match (`token: <jwt>`).
    for (let i = 0; i < 3; i++) {
      const result = redact(text);
      total += result.count;
      if (result.redacted === text) break;
      text = result.redacted;
    }
    return text;
  };
  const leaks = (text: string): boolean => {
    const stripped = text.replace(PLACEHOLDER, '');
    if (secretValues.some((value) => stripped.includes(value))) return true;
    if (/[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i.test(stripped)) return true;
    return redact(stripped).count > 0;
  };
  return { mask, leaks, count: () => total };
}

async function defaultRedact(): Promise<NonNullable<TriageDeps['redact']>> {
  const { getDataRedactionEngine } = await import('../security/data-redaction.js');
  const engine = getDataRedactionEngine();
  return (text) => {
    const result = engine.redact(text);
    return { redacted: result.redacted, count: result.redactions.length };
  };
}

// ── Collectors ──────────────────────────────────────────────────────────────

async function defaultRunDoctor(cwd: string): Promise<{ checks: DoctorCheck[]; report: DoctorJsonReport }> {
  const { runDoctorChecks, summarizeDoctorChecks } = await import('./index.js');
  const { runIntegrationChecks, buildDoctorJsonReport } = await import('./integrations.js');
  const checks = [...(await runDoctorChecks(cwd, { offline: true, noSubprocess: true })), ...(await runIntegrationChecks(cwd, { noSubprocess: true }))];
  return { checks, report: buildDoctorJsonReport(checks, summarizeDoctorChecks(checks), { offline: true }) };
}

async function defaultListRuns(limit: number) {
  const { RunStore } = await import('../observability/run-store.js');
  return RunStore.getInstance().listRuns(limit);
}

/** Last `maxLines` lines of a file, reading at most 256 KiB from its end. */
export function tailFile(file: string, maxLines: number): string[] {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, LOG_TAIL_READ_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split(/\r?\n/);
    if (length < size) lines.shift(); // first line is probably partial
    return lines.filter((line) => line.trim() !== '').slice(-maxLines)
      .map((line) => (line.length > LOG_LINE_MAX_CHARS ? `${line.slice(0, LOG_LINE_MAX_CHARS)}…` : line));
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function jsonKeys(file: string): string[] | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).sort() : [];
  } catch {
    return null;
  }
}

function configKeyNames(cwd: string, home: string): Array<{ file: string; keys: string[] }> {
  const out: Array<{ file: string; keys: string[] }> = [];
  const label = (file: string) => (file.startsWith(home) ? `~${file.slice(home.length)}` : path.relative(cwd, file) || file);
  for (const file of [path.join(home, '.codebuddy', 'settings.json'), path.join(home, '.codebuddy', 'user-settings.json'), path.join(cwd, '.codebuddy', 'settings.json')]) {
    const keys = jsonKeys(file);
    if (keys) out.push({ file: label(file), keys });
  }
  for (const file of envFiles(cwd, home)) {
    if (!fs.existsSync(file)) continue;
    out.push({ file: label(file), keys: [...parseEnvFile(file).keys()].sort() });
  }
  return out;
}

// ── Prompt ──────────────────────────────────────────────────────────────────

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function truncateBytes(text: string, max: number): string {
  if (byteLength(text) <= max) return text;
  const marker = '\n…[truncated]\n';
  let slice = Buffer.from(text, 'utf8').subarray(0, max - byteLength(marker)).toString('utf8');
  slice = slice.replace(/�$/, '');
  return slice + marker;
}

export function buildTriagePrompt(bundle: TriageBundle, maxBytes = TRIAGE_PROMPT_MAX_BYTES): string {
  const head = [
    '# Code Buddy triage',
    '',
    'Diagnose this Code Buddy installation from the local bundle below. Secret values are masked as [REDACTED:…];',
    'do not ask the user to paste keys, tokens or passwords. Propose concrete fixes and the command to verify each one.',
    '',
    `Versions: Buddy ${bundle.versions.buddy}, Node ${bundle.versions.node}, ${bundle.versions.os}`,
    '',
  ].join('\n');
  const doctor = 'withheld' in bundle.doctor
    ? `## Doctor (offline)\nwithheld: ${bundle.doctor.reason}\n`
    : `## Doctor (offline): ${bundle.doctor.summary.errors} error(s), ${bundle.doctor.summary.warnings} warning(s)\n${bundle.doctor.checks
      .filter((c) => c.status !== 'ok')
      .map((c) => `- [${c.status}] ${c.name}: ${c.message}`)
      .join('\n') || '- all checks ok'}\n`;
  const runs = Array.isArray(bundle.failedRuns)
    ? `## Recent failed or stuck runs\n${bundle.failedRuns.map((r) => `- ${r.runId} ${r.status} ${r.startedAt} events=${r.eventCount}: ${r.objective}`).join('\n') || '- none'}\n`
    : `## Recent failed or stuck runs\nwithheld: ${bundle.failedRuns.reason}\n`;
  const config = 'withheld' in bundle.config
    ? `## Configuration keys\nwithheld: ${bundle.config.reason}\n`
    : `## Configuration keys (names only)\n${bundle.config.files.map((f) => `- ${f.file}: ${f.keys.join(', ') || '(empty)'}`).join('\n') || '- none found'}\n`;
  const withheld = bundle.withheld.length > 0 ? `Withheld sections: ${bundle.withheld.join(', ')}\n` : '';
  const fixed = [head, doctor, runs, config, withheld].join('\n');

  const logLines = 'withheld' in bundle.logs ? [] : [...bundle.logs.lines];
  const logHeader = 'withheld' in bundle.logs ? `## Log tail\nwithheld: ${bundle.logs.reason}\n` : '## Log tail (most recent last)\n```\n';
  const logFooter = 'withheld' in bundle.logs ? '' : '```\n';
  const budget = maxBytes - byteLength(fixed) - byteLength(logHeader) - byteLength(logFooter) - 2;
  // Keep the most recent lines that fit.
  const kept: string[] = [];
  let used = 0;
  for (let i = logLines.length - 1; i >= 0; i--) {
    const size = byteLength(logLines[i]!) + 1;
    if (used + size > budget) break;
    kept.unshift(logLines[i]!);
    used += size;
  }
  const logs = budget > 0 ? `${logHeader}${kept.map((l) => `${l}\n`).join('')}${logFooter}` : '';
  return truncateBytes(`${fixed}\n${logs}`, maxBytes);
}

// ── Main ────────────────────────────────────────────────────────────────────

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function writeTriageBundle(options: TriageOptions): Promise<TriageResult> {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? os.homedir();
  const now = options.now ?? new Date();
  const deps = options.deps ?? {};
  const redact = deps.redact ?? (await defaultRedact());
  const masker = createMasker(collectSecretValues(options.cwd, home, env), redact, home);
  const withheld: string[] = [];

  const doctorRaw = await (deps.runDoctor ?? (() => defaultRunDoctor(options.cwd)))();
  const doctor: DoctorJsonReport = {
    ...doctorRaw.report,
    checks: doctorRaw.report.checks.map((c) => ({ ...c, name: masker.mask(c.name), message: masker.mask(c.message) })),
  };

  const runs = deps.listRuns ? deps.listRuns(50) : await defaultListRuns(50);
  const failedRuns: TriageFailedRun[] = runs
    .filter((r) => r.status === 'failed' || r.status === 'running')
    .slice(0, 10)
    .map((r) => ({
      runId: masker.mask(r.runId),
      status: r.status,
      startedAt: new Date(r.startedAt).toISOString(),
      eventCount: r.eventCount,
      objective: masker.mask((r.objective ?? '').slice(0, 160)),
    }));

  const logFile = options.logFile === undefined
    ? (env.LOG_FILE !== undefined ? env.LOG_FILE || null : path.join(home, '.codebuddy', 'logs', 'codebuddy.log'))
    : options.logFile;
  const logLines = logFile ? tailFile(logFile, options.logLines ?? DEFAULT_LOG_LINES).map(masker.mask) : [];
  const displayLog = logFile ? (logFile.startsWith(home) ? `~${logFile.slice(home.length)}` : logFile) : null;

  const bundle: TriageBundle = {
    version: 1,
    generatedAt: now.toISOString(),
    networkUsed: false,
    versions: { node: process.version, buddy: options.buddyVersion ?? 'unknown', os: `${os.platform()} ${os.release()} ${os.arch()}` },
    doctor,
    failedRuns,
    logs: { file: displayLog, lines: logLines },
    config: { files: configKeyNames(options.cwd, home).map((f) => ({ file: masker.mask(f.file), keys: f.keys.map(masker.mask) })) },
    redactions: 0,
    withheld,
  };

  // Fail closed: withhold any section still flagged after masking.
  for (const section of ['doctor', 'failedRuns', 'logs', 'config'] as const) {
    if (masker.leaks(JSON.stringify(bundle[section]))) {
      (bundle as unknown as Record<string, unknown>)[section] = { withheld: true, reason: 'secret scan still matched after redaction' };
      withheld.push(section);
    }
  }
  bundle.redactions = masker.count();
  const prompt = buildTriagePrompt(bundle);
  const json = JSON.stringify(bundle, null, 2);
  if (masker.leaks(json) || masker.leaks(prompt)) {
    throw new Error('TRIAGE_SECRET_SCAN_FAILED: refusing to write a bundle that still matches the secret scanner');
  }

  const parent = options.outParent ?? path.join(home, '.codebuddy', 'triage');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const dir = fs.mkdtempSync(path.join(parent, `triage-${stamp(now)}-`));
  fs.chmodSync(dir, 0o700);
  const jsonPath = path.join(dir, 'triage.json');
  const promptPath = path.join(dir, 'prompt.md');
  fs.writeFileSync(jsonPath, `${json}\n`, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(promptPath, prompt, { mode: 0o600, flag: 'wx' });
  fs.chmodSync(jsonPath, 0o600);
  fs.chmodSync(promptPath, 0o600);

  return {
    dir,
    jsonPath,
    promptPath,
    promptBytes: byteLength(prompt),
    redactions: bundle.redactions,
    withheld,
    suggestedCommand: `buddy -p "$(cat ${shellQuote(promptPath)})"`,
    bundle,
  };
}
