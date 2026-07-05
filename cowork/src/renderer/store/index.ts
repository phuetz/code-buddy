import { create } from 'zustand';
import type { ReportArtifactData, TableArtifactData } from '../utils/artifact-detector';
import type {
  Session,
  Message,
  TraceStep,
  PermissionRequest,
  SudoPasswordRequest,
  Settings,
  AppConfig,
  SandboxSetupProgress,
  SandboxSyncStatus,
  SkillsStorageChangeEvent,
  DiffPreview,
  CheckpointTimeline,
  CheckpointSnapshot,
  PermissionMode,
  UpdateInfo,
  Project,
  SubAgent,
  SubAgentStatus,
  NotificationEntry,
  FleetPeer,
  FleetEventRecord,
  A2ATask,
  TeamSnapshot,
  TeamMember,
  TeamTask,
  TeamMailboxMessage,
  MissionRuntime,
  MissionRuntimeEvent,
  QueuedIntent,
  GoalStatusPayload,
} from '../types';
import { applySessionUpdate } from '../utils/session-update';

export type GlobalNoticeType = 'info' | 'warning' | 'error' | 'success';
export type GlobalNoticeAction = 'open_api_settings';

export interface GlobalNotice {
  id: string;
  message: string;
  messageKey?: string;
  messageValues?: Record<string, string | number>;
  type: GlobalNoticeType;
  actionLabel?: string;
  action?: GlobalNoticeAction;
}

export interface SessionExecutionClock {
  startAt: number | null;
  endAt: number | null;
}

export interface ScheduleDraft {
  prompt: string;
  cwd?: string;
  scheduleMode: 'once' | 'daily' | 'weekly';
  runAt?: string;
  selectedTimes?: string[];
  selectedWeekdays?: number[];
  enabled?: boolean;
  metadata?: Record<string, unknown> | null;
  nonce: number;
}

export interface PermissionRuleTestDraft {
  toolName: string;
  testArg: string;
  nonce: number;
}

export interface PermissionRuleDraft {
  bucket: 'allow' | 'deny';
  rule: string;
  nonce: number;
}

export interface FocusedMessageTarget {
  sessionId: string;
  messageId: string;
}

export type FleetGoalDraftProfile = 'balanced' | 'research' | 'code' | 'review' | 'safe';

/**
 * Primary areas of the opt-in redesigned shell (see cowork/REDESIGN.md). Replaces the ~44 `show*`
 * overlay flags with one calm view model. Slice 1: Chat is the home; Activity/Workspace reuse the
 * existing overlays; Advanced is a progressive-disclosure launcher into the current panels.
 */
export type PrimaryView = 'chat' | 'plan' | 'activity' | 'workspace' | 'advanced' | 'studio' | 'os' | 'labs';

export interface FleetGoalDraft {
  goal: string;
  dispatchProfile?: FleetGoalDraftProfile;
  privacyTag?: 'public' | 'sensitive';
  nonce: number;
}

// Unified per-session state that replaces 8 parallel xxxBySession Maps
export interface SessionState {
  messages: Message[];
  partialMessage: string;
  partialThinking: string;
  pendingTurns: string[];
  queuedIntents: QueuedIntent[];
  activeTurn: { stepId: string; userMessageId: string } | null;
  executionClock: SessionExecutionClock;
  traceSteps: TraceStep[];
  contextWindow: number;
}

const DEFAULT_SESSION_STATE: SessionState = {
  messages: [],
  partialMessage: '',
  partialThinking: '',
  pendingTurns: [],
  queuedIntents: [],
  activeTurn: null,
  executionClock: { startAt: null, endAt: null },
  traceSteps: [],
  contextWindow: 0,
};

const MISSION_RUNTIME_EVENT_LIMIT = 200;

// Tail cap for live tool output accumulated from tool_stream deltas.
const STREAMED_TOOL_OUTPUT_CAP = 100_000;

function isSameMissionRuntimeEvent(a: MissionRuntimeEvent, b: MissionRuntimeEvent): boolean {
  return a.ts === b.ts && a.type === b.type && a.message === b.message;
}

function appendMissionRuntimeEvent(
  events: MissionRuntimeEvent[],
  event: MissionRuntimeEvent
): MissionRuntimeEvent[] {
  if (events.some((item) => isSameMissionRuntimeEvent(item, event))) {
    return events;
  }
  const next = [...events, event];
  return next.length > MISSION_RUNTIME_EVENT_LIMIT
    ? next.slice(next.length - MISSION_RUNTIME_EVENT_LIMIT)
    : next;
}

function queuedIntentStorageKey(sessionId: string): string {
  return `cowork.queuedIntents.${sessionId}`;
}

function readQueuedIntents(sessionId: string): QueuedIntent[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage?.getItem(queuedIntentStorageKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedIntent[];
    return Array.isArray(parsed)
      ? parsed.filter(
          (item) => item && item.sessionId === sessionId && Array.isArray(item.content)
        )
      : [];
  } catch {
    return [];
  }
}

function writeQueuedIntents(sessionId: string, intents: QueuedIntent[]): void {
  try {
    if (typeof window === 'undefined') return;
    const key = queuedIntentStorageKey(sessionId);
    if (intents.length === 0) {
      window.localStorage?.removeItem(key);
      return;
    }
    window.localStorage?.setItem(key, JSON.stringify(intents));
  } catch {
    /* queue persistence must never break chat rendering */
  }
}

function readChatActivityDisplayMode(): Settings['chatActivityDisplayMode'] {
  try {
    if (typeof window === 'undefined') return 'compact_worklog';
    const raw = window.localStorage?.getItem('cowork.chatActivityDisplayMode');
    return raw === 'transparent_stream' ? 'transparent_stream' : 'compact_worklog';
  } catch {
    return 'compact_worklog';
  }
}

