import fs from 'fs/promises';
import path from 'path';
import type { Dirent } from 'fs';
import { parseSkillFile, validateSkill } from '../skills/parser.js';
import { computeChecksum, getSkillsHub, SkillsHub } from '../skills/hub.js';
import { generateDiff } from '../utils/diff-generator.js';
import type { ResearchScriptJobArtifact } from './research-script-job-artifact.js';
import type { ResearchScriptJobRunResult } from './research-script-job-runner.js';

export const RESEARCH_SCRIPT_SKILL_CANDIDATE_REVIEW_SCHEMA_VERSION = 1;
const SKILL_CANDIDATE_DIFF_PREVIEW_CHARS = 900;
const SKILL_CANDIDATE_DIFF_PREVIEW_LINES = 32;
const LEARNING_SKILL_CANDIDATE_MIN_SUCCESSFUL_RUNS = 2;

export type MaterializedSkillCandidateKind = 'research-script' | 'learning';

export interface ResearchScriptSkillCandidate {
  eligible: boolean;
  id: string;
  kind: MaterializedSkillCandidateKind;
  reason: string;
  skillName: string;
  skillPath: string;
  sourceJobId: string;
  sourceRunId?: string;
  successfulRunCount: number;
  title: string;
  toolSequence?: string[];
  markdown: string;
}

export interface BuildResearchScriptSkillCandidateOptions {
  minSuccessfulRuns?: number;
  skillRoot?: string;
}

export interface ResearchScriptSkillCandidateReviewManifest {
  approvalRequired: true;
  candidateId: string;
  eligible: boolean;
  generatedAt: string;
  kind?: MaterializedSkillCandidateKind;
  promotionThreshold?: number;
  reason?: string;
  schemaVersion: typeof RESEARCH_SCRIPT_SKILL_CANDIDATE_REVIEW_SCHEMA_VERSION;
  skillName: string;
  sourceJobId: string;
  sourceRunId?: string;
  status: 'awaiting_human_approval' | 'not_eligible';
  successfulRunCount: number;
  toolSequence?: string[];
}

export interface MaterializeResearchScriptSkillCandidateOptions {
  generatedAt?: Date | number | string;
  overwrite?: boolean;
  rootDir: string;
}

export interface MaterializedResearchScriptSkillCandidate {
  absoluteReviewManifestPath: string;
  absoluteSkillPath: string;
  candidateId: string;
  eligible: boolean;
  reviewManifest: ResearchScriptSkillCandidateReviewManifest;
  reviewManifestPath: string;
  skillName: string;
  skillPath: string;
}

export interface InstallResearchScriptSkillCandidateOptions {
  approvedAt?: Date | number | string;
  approvedBy?: string;
  overwrite?: boolean;
  rootDir: string;
  workspaceSkillRoot?: string;
}

export interface ReadMaterializedResearchScriptSkillCandidateOptions {
  rootDir: string;
}

export interface ListMaterializedResearchScriptSkillCandidatesOptions {
  rootDir: string;
  skillRoot?: string;
}

export type SkillCandidateInstallState =
  | 'not-installed'
  | 'installed-current'
  | 'installed-different'
  | 'installed-missing';

export interface SkillCandidateDiffPreview {
  addedLines: number;
  preview: string;
  removedLines: number;
  summary: string;
  truncated: boolean;
}

export interface ResearchScriptSkillCandidateWithInstallState extends ResearchScriptSkillCandidate {
  candidateChecksum: string;
  candidateDiffPreview?: SkillCandidateDiffPreview;
  installState: SkillCandidateInstallState;
  installedChecksum?: string;
  installedIntegrityOk?: boolean;
  installedPath?: string;
  installedVersion?: string;
  reviewCommands: string[];
}

export interface InstalledResearchScriptSkillCandidate {
  absoluteInstalledPath: string;
  approvedAt: string;
  approvedBy: string;
  candidateId: string;
  installedPath: string;
  skillName: string;
  sourceCandidatePath: string;
}

