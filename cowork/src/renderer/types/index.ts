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
  createdAt: number;
  updatedAt: number;
}

export type SessionStatus = 'idle' | 'running' | 'completed' | 'error';

export type ExecutionMode = 'chat' | 'task';

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
  executionTimeMs?: number;
}

export type MessageRole = 'user' | 'assistant' | 'system';

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
  isError?: boolean;
  timestamp: number;
  duration?: number;
}

export type TraceStepType = 'thinking' | 'text' | 'tool_call' | 'tool_result';
export type TraceStepStatus = 'pending' | 'running' | 'completed' | 'error';

export type ScheduleRepeatUnit = 'minute' | 'hour' | 'day';
export type ScheduleWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

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
  | { type: 'session.stop'; payload: { sessionId: string } }
  | { type: 'session.delete'; payload: { sessionId: string } }
  | { type: 'session.batchDelete'; payload: { sessionIds: string[] } }
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
  | { type: 'navigate.to'; payload: { page: 'welcome' | 'settings' | 'session'; tab?: string; sessionId?: string } }
  | { type: 'native-theme.changed'; payload: { shouldUseDarkColors: boolean } }
  | { type: 'new-session' }
  | { type: 'navigate'; payload: string }
  | { type: 'scheduled-task.error'; payload: { taskId: string; error: string } }
  | { type: 'error'; payload: { message: string; code?: 'CONFIG_REQUIRED_ACTIVE_SET'; action?: 'open_api_settings' } }
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
  | { type: 'fleet.peers'; payload: { peers: FleetPeer[] } }
  | { type: 'fleet.peer.update'; payload: { peer: FleetPeer } }
  | { type: 'fleet.event'; payload: FleetEventRecord }
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
  | { type: 'workflow.event'; payload: import('../../shared/workflow-types').WorkflowEventPayload }
  | { type: 'workflow.approval_required'; payload: import('../../shared/workflow-types').PendingApproval }
  | { type: 'panic-stop'; payload: Record<string, never> };

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

// Settings types
export interface Settings {
  theme: AppTheme;
  apiKey?: string;
  defaultTools: string[];
  permissionRules: PermissionRule[];
  globalSkillsPath: string;
  memoryStrategy: 'auto' | 'manual' | 'rolling';
  maxContextTokens: number;
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
  | 'lmstudio';
export type CustomProtocolType = 'anthropic' | 'openai' | 'gemini';
export type AppTheme = 'dark' | 'light' | 'system';
export type ProviderProfileKey =
  | 'chatgpt'
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'ollama'
  | 'lmstudio'
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
  sandboxEnabled?: boolean;
  enableThinking?: boolean;
  isConfigured: boolean;
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
}

export interface ProviderModelInfo {
  id: string;
  name: string;
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
