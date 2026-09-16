/**
 * Spec pipeline store (BMAD-inspired, mapped onto Code Buddy primitives).
 *
 * The "delivery is fragile, stay on the loop" lesson: instead of letting the
 * agent run a whole monolithic objective, work is broken into a durable,
 * review-gated backlog. A story cannot be implemented until a human approves
 * its spec — the third application of the propose→review discipline already
 * shipped for lessons and the user model.
 *
 * This is NOT a port of BMAD; it maps the pattern onto Code Buddy files +
 * primitives. Artifacts live under `.codebuddy/specs/<project-id>/`:
 *
 *   project.json              — project manifest (id, title, phase)
 *   epics/<epic-id>.md        — epic (frontmatter + body)
 *   stories/<story-id>.md     — context-engineered story (frontmatter authoritative)
 *
 * Design rules (locked with the reviewer):
 *   1. Stable opaque ids (`st-…`), never positional, so re-sharding is safe.
 *   2. The per-story status lives ON the story file (frontmatter). Sprint
 *      status is DERIVED by reading the stories — never a second source of truth.
 *   3. A small, tested transition machine. `done` is terminal; completing a
 *      story requires evidence; blocking requires a reason; approving requires
 *      a reviewer.
 *
 * This module is the LLM-free foundation. Agent-driven PRD/architecture/story
 * generation and the per-story runner wiring are layered on top separately.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { readJsonAtomicSync, readTextAtomicSync, writeFileAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

export const SPEC_SCHEMA_VERSION = 1;

export type SpecStoryStatus = 'draft' | 'approved' | 'in_progress' | 'done' | 'blocked';
export type SpecPhase = 'prd' | 'architecture' | 'sharding' | 'implementation';
export type SpecRiskLevel = 'low' | 'medium' | 'high';

/** Top-level planning artifacts written by `buddy spec plan` (one per phase). */
export type SpecArtifactName = 'prd' | 'architecture';

export const SPEC_STORY_STATUSES: SpecStoryStatus[] = [
  'draft',
  'approved',
  'in_progress',
  'done',
  'blocked',
];

/**
 * Legal status transitions. Anything not listed is rejected by the store.
 * `done` is intentionally terminal (clone to a new story to redo work).
 */
const LEGAL_TRANSITIONS: Record<SpecStoryStatus, SpecStoryStatus[]> = {
  draft: ['approved', 'blocked'],
  approved: ['in_progress', 'blocked', 'draft'],
  in_progress: ['done', 'blocked'],
  done: [],
  blocked: ['draft'],
};

export interface SpecStoryLineage {
  parentStoryId?: string;
  runId?: string;
  agentRunId?: string;
}

export interface SpecStory {
  id: string;
  projectId: string;
  epicId?: string;
  title: string;
  status: SpecStoryStatus;
  /** Context-engineered narrative: the "why" + implementation guidance. */
  narrative: string;
  acceptanceCriteria: string[];
  /**
   * Runner-contract fields (the story IS the context-engineered contract). Optional
   * on the foundation; populated by the `spec plan` sharding step so that
   * `buddy spec next` (Commit 3) can build an AgenticCodingTaskContract without a
   * translation gap. Bounded relative paths the implementing run may touch.
   */
  allowedPaths?: string[];
  /** Commands proving the acceptance criteria are met (e.g. `npm test`). */
  verification?: string[];
  riskLevel?: SpecRiskLevel;
  reviewedBy?: string;
  /** Required to mark a story done — proof the acceptance criteria are met. */
  evidence?: string;
  blockedReason?: string;
  lineage?: SpecStoryLineage;
  createdAt: number;
  updatedAt: number;
}

export interface SpecEpic {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  createdAt: number;
}

export interface SpecProject {
  id: string;
  title: string;
  phase: SpecPhase;
  /**
   * Per-phase human approval trail recorded by `buddy spec plan continue`. Optional
   * so manifests written before the plan feature still load.
   */
  planApprovals?: Partial<Record<SpecPhase, { by: string; at: number }>>;
  createdAt: number;
  updatedAt: number;
}

export interface SprintStatus {
  projectId: string;
  title: string;
  phase: SpecPhase;
  total: number;
  byStatus: Record<SpecStoryStatus, number>;
  stories: Array<Pick<SpecStory, 'id' | 'title' | 'status' | 'epicId'>>;
}