interface RawResearchScriptSkillCandidateReviewManifest {
  approvalRequired?: unknown;
  candidateId?: unknown;
  eligible?: unknown;
  generatedAt?: unknown;
  kind?: unknown;
  promotionThreshold?: unknown;
  reason?: unknown;
  schemaVersion?: unknown;
  skillName?: unknown;
  sourceJobId?: unknown;
  sourceRunId?: unknown;
  status?: unknown;
  successfulRunCount?: unknown;
  toolSequence?: unknown;
}

export function buildResearchScriptSkillCandidate(
  job: ResearchScriptJobArtifact,
  runs: ResearchScriptJobRunResult[],
  options: BuildResearchScriptSkillCandidateOptions = {},
): ResearchScriptSkillCandidate {
  const minSuccessfulRuns = normalizeMinSuccessfulRuns(options.minSuccessfulRuns);
  const successfulRuns = runs.filter((run) => run.status === 'completed' && run.exitCode === 0);
  const skillName = `research-${slugify(job.title)}`;
  const skillRoot = normalizeSkillRoot(options.skillRoot);
  const skillPath = `${skillRoot}/${skillName}/SKILL.md`;
  const eligible = successfulRuns.length >= minSuccessfulRuns;
  const reason = eligible
    ? `${successfulRuns.length} successful runs met the promotion threshold.`
    : `${successfulRuns.length}/${minSuccessfulRuns} successful runs; keep as a script job until it proves repeatable.`;

  const candidate = {
    eligible,
    id: `skill-candidate-${stableHash([job.id, skillName].join('|'))}`,
    kind: 'research-script' as const,
    reason,
    skillName,
    skillPath,
    sourceJobId: job.id,
    successfulRunCount: successfulRuns.length,
    title: `${job.title} skill candidate`,
  };

  return {
    ...candidate,
    markdown: renderResearchScriptSkillCandidateMarkdown(job, successfulRuns, candidate),
  };
}

