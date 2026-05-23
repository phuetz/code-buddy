/**
 * Renderer-side types for the Hermes review-gated surfaces
 * (lesson candidates, user model, spec stories). Mirror of the core store
 * shapes; kept here as the single source of truth shared by the preload type
 * declaration and the panels. See:
 *   - src/agent/lesson-candidate-queue.ts
 *   - src/memory/user-model.ts
 *   - src/spec/spec-store.ts
 */

// ── Envelope ────────────────────────────────────────────────────────────────
// Every Hermes-surface IPC call returns an { ok, error?, ... } envelope so the
// renderer can render a "select a project first" empty state (error ===
// 'NO_ACTIVE_PROJECT') or a clean error instead of an unhandled rejection.
export const NO_ACTIVE_PROJECT = 'NO_ACTIVE_PROJECT';

export interface IpcError {
  ok: false;
  error?: string;
}

// ── Lesson candidates (item 7) ───────────────────────────────────────────────
export type LessonCategory = 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT';
export type LessonCandidateStatus = 'pending' | 'approved' | 'discarded';

export interface LessonCandidate {
  id: string;
  category: LessonCategory;
  content: string;
  context?: string;
  status: LessonCandidateStatus;
  createdAt: number;
  source: 'self_observed' | 'manual';
  reviewedAt?: number;
  reviewedBy?: string;
  reviewNote?: string;
  approvedLessonId?: string;
}

export interface LessonCandidateStats {
  total: number;
  byStatus: Record<LessonCandidateStatus, number>;
}

export interface LessonCandidateApproveInput {
  reviewedBy: string;
  content?: string;
  category?: LessonCategory;
  context?: string;
  reviewNote?: string;
}

// ── User model (item 24) ──────────────────────────────────────────────────────
export type UserObservationKind = 'preference' | 'trait' | 'expertise' | 'working-style';
export type UserObservationStatus = 'pending' | 'accepted' | 'discarded';

export interface UserObservation {
  id: string;
  kind: UserObservationKind;
  content: string;
  confidence?: number;
  status: UserObservationStatus;
  createdAt: number;
  source: 'self_observed' | 'manual';
  reviewedAt?: number;
  reviewedBy?: string;
  reviewNote?: string;
}

export interface UserModelStats {
  total: number;
  byStatus: Record<UserObservationStatus, number>;
  byKind: Record<UserObservationKind, number>;
}

export interface UserModelAcceptInput {
  reviewedBy: string;
  content?: string;
  kind?: UserObservationKind;
  reviewNote?: string;
}

// ── Spec stories (BMAD-inspired) ──────────────────────────────────────────────
export type SpecStoryStatus = 'draft' | 'approved' | 'in_progress' | 'done' | 'blocked';
export type SpecPhase = 'prd' | 'architecture' | 'sharding' | 'implementation';

export interface SpecProject {
  id: string;
  title: string;
  phase: SpecPhase;
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

export interface SpecStory {
  id: string;
  projectId: string;
  epicId?: string;
  title: string;
  status: SpecStoryStatus;
  narrative: string;
  acceptanceCriteria: string[];
  reviewedBy?: string;
  evidence?: string;
  blockedReason?: string;
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

export interface SpecAddStoryInput {
  title: string;
  epicId?: string;
  narrative?: string;
  acceptanceCriteria?: string[];
}

// ── Preload API surface (shared by window.electronAPI typing) ────────────────
export interface LessonCandidateApi {
  list: (
    status?: LessonCandidateStatus,
    projectId?: string,
  ) => Promise<{ ok: boolean; error?: string; items: LessonCandidate[] }>;
  stats: (projectId?: string) => Promise<{ ok: boolean; error?: string; stats?: LessonCandidateStats }>;
  get: (id: string, projectId?: string) => Promise<{ ok: boolean; error?: string; candidate?: LessonCandidate | null }>;
  approve: (
    id: string,
    input: LessonCandidateApproveInput,
    projectId?: string,
  ) => Promise<{ ok: boolean; error?: string; candidate?: LessonCandidate; lessonId?: string }>;
  discard: (
    id: string,
    input: { reviewedBy?: string; reason?: string },
    projectId?: string,
  ) => Promise<{ ok: boolean; error?: string; candidate?: LessonCandidate }>;
}

export interface UserModelApi {
  list: (
    status?: UserObservationStatus,
    projectId?: string,
  ) => Promise<{ ok: boolean; error?: string; items: UserObservation[] }>;
  stats: (projectId?: string) => Promise<{ ok: boolean; error?: string; stats?: UserModelStats }>;
  summarize: (projectId?: string) => Promise<{ ok: boolean; error?: string; summary?: string | null }>;
  get: (id: string, projectId?: string) => Promise<{ ok: boolean; error?: string; observation?: UserObservation | null }>;
  accept: (
    id: string,
    input: UserModelAcceptInput,
    projectId?: string,
  ) => Promise<{ ok: boolean; error?: string; observation?: UserObservation }>;
  discard: (
    id: string,
    input: { reviewedBy?: string; reason?: string },
    projectId?: string,
  ) => Promise<{ ok: boolean; error?: string; observation?: UserObservation }>;
}

export interface SpecApi {
  listProjects: (coworkProjectId?: string) => Promise<{ ok: boolean; error?: string; projects: SpecProject[] }>;
  createProject: (title: string, coworkProjectId?: string) => Promise<{ ok: boolean; error?: string; project?: SpecProject }>;
  sprintStatus: (specProjectId?: string, coworkProjectId?: string) => Promise<{ ok: boolean; error?: string; status?: SprintStatus | null }>;
  listStories: (
    specProjectId: string,
    status?: SpecStoryStatus,
    coworkProjectId?: string,
  ) => Promise<{ ok: boolean; error?: string; stories: SpecStory[] }>;
  getStory: (specProjectId: string, storyId: string, coworkProjectId?: string) => Promise<{ ok: boolean; error?: string; story?: SpecStory | null }>;
  addStory: (specProjectId: string, input: SpecAddStoryInput, coworkProjectId?: string) => Promise<{ ok: boolean; error?: string; story?: SpecStory }>;
  approveStory: (specProjectId: string, storyId: string, reviewedBy: string, coworkProjectId?: string) => Promise<{ ok: boolean; error?: string; story?: SpecStory }>;
  startStory: (specProjectId: string, storyId: string, coworkProjectId?: string) => Promise<{ ok: boolean; error?: string; story?: SpecStory }>;
  completeStory: (specProjectId: string, storyId: string, evidence: string, coworkProjectId?: string) => Promise<{ ok: boolean; error?: string; story?: SpecStory }>;
  blockStory: (specProjectId: string, storyId: string, reason: string, coworkProjectId?: string) => Promise<{ ok: boolean; error?: string; story?: SpecStory }>;
  reopenStory: (specProjectId: string, storyId: string, coworkProjectId?: string) => Promise<{ ok: boolean; error?: string; story?: SpecStory }>;
  listEpics: (specProjectId: string, coworkProjectId?: string) => Promise<{ ok: boolean; error?: string; epics: SpecEpic[] }>;
  addEpic: (specProjectId: string, input: { title: string; summary?: string }, coworkProjectId?: string) => Promise<{ ok: boolean; error?: string; epic?: SpecEpic }>;
}
