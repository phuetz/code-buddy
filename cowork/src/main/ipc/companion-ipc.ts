/**
 * Companion IPC — Lisa-inspired senses/status surface for Cowork.
 *
 * Wraps the core companion modules through `core-loader` so Cowork can show
 * Buddy's local sensory journal without duplicating storage logic.
 *
 * @module main/ipc/companion-ipc
 */

import { ipcMain } from 'electron';
import { loadCoreModule } from '../utils/core-loader';
import { logError } from '../utils/logger';
import { resolveWorkDir, errorMessage, type ProjectManagerSource } from './ipc-workdir';

type CompanionPerceptModality =
  | 'vision'
  | 'hearing'
  | 'screen'
  | 'self'
  | 'memory'
  | 'tool'
  | 'suggestion';

interface CompanionPercept {
  id: string;
  modality: CompanionPerceptModality;
  source: string;
  timestamp: string;
  confidence: number;
  summary: string;
  payload: Record<string, unknown>;
  tags: string[];
}

interface CompanionPerceptStats {
  storePath: string;
  exists: boolean;
  total: number;
  byModality: Partial<Record<CompanionPerceptModality, number>>;
  latestTimestamp?: string;
}

interface CompanionSelfEvaluationFinding {
  id: string;
  area: string;
  severity: 'info' | 'warning' | 'action';
  summary: string;
  recommendation: string;
  command?: string;
  tags: string[];
}

interface CompanionSelfEvaluation {
  id: string;
  timestamp: string;
  cwd: string;
  score: number;
  level: 'dormant' | 'awakening' | 'aware' | 'collaborative';
  findings: CompanionSelfEvaluationFinding[];
  strengths: string[];
  nextActions: string[];
  perceptStats: CompanionPerceptStats;
}

interface CompanionCompetitiveGap {
  id: string;
  dimension: string;
  severity: 'lead' | 'parity' | 'gap';
  summary: string;
  recommendation: string;
  competitorRefs: string[];
  command?: string;
  tags: string[];
}

interface CompanionCompetitiveRadar {
  id: string;
  timestamp: string;
  cwd: string;
  score: number;
  currentStrengths: string[];
  gaps: CompanionCompetitiveGap[];
  nextMoves: string[];
  sourceNotes: string[];
}

type CompanionImpulseKind = 'readiness' | 'sense' | 'mission' | 'safety' | 'memory' | 'conversation';
type CompanionImpulsePriority = 'high' | 'medium' | 'low';

interface CompanionImpulse {
  id: string;
  kind: CompanionImpulseKind;
  priority: CompanionImpulsePriority;
  title: string;
  message: string;
  command?: string;
  evidence: Array<{ label: string; value: string }>;
  tags: string[];
}

interface CompanionImpulseBrief {
  id: string;
  timestamp: string;
  cwd: string;
  summary: string;
  nextPrompt: string;
  impulses: CompanionImpulse[];
  context: {
    perceptTotal: number;
    openMissions: number;
    inProgressMissions: number;
    safetyEvents: number;
    latestPerceptTimestamp?: string;
    latestSafetyTimestamp?: string;
  };
}

type CompanionCheckInMood = 'steady' | 'encouraging' | 'urgent' | 'curious';

interface CompanionCheckInEvidence {
  label: string;
  value: string;
}

interface CompanionCheckInCue {
  id: string;
  timestamp: string;
  cwd: string;
  mood: CompanionCheckInMood;
  priority: CompanionImpulsePriority;
  spokenText: string;
  writtenText: string;
  nextPrompt: string;
  suggestedCommand?: string;
  sourceImpulseId?: string;
  sourceImpulseTitle?: string;
  evidence: CompanionCheckInEvidence[];
  brief: CompanionImpulseBrief;
  percept?: CompanionPercept;
  card?: CompanionCard;
  safetyEvent?: CompanionSafetyEvent;
}

type CompanionMissionStatus = 'open' | 'in_progress' | 'done' | 'dismissed';
type CompanionSafetyEventKind = 'sense' | 'tool' | 'mission' | 'permission' | 'data';
type CompanionSafetyEventRisk = 'low' | 'medium' | 'high';
type CompanionSafetyEventStatus = 'planned' | 'allowed' | 'completed' | 'failed' | 'denied';

