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

export interface LessonCandidateProvenance {
  runId?: string;
  outcomeId?: string;
  /** Set when a Fleet Council outcome auto-proposed this candidate (B1). */
  sagaId?: string;
  note?: string;
}

export interface LessonCandidate {
  id: string;
  category: LessonCategory;
  content: string;
  context?: string;
  status: LessonCandidateStatus;
  createdAt: number;
  source: 'self_observed' | 'manual';
  provenance?: LessonCandidateProvenance;
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

export type SpecRiskLevel = 'low' | 'medium' | 'high';

export interface SpecProject {
  id: string;
  title: string;
  phase: SpecPhase;
  planApprovals?: Partial<Record<SpecPhase, { by: string; at: number }>>;
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
  allowedPaths?: string[];
  verification?: string[];
  riskLevel?: SpecRiskLevel;
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
  /**
   * D2: auto-propose reusable lessons from a session transcript. Proposes
   * PENDING candidates only (review-gated); no-ops without a provider.
   */
  proposeFromSession: (
    chatHistory: Array<{ type: string; content: string }>,
    projectId?: string,
  ) => Promise<{ ok: boolean; error?: string; items: LessonCandidate[] }>;
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
  /**
   * S3: run dialectic inference over a session transcript. Proposes pending
   * observations (review-gated, privacy-screened) — never writes the active
   * model. `chatHistory` is the minimal `{ type, content }` transcript.
   */
  runInference: (
    chatHistory: Array<{ type: string; content: string }>,
    projectId?: string,
  ) => Promise<{ ok: boolean; error?: string; items: UserObservation[] }>;
}

export interface SpecPlanAdvanceResult {
  phase: SpecPhase;
  produced?: 'architecture' | 'stories';
  storiesCreated?: number;
  alreadyComplete?: boolean;
}

export interface SpecPlanStatus {
  phase: SpecPhase;
  prd: boolean;
  architecture: boolean;
  stories: number;
  planApprovals?: SpecProject['planApprovals'] | null;
}

export interface SpecApi {
  planStart: (
    goal: string,
    title?: string,
    coworkProjectId?: string,
  ) => Promise<{ ok: boolean; error?: string; projectId?: string; title?: string }>;
  planContinue: (
    specProjectId: string,
    by: string,
    coworkProjectId?: string,
  ) => Promise<{ ok: boolean; error?: string; result?: SpecPlanAdvanceResult }>;
  planStatus: (
    specProjectId: string,
    coworkProjectId?: string,
  ) => Promise<{ ok: boolean; error?: string; status?: SpecPlanStatus | null }>;
  next: (
    input: {
      storyId?: string;
      dryRun?: boolean;
      fleet?: 'none' | 'read-only-help' | 'delegated-slices';
      allowedPaths?: string[];
      verify?: string[];
      runVerification?: boolean;
    },
    coworkProjectId?: string,
  ) => Promise<{ ok: boolean; error?: string; code?: number; stdout?: string; stderr?: string }>;
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

// ── Hermes Nous Portal / Tool Gateway (read-only review) ─────────────
export type HermesPortalToolKey = 'web' | 'image_gen' | 'tts' | 'browser' | 'modal';

export interface HermesPortalToolReviewItem {
  configured: boolean;
  credentialEnv: string[];
  currentProvider: string | null;
  key: HermesPortalToolKey;
  label: string;
  managedByNous: boolean;
  notes: string[];
  partner: string;
}

export interface HermesPortalReviewPayload {
  command: string;
  configuredToolCount: number;
  generatedAt: string;
  loggedIn: boolean;
  managedByNousCount: number;
  notConfiguredToolCount: number;
  notes: string[];
  ok: boolean;
  portal: {
    authFilePresent: boolean;
    credentialPresent: boolean;
    credentialSources: string[];
    docsUrl: string;
    portalBaseUrl: string;
    selectedInferenceProvider: string | null;
    selectedModel: string | null;
    selectedViaNous: boolean;
    subscriptionUrl: string;
    toolGatewayConfigured: boolean;
    toolGatewayUrl: string | null;
  };
  routingActive: boolean;
  tools: HermesPortalToolReviewItem[];
}

// ── Hermes research trajectories (read-only review) ──────────────────
export type HermesTrajectoryCapabilityStatus = 'available' | 'partial' | 'missing';

export interface HermesTrajectoryCapabilityReviewItem {
  commands: string[];
  id: string;
  label: string;
  notes: string[];
  officialSurface: string;
  status: HermesTrajectoryCapabilityStatus;
}

export interface HermesTrajectoriesReviewPayload {
  availableCount: number;
  capabilities: HermesTrajectoryCapabilityReviewItem[];
  command: string;
  generatedAt: string;
  goldenFixtureCount: number;
  missingCount: number;
  ok: boolean;
  partialCount: number;
  policyEvalCount: number;
  recommendations: string[];
  total: number;
}

// ── Hermes Kanban board (CRUD) ───────────────────────────────────────
export type KanbanStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'archived';
export type KanbanPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface KanbanLinkPayload {
  id: string;
  target: string;
  label?: string;
  createdAt: string;
}

export interface KanbanCommentPayload {
  id: string;
  author?: string;
  text: string;
  createdAt: string;
}

export interface KanbanCardPayload {
  assignee?: string;
  blockedReason?: string;
  comments: KanbanCommentPayload[];
  completedAt?: string;
  createdAt: string;
  description?: string;
  heartbeats: unknown[];
  id: string;
  links: KanbanLinkPayload[];
  priority: KanbanPriority;
  status: KanbanStatus;
  tags: string[];
  title: string;
  updatedAt: string;
}

export interface KanbanCreateInputPayload {
  assignee?: string;
  description?: string;
  priority?: KanbanPriority;
  status?: KanbanStatus;
  tags?: string[];
  title: string;
}

export interface KanbanListFilterPayload {
  assignee?: string;
  includeArchived?: boolean;
  includeDone?: boolean;
  priority?: KanbanPriority;
  status?: KanbanStatus;
  tag?: string;
}

export interface KanbanListResponse {
  boardPath?: string;
  cards?: KanbanCardPayload[];
  error?: string;
  ok: boolean;
}

export interface KanbanCardResponse {
  card?: KanbanCardPayload;
  error?: string;
  ok: boolean;
}

export interface KanbanBoardInfoPayload {
  slug: string;
  name: string;
  createdAt: string;
  archived: boolean;
  current: boolean;
  cardCount: number;
  path: string;
}

export interface KanbanBoardListResponse {
  boards?: KanbanBoardInfoPayload[];
  error?: string;
  ok: boolean;
}

export interface KanbanBoardResponse {
  board?: KanbanBoardInfoPayload;
  error?: string;
  ok: boolean;
}

export interface HermesKanbanApi {
  list: (options?: {
    cwd?: string;
    filter?: KanbanListFilterPayload;
  }) => Promise<KanbanListResponse>;
  create: (options: { cwd?: string; input: KanbanCreateInputPayload }) => Promise<KanbanCardResponse>;
  complete: (options: { comment?: string; cwd?: string; id: string }) => Promise<KanbanCardResponse>;
  block: (options: { cwd?: string; id: string; reason: string }) => Promise<KanbanCardResponse>;
  unblock: (options: { comment?: string; cwd?: string; id: string }) => Promise<KanbanCardResponse>;
  comment: (options: { cwd?: string; id: string; text: string }) => Promise<KanbanCardResponse>;
  link: (options: { cwd?: string; id: string; label?: string; target: string }) => Promise<KanbanCardResponse>;
  unlink: (options: { cwd?: string; id: string; linkRef: string }) => Promise<KanbanCardResponse>;
  assign: (options: { assignee: string | null; cwd?: string; id: string }) => Promise<KanbanCardResponse>;
  archive: (options: { comment?: string; cwd?: string; id: string }) => Promise<KanbanCardResponse>;
  boards: {
    list: (options?: { cwd?: string; includeArchived?: boolean }) => Promise<KanbanBoardListResponse>;
    create: (options: { cwd?: string; name?: string; slug: string }) => Promise<KanbanBoardResponse>;
    switch: (options: { cwd?: string; slug: string }) => Promise<KanbanBoardResponse>;
  };
}

// ── Hermes OpenClaw migration (dry-run preview + apply) ──────────────
export type ClawMigrationAction = 'import' | 'archive' | 'skip' | 'conflict';
export type ClawMigrationPreset = 'full' | 'user-data';
export type ClawSkillConflictMode = 'skip' | 'overwrite' | 'rename';

export interface ClawMigrationEntryPayload {
  action: ClawMigrationAction;
  applied?: boolean;
  category: string;
  destination: string | null;
  detail: string;
  error?: string;
  label: string;
  source: string | null;
}

export interface ClawMigrationReportPayload {
  applied: boolean;
  backupPath: string | null;
  detected: boolean;
  dryRun: boolean;
  entries: ClawMigrationEntryPayload[];
  kind: 'hermes_claw_migration';
  migrateSecrets: boolean;
  notes: string[];
  openClawHome: string | null;
  preset: ClawMigrationPreset;
  schemaVersion: 1;
  summary: {
    appliedCount: number;
    archive: number;
    conflict: number;
    failedCount: number;
    import: number;
    skip: number;
    total: number;
  };
  workspaceTarget: string;
}

export interface ClawMigrationRunOptionsPayload {
  migrateSecrets?: boolean;
  overwrite?: boolean;
  preset?: ClawMigrationPreset;
  skillConflict?: ClawSkillConflictMode;
  source?: string;
  workspaceTarget?: string;
}

export interface ClawMigrationRunResponse {
  error?: string;
  ok: boolean;
  report?: ClawMigrationReportPayload;
}

// ── Hermes memory live probe (write→read action) ────────────────────
export interface HermesMemoryProbeResultPayload {
  activeProviderId: string;
  error?: string;
  fellBackToLocal: boolean;
  generatedAt: string;
  notes: string[];
  ok: boolean;
  providerId: string;
  remote: boolean;
  retrieved: boolean;
  retrievedSample?: string;
  verdict: 'pass' | 'pending' | 'fail';
  wrote: boolean;
}

export interface HermesMemoryProbeResponse {
  error?: string;
  ok: boolean;
  result?: HermesMemoryProbeResultPayload;
}

// ── Hermes doctor (aggregate diagnostics, read-only) ─────────────────
export interface HermesDoctorAreaReview {
  id: string;
  label: string;
  ok: boolean;
}

export interface HermesDoctorReviewPayload {
  agentName: string | null;
  areas: HermesDoctorAreaReview[];
  command: string;
  disabledToolCount: number;
  dispatchProfile: string;
  enabledToolCount: number;
  issues: string[];
  ok: boolean;
  recommendations: string[];
  source: 'built-in' | 'user' | 'missing';
}