function readMemoryStrategy(): Settings['memoryStrategy'] {
  try {
    if (typeof window === 'undefined') return 'auto';
    const raw = window.localStorage?.getItem('cowork.memory.strategy');
    return raw === 'manual' || raw === 'rolling' || raw === 'auto' ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

// Helper to immutably update a single session's state within the record
function patchSession(
  states: Record<string, SessionState>,
  sessionId: string,
  updates: Partial<SessionState>
): Record<string, SessionState> {
  const current = states[sessionId] ?? DEFAULT_SESSION_STATE;
  return {
    ...states,
    [sessionId]: { ...current, ...updates },
  };
}

// Helper to get a session's state with safe defaults
function getSession(states: Record<string, SessionState>, sessionId: string): SessionState {
  return states[sessionId] ?? { ...DEFAULT_SESSION_STATE, queuedIntents: readQueuedIntents(sessionId) };
}

export interface AppState {
  // Sessions
  sessions: Session[];
  activeSessionId: string | null;

  // Per-session state (messages, partials, turns, traces, etc.)
  sessionStates: Record<string, SessionState>;

  // Per-session autonomous goal-loop status (drives the chat goal banner).
  goalStatesBySession: Record<string, GoalStatusPayload>;
  // Per-turn history of goal snapshots → the GoalBanner phase timeline.
  goalPhasesBySession: Record<string, GoalStatusPayload[]>;

  // UI state
  isLoading: boolean;
  sidebarCollapsed: boolean;
  contextPanelCollapsed: boolean;
  // New shell (opt-in redesign behind COWORK_NEW_SHELL) — see cowork/REDESIGN.md.
  newShellEnabled: boolean;
  primaryView: PrimaryView;
  showSettings: boolean;
  /** Evolution panel (new-shell Labs) — lists variants from recursive self-improvement. */
  showEvolutionPanel: boolean;
  /** Knowledge panel (new-shell Labs) — CKG discoveries/stats + research-ingest topics. */
  showKnowledgePanel: boolean;
  /** AI-Scientist panel (new-shell Labs) — READ-ONLY tracking of `buddy science` experiment variants. */
  showSciencePanel: boolean;
  settingsTab: string | null;
  scheduleDraft: ScheduleDraft | null;
  permissionRuleTestDraft: PermissionRuleTestDraft | null;
  permissionRuleDraft: PermissionRuleDraft | null;
  focusedMessageTarget: FocusedMessageTarget | null;

  // Permission
  pendingPermission: PermissionRequest | null;

  // Sudo password
  pendingSudoPassword: SudoPasswordRequest | null;

  // Settings
  settings: Settings;

  // App Config (API settings)
  appConfig: AppConfig | null;
  isConfigured: boolean;
  showConfigModal: boolean;
  hasSeenInitialConfigStatus: boolean;
  globalNotice: GlobalNotice | null;

  // Working directory
  workingDir: string | null;

  // Sandbox setup
  sandboxSetupProgress: SandboxSetupProgress | null;
  isSandboxSetupComplete: boolean;

  // Sandbox sync (per-session)
  sandboxSyncStatus: SandboxSyncStatus | null;
  skillsStorageChangedAt: number;
  skillsStorageChangeEvent: SkillsStorageChangeEvent | null;

  // Remote backend (Phase B2) — when connected, core chat/session runs on a
  // remote Code Buddy backend; management surfaces remain local.
  remoteBackend: { connected: boolean; host: string | null };

  ngrokTunnel: {
    active: boolean;
    authToken: string;
    domain: string;
  };

  // System theme (from OS native theme)
  systemDarkMode: boolean;

  // Diff previews per session
  diffPreviews: Record<string, DiffPreview[]>;

  // Checkpoint timeline
  checkpointTimeline: CheckpointTimeline | null;

  // Permission mode
  permissionMode: PermissionMode;

  // Command palette and shortcuts
  showCommandPalette: boolean;
  showShortcutsDialog: boolean;
  showGlobalSearch: boolean;
  previewFilePath: string | null;
  activeArtifact: {
    id: string;
    kind: 'html' | 'svg' | 'mermaid' | 'react' | 'json' | 'report' | 'table';
    language: string;
    source: string;
    title?: string;
    report?: ReportArtifactData;
    table?: TableArtifactData;
  } | null;
  guiActions: Array<{
    sessionId: string;
    toolUseId: string;
    action: string;
    toolName: string;
    screenshot?: string;
    click?: { x: number; y: number };
    details?: Record<string, unknown>;
    timestamp: number;
  }>;
  showComputerUseOverlay: boolean;
  // S2: Browser Operator live action log
  browserActions: Array<{
    sessionId: string;
    toolUseId: string;
    action: string;
    url?: string;
    target?: string;
    evidence?: string;
    screenshot?: string;
    details?: Record<string, unknown>;
    timestamp: number;
  }>;
  showBrowserOperatorOverlay: boolean;
  /**
   * Visual workflow executions, keyed by Orchestrator instanceId. The bridge
   * emits `workflow.event` and the useIPC hook merges them in here so the
   * `WorkflowEditor` inspector can color nodes by their runtime status.
   */
  workflowExecutions: Record<
    string,
    {
      workflowId: string;
      instanceId: string;
      status: 'running' | 'completed' | 'failed';
      startedAt: number;
      completedAt?: number;
      nodeStatuses: Record<string, 'pending' | 'running' | 'completed' | 'failed' | 'skipped'>;
      error?: string;
    }
  >;
  /**
   * Mission Orchestrator runtime snapshots streamed by the main-side bridge.
   * Kept separate from the older companion mission board until the IPC surface
   * is fully wired, so the next UI pass can subscribe without backend coupling.
   */
  missionRuntime: Record<string, MissionRuntime>;
  missionRuntimeEvents: Record<string, MissionRuntimeEvent[]>;
  missionRuntimeHeartbeats: Record<string, string>;
  /** Approvals waiting for the user to click Approve/Reject. */
  pendingApprovals: Array<{
    workflowInstanceId: string;
    stepId: string;
    message: string;
    expiresAt?: number;
    payload?: {
      toolName?: string;
      toolInput?: Record<string, unknown>;
    };
  }>;
  openTabs: Array<{
    id: string;
    sessionId: string;
    title: string;
    /** When true, the tab sticks to the leftmost position and refuses Cmd+W close. */
    pinned?: boolean;
    /** Unread message counter — increments when a message lands on a non-active session. */
    unread?: number;
  }>;
  /**
   * Latest clipboard summary pushed by the main-side `ClipboardWatcher`
   * (Lisa-derived feature). `null` when no summary has arrived in this
   * session yet. Replaced every time a new summary is generated.
   */
  clipboardSummary: {
    hash: string;
    sourceLength: number;
    sourcePreview: string;
    summary: string | null;
    at: string;
  } | null;
  /** Mirror of `configStore.clipboard.monitoringEnabled` — written by the panel. */
  clipboardMonitoringEnabled: boolean;
  /** Flips true while the main process is generating a summary. */
  clipboardSummarising: boolean;
  showMemoryEditor: boolean;
  showActivityFeed: boolean;
  showFileActivity: boolean;
  showSessionInsights: boolean;
  showResumeChooser: boolean;
  showFocusView: boolean;

  // Phase 3 step 4: bookmarked message IDs for the active session
  bookmarkedMessageIds: Set<string>;
  showBookmarksPanel: boolean;

  // Phase 3 step 5: snippets library dialog
  showSnippetsLibrary: boolean;

  // Phase 3 step 11: persona switcher dialog
  showPersonaSwitcher: boolean;

  // Phase 3 step 12: test runner panel
  showTestRunner: boolean;

  // Phase 3 step 17: reasoning trace viewer
  showReasoningViewer: boolean;
  showAutonomyPanel: boolean;
  showLiveLauncher: boolean;
  /** One-shot: the LiveLauncher should open pre-selected in Deep Research mode. */
  liveLauncherDeepIntent: boolean;

  // Phase 3 step 8: split-pane layout (chat + preview side-by-side)
  splitPaneEnabled: boolean;
  splitPaneRatio: number;

  // Presence (face-memory) — UI dialogs + opt-in toggle.
  // The toggle is persisted because the user's choice to run the camera
  // service should survive restarts; the dialogs are transient.
  showEnrollmentDialog: boolean;
  showModelInstallDialog: boolean;
  presenceEnabled: boolean;
  // Live presence — pushed by PresenceService whenever the main-process
  // bridge fires an event. Volatile (no localStorage) — it's the present.
  // `currentPresence` carries the matched person while the camera sees
  // them; `lastPresenceEventType` lets the indicator distinguish "Patrice
  // est là" from "un visage inconnu" from "personne".
  currentPresence: {
    personId: string;
    name: string;
    aliases: string[];
    confidence: number;
    matchedAt: number;
  } | null;
  lastPresenceEventType: 'detected' | 'unknown' | 'left' | 'enrolled' | null;

  // Multi-agent orchestrator launcher — modal-driven UI for triggering
  // the existing OrchestratorBridge in main. The last-used options are
  // persisted (localStorage) so the user doesn't have to re-pick the
  // strategy + maxRounds on every spawn.
  showOrchestratorLauncher: boolean;
  lastOrchestratorOptions: { strategy: string; maxRounds: number };

  // Auto-update
  updateInfo: UpdateInfo | null;

  // Session message search
  searchQuery: string;
  searchActive: boolean;

  // Projects (Claude Cowork parity)
  projects: Project[];
  activeProjectId: string | null;

  // Sub-agents per session (Claude Cowork parity)
  subAgents: Record<string, SubAgent[]>;
  subAgentOutputs: Record<string, Record<string, string>>; // sessionId → agentId → output

  // Fleet — multi-host Code Buddy listener (GAP 3)
  fleetPeers: Record<string, FleetPeer>;
  fleetEvents: FleetEventRecord[]; // ring buffer (FLEET_EVENT_RING)
  /** Wiring W7 — bumped on every fleet.saga.update; FleetCommandCenter
   *  watches as a re-fetch trigger so it doesn't have to poll at 3s. */
  fleetSagaUpdateToken: number;
  /** Wiring W7 — peers freshly seen by Tailscale/YAML discovery, awaiting
   *  user confirmation. Cleared as the user dismisses or pairs them. */
  fleetDiscoveredPeers: Array<{
    label: string;
    url: string;
    source: 'tailscale' | 'manual';
    apiKey?: string;
  }>;
  showFleetPanel: boolean;
  /**
   * Fleet P5 — full Command Center overlay (`FleetCommandCenter.tsx`).
   * Distinct from `showFleetPanel` (the legacy peer-list panel) so
   * both can be opened independently — the panel is read-only events
   * stream, the command center is the dispatch UI.
   */
  showFleetCommandCenter: boolean;
  /**
   * Toggle for the full-page Skills Manager (Hermes skills parity). Aggregates
   * the installed skill-package lifecycle surface and the candidate review
   * queue into a single daily-operations page.
   */
  showSkillsManager: boolean;
  /** Toggle for the OpenClaw → Code Buddy migration dialog (Hermes claw parity). */
  showClawMigration: boolean;
  /** Toggle for the Hermes Kanban board panel (Hermes kanban parity). */
  showKanban: boolean;
  /** Toggle for the autonomous companion mission board surface. */
  showMissionBoard: boolean;
  /** Toggle for the passive desktop snapshot inspection surface. */
  showDesktopSnapshot: boolean;
  fleetGoalDraft: FleetGoalDraft | null;

  // A2A active tasks (GAP 1)
  a2aTasks: Record<string, A2ATask>;

  // Agent Teams — Phase 4 layer 9
  team: TeamSnapshot | null;
  teamMembers: Record<string, TeamMember>;
  teamTasks: Record<string, TeamTask>;
  teamMailbox: TeamMailboxMessage[];
  showTeamPanel: boolean;
  showWorkflowProPanel: boolean;

  // Hermes review-gated surfaces (CLI parity → Cowork)
  showLessonCandidatePanel: boolean;
  showUserModelPanel: boolean;
  showSpecPanel: boolean;
  showMobileSupervisionPanel: boolean;
  showIdentityPanel: boolean;
  showDevicePanel: boolean;
  showChannelsPanel: boolean;
  showLessonsGraph: boolean;
  showCompanionPanel: boolean;

  // Notifications (Claude Cowork parity)
  notifications: NotificationEntry[];
  showNotificationCenter: boolean;

  // Actions
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
  removeSession: (sessionId: string) => void;
  removeSessions: (sessionIds: string[]) => void;
  setActiveSession: (sessionId: string | null) => void;

  addMessage: (sessionId: string, message: Message) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  startExecutionClock: (sessionId: string, startAt: number) => void;
  finishExecutionClock: (sessionId: string, endAt?: number) => void;
  clearExecutionClock: (sessionId: string) => void;
  setMessages: (sessionId: string, messages: Message[]) => void;
  setPartialMessage: (sessionId: string, partial: string) => void;
  clearPartialMessage: (sessionId: string) => void;
  setPartialThinking: (sessionId: string, delta: string) => void;
  clearPartialThinking: (sessionId: string) => void;
  activateNextTurn: (sessionId: string, stepId: string) => void;
  updateActiveTurnStep: (sessionId: string, stepId: string) => void;
  clearActiveTurn: (sessionId: string, stepId?: string) => void;
  clearPendingTurns: (sessionId: string) => void;
  enqueueQueuedIntent: (intent: QueuedIntent) => void;
  updateQueuedIntent: (
    sessionId: string,
    intentId: string,
    updates: Partial<Pick<QueuedIntent, 'prompt' | 'content' | 'source'>>
  ) => void;
  removeQueuedIntent: (sessionId: string, intentId: string) => void;
  shiftQueuedIntent: (sessionId: string) => QueuedIntent | null;
  clearQueuedMessages: (sessionId: string) => void;
  cancelQueuedMessages: (sessionId: string) => void;

  addTraceStep: (sessionId: string, step: TraceStep) => void;
  updateTraceStep: (sessionId: string, stepId: string, updates: Partial<TraceStep>) => void;
  setTraceSteps: (sessionId: string, steps: TraceStep[]) => void;

  setLoading: (loading: boolean) => void;
  toggleSidebar: () => void;
  toggleContextPanel: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setContextPanelCollapsed: (collapsed: boolean) => void;
  setNewShellEnabled: (on: boolean) => void;
  setPrimaryView: (v: PrimaryView) => void;
  setShowSettings: (show: boolean) => void;
  setShowEvolutionPanel: (show: boolean) => void;
  setShowKnowledgePanel: (show: boolean) => void;
  setShowSciencePanel: (show: boolean) => void;
  setSettingsTab: (tab: string | null) => void;
  setScheduleDraft: (draft: Omit<ScheduleDraft, 'nonce'> | null) => void;
  clearScheduleDraft: () => void;
  setPermissionRuleTestDraft: (draft: Omit<PermissionRuleTestDraft, 'nonce'> | null) => void;
  clearPermissionRuleTestDraft: () => void;
  setPermissionRuleDraft: (draft: Omit<PermissionRuleDraft, 'nonce'> | null) => void;
  clearPermissionRuleDraft: () => void;
  setFocusedMessageTarget: (target: FocusedMessageTarget | null) => void;
  clearFocusedMessageTarget: () => void;

  setPendingPermission: (permission: PermissionRequest | null) => void;

  setPendingSudoPassword: (request: SudoPasswordRequest | null) => void;

  setSettings: (updates: Partial<Settings>) => void;
  updateSettings: (updates: Partial<Settings>) => void;

  // Config actions
  setAppConfig: (config: AppConfig | null) => void;
  setIsConfigured: (configured: boolean) => void;
  setShowConfigModal: (show: boolean) => void;
  markInitialConfigStatusSeen: () => void;
  setGlobalNotice: (notice: GlobalNotice | null) => void;
  clearGlobalNotice: () => void;

  // Working directory actions
  setWorkingDir: (path: string | null) => void;

  // Sandbox setup actions
  setSandboxSetupProgress: (progress: SandboxSetupProgress | null) => void;
  setSandboxSetupComplete: (complete: boolean) => void;

  // Sandbox sync actions
  setSandboxSyncStatus: (status: SandboxSyncStatus | null) => void;
  setSkillsStorageChangedAt: (timestamp: number) => void;
  setSkillsStorageChangeEvent: (event: SkillsStorageChangeEvent | null) => void;

  // Context window actions
  setSessionContextWindow: (sessionId: string, contextWindow: number) => void;

  // Autonomous goal-loop status actions
  setGoalStatus: (sessionId: string, goal: GoalStatusPayload) => void;
  clearGoalStatus: (sessionId: string) => void;

  // Remote backend actions
  setRemoteBackend: (state: { connected: boolean; host: string | null }) => void;
  setNgrokTunnel: (updates: Partial<{ active: boolean; authToken: string; domain: string }>) => void;

  // System theme actions
  setSystemDarkMode: (dark: boolean) => void;

  // Diff preview actions
  addDiffPreview: (sessionId: string, preview: DiffPreview) => void;
  clearDiffPreviews: (sessionId: string) => void;

  // Checkpoint actions
  setCheckpointTimeline: (timeline: CheckpointTimeline | null) => void;
  addCheckpoint: (snapshot: CheckpointSnapshot) => void;

  // Permission mode actions
  setPermissionMode: (mode: PermissionMode) => void;

  // Command palette actions
  setShowCommandPalette: (show: boolean) => void;
  setShowShortcutsDialog: (show: boolean) => void;
  setShowGlobalSearch: (show: boolean) => void;
  setPreviewFilePath: (filePath: string | null) => void;
  setActiveArtifact: (
    artifact: {
      id: string;
      kind: 'html' | 'svg' | 'mermaid' | 'react' | 'json' | 'report' | 'table';
      language: string;
      source: string;
      title?: string;
      report?: ReportArtifactData;
      table?: TableArtifactData;
    } | null
  ) => void;
  appendGuiAction: (action: {
    sessionId: string;
    toolUseId: string;
    action: string;
    toolName: string;
    screenshot?: string;
    click?: { x: number; y: number };
    details?: Record<string, unknown>;
    timestamp: number;
  }) => void;
  setShowComputerUseOverlay: (show: boolean) => void;
  appendBrowserAction: (action: {
    sessionId: string;
    toolUseId: string;
    action: string;
    url?: string;
    target?: string;
    evidence?: string;
    screenshot?: string;
    details?: Record<string, unknown>;
    timestamp: number;
  }) => void;
  setShowBrowserOperatorOverlay: (show: boolean) => void;
  applyWorkflowEvent: (
    payload: import('../../shared/workflow-types').WorkflowEventPayload
  ) => void;
  upsertMissionRuntime: (mission: MissionRuntime) => void;
  applyMissionRuntimeEvent: (payload: {
    missionId: string;
    event: MissionRuntimeEvent;
  }) => void;
  markMissionRuntimeHeartbeat: (missionId: string, at?: string) => void;
  pushPendingApproval: (
    approval: import('../../shared/workflow-types').PendingApproval
  ) => void;
  removePendingApproval: (stepId: string) => void;
  openTab: (sessionId: string, title: string) => void;
  closeTab: (tabId: string) => void;
  /** Close every tab except the protected list (used by "Close others" menu). */
  closeOtherTabs: (keepTabId: string) => void;
  /** Close every tab to the right of the supplied tab. */
  closeTabsToRight: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  reorderTabs: (sourceIndex: number, targetIndex: number) => void;
  updateTabTitle: (sessionId: string, title: string) => void;
  /** Toggle the pinned flag for a tab. Pinned tabs are sorted to the left. */
  togglePinnedTab: (tabId: string) => void;
  /**
   * Hydrate the pinned set from a persisted list of session IDs.
   * Called once at app boot after the renderer fetches the saved
   * config. Matching live tabs are marked pinned and re-sorted to
   * the leftmost group; unknown IDs are dropped silently (the
   * underlying session may have been deleted between launches).
   */
  setPinnedSessionIds: (sessionIds: string[]) => void;
  /** Bump the unread badge for a tab (clamped). */
  incrementTabUnread: (sessionId: string) => void;
  /** Clear the unread counter for a tab — called when the user views it. */
  clearTabUnread: (sessionId: string) => void;
  setClipboardSummary: (
    payload: {
      hash: string;
      sourceLength: number;
      sourcePreview: string;
      summary: string | null;
      at: string;
    } | null,
  ) => void;
  setClipboardMonitoringEnabled: (enabled: boolean) => void;
  setClipboardSummarising: (busy: boolean) => void;
  setShowMemoryEditor: (show: boolean) => void;
  setShowActivityFeed: (show: boolean) => void;
  setShowFileActivity: (show: boolean) => void;
  setShowSessionInsights: (show: boolean) => void;
  setShowResumeChooser: (show: boolean) => void;
  setShowFocusView: (show: boolean) => void;
  setBookmarkedMessageIds: (ids: string[]) => void;
  toggleBookmarkedMessage: (messageId: string, bookmarked: boolean) => void;
  setShowBookmarksPanel: (show: boolean) => void;
  setShowSnippetsLibrary: (show: boolean) => void;
  setShowPersonaSwitcher: (show: boolean) => void;
  setShowTestRunner: (show: boolean) => void;
  setShowReasoningViewer: (show: boolean) => void;
  setShowAutonomyPanel: (show: boolean) => void;
  setShowLiveLauncher: (show: boolean) => void;
  setLiveLauncherDeepIntent: (deep: boolean) => void;
  setSplitPaneEnabled: (enabled: boolean) => void;
  toggleSplitPane: () => void;
  setSplitPaneRatio: (ratio: number) => void;

  // Presence actions
  setShowEnrollmentDialog: (show: boolean) => void;
  setShowModelInstallDialog: (show: boolean) => void;
  setPresenceEnabled: (enabled: boolean) => void;
  setCurrentPresence: (
    payload: {
      type: 'detected' | 'unknown' | 'left' | 'enrolled';
      match?: {
        personId: string;
        name: string;
        aliases: string[];
        confidence: number;
        matchedAt: number;
      };
    } | null,
  ) => void;

  // Orchestrator launcher actions
  setShowOrchestratorLauncher: (show: boolean) => void;
  setLastOrchestratorOptions: (opts: { strategy: string; maxRounds: number }) => void;

  // Update actions
  setUpdateInfo: (info: UpdateInfo | null) => void;

  // Search actions
  setSearchQuery: (query: string) => void;
  setSearchActive: (active: boolean) => void;

  // Project actions
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (projectId: string, updates: Partial<Project>) => void;
  removeProject: (projectId: string) => void;
  setActiveProjectId: (projectId: string | null) => void;

  // Sub-agent actions
  addSubAgent: (sessionId: string, subAgent: SubAgent) => void;
  updateSubAgentStatus: (sessionId: string, agentId: string, status: SubAgentStatus) => void;
  completeSubAgent: (sessionId: string, agentId: string, result: string) => void;
  appendSubAgentOutput: (sessionId: string, agentId: string, delta: string) => void;
  setSubAgentActivity: (sessionId: string, agentId: string, currentStep: string) => void;
  clearSubAgents: (sessionId: string) => void;

  // Fleet actions
  setFleetPeers: (peers: FleetPeer[]) => void;
  upsertFleetPeer: (peer: FleetPeer) => void;
  removeFleetPeer: (peerId: string) => void;
  appendFleetEvent: (event: FleetEventRecord) => void;
  bumpFleetSagaUpdate: () => void;
  setFleetDiscoveredPeers: (
    peers: Array<{ label: string; url: string; source: 'tailscale' | 'manual'; apiKey?: string }>,
  ) => void;
  dismissFleetDiscoveredPeer: (url: string) => void;
  setShowFleetPanel: (show: boolean) => void;
  setShowFleetCommandCenter: (show: boolean) => void;
  setShowSkillsManager: (show: boolean) => void;
  setShowClawMigration: (show: boolean) => void;
  setShowKanban: (show: boolean) => void;
  setShowMissionBoard: (show: boolean) => void;
  setShowDesktopSnapshot: (show: boolean) => void;
  setFleetGoalDraft: (draft: Omit<FleetGoalDraft, 'nonce'> | null) => void;

  // A2A task actions
  upsertA2ATask: (task: A2ATask) => void;
  removeA2ATask: (taskId: string) => void;

  // Team actions
  setTeamSnapshot: (snapshot: TeamSnapshot | null) => void;
  upsertTeamMember: (member: TeamMember) => void;
  removeTeamMember: (memberId: string) => void;
  upsertTeamTask: (task: TeamTask) => void;
  appendTeamMessage: (msg: TeamMailboxMessage) => void;
  setShowTeamPanel: (show: boolean) => void;
  setShowWorkflowProPanel: (show: boolean) => void;
  setShowLessonCandidatePanel: (show: boolean) => void;
  setShowUserModelPanel: (show: boolean) => void;
  setShowSpecPanel: (show: boolean) => void;
  setShowMobileSupervisionPanel: (show: boolean) => void;
  setShowIdentityPanel: (show: boolean) => void;
  setShowDevicePanel: (show: boolean) => void;
  setShowChannelsPanel: (show: boolean) => void;
  setShowLessonsGraph: (show: boolean) => void;
  setShowCompanionPanel: (show: boolean) => void;
  showHelpDocs: boolean;
  setShowHelpDocs: (show: boolean) => void;

  // Notification actions
  addNotification: (notification: NotificationEntry) => void;
  markNotificationRead: (notificationId: string) => void;
  markAllNotificationsRead: () => void;
  removeNotification: (notificationId: string) => void;
  setShowNotificationCenter: (show: boolean) => void;
}

const defaultSettings: Settings = {
  theme: 'light',
  chatActivityDisplayMode: readChatActivityDisplayMode(),
  defaultTools: [
    'askuserquestion',
    'todowrite',
    'todoread',
    'webfetch',
    'websearch',
    'read',
    'write',
    'edit',
    'list_directory',
    'glob',
    'grep',
  ],
  permissionRules: [
    { tool: 'read', action: 'allow' },
    { tool: 'glob', action: 'allow' },
    { tool: 'grep', action: 'allow' },
    { tool: 'write', action: 'ask' },
    { tool: 'edit', action: 'ask' },
    { tool: 'bash', action: 'ask' },
  ],
  globalSkillsPath: '',
  memoryStrategy: readMemoryStrategy(),
  maxContextTokens: 180000,
};

/** Read the opt-in new-shell flag from localStorage (renderer). Safe in non-DOM test envs. */
function readNewShellFlag(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem('COWORK_NEW_SHELL');
      if (v === 'false') return false; // explicit opt-out back to the legacy dock
      if (v === 'true') return true;
    }
  } catch {
    /* ignore */
  }
  // New shell is the default surface — it hosts App Studio, Mission Control, etc.
  return true;
}

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  sessions: [],
  activeSessionId: null,
  sessionStates: {},
  goalStatesBySession: {},
  goalPhasesBySession: {},
  isLoading: false,
  sidebarCollapsed: false,
  contextPanelCollapsed: false,
  newShellEnabled: readNewShellFlag(),
  primaryView: 'chat',
  showSettings: false,
  showEvolutionPanel: false,
  showKnowledgePanel: false,
  showSciencePanel: false,
  settingsTab: null,
  scheduleDraft: null,
  permissionRuleTestDraft: null,
  permissionRuleDraft: null,
  focusedMessageTarget: null,
  pendingPermission: null,
  pendingSudoPassword: null,
  settings: defaultSettings,
  appConfig: null,
  isConfigured: false,
  showConfigModal: false,
  hasSeenInitialConfigStatus: false,
  globalNotice: null,
  workingDir: null,
  sandboxSetupProgress: null,
  isSandboxSetupComplete: false,
  sandboxSyncStatus: null,
  remoteBackend: { connected: false, host: null },
  ngrokTunnel: { active: false, authToken: '', domain: '' },
  skillsStorageChangedAt: 0,
  skillsStorageChangeEvent: null,
  systemDarkMode: false,
  diffPreviews: {},
  checkpointTimeline: null,
  permissionMode: 'default' as PermissionMode,
  showCommandPalette: false,
  showShortcutsDialog: false,
  showGlobalSearch: false,
  previewFilePath: null,
  activeArtifact: null,
  guiActions: [],
  showComputerUseOverlay: false,
  browserActions: [],
  showBrowserOperatorOverlay: false,
  workflowExecutions: {},
  missionRuntime: {},
  missionRuntimeEvents: {},
  missionRuntimeHeartbeats: {},
  pendingApprovals: [],
  openTabs: [],
  clipboardSummary: null,
  clipboardMonitoringEnabled: false,
  clipboardSummarising: false,
  showMemoryEditor: false,
  showActivityFeed: false,
  showFileActivity: false,
  showSessionInsights: false,
  showResumeChooser: false,
  showFocusView: false,
  bookmarkedMessageIds: new Set<string>(),
  showBookmarksPanel: false,
  showSnippetsLibrary: false,
  showPersonaSwitcher: false,
  showTestRunner: false,
  showReasoningViewer: false,
  showAutonomyPanel: false,
  showLiveLauncher: false,
  liveLauncherDeepIntent: false,
  splitPaneEnabled: ((): boolean => {
    try {
      return typeof window !== 'undefined'
        ? window.localStorage?.getItem('cowork.layout.splitEnabled') === '1'
        : false;
    } catch {
      return false;
    }
  })(),
  splitPaneRatio: ((): number => {
    try {
      const raw =
        typeof window !== 'undefined'
          ? window.localStorage?.getItem('cowork.layout.splitRatio')
          : null;
      const n = raw ? parseFloat(raw) : NaN;
      return Number.isFinite(n) && n > 0.15 && n < 0.85 ? n : 0.5;
    } catch {
      return 0.5;
    }
  })(),
  showEnrollmentDialog: false,
  showModelInstallDialog: false,
  currentPresence: null,
  lastPresenceEventType: null,
  showOrchestratorLauncher: false,
  lastOrchestratorOptions: ((): { strategy: string; maxRounds: number } => {
    try {
      const raw =
        typeof window !== 'undefined'
          ? window.localStorage?.getItem('cowork.orchestrator.lastOptions')
          : null;
      if (raw) {
        const parsed = JSON.parse(raw) as { strategy?: string; maxRounds?: number };
        return {
          strategy: typeof parsed.strategy === 'string' ? parsed.strategy : 'parallel',
          maxRounds:
            typeof parsed.maxRounds === 'number' && parsed.maxRounds > 0
              ? parsed.maxRounds
              : 3,
        };
      }
    } catch {
      /* ignore */
    }
    return { strategy: 'parallel', maxRounds: 3 };
  })(),
  presenceEnabled: ((): boolean => {
    try {
      // Default true — but the service still won't start the camera until
      // at least one identity is enrolled (PresenceService.start() guard).
      return typeof window !== 'undefined'
        ? window.localStorage?.getItem('cowork.presence.enabled') !== '0'
        : true;
    } catch {
      return true;
    }
  })(),
  updateInfo: null,
  searchQuery: '',
  searchActive: false,
  projects: [],
  activeProjectId: null,
  subAgents: {},
  subAgentOutputs: {},
  fleetPeers: {},
  fleetEvents: [],
  fleetSagaUpdateToken: 0,
  fleetDiscoveredPeers: [],
  showFleetPanel: false,
  showSkillsManager: false,
  showClawMigration: false,
  showKanban: false,
  showMissionBoard: false,
  showDesktopSnapshot: false,
  showFleetCommandCenter: false,
  fleetGoalDraft: null,
  a2aTasks: {},
  team: null,
  teamMembers: {},
  teamTasks: {},
  teamMailbox: [],
  showTeamPanel: false,
  showWorkflowProPanel: false,
  showLessonCandidatePanel: false,
  showUserModelPanel: false,
  showSpecPanel: false,
  showMobileSupervisionPanel: false,
  showIdentityPanel: false,
  showDevicePanel: false,
  showChannelsPanel: false,
  showLessonsGraph: false,
  showCompanionPanel: false,
  showHelpDocs: false,
  notifications: [],
  showNotificationCenter: false,

  // Session actions
  setSessions: (sessions) =>
    set((state) => {
      const sessionStates = { ...state.sessionStates };
      for (const session of sessions) {
        if (!sessionStates[session.id]) {
          sessionStates[session.id] = {
            ...DEFAULT_SESSION_STATE,
            queuedIntents: readQueuedIntents(session.id),
          };
        }
      }
      return { sessions, sessionStates };
    }),

  addSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions],
      sessionStates: {
        ...state.sessionStates,
        [session.id]: { ...DEFAULT_SESSION_STATE, queuedIntents: readQueuedIntents(session.id) },
      },
    })),

  updateSession: (sessionId, updates) =>
    set((state) => ({
      sessions: applySessionUpdate(state.sessions, sessionId, updates),
    })),

  removeSession: (sessionId) =>
    set((state) => {
      writeQueuedIntents(sessionId, []);
      const { [sessionId]: _, ...restSessionStates } = state.sessionStates;
      return {
        sessions: state.sessions.filter((s) => s.id !== sessionId),
        sessionStates: restSessionStates,
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
        openTabs: state.openTabs.filter((t) => t.sessionId !== sessionId),
      };
    }),

  removeSessions: (sessionIds) =>
    set((state) => {
      const idSet = new Set(sessionIds);
      for (const sessionId of sessionIds) {
        writeQueuedIntents(sessionId, []);
      }
      const newSessionStates: Record<string, SessionState> = {};
      for (const key of Object.keys(state.sessionStates)) {
        if (!idSet.has(key)) newSessionStates[key] = state.sessionStates[key];
      }

      return {
        sessions: state.sessions.filter((s) => !idSet.has(s.id)),
        sessionStates: newSessionStates,
        activeSessionId:
          state.activeSessionId && idSet.has(state.activeSessionId) ? null : state.activeSessionId,
        openTabs: state.openTabs.filter((t) => !idSet.has(t.sessionId)),
      };
    }),

  setActiveSession: (sessionId) =>
    set((state) => {
      // Phase 2 step 14: auto-open a tab when activating a session, dedup if exists.
      if (!sessionId) {
        return { activeSessionId: null };
      }
      const existing = state.openTabs.find((t) => t.sessionId === sessionId);
      if (existing) {
        // Phase 6: clear the unread badge for the now-active tab.
        const cleared = existing.unread
          ? state.openTabs.map((t) =>
              t.sessionId === sessionId ? { ...t, unread: 0 } : t
            )
          : state.openTabs;
        return {
          activeSessionId: sessionId,
          openTabs: cleared,
          sessionStates: state.sessionStates[sessionId]
            ? state.sessionStates
            : patchSession(state.sessionStates, sessionId, {
                queuedIntents: readQueuedIntents(sessionId),
              }),
        };
      }
      const session = state.sessions.find((s) => s.id === sessionId);
      const title = session?.title ?? `Session ${state.openTabs.length + 1}`;
      return {
        activeSessionId: sessionId,
        openTabs: [...state.openTabs, { id: `tab-${sessionId}`, sessionId, title }],
        sessionStates: state.sessionStates[sessionId]
          ? state.sessionStates
          : patchSession(state.sessionStates, sessionId, {
              queuedIntents: readQueuedIntents(sessionId),
            }),
      };
    }),

  // Message actions
  addMessage: (sessionId, message) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      const messages = ss.messages;
      let updatedMessages = messages;
      let updatedPendingTurns = ss.pendingTurns;

      if (message.role === 'user') {
        updatedMessages = [...messages, message];
        updatedPendingTurns = [...ss.pendingTurns, message.id];
      } else {
        const activeTurn = ss.activeTurn;
        if (activeTurn?.userMessageId) {
          const anchorIndex = messages.findIndex((item) => item.id === activeTurn.userMessageId);
          if (anchorIndex >= 0) {
            let insertIndex = anchorIndex + 1;
            while (insertIndex < messages.length) {
              if (messages[insertIndex].role === 'user') break;
              insertIndex += 1;
            }
            updatedMessages = [
              ...messages.slice(0, insertIndex),
              message,
              ...messages.slice(insertIndex),
            ];
          } else {
            updatedMessages = [...messages, message];
          }
        } else {
          updatedMessages = [...messages, message];
        }
      }

      const shouldClearPartial = message.role === 'assistant';
      // Phase 6: bump unread badge when an assistant message lands on a
      // session the user isn't currently viewing. We don't bump for
      // user-typed messages — those originate from the active tab anyway.
      const shouldBumpUnread =
        message.role === 'assistant' && state.activeSessionId !== sessionId;
      let updatedTabs = state.openTabs;
      if (shouldBumpUnread && state.openTabs.some((t) => t.sessionId === sessionId)) {
        updatedTabs = state.openTabs.map((t) =>
          t.sessionId === sessionId
            ? { ...t, unread: Math.min(99, (t.unread ?? 0) + 1) }
            : t
        );
      }
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          messages: updatedMessages,
          pendingTurns: updatedPendingTurns,
          ...(shouldClearPartial ? { partialMessage: '', partialThinking: '' } : {}),
        }),
        openTabs: updatedTabs,
      };
    }),

  updateMessage: (sessionId, messageId, updates) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      const idx = ss.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return {};
      const updatedMessages = ss.messages.map((m) =>
        m.id === messageId ? { ...m, ...updates } : m
      );
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, { messages: updatedMessages }),
      };
    }),

  startExecutionClock: (sessionId, startAt) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, {
        executionClock: { startAt, endAt: null },
      }),
    })),

  finishExecutionClock: (sessionId, endAt) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      if (ss.executionClock.startAt === null) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          executionClock: {
            startAt: ss.executionClock.startAt,
            endAt: endAt ?? Date.now(),
          },
        }),
      };
    }),

  clearExecutionClock: (sessionId) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, {
        executionClock: { startAt: null, endAt: null },
      }),
    })),

  setMessages: (sessionId, messages) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, { messages }),
    })),

  setPartialMessage: (sessionId, partial) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          partialMessage: ss.partialMessage + partial,
        }),
      };
    }),

  clearPartialMessage: (sessionId) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, { partialMessage: '' }),
    })),

  setPartialThinking: (sessionId, delta) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          partialThinking: ss.partialThinking + delta,
        }),
      };
    }),

  clearPartialThinking: (sessionId) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, { partialThinking: '' }),
    })),

  activateNextTurn: (sessionId, stepId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      if (ss.pendingTurns.length === 0) {
        return {
          sessionStates: patchSession(state.sessionStates, sessionId, {
            activeTurn: null,
          }),
        };
      }

      const [nextMessageId, ...rest] = ss.pendingTurns;
      const updatedMessages = ss.messages.map((message) =>
        message.id === nextMessageId ? { ...message, localStatus: undefined } : message
      );

      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          messages: updatedMessages,
          pendingTurns: rest,
          activeTurn: { stepId, userMessageId: nextMessageId },
        }),
      };
    }),

  updateActiveTurnStep: (sessionId, stepId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      if (!ss.activeTurn || ss.activeTurn.stepId === stepId) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          activeTurn: { ...ss.activeTurn, stepId },
        }),
      };
    }),

  clearActiveTurn: (sessionId, stepId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      if (!ss.activeTurn) return {};
      if (stepId && ss.activeTurn.stepId !== stepId) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          activeTurn: null,
        }),
      };
    }),

  clearPendingTurns: (sessionId) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, { pendingTurns: [] }),
    })),

  enqueueQueuedIntent: (intent) =>
    set((state) => {
      const ss = getSession(state.sessionStates, intent.sessionId);
      const nextIntent: QueuedIntent = {
        ...intent,
        source: intent.source ?? 'queue',
        updatedAt: Date.now(),
      };
      const next = [...ss.queuedIntents.filter((item) => item.id !== intent.id), nextIntent];
      writeQueuedIntents(intent.sessionId, next);
      return {
        sessionStates: patchSession(state.sessionStates, intent.sessionId, {
          queuedIntents: next,
        }),
      };
    }),

  updateQueuedIntent: (sessionId, intentId, updates) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      let changed = false;
      const next = ss.queuedIntents.map((intent) => {
        if (intent.id !== intentId) return intent;
        changed = true;
        return { ...intent, ...updates, updatedAt: Date.now() };
      });
      if (!changed) return {};
      writeQueuedIntents(sessionId, next);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, { queuedIntents: next }),
      };
    }),

  removeQueuedIntent: (sessionId, intentId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      const next = ss.queuedIntents.filter((intent) => intent.id !== intentId);
      if (next.length === ss.queuedIntents.length) return {};
      writeQueuedIntents(sessionId, next);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, { queuedIntents: next }),
      };
    }),

  shiftQueuedIntent: (sessionId) => {
    let shifted: QueuedIntent | null = null;
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      if (ss.queuedIntents.length === 0) return {};
      const [first, ...rest] = ss.queuedIntents;
      shifted = first ?? null;
      writeQueuedIntents(sessionId, rest);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, { queuedIntents: rest }),
      };
    });
    return shifted;
  },

  clearQueuedMessages: (sessionId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      let hasQueued = false;
      const updatedMessages = ss.messages.map((message) => {
        if (message.localStatus === 'queued') {
          hasQueued = true;
          return { ...message, localStatus: undefined };
        }
        return message;
      });
      // Also remove any queued message IDs from pendingTurns
      const queuedIds = new Set(
        ss.messages.filter((m) => m.localStatus === 'queued').map((m) => m.id)
      );
      const updatedPendingTurns = ss.pendingTurns.filter((id) => !queuedIds.has(id));
      if (!hasQueued) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          messages: updatedMessages,
          pendingTurns: updatedPendingTurns,
        }),
      };
    }),

  cancelQueuedMessages: (sessionId) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      let hasQueued = false;
      const updatedMessages = ss.messages.map((message) => {
        if (message.localStatus === 'queued') {
          hasQueued = true;
          return { ...message, localStatus: 'cancelled' as const };
        }
        return message;
      });
      if (!hasQueued) return {};
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          messages: updatedMessages,
        }),
      };
    }),

  // Trace actions
  addTraceStep: (sessionId, step) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          traceSteps: [...ss.traceSteps, step],
        }),
      };
    }),

  updateTraceStep: (sessionId, stepId, updates) =>
    set((state) => {
      const ss = getSession(state.sessionStates, sessionId);
      return {
        sessionStates: patchSession(state.sessionStates, sessionId, {
          traceSteps: ss.traceSteps.map((step) => {
            if (step.id !== stepId) return step;
            // toolOutputDelta is an APPEND instruction (tool_stream events):
            // concatenate onto the accumulated output instead of replacing
            // it — a plain spread would keep only the last chunk. tool_end
            // still sets the authoritative full toolOutput via a plain
            // update. Tail-capped so a runaway stream can't grow unbounded.
            const { toolOutputDelta, ...rest } = updates;
            const next = { ...step, ...rest };
            if (toolOutputDelta) {
              const merged = (step.toolOutput ?? '') + toolOutputDelta;
              next.toolOutput =
                merged.length > STREAMED_TOOL_OUTPUT_CAP
                  ? merged.slice(-STREAMED_TOOL_OUTPUT_CAP)
                  : merged;
            }
            return next;
          }),
        }),
      };
    }),

  setTraceSteps: (sessionId, steps) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, { traceSteps: steps }),
    })),

  // UI actions
  setLoading: (loading) => set({ isLoading: loading }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleContextPanel: () =>
    set((state) => ({ contextPanelCollapsed: !state.contextPanelCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setContextPanelCollapsed: (collapsed) => set({ contextPanelCollapsed: collapsed }),
  setNewShellEnabled: (on) => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('COWORK_NEW_SHELL', String(on));
    } catch {
      /* ignore */
    }
    set({ newShellEnabled: on });
  },
  setPrimaryView: (v) => set({ primaryView: v }),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowEvolutionPanel: (show) => set({ showEvolutionPanel: show }),
  setShowKnowledgePanel: (show) => set({ showKnowledgePanel: show }),
  setShowSciencePanel: (show) => set({ showSciencePanel: show }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setScheduleDraft: (draft) =>
    set({
      scheduleDraft: draft ? { ...draft, nonce: Date.now() } : null,
    }),
  clearScheduleDraft: () => set({ scheduleDraft: null }),
  setPermissionRuleTestDraft: (draft) =>
    set({
      permissionRuleTestDraft: draft ? { ...draft, nonce: Date.now() } : null,
    }),
  clearPermissionRuleTestDraft: () => set({ permissionRuleTestDraft: null }),
  setPermissionRuleDraft: (draft) =>
    set({
      permissionRuleDraft: draft ? { ...draft, nonce: Date.now() } : null,
    }),
  clearPermissionRuleDraft: () => set({ permissionRuleDraft: null }),
  setFocusedMessageTarget: (target) => set({ focusedMessageTarget: target }),
  clearFocusedMessageTarget: () => set({ focusedMessageTarget: null }),

  // Permission actions
  setPendingPermission: (permission) => set({ pendingPermission: permission }),

  // Sudo password actions
  setPendingSudoPassword: (request) => set({ pendingSudoPassword: request }),

  // Settings actions
  setSettings: (updates) =>
    set((state) => ({
      settings: { ...state.settings, ...updates },
    })),
  updateSettings: (updates) => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      window.electronAPI.send({
        type: 'settings.update',
        payload: updates as Record<string, unknown>,
      });
    }
    set((state) => ({
      settings: { ...state.settings, ...updates },
    }));
  },

  // Config actions
  setAppConfig: (config) => set({ appConfig: config }),
  setIsConfigured: (configured) => set({ isConfigured: configured }),
  setShowConfigModal: (show) => set({ showConfigModal: show }),
  markInitialConfigStatusSeen: () => set({ hasSeenInitialConfigStatus: true }),
  setGlobalNotice: (notice) => set({ globalNotice: notice }),
  clearGlobalNotice: () => set({ globalNotice: null }),

  // Working directory actions
  setWorkingDir: (path) => set({ workingDir: path }),

  // Sandbox setup actions
  setSandboxSetupProgress: (progress) => set({ sandboxSetupProgress: progress }),
  setSandboxSetupComplete: (complete) => set({ isSandboxSetupComplete: complete }),

  // Sandbox sync actions
  setSandboxSyncStatus: (status) => set({ sandboxSyncStatus: status }),
  setSkillsStorageChangedAt: (timestamp) => set({ skillsStorageChangedAt: timestamp }),
  setSkillsStorageChangeEvent: (event) => set({ skillsStorageChangeEvent: event }),

  // Context window actions
  setSessionContextWindow: (sessionId, contextWindow) =>
    set((state) => ({
      sessionStates: patchSession(state.sessionStates, sessionId, { contextWindow }),
    })),

  setGoalStatus: (sessionId, goal) =>
    set((state) => {
      // 'cleared' means the user dropped the goal → hide the banner + timeline.
      // 'active', 'paused' and 'done' all stay visible (done shows a green ✓
      // until the user clears it or starts a new goal).
      if (goal.status === 'cleared') {
        if (!state.goalStatesBySession[sessionId] && !state.goalPhasesBySession[sessionId]) return {};
        const nextStatus = { ...state.goalStatesBySession };
        const nextPhases = { ...state.goalPhasesBySession };
        delete nextStatus[sessionId];
        delete nextPhases[sessionId];
        return { goalStatesBySession: nextStatus, goalPhasesBySession: nextPhases };
      }
      // Accumulate one phase per judged turn so the timeline grows turn by turn.
      // If the same turn re-fires (e.g. an up-front 0/N then a judged 0/N),
      // replace the last entry rather than duplicating it.
      const phases = state.goalPhasesBySession[sessionId] ?? [];
      const last = phases[phases.length - 1];
      const nextPhases =
        last && last.turnsUsed === goal.turnsUsed
          ? [...phases.slice(0, -1), goal]
          : [...phases, goal];
      return {
        goalStatesBySession: { ...state.goalStatesBySession, [sessionId]: goal },
        goalPhasesBySession: { ...state.goalPhasesBySession, [sessionId]: nextPhases },
      };
    }),

  clearGoalStatus: (sessionId) =>
    set((state) => {
      if (!state.goalStatesBySession[sessionId] && !state.goalPhasesBySession[sessionId]) return {};
      const nextStatus = { ...state.goalStatesBySession };
      const nextPhases = { ...state.goalPhasesBySession };
      delete nextStatus[sessionId];
      delete nextPhases[sessionId];
      return { goalStatesBySession: nextStatus, goalPhasesBySession: nextPhases };
    }),

  // System theme actions
  setRemoteBackend: (state) => set({ remoteBackend: state }),
  setNgrokTunnel: (updates) =>
    set((state) => ({
      ngrokTunnel: { ...state.ngrokTunnel, ...updates },
    })),

  setSystemDarkMode: (dark) => set({ systemDarkMode: dark }),

  // Diff preview actions
  addDiffPreview: (sessionId, preview) =>
    set((state) => ({
      diffPreviews: {
        ...state.diffPreviews,
        [sessionId]: [...(state.diffPreviews[sessionId] || []), preview],
      },
    })),
  clearDiffPreviews: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.diffPreviews;
      return { diffPreviews: rest };
    }),

  // Checkpoint actions
  setCheckpointTimeline: (timeline) => set({ checkpointTimeline: timeline }),
  addCheckpoint: (snapshot) =>
    set((state) => {
      const current = state.checkpointTimeline || {
        snapshots: [],
        currentIndex: -1,
        canUndo: false,
        canRedo: false,
      };
      const snapshots = [...current.snapshots, snapshot];
      return {
        checkpointTimeline: {
          snapshots,
          currentIndex: snapshots.length - 1,
          canUndo: snapshots.length > 0,
          canRedo: false,
        },
      };
    }),

  // Permission mode actions
  setPermissionMode: (mode) => set({ permissionMode: mode }),

  // Command palette actions
  setShowCommandPalette: (show) => set({ showCommandPalette: show }),
  setShowShortcutsDialog: (show) => set({ showShortcutsDialog: show }),
  setShowGlobalSearch: (show) => set({ showGlobalSearch: show }),
  setPreviewFilePath: (filePath) => set({ previewFilePath: filePath }),
  setActiveArtifact: (artifact) => set({ activeArtifact: artifact }),
  appendGuiAction: (action) =>
    set((state) => {
      const next = [...state.guiActions, action];
      // Cap to last 50 actions to bound memory.
      if (next.length > 50) next.splice(0, next.length - 50);
      return { guiActions: next, showComputerUseOverlay: true };
    }),
  setShowComputerUseOverlay: (show) => set({ showComputerUseOverlay: show }),
  appendBrowserAction: (action) =>
    set((state) => {
      const next = [...state.browserActions, action];
      // Cap to last 50 actions to bound memory.
      if (next.length > 50) next.splice(0, next.length - 50);
      return { browserActions: next, showBrowserOperatorOverlay: true };
    }),
  setShowBrowserOperatorOverlay: (show) => set({ showBrowserOperatorOverlay: show }),
  applyWorkflowEvent: (payload) =>
    set((state) => {
      const existing = state.workflowExecutions[payload.instanceId];
      const base =
        existing ??
        {
          workflowId: payload.workflowId,
          instanceId: payload.instanceId,
          status: 'running' as const,
          startedAt: Date.now(),
          nodeStatuses: {} as Record<string, 'pending' | 'running' | 'completed' | 'failed' | 'skipped'>,
        };
      switch (payload.type) {
        case 'started':
          return {
            workflowExecutions: {
              ...state.workflowExecutions,
              [payload.instanceId]: { ...base, status: 'running', startedAt: Date.now() },
            },
          };
        case 'node_started':
          return {
            workflowExecutions: {
              ...state.workflowExecutions,
              [payload.instanceId]: {
                ...base,
                nodeStatuses: { ...base.nodeStatuses, [payload.nodeId]: 'running' },
              },
            },
          };
        case 'node_completed':
          return {
            workflowExecutions: {
              ...state.workflowExecutions,
              [payload.instanceId]: {
                ...base,
                nodeStatuses: { ...base.nodeStatuses, [payload.nodeId]: 'completed' },
              },
            },
          };
        case 'node_failed':
          return {
            workflowExecutions: {
              ...state.workflowExecutions,
              [payload.instanceId]: {
                ...base,
                nodeStatuses: { ...base.nodeStatuses, [payload.nodeId]: 'failed' },
              },
            },
          };
        case 'completed':
          return {
            workflowExecutions: {
              ...state.workflowExecutions,
              [payload.instanceId]: { ...base, status: 'completed', completedAt: Date.now() },
            },
          };
        case 'failed':
          return {
            workflowExecutions: {
              ...state.workflowExecutions,
              [payload.instanceId]: {
                ...base,
                status: 'failed',
                completedAt: Date.now(),
                error: payload.error,
              },
            },
          };
        default:
          return {};
      }
    }),
  upsertMissionRuntime: (mission) =>
    set((state) => ({
      missionRuntime: {
        ...state.missionRuntime,
        [mission.id]: mission,
      },
      missionRuntimeEvents: {
        ...state.missionRuntimeEvents,
        [mission.id]: mission.events.slice(-MISSION_RUNTIME_EVENT_LIMIT),
      },
    })),
  applyMissionRuntimeEvent: (payload) =>
    set((state) => {
      const previousEvents =
        state.missionRuntimeEvents[payload.missionId] ??
        state.missionRuntime[payload.missionId]?.events ??
        [];
      const nextEvents = appendMissionRuntimeEvent(previousEvents, payload.event);
      const mission = state.missionRuntime[payload.missionId];
      return {
        missionRuntimeEvents: {
          ...state.missionRuntimeEvents,
          [payload.missionId]: nextEvents,
        },
        ...(mission
          ? {
              missionRuntime: {
                ...state.missionRuntime,
                [payload.missionId]: {
                  ...mission,
                  events: nextEvents,
                },
              },
            }
          : {}),
      };
    }),
  markMissionRuntimeHeartbeat: (missionId, at = new Date().toISOString()) =>
    set((state) => ({
      missionRuntimeHeartbeats: {
        ...state.missionRuntimeHeartbeats,
        [missionId]: at,
      },
    })),
  pushPendingApproval: (approval) =>
    set((state) => {
      const filtered = state.pendingApprovals.filter((a) => a.stepId !== approval.stepId);
      return { pendingApprovals: [...filtered, approval] };
    }),
  removePendingApproval: (stepId) =>
    set((state) => ({
      pendingApprovals: state.pendingApprovals.filter((a) => a.stepId !== stepId),
    })),
  openTab: (sessionId, title) =>
    set((state) => {
      // Dedupe: if already open, just activate it.
      const existing = state.openTabs.find((t) => t.sessionId === sessionId);
      if (existing) {
        return { activeSessionId: sessionId };
      }
      const newTab = { id: `tab-${sessionId}`, sessionId, title };
      return {
        openTabs: [...state.openTabs, newTab],
        activeSessionId: sessionId,
      };
    }),
  closeTab: (tabId) =>
    set((state) => {
      const index = state.openTabs.findIndex((t) => t.id === tabId);
      if (index === -1) return state;
      const closing = state.openTabs[index];
      // Pinned tabs refuse to close — they protect long-running sessions.
      if (closing.pinned) return state;
      const remaining = state.openTabs.filter((t) => t.id !== tabId);
      // If the closed tab was active, activate the next one (or previous if it was last).
      let nextActive = state.activeSessionId;
      if (state.activeSessionId === closing.sessionId) {
        if (remaining.length === 0) {
          nextActive = null;
        } else {
          const fallback = remaining[Math.min(index, remaining.length - 1)];
          nextActive = fallback.sessionId;
        }
      }
      return { openTabs: remaining, activeSessionId: nextActive };
    }),
  closeOtherTabs: (keepTabId) =>
    set((state) => {
      const keep = state.openTabs.find((t) => t.id === keepTabId);
      if (!keep) return state;
      // Pinned tabs are immune to "close others" — they survive too.
      const remaining = state.openTabs.filter((t) => t.id === keepTabId || t.pinned);
      return {
        openTabs: remaining,
        activeSessionId: keep.sessionId,
      };
    }),
  closeTabsToRight: (tabId) =>
    set((state) => {
      const index = state.openTabs.findIndex((t) => t.id === tabId);
      if (index === -1) return state;
      // Pinned tabs are immune even if to the right.
      const remaining = state.openTabs.filter(
        (t, i) => i <= index || t.pinned
      );
      const stillActive = remaining.some(
        (t) => t.sessionId === state.activeSessionId
      );
      return {
        openTabs: remaining,
        activeSessionId: stillActive
          ? state.activeSessionId
          : state.openTabs[index].sessionId,
      };
    }),
  switchTab: (tabId) =>
    set((state) => {
      const tab = state.openTabs.find((t) => t.id === tabId);
      if (!tab) return state;
      return { activeSessionId: tab.sessionId };
    }),
  reorderTabs: (sourceIndex, targetIndex) =>
    set((state) => {
      if (
        sourceIndex < 0 ||
        sourceIndex >= state.openTabs.length ||
        targetIndex < 0 ||
        targetIndex >= state.openTabs.length
      ) {
        return state;
      }
      const next = [...state.openTabs];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      // Phase 6: keep pinned tabs as a contiguous left-aligned group so a
      // user dragging a pinned past an unpinned (or vice-versa) doesn't
      // break the invariant. Stable partition preserves intra-group order.
      const pinned = next.filter((t) => t.pinned);
      const unpinned = next.filter((t) => !t.pinned);
      return { openTabs: [...pinned, ...unpinned] };
    }),
  updateTabTitle: (sessionId, title) =>
    set((state) => ({
      openTabs: state.openTabs.map((t) => (t.sessionId === sessionId ? { ...t, title } : t)),
    })),
  togglePinnedTab: (tabId) =>
    set((state) => {
      const idx = state.openTabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return state;
      const flipped = state.openTabs.map((t) =>
        t.id === tabId ? { ...t, pinned: !t.pinned } : t
      );
      // Sort: pinned first (stable), unpinned in their existing order.
      const pinned = flipped.filter((t) => t.pinned);
      const unpinned = flipped.filter((t) => !t.pinned);
      return { openTabs: [...pinned, ...unpinned] };
    }),
  setPinnedSessionIds: (sessionIds) =>
    set((state) => {
      const pinSet = new Set(sessionIds);
      const next = state.openTabs.map((t) => ({
        ...t,
        pinned: pinSet.has(t.sessionId),
      }));
      const pinned = next.filter((t) => t.pinned);
      const unpinned = next.filter((t) => !t.pinned);
      return { openTabs: [...pinned, ...unpinned] };
    }),
  incrementTabUnread: (sessionId) =>
    set((state) => {
      // Only count if the session is open AND not currently active.
      if (state.activeSessionId === sessionId) return state;
      const tab = state.openTabs.find((t) => t.sessionId === sessionId);
      if (!tab) return state;
      return {
        openTabs: state.openTabs.map((t) =>
          t.sessionId === sessionId
            ? { ...t, unread: Math.min(99, (t.unread ?? 0) + 1) }
            : t
        ),
      };
    }),
  clearTabUnread: (sessionId) =>
    set((state) => ({
      openTabs: state.openTabs.map((t) =>
        t.sessionId === sessionId && t.unread ? { ...t, unread: 0 } : t
      ),
    })),
  setClipboardSummary: (payload) => set({ clipboardSummary: payload }),
  setClipboardMonitoringEnabled: (enabled) =>
    set({ clipboardMonitoringEnabled: enabled }),
  setClipboardSummarising: (busy) => set({ clipboardSummarising: busy }),
  setShowMemoryEditor: (show) => set({ showMemoryEditor: show }),
  setShowActivityFeed: (show) => set({ showActivityFeed: show }),
  setShowFileActivity: (show) => set({ showFileActivity: show }),
  setShowSessionInsights: (show) => set({ showSessionInsights: show }),
  setShowResumeChooser: (show) => set({ showResumeChooser: show }),
  setShowFocusView: (show) => set({ showFocusView: show }),
  setBookmarkedMessageIds: (ids) => set({ bookmarkedMessageIds: new Set(ids) }),
  toggleBookmarkedMessage: (messageId, bookmarked) =>
    set((state) => {
      const next = new Set(state.bookmarkedMessageIds);
      if (bookmarked) next.add(messageId);
      else next.delete(messageId);
      return { bookmarkedMessageIds: next };
    }),
  setShowBookmarksPanel: (show) => set({ showBookmarksPanel: show }),
  setShowSnippetsLibrary: (show) => set({ showSnippetsLibrary: show }),
  setShowPersonaSwitcher: (show) => set({ showPersonaSwitcher: show }),
  setShowTestRunner: (show) => set({ showTestRunner: show }),
  setShowReasoningViewer: (show) => set({ showReasoningViewer: show }),
  setShowAutonomyPanel: (show) => set({ showAutonomyPanel: show }),
  setShowLiveLauncher: (show) => set({ showLiveLauncher: show }),
  setLiveLauncherDeepIntent: (deep) => set({ liveLauncherDeepIntent: deep }),
  setSplitPaneEnabled: (enabled) => {
    set({ splitPaneEnabled: enabled });
    try {
      window.localStorage?.setItem('cowork.layout.splitEnabled', enabled ? '1' : '0');
    } catch {
      /* ignore */
    }
  },
  toggleSplitPane: () => {
    set((state) => {
      const next = !state.splitPaneEnabled;
      try {
        window.localStorage?.setItem('cowork.layout.splitEnabled', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return { splitPaneEnabled: next };
    });
  },
  setSplitPaneRatio: (ratio) => {
    const clamped = Math.max(0.2, Math.min(0.8, ratio));
    set({ splitPaneRatio: clamped });
    try {
      window.localStorage?.setItem('cowork.layout.splitRatio', String(clamped));
    } catch {
      /* ignore */
    }
  },

  // Presence actions
  setShowEnrollmentDialog: (show) => set({ showEnrollmentDialog: show }),
  setShowModelInstallDialog: (show) => set({ showModelInstallDialog: show }),
  setPresenceEnabled: (enabled) => {
    set({ presenceEnabled: enabled });
    try {
      window.localStorage?.setItem('cowork.presence.enabled', enabled ? '1' : '0');
    } catch {
      /* ignore */
    }
  },
  setCurrentPresence: (payload) => {
    if (payload === null) {
      set({ currentPresence: null, lastPresenceEventType: null });
      return;
    }
    // 'left' clears the current match; 'enrolled' is informational and
    // doesn't change who's currently in front of the camera; 'detected'
    // sets the match; 'unknown' keeps currentPresence null but records
    // the event type so the indicator can show "👤 inconnu".
    if (payload.type === 'left') {
      set({ currentPresence: null, lastPresenceEventType: 'left' });
    } else if (payload.type === 'detected' && payload.match) {
      set({ currentPresence: payload.match, lastPresenceEventType: 'detected' });
    } else if (payload.type === 'unknown') {
      set({ currentPresence: null, lastPresenceEventType: 'unknown' });
    } else {
      set({ lastPresenceEventType: payload.type });
    }
  },

  // Orchestrator launcher actions
  setShowOrchestratorLauncher: (show) => set({ showOrchestratorLauncher: show }),
  setLastOrchestratorOptions: (opts) => {
    set({ lastOrchestratorOptions: opts });
    try {
      window.localStorage?.setItem(
        'cowork.orchestrator.lastOptions',
        JSON.stringify(opts),
      );
    } catch {
      /* ignore */
    }
  },

  // Update actions
  setUpdateInfo: (info) => set({ updateInfo: info }),

  // Search actions
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchActive: (active) => set({ searchActive: active, searchQuery: active ? '' : '' }),

  // Project actions
  setProjects: (projects) => set({ projects }),
  addProject: (project) =>
    set((state) => ({ projects: [project, ...state.projects.filter((p) => p.id !== project.id)] })),
  updateProject: (projectId, updates) =>
    set((state) => ({
      projects: state.projects.map((p) => (p.id === projectId ? { ...p, ...updates } : p)),
    })),
  removeProject: (projectId) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== projectId),
      activeProjectId: state.activeProjectId === projectId ? null : state.activeProjectId,
    })),
  setActiveProjectId: (projectId) => set({ activeProjectId: projectId }),

  // Sub-agent actions
  addSubAgent: (sessionId, subAgent) =>
    set((state) => {
      const existing = state.subAgents[sessionId] ?? [];
      const filtered = existing.filter((a) => a.id !== subAgent.id);
      return {
        subAgents: { ...state.subAgents, [sessionId]: [...filtered, subAgent] },
      };
    }),
  updateSubAgentStatus: (sessionId, agentId, status) =>
    set((state) => {
      const list = state.subAgents[sessionId];
      if (!list) return state;
      return {
        subAgents: {
          ...state.subAgents,
          [sessionId]: list.map((a) => (a.id === agentId ? { ...a, status } : a)),
        },
      };
    }),
  completeSubAgent: (sessionId, agentId, result) =>
    set((state) => {
      const list = state.subAgents[sessionId];
      if (!list) return state;
      return {
        subAgents: {
          ...state.subAgents,
          [sessionId]: list.map((a) =>
            a.id === agentId ? { ...a, status: 'completed' as SubAgentStatus, result } : a
          ),
        },
      };
    }),
  appendSubAgentOutput: (sessionId, agentId, delta) =>
    set((state) => {
      const sessionOutputs = state.subAgentOutputs[sessionId] ?? {};
      const existing = sessionOutputs[agentId] ?? '';
      return {
        subAgentOutputs: {
          ...state.subAgentOutputs,
          [sessionId]: { ...sessionOutputs, [agentId]: existing + delta },
        },
      };
    }),
  setSubAgentActivity: (sessionId, agentId, currentStep) =>
    set((state) => {
      const list = state.subAgents[sessionId];
      if (!list) return state;
      return {
        subAgents: {
          ...state.subAgents,
          [sessionId]: list.map((a) => (a.id === agentId ? { ...a, currentStep } : a)),
        },
      };
    }),

  // Fleet actions (GAP 3)
  setFleetPeers: (peers) =>
    set(() => ({
      fleetPeers: peers.reduce<Record<string, FleetPeer>>((acc, p) => {
        acc[p.id] = p;
        return acc;
      }, {}),
    })),
  upsertFleetPeer: (peer) =>
    set((state) => ({ fleetPeers: { ...state.fleetPeers, [peer.id]: peer } })),
  removeFleetPeer: (peerId) =>
    set((state) => {
      const { [peerId]: _dropped, ...rest } = state.fleetPeers;
      return {
        fleetPeers: rest,
        fleetEvents: state.fleetEvents.filter((e) => e.peerId !== peerId),
      };
    }),
  appendFleetEvent: (event) =>
    set((state) => {
      const next = [...state.fleetEvents, event];
      const FLEET_EVENT_RING = 200;
      while (next.length > FLEET_EVENT_RING) next.shift();
      return { fleetEvents: next };
    }),
  bumpFleetSagaUpdate: () =>
    set((state) => ({ fleetSagaUpdateToken: state.fleetSagaUpdateToken + 1 })),
  setFleetDiscoveredPeers: (peers) =>
    set((state) => {
      const known = new Set(state.fleetDiscoveredPeers.map((p) => p.url));
      const merged = [...state.fleetDiscoveredPeers];
      for (const p of peers) if (!known.has(p.url)) merged.push(p);
      return { fleetDiscoveredPeers: merged };
    }),
  dismissFleetDiscoveredPeer: (url) =>
    set((state) => ({
      fleetDiscoveredPeers: state.fleetDiscoveredPeers.filter((p) => p.url !== url),
    })),
  setShowFleetPanel: (show) => set({ showFleetPanel: show }),
  setShowSkillsManager: (show) => set({ showSkillsManager: show }),
  setShowClawMigration: (show) => set({ showClawMigration: show }),
  setShowKanban: (show) => set({ showKanban: show }),
  setShowMissionBoard: (show) => set({ showMissionBoard: show }),
  setShowDesktopSnapshot: (show) => set({ showDesktopSnapshot: show }),
  setShowFleetCommandCenter: (show) => set({ showFleetCommandCenter: show }),
  setFleetGoalDraft: (draft) =>
    set({
      fleetGoalDraft: draft
        ? {
            ...draft,
            nonce: Date.now(),
          }
        : null,
    }),

  // A2A task actions (GAP 1)
  upsertA2ATask: (task) =>
    set((state) => ({ a2aTasks: { ...state.a2aTasks, [task.taskId]: task } })),
  removeA2ATask: (taskId) =>
    set((state) => {
      const { [taskId]: _dropped, ...rest } = state.a2aTasks;
      return { a2aTasks: rest };
    }),

  // Team actions (Phase 4 layer 9)
  setTeamSnapshot: (snapshot) =>
    set(() => {
      if (!snapshot) {
        return { team: null, teamMembers: {}, teamTasks: {}, teamMailbox: [] };
      }
      const members = snapshot.members.reduce<Record<string, TeamMember>>((acc, m) => {
        acc[m.id] = m;
        return acc;
      }, {});
      return { team: snapshot, teamMembers: members };
    }),
  upsertTeamMember: (member) =>
    set((state) => ({
      teamMembers: { ...state.teamMembers, [member.id]: member },
    })),
  removeTeamMember: (memberId) =>
    set((state) => {
      const { [memberId]: _dropped, ...rest } = state.teamMembers;
      return { teamMembers: rest };
    }),
  upsertTeamTask: (task) =>
    set((state) => ({
      teamTasks: { ...state.teamTasks, [task.id]: task },
    })),
  appendTeamMessage: (msg) =>
    set((state) => {
      const next = [...state.teamMailbox, msg];
      const TEAM_MAILBOX_RING = 200;
      while (next.length > TEAM_MAILBOX_RING) next.shift();
      return { teamMailbox: next };
    }),
  setShowTeamPanel: (show) => set({ showTeamPanel: show }),
  setShowWorkflowProPanel: (show) => set({ showWorkflowProPanel: show }),
  setShowLessonCandidatePanel: (show) => set({ showLessonCandidatePanel: show }),
  setShowUserModelPanel: (show) => set({ showUserModelPanel: show }),
  setShowSpecPanel: (show) => set({ showSpecPanel: show }),
  setShowMobileSupervisionPanel: (show) => set({ showMobileSupervisionPanel: show }),
  setShowIdentityPanel: (show) => set({ showIdentityPanel: show }),
  setShowDevicePanel: (show) => set({ showDevicePanel: show }),
  setShowChannelsPanel: (show) => set({ showChannelsPanel: show }),
  setShowLessonsGraph: (show) => set({ showLessonsGraph: show }),
  setShowCompanionPanel: (show) => set({ showCompanionPanel: show }),
  setShowHelpDocs: (show) => set({ showHelpDocs: show }),
  clearSubAgents: (sessionId) =>
    set((state) => {
      const { [sessionId]: _dropped, ...rest } = state.subAgents;
      const { [sessionId]: _droppedOutputs, ...restOutputs } = state.subAgentOutputs;
      void _dropped;
      void _droppedOutputs;
      return { subAgents: rest, subAgentOutputs: restOutputs };
    }),

  // Notification actions
  addNotification: (notification) =>
    set((state) => ({ notifications: [notification, ...state.notifications].slice(0, 100) })),
  markNotificationRead: (notificationId) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === notificationId ? { ...n, read: true } : n
      ),
    })),
  markAllNotificationsRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    })),
  removeNotification: (notificationId) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== notificationId),
    })),
  setShowNotificationCenter: (show) => set({ showNotificationCenter: show }),
}));

