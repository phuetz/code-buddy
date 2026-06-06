import fs from 'fs';
import os from 'os';
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
import { safeWorkspacePath } from './hermes-public-paths.js';

const LEARNING_SKILL_CANDIDATE_MIN_SUCCESSFUL_RUNS = 2;

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
  staleTempPath?: boolean;
  successCount?: number;
  version: string;
}

export interface HermesSkillCandidateReviewStatus {
  eligibleCount: number;
  ineligibleCount: number;
  listCommand: string;
  nextInspectCommand?: string;
  root: string;
  samples: Array<{
    candidatePath: string;
    candidateId: string;
    eligible: boolean;
    inspectCommand: string;
    installCommand?: string;
    kind: string;
    promotion?: {
      reason: string;
      status: string;
      successfulRunCount: number;
      threshold: number;
    };
    reviewManifestPath: string;
    skillName: string;
  }>;
  totalCount: number;
}

export interface HermesSkillPackageSummary {
  cacheDir: string;
  candidateReview: HermesSkillCandidateReviewStatus;
  disabledCount: number;
  enabledCount: number;
  health: {
    healthyCount: number;
    integrityMismatchCount: number;
    issueCount: number;
    missingFileCount: number;
    nextCommand: string;
    ok: boolean;
    staleTempMissingCount: number;
  };
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
  const root = path.resolve(workDir);
  const { cacheDir, hub, lockfilePath, skillRoot } = buildWorkspaceSkillsHub(workDir);
  const allPackages = hub
    .list()
    .map((skill) => summarizeInstalledSkill(
      root,
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
  const health = buildPackageHealth(allPackages);

  return {
    cacheDir: safeWorkspacePath(root, cacheDir),
    candidateReview: buildSkillCandidateReviewStatus(workDir),
    disabledCount: allPackages.filter((skill) => !skill.enabled).length,
    enabledCount: allPackages.filter((skill) => skill.enabled).length,
    health,
    installedCount: allPackages.length,
    lockfilePath: safeWorkspacePath(root, lockfilePath),
    packages,
    reviewCommands: [
      'buddy skills list --all --json',
      'buddy skills doctor --json',
      'buddy skills learning-usage --json',
      'buddy skills enable <name> --approved-by <reviewer>',
      'buddy skills disable <name> --approved-by <reviewer>',
      'buddy skills deprecate <name> --approved-by <reviewer>',
      'buddy skills delete <name> --approved-by <reviewer> --json',
      'buddy skills rollback <name> --approved-by <reviewer> --json',
      'buddy skills update <name> --approved-by <reviewer> --json',
      'buddy skills patch <name> --approved-by <reviewer> --old-text <text> --new-text <text> --json',
      'buddy skills reset <name> --approved-by <reviewer> --json',
    ],
    rollbackableCount: allPackages.reduce((total, skill) => total + skill.rollbackableCount, 0),
    skillRoot: safeWorkspacePath(root, skillRoot),
  };
}

export function renderHermesSkillPackageSummary(summary: HermesSkillPackageSummary): string {
  const lines = [
    `Hermes skills: ${summary.health.ok ? 'ok' : 'needs attention'}`,
    `Installed: ${summary.installedCount}`,
    `Enabled: ${summary.enabledCount}`,
    `Disabled: ${summary.disabledCount}`,
    `Rollback snapshots: ${summary.rollbackableCount}`,
    `Health: ${summary.health.healthyCount} healthy, ${summary.health.issueCount} issue(s)`,
    `Next command: ${summary.health.nextCommand}`,
    `Skill candidates: ${summary.candidateReview.totalCount}` +
      ` (${summary.candidateReview.eligibleCount} eligible, ${summary.candidateReview.ineligibleCount} not eligible)`,
    `Candidate review: ${summary.candidateReview.listCommand}`,
    '',
    'Packages:',
  ];

  for (const skill of summary.packages) {
    lines.push(
      `- ${skill.name}@${skill.version}: ${skill.status}` +
      ` | exists=${skill.exists ? 'yes' : 'no'}` +
      ` | integrity=${skill.integrityOk ? 'ok' : 'mismatch'}`,
    );
  }

  if (summary.candidateReview.samples.length > 0) {
    lines.push('', 'Candidate samples:');
    for (const candidate of summary.candidateReview.samples) {
      const promotionStatus = candidate.promotion
        ? `${candidate.promotion.status} (${candidate.promotion.successfulRunCount}/${candidate.promotion.threshold})`
        : candidate.eligible ? 'eligible' : 'not_eligible';
      lines.push(`- ${candidate.skillName}: ${promotionStatus} -> ${candidate.inspectCommand}`);
      if (candidate.installCommand) {
        lines.push(`  Install: ${candidate.installCommand}`);
      }
      if (candidate.promotion?.reason) {
        lines.push(`  Reason: ${candidate.promotion.reason}`);
      }
    }
  }

  if (summary.reviewCommands.length > 0) {
    lines.push('', 'Review commands:', ...summary.reviewCommands.map((command) => `- ${command}`));
  }

  if (summary.candidateReview.nextInspectCommand) {
    lines.push(`- Next candidate: ${summary.candidateReview.nextInspectCommand}`);
  }

  return lines.join('\n');
}

function buildSkillCandidateReviewStatus(workDir: string): HermesSkillCandidateReviewStatus {
  const root = path.join(path.resolve(workDir), '.codebuddy', 'skill-candidates');
  const workspaceRoot = path.resolve(workDir);
  const candidates = readSkillCandidateSamples(path.resolve(workDir), root)
    .sort((left, right) =>
      Number(right.eligible) - Number(left.eligible)
      || left.skillName.localeCompare(right.skillName),
    );
  const eligibleCount = candidates.filter((candidate) => candidate.eligible).length;
  const listCommand = eligibleCount > 0
    ? 'buddy tools skill-candidate list --eligible-only --json'
    : 'buddy tools skill-candidate list --json';

  return {
    eligibleCount,
    ineligibleCount: candidates.length - eligibleCount,
    listCommand,
    ...(candidates[0]?.inspectCommand ? { nextInspectCommand: candidates[0].inspectCommand } : {}),
    root: safeWorkspacePath(workspaceRoot, root),
    samples: candidates.slice(0, 3),
    totalCount: candidates.length,
  };
}

function readSkillCandidateSamples(
  workDir: string,
  root: string,
): HermesSkillCandidateReviewStatus['samples'] {
  if (!fs.existsSync(root)) return [];
  const samples: HermesSkillCandidateReviewStatus['samples'] = [];
  for (const reviewPath of findCandidateReviewFiles(root)) {
    try {
      const candidateDir = path.dirname(reviewPath);
      const skillPath = path.join(candidateDir, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      const parsed = JSON.parse(fs.readFileSync(reviewPath, 'utf8')) as Record<string, unknown>;
      const skillName = typeof parsed.skillName === 'string' && parsed.skillName.trim()
        ? parsed.skillName.trim()
        : path.basename(candidateDir);
      const candidateId = typeof parsed.candidateId === 'string' && parsed.candidateId.trim()
        ? parsed.candidateId.trim()
        : path.basename(candidateDir);
      const kind = typeof parsed.kind === 'string' && parsed.kind.trim()
        ? parsed.kind.trim()
        : inferCandidateKind(root, candidateDir);
      const relativeDir = path.relative(workDir, candidateDir).replace(/\\/g, '/');
      const promotion = kind === 'learning' ? readCandidatePromotion(parsed) : undefined;
      const eligible = isCandidateReviewEligible(parsed, kind, promotion);
      const candidateArg = formatShellArg(relativeDir);
      samples.push({
        candidatePath: relativeDir,
        candidateId,
        eligible,
        inspectCommand: `buddy tools skill-candidate inspect ${candidateArg} --json`,
        ...(eligible ? {
          installCommand: `buddy tools skill-candidate install ${candidateArg} --approved-by <name> --json`,
        } : {}),
        kind,
        ...(promotion ? { promotion } : {}),
        reviewManifestPath: path.relative(workDir, reviewPath).replace(/\\/g, '/'),
        skillName,
      });
    } catch {
      // Ignore malformed review manifests; `tools skill-candidate inspect` gives the detailed error.
    }
  }
  return samples;
}

function readCandidatePromotion(parsed: Record<string, unknown>): NonNullable<HermesSkillCandidateReviewStatus['samples'][number]['promotion']> {
  const successfulRunCount = typeof parsed.successfulRunCount === 'number' && Number.isFinite(parsed.successfulRunCount)
    ? Math.trunc(parsed.successfulRunCount)
    : 1;
  const threshold = typeof parsed.promotionThreshold === 'number' && Number.isFinite(parsed.promotionThreshold)
    ? Math.max(1, Math.trunc(parsed.promotionThreshold))
    : LEARNING_SKILL_CANDIDATE_MIN_SUCCESSFUL_RUNS;
  const rawStatus = typeof parsed.status === 'string' && parsed.status.trim()
    ? parsed.status.trim()
    : parsed.eligible === true
      ? 'awaiting_human_approval'
      : 'not_eligible';
  const status = parsed.eligible === true &&
    rawStatus === 'awaiting_human_approval' &&
    successfulRunCount >= threshold
    ? 'awaiting_human_approval'
    : 'not_eligible';
  const fallbackReason = successfulRunCount >= threshold
    ? `${successfulRunCount} successful observations meet the promotion threshold.`
    : `${successfulRunCount}/${threshold} successful observations; candidate is not install-eligible yet.`;

  return {
    reason: normalizePromotionReason(parsed.reason, fallbackReason),
    status,
    successfulRunCount,
    threshold,
  };
}

function isCandidateReviewEligible(
  parsed: Record<string, unknown>,
  kind: string,
  promotion?: NonNullable<HermesSkillCandidateReviewStatus['samples'][number]['promotion']>,
): boolean {
  if (kind !== 'learning') {
    if (typeof parsed.eligible === 'boolean') return parsed.eligible;
    return parsed.status === 'awaiting_human_approval';
  }

  const promotionState = promotion ?? readCandidatePromotion(parsed);
  return parsed.eligible === true &&
    parsed.status === 'awaiting_human_approval' &&
    promotionState.successfulRunCount >= promotionState.threshold;
}

function normalizePromotionReason(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) return fallback;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  return cleaned.length > 240 ? `${cleaned.slice(0, 237)}...` : cleaned;
}

function findCandidateReviewFiles(root: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const reviewPath = path.join(entryPath, 'candidate-review.json');
      if (fs.existsSync(reviewPath)) {
        results.push(reviewPath);
      }
      results.push(...findCandidateReviewFiles(entryPath));
    }
  }
  return results;
}

