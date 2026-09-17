/**
 * `buddy doctor` — Integrations section (comparatif plan P3).
 *
 * Aggregates EXISTING diagnostics without any network probe:
 * - LM Resizer protocol (`diagnoseLmResizer`: bounded local `--help` runs only);
 * - Code Explorer index freshness vs git HEAD (`getFreshness`, autoIndex off);
 * - MCP configuration structure (`loadMCPConfig`, no server is started);
 * - resource catalog observations (`ResourceCatalog.list`, never `probe`);
 * - Skills Hub integrity (`listWithIntegrity`, same data as `buddy skills doctor`).
 *
 * Every probe is fail-soft: a broken source becomes a `warn` check, never a crash.
 */

import { z } from 'zod';
import type { DoctorCheck, DoctorSummary } from './index.js';
import { getThemeManager } from '../themes/theme-manager.js';

export type IntegrationCheck = DoctorCheck & { id: string; section: 'integrations' };

export interface IntegrationDeps {
  lmResizer?: () => Promise<{ enabled: boolean; available: boolean; toolOutputSupported: boolean; binary: string; version: string; warning: string }>;
  codeExplorerFreshness?: (cwd: string) => Promise<{ indexed: boolean; stale: boolean; unverified?: boolean; commitsBehind?: number; lastCommit?: string }>;
  mcpServers?: (cwd: string) => Promise<Array<{ name: string; enabled?: boolean; transport?: { type?: unknown }; command?: unknown }>>;
  resources?: () => Promise<Array<{ resource: { id: string; kind: string }; state: string; reason: string }>>;
  skillsIntegrity?: () => Promise<Array<{ name: string; exists: boolean; integrityOk: boolean }>>;
  /** Model whose code_exec policy is reported (default: saved settings model, then GROK_MODEL). */
  configuredModel?: () => Promise<string | undefined>;
  /** Never start a child process (the LM Resizer binary is located, not executed). */
  noSubprocess?: boolean;
}

const KNOWN_MCP_TRANSPORTS = new Set(['stdio', 'http', 'sse', 'streamable_http']);