export async function materializeResearchScriptSkillCandidate(
  candidate: ResearchScriptSkillCandidate,
  options: MaterializeResearchScriptSkillCandidateOptions,
): Promise<MaterializedResearchScriptSkillCandidate> {
  const rootDir = path.resolve(options.rootDir);
  const absoluteSkillPath = resolvePathInsideRoot(rootDir, candidate.skillPath);
  const reviewManifestPath = buildReviewManifestPath(candidate.skillPath);
  const absoluteReviewManifestPath = resolvePathInsideRoot(rootDir, reviewManifestPath);
  const writeFlag = options.overwrite ? 'w' : 'wx';
  const reviewManifest = buildResearchScriptSkillCandidateReviewManifest(candidate, options.generatedAt);

  await Promise.all([
    fs.mkdir(path.dirname(absoluteSkillPath), { recursive: true }),
    fs.mkdir(path.dirname(absoluteReviewManifestPath), { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(absoluteSkillPath, `${candidate.markdown.trimEnd()}\n`, {
      encoding: 'utf8',
      flag: writeFlag,
    }),
    fs.writeFile(absoluteReviewManifestPath, `${JSON.stringify(reviewManifest, null, 2)}\n`, {
      encoding: 'utf8',
      flag: writeFlag,
    }),
  ]);

  return {
    absoluteReviewManifestPath,
    absoluteSkillPath,
    candidateId: candidate.id,
    eligible: candidate.eligible,
    reviewManifest,
    reviewManifestPath,
    skillName: candidate.skillName,
    skillPath: candidate.skillPath,
  };
}

export async function readMaterializedResearchScriptSkillCandidate(
  candidatePath: string,
  options: ReadMaterializedResearchScriptSkillCandidateOptions,
): Promise<ResearchScriptSkillCandidate> {
  const rootDir = path.resolve(options.rootDir);
  const absoluteSkillPath = resolveCandidateSkillPath(rootDir, candidatePath);
  const skillPath = toRootRelativePath(rootDir, absoluteSkillPath);
  const absoluteReviewManifestPath = resolvePathInsideRoot(rootDir, buildReviewManifestPath(skillPath));
  const [markdown, manifestRaw] = await Promise.all([
    fs.readFile(absoluteSkillPath, 'utf8'),
    fs.readFile(absoluteReviewManifestPath, 'utf8'),
  ]);
  const manifest = parseReviewManifest(manifestRaw);

  return {
    eligible: manifest.eligible,
    id: manifest.candidateId,
    kind: manifest.kind ?? 'research-script',
    reason: extractMarkdownField(markdown, 'Reason') || reviewStatusReason(manifest),
    skillName: manifest.skillName,
    skillPath,
    sourceJobId: manifest.sourceJobId,
    sourceRunId: manifest.sourceRunId,
    successfulRunCount: manifest.successfulRunCount,
    title: extractMarkdownTitle(markdown) || `${manifest.skillName} skill candidate`,
    toolSequence: manifest.toolSequence,
    markdown,
  };
}

export async function listMaterializedResearchScriptSkillCandidates(
  options: ListMaterializedResearchScriptSkillCandidatesOptions,
): Promise<ResearchScriptSkillCandidate[]> {
  const rootDir = path.resolve(options.rootDir);
  const skillRoot = normalizeSkillRoot(options.skillRoot ?? '.codebuddy/skill-candidates');
  const absoluteSkillRoot = resolvePathInsideRoot(rootDir, skillRoot);
  const reviewManifestPaths = await findReviewManifestPaths(absoluteSkillRoot);
  const candidates = await Promise.all(
    reviewManifestPaths.map((reviewManifestPath) => readMaterializedResearchScriptSkillCandidate(
      path.dirname(reviewManifestPath),
      { rootDir },
    )),
  );

  return candidates.sort((left, right) => left.skillName.localeCompare(right.skillName));
}

export async function listMaterializedResearchScriptSkillCandidatesWithInstallState(
  options: ListMaterializedResearchScriptSkillCandidatesOptions,
): Promise<ResearchScriptSkillCandidateWithInstallState[]> {
  const rootDir = path.resolve(options.rootDir);
  const candidates = await listMaterializedResearchScriptSkillCandidates(options);
  const hub = buildWorkspaceSkillsHub(rootDir);

  return candidates.map((candidate) => summarizeCandidateInstallState(candidate, hub));
}

export async function readMaterializedResearchScriptSkillCandidateWithInstallState(
  candidatePath: string,
  options: ReadMaterializedResearchScriptSkillCandidateOptions,
): Promise<ResearchScriptSkillCandidateWithInstallState> {
  const rootDir = path.resolve(options.rootDir);
  const candidate = await readMaterializedResearchScriptSkillCandidate(candidatePath, { rootDir });
  return summarizeCandidateInstallState(candidate, buildWorkspaceSkillsHub(rootDir));
}

export async function installResearchScriptSkillCandidate(
  candidate: ResearchScriptSkillCandidate,
  options: InstallResearchScriptSkillCandidateOptions,
): Promise<InstalledResearchScriptSkillCandidate> {
  if (!candidate.eligible) {
    throw new Error(`${formatCandidateKind(candidate)} skill candidate is not eligible for install: ${candidate.reason}`);
  }

  const approvedBy = normalizeApproval(options.approvedBy);
  if (!approvedBy) {
    throw new Error(`Human approval is required before installing a ${formatCandidateKind(candidate)} skill candidate.`);
  }

  const rootDir = path.resolve(options.rootDir);
  const sourceCandidatePath = candidate.skillPath;
  const absoluteCandidatePath = resolvePathInsideRoot(rootDir, sourceCandidatePath);
  const installedPath = buildWorkspaceSkillPath(candidate.skillName, options.workspaceSkillRoot);
  const absoluteInstalledPath = resolvePathInsideRoot(rootDir, installedPath);
  const approvedAt = normalizeCreatedAt(options.approvedAt);
  let reviewedMarkdown = '';

  try {
    reviewedMarkdown = await fs.readFile(absoluteCandidatePath, 'utf8');
  } catch {
    throw new Error(`Materialized candidate not found: ${sourceCandidatePath}`);
  }

  const installMarkdown = renderApprovedSkillMarkdown(
    { ...candidate, markdown: reviewedMarkdown },
    approvedBy,
    approvedAt,
  );
  const parsedSkill = parseSkillFile(installMarkdown, installedPath, 'workspace');
  const validation = validateSkill(parsedSkill);
  if (!validation.valid) {
    throw new Error(`Research script skill candidate is not a valid SKILL.md: ${validation.errors.join(', ')}`);
  }

  await fs.mkdir(path.dirname(absoluteInstalledPath), { recursive: true });
  await fs.writeFile(absoluteInstalledPath, installMarkdown, {
    encoding: 'utf8',
    flag: options.overwrite ? 'w' : 'wx',
  });
  buildWorkspaceSkillsHub(rootDir).registerLocalSkillFile(candidate.skillName, absoluteInstalledPath);
  getSkillsHub().registerLocalSkillFile(candidate.skillName, absoluteInstalledPath);

  return {
    absoluteInstalledPath,
    approvedAt,
    approvedBy,
    candidateId: candidate.id,
    installedPath,
    skillName: candidate.skillName,
    sourceCandidatePath,
  };
}

function renderResearchScriptSkillCandidateMarkdown(
  job: ResearchScriptJobArtifact,
  successfulRuns: ResearchScriptJobRunResult[],
  candidate: Omit<ResearchScriptSkillCandidate, 'markdown'>,
): string {
  const lines = [
    '---',
    `name: ${candidate.skillName}`,
    'version: 0.1.0',
    `description: Reusable workflow candidate promoted from ${job.title}.`,
    'tags: [research-script, generated-candidate, public-data]',
    '---',
    '',
    `# ${candidate.title}`,
    '',
    `Status: ${candidate.eligible ? 'eligible for human review' : 'not eligible yet'}`,
    `Reason: ${candidate.reason}`,
    `Source job: ${candidate.sourceJobId}`,
    `Successful runs: ${candidate.successfulRunCount}`,
    '',
    '## Use When',
    `- ${job.goal}`,
    '- The operator wants a repeatable public-data workflow with saved artifacts.',
    '- The task can follow the same input/output contract and sandbox policy.',
    '',
    '## Do Not Use When',
    '- The task would bypass login walls, paywalls, captcha, rate limits, or access controls.',
    '- The workflow would send emails, submit forms, call phone numbers, or contact leads automatically.',
    '- The data source is private, personal, or outside the declared public-data scope.',
    '',
    '## Input Contract',
    ...recordLines(job.inputContract),
    '',
    '## Output Contract',
    ...recordLines(job.outputContract),
    '',
    '## Sandbox Policy',
    `- Provider: ${job.sandboxPolicy.provider}`,
    `- Network: ${job.sandboxPolicy.network}`,
    `- Writes: ${job.sandboxPolicy.writes}`,
    `- Timeout: ${job.sandboxPolicy.timeoutMs}ms`,
    `- Page budget: ${job.sandboxPolicy.pageBudget}`,
    `- Stop on: ${job.sandboxPolicy.stopOn.join(', ')}`,
    '',
    '## Successful Run Evidence',
    ...successfulRuns.map((run) => `- ${run.jobId}: output ${run.outputPath}, summary ${run.summaryPath}, duration ${run.durationMs}ms`),
    '',
    '## Candidate Installation Notes',
    `- Review and edit this candidate before copying it to ${candidate.skillPath}.`,
    `- Keep the original script manifest at ${job.files.manifest} linked from the final skill docs.`,
    '- Preserve the no-contact-action assertion unless a human explicitly changes the workflow boundary.',
    '',
  ];

  return lines.join('\n');
}

function buildResearchScriptSkillCandidateReviewManifest(
  candidate: ResearchScriptSkillCandidate,
  generatedAt: Date | number | string | undefined,
): ResearchScriptSkillCandidateReviewManifest {
  return {
    approvalRequired: true,
    candidateId: candidate.id,
    eligible: candidate.eligible,
    generatedAt: normalizeCreatedAt(generatedAt),
    kind: 'research-script',
    schemaVersion: RESEARCH_SCRIPT_SKILL_CANDIDATE_REVIEW_SCHEMA_VERSION,
    skillName: candidate.skillName,
    sourceJobId: candidate.sourceJobId,
    status: candidate.eligible ? 'awaiting_human_approval' : 'not_eligible',
    successfulRunCount: candidate.successfulRunCount,
  };
}

function renderApprovedSkillMarkdown(
  candidate: ResearchScriptSkillCandidate,
  approvedBy: string,
  approvedAt: string,
): string {
  return [
    candidate.markdown.trimEnd(),
    '',
    '## Human Approval',
    `- Candidate id: ${candidate.id}`,
    candidate.sourceRunId
      ? `- Source run: ${candidate.sourceRunId}`
      : `- Source job: ${candidate.sourceJobId}`,
    `- Approved by: ${approvedBy}`,
    `- Approved at: ${approvedAt}`,
    '- Installation boundary: workspace skill; review before editing generated commands or source policies.',
    '',
  ].join('\n');
}

function buildReviewManifestPath(skillPath: string): string {
  return `${skillPath.replace(/\\/g, '/').replace(/\/?SKILL\.md$/i, '')}/candidate-review.json`;
}

function summarizeCandidateInstallState(
  candidate: ResearchScriptSkillCandidate,
  hub: SkillsHub,
): ResearchScriptSkillCandidateWithInstallState {
  const candidateChecksum = computeChecksum(candidate.markdown);
  const installedDetail = hub.info(candidate.skillName);
  if (!installedDetail) {
    return {
      ...candidate,
      candidateChecksum,
      installState: 'not-installed',
      reviewCommands: buildCandidateReviewCommands(candidate, 'not-installed'),
    };
  }

  const { content, installed, integrityOk } = installedDetail;
  if (typeof content !== 'string') {
    return {
      ...candidate,
      candidateChecksum,
      installState: 'installed-missing',
      installedIntegrityOk: false,
      installedPath: installed.path,
      installedVersion: installed.version,
      reviewCommands: buildCandidateReviewCommands(candidate, 'installed-missing'),
    };
  }

  const installedChecksum = computeChecksum(content);
  const installState = isInstalledFromCandidate(content, candidate.markdown)
    ? 'installed-current'
    : 'installed-different';
  const candidateDiffPreview = installState === 'installed-different'
    ? buildCandidateDiffPreview(candidate, content)
    : undefined;

  return {
    ...candidate,
    candidateChecksum,
    ...(candidateDiffPreview ? { candidateDiffPreview } : {}),
    installState,
    installedChecksum,
    installedIntegrityOk: integrityOk,
    installedPath: installed.path,
    installedVersion: installed.version,
    reviewCommands: buildCandidateReviewCommands(candidate, installState),
  };
}

function buildWorkspaceSkillsHub(rootDir: string): SkillsHub {
  return new SkillsHub({
    cacheDir: path.join(rootDir, '.codebuddy', 'skills-cache'),
    lockfilePath: path.join(rootDir, '.codebuddy', 'skills-lock.json'),
    skillsDir: path.join(rootDir, '.codebuddy', 'skills'),
  });
}

function isInstalledFromCandidate(installedContent: string, candidateMarkdown: string): boolean {
  const candidateBody = candidateMarkdown.trimEnd();
  const installedBody = installedContent.trimEnd();
  return installedBody === candidateBody || installedBody.startsWith(`${candidateBody}\n\n## Human Approval`);
}

function buildCandidateDiffPreview(
  candidate: ResearchScriptSkillCandidate,
  installedContent: string,
): SkillCandidateDiffPreview {
  const installedComparableContent = stripHumanApprovalSection(installedContent);
  const diff = generateDiff(
    installedComparableContent.split('\n'),
    candidate.markdown.trimEnd().split('\n'),
    `${candidate.skillName}/SKILL.md`,
    {
      contextLines: 2,
      summaryPrefix: 'Candidate changes',
    },
  );
  const linePreview = diff.diff
    .split('\n')
    .slice(0, SKILL_CANDIDATE_DIFF_PREVIEW_LINES)
    .join('\n');
  const preview = linePreview.slice(0, SKILL_CANDIDATE_DIFF_PREVIEW_CHARS);
  return {
    addedLines: diff.addedLines,
    preview,
    removedLines: diff.removedLines,
    summary: diff.summary,
    truncated: linePreview.length > preview.length || diff.diff.split('\n').length > SKILL_CANDIDATE_DIFF_PREVIEW_LINES,
  };
}

function stripHumanApprovalSection(content: string): string {
  return content.trimEnd().replace(/\n\n## Human Approval\n[\s\S]*$/m, '');
}

function buildCandidateReviewCommands(
  candidate: ResearchScriptSkillCandidate,
  installState: SkillCandidateInstallState,
): string[] {
  const commands = [
    `skill_manage action=candidate_view candidate_path=${candidate.skillPath}`,
  ];
  if (!candidate.eligible) {
    return commands;
  }
  if (installState === 'not-installed') {
    return [
      ...commands,
      `skill_manage action=candidate_install candidate_path=${candidate.skillPath} approved_by=<reviewer>`,
    ];
  }
  if (installState === 'installed-different') {
    return [
      ...commands,
      `skill_manage action=candidate_install candidate_path=${candidate.skillPath} approved_by=<reviewer> overwrite=true`,
      `skill_manage action=history name=${candidate.skillName}`,
    ];
  }
  if (installState === 'installed-missing') {
    return [
      ...commands,
      `skill_manage action=history name=${candidate.skillName}`,
      `skill_manage action=rollback name=${candidate.skillName} approved_by=<reviewer>`,
    ];
  }
  return [
    ...commands,
    `skill_manage action=view name=${candidate.skillName}`,
  ];
}

function parseReviewManifest(raw: string): ResearchScriptSkillCandidateReviewManifest {
  const parsed = JSON.parse(raw) as RawResearchScriptSkillCandidateReviewManifest;
  if (parsed.schemaVersion !== RESEARCH_SCRIPT_SKILL_CANDIDATE_REVIEW_SCHEMA_VERSION) {
    throw new Error(`Unsupported research script skill candidate review schema: ${String(parsed.schemaVersion)}`);
  }
  if (parsed.approvalRequired !== true) {
    throw new Error('Research script skill candidate review manifest must require approval.');
  }
  if (typeof parsed.candidateId !== 'string' || parsed.candidateId.trim().length === 0) {
    throw new Error('Research script skill candidate review manifest is missing candidateId.');
  }
  if (typeof parsed.skillName !== 'string' || parsed.skillName.trim().length === 0) {
    throw new Error('Research script skill candidate review manifest is missing skillName.');
  }

  const base = {
    approvalRequired: true as const,
    candidateId: parsed.candidateId.trim(),
    generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '',
    ...(typeof parsed.promotionThreshold === 'number' && Number.isFinite(parsed.promotionThreshold)
      ? { promotionThreshold: Math.max(1, Math.trunc(parsed.promotionThreshold)) }
      : {}),
    ...(typeof parsed.reason === 'string' && parsed.reason.trim().length > 0
      ? { reason: parsed.reason.trim().replace(/\s+/g, ' ') }
      : {}),
    schemaVersion: RESEARCH_SCRIPT_SKILL_CANDIDATE_REVIEW_SCHEMA_VERSION as typeof RESEARCH_SCRIPT_SKILL_CANDIDATE_REVIEW_SCHEMA_VERSION,
    skillName: parsed.skillName.trim(),
  };

  if (typeof parsed.sourceRunId === 'string' && parsed.sourceRunId.trim().length > 0) {
    const successfulRunCount = typeof parsed.successfulRunCount === 'number' && Number.isFinite(parsed.successfulRunCount)
      ? Math.trunc(parsed.successfulRunCount)
      : 1;
    const eligible = parsed.eligible === true &&
      parsed.status === 'awaiting_human_approval' &&
      successfulRunCount >= LEARNING_SKILL_CANDIDATE_MIN_SUCCESSFUL_RUNS;
    return {
      ...base,
      eligible,
      kind: 'learning',
      sourceJobId: '',
      sourceRunId: parsed.sourceRunId.trim(),
      status: eligible ? 'awaiting_human_approval' : 'not_eligible',
      successfulRunCount,
      toolSequence: normalizeToolSequence(parsed.toolSequence),
    };
  }

  if (typeof parsed.sourceJobId !== 'string' || parsed.sourceJobId.trim().length === 0) {
    throw new Error('Skill candidate review manifest is missing sourceJobId or sourceRunId.');
  }
  if (typeof parsed.successfulRunCount !== 'number' || !Number.isFinite(parsed.successfulRunCount)) {
    throw new Error('Research script skill candidate review manifest is missing successfulRunCount.');
  }
  if (typeof parsed.eligible !== 'boolean') {
    throw new Error('Research script skill candidate review manifest is missing eligible.');
  }
  return {
    ...base,
    eligible: parsed.eligible,
    kind: 'research-script',
    sourceJobId: parsed.sourceJobId.trim(),
    status: parsed.eligible ? 'awaiting_human_approval' : 'not_eligible',
    successfulRunCount: Math.trunc(parsed.successfulRunCount),
  };
}

async function findReviewManifestPaths(absoluteDirectory: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const reviewManifestPaths: string[] = [];
  for (const entry of entries) {
    const absoluteEntryPath = path.join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) {
      reviewManifestPaths.push(...await findReviewManifestPaths(absoluteEntryPath));
    } else if (entry.isFile() && entry.name === 'candidate-review.json') {
      reviewManifestPaths.push(absoluteEntryPath);
    }
  }
  return reviewManifestPaths;
}

function reviewStatusReason(manifest: ResearchScriptSkillCandidateReviewManifest): string {
  if (manifest.reason) {
    return manifest.reason;
  }
  if (manifest.kind === 'learning' && manifest.sourceRunId) {
    return manifest.eligible
      ? `Learning Agent candidate from run ${manifest.sourceRunId} is awaiting human approval.`
      : `Learning Agent candidate from run ${manifest.sourceRunId} is not eligible yet.`;
  }
  return manifest.eligible
    ? `${manifest.successfulRunCount} successful runs met the promotion threshold.`
    : `${manifest.successfulRunCount} successful runs; candidate is not eligible yet.`;
}

function normalizeToolSequence(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sequence = value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);
  return sequence.length > 0 ? sequence : undefined;
}

function formatCandidateKind(candidate: ResearchScriptSkillCandidate): string {
  return candidate.kind === 'learning' ? 'Learning Agent' : 'research script';
}

function extractMarkdownTitle(markdown: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
}

function extractMarkdownField(markdown: string, fieldName: string): string {
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return markdown.match(new RegExp(`^${escaped}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? '';
}

function buildWorkspaceSkillPath(skillName: string, workspaceSkillRoot: string | undefined): string {
  const root = normalizeSkillRoot(workspaceSkillRoot ?? '.codebuddy/skills');
  return `${root}/${skillName}/SKILL.md`;
}

function recordLines(record: Record<string, string>): string[] {
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return ['- none'];
  }
  return entries.map(([key, value]) => `- ${key}: ${value}`);
}

function normalizeMinSuccessfulRuns(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 2;
  }
  return Math.min(10, Math.max(1, Math.trunc(value as number)));
}

function normalizeSkillRoot(value: string | undefined): string {
  return value?.trim().replace(/\\/g, '/').replace(/\/+$/g, '') || '.codebuddy/skill-candidates';
}

function normalizeApproval(value: string | undefined): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function resolvePathInsideRoot(rootDir: string, relativePath: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRoot, normalizeRelativePath(relativePath));
  assertPathInsideRoot(resolvedRoot, resolvedPath, relativePath);
  return resolvedPath;
}

function resolveCandidateSkillPath(rootDir: string, candidatePath: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const candidateSkillPath = candidatePath.trim().replace(/\\/g, '/').endsWith('/SKILL.md')
    ? candidatePath
    : path.join(candidatePath, 'SKILL.md');
  const resolvedPath = path.isAbsolute(candidateSkillPath)
    ? path.resolve(candidateSkillPath)
    : path.resolve(resolvedRoot, normalizeRelativePath(candidateSkillPath));
  assertPathInsideRoot(resolvedRoot, resolvedPath, candidatePath);
  return resolvedPath;
}

function assertPathInsideRoot(rootDir: string, absolutePath: string, originalPath: string): void {
  const normalizedRoot = normalizeForCompare(path.resolve(rootDir));
  const normalizedPath = normalizeForCompare(path.resolve(absolutePath));
  if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Research script skill candidate path escapes root: ${originalPath}`);
  }
}

function toRootRelativePath(rootDir: string, absolutePath: string): string {
  return path.relative(path.resolve(rootDir), absolutePath).replace(/\\/g, '/');
}

function normalizeRelativePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function normalizeForCompare(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function normalizeCreatedAt(value: Date | number | string | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value.trim()) return value.trim();
  return new Date().toISOString();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'script';
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}