function inferCandidateKind(root: string, candidateDir: string): string {
  const [topLevel] = path.relative(root, candidateDir).replace(/\\/g, '/').split('/');
  return topLevel === 'learning' ? 'learning' : 'research-script';
}

function formatShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function buildPackageHealth(packages: HermesSkillPackageEntry[]): HermesSkillPackageSummary['health'] {
  const missingFileCount = packages.filter((skill) => !skill.exists).length;
  const staleTempMissingCount = packages.filter((skill) => skill.staleTempPath).length;
  const integrityMismatchCount = packages.filter((skill) => skill.exists && !skill.integrityOk).length;
  const issueCount = missingFileCount + integrityMismatchCount;
  return {
    healthyCount: packages.length - issueCount,
    integrityMismatchCount,
    issueCount,
    missingFileCount,
    nextCommand: issueCount > 0 ? 'buddy skills doctor --json' : 'buddy skills learning-usage --json',
    ok: issueCount === 0,
    staleTempMissingCount,
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
    path.resolve(workDir),
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
    path.resolve(workDir),
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
    path.resolve(workDir),
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
    path.resolve(workDir),
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
    path.resolve(workDir),
    patched.installed,
    hub.getInstalledSkillHistory(patched.installed.name),
    hub.info(patched.installed.name)?.content,
    normalizePreviewChars(undefined),
  );
}

