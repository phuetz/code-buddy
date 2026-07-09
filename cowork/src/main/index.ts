/**
 * @module main/index
 *
 * Electron main-process entry point (2181 lines).
 *
 * Responsibilities:
 * - App lifecycle: ready, activate, before-quit, window-will-close
 * - Central IPC hub: ~60 handlers namespaced as config.*, mcp.*, session.*,
 *   sandbox.*, logs.*, remote.*, schedule.*, etc.
 * - BrowserWindow creation and deep-link / protocol handling
 *
 * Dependencies: session-manager, config-store, mcp-manager, sandbox-adapter,
 *               skills-manager, scheduled-task-manager, nav-server, remote-manager
 */
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  nativeTheme,
  Tray,
  globalShortcut,
  session,
  clipboard,
  nativeImage,
} from 'electron';
import { join, resolve, dirname, isAbsolute, basename } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import { config } from 'dotenv';
import { registerProjectIpcHandlers } from './ipc/project-ipc';
import { registerSubAgentIpcHandlers } from './ipc/subagent-ipc';
import { registerOrchestratorIpcHandlers } from './ipc/orchestrator-ipc';
import {
  dispatchFleetSaga,
  registerFleetIpcHandlers,
  type FleetDispatchInput,
} from './ipc/fleet-ipc';
import { wireFleetAggregator } from './fleet/aggregator-wiring';
import { registerOsIpcHandlers } from './ipc/os-ipc';
import { setMainWindow, setTray, getMainWindow } from './window-management';
import { registerTeamIpcHandlers } from './ipc/team-ipc';
import { registerMentionIpcHandlers } from './ipc/mention-ipc';
import { registerCommandIpcHandlers } from './ipc/command-ipc';
import { registerSkillMdIpcHandlers } from './ipc/skill-md-ipc';
import { registerKnowledgeIpcHandlers } from './ipc/knowledge-ipc';
import { registerLessonCandidateIpcHandlers } from './ipc/lessons-candidate-ipc';
import { registerMobileSupervisionIpcHandlers } from './ipc/mobile-supervision-ipc';
import { registerIdentityIpcHandlers } from './ipc/identity-ipc';
import { registerDeviceIpcHandlers } from './ipc/device-ipc';
import { registerChannelsIpcHandlers } from './ipc/channels-ipc';
// App Studio (bolt.diy-style) main-process IPC + services.
import { registerDevServerIpc } from './studio/dev-server-ipc';
import { StudioDevServer } from './studio/dev-server-service';
import { registerStudioFilesIpc } from './studio/studio-files-ipc';
import { registerCommandRunnerIpc } from './studio/command-runner-ipc';
import { CommandRunner } from './studio/command-runner';
import { registerScaffoldIpc } from './studio/scaffold-ipc';
import { registerMediaGenIpc } from './media/media-gen-ipc';
import { MediaGenService } from './media/media-gen-service';
import { registerFilmIpc } from './film/film-ipc';
import { FilmService } from './film/film-service';
import { registerAssistantIpc } from './assistant/assistant-ipc';
import { AssistantService } from './assistant/assistant-service';
import { ScaffoldService } from './studio/scaffold-service';
import { registerPairingIpcHandlers } from './ipc/pairing-ipc';
import { registerUserModelIpcHandlers } from './ipc/user-model-ipc';
import { registerCompanionIpcHandlers } from './ipc/companion-ipc';
import { registerAutomationsIpcHandlers } from './ipc/automations-ipc';
import { registerDesktopSnapshotIpcHandlers } from './ipc/desktop-snapshot-ipc';
import { registerMissionIpcHandlers } from './ipc/mission-ipc';
import { registerSpecIpcHandlers } from './ipc/spec-ipc';
import { registerSpecNextIpcHandlers } from './ipc/spec-next-ipc';
import { registerLiveLauncherIpcHandlers } from './ipc/live-launcher-ipc';
import { registerPermissionIpcHandlers } from './ipc/permission-ipc';
import { registerConfigModelIpcHandlers } from './ipc/config-model-ipc';
import { registerLogsIpcHandlers } from './ipc/logs-ipc';
import { registerBackupIpcHandlers } from './ipc/backup-ipc';
import { registerSkillsHubIpcHandlers } from './ipc/skills-ipc';
import { registerProfilesIpcHandlers, readActiveProfile } from './ipc/profiles-ipc';
import { registerWorkflowServiceIpcHandlers } from './ipc/workflow-service-ipc';
import { registerMcpIpcHandlers } from './ipc/mcp-ipc';
import { registerCostIpcHandlers } from './ipc/cost-ipc';
import { registerRulesIpcHandlers } from './ipc/rules-ipc';
import { registerGitIpcHandlers } from './ipc/git-ipc';
import { registerCheckpointIpcHandlers } from './ipc/checkpoint-ipc';
import { initDatabase, closeDatabase } from './db/database';
import { SessionManager, type EngineAdapterLike } from './session/session-manager';
import {
  classifyEngineLoadError,
  resolveEnginePathWithDiagnostic,
  shouldLoadEngine,
} from './engine/embedded-mode';
import { applyGroundingToggle, applyVisionGroundingSetting } from './codebuddy/grounding-handler';
import {
  listCodeBuddyModels,
  probeCodeBuddyConnection,
  type CodeBuddyDiscoveryInput,
} from './codebuddy/model-discovery';
import { ProjectManager } from './project/project-manager';
import { ProjectMemoryService } from './project/project-memory';
import { SubAgentBridge } from './agent/sub-agent-bridge';
import { OrchestratorBridge } from './agent/orchestrator-bridge';
import { FleetBridge } from './fleet/fleet-bridge';
import { SagaRunner } from './fleet/saga-runner';
import { resolveWorkDir } from './ipc/ipc-workdir';
import {
  buildFleetInternetProofPlan,
  buildInternetProofSummaryMetadata,
  summarizeInternetProofPlan,
} from '../shared/internet-proof-metadata';
import { TeamBridge } from './agent/team-bridge';
import { MentionProcessor } from './input/mention-processor';
import { SlashCommandBridge } from './commands/slash-command-bridge';
import { SkillMdBridge } from './skills/skill-md-bridge';
import { MCPMarketplaceBridge } from './mcp/mcp-marketplace-bridge';
import { CostBridge } from './cost/cost-bridge';
import { RulesBridge } from './security/rules-bridge';
import { SessionBranchingBridge } from './session/session-branching';
import { GlobalSearchService } from './search/global-search-service';
import { PreviewService } from './preview/preview-service';
import { registerDiffIpcHandlers } from './ipc/diff-ipc';
import { registerServerIpcHandlers } from './ipc/server-ipc';
import { registerHooksIpcHandlers } from './ipc/hooks-ipc';
import { registerReasoningIpcHandlers } from './ipc/reasoning-ipc';
import { getModelCapabilities } from './config/model-capability-bridge';
import { TemplateService } from './project/template-service';
import { WorkflowBridge } from './workflows/workflow-bridge';
import { MissionBridge } from './missions/mission-bridge';
import {
  VoiceConversationSession,
  type VoiceConversationEvent,
} from './voice/conversation-session';
import { VoiceBridge } from './voice/voice-bridge';
import { TTSBridge } from './voice/tts-bridge';
import { KyutaiBridge } from './voice/kyutai-bridge';
import { ClipboardWatcher } from './clipboard/clipboard-watcher';
import { SessionExportService } from './session/session-export-service';
import { SessionInsightsBridge } from './session/session-insights-bridge';
import { ActivityFeed, type ActivityType } from './activity/activity-feed';
import { BookmarksService } from './bookmarks/bookmarks-service';
import { registerSnippetsIpcHandlers } from './ipc/snippets-ipc';
import { registerCustomCommandsIpcHandlers } from './ipc/custom-commands-ipc';
import { registerWorkspacePresetsIpcHandlers } from './ipc/workspace-presets-ipc';
import { registerBookmarksIpcHandlers } from './ipc/bookmarks-ipc';
import { registerTemplateIpcHandlers } from './ipc/template-ipc';
import { registerClipboardIpcHandlers } from './ipc/clipboard-ipc';
import { registerA2aIpcHandlers } from './ipc/a2a-ipc';
import { registerCkgIpcHandlers } from './ipc/ckg-ipc';
import { registerScienceIpcHandlers } from './ipc/science-ipc';
import { registerAuditIpcHandlers } from './ipc/audit-ipc';
import { registerPersonaIpcHandlers } from './ipc/persona-ipc';
import { registerSessionInsightsIpcHandlers } from './ipc/session-insights-ipc';
import { registerPluginsIpcHandlers } from './ipc/plugins-ipc';
import { registerTestRunnerIpcHandlers } from './ipc/test-runner-ipc';
import { registerMemoryIpcHandlers } from './ipc/memory-ipc';
import { registerWidgetsIpcHandlers } from './ipc/widgets-ipc';
import { ConfigExportService } from './config/config-export-service';
import { KnowledgeService } from './knowledge/knowledge-service';
import { NotificationBridge } from './notification/notification-bridge';
import { ICMIntegration } from './memory/icm-integration';
import { TaskDispatch, type DispatchRequest } from './remote/task-dispatch';
import { SkillsManager } from './skills/skills-manager';
import { PluginCatalogService } from './skills/plugin-catalog-service';
import { PluginRuntimeService } from './skills/plugin-runtime-service';
import { loadCoreModule } from './utils/core-loader';
import {
  configStore,
  getPiAiModelPresets,
  type AppConfig,
  type AppTheme,
  type CreateConfigSetPayload,
} from './config/config-store';
import { runConfigApiTest } from './config/config-test-routing';
import { resolveEngineRuntimeConfig } from './config/engine-runtime-config';
import { listLmStudioModels } from './config/lmstudio-api';
import { listOllamaModels } from './config/ollama-api';
import { mcpConfigStore } from './mcp/mcp-config-store';
import { getSandboxAdapter, shutdownSandbox } from './sandbox/sandbox-adapter';
import { SandboxSync } from './sandbox/sandbox-sync';
import { WSLBridge } from './sandbox/wsl-bridge';
import { LimaBridge } from './sandbox/lima-bridge';
import { getSandboxBootstrap } from './sandbox/sandbox-bootstrap';
import type { MCPServerConfig } from './mcp/mcp-manager';
import type {
  ClientEvent,
  ApiTestInput,
  ApiTestResult,
  DiagnosticInput,
  ProviderModelInfo,
} from '../renderer/types';
import { remoteManager, type AgentExecutor } from './remote/remote-manager';
import { remoteConfigStore } from './remote/remote-config-store';
import type { GatewayConfig, FeishuChannelConfig, SlackChannelConfig, ChannelType } from './remote/types';
import { startNavServer, stopNavServer } from './nav-server';
import {
  ScheduledTaskManager,
  type ScheduledTask,
  type ScheduledTaskCreateInput,
  type ScheduledTaskMetadata,
  type ScheduledTaskUpdateInput,
} from './schedule/scheduled-task-manager';
import { createScheduledTaskStore } from './schedule/scheduled-task-store';
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
} from '../shared/schedule/task-title';
import {
  isUncPath,
  isWindowsDrivePath,
  localPathFromAppUrlPathname,
  localPathFromFileUrl,
  decodePathSafely,
} from '../shared/local-file-path';
import { eventRequiresSessionManager } from './client-event-utils';
import { getUnsupportedWorkspacePathReason } from './workspace-path-constraints';
import { resolveEnvFileCandidates } from './env-files';
import {
  log,
  logWarn,
  logError,
  closeLogFile,
  setDevLogsEnabled,
} from './utils/logger';
import { listRecentWorkspaceFiles } from './utils/recent-workspace-files';
import { getHermesProviderReadinessForReview } from './tools/hermes-provider-readiness-bridge';
import {
  getHermesMemoryProvidersForReview,
  runHermesMemoryProbeForReview,
} from './tools/hermes-memory-providers-bridge';
import {
  getHermesRuntimeBackendsForReview,
  runHermesRuntimeBackendSmokeForReview,
} from './tools/hermes-runtime-backends-bridge';
import {
  getHermesBrowserBackendsForReview,
  runHermesBrowserBackendSmokeForReview,
} from './tools/hermes-browser-backends-bridge';
import {
  getHermesProtocolGatewaysForReview,
  runHermesProtocolGatewaysSmokeForReview,
} from './tools/hermes-protocol-gateways-bridge';
import { runHermesLocalSmokeSuiteForReview } from './tools/hermes-local-smoke-bridge';
import {
  getAutonomyDaemonStatusForReview,
  controlAutonomyServiceForReview,
  installAutonomyServiceForReview,
  uninstallAutonomyServiceForReview,
  runAutonomyTickForReview,
  getAutonomyModelTierForReview,
  getAutonomyServiceLogsForReview,
} from './autonomy/autonomy-daemon-bridge';
import { bootstrapDarkstarNetworkModel } from './config/darkstar-network-model';
import {
  addColabTaskForReview,
  blockColabTaskForReview,
  claimColabTaskForReview,
  completeColabTaskForReview,
  releaseColabTaskForReview,
  reclaimExpiredColabForReview,
  type ColabBoardAddInput,
} from './autonomy/colab-board-bridge';
import { getHermesMobileSupervisionForReview } from './tools/hermes-mobile-supervision-bridge';
import { getHermesFeatureParityForReview } from './tools/hermes-feature-parity-bridge';
import { getHermesPortalForReview } from './tools/hermes-portal-bridge';
import { getHermesTrajectoriesForReview } from './tools/hermes-trajectories-bridge';
import { getHermesDoctorForReview } from './tools/hermes-doctor-bridge';
import {
  getHermesClawStatusForReview,
  runHermesClawMigrationForReview,
} from './tools/hermes-claw-migrate-bridge';
import {
  archiveHermesKanbanCard,
  assignHermesKanbanCard,
  blockHermesKanbanCard,
  commentHermesKanbanCard,
  completeHermesKanbanCard,
  createHermesKanbanBoard,
  createHermesKanbanCard,
  linkHermesKanbanCard,
  listHermesKanbanBoards,
  listHermesKanbanCards,
  switchHermesKanbanBoard,
  unblockHermesKanbanCard,
  unlinkHermesKanbanCard,
  type KanbanCreateInput,
  type KanbanListFilter,
} from './tools/hermes-kanban-bridge';
import { getHermesToolCatalogForReview } from './tools/hermes-tool-catalog-bridge';
import { getHermesToolsetsForReview } from './tools/hermes-toolsets-bridge';
import {
  getHermesLearningLoopStatusForReview,
  runHermesLearningRunDoctorForReview,
  runHermesLearningRetrospectiveForReview,
} from './tools/hermes-learning-loop-bridge';
import { listLearningSkillUsageForReview } from './tools/learning-usage-bridge';
import {
  deleteSkillPackageForReview,
  listSkillPackagesForReview,
  patchSkillPackageForReview,
  rollbackSkillPackageForReview,
  resetSkillPackageForReview,
  setSkillPackageLifecycleForReview,
  updateSkillPackageForReview,
} from './tools/skill-package-manager-bridge';
import {
  installSkillCandidateForReview,
  listSkillCandidatesForReview,
} from './tools/skill-candidate-review-bridge';
import { buildLessonsVaultPreview } from './tools/lessons-vault-bridge';
import Module from 'module';
import { createRequire } from 'module';

// Intercept Module resolution for better-sqlite3 to redirect from the root node_modules to cowork's node_modules.
// Because the core database modules are resolved relative to the dist/ directory, Node's normal resolution walks up
// to the root node_modules instead of using cowork's Electron-compiled version.
type NodeModuleResolver = (
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
  options?: unknown
) => string;

const moduleWithResolver = Module as typeof Module & { _resolveFilename: NodeModuleResolver };
const originalResolveFilename = moduleWithResolver._resolveFilename;
moduleWithResolver._resolveFilename = function (
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
  options?: unknown
) {
  if (request === 'better-sqlite3') {
    try {
      const coworkRequire = createRequire(import.meta.url);
      const resolved = coworkRequire.resolve('better-sqlite3');
      return resolved;
    } catch (err) {
      // Fall back to original resolve if resolution fails
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const APP_NAME = 'Code Buddy Studio';

app.setName(APP_NAME);

// Current working directory (persisted between sessions)
let currentWorkingDir: string | null = null;

// Global error handlers for the PRIVILEGED process: an unhandled rejection or
// uncaught exception in main must land in the log file, never vanish (or take
// the app down silently). ~17 fire-and-forget `void <promise>` sites exist in
// this file alone — this is their backstop.
process.on('unhandledRejection', (reason) => {
  logError('[main] Unhandled promise rejection:', reason instanceof Error ? reason.stack ?? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  logError('[main] Uncaught exception:', err.stack ?? err.message);
});

// Load env files — precedence and rationale in env-files.ts.
for (const envPath of resolveEnvFileCandidates(__dirname, app.getPath('home'))) {
  const dotenvResult = config({ path: envPath });
  if (dotenvResult.error) {
    log('[dotenv] Skipped (not found):', envPath);
  } else {
    log('[dotenv] Loaded:', envPath);
  }
}

// Apply saved config (this overrides .env if config exists)
if (configStore.isConfigured()) {
  log('[Config] Applying saved configuration...');
  configStore.applyToEnv();
}

// Disable hardware acceleration for better compatibility
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;
let engineAdapter: EngineAdapterLike | undefined;
let sessionManager: SessionManager | null = null;
let skillsManager: SkillsManager | null = null;
let pluginRuntimeService: PluginRuntimeService | null = null;
let scheduledTaskManager: ScheduledTaskManager | null = null;
let projectManager: ProjectManager | null = null;
let subAgentBridge: SubAgentBridge | null = null;
let orchestratorBridge: OrchestratorBridge | null = null;
let fleetBridge: FleetBridge | null = null;
let scheduledFleetSagaRunner: {
  bridge: FleetBridge;
  activityFeed: ActivityFeed | null;
  runner: SagaRunner;
} | null = null;
let teamBridge: TeamBridge | null = null;
let mentionProcessor: MentionProcessor | null = null;
let slashCommandBridge: SlashCommandBridge | null = null;
let skillMdBridge: SkillMdBridge | null = null;
let mcpMarketplaceBridge: MCPMarketplaceBridge | null = null;
let costBridge: CostBridge | null = null;
let rulesBridge: RulesBridge | null = null;
let sessionBranchingBridge: SessionBranchingBridge | null = null;
let globalSearchService: GlobalSearchService | null = null;
let previewService: PreviewService | null = null;
let templateService: TemplateService | null = null;
let workflowBridge: WorkflowBridge | null = null;
let missionBridge: MissionBridge | null = null;
let voiceConversation: VoiceConversationSession | null = null;
let voiceBridge: VoiceBridge | null = null;
let ttsBridge: TTSBridge | null = null;
let kyutaiBridge: KyutaiBridge | null = null;
let clipboardWatcher: ClipboardWatcher | null = null;
let sessionExportService: SessionExportService | null = null;
let sessionInsightsBridge: SessionInsightsBridge | null = null;
let activityFeed: ActivityFeed | null = null;
let bookmarksService: BookmarksService | null = null;
let configExportService: ConfigExportService | null = null;
let knowledgeService: KnowledgeService | null = null;
let projectMemoryServiceRef: ProjectMemoryService | null = null;
let notificationBridge: NotificationBridge | null = null;
let icmIntegration: ICMIntegration | null = null;
let taskDispatch: TaskDispatch | null = null;

async function resolveScheduledTaskTitle(
  prompt: string,
  _cwd?: string,
  fallbackTitle?: string
): Promise<string> {
  const normalizedPrompt = prompt.trim();
  const fallback = fallbackTitle
    ? buildScheduledTaskTitle(fallbackTitle)
    : buildScheduledTaskFallbackTitle(normalizedPrompt);
  if (!sessionManager) {
    return fallback;
  }
  try {
    return await sessionManager.generateScheduledTaskTitle(normalizedPrompt);
  } catch (error) {
    logWarn('[Schedule] Failed to generate title via session title flow, using fallback', error);
    return fallback;
  }
}

function buildScheduledTaskActivityMetadata(
  task: ScheduledTask,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    taskId: task.id,
    taskTitle: task.title,
    cwd: task.cwd,
    scheduleKind: getScheduledTaskKind(task),
    nextRunAt: task.nextRunAt,
    ...buildScheduledTaskFleetMetadata(task.metadata),
    ...extra,
  };
}

function buildScheduledTaskFleetMetadata(
  metadata: ScheduledTask['metadata']
): Record<string, unknown> {
  if (!metadata) return {};
  const result: Record<string, unknown> = {};
  if (typeof metadata.source === 'string') result.source = metadata.source;
  if (
    metadata.agentRun &&
    typeof metadata.agentRun === 'object' &&
    !Array.isArray(metadata.agentRun)
  ) {
    result.agentRun = metadata.agentRun;
  }
  if (typeof metadata.agentRunId === 'string' && metadata.agentRunId.trim()) {
    result.agentRunId = metadata.agentRunId.trim();
  }
  if (
    typeof metadata.agentRunSchemaVersion === 'number' &&
    Number.isFinite(metadata.agentRunSchemaVersion)
  ) {
    result.agentRunSchemaVersion = metadata.agentRunSchemaVersion;
  }
  if (typeof metadata.parentRunId === 'string' && metadata.parentRunId.trim()) {
    result.parentRunId = metadata.parentRunId.trim();
  }
  if (typeof metadata.outcomeId === 'string' && metadata.outcomeId.trim()) {
    result.outcomeId = metadata.outcomeId.trim();
  }
  if (typeof metadata.scheduleTaskId === 'string' && metadata.scheduleTaskId.trim()) {
    result.scheduleTaskId = metadata.scheduleTaskId.trim();
  }
  if (typeof metadata.sourceSessionId === 'string' && metadata.sourceSessionId.trim()) {
    result.sourceSessionId = metadata.sourceSessionId.trim();
  }
  if (typeof metadata.dispatchProfile === 'string') {
    result.dispatchProfile = metadata.dispatchProfile;
  }
  if (typeof metadata.privacyTag === 'string') result.privacyTag = metadata.privacyTag;
  if (typeof metadata.parallelism === 'number') result.parallelism = metadata.parallelism;
  if (typeof metadata.peerCount === 'number') result.peerCount = metadata.peerCount;
  const targetPeerIds = metadataStringList(metadata.targetPeerIds);
  if (targetPeerIds.length > 0) result.targetPeerIds = targetPeerIds;
  if (typeof metadata.hermesPlanId === 'string' && metadata.hermesPlanId.trim()) {
    result.hermesPlanId = metadata.hermesPlanId.trim();
  }
  if (typeof metadata.hermesPlanProfile === 'string' && metadata.hermesPlanProfile.trim()) {
    result.hermesPlanProfile = metadata.hermesPlanProfile.trim();
  }
  if (typeof metadata.hermesPlanSurface === 'string' && metadata.hermesPlanSurface.trim()) {
    result.hermesPlanSurface = metadata.hermesPlanSurface.trim();
  }
  const targetPeerLabels = metadataStringList(metadata.targetPeerLabels);
  if (targetPeerLabels.length > 0) result.targetPeerLabels = targetPeerLabels;
  if (typeof metadata.deliveryChannel === 'string' && metadata.deliveryChannel.trim()) {
    result.deliveryChannel = metadata.deliveryChannel.trim();
  }
  if (typeof metadata.includeMemoryContext === 'boolean') {
    result.includeMemoryContext = metadata.includeMemoryContext;
  }
  if (typeof metadata.memoryCount === 'number') result.memoryCount = metadata.memoryCount;
  if (typeof metadata.internetProofStepCount === 'number') {
    result.internetProofStepCount = metadata.internetProofStepCount;
  }
  if (typeof metadata.internetProofRequiredCount === 'number') {
    result.internetProofRequiredCount = metadata.internetProofRequiredCount;
  }
  if (typeof metadata.internetProofAssertionCount === 'number') {
    result.internetProofAssertionCount = metadata.internetProofAssertionCount;
  }
  if (Array.isArray(metadata.internetProofTools)) {
    result.internetProofTools = metadata.internetProofTools;
  }
  if (Array.isArray(metadata.internetProofSteps)) {
    result.internetProofSteps = metadata.internetProofSteps;
  }
  return result;
}

function metadataStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
}

function buildScheduledTaskCreateMetadata(
  prompt: string,
  metadata: ScheduledTask['metadata'] | undefined
): ScheduledTask['metadata'] {
  if (!metadata || metadata.source !== 'fleet-command-center') {
    return metadata ?? null;
  }
  if (typeof metadata.internetProofStepCount === 'number') {
    return metadata;
  }

  const proofPlan = buildFleetInternetProofPlan(prompt);
  const proofSummary = summarizeInternetProofPlan(proofPlan);
  if (!proofSummary) return metadata;

  return {
    ...metadata,
    ...buildInternetProofSummaryMetadata(proofSummary),
  };
}

function getScheduledFleetSagaRunner(): SagaRunner | null {
  if (!fleetBridge) return null;
  if (
    !scheduledFleetSagaRunner ||
    scheduledFleetSagaRunner.bridge !== fleetBridge ||
    scheduledFleetSagaRunner.activityFeed !== activityFeed
  ) {
    scheduledFleetSagaRunner = {
      bridge: fleetBridge,
      activityFeed,
      // Same workDirResolver as the IPC runner (fleet-ipc.ts) — without it,
      // SCHEDULED council sagas never proposed lesson candidates.
      runner: new SagaRunner(fleetBridge, sendToRenderer, activityFeed, () =>
        resolveWorkDir(() => projectManager),
      ),
    };
  }
  return scheduledFleetSagaRunner.runner;
}

function buildScheduledFleetDispatchInput(task: ScheduledTask): FleetDispatchInput | null {
  const metadata = task.metadata;
  if (!metadata || metadata.source !== 'fleet-command-center') return null;

  const goal =
    scheduledMetadataString(metadata, 'dispatchGoal') ?? extractScheduledFleetGoal(task.prompt);
  if (!goal) return null;

  const profile = normalizeScheduledDispatchProfile(
    scheduledMetadataString(metadata, 'dispatchProfile')
  );
  const privacyTag = normalizeScheduledPrivacyTag(scheduledMetadataString(metadata, 'privacyTag'));
  const parallelism = scheduledMetadataNumber(metadata, 'parallelism');
  const targetPeerIds = metadataStringList(metadata.targetPeerIds);
  const targetPeerLabels = metadataStringList(metadata.targetPeerLabels);
  const memoryCount = scheduledMetadataNumber(metadata, 'memoryCount');
  const agentRunSchemaVersion = scheduledMetadataNumber(metadata, 'agentRunSchemaVersion');

  return {
    goal,
    dispatchProfile: profile,
    privacyTag,
    parallelism: parallelism !== null && parallelism > 1 ? parallelism : undefined,
    agentRunId: scheduledMetadataString(metadata, 'agentRunId') ?? undefined,
    agentRunSchemaVersion: agentRunSchemaVersion ?? undefined,
    parentRunId: scheduledMetadataString(metadata, 'parentRunId') ?? undefined,
    outcomeId: scheduledMetadataString(metadata, 'outcomeId') ?? undefined,
    scheduleTaskId: scheduledMetadataString(metadata, 'scheduleTaskId') ?? undefined,
    sourceSessionId: scheduledMetadataString(metadata, 'sourceSessionId') ?? undefined,
    deliveryChannel: scheduledMetadataString(metadata, 'deliveryChannel') ?? undefined,
    memoryCount: memoryCount ?? undefined,
    hermesPlanId: scheduledMetadataString(metadata, 'hermesPlanId') ?? undefined,
    hermesPlanProfile: scheduledMetadataString(metadata, 'hermesPlanProfile') ?? undefined,
    hermesPlanSurface: scheduledMetadataString(metadata, 'hermesPlanSurface') ?? undefined,
    targetPeerIds: targetPeerIds.length > 0 ? targetPeerIds : undefined,
    targetPeerLabels: targetPeerLabels.length > 0 ? targetPeerLabels : undefined,
  };
}

function extractScheduledFleetGoal(prompt: string): string | null {
  const normalizedLines = prompt.replace(/\r\n/g, '\n').split('\n');
  for (let index = normalizedLines.length - 1; index >= 0; index -= 1) {
    const line = normalizedLines[index].trim();
    const normalized = line
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (/^(goal|objectif|objet|目标|目標)\s*:/.test(normalized)) {
      const sameLineGoal = line.slice(line.indexOf(':') + 1).trim();
      const followingGoal = normalizedLines
        .slice(index + 1)
        .join('\n')
        .trim();
      return sameLineGoal || followingGoal || null;
    }
  }
  return prompt.trim() || null;
}

function scheduledMetadataString(metadata: ScheduledTaskMetadata, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function scheduledMetadataNumber(metadata: ScheduledTaskMetadata, key: string): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeScheduledDispatchProfile(
  value: string | null
): FleetDispatchInput['dispatchProfile'] {
  if (
    value === 'balanced' ||
    value === 'research' ||
    value === 'code' ||
    value === 'review' ||
    value === 'safe'
  ) {
    return value;
  }
  return undefined;
}

function normalizeScheduledPrivacyTag(value: string | null): FleetDispatchInput['privacyTag'] {
  if (value === 'public' || value === 'sensitive') {
    return value;
  }
  return undefined;
}

function getScheduledTaskKind(task: ScheduledTask): string {
  if (task.scheduleConfig?.kind === 'daily') return 'daily';
  if (task.scheduleConfig?.kind === 'weekly') return 'weekly';
  if (task.repeatEvery && task.repeatUnit) return `every-${task.repeatUnit}`;
  return 'once';
}

function shortActivityId(id: string): string {
  return id.length <= 10 ? id : id.slice(0, 8);
}

async function waitForDevServer(url: string, maxAttempts = 30, intervalMs = 500): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        if (attempt > 1) {
          log(`[App] Dev server ready after ${attempt} attempt(s): ${url}`);
        }
        return true;
      }
    } catch {
      // Ignore and retry until timeout
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  logWarn(`[App] Dev server did not become ready within timeout: ${url}`);
  return false;
}

// Single-instance lock: skip in dev mode so vite-plugin-electron can restart freely
// without the old process blocking the new one during async cleanup.
const isDev = !!process.env.VITE_DEV_SERVER_URL;
const isE2E = process.env.COWORK_E2E === '1';
const ELECTRON_DEVTOOLS_DEBUG_PORT = '9223';

// Enable Chrome DevTools Protocol in dev mode so the renderer can be inspected
// via chrome://inspect or connected to by Puppeteer/Playwright at localhost:9223.
// Chrome MCP uses 9222, so keep Electron on a separate port in development.
if (isDev) {
  app.commandLine.appendSwitch('remote-debugging-port', ELECTRON_DEVTOOLS_DEBUG_PORT);
  app.commandLine.appendSwitch(
    'remote-allow-origins',
    `http://localhost:${ELECTRON_DEVTOOLS_DEBUG_PORT}`
  );
}

const hasSingleInstanceLock = isDev || isE2E || app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  logWarn('[App] Another instance is already running, quitting this instance');
  app.quit();
} else if (!isDev && !isE2E) {
  app.on('second-instance', () => {
    const existingWindow =
      mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());

    if (!existingWindow) {
      log('[App] No existing window found, creating new one');
      createWindow();
      return;
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = existingWindow;
    }
    if (existingWindow.isMinimized()) {
      existingWindow.restore();
    }
    existingWindow.show();
    existingWindow.focus();
    log('[App] Blocked second instance and focused existing window');
  });
}

