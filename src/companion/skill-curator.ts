import { mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import { createHash } from 'node:crypto';
import { readCompanionMissionBoard, type CompanionMission } from './mission-board.js';
import {
  readRecentCompanionPercepts,
  recordCompanionPercept,
  type CompanionPercept,
} from './percepts.js';
import { recordCompanionSafetyEvent } from './safety-ledger.js';
import { resolveUserName } from './user-name.js';

export type CompanionSkillCandidateStatus = 'draft' | 'reviewed' | 'promoted' | 'dismissed';
export type CompanionSkillEvidenceKind = 'mission' | 'percept';

export interface CompanionSkillEvidence {
  kind: CompanionSkillEvidenceKind;
  id: string;
  summary: string;
  timestamp?: string;
  weight: number;
}

export interface CompanionSkillCandidate {
  id: string;
  title: string;
  status: CompanionSkillCandidateStatus;
  score: number;
  trigger: string;
  routine: string[];
  command?: string;
  sourceTags: string[];
  evidence: CompanionSkillEvidence[];
  createdAt: string;
  updatedAt: string;
  promotedAt?: string;
  artifactPath?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  reviewedContentHash?: string;
}

export interface CompanionSkillCandidateStore {
  schemaVersion: 1;
  cwd: string;
  storePath: string;
  updatedAt: string;
  candidates: CompanionSkillCandidate[];
}

export interface CompanionSkillCuratorOptions {
  cwd?: string;
  now?: Date;
  storePath?: string;
  perceptLimit?: number;
  staleDays?: number;
  recordSuggestions?: boolean;
}

export interface CompanionSkillCuratorResult {
  store: CompanionSkillCandidateStore;
  created: number;
  updated: number;
  unchanged: number;
  pruned: number;
  perceptId?: string;
}

export interface CompanionSkillPromotionOptions {
  cwd?: string;
  now?: Date;
  storePath?: string;
  skillsDir?: string;
  recordPercept?: boolean;
}

export interface CompanionSkillReviewInput {
  reviewedBy: string;
  note?: string;
}

export interface CompanionSkillPromotionResult {
  candidate: CompanionSkillCandidate;
  artifactPath: string;
  perceptId?: string;
  safetyEventId?: string;
}

const DEFAULT_PERCEPT_LIMIT = 100;
const DEFAULT_STALE_DAYS = 45;
const GENERIC_TAGS = new Set([
  'companion',
  'self-improvement',
  'suggestion',
  'percept',
  'status',
  'tool',
  'mission',
  'mission-board',
  'mission-runner',
  'proactive',
  'impulse',
]);

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

export function getCompanionSkillCandidatePath(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'companion', 'skill-candidates.json');
}

export function getCompanionPromotedSkillsDir(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'companion', 'skills');
}

function resolveStorePath(
  options: Pick<CompanionSkillCuratorOptions, 'cwd' | 'storePath'> = {}
): string {
  const cwd = resolveCwd(options.cwd);
  return path.resolve(cwd, options.storePath || getCompanionSkillCandidatePath(cwd));
}

function resolveSkillsDir(options: CompanionSkillPromotionOptions): string {
  const cwd = resolveCwd(options.cwd);
  return path.resolve(cwd, options.skillsDir || getCompanionPromotedSkillsDir(cwd));
}