function summarizeInstalledSkill(
  workDir: string,
  skill: InstalledSkill,
  history: SkillHistoryResult | null,
  content: string | undefined,
  previewChars: number,
): HermesSkillPackageEntry {
  const lifecycle = skill.lifecycle;
  const usage = skill.usage;
  const enabled = skill.enabled !== false;
  const exists = history?.current.exists ?? false;
  const preview = buildContentPreview(content, previewChars);
  const firewall = buildFirewallPreview(workDir, skill, history);
  const staleTempPath = !exists && isPathInside(os.tmpdir(), skill.path);

  return {
    ...(typeof usage?.averageDurationMs === 'number' ? { averageDurationMs: usage.averageDurationMs } : {}),
    ...preview,
    enabled,
    exists,
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
    path: safeWorkspacePath(workDir, skill.path),
    rollbackableCount: history?.rollbackableCount ?? 0,
    ...(typeof history?.current.sizeBytes === 'number' ? { sizeBytes: history.current.sizeBytes } : {}),
    source: skill.source,
    status: lifecycleStatus(skill, lifecycle),
    ...(staleTempPath ? { staleTempPath } : {}),
    ...(typeof usage?.successCount === 'number' ? { successCount: usage.successCount } : {}),
    version: skill.version,
  };
}

function isPathInside(parentDir: string, childPath: string): boolean {
  const parent = path.resolve(parentDir);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function buildFirewallPreview(
  workDir: string,
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
    const skillPath = path.isAbsolute(skill.path) ? skill.path : path.resolve(workDir, skill.path);
    const report = scanSkillFirewall(path.dirname(skillPath));
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