// Tray instance (kept alive to prevent GC)
let tray: Tray | null = null;
const DARK_BG = '#171614';
const LIGHT_BG = '#f5f3ee';

function buildMacMenu() {
  if (process.platform !== 'darwin') return;

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences…',
          accelerator: 'CmdOrCtrl+,',
          click: () =>
            mainWindow?.webContents.send('server-event', { type: 'navigate', payload: 'settings' }),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }, { type: 'separator' }, { role: 'front' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupTray() {
  if (tray) return;

  // Use .ico on Windows for proper multi-resolution tray support; fall back to .png if absent
  const iconName =
    process.platform === 'darwin'
      ? 'tray-iconTemplate.png'
      : process.platform === 'win32'
        ? 'tray-icon.ico'
        : 'tray-icon.png';
  // tray-icon.ico is generated from tray-icon.png by scripts/build-tray-icon.js
  // (run as part of `npm run build` and available as `npm run build:tray-icon`).
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, iconName)
    : join(__dirname, '../../resources', iconName);

  // On Windows, fall back to .png if the .ico file has not been created yet
  const resolvedIconPath =
    process.platform === 'win32' && !fs.existsSync(iconPath)
      ? app.isPackaged
        ? join(process.resourcesPath, 'tray-icon.png')
        : join(__dirname, '../../resources', 'tray-icon.png')
      : iconPath;

  // Gracefully skip tray if icon is missing (e.g. dev environment).
  // The dev path (`resources/tray-icon.png`) is gitignored on Linux
  // dev machines — only the packaged build ships the asset. Skipping
  // is expected in dev and silently no-ops; in packaged mode it IS a
  // build/install problem worth surfacing as an info-level warning.
  if (!fs.existsSync(resolvedIconPath)) {
    if (app.isPackaged) {
      log('[Tray] Icon not found at', resolvedIconPath, '— skipping tray setup');
    }
    return;
  }

  tray = new Tray(resolvedIconPath);
  setTray(tray); // Same pattern as setMainWindow — keeps getTray() in sync.
  tray.setToolTip(APP_NAME);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show / Hide Window',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          createWindow();
        } else if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'New Session',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('server-event', { type: 'new-session' });
        }
      },
    },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('server-event', { type: 'navigate', payload: 'settings' });
        }
      },
    },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getSavedThemePreference(): AppTheme {
  const theme = configStore.get('theme');
  return theme === 'dark' || theme === 'system' ? theme : 'light';
}

function resolveEffectiveTheme(theme: AppTheme): 'dark' | 'light' {
  if (theme === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }
  // Named custom themes map to a dark/light base for native chrome.
  return theme === 'light' || theme === 'anthropic' ? 'light' : 'dark';
}

function applyNativeThemePreference(theme: AppTheme): void {
  nativeTheme.themeSource = theme === 'system' ? 'system' : resolveEffectiveTheme(theme);
}

function createWindow() {
  const savedTheme = getSavedThemePreference();
  applyNativeThemePreference(savedTheme);
  const effectiveTheme = resolveEffectiveTheme(savedTheme);
  const THEME =
    effectiveTheme === 'dark'
      ? {
          background: DARK_BG,
          titleBar: DARK_BG,
          titleBarSymbol: '#f1ece4',
        }
      : {
          background: LIGHT_BG,
          titleBar: LIGHT_BG,
          titleBarSymbol: '#1a1a1a',
        };

  // Platform-specific window configuration
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';

  // Base window options
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: THEME.background,
    icon: (() => {
      const windowIconName = isMac ? 'icon.icns' : isWindows ? 'icon.ico' : 'icon.png';
      return app.isPackaged
        ? join(process.resourcesPath, windowIconName)
        : join(__dirname, `../../resources/${windowIconName}`);
    })(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
    },
  };

  if (isMac) {
    // macOS: Use hiddenInset for native traffic light buttons
    windowOptions.titleBarStyle = 'hiddenInset';
    windowOptions.trafficLightPosition = { x: 16, y: 12 };
  } else if (isWindows) {
    // Windows: Use frameless window with custom titlebar
    // Note: frame: false removes native frame, allowing custom titlebar
    windowOptions.frame = false;
  } else {
    // Linux: Use frameless window
    windowOptions.frame = false;
  }

  mainWindow = new BrowserWindow(windowOptions);
  // Register the canonical mainWindow with `window-management.ts` so
  // `getMainWindow()` (used by `ipc-main-bridge.ts:sendToRenderer`)
  // returns this instance — without this every IPC event was dropped.
  setMainWindow(mainWindow);

  const allowedOrigins = new Set<string>();
  if (process.env.VITE_DEV_SERVER_URL) {
    try {
      allowedOrigins.add(new URL(process.env.VITE_DEV_SERVER_URL).origin);
    } catch {
      // 忽略无效的开发服务地址
    }
  }
  const allowedProtocols = new Set<string>(['file:', 'devtools:']);

  const isExternalUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      if (allowedProtocols.has(parsed.protocol)) {
        return false;
      }
      if (allowedOrigins.has(parsed.origin)) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  };

  const extractLocalPathFromNavigationUrl = (url: string): string | null => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'file:') {
        return localPathFromFileUrl(url);
      }
      if (!allowedOrigins.has(parsed.origin)) {
        return null;
      }
      return localPathFromAppUrlPathname(parsed.pathname || '');
    } catch {
      return null;
    }
  };

  async function revealNavigationTarget(url: string): Promise<boolean> {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (!localPath) {
      return false;
    }
    return revealFileInFolder(localPath);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (localPath) {
      void revealNavigationTarget(url);
      return { action: 'deny' };
    }
    if (isExternalUrl(url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const localPath = extractLocalPathFromNavigationUrl(url);
    if (localPath) {
      event.preventDefault();
      void revealNavigationTarget(url);
      return;
    }
    if (isExternalUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    void (async () => {
      await waitForDevServer(devServerUrl, 40, 500);
      if (!mainWindow || mainWindow.isDestroyed()) return;

      try {
        await mainWindow.loadURL(devServerUrl);
      } catch (error) {
        logError('[App] Failed to load dev server URL:', error);
      }
    })();
    // mainWindow.webContents.openDevTools(); // Commented out - open manually with Cmd+Option+I if needed
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  }
  // Auto-open DevTools only in a real dev session (vite dev server present) or when
  // explicitly opted in via COWORK_DEVTOOLS=1 — never merely because NODE_ENV happens
  // to be 'development', which could leak DevTools into a packaged release build.
  if ((isDev || process.env.COWORK_DEVTOOLS === '1') && mainWindow) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    setMainWindow(null);
  });

  // Register Panic Stop Shortcut
  mainWindow.on('focus', () => {
    globalShortcut.register('CommandOrControl+Alt+S', () => {
      logWarn('[App] Panic Stop shortcut triggered!');
      if (mainWindow) {
        sendToRenderer({ type: 'panic-stop', payload: {} });
      }
    });
  });
  mainWindow.on('blur', () => {
    globalShortcut.unregister('CommandOrControl+Alt+S');
  });

  // Notify renderer about config status after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    const isConfigured = configStore.isConfigured();
    log('[Config] Notifying renderer, isConfigured:', isConfigured);
    sendToRenderer({
      type: 'config.status',
      payload: {
        isConfigured,
        config: configStore.getAll(),
      },
    });

    // Send current working directory to renderer
    sendToRenderer({
      type: 'workdir.changed',
      payload: { path: currentWorkingDir || '' },
    });

    // Start sandbox bootstrap after window is loaded
    startSandboxBootstrap();
  });
}

/**
 * Initialize default working directory
 * This is always the app's default_working_dir in userData - it never changes
 * Each session can have its own cwd that differs from this default
 */
function initializeDefaultWorkingDir(): string {
  // Create default working directory in user data path (this is the permanent global default)
  const userDataPath = app.getPath('userData');
  const defaultDir = join(userDataPath, 'default_working_dir');

  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
    log('[App] Created default working directory:', defaultDir);
  }

  currentWorkingDir = defaultDir;

  log('[App] Global default working directory:', currentWorkingDir);
  return currentWorkingDir;
}

/**
 * Get current working directory
 */
function getWorkingDir(): string | null {
  return currentWorkingDir;
}

function getWorkspacePathUnsupportedReason(workspacePath?: string): string | null {
  return getUnsupportedWorkspacePathReason({
    platform: process.platform,
    sandboxEnabled: configStore.get('sandboxEnabled') !== false,
    workspacePath,
  });
}

/**
 * Set working directory
 * - If sessionId is provided: update only that session's cwd (for switching directories within a chat)
 * - If no sessionId: update UI display only (for WelcomeView - will be used when creating new session)
 *
 * Note: The global default (currentWorkingDir) is NEVER changed after initialization.
 * It is always app.getPath('userData')/default_working_dir
 */
async function setWorkingDir(
  newDir: string,
  sessionId?: string
): Promise<{ success: boolean; path: string; error?: string }> {
  const unsupportedReason = getWorkspacePathUnsupportedReason(newDir);
  if (unsupportedReason) {
    return { success: false, path: newDir, error: unsupportedReason };
  }

  if (!fs.existsSync(newDir)) {
    return { success: false, path: newDir, error: 'Directory does not exist' };
  }

  if (sessionId && sessionManager) {
    // Update only this session's cwd - don't change the global default
    log('[App] Updating session cwd:', sessionId, '->', newDir);
    sessionManager.updateSessionCwd(sessionId, newDir);

    // Clear this session's sandbox mapping so next query uses the new directory
    SandboxSync.clearSession(sessionId);
    const { LimaSync } = await import('./sandbox/lima-sync');
    LimaSync.clearSession(sessionId);
  }

  // Notify renderer of workdir change (for UI display)
  // This updates what the user sees, and will be passed to startSession for new sessions
  sendToRenderer({
    type: 'workdir.changed',
    payload: { path: newDir },
  });

  // Sync persona bridge workspace so identity lookups follow the active cwd
  try {
    const { getIdentityBridge } = await import('./identity/identity-bridge');
    const bridge = getIdentityBridge();
    if (!(bridge as unknown as { _coworkListenerBound?: boolean })._coworkListenerBound) {
      bridge.on('personas:updated', (entries) => {
        sendToRenderer({ type: 'identity.updated', payload: entries });
      });
      bridge.on('personas:activated', (entry) => {
        sendToRenderer({ type: 'identity.activated', payload: entry });
      });
      (bridge as unknown as { _coworkListenerBound?: boolean })._coworkListenerBound = true;
    }
    bridge.setWorkspace(newDir);
  } catch (err) {
    logWarn('[App] identity bridge workspace sync failed:', err);
  }

  // Sync hooks bridge workspace
  try {
    const { getHooksBridge } = await import('./hooks/hooks-bridge');
    getHooksBridge().setWorkspace(newDir);
  } catch (err) {
    logWarn('[App] hooks bridge workspace sync failed:', err);
  }

  // Sync test runner workspace + event forwarding
  try {
    const { getTestRunnerBridge } = await import('./testing/test-runner-bridge');
    const bridge = getTestRunnerBridge();
    if (!(bridge as unknown as { _coworkListenerBound?: boolean })._coworkListenerBound) {
      bridge.on('test.framework', (p) => sendToRenderer({ type: 'test.framework', payload: p }));
      bridge.on('test.start', (p) => sendToRenderer({ type: 'test.start', payload: p }));
      bridge.on('test.output', (p) => sendToRenderer({ type: 'test.output', payload: p }));
      bridge.on('test.complete', (p) => sendToRenderer({ type: 'test.complete', payload: p }));
      bridge.on('test.cancelled', () => sendToRenderer({ type: 'test.cancelled', payload: null }));
      (bridge as unknown as { _coworkListenerBound?: boolean })._coworkListenerBound = true;
    }
    bridge.setWorkspace(newDir);
  } catch (err) {
    logWarn('[App] test runner workspace sync failed:', err);
  }

  log(
    '[App] Working directory for UI updated:',
    newDir,
    sessionId ? `(session: ${sessionId})` : '(pending new session)'
  );

  return { success: true, path: newDir };
}

/**
 * Start sandbox bootstrap in the background
 * This pre-initializes WSL/Lima environment at app startup
 */
async function startSandboxBootstrap(): Promise<void> {
  // Skip sandbox bootstrap if disabled - use native mode directly
  const sandboxEnabled = configStore.get('sandboxEnabled');
  if (sandboxEnabled === false) {
    log('[App] Sandbox disabled, skipping bootstrap (using native mode)');
    return;
  }

  const bootstrap = getSandboxBootstrap();

  // Skip if already complete
  if (bootstrap.isComplete()) {
    log('[App] Sandbox bootstrap already complete');
    return;
  }

  // Set up progress callback to notify renderer
  bootstrap.setProgressCallback((progress) => {
    sendToRenderer({
      type: 'sandbox.progress',
      payload: progress,
    });
  });

  // Start bootstrap (non-blocking)
  log('[App] Starting sandbox bootstrap...');
  try {
    const result = await bootstrap.bootstrap();
    log('[App] Sandbox bootstrap complete:', result.mode);
  } catch (error) {
    logError('[App] Sandbox bootstrap error:', error);
  }
}

import { sendToRenderer } from './ipc-main-bridge';
import { remoteBackendManager } from './remote-backend/remote-backend-manager';
import { remoteBackendConfigStore } from './remote-backend/remote-backend-config-store';

// Wire the remote backend manager: repipe ServerEvents through the same
// channel the renderer already listens on, and push status changes on a
// dedicated channel.
remoteBackendManager.init({
  sendServerEvent: (event) => sendToRenderer(event),
  sendStatus: (status) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('remote-backend:status', status);
    }
  },
});

