import path from 'path';
import {
  SkillsHub,
  type InstalledSkill,
  type SkillHistoryResult,
  type SkillLifecycleState,
} from '../skills/hub.js';

export type HermesSkillPackageStatus = 'active' | 'disabled' | 'deprecated';

export interface HermesSkillPackageEntry {
  averageDurationMs?: number;
  contentPreview?: string;
  contentPreviewTruncated?: boolean;
  enabled: boolean;
  exists: boolean;
  failureCount?: number;
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

export function buildHermesSkillPackageSummary(
  workDir: string = process.cwd(),
  options: HermesSkillPackageSummaryOptions = {},
): HermesSkillPackageSummary {
  const root = path.resolve(workDir);
  const lockfilePath = path.join(root, '.codebuddy', 'skills-lock.json');
  const skillRoot = path.join(root, '.codebuddy', 'skills');
  const cacheDir = path.join(root, '.codebuddy', 'skills-cache');
  const hub = new SkillsHub({
    cacheDir,
    lockfilePath,
    skillsDir: skillRoot,
  });
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
      'Use skill_manage with approved_by for enable/disable/deprecate/patch/rollback/update.',
    ],
    rollbackableCount: allPackages.reduce((total, skill) => total + skill.rollbackableCount, 0),
    skillRoot,
  };
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

  return {
    ...(typeof usage?.averageDurationMs === 'number' ? { averageDurationMs: usage.averageDurationMs } : {}),
    ...preview,
    enabled,
    exists: history?.current.exists ?? false,
    ...(typeof usage?.failureCount === 'number' ? { failureCount: usage.failureCount } : {}),
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