function check(id: string, name: string, status: DoctorCheck['status'], message: string, optional?: boolean): IntegrationCheck {
  return { id, section: 'integrations', name, status, message, ...(optional ? { optional } : {}) };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function lmResizerCheck(deps: IntegrationDeps): Promise<IntegrationCheck> {
  try {
    if (deps.noSubprocess && !deps.lmResizer) {
      const { isLmResizerEnabled, resolveLmResizerBin } = await import('../context/lm-resizer-compressor.js');
      if (!isLmResizerEnabled()) {
        return check('lm-resizer', 'LM Resizer', 'ok', 'disabled (CODEBUDDY_LM_RESIZER unset): tool observations stay raw', true);
      }
      const { commandExistsOnPath } = await import('./index.js');
      const binary = resolveLmResizerBin();
      return commandExistsOnPath(binary)
        ? check('lm-resizer', 'LM Resizer', 'ok', `enabled, ${binary} found; protocol not probed (no child process in this mode — run buddy doctor --integrations)`, true)
        : check('lm-resizer', 'LM Resizer', 'warn', `enabled but binary unavailable (${binary}); observations stay raw`);
    }
    const diagnose = deps.lmResizer ?? (async () => (await import('../context/lm-resizer-diagnostics.js')).diagnoseLmResizer());
    const d = await diagnose();
    if (!d.enabled) {
      return check('lm-resizer', 'LM Resizer', 'ok', 'disabled (CODEBUDDY_LM_RESIZER unset): tool observations stay raw', true);
    }
    if (!d.available) {
      return check('lm-resizer', 'LM Resizer', 'warn', `enabled but binary unavailable (${d.binary}); observations stay raw`);
    }
    if (!d.toolOutputSupported) {
      return check('lm-resizer', 'LM Resizer', 'warn', `enabled but ${d.binary} (${d.version}) lacks the tool-output protocol; compression is inactive — install a compatible release`);
    }
    return check('lm-resizer', 'LM Resizer', 'ok', `tool-output protocol supported (${d.version})`);
  } catch (error) {
    return check('lm-resizer', 'LM Resizer', 'warn', `diagnostic failed: ${errorText(error)}`);
  }
}

async function codeExplorerCheck(cwd: string, deps: IntegrationDeps): Promise<IntegrationCheck> {
  try {
    const freshness = deps.codeExplorerFreshness ?? (async (dir: string) => {
      const { CodeExplorerManager } = await import('../plugins/code-explorer/CodeExplorerManager.js');
      return new CodeExplorerManager(dir).getFreshness(undefined, { autoIndex: false });
    });
    const f = await freshness(cwd);
    if (!f.indexed) return check('code-explorer', 'Code Explorer index', 'ok', 'repository not indexed (optional)', true);
    if (f.unverified) return check('code-explorer', 'Code Explorer index', 'warn', 'index present but freshness could not be verified against git HEAD');
    if (f.stale) {
      const behind = typeof f.commitsBehind === 'number' ? `${f.commitsBehind} commit(s) behind HEAD` : 'does not match HEAD';
      return check('code-explorer', 'Code Explorer index', 'warn', `stale: ${behind} — re-run the Code Explorer analyze step`);
    }
    return check('code-explorer', 'Code Explorer index', 'ok', 'index matches git HEAD');
  } catch (error) {
    return check('code-explorer', 'Code Explorer index', 'warn', `freshness check failed: ${errorText(error)}`);
  }
}

async function mcpCheck(cwd: string, deps: IntegrationDeps): Promise<IntegrationCheck> {
  try {
    // Explicit project directory: never process.chdir() (global state shared across awaits).
    // Diagnostics use the strictly read-only loader: no restore/rename/chmod/create of
    // config or backups/temporaries, and corrupt sources surface as honest warnings.
    let servers: Array<{ name: string; enabled?: boolean; transport?: { type?: unknown }; command?: unknown }>;
    let warnings: string[] = [];
    if (deps.mcpServers) {
      servers = await deps.mcpServers(cwd);
    } else {
      const { loadMCPConfigReadOnly } = await import('../mcp/config.js');
      const result = loadMCPConfigReadOnly({ includeDisabled: true, cwd });
      servers = result.servers as Array<{ name: string; enabled?: boolean; transport?: { type?: unknown }; command?: unknown }>;
      warnings = result.warnings;
    }
    const disabled = servers.filter((s) => s.enabled === false).length;
    const unusable = servers.filter((s) => {
      if (s.enabled === false) return false;
      const type = s.transport && typeof s.transport === 'object' ? s.transport.type : undefined;
      if (typeof type === 'string') return !KNOWN_MCP_TRANSPORTS.has(type);
      return typeof s.command !== 'string' || s.command.trim() === '';
    }).map((s) => s.name);
    const base = servers.length === 0
      ? 'no MCP server configured'
      : `${servers.length} configured (${disabled} disabled); no server started`;
    const parts: string[] = [base];
    if (warnings.length > 0) parts.push(`configuration warnings: ${warnings.join('; ')}`);
    if (unusable.length > 0) parts.push(`unusable transport configuration: ${unusable.join(', ')}`);
    const message = parts.join('; ');
    if (warnings.length > 0 || unusable.length > 0) {
      return check('mcp', 'MCP servers', 'warn', message);
    }
    if (servers.length === 0) return check('mcp', 'MCP servers', 'ok', message, true);
    return check('mcp', 'MCP servers', 'ok', message);
  } catch (error) {
    return check('mcp', 'MCP servers', 'warn', `configuration unreadable: ${errorText(error)}`);
  }
}

async function resourcesCheck(deps: IntegrationDeps): Promise<IntegrationCheck> {
  try {
    const list = deps.resources ?? (async () => new (await import('../fleet/resource-catalog.js')).ResourceCatalog().list());
    const entries = await list();
    if (entries.length === 0) return check('resources', 'Resource catalog', 'ok', 'no resource declared (buddy resources add)', true);
    const count = (state: string) => entries.filter((e) => e.state === state).length;
    const summary = `${entries.length} declared: ${count('online')} online, ${count('stale')} stale, ${count('offline')} offline, ${count('unknown')} unknown (read-only, no probe)`;
    const attention = entries.filter((e) => e.state === 'stale' || e.state === 'offline').map((e) => `${e.resource.id}=${e.state}`);
    return attention.length > 0
      ? check('resources', 'Resource catalog', 'warn', `${summary}; refresh explicitly with buddy resources probe <id>: ${attention.join(', ')}`)
      : check('resources', 'Resource catalog', 'ok', summary);
  } catch (error) {
    return check('resources', 'Resource catalog', 'warn', `catalog unreadable: ${errorText(error)}`);
  }
}

async function skillsCheck(deps: IntegrationDeps): Promise<IntegrationCheck> {
  try {
    const list = deps.skillsIntegrity ?? (async () => (await import('../skills/hub.js')).getSkillsHub().listWithIntegrity());
    const skills = await list();
    const missing = skills.filter((s) => !s.exists).length;
    const modified = skills.filter((s) => s.exists && !s.integrityOk).length;
    if (missing + modified > 0) {
      return check('skills', 'Skills Hub integrity', 'warn', `${skills.length} installed: ${missing} missing SKILL.md, ${modified} modified — run buddy skills doctor`);
    }
    return check('skills', 'Skills Hub integrity', 'ok', `${skills.length} installed, all intact`, skills.length === 0);
  } catch (error) {
    return check('skills', 'Skills Hub integrity', 'warn', `lockfile unreadable: ${errorText(error)}`);
  }
}

async function codeExecPolicyCheck(deps: IntegrationDeps): Promise<IntegrationCheck> {
  try {
    const model = deps.configuredModel
      ? await deps.configuredModel()
      : await (async () => {
        const { getSettingsManager } = await import('../utils/settings-manager.js');
        const settings = getSettingsManager().readUserSettingsIfPresent() as { model?: string; defaultModel?: string } | undefined;
        return settings?.defaultModel ?? settings?.model ?? process.env.GROK_MODEL;
      })();
    const { resolveCodeExecPolicy } = await import('../config/code-exec-policy.js');
    const resolved = resolveCodeExecPolicy(model);
    const evidence = resolved.evidence ? `, evidence ${resolved.evidence}` : '';
    return check('code-exec-policy', 'Programmatic tool calling', 'ok', `code_exec policy ${resolved.policy} for ${model ?? 'unknown model'} (source ${resolved.source}${evidence})`, true);
  } catch (error) {
    return check('code-exec-policy', 'Programmatic tool calling', 'warn', `policy unreadable: ${errorText(error)}`);
  }
}

export async function runIntegrationChecks(cwd: string, deps: IntegrationDeps = {}): Promise<IntegrationCheck[]> {
  return Promise.all([
    lmResizerCheck(deps),
    codeExplorerCheck(cwd, deps),
    mcpCheck(cwd, deps),
    resourcesCheck(deps),
    skillsCheck(deps),
    codeExecPolicyCheck(deps),
  ]);
}

// ── JSON report ─────────────────────────────────────────────────────────────

export const doctorJsonReportSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  offline: z.boolean(),
  summary: z.object({
    passed: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    optionalNotInstalled: z.number().int().nonnegative(),
  }).strict(),
  checks: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    section: z.enum(['core', 'integrations']),
    name: z.string(),
    status: z.enum(['ok', 'warn', 'error']),
    message: z.string(),
    fixable: z.boolean(),
    optional: z.boolean(),
  }).strict()),
  fixes: z.array(z.object({ success: z.boolean(), message: z.string(), action: z.string() }).strict()).optional(),
  theme: z.object({
    id: z.string(),
    name: z.string(),
  }).strict(),
}).strict();

