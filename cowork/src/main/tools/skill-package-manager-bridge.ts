import { isAbsolute, resolve } from 'path';
import { loadCoreModule } from '../utils/core-loader';

type HermesSkillPackageStatus = 'active' | 'disabled' | 'deprecated';
type HermesSkillPackageFirewallCapability =
  | 'dynamic-code'
  | 'filesystem'
  | 'network'
  | 'prototype-pollution'
  | 'secrets'
  | 'shell';
type HermesSkillPackageFirewallVerdict = 'allow' | 'review' | 'quarantine';
export type SkillPackageLifecycleAction = 'enable' | 'disable' | 'deprecate';

export interface SkillPackageManagerEntry {
  averageDurationMs?: number;
  contentPreview?: string;
  contentPreviewTruncated?: boolean;
  enabled: boolean;
  exists: boolean;
  failureCount?: number;
  firewallCapabilities?: HermesSkillPackageFirewallCapability[];
  firewallFindingCount?: number;
  firewallQuarantineRequired?: boolean;
  firewallScore?: number;
  firewallSummary?: string;
  firewallVerdict?: HermesSkillPackageFirewallVerdict;
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
  source: 'hub' | 'local' | 'git';
  status: HermesSkillPackageStatus;
  successCount?: number;
  version: string;
}

export interface SkillPackageManagerSummary {
  cacheDir: string;
  disabledCount: number;
  enabledCount: number;
  health?: {
    healthyCount: number;
    integrityMismatchCount: number;
    issueCount: number;
    missingFileCount: number;
    nextCommand: string;
    ok: boolean;
  };
  installedCount: number;
  lockfilePath: string;
  packages: SkillPackageManagerEntry[];
  reviewCommands: string[];
  rollbackableCount: number;
  skillRoot: string;
}

export interface ListSkillPackagesForReviewOptions {
  limit?: number;
  rootDir: string;
}

export interface SetSkillPackageLifecycleForReviewOptions {
  action: SkillPackageLifecycleAction;
  approvedBy: string;
  name: string;
  reason?: string;
  rootDir: string;
}

export interface RollbackSkillPackageForReviewOptions {
  approvedBy: string;
  name: string;
  reason?: string;
  rootDir: string;
  snapshotId?: string;
}

export interface DeleteSkillPackageForReviewOptions {
  approvedBy: string;
  name: string;
  reason?: string;
  rootDir: string;
}

export interface UpdateSkillPackageForReviewOptions {
  approvedBy: string;
  force?: boolean;
  name: string;
  reason?: string;
  rootDir: string;
  version?: string;
}

export interface ResetSkillPackageForReviewOptions {
  approvedBy: string;
  name: string;
  reason?: string;
  rootDir: string;
  version?: string;
}

export interface PatchSkillPackageForReviewOptions {
  approvedBy: string;
  expectedReplacements?: number;
  name: string;
  newText?: string;
  oldText?: string;
  reason?: string;
  rootDir: string;
}

export interface SetSkillPackageLifecycleForReviewResult {
  package: SkillPackageManagerEntry;
  summary: SkillPackageManagerSummary;
}

export type RollbackSkillPackageForReviewResult = SetSkillPackageLifecycleForReviewResult;

export type UpdateSkillPackageForReviewResult = SetSkillPackageLifecycleForReviewResult;

export type ResetSkillPackageForReviewResult = SetSkillPackageLifecycleForReviewResult;

export type PatchSkillPackageForReviewResult = SetSkillPackageLifecycleForReviewResult;

export interface DeleteSkillPackageForReviewResult {
  deletedName: string;
  summary: SkillPackageManagerSummary;
}

interface HermesSkillPackageModule {
  buildHermesSkillPackageSummary: (
    workDir: string,
    options?: { limit?: number },
  ) => SkillPackageManagerSummary;
  setHermesSkillPackageLifecycle?: (
    workDir: string,
    skillName: string,
    action: SkillPackageLifecycleAction,
    options: { actor: string; reason?: string },
  ) => SkillPackageManagerEntry | null;
  rollbackHermesSkillPackage?: (
    workDir: string,
    skillName: string,
    options: { actor: string; reason?: string; snapshotId?: string },
  ) => SkillPackageManagerEntry | null;
  deleteHermesSkillPackage?: (
    workDir: string,
    skillName: string,
    options: { actor: string; reason?: string },
  ) => Promise<boolean> | boolean;
  updateHermesSkillPackage?: (
    workDir: string,
    skillName: string,
    options: { actor: string; force?: boolean; reason?: string; version?: string },
  ) => Promise<SkillPackageManagerEntry | null> | SkillPackageManagerEntry | null;
  resetHermesSkillPackage?: (
    workDir: string,
    skillName: string,
    options: { actor: string; reason?: string; version?: string },
  ) => Promise<SkillPackageManagerEntry | null> | SkillPackageManagerEntry | null;
  patchHermesSkillPackage?: (
    workDir: string,
    skillName: string,
    options: {
      actor: string;
      expectedReplacements?: number;
      newText: string;
      oldText: string;
      reason?: string;
    },
  ) => SkillPackageManagerEntry | null;
}

