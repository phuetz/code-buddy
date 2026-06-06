import { isAbsolute, resolve, sep } from 'path';
import { loadCoreModule } from '../utils/core-loader';

export type SkillCandidateFirewallVerdict = 'allow' | 'review' | 'quarantine';

export interface SkillCandidateFirewallSummary {
  capabilities: string[];
  findingCounts: {
    critical: number;
    high: number;
    info: number;
    low: number;
    medium: number;
  };
  quarantineRequired: boolean;
  score: number;
  summary: string;
  verdict: SkillCandidateFirewallVerdict;
}

export interface SkillCandidateProofCommandSummary {
  command?: string;
  durationMs?: number;
  isTest: boolean;
  runId: string;
  sequence: number;
  success?: boolean;
  toolName: string;
}

export interface SkillCandidateGradedTaskSummary {
  command: string;
  expected: 'pass';
  id: string;
  isTest?: boolean;
  sourceJobId?: string;
  sourceRunId?: string;
  timeoutMs?: number;
  toolName?: string;
}

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
  evidenceRunIds?: string[];
  id: string;
  installState?: 'not-installed' | 'installed-current' | 'installed-different' | 'installed-missing';
  installedChecksum?: string;
  installedIntegrityOk?: boolean;
  installedPath?: string;
  installedVersion?: string;
  firewall?: SkillCandidateFirewallSummary;
  gradedTasks?: SkillCandidateGradedTaskSummary[];
  kind: string;
  promotionThreshold?: number;
  proofBackedSuccessCount?: number;
  proofCommands?: SkillCandidateProofCommandSummary[];
  proofStatus?: string;
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
  evidenceRunIds?: string[];
  id: string;
  installState?: 'not-installed' | 'installed-current' | 'installed-different' | 'installed-missing';
  installedChecksum?: string;
  installedIntegrityOk?: boolean;
  installedPath?: string;
  installedVersion?: string;
  gradedTasks?: SkillCandidateGradedTaskSummary[];
  kind?: string;
  promotionThreshold?: number;
  proofBackedSuccessCount?: number;
  proofCommands?: SkillCandidateProofCommandSummary[];
  proofStatus?: string;
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

interface SkillFirewallReportLike {
  capabilities?: unknown[];
  findingCounts?: Partial<Record<'critical' | 'high' | 'info' | 'low' | 'medium', number>>;
  quarantineRequired?: boolean;
  score?: number;
  summary?: string;
  verdict?: SkillCandidateFirewallVerdict;
}

interface SkillFirewallModule {
  scanSkillFirewall?: (targetPath: string) => SkillFirewallReportLike;
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
    ? candidates.filter((candidate) => candidate.eligible)
    : candidates;
  const firewall = await loadSkillFirewallModule();

  return Promise.all(visible
    .slice(0, normalizeLimit(options.limit))
    .map((candidate) => summarizeSkillCandidate(candidate, {
      firewall,
      rootDir,
    })));
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
  const firewall = await loadSkillFirewallModule();
  const firewallSummary = summarizeCandidateFirewall(candidate, {
    firewall,
    rootDir,
  });
  if (firewallSummary?.quarantineRequired) {
    throw new Error(`Skill Firewall quarantine required for ${candidate.skillName}: ${firewallSummary.summary}`);
  }
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
    candidate: summarizeSkillCandidate(refreshed, {
      firewall,
      rootDir,
    }),
    installed,
  };
}

function summarizeSkillCandidate(
  candidate: ResearchScriptSkillCandidate,
  options: {
    firewall: SkillFirewallModule | null;
    rootDir: string;
  },
): SkillCandidateReviewSummary {
  return {
    candidateChecksum: candidate.candidateChecksum,
    candidateDiffPreview: candidate.candidateDiffPreview,
    eligible: candidate.eligible,
    evidenceRunIds: candidate.evidenceRunIds,
    id: candidate.id,
    installState: candidate.installState,
    installedChecksum: candidate.installedChecksum,
    installedIntegrityOk: candidate.installedIntegrityOk,
    installedPath: candidate.installedPath,
    installedVersion: candidate.installedVersion,
    firewall: summarizeCandidateFirewall(candidate, options),
    gradedTasks: candidate.gradedTasks,
    kind: candidate.kind ?? (candidate.sourceRunId ? 'learning' : 'research-script'),
    promotionThreshold: candidate.promotionThreshold,
    proofBackedSuccessCount: candidate.proofBackedSuccessCount,
    proofCommands: candidate.proofCommands,
    proofStatus: candidate.proofStatus,
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

async function loadSkillFirewallModule(): Promise<SkillFirewallModule | null> {
  try {
    return await loadCoreModule<SkillFirewallModule>('security/skill-scanner.js');
  } catch {
    return null;
  }
}

function summarizeCandidateFirewall(
  candidate: ResearchScriptSkillCandidate,
  options: {
    firewall: SkillFirewallModule | null;
    rootDir: string;
  },
): SkillCandidateFirewallSummary | undefined {
  if (!options.firewall?.scanSkillFirewall) return undefined;
  const candidateSkillPath = resolveCandidateSkillPath(options.rootDir, candidate.skillPath);
  if (!candidateSkillPath) return undefined;
  const report = options.firewall.scanSkillFirewall(candidateSkillPath);
  return normalizeFirewallSummary(report);
}

function normalizeFirewallSummary(
  report: SkillFirewallReportLike,
): SkillCandidateFirewallSummary {
  const counts = report.findingCounts ?? {};
  const verdict = report.verdict === 'quarantine' || report.verdict === 'review'
    ? report.verdict
    : 'allow';
  return {
    capabilities: Array.isArray(report.capabilities)
      ? report.capabilities.filter((item): item is string => typeof item === 'string')
      : [],
    findingCounts: {
      critical: counts.critical ?? 0,
      high: counts.high ?? 0,
      info: counts.info ?? 0,
      low: counts.low ?? 0,
      medium: counts.medium ?? 0,
    },
    quarantineRequired: Boolean(report.quarantineRequired) || verdict === 'quarantine',
    score: Number.isFinite(report.score) ? Math.max(0, Math.min(100, Math.trunc(report.score as number))) : 100,
    summary: typeof report.summary === 'string' && report.summary.trim()
      ? report.summary
      : `Skill Firewall ${verdict}`,
    verdict,
  };
}

function resolveCandidateSkillPath(rootDir: string, skillPath: string): string | null {
  const resolvedRoot = resolve(rootDir);
  const resolvedPath = resolve(resolvedRoot, skillPath);
  if (resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
    return resolvedPath;
  }
  return null;
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
