import { isAbsolute, resolve } from 'path';
import { loadCoreModule } from '../utils/core-loader';

export interface SkillCandidateReviewSummary {
  candidateChecksum?: string;
  candidateDiffPreview?: {
    addedLines: number;
    preview: string;
    removedLines: number;
    summary: string;
    truncated: boolean;
  };
  eligible: boolean;
  id: string;
  installState?: 'not-installed' | 'installed-current' | 'installed-different' | 'installed-missing';
  installedChecksum?: string;
  installedIntegrityOk?: boolean;
  installedPath?: string;
  installedVersion?: string;
  kind: string;
  reason: string;
  reviewCommands?: string[];
  skillName: string;
  skillPath: string;
  sourceJobId: string;
  sourceRunId?: string;
  successfulRunCount: number;
  title: string;
  toolSequence?: string[];
}

export interface ListSkillCandidateReviewOptions {
  eligibleOnly?: boolean;
  limit?: number;
  rootDir: string;
  skillRoot?: string;
}

export interface InstallSkillCandidateForReviewOptions {
  approvedBy: string;
  candidatePath: string;
  overwrite?: boolean;
  rootDir: string;
  workspaceSkillRoot?: string;
}

export interface InstalledSkillCandidateForReview {
  absoluteInstalledPath: string;
  approvedAt: string;
  approvedBy: string;
  candidateId: string;
  installedPath: string;
  skillName: string;
  sourceCandidatePath: string;
}

export interface InstallSkillCandidateForReviewResult {
  candidate: SkillCandidateReviewSummary;
  installed: InstalledSkillCandidateForReview;
}

interface ResearchScriptSkillCandidate {
  candidateChecksum?: string;
  candidateDiffPreview?: {
    addedLines: number;
    preview: string;
    removedLines: number;
    summary: string;
    truncated: boolean;
  };
  eligible: boolean;
  id: string;
  installState?: 'not-installed' | 'installed-current' | 'installed-different' | 'installed-missing';
  installedChecksum?: string;
  installedIntegrityOk?: boolean;
  installedPath?: string;
  installedVersion?: string;
  kind?: string;
  reason: string;
  reviewCommands?: string[];
  skillName: string;
  skillPath: string;
  sourceJobId: string;
  sourceRunId?: string;
  successfulRunCount: number;
  title: string;
  toolSequence?: string[];
}

interface ResearchScriptSkillCandidateModule {
  installResearchScriptSkillCandidate?: (
    candidate: ResearchScriptSkillCandidate,
    options: {
      approvedBy?: string;
      overwrite?: boolean;
      rootDir: string;
      workspaceSkillRoot?: string;
    },
  ) => Promise<InstalledSkillCandidateForReview>;
  listMaterializedResearchScriptSkillCandidates: (options: {
    rootDir: string;
    skillRoot?: string;
  }) => Promise<ResearchScriptSkillCandidate[]>;
  listMaterializedResearchScriptSkillCandidatesWithInstallState?: (options: {
    rootDir: string;
    skillRoot?: string;
  }) => Promise<ResearchScriptSkillCandidate[]>;
  readMaterializedResearchScriptSkillCandidate?: (
    candidatePath: string,
    options: { rootDir: string },
  ) => Promise<ResearchScriptSkillCandidate>;
  readMaterializedResearchScriptSkillCandidateWithInstallState?: (
    candidatePath: string,
    options: { rootDir: string },
  ) => Promise<ResearchScriptSkillCandidate>;
}

export async function listSkillCandidatesForReview(
  options: ListSkillCandidateReviewOptions,
): Promise<SkillCandidateReviewSummary[]> {
  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  if (!rootDir) return [];

  const mod = await loadCoreModule<ResearchScriptSkillCandidateModule>(
    'agent/research-script-skill-candidate.js',
  );
  if (!mod?.listMaterializedResearchScriptSkillCandidates) return [];

  const listCandidates = mod.listMaterializedResearchScriptSkillCandidatesWithInstallState
    ?? mod.listMaterializedResearchScriptSkillCandidates;
  const candidates = await listCandidates({
    rootDir,
    skillRoot: normalizeSkillRoot(options.skillRoot),
  });
  const visible = options.eligibleOnly
    ? candidates.filter(isInstallReviewableSkillCandidate)
    : candidates;

  return visible
    .slice(0, normalizeLimit(options.limit))
    .map(summarizeSkillCandidate);
}

export async function installSkillCandidateForReview(
  options: InstallSkillCandidateForReviewOptions,
): Promise<InstallSkillCandidateForReviewResult> {
  const rootDir = normalizeAbsoluteRoot(options.rootDir);
  if (!rootDir) {
    throw new Error('An absolute workspace root is required to install a skill candidate.');
  }

  const approvedBy = options.approvedBy?.trim();
  if (!approvedBy) {
    throw new Error('approvedBy is required to install a skill candidate from Cowork.');
  }

  const candidatePath = options.candidatePath?.trim();
  if (!candidatePath) {
    throw new Error('candidatePath is required to install a skill candidate from Cowork.');
  }

  const mod = await loadCoreModule<ResearchScriptSkillCandidateModule>(
    'agent/research-script-skill-candidate.js',
  );
  if (!mod?.readMaterializedResearchScriptSkillCandidate || !mod.installResearchScriptSkillCandidate) {
    throw new Error('Core skill candidate install module is unavailable.');
  }

  const candidate = await mod.readMaterializedResearchScriptSkillCandidate(candidatePath, { rootDir });
  const installed = await mod.installResearchScriptSkillCandidate(candidate, {
    approvedBy,
    overwrite: Boolean(options.overwrite),
    rootDir,
    workspaceSkillRoot: normalizeSkillRoot(options.workspaceSkillRoot),
  });
  const refreshed = mod.readMaterializedResearchScriptSkillCandidateWithInstallState
    ? await mod.readMaterializedResearchScriptSkillCandidateWithInstallState(candidatePath, { rootDir })
    : candidate;

  return {
    candidate: summarizeSkillCandidate(refreshed),
    installed,
  };
}

function summarizeSkillCandidate(
  candidate: ResearchScriptSkillCandidate,
): SkillCandidateReviewSummary {
  return {
    candidateChecksum: candidate.candidateChecksum,
    candidateDiffPreview: candidate.candidateDiffPreview,
    eligible: candidate.eligible,
    id: candidate.id,
    installState: candidate.installState,
    installedChecksum: candidate.installedChecksum,
    installedIntegrityOk: candidate.installedIntegrityOk,
    installedPath: candidate.installedPath,
    installedVersion: candidate.installedVersion,
    kind: candidate.kind ?? (candidate.sourceRunId ? 'learning' : 'research-script'),
    reason: candidate.reason,
    reviewCommands: candidate.reviewCommands,
    skillName: candidate.skillName,
    skillPath: candidate.skillPath,
    sourceJobId: candidate.sourceJobId,
    sourceRunId: candidate.sourceRunId,
    successfulRunCount: candidate.successfulRunCount,
    title: candidate.title,
    toolSequence: candidate.toolSequence,
  };
}

function isInstallReviewableSkillCandidate(candidate: ResearchScriptSkillCandidate): boolean {
  if (!candidate.eligible) return false;
  if (candidate.reviewCommands?.length) {
    return candidate.reviewCommands.some((command) => command.includes('candidate_install'));
  }
  return candidate.installState !== 'installed-current' && candidate.installState !== 'installed-missing';
}

function normalizeAbsoluteRoot(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  return isAbsolute(trimmed) ? resolve(trimmed) : null;
}

function normalizeSkillRoot(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(50, Math.max(1, Math.trunc(value as number)));
}