function emptyStore(options: CompanionSkillCuratorOptions = {}): CompanionSkillCandidateStore {
  const cwd = resolveCwd(options.cwd);
  return {
    schemaVersion: 1,
    cwd,
    storePath: resolveStorePath(options),
    updatedAt: (options.now || new Date()).toISOString(),
    candidates: [],
  };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

function isStatus(value: unknown): value is CompanionSkillCandidateStatus {
  return value === 'draft' || value === 'reviewed' || value === 'promoted' || value === 'dismissed';
}

function parseCandidate(value: unknown): CompanionSkillCandidate | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<CompanionSkillCandidate>;
  if (
    typeof raw.id !== 'string' ||
    typeof raw.title !== 'string' ||
    !isStatus(raw.status) ||
    typeof raw.score !== 'number' ||
    typeof raw.trigger !== 'string' ||
    !Array.isArray(raw.routine)
  ) {
    return null;
  }

  return {
    id: raw.id,
    title: raw.title,
    status: raw.status,
    score: Math.max(0, Math.min(100, raw.score)),
    trigger: raw.trigger,
    routine: raw.routine.filter(
      (step): step is string => typeof step === 'string' && step.trim().length > 0
    ),
    command: raw.command,
    sourceTags: Array.isArray(raw.sourceTags)
      ? normalizeTags(raw.sourceTags.filter((tag): tag is string => typeof tag === 'string'))
      : [],
    evidence: Array.isArray(raw.evidence)
      ? raw.evidence
          .filter(
            (item): item is CompanionSkillEvidence =>
              typeof item === 'object' &&
              item !== null &&
              (item as CompanionSkillEvidence).kind !== undefined &&
              typeof (item as CompanionSkillEvidence).id === 'string' &&
              typeof (item as CompanionSkillEvidence).summary === 'string'
          )
          .map((item) => ({
            kind: item.kind === 'mission' ? 'mission' : 'percept',
            id: item.id,
            summary: item.summary,
            timestamp: item.timestamp,
            weight: typeof item.weight === 'number' ? item.weight : 1,
          }))
      : [],
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    promotedAt: raw.promotedAt,
    artifactPath: raw.artifactPath,
    reviewedAt: raw.reviewedAt,
    reviewedBy: raw.reviewedBy,
    reviewNote: raw.reviewNote,
    reviewedContentHash: raw.reviewedContentHash,
  };
}

function candidateContentHash(candidate: CompanionSkillCandidate): string {
  return createHash('sha256').update(JSON.stringify({
    title: candidate.title,
    score: candidate.score,
    trigger: candidate.trigger,
    routine: candidate.routine,
    command: candidate.command ?? null,
    sourceTags: candidate.sourceTags,
    evidence: candidate.evidence,
  })).digest('hex');
}

function sortCandidates(candidates: CompanionSkillCandidate[]): CompanionSkillCandidate[] {
  const statusRank: Record<CompanionSkillCandidateStatus, number> = {
    reviewed: 0,
    draft: 1,
    promoted: 2,
    dismissed: 3,
  };
  return [...candidates].sort(
    (a, b) =>
      statusRank[a.status] - statusRank[b.status] ||
      b.score - a.score ||
      a.title.localeCompare(b.title)
  );
}

