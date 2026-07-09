// Session types
export interface Session {
  id: string;
  title: string;
  claudeSessionId?: string;
  openaiThreadId?: string;
  status: SessionStatus;
  cwd?: string;
  mountedPaths: MountedPath[];
  allowedTools: string[];
  memoryEnabled: boolean;
  model?: string;
  projectId?: string | null;
  isBackground?: boolean;
  executionMode?: ExecutionMode;
  pinned?: boolean;
  archived?: boolean;
  tags?: string[];
  source?: 'cowork' | 'cli-import' | 'remote' | string;
  createdAt: number;
  updatedAt: number;
}

export type SessionStatus = 'idle' | 'running' | 'completed' | 'error';

export type ExecutionMode = 'chat' | 'task' | 'ask' | 'architect';

// Project types (Claude Cowork parity)
export interface Project {
  id: string;
  name: string;
  description?: string;
  workspacePath?: string;
  memoryConfig?: ProjectMemoryConfig;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectMemoryConfig {
  autoConsolidate?: boolean;
  maxMemoryEntries?: number;
  includeICM?: boolean;
  memoryStrategy?: 'auto' | 'manual' | 'rolling';
}

export interface ProjectCreateInput {
  name: string;
  description?: string;
  workspacePath?: string;
  memoryConfig?: ProjectMemoryConfig;
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string;
  workspacePath?: string;
  memoryConfig?: ProjectMemoryConfig;
}

// Sub-agent types (Claude Cowork parity)
export type SubAgentStatus = 'running' | 'waiting' | 'completed' | 'error' | 'closed';
export type SubAgentRole = 'default' | 'explorer' | 'worker' | 'coder' | 'reviewer' | 'tester' | 'researcher' | 'debugger' | 'architect' | 'documenter' | string;

export interface SubAgent {
  id: string;
  nickname: string;
  role: SubAgentRole;
  status: SubAgentStatus;
  depth: number;
  parentId: string | null;
  createdAt: number;
  result?: string;
  sessionId?: string;
  progress?: number;
  currentStep?: string;
}

// Notification types (Claude Cowork parity)
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface NotificationEntry {
  id: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  timestamp: number;
  read: boolean;
  sessionId?: string;
  projectId?: string;
  actionLabel?: string;
}

export type CompanionPerceptModality =
  | 'vision'
  | 'hearing'
  | 'screen'
  | 'self'
  | 'memory'
  | 'tool'
  | 'suggestion';

export interface CompanionPercept {
  id: string;
  modality: CompanionPerceptModality;
  source: string;
  timestamp: string;
  confidence: number;
  summary: string;
  payload: Record<string, unknown>;
  tags: string[];
}

export interface CompanionPerceptStats {
  storePath: string;
  exists: boolean;
  total: number;
  byModality: Partial<Record<CompanionPerceptModality, number>>;
  latestTimestamp?: string;
}

export interface CompanionStatus {
  cwd: string;
  authPath: string;
  chatGptCredentialsPresent: boolean;
  model: string;
  identity: {
    soulLoaded: boolean;
    soulSource?: string;
    soulIsCompanion: boolean;
    bootLoaded: boolean;
    bootSource?: string;
    bootIsCompanion: boolean;
  };
  voice: {
    enabled: boolean;
    available: boolean;
    reason?: string;
    provider: string;
    language?: string;
    autoSend?: boolean;
  };
  wakeWord: {
    available: boolean;
    engine: 'porcupine' | 'text-match';
    wakeWords: string[];
    picovoiceAccessKeyPresent: boolean;
  };
  tts: {
    enabled: boolean;
    available: boolean;
    reason?: string;
    provider: string;
    voice?: string;
    autoSpeak?: boolean;
  };
  camera: {
    available: boolean;
    ffmpegAvailable: boolean;
    platform: string;
    commandPreview?: string;
    reason?: string;
  };
  percepts: CompanionPerceptStats;
}

export type CompanionEvaluationSeverity = 'info' | 'warning' | 'action';
export type CompanionEvaluationLevel = 'dormant' | 'awakening' | 'aware' | 'collaborative';

export interface CompanionSelfEvaluationFinding {
  id: string;
  area: string;
  severity: CompanionEvaluationSeverity;
  summary: string;
  recommendation: string;
  command?: string;
  tags: string[];
}

export interface CompanionSelfEvaluation {
  id: string;
  timestamp: string;
  cwd: string;
  score: number;
  level: CompanionEvaluationLevel;
  findings: CompanionSelfEvaluationFinding[];
  strengths: string[];
  nextActions: string[];
  perceptStats: CompanionPerceptStats;
}

export type CompanionRadarSeverity = 'lead' | 'parity' | 'gap';

export interface CompanionCompetitiveGap {
  id: string;
  dimension: string;
  severity: CompanionRadarSeverity;
  summary: string;
  recommendation: string;
  competitorRefs: string[];
  command?: string;
  tags: string[];
}

export interface CompanionCompetitiveRadar {
  id: string;
  timestamp: string;
  cwd: string;
  score: number;
  currentStrengths: string[];
  gaps: CompanionCompetitiveGap[];
  nextMoves: string[];
  sourceNotes: string[];
}

export type CompanionImpulseKind = 'readiness' | 'sense' | 'mission' | 'safety' | 'memory' | 'conversation';
export type CompanionImpulsePriority = 'high' | 'medium' | 'low';

export interface CompanionImpulse {
  id: string;
  kind: CompanionImpulseKind;
  priority: CompanionImpulsePriority;
  title: string;
  message: string;
  command?: string;
  evidence: Array<{ label: string; value: string }>;
  tags: string[];
}

export interface CompanionImpulseBrief {
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

export type CompanionCheckInMood = 'steady' | 'encouraging' | 'urgent' | 'curious';

export interface CompanionCheckInEvidence {
  label: string;
  value: string;
}

export interface CompanionCheckInCue {
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

export type CompanionMissionStatus = 'open' | 'in_progress' | 'done' | 'dismissed';
export type CompanionMissionPriority = 'P0' | 'P1' | 'P2';

export interface CompanionMission {
  id: string;
  title: string;
  dimension: string;
  status: CompanionMissionStatus;
  priority: CompanionMissionPriority;
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

export interface CompanionMissionBoard {
  schemaVersion: 1;
  cwd: string;
  storePath: string;
  updatedAt: string;
  missions: CompanionMission[];
}

export interface CompanionMissionBoardSyncResult {
  board: CompanionMissionBoard;
  radarId: string;
  created: number;
  updated: number;
  unchanged: number;
}

export interface CompanionMissionRunResult {
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

export interface CompanionImprovementCycle {
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

export type CompanionSafetyEventKind = 'sense' | 'tool' | 'mission' | 'permission' | 'data';
export type CompanionSafetyEventRisk = 'low' | 'medium' | 'high';
export type CompanionSafetyEventStatus = 'planned' | 'allowed' | 'completed' | 'failed' | 'denied';

export interface CompanionSafetyEvent {
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

export interface CompanionSafetyLedgerStats {
  ledgerPath: string;
  exists: boolean;
  total: number;
  byKind: Partial<Record<CompanionSafetyEventKind, number>>;
  byRisk: Partial<Record<CompanionSafetyEventRisk, number>>;
  byStatus: Partial<Record<CompanionSafetyEventStatus, number>>;
  latestTimestamp?: string;
}

export interface CameraSnapshotResult {
  success: boolean;
  path?: string;
  output?: string;
  error?: string;
  command?: string;
  perceptId?: string;
  perceptPath?: string;
}

export interface CameraSnapshotInspectionResult {
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

export type DesktopSnapshotMethod = 'accessibility' | 'ocr' | 'hybrid';

export interface DesktopSnapshotElement {
  ref: number;
  role: string;
  name: string;
  description?: string;
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  interactive: boolean;
  focused: boolean;
  enabled: boolean;
  visible: boolean;
  value?: string;
  placeholder?: string;
  automationId?: string;
  runtimeId?: string;
  controlType?: string;
  className?: string;
  attributes?: Record<string, unknown>;
}

export interface DesktopSnapshot {
  id: string;
  timestamp: string;
  source: string;
  screenSize: { width: number; height: number };
  valid: boolean;
  ttl: number;
  elements: DesktopSnapshotElement[];
}

export interface DesktopSnapshotAnnotatedImage {
  dataUrl: string;
  format: 'png' | 'jpeg';
  width: number;
  height: number;
}

export interface DesktopSnapshotCaptureOptions {
  method?: DesktopSnapshotMethod;
  interactiveOnly?: boolean;
  includeAnnotatedImage?: boolean;
  cropAnnotatedImage?: boolean;
  ttlMs?: number;
  window?: string;
}

export interface DesktopSnapshotCaptureResult {
  ok: boolean;
  method?: DesktopSnapshotMethod;
  snapshot?: DesktopSnapshot;
  text?: string;
  annotatedImage?: DesktopSnapshotAnnotatedImage | null;
  error?: string;
}

export interface CompanionSetupResult {
  cwd: string;
  wroteSoul: boolean;
  wroteBoot: boolean;
  skippedSoul: boolean;
  skippedBoot: boolean;
  voiceConfigured: boolean;
  modelConfigured: boolean;
  model?: string;
  status: CompanionStatus;
}

export interface CompanionSetupResponse {
  setup: CompanionSetupResult;
  selfPercept?: CompanionPercept;
  selfPerceptError?: string;
}

export type VoiceConversationPhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'error';

export type VoiceConversationEventType =
  | 'listening_started'
  | 'listening_stopped'
  | 'transcription_started'
  | 'transcription_completed'
  | 'transcription_failed'
  | 'user_message_sent'
  | 'assistant_speech_started'
  | 'assistant_speech_finished'
  | 'assistant_interrupted'
  | 'reset';

export interface VoiceConversationEvent {
  type: VoiceConversationEventType;
  timestamp?: number;
  transcript?: string;
  error?: string;
  reason?: string;
  hadPlayback?: boolean;
}

export interface VoiceConversationSnapshot {
  phase: VoiceConversationPhase;
  startedAt: number;
  updatedAt: number;
  lastEventType?: VoiceConversationEventType;
  turnId: number;
  interruptionCount: number;
  lastTranscriptPreview?: string;
  lastError?: string;
  lastInterruptionReason?: string;
  lastInterruptionAt?: number;
  interruptedTurnId?: number;
  pendingInterruption?: boolean;
  resumedAfterInterruption?: boolean;
  resumeInstruction?: string;
  hadPlaybackDuringLastInterruption?: boolean;
}

export type CompanionCardKind =
  | 'status'
  | 'approval'
  | 'camera'
  | 'checklist'
  | 'mission'
  | 'timer'
  | 'weather'
  | 'tool';
export type CompanionCardPriority = 'low' | 'medium' | 'high';
export type CompanionCardStatus = 'open' | 'resolved' | 'dismissed';

export interface CompanionCardAction {
  id: string;
  label: string;
  command?: string;
  style?: 'primary' | 'secondary' | 'danger';
}

export interface CompanionCard {
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

export interface CompanionCardStore {
  schemaVersion: 1;
  cwd: string;
  storePath: string;
  updatedAt: string;
  cards: CompanionCard[];
}

export type CompanionGatewayMode = 'observe' | 'assist' | 'act';

export interface CompanionGatewayChannelConfig {
  channel: string;
  enabled: boolean;
  mode: CompanionGatewayMode;
  allowOutbound: boolean;
  requireApprovalForTools: boolean;
  recordPercepts: boolean;
  tags: string[];
}

export interface CompanionGatewayProfile {
  schemaVersion: 1;
  cwd: string;
  storePath: string;
  updatedAt: string;
  defaultMode: CompanionGatewayMode;
  channels: CompanionGatewayChannelConfig[];
}

export type CompanionGatewayLifecycleState = 'disabled' | 'observe' | 'ready' | 'needs_attention';

export interface CompanionGatewayLifecycleChannel {
  channel: string;
  state: CompanionGatewayLifecycleState;
  enabled: boolean;
  mode: CompanionGatewayMode;
  allowOutbound: boolean;
  requireApprovalForTools: boolean;
  recordPercepts: boolean;
  queueCount: number;
  ignoredCount: number;
  draftCount: number;
  fleetDraftCount: number;
  replyDraftCount: number;
  lastSendStatus?: 'preview' | 'sent' | 'failed' | 'blocked';
  issues: string[];
}

export interface CompanionGatewayLifecycleReport {
  kind: 'companion_gateway_lifecycle';
  schemaVersion: 1;
  generatedAt: string;
  cwd: string;
  profilePath: string;
  inboxPath: string;
  outboxPath: string;
  summary: {
    channelCount: number;
    enabledCount: number;
    actModeCount: number;
    queuedCount: number;
    ignoredCount: number;
    draftCount: number;
    fleetDraftCount: number;
    replyDraftCount: number;
    outboundSendCount: number;
    failedSendCount: number;
    blockedSendCount: number;
    readyChannelCount: number;
    attentionChannelCount: number;
  };
  safety: {
    autoDispatch: false;
    rawTextStored: false;
    localApprovalRequired: true;
    sendPolicyRequired: true;
  };
  channels: CompanionGatewayLifecycleChannel[];
  recommendations: string[];
}

export type CompanionGatewayAdminActionType =
  | 'enable'
  | 'disable'
  | 'start'
  | 'stop'
  | 'reconnect'
  | 'review_queue'
  | 'prepare_draft'
  | 'launch_fleet'
  | 'draft_reply'
  | 'send_reply'
  | 'inspect_outbox'
  | 'replay_preview';

export interface CompanionGatewayAdminAction {
  id: string;
  channel: string;
  action: CompanionGatewayAdminActionType;
  label: string;
  reason: string;
  command?: string[];
  requiresLocalApproval: boolean;
  destructive: boolean;
  available: boolean;
}

export interface CompanionGatewayReplayPreview {
  id: string;
  channel: string;
  status: 'preview' | 'sent' | 'failed' | 'blocked';
  dryRun: boolean;
  createdAt: string;
  approved: boolean;
  hasError: boolean;
}

export interface CompanionGatewayAdminPlan {
  kind: 'companion_gateway_admin_plan';
  schemaVersion: 1;
  generatedAt: string;
  cwd: string;
  profilePath: string;
  inboxPath: string;
  outboxPath: string;
  safety: {
    dryRun: true;
    requiresLocalApproval: true;
    secretsIncluded: false;
    rawMessageContentIncluded: false;
    executesChannelAdmin: false;
  };
  summary: {
    actionCount: number;
    channelCount: number;
    enabledCount: number;
    attentionChannelCount: number;
    replayablePreviewCount: number;
    failedSendCount: number;
    blockedSendCount: number;
  };
  actions: CompanionGatewayAdminAction[];
  deliveryDiagnostics: {
    outboxPath: string;
    counts: Record<'preview' | 'sent' | 'failed' | 'blocked', number>;
    replayablePreviews: CompanionGatewayReplayPreview[];
  };
  recommendations: string[];
}

export type CompanionGatewayExecutableAdminAction = 'enable' | 'disable' | 'start' | 'stop' | 'reconnect';

export interface CompanionGatewayAdminExecutionRecord {
  id: string;
  kind: 'companion_gateway_admin_execution';
  schemaVersion: 1;
  createdAt: string;
  cwd: string;
  channel: string;
  action: CompanionGatewayExecutableAdminAction;
  approvedBy: string;
  liveAdminConfirmed: boolean;
  status: 'completed' | 'failed' | 'blocked';
  planActionId?: string;
  result: {
    registered?: string[];
    skipped?: string[];
    stopped?: boolean;
    enabled?: boolean;
    runtimeBefore?: {
      registered: boolean;
      connected?: boolean;
      authenticated?: boolean;
      error?: string;
    };
    runtimeAfter?: {
      registered: boolean;
      connected?: boolean;
      authenticated?: boolean;
      error?: string;
    };
    failed?: Array<{ type: string; error: string }>;
    error?: string;
  };
}

export interface CompanionGatewayAdminExecutionResult {
  kind: 'companion_gateway_admin_execution_result';
  ok: boolean;
  adminLogPath: string;
  record: CompanionGatewayAdminExecutionRecord;
  profile?: CompanionGatewayProfile;
  plan?: CompanionGatewayAdminPlan;
  error?: string;
}

export type CompanionGatewayInboxPriority = 'low' | 'normal' | 'high' | 'urgent';

export type CompanionGatewayInboxActionType =
  | 'observe'
  | 'draft_reply'
  | 'prepare_task'
  | 'request_local_approval';

export interface CompanionGatewayInboxItem {
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
}

export interface CompanionGatewayAutonomousCodeTask {
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
}

export interface CompanionGatewayInboxDraftSummary {
  id: string;
  createdAt: string;
  kind: 'autonomous_code_task';
  taskFile: string;
  command: string[];
  autoDispatch: false;
  requiresLocalApproval: true;
  fleet?: CompanionGatewayFleetDraftSummary;
}

export interface CompanionGatewayFleetDispatchDraftInput {
  goal: string;
  parallelism: 1;
  privacyTag: 'sensitive';
  dispatchProfile: 'safe';
  deliveryChannel: string;
  sourceSessionId: string;
}

export interface CompanionGatewayFleetDraftSummary {
  id: string;
  createdAt: string;
  kind: 'fleet_dispatch_draft';
  draftFile: string;
  dispatchInput: CompanionGatewayFleetDispatchDraftInput;
  autoDispatch: false;
  requiresLocalApproval: true;
  outboundReply?: CompanionGatewayOutboundReplyDraftSummary;
}

export interface CompanionGatewayOutboundReplyDraftSummary {
  id: string;
  createdAt: string;
  kind: 'outbound_reply_draft';
  draftFile: string;
  channel: string;
  channelId: string;
  threadId: string;
  replyTo?: string;
  contentPreview: string;
  reviewedBy: string;
  autoDispatch: false;
  requiresLocalApproval: true;
  readyToSend: false;
  lastSend?: CompanionGatewayOutboundReplySendSummary;
}

export interface CompanionGatewayOutboundReplyDraft extends CompanionGatewayOutboundReplyDraftSummary {
  schemaVersion: 1;
  sourceItemId: string;
  sourceDraftId: string;
  sourceFleetDraftId: string;
  sendPreview: {
    channel: string;
    channelId: string;
    threadId: string;
    replyTo?: string;
    contentPreview: string;
    sessionKey: string;
    dryRun: true;
  };
  safety: {
    rawTextStored: false;
    previewOnly: true;
    autoDispatch: false;
    requiresLocalApproval: true;
    readyToSend: false;
    outboundChannelReply: false;
  };
}

export interface CompanionGatewayOutboundReplySendSummary {
  id: string;
  createdAt: string;
  kind: 'outbound_reply_send';
  outboxPath: string;
  status: 'preview' | 'sent' | 'failed' | 'blocked';
  dryRun: boolean;
  approvedBy: string;
  autoDispatch: false;
  requiresLocalApproval: true;
  policyAllowed?: boolean;
  deliverySuccess?: boolean;
  error?: string;
}

export interface CompanionGatewayOutboundReplySendResult {
  kind: 'companion_gateway_outbound_reply_send_result';
  sourceItemId: string;
  sourceReplyDraftId: string;
  approvedBy: string;
  dryRun: boolean;
  send: {
    ok: boolean;
    status: 'preview' | 'sent' | 'failed' | 'blocked';
    dryRun: boolean;
    outboxPath: string;
    error?: string;
    entry: {
      id: string;
      channel: string;
      channelId: string;
      status: 'preview' | 'sent' | 'failed' | 'blocked';
      dryRun: boolean;
      approvedBy?: string;
      content: string;
      error?: string;
    };
  };
}

export interface CompanionGatewayFleetDraft extends CompanionGatewayFleetDraftSummary {
  schemaVersion: 1;
  sourceItemId: string;
  sourceDraftId: string;
  safety: {
    rawTextStored: false;
    previewOnly: true;
    autoDispatch: false;
    requiresLocalApproval: true;
    outboundChannelReply: false;
  };
}

export interface CompanionGatewayInboxDraft extends CompanionGatewayInboxDraftSummary {
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
}

export interface CompanionGatewayInbox {
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
}

export interface OpenClawBridgeStatusResult {
  ok: boolean;
  discovery?: Record<string, unknown>;
  descriptor?: Record<string, unknown>;
  error?: string;
}

export interface OpenClawBridgeActionResult {
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

export type CompanionSkillCandidateStatus = 'draft' | 'reviewed' | 'promoted' | 'dismissed';

export interface CompanionSkillEvidence {
  kind: 'mission' | 'percept';
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
}

export interface CompanionSkillCandidateStore {
  schemaVersion: 1;
  cwd: string;
  storePath: string;
  updatedAt: string;
  candidates: CompanionSkillCandidate[];
}

export interface CompanionSkillCuratorResult {
  store: CompanionSkillCandidateStore;
  created: number;
  updated: number;
  unchanged: number;
  pruned: number;
  perceptId?: string;
}

export interface CompanionSkillPromotionResult {
  candidate: CompanionSkillCandidate;
  artifactPath: string;
  perceptId?: string;
  safetyEventId?: string;
}

export type CompanionPrivacyKind =
  | 'percepts'
  | 'safety'
  | 'cards'
  | 'gateway'
  | 'skills'
  | 'camera';

export interface CompanionPrivacyStoreSummary {
  kind: CompanionPrivacyKind;
  path: string;
  exists: boolean;
  bytes: number;
  entries: number;
}

export interface CompanionPrivacyReport {
  schemaVersion: 1;
  cwd: string;
  generatedAt: string;
  stores: CompanionPrivacyStoreSummary[];
  totalBytes: number;
  totalEntries: number;
}

export interface CompanionPrivacyExportResult {
  exportDir: string;
  manifestPath: string;
  report: CompanionPrivacyReport;
  copied: Array<{ kind: CompanionPrivacyKind; from: string; to: string }>;
}

export interface CompanionPrivacyPurgeResult {
  purgedAt: string;
  cwd: string;
  kinds: CompanionPrivacyKind[];
  removed: Array<{ kind: CompanionPrivacyKind; path: string; existed: boolean }>;
  backup?: CompanionPrivacyExportResult;
}

export interface MountedPath {
  virtual: string;
  real: string;
}

// Message types
export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: ContentBlock[];
  timestamp: number;
  tokenUsage?: TokenUsage;
  localStatus?: 'queued' | 'cancelled';
  metadata?: MessageMetadata;
  executionTimeMs?: number;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface MessageMetadata {
  turn?: {
    id: string;
    role: MessageRole;
  };
  pendingIntent?: {
    kind: 'steer';
    status: 'delivered' | 'queued_fallback';
    sourceIntentId?: string;
  };
  recovery?: {
    kind: 'turn_interrupted' | 'user_turn_recovered';
    source: 'turn_journal';
    turnId: string;
    status: 'marker' | 'message';
    reason?: string;
  };
}

export interface QueuedIntent {
  id: string;
  sessionId: string;
  prompt: string;
  content: ContentBlock[];
  createdAt: number;
  updatedAt?: number;
  source?: 'queue' | 'leftover_steer';
}

export type ContentBlock =
  | TextContent
  | ImageContent
  | FileAttachmentContent
  | ToolUseContent
  | ToolResultContent
  | ThinkingContent;

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export interface FileAttachmentContent {
  type: 'file_attachment';
  filename: string;
  relativePath: string; // Path relative to session's .tmp folder
  size: number;
  mimeType?: string;
  inlineDataBase64?: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
  data?: unknown;
  images?: Array<{
    data: string;          // base64 encoded image data
    mimeType: string;      // e.g., 'image/png'
  }>;
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
}

export interface TokenUsage {
  input: number;
  output: number;
}

// Trace types for visualization
export interface TraceStep {
  id: string;
  type: TraceStepType;
  status: TraceStepStatus;
  title: string;
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  /**
   * Transient append instruction (streaming): the store CONCATENATES this
   * onto toolOutput instead of replacing it, then drops the field. Never
   * persisted on a stored step.
   */
  toolOutputDelta?: string;
  isError?: boolean;
  timestamp: number;
  duration?: number;
}

export type TraceStepType = 'thinking' | 'text' | 'tool_call' | 'tool_result';
export type TraceStepStatus = 'pending' | 'running' | 'completed' | 'error';

export type ScheduleRepeatUnit = 'minute' | 'hour' | 'day';
export type ScheduleWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type ScheduleTaskMetadata = Record<string, unknown>;

export interface DailyScheduleConfig {
  kind: 'daily';
  times: string[];
}

export interface WeeklyScheduleConfig {
  kind: 'weekly';
  weekdays: ScheduleWeekday[];
  times: string[];
}

export type ScheduleConfig = DailyScheduleConfig | WeeklyScheduleConfig;

export interface ScheduleTask {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  runAt: number;
  nextRunAt: number | null;
  scheduleConfig: ScheduleConfig | null;
  repeatEvery: number | null;
  repeatUnit: ScheduleRepeatUnit | null;
  enabled: boolean;
  lastRunAt: number | null;
  lastRunSessionId: string | null;
  lastError: string | null;
  metadata: ScheduleTaskMetadata | null;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleCreateInput {
  title?: string;
  prompt: string;
  cwd: string;
  runAt: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
  metadata?: ScheduleTaskMetadata | null;
}

export interface ScheduleUpdateInput {
  title?: string;
  prompt?: string;
  cwd?: string;
  runAt?: number;
  nextRunAt?: number | null;
  scheduleConfig?: ScheduleConfig | null;
  repeatEvery?: number | null;
  repeatUnit?: ScheduleRepeatUnit | null;
  enabled?: boolean;
  lastRunAt?: number | null;
  lastRunSessionId?: string | null;
  lastError?: string | null;
  metadata?: ScheduleTaskMetadata | null;
}

// Skills types
export interface Skill {
  id: string;
  name: string;
  description?: string;
  type: SkillType;
  enabled: boolean;
  config?: Record<string, unknown>;
  createdAt: number;
}

export type SkillType = 'builtin' | 'mcp' | 'custom';

export type PluginComponentKind = 'skills' | 'commands' | 'agents' | 'hooks' | 'mcp';

export interface PluginComponentCounts {
  skills: number;
  commands: number;
  agents: number;
  hooks: number;
  mcp: number;
}

export interface PluginComponentEnabledState {
  skills: boolean;
  commands: boolean;
  agents: boolean;
  hooks: boolean;
  mcp: boolean;
}

export interface PluginCatalogItemV2 {
  name: string;
  description?: string;
  version?: string;
  authorName?: string;
  installable: boolean;
  hasManifest: boolean;
  componentCounts: PluginComponentCounts;
  pluginId?: string;
  installCommand?: string;
  detailUrl?: string;
  catalogSource?: 'claude-marketplace';
}

export interface PluginCatalogItem extends PluginCatalogItemV2 {
  skillCount: number;
  hasSkills: boolean;
}

export interface InstalledPlugin {
  pluginId: string;
  name: string;
  description?: string;
  version?: string;
  authorName?: string;
  enabled: boolean;
  sourcePath: string;
  runtimePath: string;
  componentCounts: PluginComponentCounts;
  componentsEnabled: PluginComponentEnabledState;
  installedAt: number;
  updatedAt: number;
}

export interface PluginInstallResultV2 {
  plugin: InstalledPlugin;
  installedSkills: string[];
  warnings: string[];
}

export interface PluginToggleResult {
  success: boolean;
  plugin: InstalledPlugin;
}

export interface PluginInstallResult {
  pluginName: string;
  installedSkills: string[];
  skippedSkills: string[];
  errors: string[];
}

export interface SkillsStorageChangeEvent {
  path: string;
  reason: 'updated' | 'path_changed' | 'fallback' | 'watcher_error';
  message?: string;
}

// Memory types
export interface MemoryEntry {
  id: string;
  sessionId: string;
  content: string;
  metadata: MemoryMetadata;
  createdAt: number;
}

export interface MemoryMetadata {
  source: string;
  timestamp: number;
  tags: string[];
}

// Permission types
export interface PermissionRequest {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  sessionId: string;
  /**
   * When set, the request originated from the embedded Code Buddy
   * core engine's `DesktopPermissionBridge` rather than from the pi
   * runner. The response must travel back via `permission.bridge.response`
   * so the bridge resolves the right pending Promise.
   */
  bridgeId?: string;
}

export type PermissionResult = 'allow' | 'deny' | 'allow_always';

// Sudo password types
export interface SudoPasswordRequest {
  toolUseId: string;
  command: string;
  sessionId: string;
}

// AskUserQuestion display types - kept for rendering historical messages
export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export interface PermissionRule {
  tool: string;
  pattern?: string;
  action: 'allow' | 'deny' | 'ask';
}

// Diff types (Code Buddy Cowork parity)
export interface DiffEntry {
  path: string;
  action: 'create' | 'modify' | 'delete' | 'rename';
  linesAdded: number;
  linesRemoved: number;
  excerpt: string;
}

export interface DiffPreview {
  turnId: number;
  sessionId: string;
  diffs: DiffEntry[];
  plan?: string;
  timestamp: number;
  status: 'pending' | 'accepted' | 'rejected';
}

// Checkpoint types
export interface CheckpointSnapshot {
  id: string;
  commitHash: string;
  description: string;
  timestamp: number;
  turn: number;
}

export interface CheckpointTimeline {
  snapshots: CheckpointSnapshot[];
  currentIndex: number;
  canUndo: boolean;
  canRedo: boolean;
}

// Permission mode types
export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'dontAsk' | 'bypassPermissions';

// Update info types
export interface UpdateInfo {
  available: boolean;
  version?: string;
  releaseNotes?: string;
  downloadProgress?: number;
  downloaded: boolean;
}

// IPC Event types
export type ClientEvent =
  | {
      type: 'session.start';
      payload: {
        title: string;
        prompt: string;
        cwd?: string;
        projectId?: string | null;
        allowedTools?: string[];
        content?: ContentBlock[];
        memoryEnabled?: boolean;
      };
    }
  | { type: 'session.continue'; payload: { sessionId: string; prompt: string; content?: ContentBlock[] } }
  | { type: 'session.steer'; payload: { sessionId: string; prompt: string; content?: ContentBlock[]; intentId?: string } }
  | { type: 'session.stop'; payload: { sessionId: string } }
  | { type: 'session.delete'; payload: { sessionId: string } }
  | { type: 'session.batchDelete'; payload: { sessionIds: string[] } }
  | { type: 'session.duplicate'; payload: { sessionId: string } }
  | { type: 'session.updateSettings'; payload: { sessionId: string; updates: Partial<Session> } }
  | { type: 'session.list'; payload: Record<string, never> }
  | { type: 'session.getMessages'; payload: { sessionId: string } }
  | { type: 'session.getTraceSteps'; payload: { sessionId: string } }
  | { type: 'permission.response'; payload: { toolUseId: string; result: PermissionResult } }
  | { type: 'sudo.password.response'; payload: { toolUseId: string; password: string | null } }
  | { type: 'settings.update'; payload: Record<string, unknown> }
  | { type: 'folder.select'; payload: Record<string, never> }
  | { type: 'workdir.get'; payload: Record<string, never> }
  | { type: 'workdir.set'; payload: { path: string; sessionId?: string } }
  | { type: 'workdir.select'; payload: { sessionId?: string; currentPath?: string } }
  | { type: 'config.geminiOauthLogin'; payload: Record<string, never> }
  | { type: 'config.geminiOauthClear'; payload: Record<string, never> }
  | { type: 'config.codexOauthLogin'; payload: Record<string, never> }
  | { type: 'config.codexOauthClear'; payload: Record<string, never> }
  | { type: 'config.codexOauthStatus'; payload: Record<string, never> };

// Sandbox setup types (app startup)
export type SandboxSetupPhase = 
  | 'checking'      // Checking WSL/Lima availability
  | 'creating'      // Creating Lima instance (macOS only)
  | 'starting'      // Starting Lima instance (macOS only)  
  | 'installing_node'   // Installing Node.js
  | 'installing_python' // Installing Python
  | 'installing_pip'    // Installing pip
  | 'installing_deps'   // Installing skill dependencies (markitdown, pypdf, etc.)
  | 'ready'         // Ready to use
  | 'skipped'       // No sandbox needed (native mode)
  | 'error';        // Setup failed

export interface SandboxSetupProgress {
  phase: SandboxSetupPhase;
  message: string;
  detail?: string;
  progress?: number; // 0-100
  error?: string;
}

// Sandbox sync types (per-session file sync)
export type SandboxSyncPhase =
  | 'starting_agent'  // Starting WSL/Lima agent
  | 'syncing_files'   // Syncing files to sandbox
  | 'syncing_skills'  // Copying skills
  | 'ready'           // Sync complete
  | 'error';          // Sync failed

export interface SandboxSyncStatus {
  sessionId: string;
  phase: SandboxSyncPhase;
  message: string;
  detail?: string;
  fileCount?: number;
  totalSize?: number;
}

// Fleet (multi-host Code Buddy listener) — GAP 3
export type FleetPeerStatus =
  | 'connecting'
  | 'connected'
  | 'authenticated'
  | 'disconnected'
  | 'reconnecting'
  | 'error';

export interface FleetPeer {
  id: string;
  url: string;
  label?: string;
  addedAt: number;
  status: FleetPeerStatus;
  lastError?: string;
  lastSeenAt?: number;
  lastEventType?: string;
  peerChatProvider?: {
    provider: string;
    model: string;
    isLocal: boolean;
  } | null;
  chatSessions?: Array<{
    sessionId: string;
    model?: string;
    dispatchProfile?: string;
    turnCount: number;
    startedAt: number;
    lastTurnAt?: number;
  }>;
  /**
   * Latest capability snapshot from `peer.describe` (Fleet P2). Lets
   * the UI display which models the peer can route to and the
   * command center route tasks based on egress / strengths / cost.
   */
  capability?: {
    egress: 'local' | 'lan' | 'cloud';
    machineLabel: string;
    machineSpec?: { cpu?: string; gpu?: string; ramGb?: number };
    maxConcurrency?: number;
    activeRequests?: number;
    models: Array<{
      id: string;
      contextWindow: number;
      strengths: string[];
      provider: string;
      costInputUsdPerMtok?: number;
      costOutputUsdPerMtok?: number;
      avgLatencyMs?: number;
    }>;
  };
}

export interface FleetEventRecord {
  peerId: string;
  type: string;
  payload: Record<string, unknown>;
  receivedAt: number;
  hostname?: string;
  agentId?: string;
}

// Agent Team (Phase 4 layer 9) — observed via TeamBridge events
export type TeamStatusValue = 'inactive' | 'active' | 'paused' | 'dissolved';
export type TeamMemberStatus = 'idle' | 'working' | 'done' | 'error';
export type TeamTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';
export type TeamTaskPriority = 'low' | 'medium' | 'high';

export interface TeamMember {
  id: string;
  role: string;
  label: string;
  status: TeamMemberStatus;
  currentTaskId: string | null;
  completedTasks: number;
  joinedAt: string;
}

export interface TeamTask {
  id: string;
  title: string;
  description: string;
  status: TeamTaskStatus;
  priority: TeamTaskPriority;
  assignedTo: string | null;
  assignedRole: string | null;
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
}

export interface TeamMailboxMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: string;
  read: boolean;
}

export interface TeamSnapshot {
  status: TeamStatusValue;
  goal: string;
  memberCount: number;
  members: TeamMember[];
  taskSummary: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    failed: number;
  };
  unreadMessages: number;
  uptime: string;
}

// A2A active task tracking — GAP 1
export type A2ATaskStatus =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface A2ATask {
  taskId: string;
  agentId: string;
  agentName?: string;
  status: A2ATaskStatus;
  startedAt: number;
  updatedAt: number;
  result?: string;
  error?: string;
}

export type MissionRuntime = import('../../main/missions/mission-types').Mission;
export type MissionRuntimeEvent = import('../../main/missions/mission-types').MissionEvent;

export interface MissionRuntimeEventPayload {
  missionId: string;
  event: MissionRuntimeEvent;
}

export type ServerEvent =
  | { type: 'stream.message'; payload: { sessionId: string; message: Message } }
  | { type: 'stream.partial'; payload: { sessionId: string; delta: string } }
  | { type: 'stream.thinking'; payload: { sessionId: string; delta: string } }
  | { type: 'stream.executionTime'; payload: { sessionId: string; messageId: string; executionTimeMs: number } }
  | { type: 'session.status'; payload: { sessionId: string; status: SessionStatus; error?: string } }
  | { type: 'session.update'; payload: { sessionId: string; updates: Partial<Session> } }
  | { type: 'session.list'; payload: { sessions: Session[] } }
  | { type: 'permission.request'; payload: PermissionRequest }
  | { type: 'permission.dismiss'; payload: { toolUseId: string } }
  | { type: 'sudo.password.request'; payload: SudoPasswordRequest }
  | { type: 'sudo.password.dismiss'; payload: { toolUseId: string } }
  | { type: 'trace.step'; payload: { sessionId: string; step: TraceStep } }
  | { type: 'trace.update'; payload: { sessionId: string; stepId: string; updates: Partial<TraceStep> } }
  | { type: 'folder.selected'; payload: { path: string } }
  | { type: 'config.status'; payload: { isConfigured: boolean; config: AppConfig } }
  | { type: 'sandbox.progress'; payload: SandboxSetupProgress }
  | { type: 'sandbox.sync'; payload: SandboxSyncStatus }
  | { type: 'skills.storageChanged'; payload: SkillsStorageChangeEvent }
  | { type: 'plugins.runtimeApplied'; payload: { sessionId: string; plugins: Array<{ name: string; path: string }> } }
  | { type: 'workdir.changed'; payload: { path: string } }
  | { type: 'session.contextInfo'; payload: { sessionId: string; contextWindow: number } }
  | { type: 'goal.status'; payload: { sessionId: string; goal: GoalStatusPayload } }
  | { type: 'navigate.to'; payload: { page: 'welcome' | 'settings' | 'session'; tab?: string; sessionId?: string } }
  | { type: 'native-theme.changed'; payload: { shouldUseDarkColors: boolean } }
  | { type: 'new-session' }
  | { type: 'navigate'; payload: string }
  | { type: 'scheduled-task.error'; payload: { taskId: string; error: string } }
  | { type: 'error'; payload: { message: string; sessionId?: string; code?: 'CONFIG_REQUIRED_ACTIVE_SET'; action?: 'open_api_settings' } }
  | { type: 'diff.preview'; payload: { sessionId: string; diffPreview: DiffPreview } }
  | { type: 'checkpoint.created'; payload: { sessionId: string; snapshot: CheckpointSnapshot } }
  | { type: 'checkpoint.timeline'; payload: CheckpointTimeline }
  | { type: 'permission.modeChanged'; payload: { mode: PermissionMode } }
  | { type: 'stream.done'; payload: { sessionId: string } }
  | { type: 'update.available'; payload: UpdateInfo }
  | { type: 'update.progress'; payload: { percent: number } }
  | { type: 'update.downloaded'; payload: UpdateInfo }
  | { type: 'project.list'; payload: { projects: Project[] } }
  | { type: 'project.created'; payload: { project: Project } }
  | { type: 'project.updated'; payload: { project: Project } }
  | { type: 'project.deleted'; payload: { projectId: string } }
  | { type: 'project.activeChanged'; payload: { projectId: string | null } }
  | { type: 'subagent.spawned'; payload: { sessionId: string; subAgent: SubAgent } }
  | { type: 'subagent.status'; payload: { sessionId: string; agentId: string; status: SubAgentStatus; nickname: string } }
  | { type: 'subagent.completed'; payload: { sessionId: string; agentId: string; nickname: string; result: string } }
  | { type: 'subagent.output'; payload: { sessionId: string; agentId: string; delta: string } }
  | { type: 'subagent.activity'; payload: { sessionId: string; agentId: string; nickname: string; currentStep: string } }
  | { type: 'fleet.peers'; payload: { peers: FleetPeer[] } }
  | { type: 'fleet.peer.update'; payload: { peer: FleetPeer } }
  | { type: 'fleet.event'; payload: FleetEventRecord }
  | { type: 'fleet.saga.update'; payload: { sagaId: string } }
  | {
      type: 'liveLauncher.event';
      payload: import('../../shared/live-launcher-types').LiveLauncherEventPayload;
    }
  | {
      type: 'fleet.peer.discovered';
      payload: {
        peers: Array<{
          label: string;
          url: string;
          source: 'tailscale' | 'manual';
          apiKey?: string;
        }>;
      };
    }
  | { type: 'a2a.task.update'; payload: A2ATask }
  | { type: 'team.update'; payload: { event: 'started' | 'stopped'; leadId?: string; goal?: string; stats?: { memberCount: number; completedTasks: number; totalTasks: number }; snapshot: TeamSnapshot } }
  | { type: 'team.member.update'; payload: { event: 'added'; member: TeamMember } | { event: 'removed'; memberId: string; role: string } }
  | { type: 'team.task.update'; payload: { event: 'added' | 'updated'; task: TeamTask } | { event: 'assigned'; taskId: string; memberId: string; role: string } }
  | { type: 'team.message'; payload: TeamMailboxMessage }
  | { type: 'notification.message'; payload: { notification: NotificationEntry } }
  | { type: 'identity.updated'; payload: unknown[] }
  | { type: 'identity.activated'; payload: unknown | null }
  | { type: 'test.framework'; payload: { framework: string } }
  | { type: 'test.start'; payload: { files: string[]; framework?: string } }
  | { type: 'test.output'; payload: { stream: 'stdout' | 'stderr'; text: string } }
  | { type: 'test.complete'; payload: unknown }
  | { type: 'test.cancelled'; payload: null }
  | { type: 'gui.action'; payload: GuiActionEvent }
  | { type: 'browser.action'; payload: BrowserActionEvent }
  | { type: 'workflow.event'; payload: import('../../shared/workflow-types').WorkflowEventPayload }
  | { type: 'workflow.approval_required'; payload: import('../../shared/workflow-types').PendingApproval }
  | { type: 'mission.created'; payload: MissionRuntime }
  | { type: 'mission.updated'; payload: MissionRuntime }
  | { type: 'mission.event'; payload: MissionRuntimeEventPayload }
  | { type: 'mission.heartbeat'; payload: { missionId: string } }
  | {
      type: 'clipboard.summary';
      payload: {
        hash: string;
        sourceLength: number;
        sourcePreview: string;
        summary: string | null;
        at: string;
      };
    }
  | { type: 'panic-stop'; payload: Record<string, never> };

/** Autonomous goal-loop progress, surfaced by the chat goal banner. */
export interface GoalStatusPayload {
  goal: string;
  status: 'active' | 'paused' | 'done' | 'cleared';
  turnsUsed: number;
  maxTurns: number;
  lastVerdict?: 'done' | 'continue' | 'skipped';
  lastReason?: string;
}

// Computer Use overlay events (Claude Cowork parity Phase 2 step 13)
export interface GuiActionEvent {
  sessionId: string;
  toolUseId: string;
  action: string;
  toolName: string;
  /** Base64 data URI or absolute file path of the screenshot if available */
  screenshot?: string;
  /** Optional click coordinates relative to the screenshot */
  click?: { x: number; y: number };
  /** Other input parameters that produced this action */
  details?: Record<string, unknown>;
  timestamp: number;
}

// Browser Operator overlay events (S2 — browser automation pilotability)
export interface BrowserActionEvent {
  sessionId: string;
  toolUseId: string;
  /** Browser action verb: navigate, click, type, extract, screenshot, … */
  action: string;
  /** Target URL when the action navigates */
  url?: string;
  /** Selector / text / target the action operated on */
  target?: string;
  /** Short, redaction-safe excerpt of the tool result (proof note) */
  evidence?: string;
  /** Base64 data URI or absolute file path of a page screenshot if available */
  screenshot?: string;
  /** Raw input parameters that produced this action */
  details?: Record<string, unknown>;
  timestamp: number;
}

// Settings types
export interface Settings {
  theme: AppTheme;
  chatActivityDisplayMode?: 'compact_worklog' | 'transparent_stream';
  apiKey?: string;
  defaultTools: string[];
  permissionRules: PermissionRule[];
  globalSkillsPath: string;
  memoryStrategy: 'auto' | 'manual' | 'rolling';
  maxContextTokens: number;
  ttsEnabled?: boolean;
  piperModel?: string;
  piperSpeed?: number;
}

// Tool types
export type ToolName = 'read' | 'write' | 'edit' | 'glob' | 'grep' | 'bash' | 'webFetch' | 'webSearch';

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

// Execution context
export interface ExecutionContext {
  sessionId: string;
  cwd: string;
  mountedPaths: MountedPath[];
  allowedTools: string[];
}

// App Config types
export type ProviderType =
  | 'chatgpt'
  | 'openrouter'
  | 'anthropic'
  | 'custom'
  | 'openai'
  | 'gemini'
  | 'ollama'
  | 'lmstudio'
  | 'grok'
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'vllm'
  | 'mistral';
export type CustomProtocolType = 'anthropic' | 'openai' | 'gemini';
export type AppTheme =
  | 'dark'
  | 'light'
  | 'system'
  | 'ember'
  | 'genspark'
  | 'codex'
  | 'anthropic';
export type MemoryStrategy = 'auto' | 'manual' | 'rolling';
export type ProviderProfileKey =
  | 'chatgpt'
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'ollama'
  | 'lmstudio'
  | 'grok'
  | 'groq'
  | 'together'
  | 'fireworks'
  | 'vllm'
  | 'mistral'
  | 'custom:anthropic'
  | 'custom:openai'
  | 'custom:gemini';
export type ConfigSetId = string;

export interface ProviderProfile {
  apiKey: string;
  baseUrl?: string;
  model: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ApiConfigSet {
  id: ConfigSetId;
  name: string;
  isSystem?: boolean;
  provider: ProviderType;
  customProtocol: CustomProtocolType;
  activeProfileKey: ProviderProfileKey;
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>>;
  enableThinking: boolean;
  updatedAt: string;
}

export interface CreateSetPayload {
  name: string;
  mode: 'blank' | 'clone';
  fromSetId?: string;
}

export interface AppConfig {
  provider: ProviderType;
  apiKey: string;
  baseUrl?: string;
  customProtocol?: CustomProtocolType;
  model: string;
  contextWindow?: number;
  maxTokens?: number;
  activeProfileKey: ProviderProfileKey;
  profiles: Partial<Record<ProviderProfileKey, ProviderProfile>>;
  activeConfigSetId: ConfigSetId;
  configSets: ApiConfigSet[];
  claudeCodePath?: string;
  defaultWorkdir?: string;
  globalSkillsPath?: string;
  theme?: AppTheme;
  memoryStrategy?: MemoryStrategy;
  sandboxEnabled?: boolean;
  enableThinking?: boolean;
  isConfigured: boolean;
  onboardingCompleted: boolean;
  /** Embedded HTTP server settings — see config-store.ts for details. */
  server?: {
    port?: number;
    host?: string;
    websocketEnabled?: boolean;
    jwtSecret?: string;
  };
  codebuddy?: {
    enabled: boolean;
    endpoint: string;
    apiKey?: string;
    model?: string;
    geminiGroundingEnabled?: boolean;
    visionGroundingEnabled?: boolean;
    visionGroundingModel?: string;
  };
}

export interface ProviderPreset {
  name: string;
  baseUrl: string;
  models: { id: string; name: string }[];
  keyPlaceholder: string;
  keyHint: string;
}

export interface ProviderPresets {
  chatgpt: ProviderPreset;
  openrouter: ProviderPreset;
  anthropic: ProviderPreset;
  custom: ProviderPreset;
  openai: ProviderPreset;
  gemini: ProviderPreset;
  ollama: ProviderPreset;
  lmstudio: ProviderPreset;
  grok: ProviderPreset;
  groq: ProviderPreset;
  together: ProviderPreset;
  fireworks: ProviderPreset;
  vllm: ProviderPreset;
  mistral: ProviderPreset;
}

export interface ProviderModelInfo {
  id: string;
  name: string;
}

export interface ModelInventoryEntry {
  provider: string;
  runtimeProvider: string;
  model: string;
  baseURL?: string;
  machineLabel: string;
  machineSpec?: {
    cpu?: string;
    gpu?: string;
    ramGb?: number;
  };
  executionLocation: 'local' | 'lan' | 'cloud';
  launchHint: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsReasoning: boolean;
  supportsToolCalls: boolean;
  supportsVision: boolean;
  strengths: string[];
  benchmarkScore?: number;
  bestFor: string[];
  source: 'local-capability' | 'tailnet-peer' | 'catalog';
}

export interface ModelInventorySnapshot {
  updatedAt: string;
  machineLabel: string;
  entries: ModelInventoryEntry[];
}

export interface ApiTestInput {
  provider: AppConfig['provider'];
  apiKey: string;
  baseUrl?: string;
  customProtocol?: AppConfig['customProtocol'];
  model?: string;
  useLiveRequest?: boolean;
  verificationLevel?: DiagnosticVerificationLevel;
}

export interface ApiTestResult {
  ok: boolean;
  latencyMs?: number;
  status?: number;
  errorType?:
    | 'missing_key'
    | 'missing_base_url'
    | 'unauthorized'
    | 'not_found'
    | 'rate_limited'
    | 'server_error'
    | 'network_error'
    | 'ollama_not_running'
    | 'ollama_loading'
    | 'lmstudio_not_running'
    | 'unknown';
  details?: string;
}

// API Diagnostics types
export type DiagnosticStepName = 'dns' | 'tcp' | 'tls' | 'auth' | 'model';
export type DiagnosticStepStatus = 'pending' | 'running' | 'ok' | 'fail' | 'skip';
export type DiagnosticVerificationLevel = 'fast' | 'deep';
export type DiagnosticAdvisoryCode = 'not_deep_verified' | 'model_loading' | 'manual_model';

export interface DiagnosticStep {
  name: DiagnosticStepName;
  status: DiagnosticStepStatus;
  latencyMs?: number;
  error?: string;
  fix?: string;
}

export interface DiagnosticResult {
  steps: DiagnosticStep[];
  overallOk: boolean;
  /** Which step failed first (null if all ok) */
  failedAt?: DiagnosticStepName;
  totalLatencyMs: number;
  verificationLevel?: DiagnosticVerificationLevel;
  advisoryCode?: DiagnosticAdvisoryCode;
  advisoryText?: string;
  /** Present when the run was skipped (e.g. 'concurrent_run') */
  skippedReason?: string;
}

export interface DiagnosticInput {
  provider: AppConfig['provider'];
  apiKey: string;
  baseUrl?: string;
  customProtocol?: AppConfig['customProtocol'];
  model?: string;
  verificationLevel?: DiagnosticVerificationLevel;
}

export interface LocalServiceInfo {
  type: 'ollama' | 'lmstudio';
  baseUrl: string;
  models?: string[];
}

export type LocalProviderDiscoveryStatus =
  | 'unavailable'
  | 'service_available'
  | 'models_available';

export type LocalOllamaDiscoveryStatus = LocalProviderDiscoveryStatus;
export interface LocalOllamaDiscoveryResult {
  available: boolean;
  baseUrl: string;
  models?: string[];
  status: LocalOllamaDiscoveryStatus;
}

export type LocalLmStudioDiscoveryStatus = LocalProviderDiscoveryStatus;
export interface LocalLmStudioDiscoveryResult {
  available: boolean;
  baseUrl: string;
  models?: string[];
  status: LocalLmStudioDiscoveryStatus;
}

// MCP types
export interface MCPServerInfo {
  id: string;
  name: string;
  connected: boolean;
  toolCount: number;
  tools?: MCPToolInfo[];
}

export interface MCPToolInfo {
  name: string;
  description: string;
  serverId: string;
  serverName: string;
}