export interface AddStoryInput {
  title: string;
  epicId?: string;
  narrative?: string;
  acceptanceCriteria?: string[];
  allowedPaths?: string[];
  verification?: string[];
  riskLevel?: SpecRiskLevel;
  lineage?: SpecStoryLineage;
}

/** Raised on an illegal status transition. */
export class SpecTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecTransitionError';
  }
}

// ============================================================================
// Singleton registry (one store per working directory)
// ============================================================================

const registry = new Map<string, SpecStore>();
let lastStoryCreatedAt = 0;

export function getSpecStore(workDir: string = process.cwd()): SpecStore {
  const key = path.resolve(workDir);
  if (!registry.has(key)) {
    registry.set(key, new SpecStore(key));
    if (registry.size > 20) {
      const firstKey = registry.keys().next().value;
      if (firstKey) registry.delete(firstKey);
    }
  }
  return registry.get(key)!;
}

/** Test helper: drop cached store instances. */
export function resetSpecStores(): void {
  registry.clear();
  lastStoryCreatedAt = 0;
}

/** Whether `from → to` is a legal story status transition. */
export function isLegalTransition(from: SpecStoryStatus, to: SpecStoryStatus): boolean {
  return (LEGAL_TRANSITIONS[from] ?? []).includes(to);
}

// ============================================================================
// SpecStore
// ============================================================================

export class SpecStore {
  private specsRoot: string;
  private activePointer: string;

  constructor(private workDir: string = process.cwd()) {
    this.specsRoot = path.join(workDir, '.codebuddy', 'specs');
    this.activePointer = path.join(this.specsRoot, 'active.json');
  }

  // -- Projects --------------------------------------------------------------

  createProject(title: string, phase: SpecPhase = 'sharding'): SpecProject {
    const trimmed = (title ?? '').trim();
    if (!trimmed) throw new Error('Project title is required.');
    const now = Date.now();
    const project: SpecProject = {
      id: `sp-${randomId()}`,
      title: trimmed,
      phase,
      createdAt: now,
      updatedAt: now,
    };
    this.ensureProjectDirs(project.id);
    this.writeJson(this.projectManifestPath(project.id), { schemaVersion: SPEC_SCHEMA_VERSION, project });
    this.setActiveProject(project.id);
    return project;
  }