// Expose helpers for nav-server (CLI-driven UI navigation via executeJavaScript)
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;

  // Debug: expose the store so DevTools / CDP can introspect it.
  w.useAppStore = useAppStore;

  w.__getNavStatus = () => {
    const s = useAppStore.getState();
    return {
      showSettings: !!s.showSettings,
      activeSessionId: s.activeSessionId || null,
      activeProjectId: s.activeProjectId || null,
      sessionCount: (s.sessions || []).length,
    };
  };

  w.__navigate = (page: string, tab?: string, sessionId?: string) => {
    const store = useAppStore.getState();
    if (page === 'welcome') {
      store.setShowSettings(false);
      store.setActiveSession(null);
    } else if (page === 'settings') {
      store.setSettingsTab(tab || 'api');
      store.setShowSettings(true);
    } else if (page === 'session') {
      if (!sessionId || typeof sessionId !== 'string') return false;
      const exists = store.sessions.some((s) => s.id === sessionId);
      if (!exists) return false;
      store.setShowSettings(false);
      store.setActiveSession(sessionId);
    }
    return true;
  };

  w.__injectPermissionRequest = (
    permission: {
      toolUseId: string;
      toolName: string;
      input: Record<string, unknown>;
      sessionId: string;
    },
    guiAction?: {
      projectId?: string | null;
      sessionId?: string;
      toolUseId?: string;
      action?: string;
      toolName?: string;
      screenshot?: string;
      click?: { x: number; y: number };
      details?: Record<string, unknown>;
    }
  ) => {
    const store = useAppStore.getState();
    store.setShowSettings(false);
    if (guiAction?.projectId !== undefined) {
      store.setActiveProjectId(guiAction.projectId);
    }
    if (guiAction) {
      store.appendGuiAction({
        sessionId: guiAction.sessionId || permission.sessionId,
        toolUseId: guiAction.toolUseId || permission.toolUseId,
        action: guiAction.action || 'test.permission',
        toolName: guiAction.toolName || permission.toolName,
        screenshot: guiAction.screenshot,
        click: guiAction.click,
        details: guiAction.details,
        timestamp: Date.now(),
      });
    }
    store.setPendingPermission(permission);
    return true;
  };
}