async function writeStore(store: CompanionSkillCandidateStore): Promise<void> {
  await mkdir(path.dirname(store.storePath), { recursive: true });
  await writeFile(store.storePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

export async function readCompanionSkillCandidates(
  options: CompanionSkillCuratorOptions = {}
): Promise<CompanionSkillCandidateStore> {
  const fallback = emptyStore(options);
  let raw: string;
  try {
    raw = await readFile(fallback.storePath, 'utf8');
  } catch {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CompanionSkillCandidateStore>;
    const candidates = Array.isArray(parsed.candidates)
      ? parsed.candidates
          .map(parseCandidate)
          .filter((candidate): candidate is CompanionSkillCandidate => Boolean(candidate))
      : [];
    return {
      schemaVersion: 1,
      cwd: typeof parsed.cwd === 'string' ? parsed.cwd : fallback.cwd,
      storePath: fallback.storePath,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : fallback.updatedAt,
      candidates: sortCandidates(candidates),
    };
  } catch {
    return fallback;
  }
}

function candidateFromMission(
  mission: CompanionMission,
  nowIso: string
): CompanionSkillCandidate | null {
  if (mission.status !== 'done' && mission.status !== 'in_progress') {
    return null;
  }

  const score = mission.status === 'done' ? 86 : 62;
  return {
    id: `skill-${slug(mission.sourceGapId || mission.id)}`,
    title: `${mission.dimension}: ${mission.title.replace(/^[^:]+:\s*/i, '')}`.slice(0, 96),
    status: 'draft',
    score,
    trigger: `When a ${mission.dimension} companion gap recurs or ${resolveUserName()} asks for this routine again.`,
    routine: [
      'Read companion status, recent percepts, mission board, and safety ledger before acting.',
      mission.command
        ? `Run or adapt the seed command: ${mission.command}.`
        : `Use this recommendation as the action seed: ${mission.recommendation}`,
      'Make one small workspace-scoped change or artifact that closes the loop.',
      'Record the outcome as a companion percept and update the mission board.',
      'Append a safety event for camera, microphone, screen, tool, or autonomy actions.',
    ],
    command: mission.command,
    sourceTags: normalizeTags(['mission', mission.dimension, ...mission.tags]),
    evidence: [
      {
        kind: 'mission',
        id: mission.id,
        summary: `${mission.status} mission: ${mission.recommendation}`,
        timestamp: mission.updatedAt,
        weight: mission.status === 'done' ? 3 : 2,
      },
    ],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function newestFirstByTimestamp<T extends { timestamp?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

function candidateFromPerceptTag(
  tag: string,
  percepts: CompanionPercept[],
  nowIso: string
): CompanionSkillCandidate | null {
  if (percepts.length < 2) {
    return null;
  }

  const evidence = newestFirstByTimestamp(percepts)
    .slice(0, 6)
    .map(
      (percept): CompanionSkillEvidence => ({
        kind: 'percept',
        id: percept.id,
        summary: percept.summary,
        timestamp: percept.timestamp,
        weight: percept.modality === 'suggestion' ? 2 : 1,
      })
    );
  const score = Math.min(82, 32 + evidence.reduce((sum, item) => sum + item.weight * 8, 0));
  const command = percepts
    .map((percept) => percept.payload.command)
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return {
    id: `skill-pattern-${slug(tag)}`,
    title: `pattern: ${tag}`,
    status: 'draft',
    score,
    trigger: `When companion percepts repeatedly mention ${tag}.`,
    routine: [
      `Review the newest ${tag} percept summaries and pick the smallest useful action.`,
      command
        ? `Start from the observed command: ${command}.`
        : 'Convert the repeated observation into one concrete command, checklist, or code change.',
      'Keep the action explicit, workspace-scoped, and reversible.',
      'Record a follow-up percept with what changed and whether it worked.',
    ],
    command,
    sourceTags: normalizeTags(['pattern', tag, ...percepts.flatMap((percept) => percept.tags)]),
    evidence,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function generatedCandidates(
  missions: CompanionMission[],
  percepts: CompanionPercept[],
  nowIso: string
): CompanionSkillCandidate[] {
  const candidates: CompanionSkillCandidate[] = [];
  for (const mission of missions) {
    const candidate = candidateFromMission(mission, nowIso);
    if (candidate) candidates.push(candidate);
  }

  const byTag = new Map<string, CompanionPercept[]>();
  for (const percept of percepts) {
    for (const tag of normalizeTags(percept.tags).filter((tag) => !GENERIC_TAGS.has(tag))) {
      const bucket = byTag.get(tag) || [];
      bucket.push(percept);
      byTag.set(tag, bucket);
    }
  }

  for (const [tag, taggedPercepts] of byTag) {
    const candidate = candidateFromPerceptTag(tag, taggedPercepts, nowIso);
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

function sameCandidateContent(a: CompanionSkillCandidate, b: CompanionSkillCandidate): boolean {
  return (
    JSON.stringify({
      title: a.title,
      score: a.score,
      trigger: a.trigger,
      routine: a.routine,
      command: a.command,
      sourceTags: a.sourceTags,
      evidence: a.evidence,
    }) ===
    JSON.stringify({
      title: b.title,
      score: b.score,
      trigger: b.trigger,
      routine: b.routine,
      command: b.command,
      sourceTags: b.sourceTags,
      evidence: b.evidence,
    })
  );
}

function mergeCandidate(
  generated: CompanionSkillCandidate,
  existing: CompanionSkillCandidate | undefined
): { candidate: CompanionSkillCandidate; changed: boolean; created: boolean } {
  if (!existing) {
    return { candidate: generated, changed: true, created: true };
  }

  if (existing.status === 'promoted' || existing.status === 'dismissed') {
    return { candidate: existing, changed: false, created: false };
  }

  const contentChanged = !sameCandidateContent(generated, existing);

  const candidate: CompanionSkillCandidate = {
    ...generated,
    status: existing.status === 'reviewed' && contentChanged ? 'draft' : existing.status,
    createdAt: existing.createdAt,
    promotedAt: existing.promotedAt,
    artifactPath: existing.artifactPath,
    ...(existing.status === 'reviewed' && !contentChanged
      ? {
          reviewedAt: existing.reviewedAt,
          reviewedBy: existing.reviewedBy,
          reviewNote: existing.reviewNote,
          reviewedContentHash: existing.reviewedContentHash,
        }
      : {}),
  };

  if (sameCandidateContent(candidate, existing)) {
    return { candidate: existing, changed: false, created: false };
  }

  return { candidate, changed: true, created: false };
}

function isStale(candidate: CompanionSkillCandidate, now: Date, staleDays: number): boolean {
  if (candidate.status !== 'draft') return false;
  const updated = Date.parse(candidate.updatedAt);
  if (Number.isNaN(updated)) return false;
  return now.getTime() - updated > staleDays * 24 * 60 * 60 * 1000;
}

export async function curateCompanionSkills(
  options: CompanionSkillCuratorOptions = {}
): Promise<CompanionSkillCuratorResult> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const nowIso = now.toISOString();
  const existingStore = await readCompanionSkillCandidates({ ...options, cwd, now });
  const board = await readCompanionMissionBoard({ cwd });
  const percepts = await readRecentCompanionPercepts({
    cwd,
    limit: options.perceptLimit || DEFAULT_PERCEPT_LIMIT,
  });
  const existingById = new Map(
    existingStore.candidates.map((candidate) => [candidate.id, candidate])
  );
  const generated = generatedCandidates(board.missions, percepts, nowIso);
  const generatedIds = new Set(generated.map((candidate) => candidate.id));
  const merged: CompanionSkillCandidate[] = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let pruned = 0;

  for (const candidate of generated) {
    const result = mergeCandidate(candidate, existingById.get(candidate.id));
    merged.push(result.candidate);
    if (result.created) created += 1;
    else if (result.changed) updated += 1;
    else unchanged += 1;
  }

  for (const candidate of existingStore.candidates) {
    if (generatedIds.has(candidate.id)) continue;
    if (isStale(candidate, now, options.staleDays || DEFAULT_STALE_DAYS)) {
      pruned += 1;
      continue;
    }
    merged.push(candidate);
  }

  const store: CompanionSkillCandidateStore = {
    schemaVersion: 1,
    cwd,
    storePath: existingStore.storePath,
    updatedAt: nowIso,
    candidates: sortCandidates(merged),
  };
  await writeStore(store);

  let perceptId: string | undefined;
  if (options.recordSuggestions !== false && store.candidates.length > 0) {
    const percept = await recordCompanionPercept(
      {
        modality: 'suggestion',
        source: 'companion_skill_curator',
        summary: `Companion skill curator refreshed ${store.candidates.length} candidate(s): ${created} created, ${updated} updated, ${pruned} pruned.`,
        confidence: 0.9,
        payload: {
          storePath: store.storePath,
          created,
          updated,
          unchanged,
          pruned,
          candidateIds: store.candidates.slice(0, 8).map((candidate) => candidate.id),
        },
        tags: ['skill-curator', 'learning-loop', 'self-improvement'],
      },
      { cwd }
    );
    perceptId = percept.id;
  }

  return { store, created, updated, unchanged, pruned, perceptId };
}

function buildSkillMarkdown(candidate: CompanionSkillCandidate, now: Date): string {
  const evidence =
    candidate.evidence.length > 0
      ? candidate.evidence.map((item) => `- ${item.kind}/${item.id}: ${item.summary}`).join('\n')
      : '- No evidence recorded.';
  const tags = candidate.sourceTags.length > 0 ? candidate.sourceTags.join(', ') : 'none';
  return [
    `# Companion Skill: ${candidate.title}`,
    '',
    `Promoted: ${now.toISOString()}`,
    `Candidate: ${candidate.id}`,
    `Score: ${candidate.score}/100`,
    `Tags: ${tags}`,
    `Reviewed by: ${candidate.reviewedBy ?? 'unknown'}`,
    `Reviewed at: ${candidate.reviewedAt ?? 'unknown'}`,
    '',
    '## Trigger',
    candidate.trigger,
    '',
    '## Routine',
    ...candidate.routine.map((step, index) => `${index + 1}. ${step}`),
    '',
    '## Seed Command',
    '```bash',
    candidate.command || '# No fixed command. Adapt the routine to the current mission.',
    '```',
    '',
    '## Evidence',
    evidence,
    '',
    '## Safety Contract',
    '- Keep camera, microphone, screen, remote runtime, and external-channel actions explicit.',
    '- Record a percept after use so the companion can improve or retire this skill.',
    '- Append a safety event for sensitive tools, sensory capture, or autonomous follow-up.',
    '',
  ].join('\n');
}

export async function reviewCompanionSkillCandidate(
  candidateId: string,
  input: CompanionSkillReviewInput,
  options: CompanionSkillPromotionOptions = {},
): Promise<CompanionSkillCandidate> {
  const reviewedBy = input.reviewedBy.trim();
  if (!reviewedBy) throw new Error('reviewedBy is required to review a companion skill candidate');
  if (reviewedBy.length > 120) throw new Error('reviewedBy must be 120 characters or fewer');
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const store = await readCompanionSkillCandidates({ cwd, storePath: options.storePath, now });
  const candidate = store.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error(`Companion skill candidate not found: ${candidateId}`);
  if (candidate.status === 'promoted' || candidate.status === 'dismissed') {
    throw new Error(`Cannot review ${candidate.status} companion skill candidate: ${candidateId}`);
  }
  const reviewNote = input.note?.trim();
  const reviewed: CompanionSkillCandidate = {
    ...candidate,
    status: 'reviewed',
    reviewedAt: now.toISOString(),
    reviewedBy,
    ...(reviewNote ? { reviewNote: reviewNote.slice(0, 1_000) } : {}),
    reviewedContentHash: candidateContentHash(candidate),
    updatedAt: now.toISOString(),
  };
  await updateCandidateInStore(store, reviewed);
  if (options.recordPercept !== false) {
    await recordCompanionPercept({
      modality: 'tool',
      source: 'companion_skill_curator',
      summary: `Reviewed companion skill candidate ${reviewed.id}.`,
      confidence: 1,
      payload: { candidateId: reviewed.id, reviewedBy },
      tags: ['skill-curator', 'skill-reviewed'],
    }, { cwd, now });
  }
  return reviewed;
}

async function updateCandidateInStore(
  store: CompanionSkillCandidateStore,
  candidate: CompanionSkillCandidate
): Promise<CompanionSkillCandidateStore> {
  const updated: CompanionSkillCandidateStore = {
    ...store,
    updatedAt: candidate.updatedAt,
    candidates: sortCandidates(
      store.candidates.map((item) => (item.id === candidate.id ? candidate : item))
    ),
  };
  await writeStore(updated);
  return updated;
}

export async function promoteCompanionSkillCandidate(
  candidateId: string,
  options: CompanionSkillPromotionOptions = {}
): Promise<CompanionSkillPromotionResult> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const store = await readCompanionSkillCandidates({ cwd, storePath: options.storePath, now });
  const candidate = store.candidates.find((item) => item.id === candidateId);
  if (!candidate) {
    throw new Error(`Companion skill candidate not found: ${candidateId}`);
  }
  if (candidate.status === 'dismissed') {
    throw new Error(`Cannot promote dismissed companion skill candidate: ${candidateId}`);
  }
  if (candidate.status !== 'reviewed') {
    throw new Error(`Companion skill candidate must be reviewed before promotion: ${candidateId}`);
  }
  if (!candidate.reviewedBy || !candidate.reviewedAt ||
      candidate.reviewedContentHash !== candidateContentHash(candidate)) {
    throw new Error(`Companion skill candidate review is missing or stale: ${candidateId}`);
  }

  const skillsDir = resolveSkillsDir({ ...options, cwd });
  const artifactPath = path.join(skillsDir, `${slug(candidate.id)}.md`);
  const promoted: CompanionSkillCandidate = {
    ...candidate,
    status: 'promoted',
    promotedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    artifactPath,
  };
  await mkdir(skillsDir, { recursive: true });
  await writeFile(artifactPath, buildSkillMarkdown(promoted, now), 'utf8');
  await updateCandidateInStore(store, promoted);

  let perceptId: string | undefined;
  let safetyEventId: string | undefined;
  if (options.recordPercept !== false) {
    const percept = await recordCompanionPercept(
      {
        modality: 'tool',
        source: 'companion_skill_curator',
        summary: `Promoted companion skill candidate ${promoted.id}.`,
        confidence: 1,
        payload: {
          candidateId: promoted.id,
          artifactPath,
        },
        tags: ['skill-curator', 'skill-promoted', ...promoted.sourceTags],
      },
      { cwd, now }
    );
    perceptId = percept.id;
  }

  try {
    const event = await recordCompanionSafetyEvent(
      {
        kind: 'data',
        risk: 'low',
        action: 'companion_skill_promote',
        reason: `Promoted reviewed companion routine ${promoted.id} into a workspace-local skill artifact.`,
        status: 'completed',
        source: 'companion_skill_curator',
        artifactPath,
        payload: {
          candidateId: promoted.id,
          score: promoted.score,
        },
        tags: ['skill-curator', 'skill-promoted'],
      },
      { cwd, now }
    );
    safetyEventId = event.id;
  } catch {
    // The promoted skill artifact remains useful even if audit append fails.
  }

  return { candidate: promoted, artifactPath, perceptId, safetyEventId };
}

export async function dismissCompanionSkillCandidate(
  candidateId: string,
  options: CompanionSkillPromotionOptions = {}
): Promise<CompanionSkillCandidate> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const store = await readCompanionSkillCandidates({ cwd, storePath: options.storePath, now });
  const candidate = store.candidates.find((item) => item.id === candidateId);
  if (!candidate) {
    throw new Error(`Companion skill candidate not found: ${candidateId}`);
  }

  const dismissed: CompanionSkillCandidate = {
    ...candidate,
    status: 'dismissed',
    updatedAt: now.toISOString(),
  };
  await updateCandidateInStore(store, dismissed);

  if (options.recordPercept !== false) {
    await recordCompanionPercept(
      {
        modality: 'tool',
        source: 'companion_skill_curator',
        summary: `Dismissed companion skill candidate ${dismissed.id}.`,
        confidence: 1,
        payload: { candidateId: dismissed.id },
        tags: ['skill-curator', 'skill-dismissed'],
      },
      { cwd, now }
    );
  }

  return dismissed;
}

export function formatCompanionSkillCandidates(store: CompanionSkillCandidateStore): string {
  const lines = [
    'Buddy Companion Skill Curator',
    '='.repeat(50),
    '',
    `Workspace: ${store.cwd}`,
    `Path: ${store.storePath}`,
    `Updated: ${store.updatedAt}`,
    `Candidates: ${store.candidates.length}`,
  ];

  if (store.candidates.length === 0) {
    lines.push(
      '',
      'No companion skill candidates yet. Run `buddy companion skills curate` after missions or percepts exist.'
    );
    return lines.join('\n');
  }

  for (const candidate of store.candidates) {
    lines.push(
      '',
      `[${candidate.status}] score=${candidate.score} ${candidate.id}`,
      `  ${candidate.title}`,
      `  Trigger: ${candidate.trigger}`,
      `  Evidence: ${candidate.evidence.length}`
    );
    if (candidate.command) lines.push(`  Command: ${candidate.command}`);
    if (candidate.artifactPath) lines.push(`  Artifact: ${candidate.artifactPath}`);
  }

  return lines.join('\n');
}

export function formatCompanionSkillCuratorResult(result: CompanionSkillCuratorResult): string {
  return [
    `Companion skills curated: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ${result.pruned} pruned.`,
    result.perceptId ? `Percept recorded: ${result.perceptId}` : '',
    '',
    formatCompanionSkillCandidates(result.store),
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatCompanionSkillPromotion(result: CompanionSkillPromotionResult): string {
  const lines = [
    `Companion skill promoted: ${result.candidate.id}`,
    `Artifact: ${result.artifactPath}`,
  ];
  if (result.perceptId) lines.push(`Percept recorded: ${result.perceptId}`);
  if (result.safetyEventId) lines.push(`Safety event recorded: ${result.safetyEventId}`);
  return lines.join('\n');
}