  listProjects(): SpecProject[] {
    if (!fs.existsSync(this.specsRoot)) return [];
    const projects: SpecProject[] = [];
    for (const entry of fs.readdirSync(this.specsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const project = this.getProject(entry.name);
      if (project) projects.push(project);
    }
    return projects.sort((a, b) => b.createdAt - a.createdAt);
  }

  getProject(projectId: string): SpecProject | null {
    const manifest = this.readJson<{ project?: SpecProject }>(this.projectManifestPath(projectId));
    return manifest?.project ?? null;
  }

  setActiveProject(projectId: string): void {
    this.ensureSpecsRoot();
    this.writeJson(this.activePointer, { activeProjectId: projectId });
  }

  getActiveProjectId(): string | null {
    const pointer = this.readJson<{ activeProjectId?: string }>(this.activePointer);
    const id = pointer?.activeProjectId;
    if (id && this.getProject(id)) return id;
    // Fall back to the most recent project so the CLI stays usable.
    return this.listProjects()[0]?.id ?? null;
  }

  setPhase(projectId: string, phase: SpecPhase): SpecProject {
    const project = this.requireProject(projectId);
    project.phase = phase;
    project.updatedAt = Date.now();
    this.writeJson(this.projectManifestPath(projectId), { schemaVersion: SPEC_SCHEMA_VERSION, project });
    return project;
  }

  /** Record that a human approved the artifact produced for `phase`. */
  recordPlanApproval(projectId: string, phase: SpecPhase, by: string): SpecProject {
    const reviewer = (by ?? '').trim();
    if (!reviewer) throw new Error('Recording a plan approval requires a reviewer (by).');
    const project = this.requireProject(projectId);
    project.planApprovals = { ...project.planApprovals, [phase]: { by: reviewer, at: Date.now() } };
    project.updatedAt = Date.now();
    this.writeJson(this.projectManifestPath(projectId), { schemaVersion: SPEC_SCHEMA_VERSION, project });
    return project;
  }

  // -- Planning artifacts (prd.md / architecture.md) -------------------------

  /** Write a top-level planning artifact (`<project>/prd.md`, `architecture.md`). */
  writeArtifact(projectId: string, name: SpecArtifactName, content: string): void {
    this.requireProject(projectId);
    this.ensureProjectDirs(projectId);
    writeFileAtomicSync(this.artifactPath(projectId, name), content ?? '', { mode: 0o600 });
  }

  /** Read a planning artifact back (the human may have edited it); null if absent. */
  readArtifact(projectId: string, name: SpecArtifactName): string | null {
    const filePath = this.artifactPath(projectId, name);
    if (!fs.existsSync(filePath)) return null;
    try {
      return readTextAtomicSync(filePath, '');
    } catch (err) {
      logger.warn('[spec] failed to read artifact', { filePath, error: String(err) });
      return null;
    }
  }

  // -- Epics -----------------------------------------------------------------

  addEpic(projectId: string, input: { title: string; summary?: string }): SpecEpic {
    this.requireProject(projectId);
    const title = (input.title ?? '').trim();
    if (!title) throw new Error('Epic title is required.');
    const epic: SpecEpic = {
      id: `ep-${randomId()}`,
      projectId,
      title,
      summary: (input.summary ?? '').trim(),
      createdAt: Date.now(),
    };
    writeFileAtomicSync(this.epicPath(projectId, epic.id), renderEpicMarkdown(epic), { mode: 0o600 });
    return epic;
  }

  listEpics(projectId: string): SpecEpic[] {
    const dir = this.epicsDir(projectId);
    if (!fs.existsSync(dir)) return [];
    const epics: SpecEpic[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const epic = this.readEpicFile(path.join(dir, file));
      if (epic) epics.push(epic);
    }
    return epics.sort((a, b) => a.createdAt - b.createdAt);
  }

  // -- Stories ---------------------------------------------------------------

  addStory(projectId: string, input: AddStoryInput): SpecStory {
    this.requireProject(projectId);
    const title = (input.title ?? '').trim();
    if (!title) throw new Error('Story title is required.');
    const now = nextStoryCreatedAt();
    const allowedPaths = cleanList(input.allowedPaths);
    const verification = cleanList(input.verification);
    const story: SpecStory = {
      id: `st-${randomId()}`,
      projectId,
      ...(input.epicId ? { epicId: input.epicId } : {}),
      title,
      status: 'draft',
      narrative: (input.narrative ?? '').trim(),
      acceptanceCriteria: (input.acceptanceCriteria ?? []).map((c) => c.trim()).filter(Boolean),
      ...(allowedPaths.length > 0 ? { allowedPaths } : {}),
      ...(verification.length > 0 ? { verification } : {}),
      ...(input.riskLevel ? { riskLevel: input.riskLevel } : {}),
      ...(input.lineage && hasLineage(input.lineage) ? { lineage: input.lineage } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.writeStory(story);
    return story;
  }

  getStory(projectId: string, storyId: string): SpecStory | null {
    return this.readStoryFile(this.storyPath(projectId, storyId));
  }

  listStories(projectId: string, status?: SpecStoryStatus): SpecStory[] {
    const dir = this.storiesDir(projectId);
    if (!fs.existsSync(dir)) return [];
    const stories: SpecStory[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const story = this.readStoryFile(path.join(dir, file));
      if (story && (!status || story.status === status)) stories.push(story);
    }
    return stories.sort((a, b) => a.createdAt - b.createdAt);
  }

  // -- Transitions (the state machine) ---------------------------------------

  /** draft → approved. Requires a human reviewer. */
  approveStory(projectId: string, storyId: string, reviewedBy: string): SpecStory {
    const by = (reviewedBy ?? '').trim();
    if (!by) throw new Error('Approving a story requires a reviewer (reviewedBy).');
    const story = this.transition(projectId, storyId, 'approved');
    story.reviewedBy = by;
    return this.touchAndWrite(story);
  }

  /** approved → in_progress. */
  startStory(projectId: string, storyId: string, lineage?: SpecStoryLineage): SpecStory {
    const story = this.transition(projectId, storyId, 'in_progress');
    if (lineage && hasLineage(lineage)) {
      story.lineage = { ...story.lineage, ...lineage };
    }
    return this.touchAndWrite(story);
  }

  /** in_progress → done. Requires evidence the acceptance criteria are met. */
  completeStory(projectId: string, storyId: string, evidence: string): SpecStory {
    const proof = (evidence ?? '').trim();
    if (!proof) {
      throw new Error('Completing a story requires evidence (test pass / approved review).');
    }
    const story = this.transition(projectId, storyId, 'done');
    story.evidence = proof;
    return this.touchAndWrite(story);
  }

  /** any (draft|approved|in_progress) → blocked. Requires a reason. */
  blockStory(projectId: string, storyId: string, reason: string): SpecStory {
    const why = (reason ?? '').trim();
    if (!why) throw new Error('Blocking a story requires a reason.');
    const story = this.transition(projectId, storyId, 'blocked');
    story.blockedReason = why;
    return this.touchAndWrite(story);
  }

  /** blocked → draft (re-triage) or approved → draft (revise). */
  reopenStory(projectId: string, storyId: string): SpecStory {
    const story = this.transition(projectId, storyId, 'draft');
    delete story.blockedReason;
    return this.touchAndWrite(story);
  }

  // -- Derived views ---------------------------------------------------------

  /** Sprint status DERIVED from the story files (not a second source of truth). */
  getSprintStatus(projectId: string): SprintStatus {
    const project = this.requireProject(projectId);
    const stories = this.listStories(projectId);
    const byStatus: Record<SpecStoryStatus, number> = {
      draft: 0,
      approved: 0,
      in_progress: 0,
      done: 0,
      blocked: 0,
    };
    for (const story of stories) byStatus[story.status] += 1;
    return {
      projectId,
      title: project.title,
      phase: project.phase,
      total: stories.length,
      byStatus,
      stories: stories.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        ...(s.epicId ? { epicId: s.epicId } : {}),
      })),
    };
  }