// Initialize app
app
  .whenReady()
  .then(async () => {
    // Grant microphone access by default — without this, the renderer's
    // `navigator.mediaDevices.getUserMedia({audio: true})` rejects
    // silently and the MicButton (Phase 8 voice) appears stuck on
    // click. The user already implicitly authorised the mic when they
    // installed Cowork; the OS still gates physical access at the
    // audio-capture layer, so this is purely about Electron's own
    // intra-process permission gate.
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      // Electron's union for request-side permission includes
      // 'media' (covers both audio + video capture in one bucket).
      // Older Electrons also expose 'audioCapture' separately so we
      // accept both via a permissive cast.
      const p = permission as string;
      if (p === 'media' || p === 'audioCapture') {
        callback(true);
        return;
      }
      callback(false);
    });
    // Electron 11+ also queries via setPermissionCheckHandler before
    // actually firing the request — both must agree for getUserMedia
    // to succeed. The check-side union is slightly different from the
    // request-side; same permissive cast.
    session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
      const p = permission as string;
      return p === 'media' || p === 'audioCapture';
    });

    // Apply dev logs setting from config
    const enableDevLogs = configStore.get('enableDevLogs');
    setDevLogsEnabled(enableDevLogs);

    // Log environment variables for debugging
    log(`=== ${APP_NAME} Starting ===`);
    log('Config file:', configStore.getPath());
    log('Is configured:', configStore.isConfigured());
    log('Developer logs:', enableDevLogs ? 'Enabled' : 'Disabled');
    log('Environment Variables:');
    log('  ANTHROPIC_AUTH_TOKEN:', process.env.ANTHROPIC_AUTH_TOKEN ? '✓ Set' : '✗ Not set');
    log('  ANTHROPIC_BASE_URL:', process.env.ANTHROPIC_BASE_URL || '(not set)');
    log('  CLAUDE_MODEL:', process.env.CLAUDE_MODEL || '(not set)');
    log('  CLAUDE_CODE_PATH:', process.env.CLAUDE_CODE_PATH || '(not set)');
    log('  OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Not set');
    log('  OPENAI_BASE_URL:', process.env.OPENAI_BASE_URL || '(not set)');
    log('  OPENAI_MODEL:', process.env.OPENAI_MODEL || '(not set)');
    log('  OPENAI_API_MODE:', process.env.OPENAI_API_MODE || '(default)');
    log('===========================');

    // Initialize default working directory
    initializeDefaultWorkingDir();
    log('Working directory:', currentWorkingDir);
    // 远程会话默认使用全局工作目录
    remoteManager.setDefaultWorkingDirectory(currentWorkingDir || undefined);

    // Initialize database
    const db = initDatabase();

    pluginRuntimeService = new PluginRuntimeService(new PluginCatalogService());

    // Initialize Code Buddy engine adapter (embedded mode).
    //
    // Default-on: we attempt to load the engine unless the user has
    // explicitly opted out with `CODEBUDDY_EMBEDDED=0`. See
    // `engine/embedded-mode.ts` for the rationale (previously every
    // entry point other than `buddy gui` silently fell back to the
    // pi-coding-agent runner).
    engineAdapter = undefined;
    const userEngineMode = configStore.getAll().coreEngineMode ?? 'auto';
    if (!shouldLoadEngine(userEngineMode)) {
      const reason =
        userEngineMode === 'force-off'
          ? 'user setting (Settings → Advanced → Code Buddy core engine = "Always off")'
          : 'CODEBUDDY_EMBEDDED=0 env opt-out';
      log(`[Main] embedded engine disabled (${reason})`);
    } else {
      // Packaged-aware resolution: extraResources copies the engine to
      // `<install>/resources/dist/desktop/` (see electron-builder.yml),
      // while dev mode keeps it at `<repo>/dist/desktop/` next to cowork.
      // The diagnostic form gives us `{ path, layer }` so a failed
      // load can be diagnosed from a single startup line — see the
      // catch handler below.
      // `import.meta.url` of the main bundle is preferred over
      // `app.getAppPath()` for dev resolution: it's stable regardless of
      // how Electron was invoked, including direct binary launch with
      // an explicit file argument (where `app.getAppPath()` points at
      // the file's dir instead of cowork/).
      const mainBundleDir = (() => {
        try {
          return dirname(fileURLToPath(import.meta.url));
        } catch {
          return undefined;
        }
      })();
      const engineResolution = resolveEnginePathWithDiagnostic({
        envOverride: process.env.CODEBUDDY_ENGINE_PATH,
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        appPath: app.getAppPath(),
        mainBundleDir,
      });
      log(
        `[Main] Resolving Code Buddy engine: layer=${engineResolution.layer} path=${engineResolution.path}`
      );
      try {
        // Node's ESM loader on Windows REQUIRES file:// URLs for absolute
        // paths (`d:\...` is rejected with ERR_UNSUPPORTED_ESM_URL_SCHEME).
        // pathToFileURL produces a cross-platform-safe `file:///D:/...`
        // form that the loader accepts on every platform.
        const adapterUrl = pathToFileURL(
          resolve(engineResolution.path, 'desktop', 'codebuddy-engine-adapter.js')
        ).href;
        const { CodeBuddyEngineAdapter } = await import(
          /* webpackIgnore: true */ /* @vite-ignore */ adapterUrl
        );
        // Apply the Cowork-selected Code Buddy profile to the engine's config
        // singleton BEFORE the adapter is constructed, so the agent boots with
        // the profile's overrides. Import toml-config from the SAME engine path
        // as the adapter to share the module singleton (a different import path
        // would mutate a different ConfigManager instance). applyProfile throws
        // if the profile is undefined, so guard + log without blocking boot.
        try {
          const activeProfile = readActiveProfile();
          if (activeProfile) {
            const tomlUrl = pathToFileURL(
              resolve(engineResolution.path, 'config', 'toml-config.js')
            ).href;
            const tomlMod = (await import(
              /* webpackIgnore: true */ /* @vite-ignore */ tomlUrl
            )) as { getConfigManager?: () => { applyProfile?: (name: string) => void } };
            tomlMod.getConfigManager?.().applyProfile?.(activeProfile);
            log(`[engine] applied Code Buddy profile "${activeProfile}"`);
          }
        } catch (err) {
          logError(`[engine] failed to apply active profile: ${err instanceof Error ? err.message : String(err)}`);
        }
        const apiConfig = configStore.getAll();
        const runtimeConfig = resolveEngineRuntimeConfig(apiConfig);
        engineAdapter = new CodeBuddyEngineAdapter({
          apiKey: runtimeConfig.apiKey || process.env.GROK_API_KEY || '',
          baseURL: runtimeConfig.baseURL || process.env.GROK_BASE_URL,
          model: runtimeConfig.model,
          workingDirectory: currentWorkingDir || process.cwd(),
          embedded: true,
        }) as EngineAdapterLike;
        // Wire permission bridge for engine tool approvals
        try {
          const permBridgeUrl = pathToFileURL(
            resolve(engineResolution.path, 'desktop', 'permission-bridge.js')
          ).href;
          const { DesktopPermissionBridge } = await import(
            /* webpackIgnore: true */ /* @vite-ignore */ permBridgeUrl
          );
          const permissionBridge = new DesktopPermissionBridge(sendToRenderer);
          const adapterWithPerm = engineAdapter as unknown as {
            setPermissionCallback?: (cb: unknown) => void;
          };
          if (typeof adapterWithPerm.setPermissionCallback === 'function') {
            // Detailed variant: the user's optional denial reason travels back
            // to the agent as confirmation feedback (Hermes /deny parity).
            adapterWithPerm.setPermissionCallback(
              permissionBridge.requestPermissionDetailed.bind(permissionBridge)
            );
          }

          // Handle permission responses from renderer
          ipcMain.on(
            'permission.bridge.response',
            (_event, { id, response, reason }: { id: string; response: string; reason?: string }) => {
              permissionBridge.handleResponse(id, response as 'allow' | 'deny' | 'allow_always', reason);
            }
          );

          log('[Main] Permission bridge wired to engine adapter');
        } catch (permErr) {
          logWarn('[Main] Failed to wire permission bridge:', permErr);
        }

        // Apply the user's persisted "Gemini Google Search grounding"
        // preference, if any. No-op when the user hasn't touched the
        // toggle (apiConfig.codebuddy?.geminiGroundingEnabled === undefined)
        // and when the adapter doesn't expose the method (defensive).
        if (apiConfig.codebuddy?.geminiGroundingEnabled === true) {
          const result = applyGroundingToggle(engineAdapter, true);
          if (result.ok) {
            log('[Main] Gemini Google Search grounding enabled by user setting');
          } else {
            log(
              `[Main] Gemini grounding toggle saved but not applied (reason: ${result.reason ?? 'unknown'})`
            );
          }
        }

        // Apply the user's persisted "Visual Grounding Fallback" preference, if any.
        if (apiConfig.codebuddy?.visionGroundingEnabled === true) {
          const result = applyVisionGroundingSetting(
            engineAdapter,
            true,
            apiConfig.codebuddy?.visionGroundingModel
          );
          if (result.ok) {
            log('[Main] Visual grounding fallback enabled by user setting');
          } else {
            log(
              `[Main] Visual grounding fallback saved but not applied (reason: ${result.reason ?? 'unknown'})`
            );
          }
        }

        // Apply the user's persisted reasoning/thinking level so the engine
        // honors it from boot (not just on later changes via the picker).
        if (typeof engineAdapter.setThinkingLevel === 'function') {
          await engineAdapter.setThinkingLevel(configStore.get('thinkingLevel'));
        }

        log('[Main] Code Buddy engine adapter initialized (embedded mode)');
      } catch (err) {
        if (classifyEngineLoadError(err) === 'missing') {
          logWarn(
            `[Main] Code Buddy engine not present at ${engineResolution.path}/desktop/codebuddy-engine-adapter.js ` +
              `(layer=${engineResolution.layer}). Falling back to the reduced pi-coding-agent runner ` +
              `(loses middlewares, output sanitizer, MCP runtime sync, model/skills hot-swap). ` +
              `Fix: run \`npx tsc -p .\` at the repo root to build the core, ` +
              `or set CODEBUDDY_ENGINE_PATH=/path/to/dist to point elsewhere.`
          );
        } else {
          logWarn('[Main] Failed to load Code Buddy engine, falling back to pi-coding-agent:', err);
        }
      }
    }

    // Fleet Council — wire the result-aggregator to a real LLM client so
    // consensus dispatch actually arbitrates the N peer answers (instead of a
    // labelled concat). Runs regardless of the embedded engine: the Council
    // executes in this main process via saga-runner. Best-effort.
    void wireFleetAggregator(configStore);
    const darkstarBootstrap = await bootstrapDarkstarNetworkModel(process.env);
    if (darkstarBootstrap.applied) {
      log('[main] Darkstar network model bootstrapped:', darkstarBootstrap.model, darkstarBootstrap.baseUrl);
    } else {
      log('[main] Darkstar network model bootstrap skipped:', darkstarBootstrap.reason);
    }

    // Single source of truth for which runtime is in use. Logged AFTER
    // the load attempt so it never contradicts the engine init log
    // above (an earlier "[Runtime] Using pi-coding-agent SDK..." line
    // sat right at the top of the boot, before the engine had even
    // been tried — confusing).
    if (engineAdapter) {
      log('[Runtime] Using Code Buddy engine (embedded)');
    } else {
      log('[Runtime] Using pi-coding-agent runner (engine not loaded)');
    }

    // Hot-apply IPC for the user's "Gemini Google Search grounding"
    // toggle. Registered unconditionally so the renderer can call it
    // even when the embedded engine isn't loaded — the helper returns
    // {ok:false, reason} and the UI can degrade gracefully. The toggle
    // is also persisted to config-store, so the preference survives a
    // restart even when the hot-apply path is a no-op.
    ipcMain.handle(
      'codebuddy:set-gemini-grounding',
      async (_event, payload: { enabled: boolean }) => {
        return applyGroundingToggle(engineAdapter, payload.enabled === true);
      }
    );

    // Hot-apply IPC for visual grounding fallback toggle and model.
    ipcMain.handle(
      'codebuddy:set-vision-grounding',
      async (_event, payload: { enabled: boolean; model?: string }) => {
        return applyVisionGroundingSetting(engineAdapter, payload.enabled === true, payload.model);
      }
    );

    ipcMain.handle(
      'codebuddy:list-models',
      async (_event, payload: CodeBuddyDiscoveryInput) => {
        return listCodeBuddyModels(payload);
      }
    );

    ipcMain.handle(
      'codebuddy:probe-connection',
      async (_event, payload: CodeBuddyDiscoveryInput) => {
        return probeCodeBuddyConnection(payload);
      }
    );

    // Initialize session manager before creating an interactive window.
    // This avoids session.start racing the startup path and hitting a null manager.
    sessionManager = new SessionManager(db, sendToRenderer, pluginRuntimeService, engineAdapter);

    // Cowork is a trusted local GUI driving a headless engine: auto-approve tool
    // operations so the agent's own bash/file work — e.g. running the bundled
    // Python to draw a chart — doesn't fail with "Approval requires an interactive
    // terminal" (there is no TTY in the embedded engine) and trigger a jarring
    // auto-repair loop. Safety is unchanged: the command-validator still hard-blocks
    // dangerous patterns (rm/dd/chmod/curl/sh/eval…) and the user's permission mode
    // (e.g. plan = read-only, set via Settings) is still checked first.
    try {
      const confirmMod = await loadCoreModule<{
        ConfirmationService: { getInstance(): { setSessionFlag(flag: string, value: boolean): void } };
      }>('utils/confirmation-service.js');
      confirmMod?.ConfirmationService.getInstance().setSessionFlag('allOperations', true);
      log('[main] Embedded engine: auto-approving tool operations (trusted local GUI)');
    } catch (err) {
      log('[main] Failed to configure embedded auto-approve:', err);
    }

    const recovery = sessionManager.recoverFromTurnJournals();
    if (recovery.sessionsChanged > 0 || recovery.errors > 0) {
      log('[main] Turn journal startup recovery:', recovery);
    }

    // Initialize ProjectManager for Claude Cowork parity
    projectManager = new ProjectManager(db);
    projectManager.setProjectChangeListener((project) => {
      sendToRenderer({
        type: 'project.activeChanged',
        payload: { projectId: project?.id ?? null },
      });
    });

    // Wire project memory service into session manager
    const projectMemoryService = new ProjectMemoryService(projectManager);
    projectMemoryServiceRef = projectMemoryService;
    sessionManager.setProjectServices(projectManager, projectMemoryService);
    sessionManager.recoverQueuedPromptsFromTurnJournals();

    // Initialize sub-agent bridge (Claude Cowork parity)
    subAgentBridge = new SubAgentBridge(sendToRenderer);
    void subAgentBridge.init();

    // Initialize orchestrator bridge for multi-agent workflows
    orchestratorBridge = new OrchestratorBridge(
      sendToRenderer,
      () => configStore.get('apiKey') || process.env.GROK_API_KEY || '',
      () => configStore.get('baseUrl') || process.env.GROK_BASE_URL,
      () => configStore.get('model') || process.env.GROK_MODEL
    );

    // Initialize fleet bridge — multi-host Code Buddy listener (GAP 3)
    fleetBridge = new FleetBridge(sendToRenderer);
    void fleetBridge.init();

    // (W6) Schedule Tailscale + manual YAML discovery at boot and
    // every 5 minutes thereafter. Newly-detected peers are emitted as
    // `fleet.peer.discovered` events; the UI shows a confirm modal.
    void scheduleFleetDiscovery();

    // Initialize team bridge — Phase 4 layer 9 (Agent Teams observability)
    teamBridge = new TeamBridge(sendToRenderer);
    void teamBridge.init();

    // Initialize A2A bridge with sendToRenderer so async task updates
    // (GAP 1 polling) can reach the renderer. Lazy `getA2ABridge()` calls
    // elsewhere will return this instance.
    {
      const { getA2ABridge: bootA2A } = await import('./a2a/a2a-bridge');
      bootA2A(sendToRenderer);
    }

    // Initialize mention processor (Claude Cowork parity)
    mentionProcessor = new MentionProcessor();
    sessionManager.setMentionProcessor(mentionProcessor);

    slashCommandBridge = new SlashCommandBridge();
    skillMdBridge = new SkillMdBridge();
    costBridge = new CostBridge(db);
    rulesBridge = new RulesBridge();
    sessionBranchingBridge = new SessionBranchingBridge();

    // MCP marketplace bridge — wired to the live config store + running manager.
    mcpMarketplaceBridge = new MCPMarketplaceBridge();
    mcpMarketplaceBridge.configure({
      listInstalledServers: () => mcpConfigStore.getServers(),
      saveServer: async (config) => {
        mcpConfigStore.saveServer(config as MCPServerConfig);
        const mgr = sessionManager?.getMCPManager();
        if (mgr) {
          try {
            await mgr.updateServer(config as MCPServerConfig);
            sessionManager?.invalidateMcpServersCache();
          } catch (err) {
            logError('[MCP Marketplace] updateServer failed:', err);
            mcpConfigStore.saveServer({
              ...(config as MCPServerConfig),
              enabled: false,
            });
            throw err;
          }
        }
      },
      deleteServer: async (serverId) => {
        mcpConfigStore.deleteServer(serverId);
        const mgr = sessionManager?.getMCPManager();
        if (mgr) {
          try {
            await mgr.removeServer(serverId);
            sessionManager?.invalidateMcpServersCache();
          } catch (err) {
            logError('[MCP Marketplace] removeServer failed:', err);
          }
        }
      },
      updateServer: async (config) => {
        mcpConfigStore.saveServer(config as MCPServerConfig);
        const mgr = sessionManager?.getMCPManager();
        if (mgr) {
          try {
            await mgr.updateServer(config as MCPServerConfig);
            sessionManager?.invalidateMcpServersCache();
          } catch (err) {
            logError('[MCP Marketplace] updateServer (toggle) failed:', err);
            throw err;
          }
        }
      },
      listTools: () => {
        const mgr = sessionManager?.getMCPManager();
        if (!mgr) return [];
        const tools = mgr.getTools();
        return tools.map(
          (t: {
            name: string;
            description?: string;
            serverId?: string;
            serverName?: string;
            inputSchema?: unknown;
          }) => ({
            name: t.name,
            description: t.description,
            serverId: t.serverId ?? '',
            serverName: t.serverName,
            inputSchema: t.inputSchema,
          })
        );
      },
      expandArgs: (args) => {
        // Expand {WORKSPACE} placeholder to the currently active project
        const activeProject = projectManager?.getActive();
        const workspace = activeProject?.workspacePath ?? process.cwd();
        return args.map((arg) => arg.replace(/\{WORKSPACE\}/g, workspace));
      },
      // Phase 3 step 7: MCP tool playground
      callTool: async (toolName: string, toolArgs: Record<string, unknown>) => {
        const mgr = sessionManager?.getMCPManager();
        if (!mgr) throw new Error('MCP manager not available');
        return mgr.callTool(toolName, toolArgs);
      },
    });

    // Initialize knowledge service (Claude Cowork parity)
    knowledgeService = new KnowledgeService();

    // Initialize presence bridge (face memory). Lazy-imported because the
    // chain of presence-bridge -> face-recognizer -> onnxruntime-node loads
    // a native binding we don't want eager on Cowork startup. The bridge
    // simply registers IPC handlers; encoder load is deferred to first call.
    const { getPresenceBridge } = await import('./presence/presence-bridge');
    const presenceBridge = getPresenceBridge();
    log('[main] PresenceBridge initialized — IPC handlers presence:* active');

    // Forward bridge events (detected/left/unknown/enrolled) to every
    // renderer window so the titlebar PresenceIndicator can show live
    // identity. The bridge already throttles via PRESENCE_DEDUP_WINDOW_MS
    // so we don't need to debounce here.
    presenceBridge.on('presence', (event) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('presence:event', event);
        }
      }
    });

    // Global search wires existing project services for cross-source queries.
    globalSearchService = new GlobalSearchService({
      db,
      projectManager,
      knowledgeService,
      projectMemoryService: projectMemoryServiceRef,
    });

    // File preview service — wraps core PDFTool, detects mime, returns text/image/binary.
    previewService = new PreviewService();

    // Project templates — wraps SKILL.md starter packs from the core registry.
    if (skillMdBridge) {
      templateService = new TemplateService(skillMdBridge);
    }

    // Workflow bridge — visual editor + execution.
    // The bridge needs `sendToRenderer` so it can stream `workflow.event`
    // and `workflow.approval_required` events back to the UI during a run.
    workflowBridge = new WorkflowBridge();
    workflowBridge.setSendToRenderer(sendToRenderer);

    // Mission Orchestrator — pure bridge, surfaced through mission.* IPC.
    missionBridge = new MissionBridge({ sendToRenderer });
    void missionBridge.init().catch((err) => {
      logError('[MissionBridge] init failed:', err);
    });

    // Voice bridge — lazy-spawned faster-whisper worker. The model is
    // loaded on first transcription, not at boot, so cold-start UX is
    // unaffected if the user never clicks the mic.
    voiceConversation = new VoiceConversationSession();
    voiceBridge = new VoiceBridge();
    // Optional Kyutai DSM streaming voice path. It is inert unless
    // COWORK_STT_PROVIDER / COWORK_TTS_PROVIDER / COWORK_VOICE_PROVIDER
    // is set to "kyutai" (or "dsm"/"moshi").
    kyutaiBridge = new KyutaiBridge();
    // TTS bridge — Piper + fr_FR voice. Boots fast (no model load
    // until first synthesize), so always-on is fine. Override paths
    // via COWORK_PIPER_BIN / COWORK_PIPER_VOICE env vars.
    ttsBridge = new TTSBridge();
    // Clipboard summariser (Lisa-derived). Created always; only
    // starts polling when user enables it via Settings.
    clipboardWatcher = new ClipboardWatcher();
    clipboardWatcher.setSendToRenderer(sendToRenderer);
    if (configStore.getAll().clipboard?.monitoringEnabled) {
      clipboardWatcher.start();
    }

    // Session export — enhanced formats (markdown/json/html) with redaction
    const sessionInsightsSource = sessionManager;
    sessionExportService = new SessionExportService(sessionInsightsSource);
    sessionInsightsBridge = new SessionInsightsBridge({
      listSessions: () => sessionInsightsSource.listSessions(),
      getMessages: (sessionId: string) => sessionInsightsSource.getMessages(sessionId),
      getTraceSteps: (sessionId: string) => sessionInsightsSource.getTraceSteps(sessionId),
      getTurnJournal: (sessionId: string) => sessionInsightsSource.getTurnJournal(sessionId),
      getMemoryPreview: (sessionId: string) => sessionInsightsSource.getMemoryPreview(sessionId),
      replaceMessages: (sessionId: string, messages) =>
        sessionInsightsSource.replaceMessages(sessionId, messages),
    });

    // Activity feed — cross-project event log persisted in SQLite
    activityFeed = new ActivityFeed(db);
    fleetBridge?.setActivityFeed(activityFeed);

    try {
      const { loadCoreModule } = await import('./utils/core-loader');
      const eventBusMod = await loadCoreModule<{ getGlobalEventBus?: () => { on: (eventName: string, listener: (event: { activityType?: ActivityType; title: string; description?: string; metadata?: Record<string, unknown> }) => void) => void } }>('events/index.js');
      const globalBus = eventBusMod?.getGlobalEventBus?.();
      if (globalBus && activityFeed) {
        globalBus.on('fleet:activity', (event) => {
          activityFeed!.record({
            type: (event.activityType || 'fleet.activity') as ActivityType,
            title: event.title,
            description: event.description,
            metadata: event.metadata
          });
        });
      }
    } catch (err) {
      logWarn('[ActivityFeed] Failed to subscribe to fleet:activity', err);
    }

    // Phase 3 step 4: bookmarks service (starred messages)
    bookmarksService = new BookmarksService(db);

    // Config export/import — settings sync bundle
    configExportService = new ConfigExportService(projectManager);

    // Initialize notification bridge (Claude Cowork parity)
    notificationBridge = new NotificationBridge(sendToRenderer);
    void notificationBridge.init();
    sessionManager.setNotificationBridge(notificationBridge);

    // Initialize task dispatch for remote triggers (Claude Cowork parity)
    taskDispatch = new TaskDispatch(sessionManager, notificationBridge);

    // Initialize ICM cross-session memory integration (Claude Cowork parity)
    icmIntegration = new ICMIntegration();
    const icmIntegrationRef = icmIntegration;
    const sessionManagerRef = sessionManager;
    void (async () => {
      try {
        // Defer until MCP manager has had a chance to connect to servers
        const mcpMgr = (
          sessionManagerRef as unknown as {
            mcpManager?: {
              callTool?: (
                server: string,
                tool: string,
                args: Record<string, unknown>
              ) => Promise<unknown>;
              getConnectedServers?: () => string[];
            };
          }
        ).mcpManager;
        if (mcpMgr?.callTool && mcpMgr?.getConnectedServers) {
          const caller = {
            callTool: mcpMgr.callTool.bind(mcpMgr),
            getConnectedServers: mcpMgr.getConnectedServers.bind(mcpMgr),
          };
          const available = await icmIntegrationRef.initialize(caller);
          if (available) {
            sessionManagerRef.setICMIntegration(icmIntegrationRef);
            log('[Main] ICM cross-session memory wired');
          }
        }
      } catch (err) {
        logWarn('[Main] ICM integration setup failed:', err);
      }
    })();
    skillsManager = new SkillsManager(db, {
      getConfiguredGlobalSkillsPath: () => configStore.get('globalSkillsPath') || '',
      setConfiguredGlobalSkillsPath: (nextPath: string) => {
        configStore.update({ globalSkillsPath: nextPath });
      },
      watchStorage: true,
    });
    // Point the embedded Code Buddy engine's bundled-skills tier at the same
    // built-in skills directory the GUI loads, so the agentic loop's findSkill()
    // can surface pptx/docx/xlsx/pdf to the model. Must be set before the first
    // session constructs CodeBuddyAgent (which initializes the skill registry).
    try {
      const builtinSkillsPath = skillsManager.getBuiltinSkillsPath();
      if (builtinSkillsPath && !process.env.CODEBUDDY_BUNDLED_SKILLS_DIR) {
        process.env.CODEBUDDY_BUNDLED_SKILLS_DIR = builtinSkillsPath;
        log(`[Main] Embedded engine bundled skills dir → ${builtinSkillsPath}`);
      }
    } catch (err) {
      logWarn('[Main] Failed to wire bundled skills dir for embedded engine:', err);
    }
    // Put the bundled Python on PATH so the document skills' `python3 …` scripts
    // (python-pptx/openpyxl/python-docx — see resources/python/requirements-skills.txt)
    // run with the office libs we bundle, in BOTH dev and packaged builds. The
    // Claude-runner enrich only covers production; the embedded CB engine's bash
    // (which the agent uses to run skill scripts) needs it in dev too.
    try {
      const pyArch = process.arch === 'arm64' ? 'arm64' : 'x64';
      const pyPlatTag =
        process.platform === 'darwin' ? `darwin-${pyArch}`
        : process.platform === 'win32' ? 'win-x64'
        : 'linux-x64';
      const pyExe = process.platform === 'win32' ? 'python.exe' : 'python3';
      const coworkRoot = resolve(__dirname, '..', '..');
      const pyBinCandidates = app.isPackaged
        ? [join(process.resourcesPath, 'python', 'bin'), join(process.resourcesPath, 'python')]
        : [
            join(coworkRoot, 'resources', 'python', pyPlatTag, 'bin'),
            join(coworkRoot, 'resources', 'python', pyPlatTag),
            join(coworkRoot, 'resources', 'python', 'bin'),
          ];
      const pyBin = pyBinCandidates.find((d) => fs.existsSync(join(d, pyExe)));
      const pyDelim = process.platform === 'win32' ? ';' : ':';
      if (pyBin && !(process.env.PATH || '').split(pyDelim).includes(pyBin)) {
        process.env.PATH = `${pyBin}${pyDelim}${process.env.PATH || ''}`;
        log(`[Main] Bundled Python on PATH → ${pyBin}`);
      }
      // Point Playwright (web-automate skill) at the bundled browser cache. The
      // Firefox binary fetched by prepare:python:extras lives OUTSIDE site-packages
      // (sibling of bin/), so it only resolves at runtime via this env var.
      if (pyBin && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
        const browsers = resolve(pyBin, '..', 'ms-playwright');
        if (fs.existsSync(browsers)) {
          process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
          log(`[Main] Playwright browsers → ${browsers}`);
        }
      }
    } catch (err) {
      logWarn('[Main] Failed to add bundled Python to PATH:', err);
    }
    skillsManager.onStorageChanged((event) => {
      sendToRenderer({
        type: 'skills.storageChanged',
        payload: event,
      });
    });
    // pi-ai handles model routing natively — no proxy warmup needed

    // macOS: application menu, dock menu, tray icon
    buildMacMenu();
    if (!isE2E) {
      setupTray();
    }

    // Show window after core managers are ready so first-load actions can be handled.
    createWindow();

    // Remote backend (Phase B2): apply env overrides + auto-connect if the
    // persisted config opted in. Non-blocking — failures are logged, not fatal.
    void remoteBackendManager.bootstrap();

    // macOS: dock menu
    if (process.platform === 'darwin') {
      const dockMenu = Menu.buildFromTemplate([
        {
          label: 'New Session',
          click: () => mainWindow?.webContents.send('server-event', { type: 'new-session' }),
        },
        {
          label: 'Settings',
          click: () =>
            mainWindow?.webContents.send('server-event', { type: 'navigate', payload: 'settings' }),
        },
      ]);
      app.dock?.setMenu(dockMenu);
    }

    // macOS: send initial system theme to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.on('did-finish-load', () => {
        sendToRenderer({
          type: 'native-theme.changed',
          payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
        });
      });
    }

    // Listen for system theme changes
    nativeTheme.on('updated', () => {
      sendToRenderer({
        type: 'native-theme.changed',
        payload: { shouldUseDarkColors: nativeTheme.shouldUseDarkColors },
      });
      if (getSavedThemePreference() === 'system' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG);
      }
    });

    // Auto-updater: check for updates in production. We gate on
    // `app.isPackaged` rather than `!isDev` because electron-updater
    // only ships inside the packaged binary — a NODE_ENV=production
    // dev launch (which DEV-LINUX.md actually recommends) would
    // otherwise emit a misleading "Failed to load electron-updater"
    // warning at every boot.
    if (app.isPackaged && !isE2E) {
      import('electron-updater')
        .then(({ autoUpdater }) => {
          autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
            log('[AutoUpdater] Update check failed:', err);
          });
        })
        .catch((err: unknown) => {
          log('[AutoUpdater] Failed to load electron-updater:', err);
        });
    }

    if (!isE2E) {
      startNavServer(() => mainWindow);
    }

    const scheduledTaskStore = createScheduledTaskStore(db);
    scheduledTaskManager = new ScheduledTaskManager({
      store: scheduledTaskStore,
      executeTask: async (task) => {
        const scheduledFleetDispatch = buildScheduledFleetDispatchInput(task);
        if (scheduledFleetDispatch) {
          const result = await dispatchFleetSaga(scheduledFleetDispatch, {
            fleetBridge,
            sagaRunner: getScheduledFleetSagaRunner(),
            activityFeed,
          });
          if (!result.ok || !result.sagaId) {
            throw new Error(result.error ?? 'Scheduled Fleet dispatch failed');
          }
          return { sessionId: result.sagaId, sagaId: result.sagaId };
        }
        if (!sessionManager) {
          throw new Error('Session manager not initialized');
        }
        const unsupportedReason = getWorkspacePathUnsupportedReason(task.cwd);
        if (unsupportedReason) {
          throw new Error(unsupportedReason);
        }
        const fallbackTitle = buildScheduledTaskFallbackTitle(task.prompt);
        const needsRegeneratedTitle = !task.title?.trim() || task.title === fallbackTitle;
        const title = needsRegeneratedTitle
          ? await resolveScheduledTaskTitle(task.prompt, task.cwd, task.title)
          : buildScheduledTaskTitle(task.title);
        if (title !== task.title) {
          scheduledTaskStore.update(task.id, { title });
        }
        const started = await sessionManager.startSession(title, task.prompt, task.cwd);
        // 定时任务创建的新会话需要主动同步到前端会话列表
        sendToRenderer({
          type: 'session.update',
          payload: { sessionId: started.id, updates: started },
        });
        return { sessionId: started.id };
      },
      onTaskComplete: (task, result) => {
        activityFeed?.record({
          type: 'scheduledTask.started',
          title: 'Scheduled task started',
          description: task.title,
          sessionId: result.sessionId,
          metadata: buildScheduledTaskActivityMetadata(task, {
            sessionId: result.sessionId,
            sessionShortId: shortActivityId(result.sessionId),
            ...(result.sagaId
              ? {
                  sagaId: result.sagaId,
                  sagaShortId: shortActivityId(result.sagaId),
                }
              : {}),
          }),
        });
      },
      onTaskError: (taskId, error) => {
        const task = scheduledTaskStore.get(taskId);
        activityFeed?.record({
          type: 'scheduledTask.failed',
          title: 'Scheduled task failed',
          description: task?.title ?? taskId,
          metadata: task ? buildScheduledTaskActivityMetadata(task, { error }) : { taskId, error },
        });
        sendToRenderer({
          type: 'scheduled-task.error',
          payload: { taskId, error },
        });
      },
      now: () => Date.now(),
    });
    scheduledTaskManager.start();

    // 初始化远程管理器
    remoteManager.setRendererCallback(sendToRenderer);
    remoteManager.setPromptPreprocessor(async (prompt, sessionId) => {
      if (!prompt.trim().startsWith('/')) {
        return { allowed: true, prompt };
      }
      if (!slashCommandBridge) {
        return { allowed: false, message: 'Slash commands are unavailable in remote sessions.' };
      }
      return slashCommandBridge.executeRemoteInput(prompt, sessionId);
    });
    const agentExecutor: AgentExecutor = {
      startSession: async (title, prompt, cwd) => {
        if (!sessionManager) throw new Error('Session manager not initialized');
        const unsupportedReason = getWorkspacePathUnsupportedReason(cwd);
        if (unsupportedReason) {
          throw new Error(unsupportedReason);
        }
        return sessionManager.startSession(title, prompt, cwd);
      },
      continueSession: async (sessionId, prompt, content, cwd) => {
        if (!sessionManager) throw new Error('Session manager not initialized');
        if (cwd) {
          const result = await setWorkingDir(cwd, sessionId);
          if (!result.success) {
            throw new Error(result.error || 'Failed to update working directory');
          }
        }
        await sessionManager.continueSession(sessionId, prompt, content);
      },
      stopSession: async (sessionId) => {
        if (!sessionManager) throw new Error('Session manager not initialized');
        await sessionManager.stopSession(sessionId);
      },
      validateWorkingDirectory: async (cwd) => {
        const unsupportedReason = getWorkspacePathUnsupportedReason(cwd);
        if (unsupportedReason) {
          return unsupportedReason;
        }
        if (!fs.existsSync(cwd)) {
          return 'Directory does not exist';
        }
        return null;
      },
    };
    remoteManager.setAgentExecutor(agentExecutor);

    // 远程控制启用时启动
    if (remoteConfigStore.isEnabled()) {
      remoteManager.start().catch((error) => {
        logError('[App] Failed to start remote control:', error);
      });
    }

    app.on('activate', () => {
      const hasVisibleWindow = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed());
      if (!hasVisibleWindow) {
        createWindow();
      }
    });
  })
  .catch((error) => {
    logError('[App] Startup failed:', error);
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    dialog.showErrorBox(`${APP_NAME} 启动失败`, `${message}\n\n请查看日志获取更多信息。`);
    app.quit();
  });

