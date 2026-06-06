import path from 'path';
import {
  SkillsHub,
  type InstalledSkill,
  type SkillHistoryResult,
  type SkillLifecycleState,
} from '../skills/hub.js';
import {
  scanSkillFirewall,
  type SkillFirewallCapability,
  type SkillFirewallVerdict,
} from '../security/skill-scanner.js';

export type HermesSkillPackageStatus = 'active' | 'disabled' | 'deprecated';
export type HermesSkillPackageLifecycleAction = 'enable' | 'disable' | 'deprecate';

export interface HermesSkillPackageEntry {
  averageDurationMs?: number;
  contentPreview?: string;
  contentPreviewTruncated?: boolean;
  enabled: boolean;
  exists: boolean;
  failureCount?: number;
  firewallCapabilities?: SkillFirewallCapability[];
  firewallFindingCount?: number;
  firewallQuarantineRequired?: boolean;
  firewallScore?: number;
  firewallSummary?: string;
  firewallVerdict?: SkillFirewallVerdict;
  installedAt: number;
  integrityOk: boolean;
  invocationCount?: number;
  lastError?: string;
  lastLifecycleReason?: string;
  lastLifecycleReviewer?: string;
  lastUsedAt?: number;
  name: string;
  path: string;
  rollbackableCount: number;
  sizeBytes?: number;
  source: InstalledSkill['source'];
  status: HermesSkillPackageStatus;
  successCount?: number;
  version: string;
}

export interface HermesSkillPackageSummary {
  cacheDir: string;
  disabledCount: number;
  enabledCount: number;
  installedCount: number;
  lockfilePath: string;
  packages: HermesSkillPackageEntry[];
  reviewCommands: string[];
  rollbackableCount: number;
  skillRoot: string;
}

export interface HermesSkillPackageSummaryOptions {
  limit?: number;
  previewChars?: number;
}

export interface SetHermesSkillPackageLifecycleOptions {
  actor: string;
  reason?: string;
  updatedAt?: number;
}

export interface RollbackHermesSkillPackageOptions {
  actor: string;
  reason?: string;
  snapshotId?: string;
  updatedAt?: number;
}

export interface DeleteHermesSkillPackageOptions {
  actor: string;
  reason?: string;
}

export interface UpdateHermesSkillPackageOptions {
  actor: string;
  force?: boolean;
  reason?: string;
  updatedAt?: number;
  version?: string;
}

export interface ResetHermesSkillPackageOptions {
  actor: string;
  reason?: string;
  updatedAt?: number;
  version?: string;
}

export interface PatchHermesSkillPackageOptions {
  actor: string;
  expectedReplacements?: number;
  newText: string;
  oldText: string;
  reason?: string;
  updatedAt?: number;
}

export function buildHermesSkillPackageSummary(
  workDir: string = process.cwd(),
  options: HermesSkillPackageSummaryOptions = {},
): HermesSkillPackageSummary {
  const { cacheDir, hub, lockfilePath, skillRoot } = buildWorkspaceSkillsHub(workDir);
  const allPackages = hub
    .list()
    .map((skill) => summarizeInstalledSkill(
      skill,
      hub.getInstalledSkillHistory(skill.name),
      hub.info(skill.name)?.content,
      normalizePreviewChars(options.previewChars),
    ))
    .sort((left, right) =>
      statusRank(left.status) - statusRank(right.status)
      || right.installedAt - left.installedAt
      || left.name.localeCompare(right.name),
    );
  const packages = allPackages.slice(0, normalizeLimit(options.limit));

  return {
    cacheDir,
    disabledCount: allPackages.filter((skill) => !skill.enabled).length,
    enabledCount: allPackages.filter((skill) => skill.enabled).length,
    installedCount: allPackages.length,
    lockfilePath,
    packages,
    reviewCommands: [
      'buddy skills list --all --json',
      'buddy skills doctor --json',
      'buddy skills learning-usage --json',
      'Use skill_manage with approved_by for enable/disable/deprecate/delete/patch/rollback/reset/update.',
    ],
    rollbackableCount: allPackages.reduce((total, skill) => total + skill.rollbackableCount, 0),
    skillRoot,
  };
}