export async function listSkillPackagesForReview(
  options: ListSkillPackagesForReviewOptions,
): Promise<SkillPackageManagerSummary | null> {
  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  if (!rootDir) return null;

  const mod = await loadCoreModule<HermesSkillPackageModule>('agent/hermes-skill-package-summary.js');
  if (!mod?.buildHermesSkillPackageSummary) return null;

  return mod.buildHermesSkillPackageSummary(rootDir, {
    limit: normalizeLimit(options.limit),
  });
}

export async function setSkillPackageLifecycleForReview(
  options: SetSkillPackageLifecycleForReviewOptions,
): Promise<SetSkillPackageLifecycleForReviewResult> {
  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  if (!rootDir) {
    throw new Error('An absolute workspace root is required to manage a skill package.');
  }

  const approvedBy = options.approvedBy.trim();
  if (!approvedBy) {
    throw new Error('approvedBy is required to manage a skill package from Cowork.');
  }

  const name = options.name.trim();
  if (!name) {
    throw new Error('name is required to manage a skill package from Cowork.');
  }

  if (!['enable', 'disable', 'deprecate'].includes(options.action)) {
    throw new Error(`Unsupported skill package lifecycle action: ${options.action}`);
  }

  const mod = await loadCoreModule<HermesSkillPackageModule>('agent/hermes-skill-package-summary.js');
  if (!mod?.setHermesSkillPackageLifecycle || !mod.buildHermesSkillPackageSummary) {
    throw new Error('Core skill package lifecycle module is unavailable.');
  }

  const updated = mod.setHermesSkillPackageLifecycle(rootDir, name, options.action, {
    actor: approvedBy,
    reason: options.reason?.trim() || undefined,
  });
  if (!updated) {
    throw new Error(`Skill package not found: ${name}`);
  }

  return {
    package: updated,
    summary: mod.buildHermesSkillPackageSummary(rootDir, { limit: 20 }),
  };
}

export async function rollbackSkillPackageForReview(
  options: RollbackSkillPackageForReviewOptions,
): Promise<RollbackSkillPackageForReviewResult> {
  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  if (!rootDir) {
    throw new Error('An absolute workspace root is required to rollback a skill package.');
  }

  const approvedBy = options.approvedBy.trim();
  if (!approvedBy) {
    throw new Error('approvedBy is required to rollback a skill package from Cowork.');
  }

  const name = options.name.trim();
  if (!name) {
    throw new Error('name is required to rollback a skill package from Cowork.');
  }

  const mod = await loadCoreModule<HermesSkillPackageModule>('agent/hermes-skill-package-summary.js');
  if (!mod?.rollbackHermesSkillPackage || !mod.buildHermesSkillPackageSummary) {
    throw new Error('Core skill package rollback module is unavailable.');
  }

  const updated = mod.rollbackHermesSkillPackage(rootDir, name, {
    actor: approvedBy,
    reason: options.reason?.trim() || undefined,
    snapshotId: options.snapshotId?.trim() || undefined,
  });
  if (!updated) {
    throw new Error(`Skill package not found: ${name}`);
  }

  return {
    package: updated,
    summary: mod.buildHermesSkillPackageSummary(rootDir, { limit: 20 }),
  };
}

export async function deleteSkillPackageForReview(
  options: DeleteSkillPackageForReviewOptions,
): Promise<DeleteSkillPackageForReviewResult> {
  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  if (!rootDir) {
    throw new Error('An absolute workspace root is required to delete a skill package.');
  }

  const approvedBy = options.approvedBy.trim();
  if (!approvedBy) {
    throw new Error('approvedBy is required to delete a skill package from Cowork.');
  }

  const name = options.name.trim();
  if (!name) {
    throw new Error('name is required to delete a skill package from Cowork.');
  }

  const mod = await loadCoreModule<HermesSkillPackageModule>('agent/hermes-skill-package-summary.js');
  if (!mod?.deleteHermesSkillPackage || !mod.buildHermesSkillPackageSummary) {
    throw new Error('Core skill package deletion module is unavailable.');
  }

  const deleted = await mod.deleteHermesSkillPackage(rootDir, name, {
    actor: approvedBy,
    reason: options.reason?.trim() || undefined,
  });
  if (!deleted) {
    throw new Error(`Skill package not found: ${name}`);
  }

  return {
    deletedName: name,
    summary: mod.buildHermesSkillPackageSummary(rootDir, { limit: 20 }),
  };
}