// Flag to prevent double cleanup
let isCleaningUp = false;

// (W6) Wiring — periodic peer discovery via Tailscale + manual YAML.
// Diffs against the FleetBridge's current peer registry and surfaces
// new candidates to the renderer for an "Add this peer?" confirm UI.
const DISCOVERY_INTERVAL_MS = 5 * 60 * 1_000;
let discoveryTimer: ReturnType<typeof setInterval> | null = null;

async function scheduleFleetDiscovery(): Promise<void> {
  const runOnce = async () => {
    if (!fleetBridge) return;
    try {
      const { discoverPeers } = await import('./fleet/discovery');
      const all = await discoverPeers();
      const known = new Set((await Promise.resolve(fleetBridge.listPeers())).map((p) => p.url));
      const fresh = all.filter((p) => !known.has(p.url));
      if (fresh.length > 0) {
        sendToRenderer({
          type: 'fleet.peer.discovered',
          payload: { peers: fresh },
        });
      }
    } catch (err) {
      // Silent fail — discovery is best-effort, don't pollute the log.
      void err;
    }
  };
  // First pass after boot — small delay so Tailscale, FleetBridge init,
  // and any startup races settle.
  setTimeout(() => void runOnce(), 5_000);
  if (!discoveryTimer) {
    discoveryTimer = setInterval(() => void runOnce(), DISCOVERY_INTERVAL_MS);
  }
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  }) as Promise<T>;
}

/**
 * Cleanup all sandbox resources
 * Called on app quit (both Windows and macOS)
 */
async function cleanupSandboxResources(): Promise<void> {
  if (isCleaningUp) {
    log('[App] Cleanup already in progress, skipping...');
    return;
  }
  isCleaningUp = true;

  stopNavServer();
  skillsManager?.stopStorageMonitoring();
  scheduledTaskManager?.stop();
  tray?.destroy();
  tray = null;

  // 停止远程控制
  try {
    log('[App] Stopping remote control...');
    await withTimeout(remoteManager.stop(), 5000, 'Remote control shutdown');
    log('[App] Remote control stopped');
  } catch (error) {
    logError('[App] Error stopping remote control:', error);
  }

  // Cleanup all sandbox sessions (sync changes back to host OS first)
  try {
    log('[App] Cleaning up all sandbox sessions...');

    // Cleanup WSL sessions
    await withTimeout(SandboxSync.cleanupAllSessions(), 30000, 'WSL session cleanup');

    // Cleanup Lima sessions
    const { LimaSync } = await import('./sandbox/lima-sync');
    await withTimeout(LimaSync.cleanupAllSessions(), 30000, 'Lima session cleanup');

    log('[App] Sandbox sessions cleanup complete');
  } catch (error) {
    logError('[App] Error cleaning up sandbox sessions:', error);
  }

  // Shutdown sandbox adapter
  try {
    await withTimeout(shutdownSandbox(), 8000, 'Sandbox shutdown');
    log('[App] Sandbox shutdown complete');
  } catch (error) {
    logError('[App] Error shutting down sandbox:', error);
  }

  // Shutdown MCP servers
  try {
    const mcpManager = sessionManager?.getMCPManager();
    if (mcpManager) {
      log('[App] Shutting down MCP servers...');
      await withTimeout(mcpManager.shutdown(), 5000, 'MCP shutdown');
      log('[App] MCP servers shutdown complete');
    }
  } catch (error) {
    logError('[App] Error shutting down MCP servers:', error);
  }

  // Shutdown voice bridge (kills the Python worker if any).
  try {
    voiceBridge?.shutdown();
  } catch (error) {
    logError('[App] Error shutting down voice bridge:', error);
  }

  try {
    clipboardWatcher?.stop();
  } catch (error) {
    logError('[App] Error stopping clipboard watcher:', error);
  }

  try {
    closeDatabase();
  } catch (error) {
    logError('[App] Error closing database:', error);
  }

  closeLogFile();

  // pi-ai doesn't need proxy shutdown
}

// Handle app quit - window-all-closed (primary for Windows/Linux)
// Global policy for EVERY <webview> (the Browser Operator live view renders
// arbitrary agent-navigated web content): force safe webPreferences at attach
// time, refuse non-http(s) sources, keep navigation inside http(s), and route
// window.open to the system browser. The top-level window has its own
// handlers; this closes the same doors for embedded guest content.
app.on('web-contents-created', (_event, contents) => {
  // The HOST contents fires will-attach-webview: force safe webPreferences
  // and refuse non-http(s) sources before the guest is even created.
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    delete (webPreferences as { preload?: string }).preload;
    if (params.src && !/^https?:\/\//i.test(String(params.src))) {
      logError('[webview] blocked attach with non-http(s) src:', params.src);
      event.preventDefault();
    }
  });
  if (contents.getType() !== 'webview') return;
  contents.on('will-navigate', (event, url) => {
    if (!/^https?:\/\//i.test(url)) {
      logError('[webview] blocked non-http(s) navigation:', url);
      event.preventDefault();
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
});

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin' || process.env.VITE_DEV_SERVER_URL) {
    // On Windows/Linux, closing all windows means quit.
    // On macOS dev mode, also quit — so vite-plugin-electron can restart cleanly
    // without the old process holding the single-instance lock.
    await cleanupSandboxResources();
    app.quit();
  }
  // On macOS production, keep app alive — cleanup happens in before-quit
});

// Handle SIGTERM/SIGINT (e.g. pkill) — route through app.quit() for clean shutdown
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => app.quit());
}

// Handle app quit - before-quit (for macOS Cmd+Q and other quit methods)
app.on('before-quit', async (event) => {
  if (!isCleaningUp) {
    // In dev mode, exit quickly — no need for async sandbox cleanup
    if (process.env.VITE_DEV_SERVER_URL) {
      stopNavServer();
      try {
        closeDatabase();
      } catch {
        /* best-effort */
      }
      closeLogFile();
      tray?.destroy();
      tray = null;
      return;
    }
    // Set the flag immediately before any await to prevent re-entrant cleanup
    isCleaningUp = true;
    event.preventDefault();
    try {
      await cleanupSandboxResources();
    } catch (error) {
      logError('[App] before-quit cleanup failed, forcing quit:', error);
    }
    app.quit();
  }
});

// IPC Handlers
ipcMain.on('client-event', async (_event, data: ClientEvent) => {
  try {
    await handleClientEvent(data);
  } catch (error) {
    logError('Error handling client event:', error);
    sendToRenderer({
      type: 'error',
      payload: { message: error instanceof Error ? error.message : 'Unknown error' },
    });
  }
});

ipcMain.handle('client-invoke', async (_event, data: ClientEvent) => {
  return handleClientEvent(data);
});

ipcMain.handle('get-version', () => {
  try {
    return app.getVersion();
  } catch (error) {
    logError('[IPC] Error getting version:', error);
    return 'unknown';
  }
});

// ── Checkpoint IPC handlers ────────────────────────────────────────────
registerCheckpointIpcHandlers();

// ── Workspace IPC handlers ────────────────────────────────────────────
ipcMain.handle('workspace.readDir', async (_event, dirPath: string) => {
  try {
    // Reject malformed input (non-string / empty / null byte) before touching the FS.
    if (typeof dirPath !== 'string' || dirPath.length === 0 || dirPath.includes('\0') || dirPath.includes('..')) {
      return [];
    }
    const resolvedDir = resolve(dirPath);
    const entries = await fs.promises.readdir(resolvedDir, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        path: resolve(resolvedDir, e.name),
      }));
  } catch {
    return [];
  }
});

// ── Permission mode IPC handler (see ipc/permission-ipc.ts) ───────────
registerPermissionIpcHandlers();

// ── Model switch + Gemini/Codex OAuth IPC handlers (see ipc/config-model-ipc.ts) ──
registerConfigModelIpcHandlers();

// ── Project IPC handlers (Claude Cowork parity) ──────────────────────
registerProjectIpcHandlers(
  () => projectManager,
  () => activityFeed
);

// ── Sub-agent IPC handlers (Claude Cowork parity) ────────────────────
// Getters: these bridges are assigned during async boot, after this top-level
// registration runs. Passing the bare value would pin `null` (dead handlers).
registerSubAgentIpcHandlers(() => subAgentBridge);

// ── Orchestrator IPC handlers ────────────────────────────────────────
registerOrchestratorIpcHandlers(() => orchestratorBridge);

// ── Fleet IPC handlers (GAP 3 — multi-host Code Buddy listener) ──────
registerFleetIpcHandlers(
  () => fleetBridge,
  () => activityFeed,
  () => projectManager
);

// ── Mission Control OS IPC handlers (council ledgers, read-only) ─────
registerOsIpcHandlers();

// ── Team IPC handlers (Phase 4 layer 9 — Agent Teams observability) ──
registerTeamIpcHandlers(() => teamBridge);

// ── Mention IPC handlers (Claude Cowork parity) ──────────────────────
registerMentionIpcHandlers(() => mentionProcessor);

// ── Slash command IPC handlers (Claude Cowork parity Phase 2) ────────
// Getter, not value: the bridge is assigned during async boot, after this
// top-level registration runs (see command-ipc.ts).
registerCommandIpcHandlers(() => slashCommandBridge);

// ── SKILL.md bridge IPC handlers (Claude Cowork parity Phase 2) ─────
registerSkillMdIpcHandlers(() => skillMdBridge);
registerSkillsHubIpcHandlers(() => projectManager);

// ── Knowledge IPC handlers (Claude Cowork parity) ────────────────────
registerKnowledgeIpcHandlers(() => knowledgeService, () => projectManager);

// ── Hermes review-gated surfaces (CLI parity → Cowork) ───────────────
// Lesson-candidate queue (item 7), user model (item 24), spec stories.
// All resolve `.codebuddy/` under the ACTIVE project's workspace via the
// projectManager getter (set during async boot, like fleetBridge above).
registerLessonCandidateIpcHandlers(() => projectManager);
registerUserModelIpcHandlers(() => projectManager);
registerIdentityIpcHandlers(() => projectManager);
registerDeviceIpcHandlers();
registerChannelsIpcHandlers();
registerPairingIpcHandlers();
registerMobileSupervisionIpcHandlers();
registerCompanionIpcHandlers(() => projectManager);
registerAutomationsIpcHandlers();
registerDesktopSnapshotIpcHandlers();
registerMissionIpcHandlers(() => missionBridge);
registerSpecIpcHandlers(() => projectManager, configStore);
registerSpecNextIpcHandlers(() => projectManager);
registerLiveLauncherIpcHandlers();
registerProfilesIpcHandlers();

// ── App Studio (bolt.diy-style: file tree + editor + terminal + live preview) ─
// Dormant until the renderer opens the Studio view. The command runner streams
// output to whatever window is current via the lazy getMainWindow() getter; the
// dev server delegates to the core `app_server` tool for loopback-gated spawns.
// See src/main/studio/*.
registerDevServerIpc(ipcMain, new StudioDevServer());
registerStudioFilesIpc(ipcMain);
registerCommandRunnerIpc(ipcMain, new CommandRunner(), () => getMainWindow()?.webContents ?? null);
registerScaffoldIpc(ipcMain, new ScaffoldService());

// Media generation surface delegates to the core image_generate tool.
registerMediaGenIpc(ipcMain, new MediaGenService());

// Video Studio: prompt → premium narrated video (core produceVideoFromPrompt).
// Films land in the media-library working dir so they show up in the Bibliothèque.
registerFilmIpc(ipcMain, new FilmService(undefined, join(app.getPath('userData'), 'default_working_dir')));

// Assistant: voice assistant config + daemon lifecycle (core companion/assistant-config).
registerAssistantIpc(ipcMain, new AssistantService());

// Tool result widgets: render core-provided self-contained HTML in the main process.
registerWidgetsIpcHandlers();

// ── .codebuddy/ backups (same core handler as `buddy backup`) ────────────
registerBackupIpcHandlers();

// ── Task dispatch IPC (mobile/remote → background session) ───────────
ipcMain.handle('dispatch.task', async (_event, request: DispatchRequest) => {
  if (!taskDispatch) return { success: false, error: 'TaskDispatch not initialized' };
  const validation = taskDispatch.validate(request);
  if (!validation.valid) {
    return { success: false, error: validation.reason };
  }
  return taskDispatch.dispatch(request);
});

// ── Session settings update IPC (Claude Cowork parity) ──────────────
ipcMain.handle(
  'session.updateSettings',
  async (
    _event,
    sessionId: string,
    updates: {
      projectId?: string | null;
      executionMode?: 'chat' | 'task';
      isBackground?: boolean;
      title?: string;
      pinned?: boolean;
      archived?: boolean;
      tags?: string[];
      source?: string;
    }
  ) => {
    if (!sessionManager) return false;
    return sessionManager.updateSessionSettings(sessionId, updates);
  }
);

// ── Background session IPC (Claude Cowork parity) ────────────────────
ipcMain.handle(
  'session.startBackground',
  async (
    _event,
    payload: {
      title: string;
      prompt: string;
      cwd?: string;
      projectId?: string;
    }
  ) => {
    if (!sessionManager) throw new Error('SessionManager not initialized');
    if (!configStore.hasUsableCredentialsForActiveSet()) {
      sendActiveSetConfigRequiredError();
      return null;
    }
    const session = await sessionManager.startBackgroundSession(
      payload.title,
      payload.prompt,
      payload.cwd,
      payload.projectId
    );
    return session;
  }
);

// ── Memory listing + CRUD for MemoryBrowser — extracted to ipc/memory-ipc.ts
registerMemoryIpcHandlers({
  getProjectManager: () => projectManager,
  getProjectMemoryService: () => projectMemoryServiceRef,
});

// ── Autonomy: read-only snapshot of the fleet colab queue ───────────────
// Powers the Autonomy panel. Reads tasks/worklog/presence from the colab dir
// (the autonomy daemon's queue; default ~/.codebuddy/fleet, override via arg or
// CODEBUDDY_FLEET_COLAB_DIR). FleetColabStore reads are side-effect-free.
ipcMain.handle('autonomy.snapshot', async (_event, dir?: string) => {
  try {
    const os = await import('os');
    const nodePath = await import('path');
    const resolvedDir =
      dir || process.env.CODEBUDDY_FLEET_COLAB_DIR || nodePath.join(os.homedir(), '.codebuddy', 'fleet');
    const mod = await loadCoreModule<{
      FleetColabStore: new (cfg: { dir: string }) => {
        getDir: () => string;
        listTasks: () => unknown[];
        listWorklog: () => unknown[];
        listPresence: () => Record<string, unknown>;
      };
    }>('fleet/colab-store.js');
    if (!mod) throw new Error('Failed to load colab-store module');
    const store = new mod.FleetColabStore({ dir: resolvedDir });
    const worklog = store.listWorklog();
    return {
      ok: true,
      dir: store.getDir(),
      tasks: store.listTasks(),
      worklog: worklog.slice(-25).reverse(),
      presence: store.listPresence(),
    };
  } catch (err) {
    logWarn('[autonomy.snapshot] failed:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      dir: dir ?? null,
      tasks: [],
      worklog: [],
      presence: {},
    };
  }
});

// ── Autonomy: daemon lifecycle + free-first model tier ──────────────────
// Pilots the always-on `codebuddy-autonomy` service (install/uninstall/
// start/stop/restart), runs one-shot ticks through the real CLI, and surfaces
// the local→network→paid model ladder. See autonomy/autonomy-daemon-bridge.ts.
ipcMain.handle('autonomy.daemonStatus', async () => getAutonomyDaemonStatusForReview());

ipcMain.handle('autonomy.serviceControl', async (_event, action: 'start' | 'stop' | 'restart') =>
  controlAutonomyServiceForReview(action)
);

ipcMain.handle(
  'autonomy.serviceInstall',
  async (
    _event,
    options?: {
      dir?: string;
      model?: string;
      ollamaUrl?: string;
      intervalMs?: number;
      executor?: 'artifact' | 'agent';
      workspace?: string;
    }
  ) => installAutonomyServiceForReview(options ?? {})
);

ipcMain.handle('autonomy.serviceUninstall', async () => uninstallAutonomyServiceForReview());

ipcMain.handle('autonomy.runTick', async (_event, dir?: string) => runAutonomyTickForReview(dir));

ipcMain.handle('autonomy.modelTier', async () => getAutonomyModelTierForReview());

// Tail the systemd user unit's logs (Linux; other platforms get the
// inspection command instead). See getAutonomyServiceLogsForReview.
ipcMain.handle('autonomy.serviceLogs', async (_event, lines?: number) =>
  getAutonomyServiceLogsForReview(lines)
);

// ── Autonomy: colab board mutations (the kanban's write half) ────────────
// add/claim/complete/block/release + expired-claim sweep go through the core
// FleetColabStore so GUI edits share the protocol invariants (DAG readiness,
// claim lease, worklog append). See autonomy/colab-board-bridge.ts.
ipcMain.handle('autonomy.taskAdd', async (_event, input: ColabBoardAddInput) => addColabTaskForReview(input));

ipcMain.handle('autonomy.taskClaim', async (_event, taskId: string, dir?: string) =>
  claimColabTaskForReview(taskId, dir)
);

ipcMain.handle('autonomy.taskComplete', async (_event, taskId: string, summary: string, dir?: string) =>
  completeColabTaskForReview(taskId, summary, dir)
);

ipcMain.handle('autonomy.taskBlock', async (_event, taskId: string, reason: string, dir?: string) =>
  blockColabTaskForReview(taskId, reason, dir)
);

ipcMain.handle('autonomy.taskRelease', async (_event, taskId: string, dir?: string) =>
  releaseColabTaskForReview(taskId, dir)
);

ipcMain.handle('autonomy.reclaimExpired', async (_event, dir?: string) => reclaimExpiredColabForReview(dir));

// ── Pluggable memory provider selector (GAP-10) ─────────────────────────
ipcMain.handle('memoryProvider.list', async () => {
  try {
    const mod = await loadCoreModule<{ getMemoryProviderRegistry: () => { list: () => unknown[] } }>(
      'memory/memory-provider.js'
    );
    if (!mod) throw new Error('Failed to load memory provider module');
    return mod.getMemoryProviderRegistry().list();
  } catch (err) {
    logWarn('[memoryProvider.list] failed:', err);
    return ['local', 'mem0', 'honcho', 'supermemory'];
  }
});

ipcMain.handle('memoryProvider.getActive', async () => {
  try {
    return configStore.get('memoryProvider') || 'local';
  } catch (err) {
    logWarn('[memoryProvider.getActive] failed:', err);
    return 'local';
  }
});

ipcMain.handle('memoryProvider.setActive', async (_event, providerId: string) => {
  try {
    configStore.update({ memoryProvider: providerId });
    configStore.applyToEnv();
    try {
      const mod = await loadCoreModule<{ getMemoryProviderRegistry: () => { setActive: (providerId: string) => void } }>(
        'memory/memory-provider.js'
      );
      if (mod) {
        mod.getMemoryProviderRegistry().setActive(providerId);
      }
    } catch {
      // Ignored
    }
    return { success: true };
  } catch (err) {
    logWarn('[memoryProvider.setActive] failed:', err);
    return { success: false, error: String(err) };
  }
});

// ── Lessons capture (operator-approved procedural memory) ─────────────
ipcMain.handle(
  'lessons.add',
  async (
    _event,
    category: 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT',
    content: string,
    projectId?: string
  ) => {
    const trimmed = content.trim();
    if (!trimmed) return { success: false, error: 'Lesson content is empty' };

    try {
      const { loadCoreModule } = await import('./utils/core-loader');
      const lessonsMod = await loadCoreModule<{
        getLessonsTracker: (workDir?: string) => {
          add: (
            category: 'PATTERN' | 'RULE' | 'CONTEXT' | 'INSIGHT',
            content: string,
            source?: 'user_correction' | 'self_observed' | 'manual'
          ) => { id: string };
        };
      }>('agent/lessons-tracker.js');
      if (!lessonsMod) {
        return { success: false, error: 'Lessons tracker unavailable' };
      }
      const tracker = lessonsMod.getLessonsTracker(resolveLessonsWorkspace(projectId));
      const item = tracker.add(category, trimmed, 'manual');
      return { success: true, lessonId: item.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('[IPC] Lessons add failed:', err);
      return { success: false, error: message };
    }
  }
);

function resolveLessonsWorkspace(projectId?: string): string {
  if (projectManager) {
    const project = projectId ? projectManager.get(projectId) : projectManager.getActive();
    if (project?.workspacePath) return project.workspacePath;
  }
  return process.cwd();
}

// ── Session export IPC handler ────────────────────────────────────────
// bolt.new parity: export the generated project as a zip (Save-As dialog).
ipcMain.handle('studio.exportZip', async (_event, { root }: { root: string }) => {
  try {
    const st = await import('fs').then((f) => f.promises.stat(root));
    if (!st.isDirectory()) return { ok: false, error: 'not a directory' };
    const win = getMainWindow();
    const defaultName = `${basename(root) || 'projet'}.zip`;
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: defaultName, title: "Exporter le projet" })
      : await dialog.showSaveDialog({ defaultPath: defaultName, title: "Exporter le projet" });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const archiver = (await import('archiver')).default;
    const fsMod = await import('fs');
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const output = fsMod.createWriteStream(result.filePath!);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', () => resolvePromise());
      archive.on('error', (err: Error) => rejectPromise(err));
      archive.pipe(output);
      archive.glob('**/*', {
        cwd: root,
        dot: true,
        ignore: ['node_modules/**', '.git/**', '.codebuddy/checkpoints/**'],
      });
      void archive.finalize();
    });
    return { ok: true, savedTo: result.filePath };
  } catch (err) {
    logWarn('[studio.exportZip] failed:', err);
    return { ok: false, error: String(err) };
  }
});