  // -- Internals -------------------------------------------------------------

  private transition(projectId: string, storyId: string, to: SpecStoryStatus): SpecStory {
    const story = this.getStory(projectId, storyId);
    if (!story) throw new Error(`Story not found: ${storyId}`);
    if (!isLegalTransition(story.status, to)) {
      const legal = LEGAL_TRANSITIONS[story.status];
      throw new SpecTransitionError(
        `Illegal transition ${story.status} → ${to} for story ${storyId}. ` +
          (legal.length > 0 ? `Legal next states: ${legal.join(', ')}.` : `${story.status} is terminal.`),
      );
    }
    story.status = to;
    return story;
  }

  private touchAndWrite(story: SpecStory): SpecStory {
    story.updatedAt = Date.now();
    this.writeStory(story);
    return story;
  }

  private writeStory(story: SpecStory): void {
    this.ensureProjectDirs(story.projectId);
    writeFileAtomicSync(this.storyPath(story.projectId, story.id), renderStoryMarkdown(story), { mode: 0o600 });
  }

  private requireProject(projectId: string): SpecProject {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Spec project not found: ${projectId}`);
    return project;
  }

  private ensureSpecsRoot(): void {
    fs.mkdirSync(this.specsRoot, { recursive: true });
  }

  private ensureProjectDirs(projectId: string): void {
    fs.mkdirSync(this.epicsDir(projectId), { recursive: true });
    fs.mkdirSync(this.storiesDir(projectId), { recursive: true });
  }

  private projectDir(projectId: string): string {
    return path.join(this.specsRoot, projectId);
  }
  private projectManifestPath(projectId: string): string {
    return path.join(this.projectDir(projectId), 'project.json');
  }
  private epicsDir(projectId: string): string {
    return path.join(this.projectDir(projectId), 'epics');
  }
  private storiesDir(projectId: string): string {
    return path.join(this.projectDir(projectId), 'stories');
  }
  private epicPath(projectId: string, epicId: string): string {
    return path.join(this.epicsDir(projectId), `${epicId}.md`);
  }
  private storyPath(projectId: string, storyId: string): string {
    return path.join(this.storiesDir(projectId), `${storyId}.md`);
  }
  private artifactPath(projectId: string, name: SpecArtifactName): string {
    return path.join(this.projectDir(projectId), `${name}.md`);
  }

  private readStoryFile(filePath: string): SpecStory | null {
    if (!fs.existsSync(filePath)) return null;
    try {
      const front = parseFrontmatter(fs.readFileSync(filePath, 'utf-8'));
      return isValidStory(front) ? (front as SpecStory) : null;
    } catch (err) {
      logger.warn('[spec] failed to read story', { filePath, error: String(err) });
      return null;
    }
  }

  private readEpicFile(filePath: string): SpecEpic | null {
    if (!fs.existsSync(filePath)) return null;
    try {
      const front = parseFrontmatter(fs.readFileSync(filePath, 'utf-8'));
      return front && typeof front.id === 'string' ? (front as unknown as SpecEpic) : null;
    } catch {
      return null;
    }
  }

  private writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeJsonAtomicSync(filePath, value, { mode: 0o600 });
  }

  private readJson<T>(filePath: string): T | null {
    if (!fs.existsSync(filePath)) return null;
    try {
      return readJsonAtomicSync<T | null>(filePath, null, { mode: 0o600 });
    } catch (err) {
      logger.warn('[spec] failed to read json', { filePath, error: String(err) });
      return null;
    }
  }
}

// ============================================================================
// Markdown rendering (JSON frontmatter is authoritative; body is for humans)
// ============================================================================

function renderStoryMarkdown(story: SpecStory): string {
  const body = [
    `# ${story.title}`,
    '',
    `Status: **${story.status}**${story.epicId ? ` · epic ${story.epicId}` : ''} · id \`${story.id}\``,
    ...(story.reviewedBy ? [`Approved by: ${story.reviewedBy}`] : []),
    ...(story.blockedReason ? [`Blocked: ${story.blockedReason}`] : []),
    ...(story.evidence ? [`Evidence: ${story.evidence}`] : []),
    '',
    '## Acceptance Criteria',
    ...(story.acceptanceCriteria.length > 0
      ? story.acceptanceCriteria.map((c) => `- [ ] ${c}`)
      : ['- (none yet)']),
    '',
    '## Narrative',
    story.narrative || '(no narrative yet)',
    ...renderStoryContract(story),
    '',
  ].join('\n');
  return wrapFrontmatter(story, body);
}