export type DoctorJsonReport = z.infer<typeof doctorJsonReportSchema>;

export function slugifyCheckName(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'check';
}

export function buildDoctorJsonReport(
  checks: DoctorCheck[],
  summary: DoctorSummary,
  options: { offline: boolean; now?: Date; fixes?: Array<{ success: boolean; message: string; action: string }> },
): DoctorJsonReport {
  const seen = new Map<string, number>();
  let theme = { id: 'unknown', name: 'unknown' };
  try {
    const current = getThemeManager().getCurrentTheme();
    theme = { id: current.id, name: current.name };
  } catch {
    // Theme manager is optional for doctor JSON consumers.
  }
  const report: DoctorJsonReport = {
    version: 1,
    generatedAt: (options.now ?? new Date()).toISOString(),
    offline: options.offline,
    summary,
    checks: checks.map((c) => {
      const baseId = (c as Partial<IntegrationCheck>).id ?? slugifyCheckName(c.name);
      const n = (seen.get(baseId) ?? 0) + 1;
      seen.set(baseId, n);
      return {
        id: n === 1 ? baseId : `${baseId}-${n}`,
        section: (c as Partial<IntegrationCheck>).section ?? 'core',
        name: c.name,
        status: c.status,
        message: c.message,
        fixable: c.fixable === true,
        optional: c.optional === true,
      };
    }),
    ...(options.fixes ? { fixes: options.fixes } : {}),
    theme,
  };
  return doctorJsonReportSchema.parse(report);
}