// Media library (ChatGPT-library parity): every generated media across all
// session roots; export = native Save-As dialog + copy.
ipcMain.handle('media.list', async () => {
  try {
    const { scanMediaLibrary } = await import('./media-library');
    const roots = new Set<string>();
    roots.add(join(app.getPath('userData'), 'default_working_dir'));
    if (sessionManager) {
      for (const s of sessionManager.listSessions()) {
        if (s.cwd) roots.add(s.cwd);
      }
    }
    const items = scanMediaLibrary([...roots]);
    // Link each media to the conversation that generated it: its basename is
    // echoed in that session's assistant message (the MEDIA: marker).
    if (sessionManager) {
      const { buildMediaSessionIndex, basenameOf } = await import('./session/media-session-index');
      const blobs = sessionManager.listSessions().map((sess) => ({
        sessionId: sess.id,
        text: sessionManager!
          .getMessages(sess.id)
          .map((m) => (Array.isArray(m.content) ? m.content : [])
            .filter((b): b is { type: 'text'; text: string } => (b as { type?: string }).type === 'text')
            .map((b) => b.text)
            .join(' '))
          .join(' '),
      }));
      const index = buildMediaSessionIndex(blobs);
      for (const item of items) {
        const sid = index.get(basenameOf(item.path));
        if (sid) (item as { sessionId?: string }).sessionId = sid;
      }
    }
    return items;
  } catch (err) {
    logWarn('[media.list] failed:', err);
    return [];
  }
});