/** The runner-contract section (only rendered when the plan populated it). */
function renderStoryContract(story: SpecStory): string[] {
  const lines: string[] = [];
  if (story.riskLevel || (story.allowedPaths?.length ?? 0) > 0 || (story.verification?.length ?? 0) > 0) {
    lines.push('', '## Contract');
    if (story.riskLevel) lines.push(`Risk: **${story.riskLevel}**`);
    if ((story.allowedPaths?.length ?? 0) > 0) {
      lines.push('Allowed paths:', ...story.allowedPaths!.map((p) => `- ${p}`));
    }
    if ((story.verification?.length ?? 0) > 0) {
      lines.push('Verification:', ...story.verification!.map((v) => `- \`${v}\``));
    }
  }
  return lines;
}

function renderEpicMarkdown(epic: SpecEpic): string {
  const body = [`# ${epic.title}`, '', `id \`${epic.id}\``, '', epic.summary || '(no summary)', ''].join('\n');
  return wrapFrontmatter(epic, body);
}

function wrapFrontmatter(data: unknown, body: string): string {
  return `---\n${JSON.stringify(data, null, 2)}\n---\n\n${body}`;
}

/** Parse the JSON frontmatter block; ignores the human-readable body. */
function parseFrontmatter(content: string): Record<string, unknown> | null {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const json = content.slice(content.indexOf('\n', 3) + 1, end);
  const parsed = JSON.parse(json) as unknown;
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
}

// ============================================================================
// Helpers
// ============================================================================

function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function nextStoryCreatedAt(): number {
  const now = Date.now();
  lastStoryCreatedAt = now > lastStoryCreatedAt ? now : lastStoryCreatedAt + 1;
  return lastStoryCreatedAt;
}

/** Trim, drop blanks, and de-duplicate a string list (used for contract fields). */
function cleanList(values?: string[]): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = (raw ?? '').trim();
    if (v && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

function hasLineage(lineage: SpecStoryLineage): boolean {
  return Boolean(lineage.parentStoryId || lineage.runId || lineage.agentRunId);
}

function isValidStory(value: Record<string, unknown> | null): value is SpecStory & Record<string, unknown> {
  if (!value) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.projectId === 'string' &&
    typeof value.title === 'string' &&
    typeof value.status === 'string' &&
    SPEC_STORY_STATUSES.includes(value.status as SpecStoryStatus) &&
    Array.isArray(value.acceptanceCriteria)
  );
}