export function setHermesSkillPackageLifecycle(
  workDir: string,
  skillName: string,
  action: HermesSkillPackageLifecycleAction,
  options: SetHermesSkillPackageLifecycleOptions,
): HermesSkillPackageEntry | null {
  const name = skillName.trim();
  const actor = options.actor.trim();
  if (!name) {
    throw new Error('skillName is required for skill lifecycle changes.');
  }
  if (!actor) {
    throw new Error('actor is required for skill lifecycle changes.');
  }

  const { hub } = buildWorkspaceSkillsHub(workDir);
  const enabled = action === 'enable';
  const installed = hub.setEnabled(name, enabled, {
    actor,
    reason: options.reason?.trim() || undefined,
    status: action === 'deprecate' ? 'deprecated' : enabled ? 'active' : 'disabled',
    updatedAt: options.updatedAt,
  });
  if (!installed) return null;

  return summarizeInstalledSkill(
    installed,
    hub.getInstalledSkillHistory(installed.name),
    hub.info(installed.name)?.content,
    normalizePreviewChars(undefined),
  );
}

export function rollbackHermesSkillPackage(
  workDir: string,
  skillName: string,
  options: RollbackHermesSkillPackageOptions,
): HermesSkillPackageEntry | null {
  const name = skillName.trim();
  const actor = options.actor.trim();
  if (!name) {
    throw new Error('skillName is required for skill rollback.');
  }
  if (!actor) {
    throw new Error('actor is required for skill rollback.');
  }

  const { hub } = buildWorkspaceSkillsHub(workDir);
  const rolledBack = hub.rollbackInstalledSkill(
    name,
    options.snapshotId?.trim() || undefined,
    {
      actor,
      reason: options.reason?.trim() || undefined,
      updatedAt: options.updatedAt,
    },
  );
  if (!rolledBack) return null;

  return summarizeInstalledSkill(
    rolledBack.installed,
    hub.getInstalledSkillHistory(rolledBack.installed.name),
    hub.info(rolledBack.installed.name)?.content,
    normalizePreviewChars(undefined),
  );
}

export async function deleteHermesSkillPackage(
  workDir: string,
  skillName: string,
  options: DeleteHermesSkillPackageOptions,
): Promise<boolean> {
  const name = skillName.trim();
  const actor = options.actor.trim();
  if (!name) {
    throw new Error('skillName is required for skill deletion.');
  }
  if (!actor) {
    throw new Error('actor is required for skill deletion.');
  }

  const { hub } = buildWorkspaceSkillsHub(workDir);
  return hub.uninstall(name);
}

export async function updateHermesSkillPackage(
  workDir: string,
  skillName: string,
  options: UpdateHermesSkillPackageOptions,
): Promise<HermesSkillPackageEntry | null> {
  const name = skillName.trim();
  const actor = options.actor.trim();
  if (!name) {
    throw new Error('skillName is required for skill update.');
  }
  if (!actor) {
    throw new Error('actor is required for skill update.');
  }

  const { hub } = buildWorkspaceSkillsHub(workDir);
  const updated = await hub.updateInstalledSkill(name, {
    actor,
    force: options.force,
    reason: options.reason?.trim() || undefined,
    updatedAt: options.updatedAt,
    version: options.version?.trim() || undefined,
  });
  if (!updated) return null;

  return summarizeInstalledSkill(
    updated.installed,
    hub.getInstalledSkillHistory(updated.installed.name),
    hub.info(updated.installed.name)?.content,
    normalizePreviewChars(undefined),
  );
}

export async function resetHermesSkillPackage(
  workDir: string,
  skillName: string,
  options: ResetHermesSkillPackageOptions,
): Promise<HermesSkillPackageEntry | null> {
  const name = skillName.trim();
  const actor = options.actor.trim();
  if (!name) {
    throw new Error('skillName is required for skill reset.');
  }
  if (!actor) {
    throw new Error('actor is required for skill reset.');
  }

  const { hub } = buildWorkspaceSkillsHub(workDir);
  const reset = await hub.resetInstalledSkill(name, {
    actor,
    reason: options.reason?.trim() || undefined,
    updatedAt: options.updatedAt,
    version: options.version?.trim() || undefined,
  });
  if (!reset) return null;

  return summarizeInstalledSkill(
    reset.installed,
    hub.getInstalledSkillHistory(reset.installed.name),
    hub.info(reset.installed.name)?.content,
    normalizePreviewChars(undefined),
  );
}

export function patchHermesSkillPackage(
  workDir: string,
  skillName: string,
  options: PatchHermesSkillPackageOptions,
): HermesSkillPackageEntry | null {
  const name = skillName.trim();
  const actor = options.actor.trim();
  if (!name) {
    throw new Error('skillName is required for skill patch.');
  }
  if (!actor) {
    throw new Error('actor is required for skill patch.');
  }
  if (options.oldText.length === 0) {
    throw new Error('oldText is required for skill patch.');
  }

  const { hub } = buildWorkspaceSkillsHub(workDir);
  const patched = hub.patchInstalledSkill(
    name,
    options.oldText,
    options.newText,
    {
      actor,
      expectedReplacements: options.expectedReplacements,
      reason: options.reason?.trim() || undefined,
      updatedAt: options.updatedAt,
    },
  );
  if (!patched) return null;

  return summarizeInstalledSkill(
    patched.installed,
    hub.getInstalledSkillHistory(patched.installed.name),
    hub.info(patched.installed.name)?.content,
    normalizePreviewChars(undefined),
  );
}