ipcMain.handle('media.copyToClipboard', async (_event, { sourcePath }: { sourcePath: string }) => {
  try {
    const { kindOf } = await import('./media-library');
    const kind = kindOf(sourcePath);
    if (kind === 'image') {
      const img = nativeImage.createFromPath(sourcePath);
      if (img.isEmpty()) return { ok: false, error: 'image illisible' };
      clipboard.writeImage(img);
      return { ok: true, mode: 'image' as const };
    }
    // Non-image (video/audio): copy the absolute path (the clipboard has no
    // portable video type across apps).
    clipboard.writeText(sourcePath);
    return { ok: true, mode: 'path' as const };
  } catch (err) {
    logWarn('[media.copyToClipboard] failed:', err);
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('media.exportMany', async (_event, { paths }: { paths: string[] }) => {
  try {
    const { kindOf } = await import('./media-library');
    const valid = (paths ?? []).filter((p) => kindOf(p));
    if (valid.length === 0) return { ok: false, error: 'no media selected' };
    const win = getMainWindow();
    const picked = win
      ? await dialog.showOpenDialog(win, { title: 'Exporter la sélection vers…', properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ title: 'Exporter la sélection vers…', properties: ['openDirectory', 'createDirectory'] });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
    const destDir = picked.filePaths[0];
    const fsp = await import('fs/promises');
    let copied = 0;
    for (const src of valid) {
      try {
        await fsp.copyFile(src, join(destDir, basename(src)));
        copied += 1;
      } catch (err) {
        logWarn('[media.exportMany] copy failed:', src, err);
      }
    }
    return { ok: true, copied, destDir };
  } catch (err) {
    logWarn('[media.exportMany] failed:', err);
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('media.export', async (_event, { sourcePath }: { sourcePath: string }) => {
  try {
    const { kindOf } = await import('./media-library');
    if (!kindOf(sourcePath)) return { ok: false, error: 'not a media file' };
    const fsp = await import('fs/promises');
    const win = getMainWindow();
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: basename(sourcePath), title: 'Exporter le média' })
      : await dialog.showSaveDialog({ defaultPath: basename(sourcePath), title: 'Exporter le média' });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fsp.copyFile(sourcePath, result.filePath);
    return { ok: true, savedTo: result.filePath };
  } catch (err) {
    logWarn('[media.export] failed:', err);
    return { ok: false, error: String(err) };
  }
});

// Bulk session prune (Hermes parity): preview matches + age span, then
// archive them in one pass. Pinned/archived/active sessions never match.
ipcMain.handle(
  'session.prunePreview',
  async (_event, filter: { olderThanDays?: number; titleMatch?: string; excludeId?: string }) => {
    const { previewPrune } = await import('../shared/session-prune');
    if (!sessionManager) return { matches: [], ageSpan: null };
    const sessions = sessionManager
      .listSessions()
      .filter((s) => s.id !== filter.excludeId)
      .map((s) => ({ id: s.id, title: s.title, pinned: s.pinned, archived: s.archived, updatedAt: s.updatedAt }));
    const preview = previewPrune(sessions, filter, Date.now());
    return {
      matches: preview.matches.map((m) => ({ id: m.id, title: m.title ?? '', updatedAt: m.updatedAt })),
      ageSpan: preview.ageSpan,
    };
  }
);

ipcMain.handle('session.pruneApply', async (_event, { ids }: { ids: string[] }) => {
  if (!sessionManager) return { ok: false, archived: 0 };
  let archived = 0;
  for (const id of ids) {
    if (sessionManager.updateSessionSettings(id, { archived: true })) archived += 1;
  }
  return { ok: true, archived };
});

ipcMain.handle('session.export', async (_event, sessionId: string, format: 'md' | 'json') => {
  try {
    if (!sessionManager) return null;
    const messages = (
      sessionManager as unknown as { getMessages?: (id: string) => unknown[] }
    ).getMessages?.(sessionId);
    return { messages, format };
  } catch {
    return null;
  }
});

// Phase 2 step 16: enhanced session export with format/redaction options
ipcMain.handle(
  'session.exportFull',
  async (
    _event,
    sessionId: string,
    options: {
      format: 'markdown' | 'json' | 'html';
      redactSecrets?: boolean;
      includeCheckpoints?: boolean;
    }
  ) => {
    if (!sessionExportService) {
      return { success: false, content: '', filename: '', error: 'Export service unavailable' };
    }
    return sessionExportService.exportSession(sessionId, options);
  }
);

registerWorkflowServiceIpcHandlers();

// Export a conversation as PDF: render the standalone HTML export in an
// offscreen window and print it (native Save-As).
ipcMain.handle('session.exportPdf', async (_event, sessionId: string) => {
  try {
    if (!sessionManager) return { success: false, error: 'Session manager unavailable' };
    const session = sessionManager.listSessions().find((sess) => sess.id === sessionId);
    const rawMessages = sessionManager.getMessages(sessionId);
    const { buildConversationPdfHtml } = await import('./session/conversation-pdf-template');
    const pdfMessages = rawMessages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({
        role: message.role,
        timestamp: message.timestamp,
        text: (Array.isArray(message.content) ? message.content : [])
          .filter((block): block is { type: 'text'; text: string } => (block as { type?: string }).type === 'text')
          .map((block) => block.text)
          .join('\n\n'),
      }))
      .filter((message) => message.text.trim().length > 0);
    const htmlContent = buildConversationPdfHtml({
      title: session?.title || 'Conversation',
      model: session?.model,
      exportedAt: new Date(),
      messages: pdfMessages,
    });
    const win = getMainWindow();
    const safeName = (session?.title || 'conversation').replace(/[^\w\u00C0-\u017F -]+/g, '').trim().slice(0, 60) || 'conversation';
    const dialogResult = win
      ? await dialog.showSaveDialog(win, {
          title: 'Exporter la conversation en PDF',
          defaultPath: `${safeName}.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
      : await dialog.showSaveDialog({ title: 'Exporter la conversation en PDF', defaultPath: 'conversation.pdf' });
    if (dialogResult.canceled || !dialogResult.filePath) return { success: false, canceled: true };
    const offscreen = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    try {
      await offscreen.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
      const pdf = await offscreen.webContents.printToPDF({ printBackground: true, margins: { marginType: 'default' } });
      const fsp = await import('fs/promises');
      await fsp.writeFile(dialogResult.filePath, pdf);
    } finally {
      offscreen.destroy();
    }
    return { success: true, savedTo: dialogResult.filePath };
  } catch (err) {
    logWarn('[session.exportPdf] failed:', err);
    return { success: false, error: String(err) };
  }
});

ipcMain.handle(
  'session.exportToFile',
  async (
    _event,
    sessionId: string,
    options: {
      format: 'markdown' | 'json' | 'html';
      redactSecrets?: boolean;
      includeCheckpoints?: boolean;
    }
  ) => {
    if (!sessionExportService) {
      return { success: false, error: 'Export service unavailable' };
    }
    const result = sessionExportService.exportSession(sessionId, options);
    if (!result.success) return { success: false, error: result.error };
    const dialogResult = await dialog.showSaveDialog({
      title: 'Export session',
      defaultPath: result.filename,
      filters: [
        options.format === 'markdown'
          ? { name: 'Markdown', extensions: ['md'] }
          : options.format === 'html'
            ? { name: 'HTML', extensions: ['html'] }
            : { name: 'JSON', extensions: ['json'] },
      ],
    });
    if (dialogResult.canceled || !dialogResult.filePath) {
      return { success: false, error: 'Cancelled' };
    }
    const writeResult = sessionExportService.saveToFile(dialogResult.filePath, result.content);
    return { success: writeResult.success, error: writeResult.error, path: dialogResult.filePath };
  }
);

ipcMain.handle('system.getTheme', () => {
  try {
    return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors };
  } catch (error) {
    logError('[IPC] Error getting theme:', error);
    return { shouldUseDarkColors: true };
  }
});

ipcMain.handle('shell.openExternal', async (_event, url: string) => {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      logWarn('[shell.openExternal] Blocked URL with disallowed protocol:', parsed.protocol);
      return false;
    }
  } catch {
    logWarn('[shell.openExternal] Blocked invalid URL:', url);
    return false;
  }

  return shell.openExternal(url);
});

async function revealFileInFolder(filePath: string, cwd?: string): Promise<boolean> {
  if (!filePath) {
    return false;
  }

  const trimInput = filePath.trim();
  if (!trimInput) {
    return false;
  }

  let normalizedPath = decodePathSafely(trimInput);

  if (normalizedPath.startsWith('file://')) {
    const localPath = localPathFromFileUrl(normalizedPath);
    if (!localPath) {
      logWarn('[shell.showItemInFolder] could not parse file URL:', normalizedPath);
      return false;
    }
    normalizedPath = localPath;
  }

  const baseDir = cwd && isAbsolute(cwd) ? cwd : getWorkingDir() || app.getPath('home');
  if (
    !isAbsolute(normalizedPath) &&
    !isWindowsDrivePath(normalizedPath) &&
    !isUncPath(normalizedPath)
  ) {
    normalizedPath = resolve(baseDir, normalizedPath);
  }

  if (
    normalizedPath.startsWith('/workspace/') ||
    /^[A-Za-z]:[/\\]workspace[/\\]/i.test(normalizedPath)
  ) {
    const relativePart = normalizedPath.startsWith('/workspace/')
      ? normalizedPath.slice('/workspace/'.length)
      : normalizedPath.replace(/^[A-Za-z]:[/\\]workspace[/\\]/i, '');
    normalizedPath = resolve(baseDir, relativePart);
  }

  if (!isUncPath(normalizedPath)) {
    normalizedPath = resolve(normalizedPath);
  }
  log('[shell.showItemInFolder] request:', { filePath, cwd, resolved: normalizedPath });

  const findFileByName = (fileName: string, roots: string[]): string | null => {
    if (!fileName) {
      return null;
    }

    const visited = new Set<string>();
    const queue = roots
      .map((root) => resolve(root))
      .filter((root) => !!root && fs.existsSync(root) && fs.statSync(root).isDirectory());

    let scannedDirs = 0;
    const MAX_DIRS = 2000;

    while (queue.length > 0 && scannedDirs < MAX_DIRS) {
      const dir = queue.shift()!;
      if (visited.has(dir)) {
        continue;
      }
      visited.add(dir);
      scannedDirs += 1;

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isFile() && entry.name === fileName) {
          return fullPath;
        }
        if (entry.isDirectory()) {
          queue.push(fullPath);
        }
      }
    }

    return null;
  };

  try {
    if (fs.existsSync(normalizedPath)) {
      const stat = fs.statSync(normalizedPath);
      if (stat.isDirectory()) {
        const openDirResult = await shell.openPath(normalizedPath);
        if (openDirResult) {
          logWarn('[shell.showItemInFolder] openPath returned warning:', openDirResult);
        }
      } else {
        if (process.platform === 'darwin') {
          try {
            execFileSync('open', ['-R', normalizedPath]);
          } catch (error) {
            logWarn(
              '[shell.showItemInFolder] open -R failed, fallback to shell.showItemInFolder:',
              error
            );
            shell.showItemInFolder(normalizedPath);
          }
        } else {
          shell.showItemInFolder(normalizedPath);
        }
      }
      return true;
    }

    const fileName = basename(normalizedPath);
    const defaultWorkingDir = getWorkingDir() || '';
    const discoveredPath = findFileByName(fileName, [
      cwd || '',
      defaultWorkingDir,
      join(app.getPath('userData'), 'default_working_dir'),
    ]);

    if (discoveredPath) {
      logWarn('[shell.showItemInFolder] resolved path not found, discovered by filename:', {
        requested: normalizedPath,
        discoveredPath,
      });
      if (process.platform === 'darwin') {
        try {
          execFileSync('open', ['-R', discoveredPath]);
        } catch (error) {
          logWarn(
            '[shell.showItemInFolder] open -R discovered file failed, fallback to shell.showItemInFolder:',
            error
          );
          shell.showItemInFolder(discoveredPath);
        }
      } else {
        shell.showItemInFolder(discoveredPath);
      }
      return true;
    }

    const parentDir = dirname(normalizedPath);
    if (parentDir && fs.existsSync(parentDir)) {
      logWarn('[shell.showItemInFolder] file not found, opening parent directory:', parentDir);
      const openParentResult = await shell.openPath(parentDir);
      if (openParentResult) {
        logWarn('[shell.showItemInFolder] openPath parent returned warning:', openParentResult);
      }
      return true;
    }

    logWarn('[shell.showItemInFolder] path and parent directory do not exist:', normalizedPath);
    return false;
  } catch (error) {
    logError('[shell.showItemInFolder] failed:', error);
    return false;
  }
}

ipcMain.handle('shell.showItemInFolder', async (_event, filePath: string, cwd?: string) => {
  return revealFileInFolder(filePath, cwd);
});

ipcMain.handle(
  'artifacts.listRecentFiles',
  async (_event, cwd: string, sinceMs: number, limit: number = 50) => {
    if (!cwd || !isAbsolute(cwd)) {
      return [];
    }
    return listRecentWorkspaceFiles(cwd, sinceMs, limit);
  }
);

ipcMain.handle('dialog.selectFiles', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    title: 'Select Files',
  });

  if (result.canceled) {
    return [];
  }

  return result.filePaths;
});

// Config IPC handlers
ipcMain.handle('config.get', () => {
  try {
    return configStore.getAll();
  } catch (error) {
    logError('[Config] Error getting config:', error);
    return {};
  }
});

ipcMain.handle('config.getPresets', () => {
  try {
    return getPiAiModelPresets();
  } catch (error) {
    logError('[Config] Error getting presets:', error);
    return [];
  }
});

const buildAgentRuntimeSignature = (config: AppConfig): string =>
  JSON.stringify({
    provider: config.provider,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    customProtocol: config.customProtocol,
    model: config.model,
    enableThinking: config.enableThinking,
  });

const syncConfigAfterMutation = async (previousConfig: AppConfig) => {
  // Mark as configured if any config set has usable credentials
  configStore.set('isConfigured', configStore.hasAnyUsableCredentials());

  // Apply to environment
  configStore.applyToEnv();

  const updatedConfig = configStore.getAll();
  const shouldReloadRunner =
    buildAgentRuntimeSignature(previousConfig) !== buildAgentRuntimeSignature(updatedConfig);
  const shouldReloadSandbox = previousConfig.sandboxEnabled !== updatedConfig.sandboxEnabled;

  if (shouldReloadRunner && engineAdapter?.updateConfig) {
    const runtimeConfig = resolveEngineRuntimeConfig(updatedConfig);
    engineAdapter.updateConfig({
      apiKey: runtimeConfig.apiKey || process.env.GROK_API_KEY || '',
      baseURL: runtimeConfig.baseURL || process.env.GROK_BASE_URL,
      model: runtimeConfig.model,
      workingDirectory: currentWorkingDir || process.cwd(),
    });
  }

  // Hot-swap the reasoning/thinking level WITHOUT a runner reload — the engine
  // adapter updates the global extended-thinking budget (read per-turn by the
  // OpenAI-compat/Grok/Ollama providers) and the Gemini default on live agents.
  if (
    previousConfig.thinkingLevel !== updatedConfig.thinkingLevel &&
    engineAdapter?.setThinkingLevel
  ) {
    await engineAdapter
      .setThinkingLevel(updatedConfig.thinkingLevel)
      .catch((err) => logError('[Config] thinkingLevel hot-swap failed:', err));
  }

  if (sessionManager) {
    if (shouldReloadRunner) {
      sessionManager.reloadConfig();
    }
    if (shouldReloadSandbox) {
      await sessionManager
        .reloadSandbox()
        .catch((err) => logError('[Config] Sandbox reload failed:', err));
    }
    if (shouldReloadRunner || shouldReloadSandbox) {
      log(
        '[Config] Session manager config synced:',
        JSON.stringify({ runnerReloaded: shouldReloadRunner, sandboxReloaded: shouldReloadSandbox })
      );
    }
  }

  // Notify renderer of config update
  const isConfigured = configStore.isConfigured();
  sendToRenderer({
    type: 'config.status',
    payload: {
      isConfigured,
      config: updatedConfig,
    },
  });
  log('[Config] Notified renderer of config update, isConfigured:', isConfigured);
  return updatedConfig;
};

ipcMain.handle('config.save', async (_event, newConfig: Partial<AppConfig>) => {
  log('[Config] Saving config:', { ...newConfig, apiKey: newConfig.apiKey ? '***' : '' });

  const previousConfig = configStore.getAll();
  // Update config
  configStore.update(newConfig);
  const updatedConfig = await syncConfigAfterMutation(previousConfig);

  return { success: true, config: updatedConfig };
});

ipcMain.handle('config.createSet', async (_event, payload: CreateConfigSetPayload) => {
  log('[Config] Creating config set:', payload);
  const previousConfig = configStore.getAll();
  configStore.createSet(payload);
  const updatedConfig = await syncConfigAfterMutation(previousConfig);
  return { success: true, config: updatedConfig };
});

ipcMain.handle('config.renameSet', async (_event, payload: { id: string; name: string }) => {
  log('[Config] Renaming config set:', payload);
  const previousConfig = configStore.getAll();
  configStore.renameSet(payload);
  const updatedConfig = await syncConfigAfterMutation(previousConfig);
  return { success: true, config: updatedConfig };
});

ipcMain.handle('config.deleteSet', async (_event, payload: { id: string }) => {
  log('[Config] Deleting config set:', payload);
  const previousConfig = configStore.getAll();
  configStore.deleteSet(payload);
  const updatedConfig = await syncConfigAfterMutation(previousConfig);
  return { success: true, config: updatedConfig };
});

ipcMain.handle('config.switchSet', async (_event, payload: { id: string }) => {
  log('[Config] Switching config set:', payload);
  const previousConfig = configStore.getAll();
  configStore.switchSet(payload);
  const updatedConfig = await syncConfigAfterMutation(previousConfig);
  return { success: true, config: updatedConfig };
});

ipcMain.handle('config.isConfigured', () => {
  try {
    return configStore.isConfigured();
  } catch (error) {
    logError('[Config] Error checking configured status:', error);
    return false;
  }
});

ipcMain.handle('config.test', async (_event, payload: ApiTestInput): Promise<ApiTestResult> => {
  try {
    return await runConfigApiTest(payload, configStore.getAll());
  } catch (error) {
    logError('[Config] API test failed:', error);
    return {
      ok: false,
      errorType: 'unknown',
      details: error instanceof Error ? error.message : String(error),
    };
  }
});

ipcMain.handle(
  'config.listModels',
  async (
    _event,
    payload: { provider: AppConfig['provider']; apiKey: string; baseUrl?: string }
  ): Promise<ProviderModelInfo[]> => {
    if (payload.provider === 'ollama') {
      return listOllamaModels(payload);
    }
    if (payload.provider === 'lmstudio') {
      return listLmStudioModels(payload);
    }
    return [];
  }
);

ipcMain.handle('config.diagnose', async (_event, payload: DiagnosticInput) => {
  try {
    const { runDiagnostics } = await import('./config/api-diagnostics');
    return await runDiagnostics(payload);
  } catch (error) {
    logError('[Config] Error running diagnostics:', error);
    throw error;
  }
});

ipcMain.handle('config.discover-local', async (_event, payload?: { baseUrl?: string }) => {
  try {
    const { discoverLocalOllama } = await import('./config/api-diagnostics');
    return await discoverLocalOllama(payload);
  } catch (error) {
    logError('[Config] Error discovering local services:', error);
    return [];
  }
});

ipcMain.handle('config.discover-lmstudio-local', async (_event, payload?: { baseUrl?: string }) => {
  try {
    const { discoverLocalLmStudio } = await import('./config/api-diagnostics');
    return await discoverLocalLmStudio(payload);
  } catch (error) {
    logError('[Config] Error discovering local LM Studio:', error);
    return {
      available: false,
      baseUrl: payload?.baseUrl || 'http://localhost:1234/v1',
      status: 'unavailable',
    };
  }
});

ipcMain.handle('config.model-inventory', async (_event, payload?: { includeTailnetPeers?: boolean }) => {
  try {
    // Load the core module dynamically (the pattern used by every other main→core access) rather
    // than a static `@codebuddy/*` import — a static value import bundles core TS into the main
    // build and rollup can't resolve the aliased `.js`→`.ts`, which broke `vite build` entirely.
    const mod = await loadCoreModule<typeof import('@codebuddy/fleet/model-inventory.js')>(
      'fleet/model-inventory.js',
    );
    if (!mod) {
      return { updatedAt: new Date().toISOString(), machineLabel: '', entries: [] };
    }
    return await mod.buildModelInventory({
      includeTailnetPeers: payload?.includeTailnetPeers ?? true,
      forceCapabilityRefresh: true,
    });
  } catch (error) {
    logError('[Config] Error building model inventory:', error);
    return {
      updatedAt: new Date().toISOString(),
      machineLabel: '',
      entries: [],
    };
  }
});

// Evolution: list the code variants (versions of Code Buddy) the recursive self-improvement loop
// generated for a workspace. Read-only; loads the core store via loadCoreModule (never bundles it).
ipcMain.handle('evolve.listVariants', async (_event, cwd?: string) => {
  try {
    const mod = await loadCoreModule<typeof import('@codebuddy/agent/self-improvement/evolution/code-variant-store.js')>(
      'agent/self-improvement/evolution/code-variant-store.js',
    );
    if (!mod) return [];
    // Per-project store (mirrors the core defaultStorePath layout, keyed off the active workspace).
    const base = cwd || process.cwd();
    const store = new mod.CodeVariantStore(join(base, '.codebuddy', 'self-improvement', 'evolution', 'variants.json'));
    return store.list();
  } catch (error) {
    logError('[evolve] listVariants failed:', error);
    return [];
  }
});

// CKG (Collective Knowledge Graph) — read-only administration surface for the new-shell Knowledge
// panel — extracted to ipc/ckg-ipc.ts.
registerCkgIpcHandlers();

// AI-Scientist — READ-ONLY tracking surface for the new-shell "AI-Scientist" panel (lists the
// scored experiment variants from `buddy science`). No run/execute handler: launching an
// experiment stays CLI-only — extracted to ipc/science-ipc.ts.
registerScienceIpcHandlers();

// MCP Server + marketplace IPC handlers — extracted to ipc/mcp-ipc.ts
// (accessor injection for the runtime-reassigned sessionManager +
// mcpMarketplaceBridge mutables).
registerMcpIpcHandlers({
  getSessionManager: () => sessionManager,
  getMarketplaceBridge: () => mcpMarketplaceBridge,
});

// ── Cost dashboard IPC handlers (Claude Cowork parity Phase 2) ──────
registerCostIpcHandlers({ getCostBridge: () => costBridge });

// ── Rules editor IPC handlers (Claude Cowork parity Phase 2) ────────
registerRulesIpcHandlers({
  getRulesBridge: () => rulesBridge,
  getProjectManager: () => projectManager,
});

// ── Session branching IPC handlers (Claude Cowork parity Phase 2) ──
ipcMain.handle('session.branches', async (_event, sessionId: string) => {
  if (!sessionBranchingBridge) return [];
  return sessionBranchingBridge.listBranches(sessionId);
});

ipcMain.handle(
  'session.fork',
  async (_event, sessionId: string, name: string, fromMessageIndex?: number) => {
    if (!sessionBranchingBridge) {
      return { success: false, error: 'Branching bridge unavailable' };
    }
    return sessionBranchingBridge.fork(sessionId, name, fromMessageIndex);
  }
);

ipcMain.handle('session.checkout', async (_event, sessionId: string, branchId: string) => {
  if (!sessionBranchingBridge) {
    return { success: false, error: 'Branching bridge unavailable' };
  }
  return sessionBranchingBridge.checkout(sessionId, branchId);
});

ipcMain.handle(
  'session.mergeBranch',
  async (_event, sessionId: string, sourceBranchId: string, strategy?: 'append' | 'replace') => {
    if (!sessionBranchingBridge) {
      return { success: false, error: 'Branching bridge unavailable' };
    }
    return sessionBranchingBridge.mergeBranch(sessionId, sourceBranchId, strategy);
  }
);

ipcMain.handle('session.deleteBranch', async (_event, sessionId: string, branchId: string) => {
  if (!sessionBranchingBridge) {
    return { success: false, error: 'Branching bridge unavailable' };
  }
  return sessionBranchingBridge.deleteBranch(sessionId, branchId);
});

ipcMain.handle(
  'session.renameBranch',
  async (_event, sessionId: string, branchId: string, newName: string) => {
    if (!sessionBranchingBridge) {
      return { success: false, error: 'Branching bridge unavailable' };
    }
    return sessionBranchingBridge.renameBranch(sessionId, branchId, newName);
  }
);

// Config export/import — Claude Cowork parity Phase 2 step 19
ipcMain.handle('config.export', async () => {
  if (!configExportService) {
    return { success: false, error: 'Export service unavailable' };
  }
  try {
    const bundle = configExportService.exportBundle();
    return { success: true, bundle };
  } catch (err) {
    logError('[config.export] failed:', err);
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('config.exportToFile', async () => {
  if (!configExportService) {
    return { success: false, error: 'Export service unavailable' };
  }
  const dialogResult = await dialog.showSaveDialog({
    title: 'Export settings',
    defaultPath: `cowork-settings-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (dialogResult.canceled || !dialogResult.filePath) {
    return { success: false, error: 'Cancelled' };
  }
  return configExportService.saveToFile(dialogResult.filePath);
});

ipcMain.handle('config.importFromFile', async () => {
  if (!configExportService) {
    return { success: false, error: 'Export service unavailable' };
  }
  const dialogResult = await dialog.showOpenDialog({
    title: 'Import settings',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
    return { success: false, error: 'Cancelled' };
  }
  const loaded = configExportService.loadFromFile(dialogResult.filePaths[0]);
  if (!loaded.success || !loaded.bundle) {
    return { success: false, error: loaded.error };
  }
  const preview = configExportService.diffBundle(loaded.bundle);
  return { success: true, preview };
});

ipcMain.handle(
  'config.applyImport',
  async (_event, bundle: Record<string, unknown>, strategy: 'skip' | 'overwrite') => {
    if (!configExportService) {
      return {
        success: false,
        imported: { projects: 0, mcpServers: 0, apiUpdated: false },
        errors: ['Export service unavailable'],
      };
    }
    return configExportService.importBundle(bundle as never, strategy);
  }
);

// Activity feed — Claude Cowork parity Phase 2 step 18
ipcMain.handle('activity.recent', async (_event, limit?: number, projectId?: string) => {
  if (!activityFeed) return [];
  return activityFeed.recent(limit ?? 100, projectId);
});

ipcMain.handle('activity.clear', async () => {
  if (!activityFeed) return { success: false };
  activityFeed.clear();
  return { success: true };
});

/**
 * Runner status — used by the titlebar `RunnerBadge` to surface
 * which agentic loop is active (engine = core CodeBuddyAgent,
 * pi = legacy fallback).
 */
ipcMain.handle('runner.status', async () => {
  if (!sessionManager) {
    return { runner: 'pi', engineReady: false, bootError: null };
  }
  return sessionManager.getRunnerStatus();
});

type CompanionPerceptInput = {
  modality: 'vision' | 'hearing' | 'screen' | 'self' | 'memory' | 'tool' | 'suggestion';
  source: string;
  summary: string;
  confidence?: number;
  payload?: Record<string, unknown>;
  tags?: string[];
};

type CompanionSafetyEventInput = {
  kind: 'sense' | 'tool' | 'mission' | 'permission' | 'data';
  risk?: 'low' | 'medium' | 'high';
  action: string;
  reason: string;
  status?: 'planned' | 'allowed' | 'completed' | 'failed' | 'denied';
  source: string;
  artifactPath?: string;
  missionId?: string;
  payload?: Record<string, unknown>;
  tags?: string[];
};

async function recordCompanionPerceptFromMain(input: CompanionPerceptInput): Promise<void> {
  try {
    const activeProject = projectManager?.getActive();
    const cwd = activeProject?.workspacePath || currentWorkingDir || process.cwd();
    const mod = await loadCoreModule<{
      recordCompanionPercept: (
        input: CompanionPerceptInput,
        options: { cwd?: string }
      ) => Promise<unknown>;
    }>('companion/percepts.js');
    await mod?.recordCompanionPercept?.(input, { cwd });
  } catch (err) {
    logWarn('[companion.percept] failed to record percept:', err);
  }
}

async function recordCompanionSafetyEventFromMain(input: CompanionSafetyEventInput): Promise<void> {
  try {
    const activeProject = projectManager?.getActive();
    const cwd = activeProject?.workspacePath || currentWorkingDir || process.cwd();
    const mod = await loadCoreModule<{
      recordCompanionSafetyEvent: (
        input: CompanionSafetyEventInput,
        options: { cwd?: string }
      ) => Promise<unknown>;
    }>('companion/safety-ledger.js');
    await mod?.recordCompanionSafetyEvent?.(input, { cwd });
  } catch (err) {
    logWarn('[companion.safety] failed to record safety event:', err);
  }
}

function recordVoiceConversationEventFromMain(event: VoiceConversationEvent) {
  if (!voiceConversation) {
    voiceConversation = new VoiceConversationSession(event.timestamp);
  }
  return voiceConversation.record(event);
}

ipcMain.handle('voice.conversationStatus', async () => {
  if (!voiceConversation) {
    voiceConversation = new VoiceConversationSession();
  }
  return voiceConversation.snapshot();
});

ipcMain.handle('voice.conversationEvent', async (_event, payload: VoiceConversationEvent) => {
  try {
    return { ok: true, snapshot: recordVoiceConversationEventFromMain(payload) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('[voice.conversationEvent] failed:', message);
    return { ok: false, error: message };
  }
});

/**
 * Voice → text transcription (Phase 8 — mic button in ChatView).
 * Accepts a Buffer of audio (webm/opus from MediaRecorder works out of
 * the box), forwards it to the long-running faster-whisper worker, and
 * returns the recognized text. Errors are surfaced as `{ ok: false }`
 * so the renderer can show a clean toast without try/catch noise.
 */
ipcMain.handle(
  'voice.transcribe',
  async (
    _event,
    payload: { audio: ArrayBuffer | Uint8Array; language?: string }
  ): Promise<{
    ok: boolean;
    text?: string;
    durationMs?: number;
    provider?: string;
    fallbackFrom?: string;
    error?: string;
  }> => {
    if (!voiceBridge) {
      return { ok: false, error: 'voice bridge not initialized' };
    }
    try {
      recordVoiceConversationEventFromMain({ type: 'transcription_started' });
      const buf = Buffer.isBuffer(payload.audio)
        ? payload.audio
        : Buffer.from(payload.audio as ArrayBuffer);
      let provider = 'faster-whisper';
      let fallbackFrom: string | undefined;
      let result: { text: string; durationMs: number };
      if (kyutaiBridge?.isSttEnabled()) {
        try {
          const kyutai = await kyutaiBridge.transcribe(buf, {
            language: payload.language,
          });
          provider = 'kyutai';
          result = { text: kyutai.text, durationMs: kyutai.durationMs };
        } catch (kyutaiErr) {
          fallbackFrom = 'kyutai';
          logWarn('[voice.transcribe] Kyutai failed; falling back to faster-whisper:', kyutaiErr);
          result = await voiceBridge.transcribe(buf, {
            language: payload.language,
          });
        }
      } else {
        result = await voiceBridge.transcribe(buf, {
          language: payload.language,
        });
      }
      const { text, durationMs } = result;
      recordVoiceConversationEventFromMain({
        type: 'transcription_completed',
        transcript: text,
      });
      void recordCompanionPerceptFromMain({
        modality: 'hearing',
        source: 'cowork_voice_transcribe',
        summary: `Transcribed voice input: ${text.slice(0, 160)}`,
        confidence: text.trim() ? 0.9 : 0.2,
        payload: {
          language: payload.language || 'auto',
          durationMs,
          provider,
          fallbackFrom,
          textPreview: text.slice(0, 500),
          textLength: text.length,
        },
        tags: ['voice', 'stt', 'hearing', 'cowork', provider],
      });
      return { ok: true, text, durationMs, provider, fallbackFrom };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordVoiceConversationEventFromMain({
        type: 'transcription_failed',
        error: message,
      });
      logError('[voice.transcribe] failed:', message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle('voice.status', async () => {
  if (!voiceBridge) {
    return { available: false, error: 'bridge not initialized' };
  }
  const kyutai = kyutaiBridge?.status();
  const kyutaiActive = Boolean(kyutaiBridge?.isSttEnabled());
  return {
    available: kyutaiActive || voiceBridge.isReady() || voiceBridge.getBootError() === null,
    bootError: voiceBridge.getBootError(),
    provider: kyutaiActive ? 'kyutai' : 'faster-whisper',
    fallbackProvider: 'faster-whisper',
    kyutai,
  };
});

ipcMain.handle('voice.diagnostics', async () => {
  const kyutai = kyutaiBridge ? await kyutaiBridge.diagnostics({ timeoutMs: 750 }) : null;
  const sttProvider = kyutai?.sttEnabled ? 'kyutai' : 'faster-whisper';
  const ttsProvider = kyutai?.ttsEnabled ? 'kyutai' : 'piper';
  const result = {
    ok: true,
    checkedAt: new Date().toISOString(),
    stt: {
      provider: sttProvider,
      available:
        Boolean(kyutai?.sttEnabled) ||
        Boolean(voiceBridge?.isReady()) ||
        voiceBridge?.getBootError() === null,
      fallbackProvider: 'faster-whisper',
      fallbackAvailable: Boolean(voiceBridge?.isReady()) || voiceBridge?.getBootError() === null,
      bootError: voiceBridge?.getBootError() ?? null,
    },
    tts: {
      provider: ttsProvider,
      available: Boolean(kyutai?.ttsEnabled) || Boolean(ttsBridge?.isReady()),
      fallbackProvider: 'piper',
      fallbackAvailable: Boolean(ttsBridge?.isReady()),
      bootError: ttsBridge?.getBootError() ?? null,
    },
    kyutai,
  };

  const kyutaiStt = kyutai?.sttProbe
    ? `Kyutai STT ${kyutai.sttProbe.ok ? 'online' : 'offline'}`
    : kyutai?.sttEnabled
      ? 'Kyutai STT not probed'
      : 'Kyutai STT disabled';
  const kyutaiTts = kyutai?.ttsProbe
    ? `Kyutai TTS ${kyutai.ttsProbe.ok ? 'online' : 'offline'}`
    : kyutai?.ttsEnabled
      ? 'Kyutai TTS not probed'
      : 'Kyutai TTS disabled';
  void recordCompanionPerceptFromMain({
    modality: 'tool',
    source: 'cowork_voice_diagnostics',
    summary: `Voice diagnostics: STT ${result.stt.provider} ${result.stt.available ? 'ready' : 'not ready'}; TTS ${result.tts.provider} ${result.tts.available ? 'ready' : 'not ready'}; ${kyutaiStt}; ${kyutaiTts}.`,
    confidence: result.stt.available && result.tts.available ? 0.85 : 0.55,
    payload: {
      checkedAt: result.checkedAt,
      stt: result.stt,
      tts: result.tts,
      kyutai,
    },
    tags: ['voice', 'diagnostics', 'cowork', sttProvider, ttsProvider],
  });

  return result;
});

/**
 * Text → speech via Piper. Returns the WAV bytes for the renderer to
 * play. Renderer keeps an `<audio>` element + Blob URL alive for the
 * duration of playback then revokes the URL.
 */
ipcMain.handle(
  'voice.speak',
  async (
    _event,
    payload: { text: string; lengthScale?: number }
  ): Promise<{
    ok: boolean;
    audio?: ArrayBuffer;
    sampleRate?: number;
    durationMs?: number;
    provider?: string;
    fallbackFrom?: string;
    error?: string;
  }> => {
    const kyutaiActive = Boolean(kyutaiBridge?.isTtsEnabled());
    if (!ttsBridge && !kyutaiActive) {
      return { ok: false, error: 'tts bridge not initialized' };
    }
    if (!kyutaiActive && ttsBridge && !ttsBridge.isReady()) {
      return { ok: false, error: ttsBridge.getBootError() ?? 'tts not ready' };
    }
    try {
      if (kyutaiActive && kyutaiBridge) {
        try {
          const result = await kyutaiBridge.synthesize(payload.text);
          return {
            ok: true,
            audio: result.audio,
            sampleRate: result.sampleRate,
            durationMs: result.synthesisDurationMs,
            provider: 'kyutai',
          };
        } catch (kyutaiErr) {
          logWarn('[voice.speak] Kyutai failed; falling back to Piper:', kyutaiErr);
          if (!ttsBridge || !ttsBridge.isReady()) {
            const fallbackError = ttsBridge?.getBootError() ?? 'piper fallback not ready';
            throw new Error(
              `${kyutaiErr instanceof Error ? kyutaiErr.message : String(kyutaiErr)}; ${fallbackError}`
            );
          }
        }
      }
      if (!ttsBridge) {
        return { ok: false, error: 'tts bridge not initialized' };
      }
      const result = await ttsBridge.synthesize(payload.text, {
        lengthScale: payload.lengthScale,
      });
      return {
        ok: true,
        audio: result.audio,
        sampleRate: result.sampleRate,
        durationMs: result.synthesisDurationMs,
        provider: 'piper',
        fallbackFrom: kyutaiActive ? 'kyutai' : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('[voice.speak] failed:', message);
      return { ok: false, error: message };
    }
  }
);

ipcMain.handle('voice.ttsStatus', async () => {
  const kyutai = kyutaiBridge?.status();
  const kyutaiActive = Boolean(kyutaiBridge?.isTtsEnabled());
  if (!ttsBridge && !kyutaiActive) {
    return { available: false, bootError: 'bridge not initialized' };
  }
  return {
    available: kyutaiActive || Boolean(ttsBridge?.isReady()),
    bootError: ttsBridge?.getBootError() ?? null,
    provider: kyutaiActive ? 'kyutai' : 'piper',
    fallbackProvider: 'piper',
    kyutai,
  };
});

ipcMain.handle(
  'voice.interrupted',
  async (
    _event,
    payload: {
      reason?: 'barge_in' | 'manual' | 'new_speech' | 'stop';
      hadPlayback?: boolean;
      timestamp?: number;
    }
  ): Promise<{ ok: boolean; error?: string }> => {
    try {
      await recordCompanionSafetyEventFromMain({
        kind: 'permission',
        risk: payload.hadPlayback ? 'medium' : 'low',
        action: 'voice_playback_interrupted',
        reason:
          payload.reason === 'barge_in'
            ? 'User interrupted assistant speech to speak immediately.'
            : `Assistant speech playback interruption: ${payload.reason || 'manual'}.`,
        status: 'completed',
        source: 'cowork_voice_playback',
        payload: {
          reason: payload.reason || 'manual',
          hadPlayback: Boolean(payload.hadPlayback),
          rendererTimestamp: payload.timestamp,
        },
        tags: ['voice', 'tts', 'interrupt', payload.reason || 'manual'],
      });
      recordVoiceConversationEventFromMain({
        type: 'assistant_interrupted',
        reason: payload.reason || 'manual',
        hadPlayback: Boolean(payload.hadPlayback),
        timestamp: payload.timestamp,
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('[voice.interrupted] failed:', message);
      return { ok: false, error: message };
    }
  }
);

// Clipboard summariser (Lisa-derived) — summarizeNow / setMonitoring / status
registerClipboardIpcHandlers({ getClipboardWatcher: () => clipboardWatcher });

/**
 * Cross-session message search (Phase 3 — Global search "Messages" tab).
 * Hits SessionManager.searchMessageContent which scans the messages
 * table with a case-insensitive substring match. Returns up to `limit`
 * (capped at 200) message hits with snippets ready for direct render.
 */
ipcMain.handle('sessions.searchContent', async (_event, query: string, limit?: number) => {
  try {
    if (!sessionManager) return [];
    return sessionManager.searchMessageContent(query, Math.max(1, Math.min(limit ?? 50, 200)));
  } catch (err) {
    logError('[sessions.searchContent] failed:', err);
    return [];
  }
});

registerSessionInsightsIpcHandlers({ getSessionInsightsBridge: () => sessionInsightsBridge });

// Workflow editor — Claude Cowork parity Phase 2 step 15
ipcMain.handle('workflow.list', async () => {
  if (!workflowBridge) return [];
  try {
    return workflowBridge.list();
  } catch (err) {
    logError('[workflow.list] failed:', err);
    return [];
  }
});

ipcMain.handle('workflow.get', async (_event, id: string) => {
  if (!workflowBridge) return null;
  return workflowBridge.get(id);
});

ipcMain.handle(
  'workflow.create',
  async (
    _event,
    input: {
      name: string;
      description?: string;
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    }
  ) => {
    if (!workflowBridge) return null;
    try {
      return workflowBridge.create({
        name: input.name,
        description: input.description,
        nodes: input.nodes as never,
        edges: input.edges as never,
      });
    } catch (err) {
      logError('[workflow.create] failed:', err);
      return null;
    }
  }
);

ipcMain.handle('workflow.update', async (_event, id: string, patch: Record<string, unknown>) => {
  if (!workflowBridge) return null;
  return workflowBridge.update(id, patch as never);
});

ipcMain.handle('workflow.delete', async (_event, id: string) => {
  if (!workflowBridge) return false;
  return workflowBridge.delete(id);
});

ipcMain.handle(
  'workflow.run',
  async (_event, id: string, initialContext?: Record<string, unknown>) => {
    if (!workflowBridge) {
      return {
        success: false,
        status: 'failed',
        duration: 0,
        completedSteps: 0,
        totalSteps: 0,
        error: 'Workflow bridge unavailable',
      };
    }
    return workflowBridge.run(id, initialContext ?? {});
  }
);

ipcMain.handle(
  'workflow.approve',
  async (_event, stepId: string, approved: boolean): Promise<boolean> => {
    if (!workflowBridge) return false;
    return workflowBridge.approveStep(stepId, approved);
  }
);

// Tools list — exposes the core FormalToolRegistry's catalogue so the
// WorkflowEditor's NodeConfigTool can render a dropdown instead of a
// free-form text input. Returns an empty list if the core module isn't
// loadable (graceful degradation — the input falls back to a textfield).
ipcMain.handle('tools.list', async () => {
  try {
    const { loadCoreModule } = await import('./utils/core-loader');
    const reg = await loadCoreModule<{
      getFormalToolRegistry: () => {
        getAll: () => Array<{
          tool: { name: string };
          metadata?: { name?: string; description?: string; category?: string };
        }>;
      };
      registerBuiltinTools?: (r: unknown) => number;
    }>('tools/registry/index.js');
    if (!reg) return [];
    const registry = reg.getFormalToolRegistry();
    // Make sure the catalogue is populated (workflowBridge boot does this
    // lazily on first run; tools.list may be called earlier).
    try {
      reg.registerBuiltinTools?.(registry);
    } catch {
      /* ignore — we just return whatever was already there */
    }
    return registry.getAll().map((entry) => ({
      name: entry.tool.name,
      description: entry.metadata?.description ?? '',
      category: entry.metadata?.category ?? '',
    }));
  } catch (err) {
    logWarn('[tools.list] failed:', err);
    return [];
  }
});

// Persistent per-tool policy overrides (Capacités → Outils gating).
ipcMain.handle('tools.getOverrides', async () => {
  try {
    const { loadCoreModule } = await import('./utils/core-loader');
    const mod = await loadCoreModule<{
      getPolicyManager: () => { getToolOverrides: () => Record<string, string> };
    }>('security/tool-policy/index.js');
    return mod ? mod.getPolicyManager().getToolOverrides() : {};
  } catch (err) {
    logWarn('[tools.getOverrides] failed:', err);
    return {};
  }
});

ipcMain.handle('tools.setOverride', async (_event, { name, action }: { name: string; action: 'allow' | 'deny' | null }) => {
  try {
    const { loadCoreModule } = await import('./utils/core-loader');
    const mod = await loadCoreModule<{
      getPolicyManager: () => {
        setToolOverride: (n: string, a: string) => void;
        clearToolOverride: (n: string) => void;
        getToolOverrides: () => Record<string, string>;
      };
    }>('security/tool-policy/index.js');
    if (!mod) return { ok: false };
    const manager = mod.getPolicyManager();
    if (action === null) manager.clearToolOverride(name);
    else manager.setToolOverride(name, action);
    return { ok: true, overrides: manager.getToolOverrides() };
  } catch (err) {
    logWarn('[tools.setOverride] failed:', err);
    return { ok: false };
  }
});

ipcMain.handle('tools.hermesCatalog.get', async () => {
  try {
    return await getHermesToolCatalogForReview();
  } catch (err) {
    logWarn('[tools.hermesCatalog.get] failed:', err);
    return null;
  }
});

ipcMain.handle('tools.hermesFeatureParity.get', async () => {
  try {
    return await getHermesFeatureParityForReview();
  } catch (err) {
    logWarn('[tools.hermesFeatureParity.get] failed:', err);
    return null;
  }
});

ipcMain.handle('tools.hermesPortal.get', async () => {
  try {
    return await getHermesPortalForReview();
  } catch (err) {
    logWarn('[tools.hermesPortal.get] failed:', err);
    return null;
  }
});

ipcMain.handle('tools.hermesTrajectories.get', async () => {
  try {
    return await getHermesTrajectoriesForReview();
  } catch (err) {
    logWarn('[tools.hermesTrajectories.get] failed:', err);
    return null;
  }
});

import { exportHermesTrajectoriesBatch } from './tools/hermes-trajectories-bridge';

ipcMain.handle('tools.hermesTrajectories.export', async (_, options) => {
  try {
    const dialogResult = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Trajectories Batch',
      defaultPath: `hermes-trajectories-batch-${new Date().toISOString().split('T')[0]}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (dialogResult.canceled || !dialogResult.filePath) {
      return { success: false, error: 'Cancelled' };
    }
    const result = await exportHermesTrajectoriesBatch(options);
    if (!result.success || !result.data) {
      return { success: false, error: result.error || 'Unknown error' };
    }
    fs.writeFileSync(dialogResult.filePath, result.data);
    return { success: true, path: dialogResult.filePath };
  } catch (err) {
    logWarn('[tools.hermesTrajectories.export] failed:', err);
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('tools.hermesDoctor.get', async () => {
  try {
    return await getHermesDoctorForReview();
  } catch (err) {
    logWarn('[tools.hermesDoctor.get] failed:', err);
    return null;
  }
});

ipcMain.handle(
  'tools.hermesClaw.status',
  async (_event, payload?: { source?: string; preset?: 'full' | 'user-data' }) => {
    try {
      return await getHermesClawStatusForReview({
        preset: payload?.preset,
        source: payload?.source,
      });
    } catch (err) {
      logWarn('[tools.hermesClaw.status] failed:', err);
      return null;
    }
  }
);

ipcMain.handle(
  'tools.hermesClaw.run',
  async (
    _event,
    payload?: {
      migrateSecrets?: boolean;
      overwrite?: boolean;
      preset?: 'full' | 'user-data';
      skillConflict?: 'skip' | 'overwrite' | 'rename';
      source?: string;
      workspaceTarget?: string;
    }
  ) => {
    try {
      return await runHermesClawMigrationForReview({
        migrateSecrets: payload?.migrateSecrets,
        overwrite: payload?.overwrite,
        preset: payload?.preset,
        skillConflict: payload?.skillConflict,
        source: payload?.source,
        workspaceTarget: payload?.workspaceTarget,
      });
    } catch (err) {
      logWarn('[tools.hermesClaw.run] failed:', err);
      return { error: err instanceof Error ? err.message : String(err), ok: false };
    }
  }
);

// ── Hermes Kanban board (CRUD — CLI parity → Cowork) ────────────────
ipcMain.handle(
  'hermes.kanban.list',
  async (_event, payload?: { cwd?: string; filter?: KanbanListFilter }) => {
    try {
      const result = await listHermesKanbanCards({ cwd: payload?.cwd, filter: payload?.filter });
      if (!result) return { error: 'Kanban store is unavailable.', ok: false };
      return { boardPath: result.boardPath, cards: result.cards, ok: true };
    } catch (err) {
      logWarn('[hermes.kanban.list] failed:', err);
      return { error: err instanceof Error ? err.message : String(err), ok: false };
    }
  }
);

ipcMain.handle(
  'hermes.kanban.create',
  async (_event, payload: { cwd?: string; input: KanbanCreateInput }) => {
    try {
      const card = await createHermesKanbanCard({ cwd: payload?.cwd, input: payload.input });
      if (!card) return { error: 'Kanban store is unavailable.', ok: false };
      return { card, ok: true };
    } catch (err) {
      logWarn('[hermes.kanban.create] failed:', err);
      return { error: err instanceof Error ? err.message : String(err), ok: false };
    }
  }
);

ipcMain.handle(
  'hermes.kanban.complete',
  async (_event, payload: { comment?: string; cwd?: string; id: string }) => {
    try {
      const card = await completeHermesKanbanCard({ comment: payload?.comment, cwd: payload?.cwd, id: payload.id });
      if (!card) return { error: 'Kanban store is unavailable.', ok: false };
      return { card, ok: true };
    } catch (err) {
      logWarn('[hermes.kanban.complete] failed:', err);
      return { error: err instanceof Error ? err.message : String(err), ok: false };
    }
  }
);

ipcMain.handle(
  'hermes.kanban.block',
  async (_event, payload: { cwd?: string; id: string; reason: string }) => {
    try {
      const card = await blockHermesKanbanCard({ cwd: payload?.cwd, id: payload.id, reason: payload.reason });
      if (!card) return { error: 'Kanban store is unavailable.', ok: false };
      return { card, ok: true };
    } catch (err) {
      logWarn('[hermes.kanban.block] failed:', err);
      return { error: err instanceof Error ? err.message : String(err), ok: false };
    }
  }
);

ipcMain.handle(
  'hermes.kanban.unblock',
  async (_event, payload: { comment?: string; cwd?: string; id: string }) => {
    try {
      const card = await unblockHermesKanbanCard({ comment: payload?.comment, cwd: payload?.cwd, id: payload.id });
      if (!card) return { error: 'Kanban store is unavailable.', ok: false };
      return { card, ok: true };
    } catch (err) {
      logWarn('[hermes.kanban.unblock] failed:', err);
      return { error: err instanceof Error ? err.message : String(err), ok: false };
    }
  }
);

ipcMain.handle(
  'hermes.kanban.comment',
  async (_event, payload: { cwd?: string; id: string; text: string }) => {
    try {
      const card = await commentHermesKanbanCard({ cwd: payload?.cwd, id: payload.id, text: payload.text });
      if (!card) return { error: 'Kanban store is unavailable.', ok: false };
      return { card, ok: true };
    } catch (err) {
      logWarn('[hermes.kanban.comment] failed:', err);
      return { error: err instanceof Error ? err.message : String(err), ok: false };
    }
  }
);

ipcMain.handle(
  'hermes.kanban.link',
  async (_event, payload: { cwd?: string; id: string; label?: string; target: string }) => {
    try {
      const card = await linkHermesKanbanCard({ cwd: payload?.cwd, id: payload.id, label: payload?.label, target: payload.target });
      if (!card) return { error: 'Kanban store is unavailable.', ok: false };
      return { card, ok: true };
    } catch (err) {
      logWarn('[hermes.kanban.link] failed:', err);
      return { error: err instanceof Error ? err.message : String(err), ok: false };
    }
  }
);

ipcMain.handle(
  'hermes.kanban.unlink',
  async (_event, payload: { cwd?: string; id: string; linkRef: string }) => {
    try {
      const card = await unlinkHermesKanbanCard({ cwd: payload?.cwd, id: payload.id, linkRef: payload.linkRef });
      if (!card) return { error: 'Kanban store is unavailable.', ok: false };
      return { card, ok: true };
    } catch (err) {
      logWarn('[hermes.kanban.unlink] failed:', err);
      return { error: err instanceof Error ? err.message : String(err), ok: false };
    }
  }
);

ipcMain.handle(
  'hermes.kanban.assign',
  async (_event, payload: { assignee: string | null; cwd?: string; id: string }) => {
    try {
      const card = await assignHermesKanbanCard({ assignee: payload.assignee, cwd: payload?.cwd, id: payload.id });
      if (!card) return { error: 'Kanban store is unavailable.', ok: false };
      return { card, ok: true };
    } catch (err) {
      logWarn('[hermes.kanban.assign] failed:', err);
      return { error: err instanceof Error ? err.message : String(err), ok: false };
    }
  }
);

ipcMain.handle(
  'hermes.kanban.archive',
  async (_event, payload: { comment?: string; cwd?: string; id: string }) => {
    try {
      const card = await archiveHermesKanbanCard({ comment: payload?.comment, cwd: payload?.cwd, id: payload.id });
      if (!card) return { error: 'Kanban store is unavailable.', ok: false };
      return { card, ok: true };
    } catch (err) {
      logWarn('[hermes.kanban.archive] failed:', err);
      return { error: err instanceof Error ? err.message : String(err), ok: false };
    }
  }
);

ipcMain.handle(
  'hermes.kanban.boards.list',
  async (_event, payload?: { cwd?: string; includeArchived?: boolean }) => {
    try {
      const boards = await listHermesKanbanBoards({ cwd: payload?.cwd, includeArchived: payload?.includeArchived });
      if (!boards) return { error: 'Kanban registry is unavailable.', ok: false };
      return { boards, ok: true };
    } catch (err) {
      logWarn('[hermes.kanban.boards.list] failed:', err);
      return { error: err instanceof Error ? err.message : String(err), ok: false };
    }
  }
);

ipcMain.handle(
  'hermes.kanban.boards.create',
  async (_event, payload: { cwd?: string; name?: string; slug: string }) => {
    try {
      const board = await createHermesKanbanBoard({ cwd: payload?.cwd, name: payload?.name, slug: payload.slug });
      if (!board) return { error: 'Kanban registry is unavailable.', ok: false };
      return { board, ok: true };
    } catch (err) {
      logWarn('[hermes.kanban.boards.create] failed:', err);
      return { error: err instanceof Error ? err.message : String(err), ok: false };
    }
  }
);

ipcMain.handle(
  'hermes.kanban.boards.switch',
  async (_event, payload: { cwd?: string; slug: string }) => {
    try {
      const board = await switchHermesKanbanBoard({ cwd: payload?.cwd, slug: payload.slug });
      if (!board) return { error: 'Kanban registry is unavailable.', ok: false };
      return { board, ok: true };
    } catch (err) {
      logWarn('[hermes.kanban.boards.switch] failed:', err);
      return { error: err instanceof Error ? err.message : String(err), ok: false };
    }
  }
);

ipcMain.handle(
  'tools.hermesToolsets.get',
  async (
    _event,
    payload?: {
      profile?: string;
    }
  ) => {
    try {
      return await getHermesToolsetsForReview(payload?.profile);
    } catch (err) {
      logWarn('[tools.hermesToolsets.get] failed:', err);
      return null;
    }
  }
);

ipcMain.handle('tools.hermesProviderReadiness.get', async () => {
  try {
    return await getHermesProviderReadinessForReview();
  } catch (err) {
    logWarn('[tools.hermesProviderReadiness.get] failed:', err);
    return null;
  }
});

ipcMain.handle('tools.hermesMemoryProviders.get', async () => {
  try {
    return await getHermesMemoryProvidersForReview();
  } catch (err) {
    logWarn('[tools.hermesMemoryProviders.get] failed:', err);
    return null;
  }
});

ipcMain.handle(
  'tools.hermesMemoryProviders.probe',
  async (_event, payload?: { providerId?: string }) => {
    try {
      return await runHermesMemoryProbeForReview(payload?.providerId);
    } catch (err) {
      logWarn('[tools.hermesMemoryProviders.probe] failed:', err);
      return {
        error: err instanceof Error ? err.message : String(err),
        ok: false,
      };
    }
  }
);

ipcMain.handle('tools.hermesRuntimeBackends.get', async () => {
  try {
    return await getHermesRuntimeBackendsForReview();
  } catch (err) {
    logWarn('[tools.hermesRuntimeBackends.get] failed:', err);
    return null;
  }
});

ipcMain.handle(
  'tools.hermesRuntimeBackends.smoke',
  async (
    _event,
    payload?: {
      allowDockerSmoke?: boolean;
      allowRemoteSmoke?: boolean;
      backendId?: string;
    }
  ) => {
    try {
      const backendId = typeof payload?.backendId === 'string' ? payload.backendId : '';
      const result = await runHermesRuntimeBackendSmokeForReview(backendId, {
        allowDockerSmoke: payload?.allowDockerSmoke === true,
        allowRemoteSmoke: payload?.allowRemoteSmoke === true,
      });
      return { ok: true as const, result };
    } catch (err) {
      logWarn('[tools.hermesRuntimeBackends.smoke] failed:', err);
      return {
        error: err instanceof Error ? err.message : String(err),
        ok: false as const,
      };
    }
  }
);

ipcMain.handle('tools.hermesBrowserBackends.get', async () => {
  try {
    return await getHermesBrowserBackendsForReview();
  } catch (err) {
    logWarn('[tools.hermesBrowserBackends.get] failed:', err);
    return null;
  }
});

ipcMain.handle(
  'tools.hermesBrowserBackends.smoke',
  async (
    _event,
    payload?: {
      backendId?: string;
    }
  ) => {
    try {
      const backendId = typeof payload?.backendId === 'string' ? payload.backendId : '';
      const result = await runHermesBrowserBackendSmokeForReview(backendId);
      return { ok: true as const, result };
    } catch (err) {
      logWarn('[tools.hermesBrowserBackends.smoke] failed:', err);
      return {
        error: err instanceof Error ? err.message : String(err),
        ok: false as const,
      };
    }
  }
);

ipcMain.handle('tools.hermesProtocolGateways.get', async () => {
  try {
    return await getHermesProtocolGatewaysForReview();
  } catch (err) {
    logWarn('[tools.hermesProtocolGateways.get] failed:', err);
    return null;
  }
});

ipcMain.handle('tools.hermesProtocolGateways.smoke', async () => {
  try {
    const result = await runHermesProtocolGatewaysSmokeForReview();
    return { ok: true as const, result };
  } catch (err) {
    logWarn('[tools.hermesProtocolGateways.smoke] failed:', err);
    return {
      error: err instanceof Error ? err.message : String(err),
      ok: false as const,
    };
  }
});

ipcMain.handle('tools.hermesLocalSmoke.run', async () => {
  try {
    const result = await runHermesLocalSmokeSuiteForReview();
    return { ok: true as const, result };
  } catch (err) {
    logWarn('[tools.hermesLocalSmoke.run] failed:', err);
    return {
      error: err instanceof Error ? err.message : String(err),
      ok: false as const,
    };
  }
});

ipcMain.handle(
  'tools.hermesMobileSupervision.get',
  async (
    _event,
    payload?: {
      query?: string;
    }
  ) => {
    try {
      return await getHermesMobileSupervisionForReview(payload?.query);
    } catch (err) {
      logWarn('[tools.hermesMobileSupervision.get] failed:', err);
      return null;
    }
  }
);

ipcMain.handle(
  'tools.hermesLearningLoop.get',
  async (
    _event,
    payload?: {
      cwd?: string;
      limit?: number;
    }
  ) => {
    try {
      const payloadCwd =
        typeof payload?.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : null;
      return await getHermesLearningLoopStatusForReview({
        rootDir: payloadCwd ?? getWorkingDir() ?? process.cwd(),
        limit: payload?.limit,
      });
    } catch (err) {
      logWarn('[tools.hermesLearningLoop.get] failed:', err);
      return null;
    }
  }
);

ipcMain.handle(
  'tools.hermesLearningLoop.retrospective',
  async (
    _event,
    payload?: {
      cwd?: string;
      force?: boolean;
      runId?: string;
    }
  ) => {
    try {
      const payloadCwd =
        typeof payload?.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : null;
      const result = await runHermesLearningRetrospectiveForReview({
        rootDir: payloadCwd ?? getWorkingDir() ?? process.cwd(),
        force: payload?.force,
        runId: payload?.runId,
      });
      return {
        ok: result.ok,
        ...(result.ok ? {} : { error: result.skippedReason ?? 'Learning retrospective skipped.' }),
        result,
      };
    } catch (err) {
      logWarn('[tools.hermesLearningLoop.retrospective] failed:', err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
);

ipcMain.handle(
  'tools.hermesLearningLoop.runDoctor',
  async (
    _event,
    payload?: {
      cwd?: string;
      limit?: number;
      staleAfterMinutes?: number;
    }
  ) => {
    try {
      const payloadCwd =
        typeof payload?.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : null;
      const result = await runHermesLearningRunDoctorForReview({
        rootDir: payloadCwd ?? getWorkingDir() ?? process.cwd(),
        limit: payload?.limit,
        staleAfterMinutes: payload?.staleAfterMinutes,
      });
      return {
        ok: true,
        result,
      };
    } catch (err) {
      logWarn('[tools.hermesLearningLoop.runDoctor] failed:', err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
);

ipcMain.handle(
  'tools.skillPackage.list',
  async (
    _event,
    payload?: {
      cwd?: string;
      limit?: number;
    }
  ) => {
    try {
      const payloadCwd =
        typeof payload?.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : null;
      return await listSkillPackagesForReview({
        rootDir: payloadCwd ?? getWorkingDir() ?? process.cwd(),
        limit: payload?.limit,
      });
    } catch (err) {
      logWarn('[tools.skillPackage.list] failed:', err);
      return null;
    }
  }
);

ipcMain.handle(
  'tools.skillPackage.lifecycle',
  async (
    _event,
    payload?: {
      action?: 'enable' | 'disable' | 'deprecate';
      approvedBy?: string;
      cwd?: string;
      name?: string;
      reason?: string;
    }
  ) => {
    try {
      const payloadCwd =
        typeof payload?.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : null;
      const action = payload?.action;
      if (action !== 'enable' && action !== 'disable' && action !== 'deprecate') {
        throw new Error('Unsupported skill package lifecycle action.');
      }
      const result = await setSkillPackageLifecycleForReview({
        action,
        approvedBy: typeof payload?.approvedBy === 'string' ? payload.approvedBy : '',
        name: typeof payload?.name === 'string' ? payload.name : '',
        reason: typeof payload?.reason === 'string' ? payload.reason : undefined,
        rootDir: payloadCwd ?? getWorkingDir() ?? process.cwd(),
      });
      return { ok: true as const, ...result };
    } catch (err) {
      logWarn('[tools.skillPackage.lifecycle] failed:', err);
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
);

ipcMain.handle(
  'tools.skillPackage.rollback',
  async (
    _event,
    payload?: {
      approvedBy?: string;
      cwd?: string;
      name?: string;
      reason?: string;
      snapshotId?: string;
    }
  ) => {
    try {
      const payloadCwd =
        typeof payload?.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : null;
      const result = await rollbackSkillPackageForReview({
        approvedBy: typeof payload?.approvedBy === 'string' ? payload.approvedBy : '',
        name: typeof payload?.name === 'string' ? payload.name : '',
        reason: typeof payload?.reason === 'string' ? payload.reason : undefined,
        rootDir: payloadCwd ?? getWorkingDir() ?? process.cwd(),
        snapshotId: typeof payload?.snapshotId === 'string' ? payload.snapshotId : undefined,
      });
      return { ok: true as const, ...result };
    } catch (err) {
      logWarn('[tools.skillPackage.rollback] failed:', err);
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
);

ipcMain.handle(
  'tools.skillPackage.delete',
  async (
    _event,
    payload?: {
      approvedBy?: string;
      cwd?: string;
      name?: string;
      reason?: string;
    }
  ) => {
    try {
      const payloadCwd =
        typeof payload?.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : null;
      const result = await deleteSkillPackageForReview({
        approvedBy: typeof payload?.approvedBy === 'string' ? payload.approvedBy : '',
        name: typeof payload?.name === 'string' ? payload.name : '',
        reason: typeof payload?.reason === 'string' ? payload.reason : undefined,
        rootDir: payloadCwd ?? getWorkingDir() ?? process.cwd(),
      });
      return { ok: true as const, ...result };
    } catch (err) {
      logWarn('[tools.skillPackage.delete] failed:', err);
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
);

ipcMain.handle(
  'tools.skillPackage.update',
  async (
    _event,
    payload?: {
      approvedBy?: string;
      cwd?: string;
      force?: boolean;
      name?: string;
      reason?: string;
      version?: string;
    }
  ) => {
    try {
      const payloadCwd =
        typeof payload?.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : null;
      const result = await updateSkillPackageForReview({
        approvedBy: typeof payload?.approvedBy === 'string' ? payload.approvedBy : '',
        force: payload?.force === true,
        name: typeof payload?.name === 'string' ? payload.name : '',
        reason: typeof payload?.reason === 'string' ? payload.reason : undefined,
        rootDir: payloadCwd ?? getWorkingDir() ?? process.cwd(),
        version: typeof payload?.version === 'string' ? payload.version : undefined,
      });
      return { ok: true as const, ...result };
    } catch (err) {
      logWarn('[tools.skillPackage.update] failed:', err);
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
);

ipcMain.handle(
  'tools.skillPackage.reset',
  async (
    _event,
    payload?: {
      approvedBy?: string;
      cwd?: string;
      name?: string;
      reason?: string;
      version?: string;
    }
  ) => {
    try {
      const payloadCwd =
        typeof payload?.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : null;
      const result = await resetSkillPackageForReview({
        approvedBy: typeof payload?.approvedBy === 'string' ? payload.approvedBy : '',
        name: typeof payload?.name === 'string' ? payload.name : '',
        reason: typeof payload?.reason === 'string' ? payload.reason : undefined,
        rootDir: payloadCwd ?? getWorkingDir() ?? process.cwd(),
        version: typeof payload?.version === 'string' ? payload.version : undefined,
      });
      return { ok: true as const, ...result };
    } catch (err) {
      logWarn('[tools.skillPackage.reset] failed:', err);
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
);

ipcMain.handle(
  'tools.skillPackage.patch',
  async (
    _event,
    payload?: {
      approvedBy?: string;
      cwd?: string;
      expectedReplacements?: number;
      name?: string;
      newText?: string;
      oldText?: string;
      reason?: string;
    }
  ) => {
    try {
      const payloadCwd =
        typeof payload?.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : null;
      const result = await patchSkillPackageForReview({
        approvedBy: typeof payload?.approvedBy === 'string' ? payload.approvedBy : '',
        expectedReplacements: typeof payload?.expectedReplacements === 'number'
          ? payload.expectedReplacements
          : undefined,
        name: typeof payload?.name === 'string' ? payload.name : '',
        newText: typeof payload?.newText === 'string' ? payload.newText : undefined,
        oldText: typeof payload?.oldText === 'string' ? payload.oldText : undefined,
        reason: typeof payload?.reason === 'string' ? payload.reason : undefined,
        rootDir: payloadCwd ?? getWorkingDir() ?? process.cwd(),
      });
      return { ok: true as const, ...result };
    } catch (err) {
      logWarn('[tools.skillPackage.patch] failed:', err);
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
);

ipcMain.handle(
  'tools.learningUsage.list',
  async (
    _event,
    payload?: {
      cwd?: string;
      limit?: number;
    }
  ) => {
    try {
      const payloadCwd =
        typeof payload?.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : null;
      return await listLearningSkillUsageForReview({
        rootDir: payloadCwd ?? getWorkingDir() ?? process.cwd(),
        limit: payload?.limit,
      });
    } catch (err) {
      logWarn('[tools.learningUsage.list] failed:', err);
      return [];
    }
  }
);

ipcMain.handle(
  'tools.skillCandidate.list',
  async (
    _event,
    payload?: {
      cwd?: string;
      eligibleOnly?: boolean;
      limit?: number;
      skillRoot?: string;
    }
  ) => {
    try {
      const payloadCwd =
        typeof payload?.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : null;
      return await listSkillCandidatesForReview({
        rootDir: payloadCwd ?? getWorkingDir() ?? process.cwd(),
        eligibleOnly: payload?.eligibleOnly,
        limit: payload?.limit,
        skillRoot: payload?.skillRoot,
      });
    } catch (err) {
      logWarn('[tools.skillCandidate.list] failed:', err);
      return [];
    }
  }
);

ipcMain.handle(
  'tools.skillCandidate.install',
  async (
    _event,
    payload?: {
      approvedBy?: string;
      candidatePath?: string;
      cwd?: string;
      overwrite?: boolean;
      workspaceSkillRoot?: string;
    }
  ) => {
    try {
      const payloadCwd =
        typeof payload?.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : null;
      const candidatePath = typeof payload?.candidatePath === 'string' ? payload.candidatePath : '';
      const approvedBy = typeof payload?.approvedBy === 'string' ? payload.approvedBy : '';
      const result = await installSkillCandidateForReview({
        approvedBy,
        candidatePath,
        rootDir: payloadCwd ?? getWorkingDir() ?? process.cwd(),
        overwrite: Boolean(payload?.overwrite),
        workspaceSkillRoot: typeof payload?.workspaceSkillRoot === 'string'
          ? payload.workspaceSkillRoot
          : undefined,
      });
      return { ok: true as const, ...result };
    } catch (err) {
      logWarn('[tools.skillCandidate.install] failed:', err);
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
);

ipcMain.handle(
  'tools.lessonsVault.preview',
  async (
    _event,
    payload?: {
      category?: string;
      concept?: string;
      cwd?: string;
      includeKeywords?: boolean;
      limit?: number;
      query?: string;
      vaultDir?: string;
    }
  ) => {
    try {
      const payloadCwd =
        typeof payload?.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : null;
      return await buildLessonsVaultPreview({
        category: payload?.category,
        concept: payload?.concept,
        includeKeywords: payload?.includeKeywords,
        limit: payload?.limit,
        query: payload?.query,
        rootDir: payloadCwd ?? getWorkingDir() ?? process.cwd(),
        vaultDir: payload?.vaultDir,
      });
    } catch (err) {
      logWarn('[tools.lessonsVault.preview] failed:', err);
      return null;
    }
  }
);

ipcMain.handle(
  'tools.lessonsVault.getConceptDetails',
  async (
    _event,
    payload?: {
      conceptName: string;
      cwd?: string;
    }
  ) => {
    try {
      if (!payload?.conceptName) return null;
      const payloadCwd =
        typeof payload?.cwd === 'string' && isAbsolute(payload.cwd) ? payload.cwd : null;
      const rootDir = payloadCwd ?? getWorkingDir() ?? process.cwd();
      const { loadCoreModule } = await import('./utils/core-loader');
      const mod = await loadCoreModule<{ getLessonsTracker: (workDir: string) => { getConceptDetails?: (conceptName: string) => unknown } }>(
        'agent/lessons-tracker.js'
      );
      if (!mod?.getLessonsTracker) return null;
      const tracker = mod.getLessonsTracker(rootDir);
      if (!tracker?.getConceptDetails) return null;
      return tracker.getConceptDetails(payload.conceptName);
    } catch (err) {
      logWarn('[tools.lessonsVault.getConceptDetails] failed:', err);
      return null;
    }
  }
);

// Project templates — Claude Cowork parity Phase 2 step 12
registerTemplateIpcHandlers({ getTemplateService: () => templateService });

// File preview pane — Claude Cowork parity Phase 2 step 9
ipcMain.handle('preview.get', async (_event, filePath: string) => {
  if (!previewService) {
    return {
      kind: 'error',
      path: filePath,
      name: filePath,
      size: 0,
      mime: 'application/octet-stream',
      error: 'Preview service not ready',
    };
  }
  try {
    return await previewService.getPreview(filePath);
  } catch (err) {
    logError('[preview.get] failed:', err);
    return {
      kind: 'error',
      path: filePath,
      name: filePath,
      size: 0,
      mime: 'application/octet-stream',
      error: (err as Error).message ?? 'Unknown error',
    };
  }
});

// Workspace presets — Claude Cowork parity Phase 3 step 9
registerWorkspacePresetsIpcHandlers();

// A2A remote agent registry — Claude Cowork parity Phase 3 step 19
registerA2aIpcHandlers();

// Reasoning trace viewer — Claude Cowork parity Phase 3 step 17
registerReasoningIpcHandlers();

// Hooks editor — Claude Cowork parity Phase 3 step 13
registerHooksIpcHandlers();

// HTTP Server bridge — boot/stop the core Code Buddy server (port 3000)
// from the Cowork UI. The server runs in-process so all bridges share
// state with Cowork.
registerServerIpcHandlers();

// Remote backend bridge (Phase B2) — connect/disconnect to a REMOTE Code
// Buddy backend's `/desktop` WebSocket. The token never crosses an
// unauthenticated boundary: it stays in the main process and is persisted
// encrypted. See remote-backend/remote-backend.ts.
ipcMain.handle(
  'remote-backend.connect',
  async (_event, payload: { url: string; token: string }) => {
    return remoteBackendManager.connect(payload?.url ?? '', payload?.token ?? '');
  }
);

ipcMain.handle('remote-backend.disconnect', async () => {
  return remoteBackendManager.disconnect();
});

ipcMain.handle('remote-backend.status', async () => {
  return remoteBackendManager.status();
});

ipcMain.handle('remote-backend.getConfig', async () => {
  // Never return the token to the renderer — only url + autoConnect.
  const cfg = remoteBackendConfigStore.getConfig();
  return { url: cfg.url, autoConnect: cfg.autoConnect, hasToken: !!cfg.token };
});

// Test runner — Claude Cowork parity Phase 3 step 12 — extracted to ipc/test-runner-ipc.ts
registerTestRunnerIpcHandlers();

// Persona switcher — Claude Cowork parity Phase 3 step 11 — extracted to ipc/persona-ipc.ts
registerPersonaIpcHandlers();

// Audit log — Claude Cowork parity Phase 3 step 10 — extracted to ipc/audit-ipc.ts
registerAuditIpcHandlers();

// Custom slash commands — Claude Cowork parity Phase 3 step 6
registerCustomCommandsIpcHandlers();

// Snippets / prompt library — Claude Cowork parity Phase 3 step 5
registerSnippetsIpcHandlers();

// Starred/bookmarked messages — Claude Cowork parity Phase 3 step 4
registerBookmarksIpcHandlers({ getBookmarksService: () => bookmarksService });

// Model capabilities lookup — Claude Cowork parity Phase 3 step 3
ipcMain.handle('model.capabilities', async (_event, model: string) => {
  try {
    return await getModelCapabilities(model ?? '');
  } catch (err) {
    logError('[model.capabilities] failed:', err);
    return {
      model,
      supportsVision: false,
      supportsReasoning: false,
      supportsToolCalls: true,
      contextWindow: 128000,
      maxOutputTokens: 8192,
    };
  }
});

// Git status panel + commit composer — Claude Cowork parity Phase 3 step 2
registerGitIpcHandlers();

// Hunk diff accept/reject — Claude Cowork parity Phase 3 step 1
registerDiffIpcHandlers();

// Global search (Cmd+K palette) — Claude Cowork parity Phase 2 step 8
ipcMain.handle('search.global', async (_event, query: string, limit?: number) => {
  if (!globalSearchService) {
    return {
      hits: [],
      totalByCategory: {
        session: 0,
        message: 0,
        memory: 0,
        knowledge: 0,
        file: 0,
      },
    };
  }
  try {
    return await globalSearchService.search(query, limit ?? 40);
  } catch (err) {
    logError('[search.global] failed:', err);
    return {
      hits: [],
      totalByCategory: {
        session: 0,
        message: 0,
        memory: 0,
        knowledge: 0,
        file: 0,
      },
    };
  }
});

// Skills API handlers
ipcMain.handle('skills.getAll', async () => {
  try {
    if (!skillsManager) {
      throw new Error('Skills manager is still starting');
    }
    return await skillsManager.listSkills();
  } catch (error) {
    logError('[Skills] Error getting skills:', error);
    throw error;
  }
});

ipcMain.handle('skills.reload', async () => {
  try {
    if (!skillsManager) {
      throw new Error('Skills manager is still starting');
    }
    // Force a full re-scan of the global skills directory then push
    // the new state through the same channel install/delete use, so
    // the engine's SKILL.md registry + the ClaudeAgentRunner's
    // per-query cache both pick up the change.
    const skills = await skillsManager.reloadAll();
    sessionManager?.invalidateSkillsSetup();
    return { success: true, count: skills.length, skills };
  } catch (error) {
    logError('[Skills] Error reloading skills:', error);
    throw error;
  }
});

ipcMain.handle('skills.install', async (_event, skillPath: string) => {
  try {
    if (!skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    const skill = await skillsManager.installSkill(skillPath);
    sessionManager?.invalidateSkillsSetup();
    return { success: true, skill };
  } catch (error) {
    logError('[Skills] Error installing skill:', error);
    throw error;
  }
});

ipcMain.handle('skills.delete', async (_event, skillId: string) => {
  try {
    if (!skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    await skillsManager.uninstallSkill(skillId);
    sessionManager?.invalidateSkillsSetup();
    return { success: true };
  } catch (error) {
    logError('[Skills] Error deleting skill:', error);
    throw error;
  }
});

ipcMain.handle('skills.setEnabled', async (_event, skillId: string, enabled: boolean) => {
  try {
    if (!skillsManager) {
      throw new Error('SkillsManager not initialized');
    }
    skillsManager.setSkillEnabled(skillId, enabled);
    sessionManager?.invalidateSkillsSetup();
    return { success: true };
  } catch (error) {
    logError('[Skills] Error toggling skill:', error);
    throw error;
  }
});

ipcMain.handle('skills.validate', async (_event, skillPath: string) => {
  try {
    if (!skillsManager) {
      return { valid: false, errors: ['SkillsManager not initialized'] };
    }
    const result = await skillsManager.validateSkillFolder(skillPath);
    return result;
  } catch (error) {
    logError('[Skills] Error validating skill:', error);
    return { valid: false, errors: ['Validation failed'] };
  }
});

ipcMain.handle('skills.getStoragePath', async () => {
  try {
    if (!skillsManager) {
      return null;
    }
    return skillsManager.getGlobalSkillsPath();
  } catch (error) {
    logError('[Skills] Error getting storage path:', error);
    return null;
  }
});

ipcMain.handle('skills.setStoragePath', async (_event, targetPath: string, migrate = true) => {
  if (!skillsManager) {
    throw new Error('SkillsManager not initialized');
  }
  const result = await skillsManager.setGlobalSkillsPath(targetPath, migrate !== false);
  sendToRenderer({
    type: 'config.status',
    payload: {
      isConfigured: configStore.isConfigured(),
      config: configStore.getAll(),
    },
  });
  return { success: true, ...result };
});

ipcMain.handle('skills.openStoragePath', async () => {
  if (!skillsManager) {
    throw new Error('SkillsManager not initialized');
  }
  const storagePath = skillsManager.getGlobalSkillsPath();
  const openResult = await shell.openPath(storagePath);
  if (openResult) {
    return { success: false, path: storagePath, error: openResult };
  }
  return { success: true, path: storagePath };
});

registerPluginsIpcHandlers({
  getPluginRuntimeService: () => pluginRuntimeService,
  getSessionManager: () => sessionManager,
});

// Window control IPC handlers
ipcMain.on('window.minimize', () => {
  try {
    mainWindow?.minimize();
  } catch (error) {
    logError('[Window] Error minimizing:', error);
  }
});

ipcMain.on('window.maximize', () => {
  try {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  } catch (error) {
    logError('[Window] Error maximizing:', error);
  }
});

ipcMain.on('window.close', () => {
  try {
    mainWindow?.close();
  } catch (error) {
    logError('[Window] Error closing:', error);
  }
});

// Sandbox IPC handlers
ipcMain.handle('sandbox.getStatus', async () => {
  try {
    const adapter = getSandboxAdapter();
    const platform = process.platform;

    if (platform === 'win32') {
      const wslStatus = await WSLBridge.checkWSLStatus();
      return {
        platform: 'win32',
        mode: adapter.initialized ? adapter.mode : 'none',
        initialized: adapter.initialized,
        wsl: wslStatus,
        lima: null,
      };
    } else if (platform === 'darwin') {
      const limaStatus = await LimaBridge.checkLimaStatus();
      return {
        platform: 'darwin',
        mode: adapter.initialized ? adapter.mode : 'native',
        initialized: adapter.initialized,
        wsl: null,
        lima: limaStatus,
      };
    } else {
      return {
        platform,
        mode: adapter.initialized ? adapter.mode : 'native',
        initialized: adapter.initialized,
        wsl: null,
        lima: null,
      };
    }
  } catch (error) {
    logError('[Sandbox] Error getting status:', error);
    return {
      platform: process.platform,
      mode: 'none',
      initialized: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

// WSL IPC handlers (Windows)
ipcMain.handle('sandbox.checkWSL', async () => {
  try {
    return await WSLBridge.checkWSLStatus();
  } catch (error) {
    logError('[Sandbox] Error checking WSL:', error);
    return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('sandbox.installNodeInWSL', async (_event, distro: string) => {
  try {
    return await WSLBridge.installNodeInWSL(distro);
  } catch (error) {
    logError('[Sandbox] Error installing Node.js:', error);
    return false;
  }
});

ipcMain.handle('sandbox.installPythonInWSL', async (_event, distro: string) => {
  try {
    return await WSLBridge.installPythonInWSL(distro);
  } catch (error) {
    logError('[Sandbox] Error installing Python:', error);
    return false;
  }
});

// Lima IPC handlers (macOS)
ipcMain.handle('sandbox.checkLima', async () => {
  try {
    return await LimaBridge.checkLimaStatus();
  } catch (error) {
    logError('[Sandbox] Error checking Lima:', error);
    return { available: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('sandbox.createLimaInstance', async () => {
  try {
    return await LimaBridge.createLimaInstance();
  } catch (error) {
    logError('[Sandbox] Error creating Lima instance:', error);
    return false;
  }
});

ipcMain.handle('sandbox.startLimaInstance', async () => {
  try {
    return await LimaBridge.startLimaInstance();
  } catch (error) {
    logError('[Sandbox] Error starting Lima instance:', error);
    return false;
  }
});

ipcMain.handle('sandbox.stopLimaInstance', async () => {
  try {
    return await LimaBridge.stopLimaInstance();
  } catch (error) {
    logError('[Sandbox] Error stopping Lima instance:', error);
    return false;
  }
});

ipcMain.handle('sandbox.installNodeInLima', async () => {
  try {
    return await LimaBridge.installNodeInLima();
  } catch (error) {
    logError('[Sandbox] Error installing Node.js in Lima:', error);
    return false;
  }
});

ipcMain.handle('sandbox.installPythonInLima', async () => {
  try {
    return await LimaBridge.installPythonInLima();
  } catch (error) {
    logError('[Sandbox] Error installing Python in Lima:', error);
    return false;
  }
});

// Logs IPC handlers (see ipc/logs-ipc.ts)
registerLogsIpcHandlers({
  appName: APP_NAME,
  getMainWindow: () => mainWindow,
  getSessionManager: () => sessionManager,
  getCurrentWorkingDir: () => currentWorkingDir,
});

// ============================================================================
// 远程控制 IPC 处理
// ============================================================================

ipcMain.handle('remote.getConfig', () => {
  try {
    return remoteConfigStore.getAll();
  } catch (error) {
    logError('[Remote] Error getting config:', error);
    return null;
  }
});

ipcMain.handle('remote.getStatus', () => {
  try {
    return remoteManager.getStatus();
  } catch (error) {
    logError('[Remote] Error getting status:', error);
    return { running: false, channels: [], activeSessions: 0, pendingPairings: 0 };
  }
});

ipcMain.handle('remote.setEnabled', async (_event, enabled: boolean) => {
  try {
    remoteConfigStore.setEnabled(enabled);

    if (enabled) {
      await remoteManager.start();
    } else {
      await remoteManager.stop();
    }

    return { success: true };
  } catch (error) {
    logError('[Remote] Error setting enabled:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.updateGatewayConfig', async (_event, config: Partial<GatewayConfig>) => {
  try {
    await remoteManager.updateGatewayConfig(config);
    return { success: true };
  } catch (error) {
    logError('[Remote] Error updating gateway config:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.updateFeishuConfig', async (_event, config: FeishuChannelConfig) => {
  try {
    await remoteManager.updateFeishuConfig(config);
    return { success: true };
  } catch (error) {
    logError('[Remote] Error updating Feishu config:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.updateSlackConfig', async (_event, config: SlackChannelConfig) => {
  try {
    await remoteManager.updateSlackConfig(config);
    return { success: true };
  } catch (error) {
    logError('[Remote] Error updating Slack config:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.getPairedUsers', () => {
  try {
    return remoteManager.getPairedUsers();
  } catch (error) {
    logError('[Remote] Error getting paired users:', error);
    return [];
  }
});

ipcMain.handle('remote.getPendingPairings', () => {
  try {
    return remoteManager.getPendingPairings();
  } catch (error) {
    logError('[Remote] Error getting pending pairings:', error);
    return [];
  }
});

ipcMain.handle('remote.approvePairing', (_event, channelType: ChannelType, userId: string) => {
  try {
    const success = remoteManager.approvePairing(channelType, userId);
    return { success };
  } catch (error) {
    logError('[Remote] Error approving pairing:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.revokePairing', (_event, channelType: ChannelType, userId: string) => {
  try {
    const success = remoteManager.revokePairing(channelType, userId);
    return { success };
  } catch (error) {
    logError('[Remote] Error revoking pairing:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.getRemoteSessions', () => {
  try {
    return remoteManager.getRemoteSessions();
  } catch (error) {
    logError('[Remote] Error getting remote sessions:', error);
    return [];
  }
});

ipcMain.handle('remote.clearRemoteSession', (_event, sessionId: string) => {
  try {
    const success = remoteManager.clearRemoteSession(sessionId);
    return { success };
  } catch (error) {
    logError('[Remote] Error clearing remote session:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('remote.getTunnelStatus', () => {
  try {
    return remoteManager.getTunnelStatus();
  } catch (error) {
    logError('[Remote] Error getting tunnel status:', error);
    return { connected: false, url: null, provider: 'none' };
  }
});

ipcMain.handle('remote.getWebhookUrl', () => {
  try {
    return remoteManager.getFeishuWebhookUrl();
  } catch (error) {
    logError('[Remote] Error getting webhook URL:', error);
    return null;
  }
});

ipcMain.handle('remote.restart', async () => {
  try {
    await remoteManager.restart();
    return { success: true };
  } catch (error) {
    logError('[Remote] Error restarting:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('schedule.list', () => {
  try {
    if (!scheduledTaskManager) return [];
    return scheduledTaskManager.list();
  } catch (error) {
    logError('[Schedule] Error listing tasks:', error);
    return [];
  }
});

ipcMain.handle('schedule.create', async (_event, payload: ScheduledTaskCreateInput) => {
  if (!scheduledTaskManager) {
    throw new Error('Scheduled task manager not initialized');
  }
  const unsupportedReason = getWorkspacePathUnsupportedReason(payload.cwd);
  if (unsupportedReason) {
    throw new Error(unsupportedReason);
  }
  const normalizedPrompt = payload.prompt.trim();
  const title = await resolveScheduledTaskTitle(normalizedPrompt, payload.cwd, payload.title);
  const metadata = buildScheduledTaskCreateMetadata(normalizedPrompt, payload.metadata);
  return scheduledTaskManager.create({
    ...payload,
    prompt: normalizedPrompt,
    title,
    metadata,
  });
});

ipcMain.handle('schedule.update', async (_event, id: string, updates: ScheduledTaskUpdateInput) => {
  if (!scheduledTaskManager) {
    throw new Error('Scheduled task manager not initialized');
  }
  const existing = scheduledTaskManager.get(id);
  if (!existing) return null;
  const nextCwd = updates.cwd ?? existing.cwd;
  const unsupportedReason = getWorkspacePathUnsupportedReason(nextCwd);
  if (unsupportedReason) {
    throw new Error(unsupportedReason);
  }
  const normalizedPrompt = updates.prompt === undefined ? existing.prompt : updates.prompt.trim();
  const normalizedUpdates: ScheduledTaskUpdateInput = {
    ...updates,
    prompt: normalizedPrompt,
  };

  if (updates.prompt !== undefined) {
    normalizedUpdates.title = await resolveScheduledTaskTitle(
      normalizedPrompt,
      updates.cwd ?? existing.cwd,
      updates.title ?? existing.title
    );
  } else if (updates.title !== undefined) {
    normalizedUpdates.title = buildScheduledTaskTitle(updates.title);
  }

  return scheduledTaskManager.update(id, normalizedUpdates);
});

ipcMain.handle('schedule.delete', (_event, id: string) => {
  if (!scheduledTaskManager) {
    throw new Error('Scheduled task manager not initialized');
  }
  return { success: scheduledTaskManager.delete(id) };
});

ipcMain.handle('schedule.toggle', (_event, id: string, enabled: boolean) => {
  if (!scheduledTaskManager) {
    throw new Error('Scheduled task manager not initialized');
  }
  return scheduledTaskManager.toggle(id, enabled);
});

ipcMain.handle('schedule.runNow', async (_event, id: string) => {
  if (!scheduledTaskManager) {
    throw new Error('Scheduled task manager not initialized');
  }
  return scheduledTaskManager.runNow(id);
});

ipcMain.handle('logs.write', (_event, level: 'info' | 'warn' | 'error', args: unknown[]) => {
  try {
    if (level === 'warn') {
      logWarn(...args);
    } else if (level === 'error') {
      logError(...args);
    } else {
      log(...args);
    }
    return { success: true };
  } catch (error) {
    console.error('[Logs] Error writing log:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('sandbox.retryLimaSetup', async () => {
  if (process.platform !== 'darwin') {
    return { success: false, error: 'Lima is only available on macOS' };
  }

  try {
    const bootstrap = getSandboxBootstrap();
    bootstrap.setProgressCallback((progress) => {
      sendToRenderer({
        type: 'sandbox.progress',
        payload: progress,
      });
    });

    try {
      await LimaBridge.stopLimaInstance();
    } catch (error) {
      logError('[Sandbox] Error stopping Lima before retry:', error);
    }

    bootstrap.reset();
    const result = await bootstrap.bootstrap();
    const success = !result.error;
    return { success, result, error: result.error };
  } catch (error) {
    logError('[Sandbox] Error retrying Lima setup:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// Generic retry setup for both WSL and Lima
ipcMain.handle('sandbox.retrySetup', async () => {
  try {
    const bootstrap = getSandboxBootstrap();
    bootstrap.setProgressCallback((progress) => {
      sendToRenderer({
        type: 'sandbox.progress',
        payload: progress,
      });
    });

    // Reset and re-run bootstrap
    bootstrap.reset();
    const result = await bootstrap.bootstrap();
    const success = !result.error;
    return { success, result, error: result.error };
  } catch (error) {
    logError('[Sandbox] Error retrying setup:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

function sendActiveSetConfigRequiredError(sessionId?: string): void {
  sendToRenderer({
    type: 'error',
    payload: {
      ...(sessionId ? { sessionId } : {}),
      message: '当前方案未配置可用凭证，请先在 API 设置中完成配置',
      code: 'CONFIG_REQUIRED_ACTIVE_SET',
      action: 'open_api_settings',
    },
  });
}

async function handleClientEvent(event: ClientEvent): Promise<unknown> {
  // Remote backend switch (Phase B2): when a remote Code Buddy backend is
  // connected, the core session.* events are proxied over the `/desktop`
  // WebSocket instead of the LOCAL session-manager. The remote backend holds
  // the credentials, so this MUST run BEFORE the local credential gate below
  // (the local app may legitimately have no provider configured).
  // Only the four events named by the B1 contract are forwardable
  // (session.start/continue/stop/list). Everything else stays local.
  if (remoteBackendManager.isConnected()) {
    // session.start: the renderer awaits a canonical Session (to add +
    // activate it and echo the user message). The remote mints the sessionId
    // and emits it as a `session.update`; resolve the invoke with that.
    if (event.type === 'session.start') {
      return remoteBackendManager.forwardStart(event);
    }
    // Other forwardable events (continue/stop/list) are fire-and-forget on the
    // renderer side; the remote answers via repiped ServerEvents. session.list
    // therefore can't return synchronously — return [] and rely on the
    // repiped `session.list` ServerEvent.
    if (remoteBackendManager.forward(event)) {
      return event.type === 'session.list' ? [] : null;
    }
  }

  // Check if configured before starting sessions
  if (event.type === 'session.start' && !configStore.hasUsableCredentialsForActiveSet()) {
    sendActiveSetConfigRequiredError();
    return null;
  }

  if (event.type === 'session.continue' && !configStore.hasUsableCredentialsForActiveSet()) {
    sendActiveSetConfigRequiredError(event.payload.sessionId);
    return null;
  }

  if (event.type === 'session.steer' && !configStore.hasUsableCredentialsForActiveSet()) {
    sendActiveSetConfigRequiredError(event.payload.sessionId);
    return null;
  }

  if (eventRequiresSessionManager(event) && !sessionManager) {
    throw new Error('Session manager not initialized');
  }
  // After the guard above, sessionManager is guaranteed non-null for session.* events.
  // Use a local alias to satisfy TypeScript's control-flow narrowing.
  const sm = sessionManager!;

  switch (event.type) {
    case 'session.start':
      if (getWorkspacePathUnsupportedReason(event.payload.cwd)) {
        sendToRenderer({
          type: 'error',
          payload: {
            message: getWorkspacePathUnsupportedReason(event.payload.cwd)!,
          },
        });
        return null;
      }
      return sm.startSession(
        event.payload.title,
        event.payload.prompt,
        event.payload.cwd,
        event.payload.projectId ?? null,
        event.payload.allowedTools,
        event.payload.content,
        event.payload.memoryEnabled
      );

    case 'session.continue':
      return sm.continueSession(
        event.payload.sessionId,
        event.payload.prompt,
        event.payload.content
      );

    case 'session.steer':
      return sm.steerSession(
        event.payload.sessionId,
        event.payload.prompt,
        event.payload.content,
        event.payload.intentId
      );

    case 'session.stop':
      return sm.stopSession(event.payload.sessionId);

    case 'session.delete':
      return sm.deleteSession(event.payload.sessionId);

    case 'session.batchDelete':
      return sm.batchDeleteSessions(event.payload.sessionIds);

    case 'session.duplicate':
      return sm.duplicateSession(event.payload.sessionId);

    case 'session.updateSettings':
      return sm.updateSessionSettings(event.payload.sessionId, {
        projectId: event.payload.updates.projectId,
        executionMode:
          event.payload.updates.executionMode === 'chat' || event.payload.updates.executionMode === 'task'
            ? event.payload.updates.executionMode
            : undefined,
        isBackground: event.payload.updates.isBackground,
        title: event.payload.updates.title,
        pinned: event.payload.updates.pinned,
        archived: event.payload.updates.archived,
        tags: event.payload.updates.tags,
        source: event.payload.updates.source,
      });

    case 'session.list': {
      const sessions = sm.listSessions();
      sendToRenderer({ type: 'session.list', payload: { sessions } });
      return sessions;
    }

    case 'session.getMessages':
      return sm.getMessages(event.payload.sessionId);

    case 'session.getTraceSteps':
      return sm.getTraceSteps(event.payload.sessionId);

    case 'permission.response':
      return sm.handlePermissionResponse(event.payload.toolUseId, event.payload.result);

    case 'sudo.password.response':
      return sm.handleSudoPasswordResponse(event.payload.toolUseId, event.payload.password);

    case 'folder.select': {
      const folderResult = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
      });
      if (!folderResult.canceled && folderResult.filePaths.length > 0) {
        sendToRenderer({
          type: 'folder.selected',
          payload: { path: folderResult.filePaths[0] },
        });
        return folderResult.filePaths[0];
      }
      return null;
    }

    case 'workdir.get':
      return getWorkingDir();

    case 'workdir.set':
      return setWorkingDir(event.payload.path, event.payload.sessionId);

    case 'workdir.select': {
      const dialogDefaultPath =
        event.payload.currentPath && isAbsolute(event.payload.currentPath)
          ? event.payload.currentPath
          : currentWorkingDir || undefined;
      const workdirResult = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
        title: 'Select Working Directory',
        defaultPath: dialogDefaultPath,
      });
      if (!workdirResult.canceled && workdirResult.filePaths.length > 0) {
        const selectedPath = workdirResult.filePaths[0];
        return setWorkingDir(selectedPath, event.payload.sessionId);
      }
      return { success: false, path: '', error: 'User cancelled' };
    }

    case 'settings.update':
      {
        const KNOWN_THEMES: AppTheme[] = [
          'dark',
          'light',
          'system',
          'ember',
          'genspark',
          'codex',
          'anthropic',
        ];
        const themeVal = event.payload.theme as AppTheme | undefined;
        if (themeVal && KNOWN_THEMES.includes(themeVal)) {
          configStore.update({ theme: themeVal });
          // Named custom themes map to a dark/light base for the native window chrome.
          const lightThemes: AppTheme[] = ['light', 'anthropic'];
          const chromeBase: AppTheme =
            themeVal === 'system' ? 'system' : lightThemes.includes(themeVal) ? 'light' : 'dark';
          applyNativeThemePreference(chromeBase);
          if (mainWindow && !mainWindow.isDestroyed()) {
            const effectiveTheme = resolveEffectiveTheme(chromeBase);
            mainWindow.setBackgroundColor(effectiveTheme === 'dark' ? DARK_BG : LIGHT_BG);
          }
        sendToRenderer({
          type: 'config.status',
          payload: {
            isConfigured: configStore.isConfigured(),
            config: configStore.getAll(),
          },
        });
        }
      }
      if (
        event.payload.memoryStrategy === 'auto' ||
        event.payload.memoryStrategy === 'manual' ||
        event.payload.memoryStrategy === 'rolling'
      ) {
        configStore.update({ memoryStrategy: event.payload.memoryStrategy });
      }
      sendToRenderer({
        type: 'config.status',
        payload: {
          isConfigured: configStore.isConfigured(),
          config: configStore.getAll(),
        },
      });
      return null;

    default:
      logWarn('Unknown event type:', event);
      return null;
  }
}