export async function updateSkillPackageForReview(
  options: UpdateSkillPackageForReviewOptions,
): Promise<UpdateSkillPackageForReviewResult> {
  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  if (!rootDir) {
    throw new Error('An absolute workspace root is required to update a skill package.');
  }

  const approvedBy = options.approvedBy.trim();
  if (!approvedBy) {
    throw new Error('approvedBy is required to update a skill package from Cowork.');
  }

  const name = options.name.trim();
  if (!name) {
    throw new Error('name is required to update a skill package from Cowork.');
  }

  const mod = await loadCoreModule<HermesSkillPackageModule>('agent/hermes-skill-package-summary.js');
  if (!mod?.updateHermesSkillPackage || !mod.buildHermesSkillPackageSummary) {
    throw new Error('Core skill package update module is unavailable.');
  }

  const updated = await mod.updateHermesSkillPackage(rootDir, name, {
    actor: approvedBy,
    force: options.force,
    reason: options.reason?.trim() || undefined,
    version: options.version?.trim() || undefined,
  });
  if (!updated) {
    throw new Error(`Skill package not found: ${name}`);
  }

  return {
    package: updated,
    summary: mod.buildHermesSkillPackageSummary(rootDir, { limit: 20 }),
  };
}

export async function resetSkillPackageForReview(
  options: ResetSkillPackageForReviewOptions,
): Promise<ResetSkillPackageForReviewResult> {
  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  if (!rootDir) {
    throw new Error('An absolute workspace root is required to reset a skill package.');
  }

  const approvedBy = options.approvedBy.trim();
  if (!approvedBy) {
    throw new Error('approvedBy is required to reset a skill package from Cowork.');
  }

  const name = options.name.trim();
  if (!name) {
    throw new Error('name is required to reset a skill package from Cowork.');
  }

  const mod = await loadCoreModule<HermesSkillPackageModule>('agent/hermes-skill-package-summary.js');
  if (!mod?.resetHermesSkillPackage || !mod.buildHermesSkillPackageSummary) {
    throw new Error('Core skill package reset module is unavailable.');
  }

  const reset = await mod.resetHermesSkillPackage(rootDir, name, {
    actor: approvedBy,
    reason: options.reason?.trim() || undefined,
    version: options.version?.trim() || undefined,
  });
  if (!reset) {
    throw new Error(`Skill package not found: ${name}`);
  }

  return {
    package: reset,
    summary: mod.buildHermesSkillPackageSummary(rootDir, { limit: 20 }),
  };
}

export async function patchSkillPackageForReview(
  options: PatchSkillPackageForReviewOptions,
): Promise<PatchSkillPackageForReviewResult> {
  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  if (!rootDir) {
    throw new Error('An absolute workspace root is required to patch a skill package.');
  }

  const approvedBy = options.approvedBy.trim();
  if (!approvedBy) {
    throw new Error('approvedBy is required to patch a skill package from Cowork.');
  }

  const name = options.name.trim();
  if (!name) {
    throw new Error('name is required to patch a skill package from Cowork.');
  }

  if (typeof options.oldText !== 'string' || options.oldText.length === 0) {
    throw new Error('oldText is required to patch a skill package from Cowork.');
  }
  if (typeof options.newText !== 'string') {
    throw new Error('newText is required to patch a skill package from Cowork.');
  }

  const mod = await loadCoreModule<HermesSkillPackageModule>('agent/hermes-skill-package-summary.js');
  if (!mod?.patchHermesSkillPackage || !mod.buildHermesSkillPackageSummary) {
    throw new Error('Core skill package patch module is unavailable.');
  }

  const patched = mod.patchHermesSkillPackage(rootDir, name, {
    actor: approvedBy,
    expectedReplacements: options.expectedReplacements,
    newText: options.newText,
    oldText: options.oldText,
    reason: options.reason?.trim() || undefined,
  });
  if (!patched) {
    throw new Error(`Skill package not found: ${name}`);
  }

  return {
    package: patched,
    summary: mod.buildHermesSkillPackageSummary(rootDir, { limit: 20 }),
  };
}

function normalizeAbsoluteRoot(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  return isAbsolute(trimmed) ? resolve(trimmed) : null;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(100, Math.max(1, Math.trunc(value as number)));
}