function summarizeInstalledSkill(
  skill: InstalledSkill,
  history: SkillHistoryResult | null,
  content: string | undefined,
  previewChars: number,
): HermesSkillPackageEntry {
  const lifecycle = skill.lifecycle;
  const usage = skill.usage;
  const enabled = skill.enabled !== false;
  const preview = buildContentPreview(content, previewChars);
  const firewall = buildFirewallPreview(skill, history);

  return {
    ...(typeof usage?.averageDurationMs === 'number' ? { averageDurationMs: usage.averageDurationMs } : {}),
    ...preview,
    enabled,
    exists: history?.current.exists ?? false,
    ...(typeof usage?.failureCount === 'number' ? { failureCount: usage.failureCount } : {}),
    ...firewall,
    installedAt: skill.installedAt,
    integrityOk: history?.current.integrityOk ?? false,
    ...(typeof usage?.invocationCount === 'number' ? { invocationCount: usage.invocationCount } : {}),
    ...(usage?.lastError ? { lastError: usage.lastError } : {}),
    ...(lifecycle?.reason ? { lastLifecycleReason: lifecycle.reason } : {}),
    ...(lifecycle?.updatedBy ? { lastLifecycleReviewer: lifecycle.updatedBy } : {}),
    ...(typeof usage?.lastUsedAt === 'number' ? { lastUsedAt: usage.lastUsedAt } : {}),
    name: skill.name,
    path: skill.path,
    rollbackableCount: history?.rollbackableCount ?? 0,
    ...(typeof history?.current.sizeBytes === 'number' ? { sizeBytes: history.current.sizeBytes } : {}),
    source: skill.source,
    status: lifecycleStatus(skill, lifecycle),
    ...(typeof usage?.successCount === 'number' ? { successCount: usage.successCount } : {}),
    version: skill.version,
  };
}

function buildFirewallPreview(
  skill: InstalledSkill,
  history: SkillHistoryResult | null,
): Pick<
  HermesSkillPackageEntry,
  | 'firewallCapabilities'
  | 'firewallFindingCount'
  | 'firewallQuarantineRequired'
  | 'firewallScore'
  | 'firewallSummary'
  | 'firewallVerdict'
> {
  if (history?.current.exists !== true) return {};

  try {
    const report = scanSkillFirewall(path.dirname(skill.path));
    return {
      firewallCapabilities: report.capabilities,
      firewallFindingCount: report.findings.length,
      firewallQuarantineRequired: report.quarantineRequired,
      firewallScore: report.score,
      firewallSummary: report.summary,
      firewallVerdict: report.verdict,
    };
  } catch {
    return {};
  }
}

function buildWorkspaceSkillsHub(workDir: string): {
  cacheDir: string;
  hub: SkillsHub;
  lockfilePath: string;
  skillRoot: string;
} {
  const root = path.resolve(workDir);
  const lockfilePath = path.join(root, '.codebuddy', 'skills-lock.json');
  const skillRoot = path.join(root, '.codebuddy', 'skills');
  const cacheDir = path.join(root, '.codebuddy', 'skills-cache');
  const hub = new SkillsHub({
    cacheDir,
    lockfilePath,
    skillsDir: skillRoot,
  });
  return { cacheDir, hub, lockfilePath, skillRoot };
}

function lifecycleStatus(
  skill: InstalledSkill,
  lifecycle: SkillLifecycleState | undefined,
): HermesSkillPackageStatus {
  if (lifecycle?.status === 'deprecated') return 'deprecated';
  if (skill.enabled === false) return 'disabled';
  return 'active';
}

function statusRank(status: HermesSkillPackageStatus): number {
  if (status === 'deprecated') return 0;
  if (status === 'disabled') return 1;
  return 2;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(100, Math.max(1, Math.trunc(value as number)));
}

function normalizePreviewChars(value: number | undefined): number {
  if (!Number.isFinite(value)) return 360;
  return Math.min(2_000, Math.max(0, Math.trunc(value as number)));
}

function buildContentPreview(
  content: string | undefined,
  maxChars: number,
): Pick<HermesSkillPackageEntry, 'contentPreview' | 'contentPreviewTruncated'> {
  if (!content || maxChars <= 0) return {};
  const body = content
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!body) return {};

  return {
    contentPreview: body.slice(0, maxChars),
    ...(body.length > maxChars ? { contentPreviewTruncated: true } : {}),
  };
}