interface CompanionMission {
  id: string;
  title: string;
  dimension: string;
  status: CompanionMissionStatus;
  priority: 'P0' | 'P1' | 'P2';
  summary: string;
  recommendation: string;
  sourceGapId: string;
  sourceRadarId?: string;
  competitorRefs: string[];
  command?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface CompanionMissionBoard {
  schemaVersion: 1;
  cwd: string;
  storePath: string;
  updatedAt: string;
  missions: CompanionMission[];
}

interface CompanionMissionBoardSyncResult {
  board: CompanionMissionBoard;
  radarId: string;
  created: number;
  updated: number;
  unchanged: number;
}

interface CompanionMissionRunResult {
  success: boolean;
  dryRun: boolean;
  message: string;
  mission?: CompanionMission;
  board?: CompanionMissionBoard;
  brief?: string;
  briefPath?: string;
  perceptId?: string;
  safetyEventId?: string;
  syncedBoard?: boolean;
}

interface CompanionImprovementCycle {
  id: string;
  timestamp: string;
  cwd: string;
  dryRun: boolean;
  recorded: boolean;
  radar: CompanionCompetitiveRadar;
  board: CompanionMissionBoard;
  missionSync?: CompanionMissionBoardSyncResult;
  missionRun?: CompanionMissionRunResult;
  nextActions: string[];
  perceptId?: string;
  safetyEventId?: string;
}

interface CompanionSafetyEvent {
  id: string;
  timestamp: string;
  cwd: string;
  kind: CompanionSafetyEventKind;
  risk: CompanionSafetyEventRisk;
  action: string;
  reason: string;
  status: CompanionSafetyEventStatus;
  source: string;
  artifactPath?: string;
  missionId?: string;
  payload: Record<string, unknown>;
  tags: string[];
}

interface CompanionSafetyLedgerStats {
  ledgerPath: string;
  exists: boolean;
  total: number;
  byKind: Partial<Record<CompanionSafetyEventKind, number>>;
  byRisk: Partial<Record<CompanionSafetyEventRisk, number>>;
  byStatus: Partial<Record<CompanionSafetyEventStatus, number>>;
  latestTimestamp?: string;
}

interface CameraSnapshotResult {
  success: boolean;
  path?: string;
  output?: string;
  error?: string;
  command?: string;
  perceptId?: string;
  perceptPath?: string;
}

interface CameraSnapshotInspectionResult {
  success: boolean;
  path?: string;
  snapshot?: CameraSnapshotResult;
  analysis?: {
    description: string;
    labels: string[];
    dimensions?: { width: number; height: number };
    format?: string;
    size?: number;
    channels?: number;
  };
  ocrText?: string;
  summary?: string;
  error?: string;
  perceptId?: string;
  safetyEventId?: string;
}

interface CompanionSetupResult {
  cwd: string;
  wroteSoul: boolean;
  wroteBoot: boolean;
  skippedSoul: boolean;
  skippedBoot: boolean;
  voiceConfigured: boolean;
  modelConfigured: boolean;
  model?: string;
  status: Record<string, unknown>;
}

interface CompanionSetupResponse {
  setup: CompanionSetupResult;
  selfPercept?: CompanionPercept;
  selfPerceptError?: string;
}

type CompanionCardKind =
  | 'status'
  | 'approval'
  | 'camera'
  | 'checklist'
  | 'mission'
  | 'timer'
  | 'weather'
  | 'tool';
type CompanionCardPriority = 'low' | 'medium' | 'high';
type CompanionCardStatus = 'open' | 'resolved' | 'dismissed';

interface CompanionCardAction {
  id: string;
  label: string;
  command?: string;
  style?: 'primary' | 'secondary' | 'danger';
}

interface CompanionCard {
  id: string;
  kind: CompanionCardKind;
  status: CompanionCardStatus;
  priority: CompanionCardPriority;
  title: string;
  body: string;
  actions: CompanionCardAction[];
  payload: Record<string, unknown>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  resolvedAt?: string;
}

interface CompanionCardStore {
  schemaVersion: 1;
  cwd: string;
  storePath: string;
  updatedAt: string;
  cards: CompanionCard[];
}

type CompanionGatewayMode = 'observe' | 'assist' | 'act';

interface CompanionGatewayChannelConfig {
  channel: string;
  enabled: boolean;
  mode: CompanionGatewayMode;
  allowOutbound: boolean;
  requireApprovalForTools: boolean;
  recordPercepts: boolean;
  tags: string[];
}

interface CompanionGatewayProfile {
  schemaVersion: 1;
  cwd: string;
  storePath: string;
  updatedAt: string;
  defaultMode: CompanionGatewayMode;
  channels: CompanionGatewayChannelConfig[];
}

type CompanionSkillCandidateStatus = 'draft' | 'reviewed' | 'promoted' | 'dismissed';

interface CompanionSkillEvidence {
  kind: 'mission' | 'percept';
  id: string;
  summary: string;
  timestamp?: string;
  weight: number;
}

interface CompanionSkillCandidate {
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
}

interface CompanionSkillCandidateStore {
  schemaVersion: 1;
  cwd: string;
  storePath: string;
  updatedAt: string;
  candidates: CompanionSkillCandidate[];
}

interface CompanionSkillCuratorResult {
  store: CompanionSkillCandidateStore;
  created: number;
  updated: number;
  unchanged: number;
  pruned: number;
  perceptId?: string;
}

interface CompanionSkillPromotionResult {
  candidate: CompanionSkillCandidate;
  artifactPath: string;
  perceptId?: string;
  safetyEventId?: string;
}

type CompanionPrivacyKind =
  | 'percepts'
  | 'safety'
  | 'cards'
  | 'gateway'
  | 'skills'
  | 'camera';

interface CompanionPrivacyStoreSummary {
  kind: CompanionPrivacyKind;
  path: string;
  exists: boolean;
  bytes: number;
  entries: number;
}

interface CompanionPrivacyReport {
  schemaVersion: 1;
  cwd: string;
  generatedAt: string;
  stores: CompanionPrivacyStoreSummary[];
  totalBytes: number;
  totalEntries: number;
}

interface CompanionPrivacyExportResult {
  exportDir: string;
  manifestPath: string;
  report: CompanionPrivacyReport;
  copied: Array<{ kind: CompanionPrivacyKind; from: string; to: string }>;
}

interface CompanionPrivacyPurgeResult {
  purgedAt: string;
  cwd: string;
  kinds: CompanionPrivacyKind[];
  removed: Array<{ kind: CompanionPrivacyKind; path: string; existed: boolean }>;
  backup?: CompanionPrivacyExportResult;
}

type CompanionModeMod = {
  setupCompanionMode: (options: {
    cwd?: string;
    forceIdentity?: boolean;
    configureVoice?: boolean;
    configureModel?: boolean;
    language?: string;
    sttProvider?: string;
    ttsProvider?: string;
    ttsVoice?: string;
    model?: string;
  }) => Promise<CompanionSetupResult>;
  getCompanionStatus: (options: { cwd?: string }) => Promise<Record<string, unknown>>;
  recordCompanionSelfState: (options: { cwd?: string }) => Promise<CompanionPercept>;
};

type CompanionPerceptsMod = {
  readRecentCompanionPercepts: (options: {
    cwd?: string;
    limit?: number;
    modality?: CompanionPerceptModality;
  }) => Promise<CompanionPercept[]>;
  getCompanionPerceptStats: (options: { cwd?: string }) => Promise<CompanionPerceptStats>;
};

type CompanionCameraMod = {
  checkCameraAvailability: () => Promise<Record<string, unknown>>;
  importCameraSnapshot: (options: {
    cwd?: string;
    outputPath?: string;
    dataUrl?: string;
    base64?: string;
    mediaType?: string;
    width?: number;
    height?: number;
    mediaPipe?: unknown;
  }) => Promise<CameraSnapshotResult>;
  captureCameraSnapshot: (options: {
    cwd?: string;
    outputPath?: string;
    device?: string;
    timeoutMs?: number;
  }) => Promise<CameraSnapshotResult>;
  inspectCameraSnapshot: (options: {
    cwd?: string;
    imagePath?: string;
    outputPath?: string;
    device?: string;
    timeoutMs?: number;
    includeOcr?: boolean;
    ocrLanguage?: string;
  }) => Promise<CameraSnapshotInspectionResult>;
};

type CompanionSelfEvaluationMod = {
  evaluateCompanionSelf: (options: {
    cwd?: string;
    recordSuggestions?: boolean;
  }) => Promise<CompanionSelfEvaluation>;
};

type CompanionCompetitiveRadarMod = {
  buildCompanionCompetitiveRadar: (options: {
    cwd?: string;
    recordSuggestions?: boolean;
  }) => Promise<CompanionCompetitiveRadar>;
};

type CompanionImprovementCycleMod = {
  runCompanionImprovementCycle: (options: {
    cwd?: string;
    dryRun?: boolean;
    recordSuggestions?: boolean;
    runMission?: boolean;
  }) => Promise<CompanionImprovementCycle>;
};

type CompanionImpulsesMod = {
  buildCompanionImpulseBrief: (options: {
    cwd?: string;
    recordSuggestions?: boolean;
  }) => Promise<CompanionImpulseBrief>;
};

type CompanionCheckInMod = {
  buildCompanionCheckIn: (options: {
    cwd?: string;
    userText?: string;
    recordPercept?: boolean;
    createCard?: boolean;
    recordSafety?: boolean;
  }) => Promise<CompanionCheckInCue>;
};

type CompanionMissionBoardMod = {
  syncCompanionMissionBoard: (options: {
    cwd?: string;
    recordSuggestions?: boolean;
  }) => Promise<CompanionMissionBoardSyncResult>;
  readCompanionMissionBoard: (options: { cwd?: string }) => Promise<CompanionMissionBoard>;
  updateCompanionMissionStatus: (
    id: string,
    status: CompanionMissionStatus,
    options: { cwd?: string },
  ) => Promise<CompanionMission>;
};

type CompanionMissionRunnerMod = {
  runNextCompanionMission: (options: {
    cwd?: string;
    dryRun?: boolean;
  }) => Promise<CompanionMissionRunResult>;
};

type CompanionSafetyLedgerMod = {
  readRecentCompanionSafetyEvents: (options: {
    cwd?: string;
    limit?: number;
    kind?: CompanionSafetyEventKind;
    risk?: CompanionSafetyEventRisk;
  }) => Promise<CompanionSafetyEvent[]>;
  getCompanionSafetyLedgerStats: (options: { cwd?: string }) => Promise<CompanionSafetyLedgerStats>;
};

type CompanionCardsMod = {
  readCompanionCards: (options: {
    cwd?: string;
    status?: CompanionCardStatus;
    kind?: CompanionCardKind;
    limit?: number;
  }) => Promise<CompanionCardStore>;
  updateCompanionCardStatus: (
    cardId: string,
    status: CompanionCardStatus,
    options: { cwd?: string },
  ) => Promise<CompanionCard>;
};

type CompanionGatewayMod = {
  readCompanionGatewayProfile: (options: { cwd?: string }) => Promise<CompanionGatewayProfile>;
  updateCompanionGatewayChannel: (
    channel: string,
    options: {
      cwd?: string;
      mode?: CompanionGatewayMode;
      allowOutbound?: boolean;
      requireApprovalForTools?: boolean;
      recordPercepts?: boolean;
      enabled?: boolean;
      tags?: string[];
    },
  ) => Promise<CompanionGatewayProfile>;
};

type CompanionGatewayInboxPriority = 'low' | 'normal' | 'high' | 'urgent';

type CompanionGatewayInboxActionType =
  | 'observe'
  | 'draft_reply'
  | 'prepare_task'
  | 'request_local_approval';

type CompanionGatewayInboxItem = {
  id: string;
  receivedAt: string;
  channel: string;
  threadId: string;
  messageId?: string;
  sender: {
    id: string;
    name?: string;
  };
  sessionKey: string;
  content: {
    preview: string;
    contentType: string;
    attachmentCount: number;
    redacted: true;
  };
  mode: CompanionGatewayMode;
  priority: CompanionGatewayInboxPriority;
  status: 'queued' | 'ignored' | 'drafted';
  proposedAction: {
    type: CompanionGatewayInboxActionType;
    label: string;
    requiresLocalApproval: boolean;
    canAutoDispatch: false;
  };
  safety: {
    outboundDisabled: boolean;
    localApprovalRequired: boolean;
    secretRedaction: 'preview_only';
    rawTextStored: false;
  };
  tags: string[];
  reason: string;
  draft?: CompanionGatewayInboxDraftSummary;
};

type CompanionGatewayAutonomousCodeTask = {
  repo: string;
  task: string;
  allowedPaths: string[];
  verification: string[];
  riskLevel: 'low';
  output: 'json';
  branchName: string;
  maxFilesChanged: number;
  maxToolRounds: number;
  memoryPolicy: 'handoff';
  fleetPolicy: 'none';
  edits: [];
};

type CompanionGatewayInboxDraftSummary = {
  id: string;
  createdAt: string;
  kind: 'autonomous_code_task';
  taskFile: string;
  command: string[];
  autoDispatch: false;
  requiresLocalApproval: true;
};

type CompanionGatewayInboxDraft = CompanionGatewayInboxDraftSummary & {
  schemaVersion: 1;
  sourceItemId: string;
  source: {
    channel: string;
    threadId: string;
    senderId: string;
    senderName?: string;
    priority: CompanionGatewayInboxPriority;
    proposedAction: CompanionGatewayInboxActionType;
  };
  task: CompanionGatewayAutonomousCodeTask;
  safety: {
    rawTextStored: false;
    previewOnly: true;
    autoDispatch: false;
    requiresLocalApproval: true;
  };
};

type CompanionGatewayInbox = {
  schemaVersion: 1;
  kind: 'companion_gateway_inbox';
  generatedAt: string;
  cwd: string;
  storePath: string;
  counts: {
    queued: number;
    ignored: number;
    highPriority: number;
    total: number;
  };
  safety: {
    autoDispatch: false;
    rawTextStored: false;
    outboundDisabledByDefault: true;
    localOnly: true;
  };
  items: CompanionGatewayInboxItem[];
};

type CompanionGatewayInboxMod = {
  readCompanionGatewayInbox: (options: { cwd?: string }) => Promise<CompanionGatewayInbox>;
  draftCompanionGatewayInboxItem: (
    itemId: string,
    options: { cwd?: string },
  ) => Promise<CompanionGatewayInboxDraft>;
};

type CompanionSkillCuratorMod = {
  readCompanionSkillCandidates: (options: { cwd?: string }) => Promise<CompanionSkillCandidateStore>;
  curateCompanionSkills: (options: {
    cwd?: string;
    recordSuggestions?: boolean;
  }) => Promise<CompanionSkillCuratorResult>;
  promoteCompanionSkillCandidate: (
    candidateId: string,
    options: { cwd?: string },
  ) => Promise<CompanionSkillPromotionResult>;
  dismissCompanionSkillCandidate: (
    candidateId: string,
    options: { cwd?: string },
  ) => Promise<CompanionSkillCandidate>;
};

type CompanionPrivacyMod = {
  buildCompanionPrivacyReport: (options: { cwd?: string }) => Promise<CompanionPrivacyReport>;
  exportCompanionPrivacyBundle: (options: {
    cwd?: string;
    kinds?: CompanionPrivacyKind[];
  }) => Promise<CompanionPrivacyExportResult>;
  purgeCompanionPrivacyData: (options: {
    cwd?: string;
    kinds?: CompanionPrivacyKind[];
    backup?: boolean;
  }) => Promise<CompanionPrivacyPurgeResult>;
};

const NO_PROJECT = 'NO_ACTIVE_PROJECT';

async function companionWorkDir(
  source: ProjectManagerSource,
  projectId?: string,
): Promise<{ cwd: string | null; error?: string }> {
  const cwd = resolveWorkDir(source, projectId);
  if (!cwd) return { cwd: null, error: NO_PROJECT };
  return { cwd };
}

async function loadMode(): Promise<CompanionModeMod | null> {
  return loadCoreModule<CompanionModeMod>('companion/companion-mode.js');
}

async function loadPercepts(): Promise<CompanionPerceptsMod | null> {
  return loadCoreModule<CompanionPerceptsMod>('companion/percepts.js');
}

async function loadCamera(): Promise<CompanionCameraMod | null> {
  return loadCoreModule<CompanionCameraMod>('companion/camera.js');
}

async function loadSelfEvaluation(): Promise<CompanionSelfEvaluationMod | null> {
  return loadCoreModule<CompanionSelfEvaluationMod>('companion/self-evaluation.js');
}

async function loadCompetitiveRadar(): Promise<CompanionCompetitiveRadarMod | null> {
  return loadCoreModule<CompanionCompetitiveRadarMod>('companion/competitive-radar.js');
}

async function loadImprovementCycle(): Promise<CompanionImprovementCycleMod | null> {
  return loadCoreModule<CompanionImprovementCycleMod>('companion/improvement-cycle.js');
}

async function loadImpulses(): Promise<CompanionImpulsesMod | null> {
  return loadCoreModule<CompanionImpulsesMod>('companion/impulses.js');
}

async function loadCheckIn(): Promise<CompanionCheckInMod | null> {
  return loadCoreModule<CompanionCheckInMod>('companion/check-in.js');
}

async function loadMissionBoard(): Promise<CompanionMissionBoardMod | null> {
  return loadCoreModule<CompanionMissionBoardMod>('companion/mission-board.js');
}

async function loadMissionRunner(): Promise<CompanionMissionRunnerMod | null> {
  return loadCoreModule<CompanionMissionRunnerMod>('companion/mission-runner.js');
}

async function loadSafetyLedger(): Promise<CompanionSafetyLedgerMod | null> {
  return loadCoreModule<CompanionSafetyLedgerMod>('companion/safety-ledger.js');
}

async function loadCards(): Promise<CompanionCardsMod | null> {
  return loadCoreModule<CompanionCardsMod>('companion/cards.js');
}

async function loadGateway(): Promise<CompanionGatewayMod | null> {
  return loadCoreModule<CompanionGatewayMod>('companion/gateway.js');
}

async function loadGatewayInbox(): Promise<CompanionGatewayInboxMod | null> {
  return loadCoreModule<CompanionGatewayInboxMod>('companion/gateway-inbox.js');
}

async function loadSkillCurator(): Promise<CompanionSkillCuratorMod | null> {
  return loadCoreModule<CompanionSkillCuratorMod>('companion/skill-curator.js');
}

async function loadPrivacy(): Promise<CompanionPrivacyMod | null> {
  return loadCoreModule<CompanionPrivacyMod>('companion/privacy.js');
}

export function registerCompanionIpcHandlers(projectManagerSource: ProjectManagerSource): void {
  ipcMain.handle(
    'companion.setup',
    async (
      _e,
      input?: {
        projectId?: string;
        forceIdentity?: boolean;
        configureVoice?: boolean;
        configureModel?: boolean;
        language?: string;
        sttProvider?: string;
        ttsProvider?: string;
        ttsVoice?: string;
        model?: string;
        recordSelf?: boolean;
      },
    ): Promise<{ ok: true; result: CompanionSetupResponse } | { ok: false; error?: string }> => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadMode();
        if (!mod?.setupCompanionMode) {
          return { ok: false as const, error: 'core companion setup module unavailable' };
        }
        const setup = await mod.setupCompanionMode({
          cwd,
          forceIdentity: input?.forceIdentity,
          configureVoice: input?.configureVoice,
          configureModel: input?.configureModel,
          language: input?.language,
          sttProvider: input?.sttProvider,
          ttsProvider: input?.ttsProvider,
          ttsVoice: input?.ttsVoice,
          model: input?.model,
        });
        const result: CompanionSetupResponse = { setup };
        if (input?.recordSelf !== false && mod.recordCompanionSelfState) {
          try {
            result.selfPercept = await mod.recordCompanionSelfState({ cwd });
          } catch (err) {
            result.selfPerceptError = errorMessage(err);
          }
        }
        return { ok: true as const, result };
      } catch (err) {
        logError('[companion.setup] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle('companion.status', async (_e, projectId?: string) => {
    const { cwd, error } = await companionWorkDir(projectManagerSource, projectId);
    if (!cwd) return { ok: false as const, error };
    try {
      const mod = await loadMode();
      if (!mod?.getCompanionStatus) return { ok: false as const, error: 'core companion module unavailable' };
      return { ok: true as const, status: await mod.getCompanionStatus({ cwd }) };
    } catch (err) {
      logError('[companion.status] failed:', err);
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle(
    'companion.percepts.recent',
    async (
      _e,
      input?: { limit?: number; modality?: CompanionPerceptModality; projectId?: string },
    ) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error, items: [] as CompanionPercept[] };
      try {
        const mod = await loadPercepts();
        if (!mod?.readRecentCompanionPercepts) {
          return { ok: false as const, error: 'core percept module unavailable', items: [] as CompanionPercept[] };
        }
        return {
          ok: true as const,
          items: await mod.readRecentCompanionPercepts({
            cwd,
            limit: input?.limit,
            modality: input?.modality,
          }),
        };
      } catch (err) {
        logError('[companion.percepts.recent] failed:', err);
        return { ok: false as const, error: errorMessage(err), items: [] as CompanionPercept[] };
      }
    },
  );

  ipcMain.handle('companion.percepts.stats', async (_e, projectId?: string) => {
    const { cwd, error } = await companionWorkDir(projectManagerSource, projectId);
    if (!cwd) return { ok: false as const, error };
    try {
      const mod = await loadPercepts();
      if (!mod?.getCompanionPerceptStats) {
        return { ok: false as const, error: 'core percept module unavailable' };
      }
      return { ok: true as const, stats: await mod.getCompanionPerceptStats({ cwd }) };
    } catch (err) {
      logError('[companion.percepts.stats] failed:', err);
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle('companion.self.record', async (_e, projectId?: string) => {
    const { cwd, error } = await companionWorkDir(projectManagerSource, projectId);
    if (!cwd) return { ok: false as const, error };
    try {
      const mod = await loadMode();
      if (!mod?.recordCompanionSelfState) {
        return { ok: false as const, error: 'core companion module unavailable' };
      }
      return { ok: true as const, percept: await mod.recordCompanionSelfState({ cwd }) };
    } catch (err) {
      logError('[companion.self.record] failed:', err);
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle(
    'companion.evaluate',
    async (_e, input?: { projectId?: string; recordSuggestions?: boolean }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadSelfEvaluation();
        if (!mod?.evaluateCompanionSelf) {
          return { ok: false as const, error: 'core self-evaluation module unavailable' };
        }
        return {
          ok: true as const,
          evaluation: await mod.evaluateCompanionSelf({
            cwd,
            recordSuggestions: input?.recordSuggestions !== false,
          }),
        };
      } catch (err) {
        logError('[companion.evaluate] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.radar',
    async (_e, input?: { projectId?: string; recordSuggestions?: boolean }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadCompetitiveRadar();
        if (!mod?.buildCompanionCompetitiveRadar) {
          return { ok: false as const, error: 'core competitive radar module unavailable' };
        }
        return {
          ok: true as const,
          radar: await mod.buildCompanionCompetitiveRadar({
            cwd,
            recordSuggestions: input?.recordSuggestions !== false,
          }),
        };
      } catch (err) {
        logError('[companion.radar] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.improve',
    async (_e, input?: {
      projectId?: string;
      dryRun?: boolean;
      recordSuggestions?: boolean;
      runMission?: boolean;
    }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadImprovementCycle();
        if (!mod?.runCompanionImprovementCycle) {
          return { ok: false as const, error: 'core improvement-cycle module unavailable' };
        }
        return {
          ok: true as const,
          cycle: await mod.runCompanionImprovementCycle({
            cwd,
            dryRun: Boolean(input?.dryRun),
            recordSuggestions: input?.recordSuggestions !== false,
            runMission: input?.runMission !== false,
          }),
        };
      } catch (err) {
        logError('[companion.improve] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.impulses',
    async (_e, input?: { projectId?: string; recordSuggestions?: boolean }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadImpulses();
        if (!mod?.buildCompanionImpulseBrief) {
          return { ok: false as const, error: 'core companion impulses module unavailable' };
        }
        return {
          ok: true as const,
          brief: await mod.buildCompanionImpulseBrief({
            cwd,
            recordSuggestions: input?.recordSuggestions !== false,
          }),
        };
      } catch (err) {
        logError('[companion.impulses] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.checkIn',
    async (_e, input?: {
      projectId?: string;
      userText?: string;
      recordPercept?: boolean;
      createCard?: boolean;
      recordSafety?: boolean;
    }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadCheckIn();
        if (!mod?.buildCompanionCheckIn) {
          return { ok: false as const, error: 'core companion check-in module unavailable' };
        }
        return {
          ok: true as const,
          cue: await mod.buildCompanionCheckIn({
            cwd,
            userText: input?.userText,
            recordPercept: input?.recordPercept,
            createCard: input?.createCard,
            recordSafety: input?.recordSafety,
          }),
        };
      } catch (err) {
        logError('[companion.checkIn] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.missions.sync',
    async (_e, input?: { projectId?: string; recordSuggestions?: boolean }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadMissionBoard();
        if (!mod?.syncCompanionMissionBoard) {
          return { ok: false as const, error: 'core mission board module unavailable' };
        }
        return {
          ok: true as const,
          result: await mod.syncCompanionMissionBoard({
            cwd,
            recordSuggestions: input?.recordSuggestions !== false,
          }),
        };
      } catch (err) {
        logError('[companion.missions.sync] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.missions.list',
    async (_e, input?: { projectId?: string; status?: CompanionMissionStatus }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error, items: [] as CompanionMission[] };
      try {
        const mod = await loadMissionBoard();
        if (!mod?.readCompanionMissionBoard) {
          return { ok: false as const, error: 'core mission board module unavailable', items: [] as CompanionMission[] };
        }
        const board = await mod.readCompanionMissionBoard({ cwd });
        return {
          ok: true as const,
          board,
          items: board.missions.filter(mission => !input?.status || mission.status === input.status),
        };
      } catch (err) {
        logError('[companion.missions.list] failed:', err);
        return { ok: false as const, error: errorMessage(err), items: [] as CompanionMission[] };
      }
    },
  );

  ipcMain.handle(
    'companion.missions.update',
    async (_e, input?: { projectId?: string; missionId?: string; status?: CompanionMissionStatus }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      if (!input?.missionId || !input.status) {
        return { ok: false as const, error: 'missionId and status are required' };
      }
      try {
        const mod = await loadMissionBoard();
        if (!mod?.updateCompanionMissionStatus) {
          return { ok: false as const, error: 'core mission board module unavailable' };
        }
        return {
          ok: true as const,
          mission: await mod.updateCompanionMissionStatus(input.missionId, input.status, { cwd }),
        };
      } catch (err) {
        logError('[companion.missions.update] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.missions.runNext',
    async (_e, input?: { projectId?: string; dryRun?: boolean }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadMissionRunner();
        if (!mod?.runNextCompanionMission) {
          return { ok: false as const, error: 'core mission runner module unavailable' };
        }
        return {
          ok: true as const,
          result: await mod.runNextCompanionMission({
            cwd,
            dryRun: Boolean(input?.dryRun),
          }),
        };
      } catch (err) {
        logError('[companion.missions.runNext] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.safety.recent',
    async (
      _e,
      input?: {
        projectId?: string;
        limit?: number;
        kind?: CompanionSafetyEventKind;
        risk?: CompanionSafetyEventRisk;
      },
    ) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error, items: [] as CompanionSafetyEvent[] };
      try {
        const mod = await loadSafetyLedger();
        if (!mod?.readRecentCompanionSafetyEvents) {
          return { ok: false as const, error: 'core safety ledger module unavailable', items: [] as CompanionSafetyEvent[] };
        }
        return {
          ok: true as const,
          items: await mod.readRecentCompanionSafetyEvents({
            cwd,
            limit: input?.limit,
            kind: input?.kind,
            risk: input?.risk,
          }),
        };
      } catch (err) {
        logError('[companion.safety.recent] failed:', err);
        return { ok: false as const, error: errorMessage(err), items: [] as CompanionSafetyEvent[] };
      }
    },
  );

  ipcMain.handle('companion.safety.stats', async (_e, projectId?: string) => {
    const { cwd, error } = await companionWorkDir(projectManagerSource, projectId);
    if (!cwd) return { ok: false as const, error };
    try {
      const mod = await loadSafetyLedger();
      if (!mod?.getCompanionSafetyLedgerStats) {
        return { ok: false as const, error: 'core safety ledger module unavailable' };
      }
      return { ok: true as const, stats: await mod.getCompanionSafetyLedgerStats({ cwd }) };
    } catch (err) {
      logError('[companion.safety.stats] failed:', err);
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle(
    'companion.cards.list',
    async (
      _e,
      input?: {
        projectId?: string;
        status?: CompanionCardStatus;
        kind?: CompanionCardKind;
        limit?: number;
      },
    ) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error, items: [] as CompanionCard[] };
      try {
        const mod = await loadCards();
        if (!mod?.readCompanionCards) {
          return { ok: false as const, error: 'core companion cards module unavailable', items: [] as CompanionCard[] };
        }
        const store = await mod.readCompanionCards({
          cwd,
          status: input?.status,
          kind: input?.kind,
          limit: input?.limit,
        });
        return { ok: true as const, store, items: store.cards };
      } catch (err) {
        logError('[companion.cards.list] failed:', err);
        return { ok: false as const, error: errorMessage(err), items: [] as CompanionCard[] };
      }
    },
  );

  ipcMain.handle(
    'companion.cards.update',
    async (_e, input?: { projectId?: string; cardId?: string; status?: CompanionCardStatus }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      if (!input?.cardId || !input.status) {
        return { ok: false as const, error: 'cardId and status are required' };
      }
      try {
        const mod = await loadCards();
        if (!mod?.updateCompanionCardStatus) {
          return { ok: false as const, error: 'core companion cards module unavailable' };
        }
        return {
          ok: true as const,
          card: await mod.updateCompanionCardStatus(input.cardId, input.status, { cwd }),
        };
      } catch (err) {
        logError('[companion.cards.update] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle('companion.gateway.profile', async (_e, projectId?: string) => {
    const { cwd, error } = await companionWorkDir(projectManagerSource, projectId);
    if (!cwd) return { ok: false as const, error };
    try {
      const mod = await loadGateway();
      if (!mod?.readCompanionGatewayProfile) {
        return { ok: false as const, error: 'core companion gateway module unavailable' };
      }
      return { ok: true as const, profile: await mod.readCompanionGatewayProfile({ cwd }) };
    } catch (err) {
      logError('[companion.gateway.profile] failed:', err);
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle('companion.gateway.inbox', async (_e, projectId?: string) => {
    const { cwd, error } = await companionWorkDir(projectManagerSource, projectId);
    if (!cwd) return { ok: false as const, error };
    try {
      const mod = await loadGatewayInbox();
      if (!mod?.readCompanionGatewayInbox) {
        return { ok: false as const, error: 'core companion gateway inbox module unavailable' };
      }
      return { ok: true as const, inbox: await mod.readCompanionGatewayInbox({ cwd }) };
    } catch (err) {
      logError('[companion.gateway.inbox] failed:', err);
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle(
    'companion.gateway.draft',
    async (_e, input?: { projectId?: string; itemId?: string }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      if (!input?.itemId) return { ok: false as const, error: 'itemId is required' };
      try {
        const mod = await loadGatewayInbox();
        if (!mod?.draftCompanionGatewayInboxItem || !mod.readCompanionGatewayInbox) {
          return { ok: false as const, error: 'core companion gateway inbox module unavailable' };
        }
        const draft = await mod.draftCompanionGatewayInboxItem(input.itemId, { cwd });
        return {
          ok: true as const,
          draft,
          inbox: await mod.readCompanionGatewayInbox({ cwd }),
        };
      } catch (err) {
        logError('[companion.gateway.draft] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.gateway.update',
    async (
      _e,
      input?: {
        projectId?: string;
        channel?: string;
        enabled?: boolean;
        mode?: CompanionGatewayMode;
        allowOutbound?: boolean;
        requireApprovalForTools?: boolean;
        recordPercepts?: boolean;
        tags?: string[];
      },
    ) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      if (!input?.channel) return { ok: false as const, error: 'channel is required' };
      try {
        const mod = await loadGateway();
        if (!mod?.updateCompanionGatewayChannel) {
          return { ok: false as const, error: 'core companion gateway module unavailable' };
        }
        return {
          ok: true as const,
          profile: await mod.updateCompanionGatewayChannel(input.channel, {
            cwd,
            enabled: input.enabled,
            mode: input.mode,
            allowOutbound: input.allowOutbound,
            requireApprovalForTools: input.requireApprovalForTools,
            recordPercepts: input.recordPercepts,
            tags: input.tags,
          }),
        };
      } catch (err) {
        logError('[companion.gateway.update] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle('companion.skills.list', async (_e, projectId?: string) => {
    const { cwd, error } = await companionWorkDir(projectManagerSource, projectId);
    if (!cwd) return { ok: false as const, error, items: [] as CompanionSkillCandidate[] };
    try {
      const mod = await loadSkillCurator();
      if (!mod?.readCompanionSkillCandidates) {
        return { ok: false as const, error: 'core companion skill curator module unavailable', items: [] as CompanionSkillCandidate[] };
      }
      const store = await mod.readCompanionSkillCandidates({ cwd });
      return { ok: true as const, store, items: store.candidates };
    } catch (err) {
      logError('[companion.skills.list] failed:', err);
      return { ok: false as const, error: errorMessage(err), items: [] as CompanionSkillCandidate[] };
    }
  });

  ipcMain.handle(
    'companion.skills.curate',
    async (_e, input?: { projectId?: string; recordSuggestions?: boolean }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadSkillCurator();
        if (!mod?.curateCompanionSkills) {
          return { ok: false as const, error: 'core companion skill curator module unavailable' };
        }
        return {
          ok: true as const,
          result: await mod.curateCompanionSkills({
            cwd,
            recordSuggestions: input?.recordSuggestions !== false,
          }),
        };
      } catch (err) {
        logError('[companion.skills.curate] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.skills.promote',
    async (_e, input?: { projectId?: string; candidateId?: string }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      if (!input?.candidateId) return { ok: false as const, error: 'candidateId is required' };
      try {
        const mod = await loadSkillCurator();
        if (!mod?.promoteCompanionSkillCandidate) {
          return { ok: false as const, error: 'core companion skill curator module unavailable' };
        }
        return {
          ok: true as const,
          result: await mod.promoteCompanionSkillCandidate(input.candidateId, { cwd }),
        };
      } catch (err) {
        logError('[companion.skills.promote] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.skills.dismiss',
    async (_e, input?: { projectId?: string; candidateId?: string }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      if (!input?.candidateId) return { ok: false as const, error: 'candidateId is required' };
      try {
        const mod = await loadSkillCurator();
        if (!mod?.dismissCompanionSkillCandidate) {
          return { ok: false as const, error: 'core companion skill curator module unavailable' };
        }
        return {
          ok: true as const,
          candidate: await mod.dismissCompanionSkillCandidate(input.candidateId, { cwd }),
        };
      } catch (err) {
        logError('[companion.skills.dismiss] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle('companion.privacy.report', async (_e, projectId?: string) => {
    const { cwd, error } = await companionWorkDir(projectManagerSource, projectId);
    if (!cwd) return { ok: false as const, error };
    try {
      const mod = await loadPrivacy();
      if (!mod?.buildCompanionPrivacyReport) {
        return { ok: false as const, error: 'core companion privacy module unavailable' };
      }
      return { ok: true as const, report: await mod.buildCompanionPrivacyReport({ cwd }) };
    } catch (err) {
      logError('[companion.privacy.report] failed:', err);
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle(
    'companion.privacy.export',
    async (_e, input?: { projectId?: string; kinds?: CompanionPrivacyKind[] }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadPrivacy();
        if (!mod?.exportCompanionPrivacyBundle) {
          return { ok: false as const, error: 'core companion privacy module unavailable' };
        }
        return {
          ok: true as const,
          result: await mod.exportCompanionPrivacyBundle({
            cwd,
            kinds: input?.kinds,
          }),
        };
      } catch (err) {
        logError('[companion.privacy.export] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.privacy.purge',
    async (_e, input?: { projectId?: string; kinds?: CompanionPrivacyKind[]; backup?: boolean }) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadPrivacy();
        if (!mod?.purgeCompanionPrivacyData) {
          return { ok: false as const, error: 'core companion privacy module unavailable' };
        }
        return {
          ok: true as const,
          result: await mod.purgeCompanionPrivacyData({
            cwd,
            kinds: input?.kinds,
            backup: input?.backup !== false,
          }),
        };
      } catch (err) {
        logError('[companion.privacy.purge] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle('companion.camera.status', async () => {
    try {
      const mod = await loadCamera();
      if (!mod?.checkCameraAvailability) {
        return { ok: false as const, error: 'core camera module unavailable' };
      }
      return { ok: true as const, status: await mod.checkCameraAvailability() };
    } catch (err) {
      logError('[companion.camera.status] failed:', err);
      return { ok: false as const, error: errorMessage(err) };
    }
  });

  ipcMain.handle(
    'companion.camera.rendererSnapshot',
    async (
      _e,
      input?: {
        dataUrl?: string;
        base64?: string;
        mediaType?: string;
        width?: number;
        height?: number;
        mediaPipe?: unknown;
        outputPath?: string;
        projectId?: string;
      },
    ) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadCamera();
        if (!mod?.importCameraSnapshot) {
          return { ok: false as const, error: 'core camera import module unavailable' };
        }
        const result = await mod.importCameraSnapshot({
          cwd,
          dataUrl: input?.dataUrl,
          base64: input?.base64,
          mediaType: input?.mediaType,
          width: input?.width,
          height: input?.height,
          mediaPipe: input?.mediaPipe,
          outputPath: input?.outputPath,
        });
        if (!result.success) {
          return { ok: false as const, error: result.error ?? 'camera snapshot import failed', result };
        }
        return { ok: true as const, result };
      } catch (err) {
        logError('[companion.camera.rendererSnapshot] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.camera.snapshot',
    async (
      _e,
      input?: { outputPath?: string; device?: string; timeoutMs?: number; projectId?: string },
    ) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadCamera();
        if (!mod?.captureCameraSnapshot) {
          return { ok: false as const, error: 'core camera module unavailable' };
        }
        const result = await mod.captureCameraSnapshot({
          cwd,
          outputPath: input?.outputPath,
          device: input?.device,
          timeoutMs: input?.timeoutMs,
        });
        if (!result.success) {
          return { ok: false as const, error: result.error ?? 'camera snapshot failed', result };
        }
        return { ok: true as const, result };
      } catch (err) {
        logError('[companion.camera.snapshot] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );

  ipcMain.handle(
    'companion.camera.inspect',
    async (
      _e,
      input?: {
        imagePath?: string;
        outputPath?: string;
        device?: string;
        timeoutMs?: number;
        projectId?: string;
        includeOcr?: boolean;
        ocrLanguage?: string;
      },
    ) => {
      const { cwd, error } = await companionWorkDir(projectManagerSource, input?.projectId);
      if (!cwd) return { ok: false as const, error };
      try {
        const mod = await loadCamera();
        if (!mod?.inspectCameraSnapshot) {
          return { ok: false as const, error: 'core camera inspection module unavailable' };
        }
        const result = await mod.inspectCameraSnapshot({
          cwd,
          imagePath: input?.imagePath,
          outputPath: input?.outputPath,
          device: input?.device,
          timeoutMs: input?.timeoutMs,
          includeOcr: input?.includeOcr,
          ocrLanguage: input?.ocrLanguage,
        });
        if (!result.success) {
          return { ok: false as const, error: result.error ?? 'camera inspection failed', result };
        }
        return { ok: true as const, result };
      } catch (err) {
        logError('[companion.camera.inspect] failed:', err);
        return { ok: false as const, error: errorMessage(err) };
      }
    },
  );
}
