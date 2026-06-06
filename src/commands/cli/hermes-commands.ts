/**
 * Hermes Agent CLI diagnostics.
 *
 * Exposes the native Code Buddy profile that maps Hermes Agent ideas
 * onto Fleet toolsets, skills, memory, session search, scheduling and
 * delegation.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Command } from 'commander';

import { buildChannelStatusReport, type ChannelStatusReport } from '../handlers/channel-handlers.js';
import {
  DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS,
  FLEET_DISPATCH_PROFILES,
  buildDispatchToolFilter,
  buildHermesToolsetDescriptor,
  normalizeDispatchProfile,
} from '../../fleet/dispatch-profile.js';
import {
  buildHermesAgentProfile,
  buildHermesIntegrationPlan,
  buildHermesAgentSystemPrompt,
  renderHermesIntegrationPlanMarkdown,
} from '../../agent/hermes-agent-profile.js';
import {
  buildHermesAgentDiagnostics,
  buildHermesProviderReadiness,
  type HermesProviderReadiness,
} from '../../agent/hermes-agent-diagnostics.js';
import {
  runClawMigration,
  renderClawMigrationReport,
  type ClawMigrationPreset,
  type SkillConflictMode,
} from '../../agent/hermes-claw-migrate.js';
import {
  attachOpenClawGateway,
  buildOpenClawNodeDescriptor,
  discoverOpenClawGateway,
  callOpenClawGatewayWebSocket,
  prepareOpenClawFleetHandoffDraft,
  probeOpenClawGatewayWebSocket,
  sendOpenClawResponse,
} from '../../openclaw/gateway-bridge.js';
import {
  buildHermesProtocolGatewayReadiness,
  renderHermesProtocolGatewayReadiness,
  renderHermesProtocolGatewaySmoke,
  runHermesProtocolGatewaySmoke,
} from '../../agent/hermes-protocol-gateways.js';
import {
  buildHermesParityManifest,
  buildHermesParityTodo,
  type HermesParityTodoManifest,
  renderHermesParityManifestMarkdown,
} from '../../agent/hermes-parity-manifest.js';
import {
  renderHermesToolParityManifestMarkdown,
  type HermesToolParityManifest,
} from '../../agent/hermes-tool-parity-manifest.js';
import {
  buildLocalHermesToolParityManifest,
  collectOfflineBuiltinTools,
  collectOfflineBuiltinToolNames,
} from '../../agent/hermes-tool-parity-local.js';
import {
  buildHermesToolsetCatalog,
  type HermesToolsetCatalogManifest,
} from '../../agent/hermes-toolset-catalog.js';
import {
  buildHermesHookLifecycleManifest,
  renderHermesHookLifecycleManifest,
} from '../../hooks/hermes-lifecycle-hooks.js';
import {
  buildHermesPortalStatus,
  renderHermesPortalStatus,
  type HermesPortalStatus,
} from '../../agent/hermes-portal-status.js';
import {
  buildHermesRuntimeBackendsReadiness,
  renderHermesRuntimeBackendsReadiness,
  runHermesRuntimeBackendSmoke,
  type HermesRuntimeSmokeResult,
} from '../../agent/hermes-runtime-backends.js';
import {
  buildHermesBrowserBackendsReadiness,
  renderHermesBrowserBackendsReadiness,
  renderHermesBrowserSmoke,
  runHermesBrowserBackendSmoke,
} from '../../agent/hermes-browser-backends.js';
import {
  buildHermesMemoryProvidersReadiness,
  renderHermesMemoryProvidersReadiness,
  probeMemoryProvider,
  renderHermesMemoryProbe,
} from '../../agent/hermes-memory-providers.js';
import {
  buildHermesLearningLoopStatus,
  renderHermesLearningLoopStatus,
} from '../../agent/hermes-learning-loop-status.js';
import {
  buildHermesSkillPackageSummary,
  renderHermesSkillPackageSummary,
} from '../../agent/hermes-skill-package-summary.js';
import {
  buildMobileSupervisionGatewayContract,
  type MobileSupervisionGatewayContract,
} from '../../observability/mobile-supervision-gateway-contract.js';
import {
  buildMobileSupervisionGatewayListenerShell,
  type MobileSupervisionGatewayListenerShell,
} from '../../observability/mobile-supervision-gateway-listener-shell.js';
import {
  buildMobileSupervisionPairingState,
  MOBILE_SUPERVISION_DEVICE_LABEL_MAX_CHARS,
  type MobileSupervisionPairingState,
} from '../../observability/mobile-supervision-pairing-state.js';
import {
  buildMobileSupervisionApprovalQueue,
  type MobileSupervisionApprovalQueue,
} from '../../observability/mobile-supervision-approval-queue.js';
import {
  buildHermesTrajectoryCompatibilityReport,
  renderHermesTrajectoryCompatibilityReport,
} from '../../observability/hermes-trajectory-compatibility.js';
import {
  KanbanStore,
  type CreateKanbanCardInput,
  type KanbanPriority,
  type KanbanStatus,
  type ListKanbanCardsFilter,
} from '../../kanban/kanban-store.js';
import { KanbanBoardRegistry } from '../../kanban/kanban-board-registry.js';
import { isFeatureEnabled } from '../../config/feature-flags.js';
import { getUserModel } from '../../memory/user-model.js';
import { filterTools } from '../../utils/tool-filter.js';

interface HermesCommandOptions {
  json?: boolean;
  markdown?: boolean;
  planOutput?: string;
}

interface HermesKanbanOptions extends HermesCommandOptions {
  id?: string;
  description?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  tag?: string | string[];
  active?: boolean;
  comment?: string;
  author?: string;
  reason?: string;
  target?: string;
  label?: string;
  board?: string;
  clear?: boolean;
  name?: string;
  delete?: boolean;
  includeArchived?: boolean;
}

interface HermesRuntimeSmokeOptions extends HermesCommandOptions {
  allowDocker?: boolean;
  allowRemote?: boolean;
  timeoutMs?: string;
}

interface HermesTodoOptions extends HermesCommandOptions {
  includeDeferred?: boolean;
  limit?: string;
}

interface HermesBrowserSmokeOptions extends HermesCommandOptions {
  cdpUrl?: string;
  recordingDir?: string;
}

type HermesProtocolSmokeOptions = HermesCommandOptions;

interface HermesMessagingStatusOptions extends HermesCommandOptions {
  config?: string;
}

interface HermesMobileStatusOptions extends HermesCommandOptions {
  limit?: string;
  source?: string[];
}

interface HermesTrajectoriesStatusOptions extends HermesCommandOptions {
  includeArtifactContent?: boolean;
  maxArtifactBytes?: string;
  runId?: string;
}

interface HermesLearningStatusOptions extends HermesCommandOptions {
  limit?: string;
}

interface HermesModelStatus {
  kind: 'hermes_model_status';
  schemaVersion: 1;
  ok: boolean;
  active: {
    model: string;
    provider: string;
    providerLabel: string;
    source: string;
    configured: boolean;
    credentialSources: string[];
    contextWindow: number | null;
    maxOutputTokens: number | null;
    capabilities: {
      toolCalls: boolean;
      reasoning: boolean;
      vision: boolean;
    };
  };
  setup: {
    loginCommand: string;
    accountCommand: string;
    providerMatrixCommand: string;
    doctorCommand: string;
    nextSteps: string[];
  };
  alternatives: Array<{
    provider: string;
    label: string;
    configured: boolean;
    local: boolean;
    credentialSources: string[];
    setupHints: string[];
  }>;
  issues: string[];
  recommendations: string[];
}

interface HermesPromptSizeSection {
  id: string;
  label: string;
  bytes: number;
  chars: number;
  lines: number;
}

interface HermesPromptSizeDiagnostic {
  kind: 'hermes_prompt_size_diagnostic';
  schemaVersion: 1;
  generatedAt: string;
  requestedProfile: string;
  dispatchProfile: ReturnType<typeof normalizeDispatchProfile>;
  toolsetId: string;
  source: 'offline-built-in';
  totals: {
    bytes: number;
    chars: number;
    lines: number;
  };
  tools: {
    totalBuiltinTools: number;
    activeToolSchemas: number;
    filteredToolSchemas: number;
    activeToolNames: string[];
    filteredToolNames: string[];
    largestSchemas: Array<{
      name: string;
      bytes: number;
    }>;
  };
  sections: HermesPromptSizeSection[];
  notes: string[];
}

interface HermesToolsetsCatalog {
  kind: 'hermes_toolsets_catalog';
  schemaVersion: 1;
  generatedAt: string;
  requestedProfile: string;
  activeProfile: ReturnType<typeof normalizeDispatchProfile>;
  officialSource: {
    repository: string;
    inspectedCommit: string;
    sourceFiles: string[];
  };
  previewTools: string[];
  summary: {
    totalToolsets: number;
    profiles: string[];
  };
  guidance: ReturnType<typeof buildHermesAgentProfile>['dispatchProfileGuidance'];
  activeToolset: ReturnType<typeof buildHermesToolsetDescriptor>;
  toolsets: ReturnType<typeof buildHermesToolsetDescriptor>[];
  /**
   * Official Hermes named-toolset catalog (core/composite/platform/dynamic)
   * with per-toolset readiness. Additive to the Fleet dispatch-profile view
   * above; the dispatch-profile fields remain unchanged for back-compat.
   */
  officialToolsets: HermesToolsetCatalogManifest;
  notes: string[];
}

interface HermesOverviewStatus {
  kind: 'hermes_overview_status';
  schemaVersion: 1;
  generatedAt: string;
  ok: boolean;
  requestedProfile: string;
  dispatchProfile: ReturnType<typeof normalizeDispatchProfile>;
  summary: {
    featureParity: HermesParityTodoManifest['summary'];
    toolParity: HermesToolParityManifest['summary'];
    readiness: {
      agentIdentity: boolean;
      browser: boolean;
      learning: boolean;
      memory: boolean;
      messaging: boolean;
      mobile: boolean;
      protocols: boolean;
      provider: boolean;
      runtime: boolean;
      skills: boolean;
      trajectories: boolean;
    };
  };
  readiness: {
    provider: {
      ok: boolean;
      model: string;
      modelSource: string;
      provider: string;
      label: string;
      configured: boolean;
      credentialSources: string[];
      configuredProviderCount: number;
      configuredProviderIds: string[];
      localProviderIds: string[];
      missingProviderIds: string[];
      supportsReasoning: boolean;
      supportsToolCalls: boolean;
      supportsVision: boolean;
      portalLoggedIn: boolean;
      portalToolGatewayConfigured: boolean;
      portalToolGatewayConfiguredToolKeys: string[];
      portalToolGatewayManagedToolKeys: string[];
      portalToolGatewayMissingToolKeys: string[];
    };
    runtime: {
      ok: boolean;
      availableCount: number;
      configuredRemoteCount: number;
      runnableCount: number;
      autoEligibleBackendIds: string[];
      primaryBackendId: string | null;
      fallbackBackendIds: string[];
      gatedBackendCount: number;
      gatedBackendIds: string[];
      smokeCommand: string | null;
      issueCount: number;
    };
    browser: {
      ok: boolean;
      localRunnableCount: number;
      managedConfiguredCount: number;
      autoEligibleBackendIds: string[];
      primaryBackendId: string | null;
      fallbackBackendIds: string[];
      gatedBackendCount: number;
      gatedBackendIds: string[];
      smokeCommand: string | null;
      issueCount: number;
    };
    messaging: {
      ok: boolean;
      configuredPlatformCount: number;
      configuredPlatformNames: string[];
      runtimePlatformCount: number;
      runtimePlatformNames: string[];
      promptToolPlatformNames: string[];
      missingPlatformNames: string[];
      nextConfigPlatformNames: string[];
      statusCommand: string;
    };
    mobile: {
      ok: boolean;
      routeBasePath: string;
      routeStatus: string;
      readOnlyEndpoints: number;
      draftOnlyEndpoints: number;
      blockedOperations: number;
      pendingLocalApproval: number;
      remoteExecutionDisabled: boolean;
      listenerStatus: string;
      networkExposure: string;
      pairingStatus: string;
      statusCommand: string;
      gatewayCheckCommand: string;
      serverCommand: string;
    };
    protocols: {
      ok: boolean;
      availableCount: number;
      availableCapabilityIds: string[];
      partialCount: number;
      partialCapabilityIds: string[];
      missingCount: number;
      missingCapabilityIds: string[];
      smokeCommand: string;
    };
    trajectories: {
      ok: boolean;
      total: number;
      availableCount: number;
      availableCapabilityIds: string[];
      partialCount: number;
      partialCapabilityIds: string[];
      missingCount: number;
      missingCapabilityIds: string[];
      goldenFixtureCount: number;
      policyEvalCount: number;
      statusCommand: string;
      runProbeCommand: string;
    };
    memory: {
      ok: boolean;
      activeProviderId: string;
      configuredRemoteCount: number;
      configuredRemoteProviderIds: string[];
      fallbackProviderIds: string[];
      missingOfficialCount: number;
      missingOfficialProviderIds: string[];
      registeredCount: number;
      issueCount: number;
    };
    learning: {
      ok: boolean;
      inspectedRunLimit: number;
      pendingReviewCount: number;
      pendingLessonCandidateCount: number;
      retrospectiveCoveragePercent: number;
      retrospectiveEligibleRunCount: number;
      runningRunCount: number;
      staleRunningRunCount: number;
      nextActionCommand: string;
      nextActionKind: string;
    };
    skills: {
      ok: boolean;
      installedCount: number;
      enabledCount: number;
      healthIssueCount: number;
      eligibleCandidateCount: number;
      ineligibleCandidateCount: number;
      totalCandidateCount: number;
      candidateListCommand: string;
      nextCandidate: {
        candidateId: string;
        candidatePath: string;
        eligible: boolean;
        inspectCommand: string;
        installCommand: string | null;
        reviewManifestPath: string;
        skillName: string;
      } | null;
      nextInspectCommand: string | null;
      nextCommand: string;
    };
  };
  nextActions: Array<{
    area: string;
    nextWork: string;
    priority: number;
    status: string;
    verificationCommand: string;
  }>;
  commands: {
    browser: string;
    doctor: string;
    learning: string;
    memory: string;
    messaging: string;
    mobile: string;
    parity: string;
    portal: string;
    providers: string;
    protocols: string;
    runDoctor: string;
    runtime: string;
    skills: string;
    smoke: string;
    todo: string;
    todoFull: string;
    toolsets: string;
    tools: string;
    trajectories: string;
  };
  recommendations: string[];
}

interface HermesLocalSmokeSuite {
  kind: 'hermes_local_smoke_suite';
  schemaVersion: 1;
  generatedAt: string;
  ok: boolean;
  results: {
    browser: Awaited<ReturnType<typeof runHermesBrowserBackendSmoke>>;
    protocols: Awaited<ReturnType<typeof runHermesProtocolGatewaySmoke>>;
    runtime: HermesRuntimeSmokeResult;
  };
  commands: {
    browser: string;
    protocols: string;
    runtime: string;
  };
  notes: string[];
}

interface HermesMobileSupervisionStatus {
  kind: 'hermes_mobile_supervision_status';
  schemaVersion: 1;
  generatedAt: string;
  ok: boolean;
  query: string;
  routeMount: {
    basePath: string;
    module: string;
    mountedBy: string;
    serverCommand: string;
    status: 'implemented_not_probed';
  };
  summary: {
    readOnlyEndpoints: number;
    draftOnlyEndpoints: number;
    blockedOperations: number;
    readyReadOnly: number;
    pendingLocalApproval: number;
    blockedQueueItems: number;
    totalQueueItems: number;
  };
  auth: MobileSupervisionGatewayContract['auth'];
  transport: MobileSupervisionGatewayContract['transport'];
  listener: {
    bind: MobileSupervisionGatewayListenerShell['bind'];
    mode: MobileSupervisionGatewayListenerShell['mode'];
    listener: MobileSupervisionGatewayListenerShell['transport']['listener'];
    safety: MobileSupervisionGatewayListenerShell['safety'];
  };
  endpoints: Array<Pick<
    MobileSupervisionGatewayContract['endpoints'][number],
    'action' | 'id' | 'localApprovalRequired' | 'method' | 'path' | 'sideEffects'
  >>;
  blockedOperations: Array<{
    action: string;
    reason: string;
  }>;
  approvalQueue: {
    counts: MobileSupervisionApprovalQueue['counts'];
    localOnly: boolean;
    autoDispatch: boolean;
    remoteExecutionDisabled: boolean;
  };
  pairing: {
    deviceLabel: string;
    deviceLabelMaxChars: number;
    scopes: string[];
    status: MobileSupervisionPairingState['pairing']['status'];
    tokenIssued: boolean;
    ttlSeconds: number;
  };
  commands: {
    status: string;
    server: string;
    snapshot: string;
    contract: string;
    gatewayCheck: string;
    pairing: string;
    approvals: string;
  };
  recommendations: string[];
}

type HermesPlanOutputFormat = 'text' | 'json' | 'markdown';

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

function formatLimitedList(values: readonly string[], limit = 8): string {
  const visible = values.slice(0, limit);
  const hiddenCount = values.length - visible.length;
  return `${formatList(visible)}${hiddenCount > 0 ? ` (+${hiddenCount} more)` : ''}`;
}

function formatAllowList(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'all';
}

function formatOk(ok: boolean): string {
  return ok ? 'ok' : 'needs attention';
}

function sanitizeCredentialSource(source: string): string {
  if (path.isAbsolute(source) || source.includes('/') || source.includes('\\')) {
    return source.replace(/\\/g, '/').split('/').pop() ?? 'credential-file';
  }
  return source;
}

function sanitizeSmokeCommand(command: string | null): string | null {
  if (!command) return null;
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return path.basename(command) || 'runtime-command';
  }
  return command;
}

function redactLocalSmokeText(value: string): string {
  return value
    .replace(/trace=([^;\r\n]+)/g, 'trace=[redacted-local-path]')
    .replace(/[A-Za-z]:\\[^\r\n;]+/g, '[redacted-local-path]')
    .replace(/\/(?:Users|home|tmp|var\/folders)\/[^\r\n;]+/g, '[redacted-local-path]');
}

function sanitizeRuntimeSmokeResult(result: HermesRuntimeSmokeResult): HermesRuntimeSmokeResult {
  return {
    ...result,
    command: sanitizeSmokeCommand(result.command),
    output: redactLocalSmokeText(result.output),
    stderr: redactLocalSmokeText(result.stderr),
    stdout: redactLocalSmokeText(result.stdout),
  };
}

function sanitizeBrowserSmokeResult(
  result: Awaited<ReturnType<typeof runHermesBrowserBackendSmoke>>,
): Awaited<ReturnType<typeof runHermesBrowserBackendSmoke>> {
  return {
    ...result,
    artifacts: result.artifacts?.map((artifact) => ({
      ...artifact,
      path: path.basename(artifact.path) || '[redacted-local-path]',
    })),
    command: sanitizeSmokeCommand(result.command),
    output: redactLocalSmokeText(result.output),
    stderr: redactLocalSmokeText(result.stderr),
    stdout: redactLocalSmokeText(result.stdout),
  };
}

function parseOptionalPositiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function inferHermesPlanOutputFormat(options: HermesCommandOptions): HermesPlanOutputFormat {
  if (options.json) return 'json';
  if (options.markdown) return 'markdown';

  const ext = options.planOutput ? path.extname(options.planOutput).toLowerCase() : '';
  if (ext === '.json') return 'json';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  return 'text';
}

function renderHermesPlanJson(profileArg: string, plan: ReturnType<typeof buildHermesIntegrationPlan>): string {
  return JSON.stringify({
    requestedProfile: profileArg,
    plan,
  }, null, 2);
}

function renderHermesPlanText(plan: ReturnType<typeof buildHermesIntegrationPlan>): string {
  const lines = [
    `Hermes integration plan (${plan.dispatchProfile}, ${plan.toolsetId}):`,
    `  ${plan.summary}`,
    `  Plan schema version: ${plan.planSchemaVersion}`,
    `  Generated: ${plan.generatedAt}`,
    `  Recommended next command: ${plan.recommendedNextCommand}`,
    `  Surfaces: ${formatList(plan.surfaceIds)}`,
  ];

  lines.push('');
  lines.push('Interaction surfaces:');
  for (const surface of plan.interactionSurfaces) {
    lines.push(`  ${surface.label}: ${surface.entrypoint}`);
    lines.push(`    Primary action: ${surface.primaryAction}`);
    lines.push(`    Consumes: ${formatList(surface.consumes)}`);
    lines.push(`    Produces: ${formatList(surface.produces)}`);
    if (surface.secondaryActions.length > 0) {
      lines.push(`    Secondary actions: ${formatList(surface.secondaryActions)}`);
    }
  }

  for (const item of plan.items) {
    lines.push('');
    lines.push(item.title);
    lines.push(`  Kind: ${item.kind}`);
    lines.push(`  Risk: ${item.risk}`);
    lines.push(`  Surface: ${item.nativeSurfaceId}`);
    lines.push(`  Command: ${item.command}`);
    if (item.expectedArtifacts.length > 0) {
      lines.push(`  Expected artifacts: ${formatList(item.expectedArtifacts)}`);
    }
    lines.push(`  Acceptance criteria: ${formatList(item.acceptanceCriteria)}`);
    lines.push(`  Purpose: ${item.purpose}`);
    lines.push(`  Done when: ${item.doneWhen}`);
  }

  return lines.join('\n');
}

function renderHermesPlanOutput(
  profileArg: string,
  plan: ReturnType<typeof buildHermesIntegrationPlan>,
  format: HermesPlanOutputFormat,
): string {
  if (format === 'json') return renderHermesPlanJson(profileArg, plan);
  if (format === 'markdown') return renderHermesIntegrationPlanMarkdown(plan);
  return renderHermesPlanText(plan);
}

function writeHermesPlanOutput(outputPath: string, content: string): void {
  const outputDir = path.dirname(path.resolve(outputPath));
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, content, 'utf-8');
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function countLines(value: string): number {
  if (value.length === 0) return 0;
  return value.split(/\r\n|\r|\n/).length;
}

function sectionFromText(id: string, label: string, text: string): HermesPromptSizeSection {
  return {
    id,
    label,
    bytes: byteLength(text),
    chars: text.length,
    lines: countLines(text),
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function buildHermesIdentityStatus(profileArg: string): {
  commands: {
    doctor: string;
    profile: string;
    prompt: string;
    run: string;
  };
  identity: {
    activeToolset: string;
    agentDescription: string | null;
    agentFound: boolean;
    agentName: string | null;
    agentPath: string | null;
    dispatchProfile: string;
    disabledTools: string[];
    effectiveAllow: string[];
    effectiveDeny: string[];
    fleetDispatchProfile: string | null;
    nativeSurfaces: string[];
    promptChecks: ReturnType<typeof buildHermesAgentDiagnostics>['promptChecks'];
    requireExplicitDispatchProfile: boolean;
    runtimeMapping: ReturnType<typeof buildHermesAgentDiagnostics>['runtimeMapping'];
    source: string;
    userOverride: boolean;
  };
  kind: 'hermes_agent_identity_status';
  ok: boolean;
  requestedProfile: string;
  schemaVersion: 1;
} {
  const diagnostics = buildHermesAgentDiagnostics({ dispatchProfile: profileArg });
  const profileSuffix = diagnostics.dispatchProfile === 'balanced' ? '' : ` ${diagnostics.dispatchProfile}`;

  return {
    commands: {
      doctor: `buddy hermes doctor${profileSuffix} --json`,
      profile: `buddy hermes profile${profileSuffix} --json`,
      prompt: `buddy hermes agent${profileSuffix}`,
      run: 'buddy --agent hermes',
    },
    identity: {
      activeToolset: diagnostics.activeToolset.toolsetId,
      agentDescription: diagnostics.agentDescription,
      agentFound: diagnostics.agentFound,
      agentName: diagnostics.agentName,
      agentPath: diagnostics.agentPath,
      dispatchProfile: diagnostics.dispatchProfile,
      disabledTools: diagnostics.disabledTools,
      effectiveAllow: diagnostics.effectiveToolFilter.enabledPatterns,
      effectiveDeny: diagnostics.effectiveToolFilter.disabledPatterns,
      fleetDispatchProfile: diagnostics.fleetDispatchProfile,
      nativeSurfaces: diagnostics.nativeSurfaceIds,
      promptChecks: diagnostics.promptChecks,
      requireExplicitDispatchProfile: diagnostics.requireExplicitDispatchProfile,
      runtimeMapping: diagnostics.runtimeMapping,
      source: diagnostics.source,
      userOverride: diagnostics.userOverride,
    },
    kind: 'hermes_agent_identity_status',
    ok: diagnostics.ok,
    requestedProfile: profileArg,
    schemaVersion: 1,
  };
}

function renderHermesIdentityStatus(status: ReturnType<typeof buildHermesIdentityStatus>): string {
  return [
    `Hermes Agent identity: ${formatOk(status.ok)}`,
    `  Source: ${status.identity.source}`,
    `  User override: ${status.identity.userOverride ? 'yes' : 'no'}`,
    `  Agent path: ${status.identity.agentPath ?? 'none'}`,
    `  Name: ${status.identity.agentName ?? 'none'}`,
    `  Requested profile: ${status.requestedProfile}`,
    `  Active dispatch profile: ${status.identity.dispatchProfile}`,
    `  Agent default dispatch profile: ${status.identity.fleetDispatchProfile ?? 'none'}`,
    `  Requires explicit delegation profile: ${status.identity.requireExplicitDispatchProfile ? 'yes' : 'no'}`,
    `  Runtime mapping: ${status.identity.runtimeMapping.implementation} ` +
      `(${status.identity.runtimeMapping.codeBuddyRuntime}; upstream ${status.identity.runtimeMapping.upstreamLanguage} ` +
      `${status.identity.runtimeMapping.upstreamRuntime})`,
    `  Active toolset: ${status.identity.activeToolset}`,
    `  Native surfaces: ${formatList(status.identity.nativeSurfaces)}`,
    '  Prompt checks:',
    `    Code Buddy runtime: ${status.identity.promptChecks.mentionsCodeBuddyRuntime ? 'yes' : 'no'}`,
    `    External runtime boundary: ${status.identity.promptChecks.mentionsExternalRuntimeBoundary ? 'yes' : 'no'}`,
    `    Default toolset: ${status.identity.promptChecks.mentionsDefaultToolset ? 'yes' : 'no'}`,
    '  Guardrails:',
    `    Agent disabled tools: ${formatList(status.identity.disabledTools)}`,
    `    Effective allow: ${formatAllowList(status.identity.effectiveAllow)}`,
    `    Effective deny: ${formatList(status.identity.effectiveDeny)}`,
    '',
    'Commands:',
    `  Run: ${status.commands.run}`,
    `  Prompt: ${status.commands.prompt}`,
    `  Profile: ${status.commands.profile}`,
    `  Doctor: ${status.commands.doctor}`,
  ].join('\n');
}

async function buildHermesOverviewStatus(profileArg: string): Promise<HermesOverviewStatus> {
  const diagnostics = buildHermesAgentDiagnostics({ dispatchProfile: profileArg });
  const toolParity = buildLocalHermesToolParityManifest();
  const todo = buildHermesParityTodo({ limit: 5 });
  const protocols = buildHermesProtocolGatewayReadiness();
  const memory = buildHermesMemoryProvidersReadiness();
  const learning = buildHermesLearningLoopStatus({ limit: 5 });
  const skills = buildHermesSkillPackageSummary(process.cwd(), { limit: 5, previewChars: 0 });
  const messaging = await buildHermesMessagingGatewayStatus();
  const mobile = await buildHermesMobileSupervisionStatus();
  const trajectories = buildHermesTrajectoryCompatibilityReport();
  const profileSuffix = diagnostics.dispatchProfile === 'balanced' ? '' : ` ${diagnostics.dispatchProfile}`;
  const recommendations = [
    ...diagnostics.recommendations,
    ...diagnostics.providerReadiness.recommendations,
    ...diagnostics.runtimeBackends.recommendations,
    ...diagnostics.browserBackends.recommendations,
    ...protocols.recommendations,
    ...messaging.recommendations,
    ...mobile.recommendations,
    ...trajectories.recommendations,
    ...memory.recommendations,
    ...learning.recommendations,
    ...(skills.health.ok ? [] : [`Run ${skills.health.nextCommand} to inspect skill package health.`]),
    ...(skills.candidateReview.eligibleCount > 0
      ? [`Review ${skills.candidateReview.eligibleCount} eligible skill candidate(s) with ${skills.candidateReview.listCommand}.`]
      : []),
    ...(skills.candidateReview.eligibleCount === 0 && skills.candidateReview.ineligibleCount > 0
      ? [`Inspect ${skills.candidateReview.ineligibleCount} not-yet-eligible skill candidate(s) with ${skills.candidateReview.listCommand}.`]
      : []),
  ].filter((recommendation, index, all) => all.indexOf(recommendation) === index);
  const skillsNextCommand = skills.candidateReview.nextInspectCommand ??
    (skills.candidateReview.totalCount > 0 ? skills.candidateReview.listCommand : skills.health.nextCommand);
  const skillsNextCandidate = skills.candidateReview.samples[0];
  const todoFullCommand = todo.summary.hiddenTodoCount > 0
    ? `buddy hermes todo --limit ${todo.summary.selectedTodoCount} --json`
    : 'buddy hermes todo --json';
  const ok =
    diagnostics.ok &&
    diagnostics.providerReadiness.ok &&
    diagnostics.runtimeBackends.ok &&
    diagnostics.browserBackends.ok &&
    protocols.ok &&
    trajectories.ok &&
    memory.ok &&
    learning.ok &&
    mobile.ok &&
    skills.health.ok &&
    toolParity.summary.gaps === 0;

  return {
    kind: 'hermes_overview_status',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok,
    requestedProfile: profileArg,
    dispatchProfile: diagnostics.dispatchProfile,
    summary: {
      featureParity: todo.summary,
      toolParity: toolParity.summary,
      readiness: {
        agentIdentity: diagnostics.ok,
        browser: diagnostics.browserBackends.ok,
        learning: learning.ok,
        memory: memory.ok,
        messaging: messaging.hermes.missingPlatformCount === 0,
        mobile: mobile.ok,
        protocols: protocols.ok,
        provider: diagnostics.providerReadiness.ok,
        runtime: diagnostics.runtimeBackends.ok,
        skills: skills.health.ok,
        trajectories: trajectories.ok,
      },
    },
    readiness: {
      provider: {
        ok: diagnostics.providerReadiness.ok,
        model: diagnostics.providerReadiness.activeModel.model,
        modelSource: diagnostics.providerReadiness.activeModel.source,
        provider: diagnostics.providerReadiness.activeProvider.provider,
        label: diagnostics.providerReadiness.activeProvider.label,
        configured: diagnostics.providerReadiness.activeProvider.configured,
        credentialSources: diagnostics.providerReadiness.activeProvider.credentialSources.map(sanitizeCredentialSource),
        configuredProviderCount: diagnostics.providerReadiness.providers.filter((provider) => provider.configured).length,
        configuredProviderIds: diagnostics.providerReadiness.providers
          .filter((provider) => provider.configured)
          .map((provider) => provider.provider),
        localProviderIds: diagnostics.providerReadiness.providers
          .filter((provider) => provider.local)
          .map((provider) => provider.provider),
        missingProviderIds: diagnostics.providerReadiness.providers
          .filter((provider) => !provider.configured)
          .map((provider) => provider.provider),
        supportsReasoning: diagnostics.providerReadiness.activeModel.supportsReasoning,
        supportsToolCalls: diagnostics.providerReadiness.activeModel.supportsToolCalls,
        supportsVision: diagnostics.providerReadiness.activeModel.supportsVision,
        portalLoggedIn: diagnostics.providerReadiness.portal.portal.loggedIn,
        portalToolGatewayConfigured: diagnostics.providerReadiness.portal.portal.toolGatewayConfigured,
        portalToolGatewayConfiguredToolKeys: diagnostics.providerReadiness.portal.toolGateway.tools
          .filter((tool) => tool.configured)
          .map((tool) => tool.key),
        portalToolGatewayManagedToolKeys: diagnostics.providerReadiness.portal.toolGateway.tools
          .filter((tool) => tool.managedByNous)
          .map((tool) => tool.key),
        portalToolGatewayMissingToolKeys: diagnostics.providerReadiness.portal.toolGateway.tools
          .filter((tool) => !tool.configured)
          .map((tool) => tool.key),
      },
      runtime: {
        ok: diagnostics.runtimeBackends.ok,
        availableCount: diagnostics.runtimeBackends.availableCount,
        configuredRemoteCount: diagnostics.runtimeBackends.configuredRemoteCount,
        runnableCount: diagnostics.runtimeBackends.runnableCount,
        autoEligibleBackendIds: diagnostics.runtimeBackends.routePlan.autoEligibleBackendIds ?? [],
        primaryBackendId: diagnostics.runtimeBackends.routePlan.primaryBackendId,
        fallbackBackendIds: diagnostics.runtimeBackends.routePlan.fallbackBackendIds,
        gatedBackendCount: diagnostics.runtimeBackends.routePlan.gatedBackendIds?.length ?? 0,
        gatedBackendIds: diagnostics.runtimeBackends.routePlan.gatedBackendIds ?? [],
        smokeCommand: diagnostics.runtimeBackends.routePlan.smokeCommand,
        issueCount: diagnostics.runtimeBackends.issues.length,
      },
      browser: {
        ok: diagnostics.browserBackends.ok,
        localRunnableCount: diagnostics.browserBackends.localRunnableCount,
        managedConfiguredCount: diagnostics.browserBackends.managedConfiguredCount,
        autoEligibleBackendIds: diagnostics.browserBackends.routePlan.autoEligibleBackendIds ?? [],
        primaryBackendId: diagnostics.browserBackends.routePlan.primaryBackendId,
        fallbackBackendIds: diagnostics.browserBackends.routePlan.fallbackBackendIds,
        gatedBackendCount: diagnostics.browserBackends.routePlan.gatedBackendIds?.length ?? 0,
        gatedBackendIds: diagnostics.browserBackends.routePlan.gatedBackendIds ?? [],
        smokeCommand: diagnostics.browserBackends.routePlan.smokeCommand,
        issueCount: diagnostics.browserBackends.issues.length,
      },
      messaging: {
        ok: messaging.hermes.missingPlatformCount === 0,
        configuredPlatformCount: messaging.hermes.configuredPlatformCount,
        configuredPlatformNames: messaging.hermes.configuredPlatformNames,
        runtimePlatformCount: messaging.hermes.runtimePlatformCount,
        runtimePlatformNames: messaging.hermes.runtimePlatformNames,
        promptToolPlatformNames: messaging.hermes.promptToolPlatformNames,
        missingPlatformNames: messaging.hermes.missingPlatformNames,
        nextConfigPlatformNames: messaging.hermes.nextConfigPlatformNames,
        statusCommand: 'buddy hermes messaging status --json',
      },
      mobile: {
        ok: mobile.ok,
        routeBasePath: mobile.routeMount.basePath,
        routeStatus: mobile.routeMount.status,
        readOnlyEndpoints: mobile.summary.readOnlyEndpoints,
        draftOnlyEndpoints: mobile.summary.draftOnlyEndpoints,
        blockedOperations: mobile.summary.blockedOperations,
        pendingLocalApproval: mobile.summary.pendingLocalApproval,
        remoteExecutionDisabled: mobile.approvalQueue.remoteExecutionDisabled,
        listenerStatus: mobile.listener.listener,
        networkExposure: mobile.listener.bind.networkExposure,
        pairingStatus: mobile.pairing.status,
        statusCommand: mobile.commands.status,
        gatewayCheckCommand: mobile.commands.gatewayCheck,
        serverCommand: mobile.commands.server,
      },
      protocols: {
        ok: protocols.ok,
        availableCount: protocols.summary.availableCount,
        availableCapabilityIds: protocols.capabilities
          .filter((capability) => capability.status === 'available')
          .map((capability) => capability.id),
        partialCount: protocols.summary.partialCount,
        partialCapabilityIds: protocols.capabilities
          .filter((capability) => capability.status === 'partial')
          .map((capability) => capability.id),
        missingCount: protocols.summary.missingCount,
        missingCapabilityIds: protocols.capabilities
          .filter((capability) => capability.status === 'missing')
          .map((capability) => capability.id),
        smokeCommand: protocols.smokeCommand,
      },
      trajectories: {
        ok: trajectories.ok,
        total: trajectories.summary.total,
        availableCount: trajectories.summary.availableCount,
        availableCapabilityIds: trajectories.capabilities
          .filter((capability) => capability.status === 'available')
          .map((capability) => capability.id),
        partialCount: trajectories.summary.partialCount,
        partialCapabilityIds: trajectories.capabilities
          .filter((capability) => capability.status === 'partial')
          .map((capability) => capability.id),
        missingCount: trajectories.summary.missingCount,
        missingCapabilityIds: trajectories.capabilities
          .filter((capability) => capability.status === 'missing')
          .map((capability) => capability.id),
        goldenFixtureCount: trajectories.summary.goldenFixtureCount,
        policyEvalCount: trajectories.summary.policyEvalCount,
        statusCommand: 'buddy hermes trajectories status --json',
        runProbeCommand: 'buddy hermes trajectories status --run-id <run-id> --json',
      },
      memory: {
        ok: memory.ok,
        activeProviderId: memory.activeProviderId,
        configuredRemoteCount: memory.configuredRemoteCount,
        configuredRemoteProviderIds: memory.configuredRemoteProviderIds,
        fallbackProviderIds: memory.fallbackProviderIds,
        missingOfficialCount: memory.missingOfficialCount,
        missingOfficialProviderIds: memory.missingOfficialProviderIds,
        registeredCount: memory.registeredCount,
        issueCount: memory.issues.length,
      },
      learning: {
        ok: learning.ok,
        inspectedRunLimit: learning.summary.inspectedRunLimit,
        pendingReviewCount: learning.summary.pendingReviewCount,
        pendingLessonCandidateCount: learning.summary.pendingLessonCandidateCount,
        retrospectiveCoveragePercent: learning.summary.retrospectiveCoveragePercent,
        retrospectiveEligibleRunCount: learning.summary.retrospectiveEligibleRunCount,
        runningRunCount: learning.summary.runningRunCount,
        staleRunningRunCount: learning.summary.staleRunningRunCount,
        nextActionCommand: learning.nextAction.command,
        nextActionKind: learning.nextAction.kind,
      },
      skills: {
        ok: skills.health.ok,
        installedCount: skills.installedCount,
        enabledCount: skills.enabledCount,
        healthIssueCount: skills.health.issueCount,
        eligibleCandidateCount: skills.candidateReview.eligibleCount,
        ineligibleCandidateCount: skills.candidateReview.ineligibleCount,
        totalCandidateCount: skills.candidateReview.totalCount,
        candidateListCommand: skills.candidateReview.listCommand,
        nextCandidate: skillsNextCandidate
          ? {
            candidateId: skillsNextCandidate.candidateId,
            candidatePath: skillsNextCandidate.candidatePath,
            eligible: skillsNextCandidate.eligible,
            inspectCommand: skillsNextCandidate.inspectCommand,
            installCommand: skillsNextCandidate.installCommand ?? null,
            reviewManifestPath: skillsNextCandidate.reviewManifestPath,
            skillName: skillsNextCandidate.skillName,
          }
          : null,
        nextInspectCommand: skills.candidateReview.nextInspectCommand ?? null,
        nextCommand: skillsNextCommand,
      },
    },
    nextActions: todo.todos.map((item) => ({
      area: item.area,
      nextWork: item.nextWork,
      priority: item.priority,
      status: item.status,
      verificationCommand: item.verificationCommand,
    })),
    commands: {
      browser: 'buddy hermes browser status --json',
      doctor: `buddy hermes doctor${profileSuffix} --json`,
      learning: 'buddy hermes learning status --json',
      memory: 'buddy hermes memory status --json',
      messaging: 'buddy hermes messaging status --json',
      mobile: 'buddy hermes mobile status --json',
      parity: 'buddy hermes parity --json',
      portal: 'buddy hermes portal status --json',
      providers: 'buddy hermes providers status --json',
      protocols: 'buddy hermes protocols status --json',
      runDoctor: learning.commands.runDoctor,
      runtime: 'buddy hermes runtime status --json',
      skills: 'buddy hermes skills status --json',
      smoke: 'buddy hermes smoke --json',
      todo: 'buddy hermes todo --json',
      todoFull: todoFullCommand,
      toolsets: `buddy hermes toolsets ${diagnostics.dispatchProfile} --json`,
      tools: 'buddy hermes tools --json',
      trajectories: 'buddy hermes trajectories status --json',
    },
    recommendations,
  };
}

function renderHermesOverviewStatus(status: HermesOverviewStatus): string {
  const readiness = status.readiness;
  const rows = [
    ['Agent identity', status.summary.readiness.agentIdentity],
    ['Provider/model', status.summary.readiness.provider],
    ['Runtime route', status.summary.readiness.runtime],
    ['Browser route', status.summary.readiness.browser],
    ['Messaging gateway', status.summary.readiness.messaging],
    ['Mobile supervision', status.summary.readiness.mobile],
    ['Protocols', status.summary.readiness.protocols],
    ['Trajectory recall', status.summary.readiness.trajectories],
    ['Memory', status.summary.readiness.memory],
    ['Learning loop', status.summary.readiness.learning],
    ['Skills', status.summary.readiness.skills],
  ] as const;
  const lines = [
    `Hermes status: ${formatOk(status.ok)}`,
    `  Requested profile: ${status.requestedProfile}`,
    `  Active dispatch profile: ${status.dispatchProfile}`,
    `  Feature parity: ${status.summary.featureParity.total} tracked, ` +
      `${status.summary.featureParity.activeTodoCount} active todo(s), ` +
      `${status.summary.featureParity.deferredCount} deferred`,
    `  Tool parity: ${status.summary.toolParity.total} tracked, ` +
      `${status.summary.toolParity.gaps} gap(s), ${status.summary.toolParity.partial} partial`,
    '',
    'Readiness:',
  ];

  for (const [label, ok] of rows) {
    lines.push(`  - ${label}: ${formatOk(ok)}`);
  }

  lines.push(
    '',
    'Routes:',
    `  Provider: ${readiness.provider.label} / ${readiness.provider.model} ` +
      `(${readiness.provider.configured ? 'configured' : 'missing'})`,
    `  Providers: configured ${formatList(readiness.provider.configuredProviderIds)} ` +
      `(local: ${formatList(readiness.provider.localProviderIds)}, ` +
      `missing: ${formatList(readiness.provider.missingProviderIds)})`,
    `  Tool Gateway: configured ${formatList(readiness.provider.portalToolGatewayConfiguredToolKeys)} ` +
      `(via Nous: ${formatList(readiness.provider.portalToolGatewayManagedToolKeys)}, ` +
      `missing: ${formatList(readiness.provider.portalToolGatewayMissingToolKeys)})`,
    `  Runtime: ${readiness.runtime.primaryBackendId ?? 'none'} ` +
      `-> ${formatList(readiness.runtime.fallbackBackendIds)} ` +
      `(auto: ${formatList(readiness.runtime.autoEligibleBackendIds)}, gated: ${formatList(readiness.runtime.gatedBackendIds)})`,
    `  Browser: ${readiness.browser.primaryBackendId ?? 'none'} ` +
      `-> ${formatList(readiness.browser.fallbackBackendIds)} ` +
      `(auto: ${formatList(readiness.browser.autoEligibleBackendIds)}, gated: ${formatList(readiness.browser.gatedBackendIds)})`,
    `  Messaging: configured ${formatLimitedList(readiness.messaging.configuredPlatformNames, 6)} ` +
      `(runtime: ${formatLimitedList(readiness.messaging.runtimePlatformNames, 6)}, ` +
      `prompt-tools: ${formatLimitedList(readiness.messaging.promptToolPlatformNames, 6)}, ` +
      `next: ${formatLimitedList(readiness.messaging.nextConfigPlatformNames, 6)})`,
    `  Mobile: ${readiness.mobile.routeBasePath} ${readiness.mobile.routeStatus} ` +
      `(read=${readiness.mobile.readOnlyEndpoints}, draft=${readiness.mobile.draftOnlyEndpoints}, ` +
      `pending=${readiness.mobile.pendingLocalApproval}, remoteExecDisabled=${readiness.mobile.remoteExecutionDisabled ? 'yes' : 'no'})`,
    `  Memory: ${readiness.memory.activeProviderId} ` +
      `(remote: ${formatList(readiness.memory.configuredRemoteProviderIds)}, ` +
      `fallback: ${formatList(readiness.memory.fallbackProviderIds)}, ` +
      `missing: ${formatList(readiness.memory.missingOfficialProviderIds)})`,
    `  Learning: ${readiness.learning.pendingReviewCount} review item(s), ` +
      `${readiness.learning.retrospectiveCoveragePercent}% retrospective coverage, ` +
      `${readiness.learning.runningRunCount} running / ` +
      `${readiness.learning.staleRunningRunCount} stale ` +
      `(limit ${readiness.learning.inspectedRunLimit})`,
    `  Protocols: available ${formatList(readiness.protocols.availableCapabilityIds)} ` +
      `(partial: ${formatList(readiness.protocols.partialCapabilityIds)}, ` +
      `missing: ${formatList(readiness.protocols.missingCapabilityIds)})`,
    `  Trajectories: available ${formatLimitedList(readiness.trajectories.availableCapabilityIds, 5)} ` +
      `(partial: ${formatLimitedList(readiness.trajectories.partialCapabilityIds, 5)}, ` +
      `missing: ${formatLimitedList(readiness.trajectories.missingCapabilityIds, 5)}, ` +
      `golden=${readiness.trajectories.goldenFixtureCount}, policy=${readiness.trajectories.policyEvalCount})`,
    `  Skills: ${readiness.skills.enabledCount}/${readiness.skills.installedCount} enabled, ` +
      `candidates ${readiness.skills.eligibleCandidateCount} eligible / ` +
      `${readiness.skills.ineligibleCandidateCount} not eligible`,
    `  Protocol smoke: ${readiness.protocols.smokeCommand}`,
  );
  if (readiness.skills.nextCandidate) {
    lines.push(`  Next skill candidate: ${readiness.skills.nextCandidate.inspectCommand}`);
  }

  if (status.nextActions.length > 0) {
    lines.push('', 'Next actions:');
    if (status.summary.featureParity.hiddenTodoCount > 0) {
      lines.push(
        `  Showing top ${status.summary.featureParity.shownTodoCount}/` +
          `${status.summary.featureParity.selectedTodoCount} active todo(s); ` +
          `run ${status.commands.todoFull} for the full active backlog.`,
      );
    }
    for (const item of status.nextActions) {
      lines.push(`${item.priority}. ${item.area} [${item.status}]`);
      lines.push(`   Next: ${item.nextWork}`);
      lines.push(`   Verify: ${item.verificationCommand}`);
    }
  }

  if (status.recommendations.length > 0) {
    lines.push('', 'Recommendations:');
    for (const recommendation of status.recommendations.slice(0, 8)) {
      lines.push(`  - ${recommendation}`);
    }
  }

  lines.push(
    '',
    'Commands:',
    `  Doctor: ${status.commands.doctor}`,
    `  Todo: ${status.commands.todo}`,
    `  Toolsets: ${status.commands.toolsets}`,
    `  Portal: ${status.commands.portal}`,
    `  Messaging: ${status.commands.messaging}`,
    `  Mobile: ${status.commands.mobile}`,
    `  Trajectories: ${status.commands.trajectories}`,
    `  Run doctor: ${status.commands.runDoctor}`,
    `  Aggregate local smoke: ${status.commands.smoke}`,
    `  Real runtime smoke: ${readiness.runtime.smokeCommand ?? 'n/a'}`,
    `  Real browser smoke: ${readiness.browser.smokeCommand ?? 'n/a'}`,
  );

  return lines.join('\n');
}

async function runHermesLocalSmokeSuite(): Promise<HermesLocalSmokeSuite> {
  const [runtime, browser, protocols] = await Promise.all([
    Promise.resolve(runHermesRuntimeBackendSmoke({ backendId: 'auto' })),
    runHermesBrowserBackendSmoke({ backendId: 'auto' }),
    runHermesProtocolGatewaySmoke(),
  ]);

  return {
    kind: 'hermes_local_smoke_suite',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: runtime.ok && browser.ok && protocols.ok,
    results: {
      browser: sanitizeBrowserSmokeResult(browser),
      protocols,
      runtime: sanitizeRuntimeSmokeResult(runtime),
    },
    commands: {
      browser: 'buddy hermes browser-smoke auto --json',
      protocols: 'buddy hermes protocols-smoke local --json',
      runtime: 'buddy hermes runtime-smoke auto --json',
    },
    notes: [
      'Runs only the safe local-first Hermes smoke path: local runtime route, local Playwright route, and local protocol gateways.',
      'Remote providers, Docker image pulls, and managed browser backends are intentionally not invoked by this suite.',
    ],
  };
}

function renderHermesLocalSmokeSuite(suite: HermesLocalSmokeSuite): string {
  return [
    `Hermes local smoke: ${formatOk(suite.ok)}`,
    `  Runtime: ${suite.results.runtime.status} (${suite.results.runtime.backendId}, ${suite.results.runtime.durationMs}ms)`,
    `  Browser: ${suite.results.browser.status} (${suite.results.browser.backendId}, ${suite.results.browser.durationMs}ms)`,
    `  Protocols: ${suite.results.protocols.ok ? 'passed' : 'failed'} (${suite.results.protocols.durationMs}ms)`,
    `  MCP stdio: ${suite.results.protocols.mcpStdio.ok ? 'ok' : 'failed'} (${suite.results.protocols.mcpStdio.toolCount} tools)`,
    `  HTTP routes: ${suite.results.protocols.httpRoutes.ok ? 'ok' : 'failed'}`,
    '',
    'Commands:',
    `  Runtime: ${suite.commands.runtime}`,
    `  Browser: ${suite.commands.browser}`,
    `  Protocols: ${suite.commands.protocols}`,
    '',
    'Notes:',
    ...suite.notes.map((note) => `  - ${note}`),
  ].join('\n');
}

function readFileSizeIfPresent(filePath: string): number {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

function buildLocalMemoryFootprint(cwd: string): Record<string, number> {
  return {
    projectMemoryMarkdownBytes: readFileSizeIfPresent(path.join(cwd, '.codebuddy', 'CODEBUDDY_MEMORY.md')),
    projectUserModelBytes: readFileSizeIfPresent(path.join(cwd, '.codebuddy', 'user-model.json')),
    userMemoryMarkdownBytes: readFileSizeIfPresent(path.join(os.homedir(), '.codebuddy', 'memory.md')),
  };
}

function buildInjectedUserModelContext(cwd: string): string {
  if (!isFeatureEnabled('USER_MODEL_INJECTION')) {
    return '';
  }

  try {
    const summary = getUserModel(cwd).summarize();
    return summary ? `<user_model_context>\n${summary}\n</user_model_context>` : '';
  } catch {
    return '';
  }
}

function buildInstalledSkillsIndexFootprint(): Record<string, unknown> {
  const lockfilePath = path.join(os.homedir(), '.codebuddy', 'hub', 'lock.json');
  try {
    if (!fs.existsSync(lockfilePath)) {
      return { lockfilePath, installedSkillCount: 0, enabledSkillCount: 0, skills: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(lockfilePath, 'utf-8')) as {
      skills?: Record<string, { version?: string; enabled?: boolean; source?: string; path?: string }>;
    };
    const skills = Object.entries(parsed.skills ?? {})
      .map(([name, skill]) => ({
        name,
        version: skill.version ?? 'unknown',
        source: skill.source ?? 'unknown',
        enabled: skill.enabled !== false,
        path: skill.path ?? '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      lockfilePath,
      installedSkillCount: skills.length,
      enabledSkillCount: skills.filter((skill) => skill.enabled).length,
      skills,
    };
  } catch (err) {
    return {
      lockfilePath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function buildHermesPromptSizeDiagnostic(
  profileArg: string = 'balanced',
  cwd: string = process.cwd(),
): HermesPromptSizeDiagnostic {
  const dispatchProfile = normalizeDispatchProfile(profileArg);
  const systemPrompt = buildHermesAgentSystemPrompt(dispatchProfile);
  const profile = buildHermesAgentProfile(dispatchProfile);
  const toolset = buildHermesToolsetDescriptor(dispatchProfile);
  const plan = buildHermesIntegrationPlan(dispatchProfile);
  const allTools = collectOfflineBuiltinTools();
  const profileFilter = buildDispatchToolFilter(
    dispatchProfile,
    allTools.map((tool) => tool.function.name),
  );
  const filterResult = filterTools(allTools, profileFilter);
  const activeTools = filterResult.tools;
  const toolSchemas = stableJson(activeTools);
  const skillsIndex = stableJson(buildInstalledSkillsIndexFootprint());
  const memoryFootprint = stableJson(buildLocalMemoryFootprint(cwd));
  const userModelContext = buildInjectedUserModelContext(cwd);
  const profileJson = stableJson(profile);
  const toolsetJson = stableJson(toolset);
  const planJson = stableJson(plan);

  const sections = [
    sectionFromText('systemPrompt', 'Hermes system prompt', systemPrompt),
    sectionFromText('profile', 'Hermes profile JSON', profileJson),
    sectionFromText('toolset', 'Hermes toolset descriptor JSON', toolsetJson),
    sectionFromText('integrationPlan', 'Hermes integration plan JSON', planJson),
    sectionFromText('skillsIndex', 'Installed skills index footprint', skillsIndex),
    sectionFromText('memoryFootprint', 'Memory/profile file footprint', memoryFootprint),
    sectionFromText('userModelContext', 'Injected accepted user-model context size', userModelContext),
    sectionFromText('toolSchemas', 'Active built-in tool schemas JSON', toolSchemas),
  ];
  const totals = sections.reduce(
    (acc, section) => ({
      bytes: acc.bytes + section.bytes,
      chars: acc.chars + section.chars,
      lines: acc.lines + section.lines,
    }),
    { bytes: 0, chars: 0, lines: 0 },
  );

  const largestSchemas = activeTools
    .map((tool) => ({
      name: tool.function.name,
      bytes: byteLength(stableJson(tool)),
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);

  return {
    kind: 'hermes_prompt_size_diagnostic',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    requestedProfile: profileArg,
    dispatchProfile,
    toolsetId: `fleet.hermes.${dispatchProfile}`,
    source: 'offline-built-in',
    totals,
    tools: {
      totalBuiltinTools: allTools.length,
      activeToolSchemas: activeTools.length,
      filteredToolSchemas: filterResult.filtered.length,
      activeToolNames: activeTools.map((tool) => tool.function.name),
      filteredToolNames: filterResult.filtered,
      largestSchemas,
    },
    sections,
    notes: [
      'Runs offline: no LLM call, no MCP startup, no remote provider request.',
      'Tool schemas are built-in Code Buddy definitions after Hermes dispatch-profile filtering.',
      'Skills and memory are reported as local footprint metadata only; their content is not printed.',
      'Accepted user-model context is counted when USER_MODEL_INJECTION is enabled, but its content is not printed.',
    ],
  };
}

function renderHermesPromptSizeDiagnostic(diagnostic: HermesPromptSizeDiagnostic): string {
  const lines = [
    `Hermes prompt size (${diagnostic.dispatchProfile}, ${diagnostic.toolsetId}):`,
    `  Total: ${diagnostic.totals.bytes} bytes, ${diagnostic.totals.chars} chars, ${diagnostic.totals.lines} lines`,
    `  Tool schemas: ${diagnostic.tools.activeToolSchemas}/${diagnostic.tools.totalBuiltinTools} active (${diagnostic.tools.filteredToolSchemas} filtered)`,
    `  Source: ${diagnostic.source}`,
    '',
    'Sections:',
  ];

  for (const section of diagnostic.sections) {
    lines.push(
      `  ${section.id}: ${section.bytes} bytes, ${section.chars} chars, ${section.lines} lines - ${section.label}`,
    );
  }

  lines.push('');
  lines.push('Largest active tool schemas:');
  for (const tool of diagnostic.tools.largestSchemas) {
    lines.push(`  ${tool.name}: ${tool.bytes} bytes`);
  }

  if (diagnostic.tools.filteredToolNames.length > 0) {
    lines.push('');
    lines.push(`Filtered by Hermes profile: ${diagnostic.tools.filteredToolNames.slice(0, 20).join(', ')}`);
    if (diagnostic.tools.filteredToolNames.length > 20) {
      lines.push(`  (+${diagnostic.tools.filteredToolNames.length - 20} more)`);
    }
  }

  lines.push('');
  lines.push('Notes:');
  for (const note of diagnostic.notes) {
    lines.push(`  - ${note}`);
  }

  return lines.join('\n');
}

function buildHermesToolsetsCatalog(profileArg: string): HermesToolsetsCatalog {
  const activeProfile = normalizeDispatchProfile(profileArg);
  const previewTools = [...DEFAULT_DISPATCH_POLICY_PREVIEW_TOOLS];
  const toolsets = FLEET_DISPATCH_PROFILES.map((profile) => buildHermesToolsetDescriptor(profile, previewTools));

  return {
    kind: 'hermes_toolsets_catalog',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    requestedProfile: profileArg,
    activeProfile,
    officialSource: {
      repository: 'https://github.com/NousResearch/hermes-agent',
      inspectedCommit: '5921d667',
      sourceFiles: ['toolsets.py::TOOLSETS', 'toolsets.py::_HERMES_CORE_TOOLS'],
    },
    previewTools,
    summary: {
      totalToolsets: toolsets.length,
      profiles: [...FLEET_DISPATCH_PROFILES],
    },
    guidance: buildHermesAgentProfile(activeProfile).dispatchProfileGuidance,
    activeToolset: buildHermesToolsetDescriptor(activeProfile, previewTools),
    toolsets,
    officialToolsets: buildHermesToolsetCatalog(collectOfflineBuiltinToolNames()),
    notes: [
      'This is the Code Buddy native Fleet/Hermes toolset mapping, not the upstream Python runtime.',
      'Decisions are policy previews for representative tools; model-facing schemas are filtered again at runtime.',
      'officialToolsets enumerates the upstream Hermes named-toolset catalog with per-toolset readiness sourced from the official tool parity manifest.',
    ],
  };
}

function renderHermesToolsetsCatalog(catalog: HermesToolsetsCatalog): string {
  const lines = [
    `Hermes toolsets catalog: ${catalog.summary.totalToolsets} Fleet profiles`,
    `  Active profile: ${catalog.activeProfile}`,
    `  Active toolset: ${catalog.activeToolset.toolsetId}`,
    `  Preview tools: ${formatList(catalog.previewTools)}`,
  ];

  if (catalog.requestedProfile !== catalog.activeProfile) {
    lines.push(`  Requested: ${catalog.requestedProfile} (normalized to balanced)`);
  }

  lines.push('');
  lines.push('Profiles:');
  for (const guidance of catalog.guidance) {
    lines.push(`  ${guidance.profile}: ${guidance.useWhen}`);
    lines.push(`    ${guidance.policySummary}`);
  }

  lines.push('');
  lines.push('Toolsets:');
  for (const toolset of catalog.toolsets) {
    lines.push(`  ${toolset.toolsetId}`);
    lines.push(`    Intent: ${toolset.intent}`);
    lines.push(`    Default: ${toolset.defaultAction}`);
    lines.push(`    Allow groups: ${formatList(toolset.allowGroups)}`);
    lines.push(`    Confirm groups: ${formatList(toolset.confirmGroups)}`);
    lines.push(`    Deny groups: ${formatList(toolset.denyGroups)}`);
    lines.push(`    Allowed preview tools: ${formatList(toolset.allowedTools)}`);
    lines.push(`    Confirm preview tools: ${formatList(toolset.confirmTools)}`);
    lines.push(`    Denied preview tools: ${formatList(toolset.deniedTools)}`);
  }

  const official = catalog.officialToolsets;
  lines.push('');
  lines.push(
    `Official Hermes toolsets: ${official.summary.totalOfficialToolsets} tracked ` +
      `(${official.summary.present} present, ${official.summary.partial} partial, ${official.summary.absent} absent)`,
  );
  for (const toolset of official.toolsets) {
    const counts = toolset.composedOf.length > 0 ? ` composed-of=${formatList(toolset.composedOf)}` : '';
    lines.push(
      `  [${toolset.group}] ${toolset.id} (${toolset.readiness}) ` +
        `${toolset.presentToolCount}/${toolset.expectedToolCount}${counts}`,
    );
    if (toolset.missingToolNames.length > 0) {
      lines.push(`    Missing: ${formatList(toolset.missingToolNames)}`);
    }
  }

  lines.push('');
  lines.push('Notes:');
  for (const note of catalog.notes) {
    lines.push(`  - ${note}`);
  }

  return lines.join('\n');
}

function renderHermesToolParityManifest(manifest: HermesToolParityManifest): string {
  const lines = [
    `Hermes tool parity: ${manifest.summary.total} official tools tracked ` +
      `(${manifest.summary.exact} exact, ${manifest.summary.nativeEquivalent} native equivalents, ` +
      `${manifest.summary.partial} partial, ${manifest.summary.gaps} gaps)`,
    `Official source: ${manifest.officialSource.repository} @ ${manifest.officialSource.inspectedCommit}`,
    `Local tool schemas: ${manifest.codeBuddySource.localToolCount}`,
    `Command: ${manifest.command}`,
    '',
  ];

  for (const tool of manifest.tools) {
    lines.push(`${tool.status.padEnd(17)} ${tool.name} (${tool.toolset})`);
    if (tool.detectedCodeBuddyTools.length > 0) {
      lines.push(`  Code Buddy: ${formatList(tool.detectedCodeBuddyTools)}`);
    }
    if (tool.nextWork) {
      lines.push(`  Next: ${tool.nextWork}`);
    }
  }

  return lines.join('\n');
}

function renderHermesParityTodo(todo: HermesParityTodoManifest): string {
  const selectedLabel = todo.summary.includedDeferred ? 'active/deferred' : 'active';
  const lines = [
    `Hermes TODO: ${todo.summary.activeTodoCount} active feature items ` +
      `(${todo.summary.partial} partial, ${todo.summary.gaps} gaps in full manifest)`,
    `Official source: ${todo.officialSource.repository} @ ${todo.officialSource.inspectedCommit}`,
    `Audit: ${todo.officialSource.auditDocument}`,
    `Showing: ${todo.summary.shownTodoCount}/${todo.summary.selectedTodoCount} ${selectedLabel} item(s)`,
  ];

  if (todo.summary.hiddenTodoCount > 0) {
    lines.push(
      `Hidden by --limit ${todo.summary.todoLimit}: ${todo.summary.hiddenTodoCount}; ` +
        `rerun with --limit ${todo.summary.selectedTodoCount} to show all selected items.`,
    );
  }

  lines.push('', todo.summary.includedDeferred ? 'Next selected work:' : 'Next active work:');

  for (const item of todo.todos) {
    lines.push(`${item.priority}. ${item.area} [${item.status}]`);
    lines.push(`   Next: ${item.nextWork}`);
    lines.push(`   Verify: ${item.verificationCommand}`);
  }

  if (todo.deferred.length > 0 && !todo.summary.includedDeferred) {
    lines.push('');
    lines.push('Deferred by decision:');
    for (const item of todo.deferred) {
      lines.push(`- ${item.area} [${item.status}]`);
      lines.push(`  Next: ${item.nextWork}`);
    }
  }

  lines.push('');
  lines.push('Notes:');
  for (const note of todo.notes) {
    lines.push(`  - ${note}`);
  }

  return lines.join('\n');
}

function renderHermesRuntimeSmoke(result: HermesRuntimeSmokeResult): string {
  const lines = [
    `Hermes runtime smoke (${result.backendId}): ${result.status}`,
    `  Backend: ${result.label ?? result.backendId}`,
    `  Command: ${result.command ?? 'none'}`,
    `  Exit: ${result.exitCode ?? 'n/a'}`,
    `  Duration: ${result.durationMs}ms`,
  ];

  if (result.output) {
    lines.push(`  Output: ${result.output}`);
  }

  return lines.join('\n');
}

function buildKanbanStore(boardSlug?: string): KanbanStore {
  const registry = new KanbanBoardRegistry({ rootDir: process.cwd() });
  const slug = registry.resolveSlug(boardSlug);
  return new KanbanStore({ boardPath: registry.boardPath(slug) });
}

function parseKanbanStatus(value: string | undefined): KanbanStatus | undefined {
  if (!value) return undefined;
  if (
    value === 'todo' ||
    value === 'in_progress' ||
    value === 'blocked' ||
    value === 'done' ||
    value === 'archived'
  ) {
    return value;
  }
  throw new Error('status must be one of: todo, in_progress, blocked, done, archived');
}

function parseKanbanPriority(value: string | undefined): KanbanPriority | undefined {
  if (!value) return undefined;
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'urgent') {
    return value;
  }
  throw new Error('priority must be one of: low, medium, high, urgent');
}

function coerceKanbanTagValues(values: string | string[] | undefined): string[] {
  if (!values) return [];
  return Array.isArray(values) ? values : [values];
}

function parseKanbanTags(values: string | string[] | undefined): string[] {
  return coerceKanbanTagValues(values)
    .flatMap((value) => value.split(','))
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseKanbanCreateInput(title: string, options: HermesKanbanOptions): CreateKanbanCardInput {
  const status = parseKanbanStatus(options.status);
  const priority = parseKanbanPriority(options.priority);
  return {
    title,
    ...(options.id ? { id: options.id } : {}),
    ...(options.description ? { description: options.description } : {}),
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(options.assignee ? { assignee: options.assignee } : {}),
    tags: parseKanbanTags(options.tag),
  };
}

function parseKanbanListFilter(options: HermesKanbanOptions): ListKanbanCardsFilter {
  const status = parseKanbanStatus(options.status);
  const priority = parseKanbanPriority(options.priority);
  const [tag] = parseKanbanTags(options.tag);
  return {
    ...(status ? { status } : {}),
    ...(priority ? { priority } : {}),
    ...(options.assignee ? { assignee: options.assignee } : {}),
    ...(tag ? { tag } : {}),
    ...(options.active ? { includeDone: false } : {}),
  };
}

function renderKanbanCardSummary(card: { id: string; title: string; status: string; priority: string }): string {
  return `${card.status.padEnd(11)} ${card.priority.padEnd(6)} ${card.id} - ${card.title}`;
}

function printKanbanResult(payload: unknown, options: HermesKanbanOptions, text: string): void {
  if (options.json) {
    console.log(stableJson(payload));
    return;
  }
  console.log(text);
}

function renderHermesPortalTools(status: HermesPortalStatus): string {
  const lines = [
    'Hermes Nous Portal Tool Gateway tools:',
    `  Configured: ${status.toolGateway.configuredCount}/${status.toolGateway.tools.length}`,
    `  Via Nous: ${status.toolGateway.managedByNousCount}/${status.toolGateway.tools.length}`,
    '',
  ];

  for (const tool of status.toolGateway.tools) {
    const state = tool.managedByNous
      ? 'via Nous Portal'
      : tool.currentProvider ?? 'not configured';
    const readinessFlags = `configured=${tool.configured ? 'yes' : 'no'}, viaNous=${tool.managedByNous ? 'yes' : 'no'}`;
    lines.push(`${tool.label.padEnd(22)} ${tool.partner.padEnd(28)} ${state} | ${readinessFlags}`);
    if (tool.notes.length > 0) {
      lines.push(`  ${tool.notes.join(' ')}`);
    }
  }

  return lines.join('\n');
}

function printHermesPortalStatus(
  status: HermesPortalStatus,
  options: HermesCommandOptions,
  toolsOnly = false,
  command?: string,
): void {
  const payload = command ? { command, ...status } : status;
  if (options.json) {
    console.log(stableJson(payload));
    return;
  }

  if (command) {
    console.log(`Command: ${command}`);
  }
  console.log(toolsOnly ? renderHermesPortalTools(status) : renderHermesPortalStatus(status));
}

async function buildHermesMessagingGatewayStatus(configPath?: string): Promise<ChannelStatusReport> {
  const { getChannelManager } = await import('../../channels/index.js');
  const manager = getChannelManager();
  return buildChannelStatusReport(manager.getStatus(), configPath);
}

function renderHermesMessagingGatewayStatus(report: ChannelStatusReport): string {
  const nextTargets = report.hermes.nextConfigPlatformNames;
  const visibleNextTargets = nextTargets.slice(0, 8);
  const hiddenNextTargetCount = nextTargets.length - visibleNextTargets.length;
  const lines = [
    'Hermes messaging gateway:',
    `  Configured: ${report.config.configuredCount} (${report.config.enabledCount} enabled, ${report.config.disabledCount} disabled)`,
    `  Runtime: ${report.runtime.connectedCount}/${report.runtime.registeredCount} connected`,
    `  Authenticated: ${report.runtime.authenticatedCount}`,
    `  Official platforms: ${report.hermes.locallyCoveredCount}/${report.hermes.officialPlatformCount} covered, ` +
      `${report.hermes.configuredPlatformCount} configured, ${report.hermes.runtimePlatformCount} runtime`,
    `  Configured platforms: ${formatList(report.hermes.configuredPlatformNames)}`,
    `  Runtime platforms: ${formatList(report.hermes.runtimePlatformNames)}`,
    `  Prompt-tool platforms: ${formatList(report.hermes.promptToolPlatformNames)}`,
    `  Next config targets: ${formatList(visibleNextTargets)}${hiddenNextTargetCount > 0 ? ` (+${hiddenNextTargetCount} more)` : ''}`,
  ];

  if (report.config.path) {
    lines.push(`  Config path: ${report.config.path}`);
  }

  if (report.config.channels.length > 0) {
    lines.push('');
    lines.push('Configured channels:');
    for (const channel of report.config.channels) {
      const credentials = [channel.hasToken ? 'token' : '', channel.hasWebhookUrl ? 'webhook' : ''].filter(Boolean);
      lines.push(
        `  - ${channel.type}: ${channel.enabled ? 'enabled' : 'disabled'}` +
          `${credentials.length > 0 ? ` (${credentials.join(', ')})` : ''}`,
      );
    }
  }

  if (report.runtime.channels.length > 0) {
    lines.push('');
    lines.push('Runtime channels:');
    for (const channel of report.runtime.channels) {
      lines.push(
        `  - ${channel.type}: ${channel.connected ? 'connected' : 'disconnected'}, ` +
          `auth=${channel.authenticated ? 'yes' : 'no'}` +
          `${channel.error ? `, error=${channel.error}` : ''}`,
      );
    }
  }

  if (report.hermes.platforms.length > 0) {
    lines.push('');
    lines.push('Hermes platform coverage:');
    for (const platform of report.hermes.platforms.slice(0, 12)) {
      const channelSuffix = platform.channelTypes.length > 0 ? ` (${platform.channelTypes.join(', ')})` : '';
      const readinessFlags = `configured=${platform.configured ? 'yes' : 'no'}, runtime=${platform.runtimeRegistered ? 'yes' : 'no'}`;
      lines.push(`  - ${platform.platform}: ${platform.status}/${platform.localSurface}${channelSuffix} | ${readinessFlags}`);
    }
    if (report.hermes.platforms.length > 12) {
      lines.push(`  ... ${report.hermes.platforms.length - 12} more`);
    }
  }

  if (report.recommendations.length > 0) {
    lines.push('');
    lines.push('Recommendations:');
    for (const recommendation of report.recommendations) {
      lines.push(`  - ${recommendation}`);
    }
  }

  return lines.join('\n');
}

function renderHermesProviderReadiness(readiness: HermesProviderReadiness): string {
  const lines = [
    `Hermes provider readiness: ${readiness.ok ? 'ok' : 'needs attention'}`,
    `  Model: ${readiness.activeModel.model} (${readiness.activeModel.source})`,
    `  Provider: ${readiness.activeProvider.label}`,
    `  Credentials/endpoint: ${readiness.activeProvider.configured ? 'configured' : 'missing'}`,
    `  Capabilities: tool-calls=${readiness.activeModel.supportsToolCalls ? 'yes' : 'no'}, reasoning=${readiness.activeModel.supportsReasoning ? 'yes' : 'no'}, vision=${readiness.activeModel.supportsVision ? 'yes' : 'no'}`,
    `  Context/output: ${readiness.activeModel.contextWindow ?? 'unknown'} / ${readiness.activeModel.maxOutputTokens ?? 'unknown'} tokens`,
    `  Configured providers: ${readiness.providers.filter((provider) => provider.configured).length}/${readiness.providers.length}`,
    `  Nous Tool Gateway: ${readiness.portal.portal.toolGatewayConfigured ? 'configured' : 'not configured'}`,
  ];

  if (readiness.activeProvider.credentialSources.length > 0) {
    lines.push(`  Credential sources: ${readiness.activeProvider.credentialSources.join(', ')}`);
  }

  if (readiness.providers.length > 0) {
    lines.push('');
    lines.push('Providers:');
    for (const provider of readiness.providers) {
      const state = provider.configured ? 'configured' : provider.local ? 'local fallback' : 'missing';
      const readinessFlags = `configured=${provider.configured ? 'yes' : 'no'}, local=${provider.local ? 'yes' : 'no'}`;
      lines.push(`  - ${provider.label}: ${state} | ${readinessFlags}`);
      for (const note of provider.notes) {
        lines.push(`    note: ${note}`);
      }
    }
  }

  if (readiness.issues.length > 0) {
    lines.push('');
    lines.push('Issues:');
    for (const issue of readiness.issues) {
      lines.push(`  - ${issue}`);
    }
  }

  if (readiness.recommendations.length > 0) {
    lines.push('');
    lines.push('Recommendations:');
    for (const recommendation of readiness.recommendations) {
      lines.push(`  - ${recommendation}`);
    }
  }

  return lines.join('\n');
}

function buildHermesModelStatus(readiness: HermesProviderReadiness = buildHermesProviderReadiness()): HermesModelStatus {
  const configuredProviderCount = readiness.providers.filter((provider) => provider.configured).length;
  const setupHints = readiness.ok
    ? [...readiness.recommendations]
    : [
      ...readiness.activeProvider.remediation,
      ...readiness.recommendations,
    ];
  const nextSteps = setupHints.length > 0 ? setupHints : [
    'Run buddy whoami to confirm the current ChatGPT/Codex account when OAuth is the active credential source.',
    'Run buddy hermes providers status --json when you need the full provider matrix.',
  ];

  return {
    kind: 'hermes_model_status',
    schemaVersion: 1,
    ok: readiness.ok,
    active: {
      model: readiness.activeModel.model,
      provider: readiness.activeModel.provider,
      providerLabel: readiness.activeProvider.label,
      source: readiness.activeModel.source,
      configured: readiness.activeProvider.configured,
      credentialSources: [...readiness.activeProvider.credentialSources],
      contextWindow: readiness.activeModel.contextWindow,
      maxOutputTokens: readiness.activeModel.maxOutputTokens,
      capabilities: {
        toolCalls: readiness.activeModel.supportsToolCalls,
        reasoning: readiness.activeModel.supportsReasoning,
        vision: readiness.activeModel.supportsVision,
      },
    },
    setup: {
      loginCommand: 'buddy login',
      accountCommand: 'buddy whoami',
      providerMatrixCommand: 'buddy hermes providers status --json',
      doctorCommand: 'buddy hermes doctor safe --json',
      nextSteps: Array.from(new Set(nextSteps)).slice(0, 8),
    },
    alternatives: readiness.providers
      .filter((provider) => provider.provider !== readiness.activeModel.provider)
      .map((provider) => ({
        provider: provider.provider,
        label: provider.label,
        configured: provider.configured,
        local: provider.local,
        credentialSources: [...provider.credentialSources],
        setupHints: [...provider.remediation],
      })),
    issues: [
      ...readiness.issues,
      ...(configuredProviderCount === 0 ? ['No configured providers were detected.'] : []),
    ],
    recommendations: [...readiness.recommendations],
  };
}

function renderHermesModelStatus(status: HermesModelStatus): string {
  const credentials = status.active.credentialSources.length > 0
    ? status.active.credentialSources.join(', ')
    : status.active.configured
      ? 'local/configured endpoint'
      : 'missing';
  const configuredAlternatives = status.alternatives.filter((provider) => provider.configured);
  const lines = [
    `Hermes model: ${status.ok ? 'ok' : 'needs attention'}`,
    `  Active: ${status.active.model} via ${status.active.providerLabel} (${status.active.source})`,
    `  Credentials/endpoint: ${credentials}`,
    `  Capabilities: tool-calls=${status.active.capabilities.toolCalls ? 'yes' : 'no'}, reasoning=${status.active.capabilities.reasoning ? 'yes' : 'no'}, vision=${status.active.capabilities.vision ? 'yes' : 'no'}`,
    `  Context/output: ${status.active.contextWindow ?? 'unknown'} / ${status.active.maxOutputTokens ?? 'unknown'} tokens`,
    `  Full provider matrix: ${status.setup.providerMatrixCommand}`,
  ];

  if (configuredAlternatives.length > 0) {
    lines.push(`  Configured alternatives: ${configuredAlternatives.map((provider) => provider.label).join(', ')}`);
  }

  if (status.issues.length > 0) {
    lines.push('');
    lines.push('Issues:');
    for (const issue of status.issues) {
      lines.push(`  - ${issue}`);
    }
  }

  if (status.setup.nextSteps.length > 0) {
    lines.push('');
    lines.push('Next steps:');
    for (const step of status.setup.nextSteps) {
      lines.push(`  - ${step}`);
    }
  }

  lines.push('');
  lines.push(`Account check: ${status.setup.accountCommand}`);
  lines.push(`Safe doctor: ${status.setup.doctorCommand}`);

  return lines.join('\n');
}

async function buildHermesMobileSupervisionStatus(
  queryParts: string[] = [],
  options: HermesMobileStatusOptions = {},
): Promise<HermesMobileSupervisionStatus> {
  const query = normalizeHermesMobileQuery(queryParts);
  const limit = parseOptionalPositiveInteger(options.limit, '--limit') ?? 20;
  const contract = await buildMobileSupervisionGatewayContract(query, {
    includeAllContext: false,
    includeSnapshot: false,
    limit,
    sources: options.source ?? [],
  });
  const listenerShell = buildMobileSupervisionGatewayListenerShell(contract);
  const pairingState = buildMobileSupervisionPairingState(listenerShell, {
    deviceLabel: 'Cowork mobile supervisor',
  });
  const approvalQueue = buildMobileSupervisionApprovalQueue(contract, pairingState);
  const readOnlyEndpoints = contract.endpoints.filter((endpoint) => endpoint.sideEffects === 'none');
  const draftOnlyEndpoints = contract.endpoints.filter((endpoint) => endpoint.sideEffects === 'draft_only');
  const gatewayCheckCommand = `buddy run mobile-gateway-check "${contract.query}" --action view_run_summary --method GET --path /api/mobile/snapshot --json`;

  return {
    kind: 'hermes_mobile_supervision_status',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ok: true,
    query: contract.query,
    routeMount: {
      basePath: contract.basePath,
      module: 'src/server/routes/mobile.ts',
      mountedBy: 'src/server/index.ts',
      serverCommand: 'buddy server --port 3000',
      status: 'implemented_not_probed',
    },
    summary: {
      readOnlyEndpoints: readOnlyEndpoints.length,
      draftOnlyEndpoints: draftOnlyEndpoints.length,
      blockedOperations: contract.blockedOperations.length,
      readyReadOnly: approvalQueue.counts.ready,
      pendingLocalApproval: approvalQueue.counts.pending,
      blockedQueueItems: approvalQueue.counts.blocked,
      totalQueueItems: approvalQueue.counts.total,
    },
    auth: contract.auth,
    transport: contract.transport,
    listener: {
      bind: listenerShell.bind,
      mode: listenerShell.mode,
      listener: listenerShell.transport.listener,
      safety: listenerShell.safety,
    },
    endpoints: contract.endpoints.map((endpoint) => ({
      action: endpoint.action,
      id: endpoint.id,
      localApprovalRequired: endpoint.localApprovalRequired,
      method: endpoint.method,
      path: endpoint.path,
      sideEffects: endpoint.sideEffects,
    })),
    blockedOperations: contract.blockedOperations.map((operation) => ({
      action: operation.action,
      reason: operation.policy.reason,
    })),
    approvalQueue: {
      counts: approvalQueue.counts,
      localOnly: approvalQueue.safety.localOnly,
      autoDispatch: approvalQueue.safety.autoDispatch,
      remoteExecutionDisabled: approvalQueue.safety.remoteExecutionDisabled,
    },
    pairing: {
      deviceLabel: pairingState.pairing.deviceLabel,
      deviceLabelMaxChars: pairingState.pairing.deviceLabelMaxChars,
      scopes: pairingState.pairing.scopes,
      status: pairingState.pairing.status,
      tokenIssued: pairingState.pairing.tokenIssued,
      ttlSeconds: pairingState.pairing.ttlSeconds,
    },
    commands: {
      status: 'buddy hermes mobile status --json',
      server: 'buddy server --port 3000',
      snapshot: `buddy run mobile-snapshot "${contract.query}" --json`,
      contract: `buddy run mobile-gateway-contract "${contract.query}" --json`,
      gatewayCheck: gatewayCheckCommand,
      pairing: `buddy run mobile-pairing-state "${contract.query}" --json`,
      approvals: `buddy run mobile-approval-queue "${contract.query}" --json`,
    },
    recommendations: [
      'Start the local server before using a phone: buddy server --port 3000.',
      'Pairing-code and approval routes are local-operator-only; do not expose them directly over LAN.',
      `Keep mobile pairing device labels at or below ${MOBILE_SUPERVISION_DEVICE_LABEL_MAX_CHARS} characters.`,
      'Mobile devices may read snapshots and submit draft prompts, but execution and file mutations remain local.',
      `Use ${gatewayCheckCommand} as a safe GET policy smoke before implementing any new route.`,
    ],
  };
}

function renderHermesMobileSupervisionStatus(status: HermesMobileSupervisionStatus): string {
  const lines = [
    `Hermes mobile supervision: ${status.ok ? 'ready for local server' : 'needs attention'}`,
    `  Query: ${status.query || '(empty)'}`,
    `  Route mount: ${status.routeMount.basePath} (${status.routeMount.status})`,
    `  Server: ${status.routeMount.serverCommand}`,
    `  Auth: ${status.auth.scheme}, scopes=${status.auth.scopes.join(', ')}, ttl=${status.auth.ttlSeconds}s`,
    `  Transport: ${status.transport.exposure}, remote execution ${status.transport.remoteExecution}, TLS required off-device`,
    `  Listener: ${status.listener.listener}, bind ${status.listener.bind.host}:${status.listener.bind.port} (${status.listener.bind.networkExposure})`,
    `  Pairing label limit: ${status.pairing.deviceLabelMaxChars} characters`,
    `  Routes: ${status.summary.readOnlyEndpoints} read-only, ${status.summary.draftOnlyEndpoints} draft-only, ${status.summary.blockedOperations} blocked`,
    `  Approval queue: ready=${status.summary.readyReadOnly}, pending=${status.summary.pendingLocalApproval}, blocked=${status.summary.blockedQueueItems}`,
    `  Safety: autoDispatch=${status.approvalQueue.autoDispatch}; remoteExecutionDisabled=${status.approvalQueue.remoteExecutionDisabled}`,
    '',
    'Endpoints:',
  ];

  for (const endpoint of status.endpoints) {
    lines.push(
      `  - ${endpoint.method} ${endpoint.path} -> ${endpoint.action}` +
        ` (${endpoint.sideEffects}, localApprovalRequired=${endpoint.localApprovalRequired})`,
    );
  }

  lines.push('', 'Commands:');
  lines.push(`  - ${status.commands.status}`);
  lines.push(`  - ${status.commands.server}`);
  lines.push(`  - ${status.commands.snapshot}`);
  lines.push(`  - ${status.commands.contract}`);
  lines.push(`  - ${status.commands.gatewayCheck}`);
  lines.push(`  - ${status.commands.pairing}`);
  lines.push(`  - ${status.commands.approvals}`);

  if (status.recommendations.length > 0) {
    lines.push('', 'Recommendations:');
    for (const recommendation of status.recommendations) {
      lines.push(`  - ${recommendation}`);
    }
  }

  return lines.join('\n');
}

function normalizeHermesMobileQuery(queryParts: string[]): string {
  const query = queryParts.join(' ').trim();
  return query || 'mobile supervision';
}

function collectHermesOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function registerHermesPortalCommands(hermes: Command): void {
  const portal = hermes
    .command('portal')
    .description('Inspect Nous Portal auth, subscription, and Tool Gateway routing readiness');

  portal
    .command('status')
    .description('Show Nous Portal auth and Tool Gateway routing readiness')
    .option('--json', 'output JSON')
    .action((options: HermesCommandOptions) => {
      printHermesPortalStatus(buildHermesPortalStatus(), options, false, 'buddy hermes portal status --json');
    });

  portal
    .command('tools')
    .description('List Tool Gateway tools and whether Code Buddy routes them via Nous or direct providers')
    .option('--json', 'output JSON')
    .action((options: HermesCommandOptions) => {
      printHermesPortalStatus(buildHermesPortalStatus(), options, true, 'buddy hermes portal tools --json');
    });

  portal
    .command('open')
    .description('Print the Nous Portal subscription URL')
    .option('--json', 'output JSON')
    .action((options: HermesCommandOptions) => {
      const status = buildHermesPortalStatus();
      const payload = {
        kind: 'hermes_portal_open',
        url: status.portal.subscriptionUrl,
        docsUrl: status.portal.docsUrl,
      };
      if (options.json) {
        console.log(stableJson(payload));
        return;
      }
      console.log(status.portal.subscriptionUrl);
    });
}

interface HermesClawMigrateOptions extends HermesCommandOptions {
  source?: string;
  workspaceTarget?: string;
  preset?: string;
  migrateSecrets?: boolean;
  overwrite?: boolean;
  skillConflict?: string;
  backup?: boolean;
  apply?: boolean;
  yes?: boolean;
}

interface HermesClawBridgeOptions extends HermesCommandOptions {
  source?: string;
  workspaceTarget?: string;
  apply?: boolean;
  yes?: boolean;
  approvedBy?: string;
  endpointPath?: string;
  nodeLockfile?: string;
  params?: string;
  statusMethod?: string;
  timeoutMs?: string;
  messageId?: string;
  channel?: string;
  threadId?: string;
  senderId?: string;
  senderName?: string;
  text?: string;
}

function renderOpenClawBridgeResult(value: {
  kind: string;
  ok?: boolean;
  found?: boolean;
  record?: { status?: string; endpoint?: string; endpointPath?: string };
  discovery?: {
    found: boolean;
    daemon: { endpoint?: string; httpUrl?: string; rpcUrl?: string; wsUrl?: string };
    nodeHost?: { found: boolean; nodeId?: string; displayName?: string };
    safety: { tokenPresent: boolean; nodeTokenPresent?: boolean };
  };
  draftFile?: string;
  sendLogPath?: string;
  attachLogPath?: string;
  recommendations?: string[];
}): string {
  const lines = [`OpenClaw bridge: ${value.kind}`];
  if (typeof value.found === 'boolean') lines.push(`Detected: ${value.found ? 'yes' : 'no'}`);
  if (value.discovery) {
    const endpoint = value.discovery.daemon.rpcUrl || value.discovery.daemon.httpUrl || value.discovery.daemon.endpoint || value.discovery.daemon.wsUrl || 'not configured';
    lines.push(`Gateway: ${value.discovery.found ? endpoint : 'not found'}`);
    lines.push(`Token present: ${value.discovery.safety.tokenPresent ? 'yes' : 'no'}`);
    if (value.discovery.nodeHost) {
      const nodeLabel = value.discovery.nodeHost.displayName || value.discovery.nodeHost.nodeId || 'not found';
      lines.push(`Node host: ${value.discovery.nodeHost.found ? nodeLabel : 'not found'}`);
      lines.push(`Node token present: ${value.discovery.safety.nodeTokenPresent ? 'yes' : 'no'}`);
    }
  }
  if (value.record) {
    lines.push(`Status: ${value.record.status || 'unknown'}`);
    lines.push(`Endpoint: ${value.record.endpoint || value.record.endpointPath || 'n/a'}`);
  }
  if (value.draftFile) lines.push(`Draft: ${value.draftFile}`);
  if (value.attachLogPath) lines.push(`Attach log: ${value.attachLogPath}`);
  if (value.sendLogPath) lines.push(`Send log: ${value.sendLogPath}`);
  if (value.recommendations?.length) lines.push(`Next: ${value.recommendations[0]}`);
  return lines.join('\n');
}

function registerHermesClawCommands(hermes: Command): void {
  const claw = hermes
    .command('claw')
    .description('Migrate a legacy OpenClaw installation into Code Buddy');

  claw
    .command('migrate')
    .description('Migrate OpenClaw config/data into Code Buddy (dry-run by default; --apply to write)')
    .option('--source <path>', 'OpenClaw home (default: ~/.openclaw, ~/.clawdbot, ~/.moltbot)')
    .option('--workspace-target <path>', 'workspace target for identity files and .codebuddy (default: cwd)')
    .option('--preset <preset>', 'full | user-data', 'full')
    .option('--migrate-secrets', 'archive API keys/secrets to a 0600 review file (never injected into live config)')
    .option('--overwrite', 'overwrite existing Code Buddy files on conflicts')
    .option('--skill-conflict <mode>', 'skip | overwrite | rename', 'skip')
    .option('--no-backup', 'skip the pre-migration snapshot')
    .option('--apply', 'actually write changes (otherwise dry-run)')
    .option('--yes', 'skip confirmation when applying')
    .option('--json', 'output JSON')
    .action(async (options: HermesClawMigrateOptions) => {
      const preset: ClawMigrationPreset = options.preset === 'user-data' ? 'user-data' : 'full';
      const skillConflict: SkillConflictMode =
        options.skillConflict === 'overwrite'
          ? 'overwrite'
          : options.skillConflict === 'rename'
            ? 'rename'
            : 'skip';
      const report = await runClawMigration({
        source: options.source,
        workspaceTarget: options.workspaceTarget,
        preset,
        migrateSecrets: options.migrateSecrets === true,
        overwrite: options.overwrite === true,
        skillConflict,
        backup: options.backup !== false,
        apply: options.apply === true,
      });
      if (options.json) {
        console.log(stableJson(report));
        return;
      }
      console.log(renderClawMigrationReport(report));
    });

  claw
    .command('status')
    .description('Report whether an OpenClaw installation is detected, with a dry-run plan summary')
    .option('--source <path>', 'OpenClaw home to probe')
    .option('--json', 'output JSON')
    .action(async (options: HermesClawMigrateOptions) => {
      const report = await runClawMigration({ source: options.source, apply: false });
      if (options.json) {
        console.log(stableJson(report));
        return;
      }
      console.log(renderClawMigrationReport(report));
    });

  const bridge = claw
    .command('bridge')
    .description('Operate the Code Buddy OpenClaw gateway bridge (dry-run by default)');

  bridge
    .command('status')
    .description('Discover OpenClaw Gateway and show the Code Buddy node descriptor')
    .option('--source <path>', 'OpenClaw home (default: ~/.openclaw)')
    .option('--node-lockfile <path>', 'OpenClaw node host lockfile (default: <source>/node.json)')
    .option('--workspace-target <path>', 'workspace for bridge artifacts (default: cwd)')
    .option('--json', 'output JSON')
    .action(async (options: HermesClawBridgeOptions) => {
      const discovery = await discoverOpenClawGateway({
        home: options.source,
        nodeLockfilePath: options.nodeLockfile,
        cwd: options.workspaceTarget,
      });
      const descriptor = buildOpenClawNodeDescriptor({
        nodeId: discovery.daemon.nodeId || discovery.nodeHost.nodeId,
      });
      const payload = {
        kind: 'openclaw_bridge_status',
        discovery,
        descriptor,
      };
      if (options.json) {
        console.log(stableJson(payload));
        return;
      }
      console.log(renderOpenClawBridgeResult({
        kind: payload.kind,
        found: discovery.found,
        discovery,
        recommendations: discovery.recommendations,
      }));
    });

  bridge
    .command('call-ws <method>')
    .description('Call an OpenClaw Gateway WebSocket RPC method (--apply --yes required for live call)')
    .option('--source <path>', 'OpenClaw home (default: ~/.openclaw)')
    .option('--node-lockfile <path>', 'OpenClaw node host lockfile (default: <source>/node.json)')
    .option('--workspace-target <path>', 'workspace for bridge artifacts (default: cwd)')
    .option('--params <json>', 'JSON object params to send in live mode', '{}')
    .option('--timeout-ms <ms>', 'WebSocket call timeout', '5000')
    .option('--approved-by <name>', 'operator approving live WebSocket call')
    .option('--apply', 'contact the OpenClaw Gateway WebSocket (otherwise dry-run)')
    .option('--yes', 'confirm live call when used with --apply')
    .option('--json', 'output JSON')
    .action(async (method: string, options: HermesClawBridgeOptions) => {
      const timeoutMs = Number.parseInt(options.timeoutMs || '5000', 10);
      let params: Record<string, unknown> = {};
      if (options.params?.trim()) {
        const parsed = JSON.parse(options.params) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('--params must be a JSON object');
        }
        params = parsed as Record<string, unknown>;
      }
      const result = await callOpenClawGatewayWebSocket({
        method,
        params,
        dryRun: options.apply !== true,
        approvedBy: options.approvedBy,
        liveCallConfirmed: options.apply === true && options.yes === true,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000,
      }, {
        home: options.source,
        nodeLockfilePath: options.nodeLockfile,
        cwd: options.workspaceTarget,
      });
      if (options.json) {
        console.log(stableJson(result));
        return;
      }
      console.log(renderOpenClawBridgeResult({
        kind: result.kind,
        ok: result.ok,
        discovery: result.discovery,
        record: {
          status: result.record.status,
          endpoint: result.record.wsUrl,
        },
        recommendations: result.error ? [result.error] : undefined,
      }));
    });

  bridge
    .command('probe-ws')
    .description('Probe the OpenClaw Gateway WebSocket handshake (--apply --yes required for live probe)')
    .option('--source <path>', 'OpenClaw home (default: ~/.openclaw)')
    .option('--node-lockfile <path>', 'OpenClaw node host lockfile (default: <source>/node.json)')
    .option('--workspace-target <path>', 'workspace for bridge artifacts (default: cwd)')
    .option('--status-method <method>', 'OpenClaw status RPC method to call after hello-ok', 'status')
    .option('--timeout-ms <ms>', 'WebSocket probe timeout', '5000')
    .option('--approved-by <name>', 'operator approving live WebSocket probe')
    .option('--apply', 'contact the OpenClaw Gateway WebSocket (otherwise dry-run)')
    .option('--yes', 'confirm live probe when used with --apply')
    .option('--json', 'output JSON')
    .action(async (options: HermesClawBridgeOptions) => {
      const timeoutMs = Number.parseInt(options.timeoutMs || '5000', 10);
      const result = await probeOpenClawGatewayWebSocket({
        dryRun: options.apply !== true,
        approvedBy: options.approvedBy,
        liveProbeConfirmed: options.apply === true && options.yes === true,
        statusMethod: options.statusMethod,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000,
      }, {
        home: options.source,
        nodeLockfilePath: options.nodeLockfile,
        cwd: options.workspaceTarget,
      });
      if (options.json) {
        console.log(stableJson(result));
        return;
      }
      console.log(renderOpenClawBridgeResult({
        kind: result.kind,
        ok: result.ok,
        discovery: result.discovery,
        record: {
          status: result.record.status,
          endpoint: result.record.wsUrl,
        },
        recommendations: result.error ? [result.error] : undefined,
      }));
    });

  bridge
    .command('attach')
    .description('Register the Code Buddy bridge with OpenClaw Gateway (--apply --yes required for live attach)')
    .option('--source <path>', 'OpenClaw home (default: ~/.openclaw)')
    .option('--node-lockfile <path>', 'OpenClaw node host lockfile (default: <source>/node.json)')
    .option('--workspace-target <path>', 'workspace for bridge artifacts (default: cwd)')
    .option('--endpoint-path <path>', 'OpenClaw attach endpoint path', 'nodes/register')
    .option('--approved-by <name>', 'operator approving live attach')
    .option('--apply', 'contact the OpenClaw daemon (otherwise dry-run)')
    .option('--yes', 'confirm live attach when used with --apply')
    .option('--json', 'output JSON')
    .action(async (options: HermesClawBridgeOptions) => {
      const result = await attachOpenClawGateway({
        dryRun: options.apply !== true,
        approvedBy: options.approvedBy,
        liveAttachConfirmed: options.apply === true && options.yes === true,
        endpointPath: options.endpointPath,
      }, {
        home: options.source,
        nodeLockfilePath: options.nodeLockfile,
        cwd: options.workspaceTarget,
      });
      if (options.json) {
        console.log(stableJson(result));
        return;
      }
      console.log(renderOpenClawBridgeResult({
        kind: result.kind,
        ok: result.ok,
        discovery: result.discovery,
        record: result.record,
        attachLogPath: result.attachLogPath,
      }));
    });

  bridge
    .command('draft')
    .description('Create a safe Fleet handoff draft from an OpenClaw inbound message')
    .requiredOption('--message-id <id>', 'OpenClaw message id')
    .requiredOption('--channel <channel>', 'OpenClaw channel name')
    .requiredOption('--sender-id <id>', 'OpenClaw sender id')
    .requiredOption('--text <text>', 'message text; stored only as a redacted preview')
    .option('--thread-id <id>', 'thread id')
    .option('--sender-name <name>', 'sender display name')
    .option('--workspace-target <path>', 'workspace for bridge artifacts (default: cwd)')
    .option('--json', 'output JSON')
    .action(async (options: HermesClawBridgeOptions) => {
      const draft = await prepareOpenClawFleetHandoffDraft({
        id: options.messageId!,
        channel: options.channel!,
        senderId: options.senderId!,
        senderName: options.senderName,
        threadId: options.threadId,
        text: options.text!,
      }, {
        cwd: options.workspaceTarget,
      });
      if (options.json) {
        console.log(stableJson(draft));
        return;
      }
      console.log(renderOpenClawBridgeResult({
        kind: draft.kind,
        draftFile: draft.draftFile,
      }));
    });

  bridge
    .command('send')
    .description('Send or preview an approved OpenClaw response (--apply --yes required for live send)')
    .requiredOption('--message-id <id>', 'OpenClaw source message id')
    .requiredOption('--channel <channel>', 'OpenClaw channel name')
    .requiredOption('--thread-id <id>', 'OpenClaw thread id')
    .requiredOption('--text <text>', 'response text')
    .option('--source <path>', 'OpenClaw home (default: ~/.openclaw)')
    .option('--node-lockfile <path>', 'OpenClaw node host lockfile (default: <source>/node.json)')
    .option('--workspace-target <path>', 'workspace for bridge artifacts (default: cwd)')
    .option('--endpoint-path <path>', 'OpenClaw response endpoint path', 'messages/reply')
    .option('--approved-by <name>', 'operator approving live response send')
    .option('--apply', 'contact the OpenClaw daemon (otherwise dry-run)')
    .option('--yes', 'confirm live send when used with --apply')
    .option('--json', 'output JSON')
    .action(async (options: HermesClawBridgeOptions) => {
      const result = await sendOpenClawResponse({
        openclawMessageId: options.messageId!,
        channel: options.channel!,
        threadId: options.threadId!,
        text: options.text!,
        dryRun: options.apply !== true,
        approvedBy: options.approvedBy,
        liveSendConfirmed: options.apply === true && options.yes === true,
        endpointPath: options.endpointPath,
      }, {
        home: options.source,
        nodeLockfilePath: options.nodeLockfile,
        cwd: options.workspaceTarget,
      });
      if (options.json) {
        console.log(stableJson(result));
        return;
      }
      console.log(renderOpenClawBridgeResult({
        kind: result.kind,
        ok: result.ok,
        discovery: result.discovery,
        record: result.record,
        sendLogPath: result.sendLogPath,
      }));
    });
}

function registerHermesKanbanCommands(hermes: Command): void {
  const kanban = hermes
    .command('kanban')
    .description('Manage the persistent Hermes-compatible Kanban board for this workspace');

  kanban
    .command('list')
    .description('List Kanban cards')
    .option('--json', 'output JSON')
    .option('--status <status>', 'filter by todo, in_progress, blocked, or done')
    .option('--priority <priority>', 'filter by low, medium, high, or urgent')
    .option('--assignee <assignee>', 'filter by assignee')
    .option('--tag <tag>', 'filter by tag')
    .option('--active', 'hide done cards')
    .action(async (options: HermesKanbanOptions) => {
      const store = buildKanbanStore(options.board);
      const cards = await store.listCards(parseKanbanListFilter(options));
      printKanbanResult(
        { kind: 'hermes_kanban_list', boardPath: store.path, count: cards.length, cards },
        options,
        cards.length > 0
          ? cards.map(renderKanbanCardSummary).join('\n')
          : `No Kanban cards in ${store.path}`,
      );
    });

  kanban
    .command('show')
    .description('Show one Kanban card')
    .argument('<id>', 'card id')
    .option('--json', 'output JSON')
    .action(async (id: string, options: HermesKanbanOptions) => {
      const store = buildKanbanStore(options.board);
      const card = await store.showCard(id);
      printKanbanResult(
        { kind: 'hermes_kanban_show', boardPath: store.path, card },
        options,
        [
          renderKanbanCardSummary(card),
          card.description ? `Description: ${card.description}` : '',
          card.assignee ? `Assignee: ${card.assignee}` : '',
          card.blockedReason ? `Blocked: ${card.blockedReason}` : '',
          card.tags.length > 0 ? `Tags: ${card.tags.join(', ')}` : '',
          card.comments.length > 0 ? `Comments: ${card.comments.length}` : '',
          card.heartbeats.length > 0 ? `Heartbeats: ${card.heartbeats.length}` : '',
          card.links.length > 0 ? `Links: ${card.links.length}` : '',
        ].filter(Boolean).join('\n'),
      );
    });

  kanban
    .command('create')
    .description('Create a Kanban card')
    .argument('<title>', 'card title')
    .option('--json', 'output JSON')
    .option('--id <id>', 'stable card id')
    .option('--description <description>', 'detailed description')
    .option('--status <status>', 'initial status')
    .option('--priority <priority>', 'initial priority')
    .option('--assignee <assignee>', 'assignee')
    .option('--tag <tag...>', 'tag list, repeated or comma-separated')
    .action(async (title: string, options: HermesKanbanOptions) => {
      const store = buildKanbanStore(options.board);
      const card = await store.createCard(parseKanbanCreateInput(title, options));
      printKanbanResult(
        { kind: 'hermes_kanban_create', boardPath: store.path, card },
        options,
        `Created ${renderKanbanCardSummary(card)}`,
      );
    });

  kanban
    .command('complete')
    .description('Mark a Kanban card as done')
    .argument('<id>', 'card id')
    .option('--json', 'output JSON')
    .option('--comment <comment>', 'completion note')
    .option('--author <author>', 'note author')
    .action(async (id: string, options: HermesKanbanOptions) => {
      const store = buildKanbanStore(options.board);
      const card = await store.completeCard(id, options.comment, options.author);
      printKanbanResult(
        { kind: 'hermes_kanban_complete', boardPath: store.path, card },
        options,
        `Completed ${renderKanbanCardSummary(card)}`,
      );
    });

  kanban
    .command('block')
    .description('Mark a Kanban card as blocked')
    .argument('<id>', 'card id')
    .requiredOption('--reason <reason>', 'blocking reason')
    .option('--json', 'output JSON')
    .option('--author <author>', 'note author')
    .action(async (id: string, options: HermesKanbanOptions) => {
      const store = buildKanbanStore(options.board);
      const card = await store.blockCard(id, options.reason ?? '', options.author);
      printKanbanResult(
        { kind: 'hermes_kanban_block', boardPath: store.path, card },
        options,
        `Blocked ${renderKanbanCardSummary(card)}\nReason: ${card.blockedReason ?? ''}`,
      );
    });

  kanban
    .command('unblock')
    .description('Clear a Kanban card block')
    .argument('<id>', 'card id')
    .option('--json', 'output JSON')
    .option('--comment <comment>', 'unblock note')
    .option('--author <author>', 'note author')
    .action(async (id: string, options: HermesKanbanOptions) => {
      const store = buildKanbanStore(options.board);
      const card = await store.unblockCard(id, options.comment, options.author);
      printKanbanResult(
        { kind: 'hermes_kanban_unblock', boardPath: store.path, card },
        options,
        `Unblocked ${renderKanbanCardSummary(card)}`,
      );
    });

  kanban
    .command('comment')
    .description('Append a comment to a Kanban card')
    .argument('<id>', 'card id')
    .argument('<text>', 'comment text')
    .option('--json', 'output JSON')
    .option('--author <author>', 'comment author')
    .action(async (id: string, text: string, options: HermesKanbanOptions) => {
      const store = buildKanbanStore(options.board);
      const card = await store.commentCard(id, text, options.author);
      printKanbanResult(
        { kind: 'hermes_kanban_comment', boardPath: store.path, card },
        options,
        `Commented ${renderKanbanCardSummary(card)}`,
      );
    });

  kanban
    .command('heartbeat')
    .description('Record progress heartbeat on a Kanban card')
    .argument('<id>', 'card id')
    .option('--json', 'output JSON')
    .option('--comment <comment>', 'progress note')
    .option('--author <author>', 'heartbeat author')
    .action(async (id: string, options: HermesKanbanOptions) => {
      const store = buildKanbanStore(options.board);
      const card = await store.heartbeatCard(id, options.comment, options.author);
      printKanbanResult(
        { kind: 'hermes_kanban_heartbeat', boardPath: store.path, card },
        options,
        `Heartbeat ${renderKanbanCardSummary(card)}`,
      );
    });

  kanban
    .command('link')
    .description('Attach an artifact, URL, commit, issue, or related reference')
    .argument('<id>', 'card id')
    .argument('<target>', 'target reference')
    .option('--json', 'output JSON')
    .option('--label <label>', 'link label')
    .action(async (id: string, target: string, options: HermesKanbanOptions) => {
      const store = buildKanbanStore(options.board);
      const card = await store.linkCard(id, target, options.label);
      printKanbanResult(
        { kind: 'hermes_kanban_link', boardPath: store.path, card },
        options,
        `Linked ${renderKanbanCardSummary(card)} -> ${target}`,
      );
    });

  kanban
    .command('unlink')
    .description('Remove a link from a Kanban card by link id or target')
    .argument('<id>', 'card id')
    .argument('<linkRef>', 'link id or target reference to remove')
    .option('--json', 'output JSON')
    .action(async (id: string, linkRef: string, options: HermesKanbanOptions) => {
      const store = buildKanbanStore(options.board);
      const card = await store.unlinkCard(id, linkRef);
      printKanbanResult(
        { kind: 'hermes_kanban_unlink', boardPath: store.path, card },
        options,
        `Unlinked ${renderKanbanCardSummary(card)} -/-> ${linkRef}`,
      );
    });

  kanban
    .command('assign')
    .description('Assign a Kanban card to a profile (or clear with --clear)')
    .argument('<id>', 'card id')
    .argument('[assignee]', 'profile/assignee name')
    .option('--json', 'output JSON')
    .option('--clear', 'clear the assignee')
    .option('--author <author>', 'comment author')
    .action(async (id: string, assignee: string | undefined, options: HermesKanbanOptions) => {
      const store = buildKanbanStore(options.board);
      const card = await store.assignCard(id, options.clear ? null : assignee ?? null, options.author);
      printKanbanResult(
        { kind: 'hermes_kanban_assign', boardPath: store.path, card },
        options,
        `Assigned ${renderKanbanCardSummary(card)} -> ${card.assignee ?? '(unassigned)'}`,
      );
    });

  kanban
    .command('archive')
    .description('Archive a Kanban card (hidden from default lists)')
    .argument('<id>', 'card id')
    .option('--json', 'output JSON')
    .option('--comment <comment>', 'archive note')
    .option('--author <author>', 'comment author')
    .action(async (id: string, options: HermesKanbanOptions) => {
      const store = buildKanbanStore(options.board);
      const card = await store.archiveCard(id, options.comment, options.author);
      printKanbanResult(
        { kind: 'hermes_kanban_archive', boardPath: store.path, card },
        options,
        `Archived ${renderKanbanCardSummary(card)}`,
      );
    });

  kanban
    .command('stats')
    .description('Show per-status, per-priority, and per-assignee Kanban counts')
    .option('--json', 'output JSON')
    .action(async (options: HermesKanbanOptions) => {
      const store = buildKanbanStore(options.board);
      const stats = await store.stats();
      const text = [
        `Board: ${store.path}`,
        `Total: ${stats.total} (unassigned: ${stats.unassigned})`,
        `Status: ${Object.entries(stats.byStatus).map(([k, v]) => `${k}=${v}`).join(', ')}`,
        `Priority: ${Object.entries(stats.byPriority).map(([k, v]) => `${k}=${v}`).join(', ')}`,
      ].join('\n');
      printKanbanResult({ kind: 'hermes_kanban_stats', boardPath: store.path, ...stats }, options, text);
    });

  // Every card command can target a specific board with --board (else
  // CODEBUDDY_KANBAN_BOARD / the active board / default).
  for (const cmd of kanban.commands) {
    cmd.option('--board <slug>', 'target board slug (else CODEBUDDY_KANBAN_BOARD, active board, or default)');
  }

  // --- Multi-board management: `hermes kanban boards …` ---
  const boards = kanban.command('boards').description('Manage multiple Kanban boards');

  boards
    .command('list')
    .description('List Kanban boards with card counts and the active board')
    .option('--json', 'output JSON')
    .option('--include-archived', 'include archived boards')
    .action((options: HermesKanbanOptions) => {
      const registry = new KanbanBoardRegistry({ rootDir: process.cwd() });
      const list = registry.list(options.includeArchived === true);
      const text = list
        .map((b) => `${b.current ? '*' : ' '} ${b.slug} — ${b.name} (${b.cardCount} cards)${b.archived ? ' [archived]' : ''}`)
        .join('\n');
      printKanbanResult({ kind: 'hermes_kanban_boards_list', boards: list }, options, text || 'No boards.');
    });

  boards
    .command('create')
    .description('Create a new board and switch to it')
    .argument('<slug>', 'board slug (lowercase letters, digits, hyphens)')
    .option('--json', 'output JSON')
    .option('--name <name>', 'human-readable board name')
    .action((slug: string, options: HermesKanbanOptions) => {
      const registry = new KanbanBoardRegistry({ rootDir: process.cwd() });
      const board = registry.create(slug, options.name);
      printKanbanResult({ kind: 'hermes_kanban_boards_create', board }, options, `Created and switched to board "${board.slug}".`);
    });

  boards
    .command('switch')
    .description('Switch the active board')
    .argument('<slug>', 'board slug')
    .option('--json', 'output JSON')
    .action((slug: string, options: HermesKanbanOptions) => {
      const registry = new KanbanBoardRegistry({ rootDir: process.cwd() });
      const board = registry.switch(slug);
      printKanbanResult({ kind: 'hermes_kanban_boards_switch', board }, options, `Switched to board "${board.slug}".`);
    });

  boards
    .command('rm')
    .description('Archive a board, or hard-delete it with --delete (the default board cannot be removed)')
    .argument('<slug>', 'board slug')
    .option('--json', 'output JSON')
    .option('--delete', 'permanently delete the board file instead of archiving')
    .action((slug: string, options: HermesKanbanOptions) => {
      const registry = new KanbanBoardRegistry({ rootDir: process.cwd() });
      registry.remove(slug, { hardDelete: options.delete === true });
      printKanbanResult(
        { kind: 'hermes_kanban_boards_rm', slug, deleted: options.delete === true },
        options,
        options.delete ? `Deleted board "${slug}".` : `Archived board "${slug}".`,
      );
    });
}

export function registerHermesCommands(program: Command): void {
  const hermes = program
    .command('hermes')
    .description('Inspect the native Hermes-inspired Code Buddy agent profile');

  registerHermesKanbanCommands(hermes);
  registerHermesPortalCommands(hermes);
  registerHermesClawCommands(hermes);

  hermes
    .command('status')
    .description('Show a compact Hermes readiness overview across parity, providers, runtimes, browser, messaging, mobile, learning, and skills')
    .argument('[dispatchProfile]', `active Fleet profile (${FLEET_DISPATCH_PROFILES.join(', ')})`, 'balanced')
    .option('--json', 'output JSON')
    .action(async (profileArg: string, options: HermesCommandOptions) => {
      const status = await buildHermesOverviewStatus(profileArg);
      const profileSuffix = status.dispatchProfile === 'balanced' ? '' : ` ${status.dispatchProfile}`;
      const command = `buddy hermes status${profileSuffix} --json`;
      const payload = {
        command,
        ...status,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(renderHermesOverviewStatus(status));
    });

  hermes
    .command('smoke')
    .description('Run the safe local Hermes smoke suite for runtime, browser, and protocol gateways')
    .option('--json', 'output JSON')
    .action(async (options: HermesCommandOptions) => {
      const suite = await runHermesLocalSmokeSuite();

      if (options.json) {
        console.log(stableJson(suite));
        return;
      }

      console.log(renderHermesLocalSmokeSuite(suite));
    });

  hermes
    .command('parity')
    .description('Show the machine-checkable official Hermes parity manifest')
    .option('--json', 'output JSON')
    .option('--markdown', 'output Markdown')
    .action((options: HermesCommandOptions) => {
      const manifest = buildHermesParityManifest();

      if (options.json) {
        console.log(stableJson(manifest));
        return;
      }

      if (options.markdown) {
        console.log(renderHermesParityManifestMarkdown(manifest));
        return;
      }

      console.log(
        `Hermes parity manifest: ${manifest.summary.total} areas ` +
          `(${manifest.summary.covered} covered, ${manifest.summary.coveredPartial} covered/partial, ` +
          `${manifest.summary.partial} partial, ${manifest.summary.gaps} gaps)`,
      );
      console.log(`Official source: ${manifest.officialSource.repository} @ ${manifest.officialSource.inspectedCommit}`);
      console.log(`Audit: ${manifest.officialSource.auditDocument}`);
      console.log(`Command: ${manifest.command}`);
      console.log('');
      for (const feature of manifest.features) {
        console.log(`${feature.status.padEnd(15)} ${feature.id} - ${feature.area}`);
        console.log(`  Verify: ${feature.verificationCommands[0] ?? 'n/a'}`);
        if (feature.nextWork) {
          console.log(`  Next: ${feature.nextWork}`);
        }
      }
    });

  hermes
    .command('todo')
    .description('Show the prioritized remaining Hermes feature work')
    .option('--json', 'output JSON')
    .option('--limit <n>', 'number of active items to show', '7')
    .option('--include-deferred', 'include deliberately deferred items such as OpenClaw in active todos')
    .action((options: HermesTodoOptions) => {
      const todo = buildHermesParityTodo({
        includeDeferred: options.includeDeferred === true,
        limit: parseOptionalPositiveInteger(options.limit, '--limit'),
      });

      if (options.json) {
        console.log(stableJson(todo));
        return;
      }

      console.log(renderHermesParityTodo(todo));
    });

  hermes
    .command('tools-parity')
    .alias('tools')
    .description('Compare official Hermes tool names against built-in Code Buddy tool schemas')
    .option('--json', 'output JSON')
    .option('--markdown', 'output Markdown')
    .action((options: HermesCommandOptions) => {
      const manifest = buildLocalHermesToolParityManifest();

      if (options.json) {
        console.log(stableJson(manifest));
        return;
      }

      if (options.markdown) {
        console.log(renderHermesToolParityManifestMarkdown(manifest));
        return;
      }

      console.log(renderHermesToolParityManifest(manifest));
    });

  hermes
    .command('toolsets')
    .description('Show the native Fleet toolsets used by the Hermes Agent profile')
    .argument('[dispatchProfile]', `active Fleet profile (${FLEET_DISPATCH_PROFILES.join(', ')})`, 'balanced')
    .option('--json', 'output JSON')
    .action((profileArg: string, options: HermesCommandOptions) => {
      const catalog = buildHermesToolsetsCatalog(profileArg);

      if (options.json) {
        console.log(stableJson(catalog));
        return;
      }

      console.log(renderHermesToolsetsCatalog(catalog));
    });

  hermes
    .command('profile')
    .description('Show the Hermes Agent profile mapped onto Code Buddy primitives')
    .argument('[dispatchProfile]', `default Fleet profile (${FLEET_DISPATCH_PROFILES.join(', ')})`, 'balanced')
    .option('--json', 'output JSON')
    .action((profileArg: string, options: HermesCommandOptions) => {
      const dispatchProfile = normalizeDispatchProfile(profileArg);
      const profile = buildHermesAgentProfile(dispatchProfile);

      if (options.json) {
        console.log(JSON.stringify({
          requestedProfile: profileArg,
          profile,
        }, null, 2));
        return;
      }

      console.log(`\nHermes Agent profile: ${profile.name}`);
      if (profileArg !== dispatchProfile) {
        console.log(`  Requested: ${profileArg} (normalized to balanced)`);
      }
      console.log(`  ID: ${profile.id}`);
      console.log(`  Default Fleet profile: ${profile.defaultDispatchProfile}`);
      console.log(`  Description: ${profile.description}`);
      console.log(
        `  Runtime mapping: ${profile.runtimeMapping.implementation} ` +
          `(${profile.runtimeMapping.codeBuddyRuntime}; upstream ${profile.runtimeMapping.upstreamLanguage} ` +
          `${profile.runtimeMapping.upstreamRuntime})`,
      );
      console.log('\nDispatch profile selection:');
      for (const guidance of profile.dispatchProfileGuidance) {
        console.log(`  ${guidance.profile}: ${guidance.useWhen}`);
      }
      console.log('\nNative surfaces:');
      for (const surface of profile.nativeSurfaces) {
        console.log(`  ${surface.label}: ${surface.codeBuddySurface}`);
        console.log(`    ${surface.purpose}`);
      }
      console.log('\nToolsets:');
      for (const toolset of profile.toolsets) {
        console.log(`  ${toolset.toolsetId}`);
        console.log(`    allow: ${formatList(toolset.allowedTools)}`);
        console.log(`    confirm: ${formatList(toolset.confirmTools)}`);
        console.log(`    deny: ${formatList(toolset.deniedTools)}`);
      }
      console.log('\nUse with: buddy --agent hermes');
      console.log('');
    });

  const identity = hermes
    .command('identity')
    .alias('id')
    .description('Inspect the built-in Hermes Agent identity and guardrails');

  identity
    .command('status')
    .description('Print Hermes Agent identity, source, toolset, and guardrail status')
    .argument('[dispatchProfile]', `default Fleet profile (${FLEET_DISPATCH_PROFILES.join(', ')})`, 'balanced')
    .option('--json', 'output JSON')
    .action((profileArg: string, options: HermesCommandOptions) => {
      const status = buildHermesIdentityStatus(profileArg);
      const profileSuffix = status.identity.dispatchProfile === 'balanced' ? '' : ` ${status.identity.dispatchProfile}`;
      const command = `buddy hermes identity status${profileSuffix} --json`;
      const payload = {
        command,
        ...status,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(renderHermesIdentityStatus(status));
    });

  hermes
    .command('prompt-size')
    .description('Show an offline byte breakdown of the Hermes prompt and active tool schemas')
    .argument('[dispatchProfile]', `default Fleet profile (${FLEET_DISPATCH_PROFILES.join(', ')})`, 'balanced')
    .option('--json', 'output JSON')
    .action((profileArg: string, options: HermesCommandOptions) => {
      const diagnostic = buildHermesPromptSizeDiagnostic(profileArg);
      const profileSuffix = diagnostic.dispatchProfile === 'balanced' ? '' : ` ${diagnostic.dispatchProfile}`;
      const command = `buddy hermes prompt-size${profileSuffix} --json`;
      const payload = {
        command,
        ...diagnostic,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(renderHermesPromptSizeDiagnostic(diagnostic));
    });

  const memory = hermes
    .command('memory')
    .description('Inspect Hermes memory provider readiness');

  memory
    .command('status')
    .description('Print local and external memory provider readiness')
    .option('--json', 'output JSON')
    .action((options: HermesCommandOptions) => {
      const readiness = buildHermesMemoryProvidersReadiness();
      const command = 'buddy hermes memory status --json';
      const payload = {
        command,
        kind: 'hermes_memory_providers_status',
        schemaVersion: 1,
        readiness,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(renderHermesMemoryProvidersReadiness(readiness));
    });

  memory
    .command('probe [provider]')
    .description('Live round-trip test: write+read a marker through a memory provider (defaults to the active one)')
    .option('--json', 'output JSON')
    .action(async (provider: string | undefined, options: HermesCommandOptions) => {
      const result = await probeMemoryProvider(provider);
      const command = `buddy hermes memory probe${provider ? ` ${provider}` : ''} --json`;
      if (options.json) {
        console.log(stableJson({ command, ...result }));
        return;
      }
      console.log(`Command: ${command}`);
      console.log(renderHermesMemoryProbe(result));
      if (!result.ok) process.exitCode = 1;
    });

  const learning = hermes
    .command('learning')
    .description('Inspect Hermes closed learning loop readiness');

  learning
    .command('status')
    .description('Print Learning Agent, lesson, user-model, skill telemetry and review-gate readiness')
    .option('--json', 'output JSON')
    .option('--limit <n>', 'number of recent runs to inspect', '10')
    .action((options: HermesLearningStatusOptions) => {
      const limit = parseOptionalPositiveInteger(options.limit, '--limit');
      const command = limit === 10
        ? 'buddy hermes learning status --json'
        : `buddy hermes learning status --limit ${limit} --json`;
      const status = buildHermesLearningLoopStatus({
        limit,
      });

      if (options.json) {
        console.log(stableJson({ command, ...status }));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(renderHermesLearningLoopStatus(status));
    });

  const skills = hermes
    .command('skills')
    .description('Inspect Hermes-compatible skill package readiness');

  skills
    .command('status')
    .description('Print installed SKILL.md package health and review-gated lifecycle commands')
    .option('--json', 'output JSON')
    .option('--limit <n>', 'number of installed skill packages to include', '20')
    .action((options: HermesLearningStatusOptions) => {
      const summary = buildHermesSkillPackageSummary(process.cwd(), {
        limit: parseOptionalPositiveInteger(options.limit, '--limit'),
        previewChars: 0,
      });
      const command = 'buddy hermes skills status --json';
      const payload = {
        command,
        kind: 'hermes_skills_status',
        schemaVersion: 1,
        summary,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(renderHermesSkillPackageSummary(summary));
    });

  const messaging = hermes
    .command('messaging')
    .description('Inspect Hermes messaging gateway readiness');

  messaging
    .command('status')
    .description('Print configured and runtime messaging channel readiness')
    .option('--json', 'output JSON')
    .option('--config <path>', 'channel config path')
    .action(async (options: HermesMessagingStatusOptions) => {
      const status = await buildHermesMessagingGatewayStatus(options.config);
      const command = 'buddy hermes messaging status --json';
      const payload = {
        command,
        kind: 'hermes_messaging_gateway_status',
        schemaVersion: 1,
        status,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(renderHermesMessagingGatewayStatus(status));
    });

  const mobile = hermes
    .command('mobile')
    .description('Inspect Hermes mobile supervision gateway readiness');

  mobile
    .command('status')
    .description('Print mobile supervision routes, policy, pairing, and approval queue readiness')
    .argument('[query...]', 'run recall query for the mobile supervision snapshot')
    .option('-n, --limit <n>', 'number of matching runs to inspect for snapshot readiness', '20')
    .option('--source <source>', 'filter by source/channel/tag (repeatable: cli, cowork, fleet, scheduled, mobile)', collectHermesOption, [])
    .option('--json', 'output JSON')
    .action(async (queryParts: string[] | undefined, options: HermesMobileStatusOptions) => {
      const limit = parseOptionalPositiveInteger(options.limit, '--limit') ?? 20;
      const commandParts = ['buddy hermes mobile status'];
      if ((queryParts ?? []).join(' ').trim()) {
        commandParts.push('<query>');
      }
      const sourceFilters = options.source ?? [];
      for (let index = 0; index < sourceFilters.length; index++) {
        commandParts.push('--source <source>');
      }
      if (limit !== 20) {
        commandParts.push(`--limit ${limit}`);
      }
      commandParts.push('--json');
      const command = commandParts.join(' ');
      const status = await buildHermesMobileSupervisionStatus(queryParts ?? [], options);

      if (options.json) {
        console.log(stableJson({ command, ...status }));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(renderHermesMobileSupervisionStatus(status));
    });

  const trajectories = hermes
    .command('trajectories')
    .alias('trajectory')
    .description('Inspect Hermes trajectory export, recall, and research eval compatibility');

  trajectories
    .command('status')
    .description('Print trajectory export/compression compatibility and optional real run probes')
    .argument('[query...]', 'optional recall query to probe against stored runs')
    .option('--run-id <runId>', 'optional stored run id to probe with redacted trajectory export')
    .option('--include-artifact-content', 'include redacted artifact content in the run export probe')
    .option('--max-artifact-bytes <bytes>', 'max redacted artifact preview bytes for the run export probe', '4000')
    .option('--json', 'output JSON')
    .action((queryParts: string[] | undefined, options: HermesTrajectoriesStatusOptions) => {
      const query = (queryParts ?? []).join(' ');
      const maxArtifactBytes = parseOptionalPositiveInteger(options.maxArtifactBytes, '--max-artifact-bytes');
      const commandParts = ['buddy hermes trajectories status'];
      if (query.trim()) {
        commandParts.push('<query>');
      }
      if (options.runId?.trim()) {
        commandParts.push(`--run-id ${options.runId.trim()}`);
      }
      if (options.includeArtifactContent === true) {
        commandParts.push('--include-artifact-content');
      }
      if (String(maxArtifactBytes) !== '4000') {
        commandParts.push(`--max-artifact-bytes ${maxArtifactBytes}`);
      }
      commandParts.push('--json');
      const command = commandParts.join(' ');
      const report = buildHermesTrajectoryCompatibilityReport({
        includeArtifactContent: options.includeArtifactContent === true,
        maxArtifactBytes,
        query,
        runId: options.runId,
      });

      if (options.json) {
        console.log(stableJson({ command, ...report }));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(renderHermesTrajectoryCompatibilityReport(report));
    });

  const protocols = hermes
    .command('protocols')
    .alias('protocol')
    .description('Inspect Hermes MCP, A2A, and ACP gateway readiness');

  protocols
    .command('status')
    .description('Print protocol gateway readiness for MCP, A2A, ACP, and channel bridges')
    .option('--json', 'output JSON')
    .action((options: HermesCommandOptions) => {
      const readiness = buildHermesProtocolGatewayReadiness();
      const command = 'buddy hermes protocols status --json';

      if (options.json) {
        console.log(stableJson({ command, ...readiness }));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(renderHermesProtocolGatewayReadiness(readiness));
    });

  hermes
    .command('protocols-smoke')
    .description('Run an opt-in live smoke for local MCP stdio plus A2A/ACP HTTP routes')
    .argument('[target]', 'smoke target (only local is supported)', 'local')
    .option('--json', 'output JSON')
    .action(async (target: string, options: HermesProtocolSmokeOptions) => {
      if (target !== 'local') {
        throw new Error(`Unsupported protocols smoke target: ${target}`);
      }

      const result = await runHermesProtocolGatewaySmoke();

      if (options.json) {
        console.log(stableJson(result));
        return;
      }

      console.log(renderHermesProtocolGatewaySmoke(result));
    });

  const providers = hermes
    .command('providers')
    .alias('provider')
    .description('Inspect Hermes provider and active model readiness');

  providers
    .command('status')
    .description('Print active model, provider credentials, and capability readiness')
    .option('--json', 'output JSON')
    .action((options: HermesCommandOptions) => {
      const readiness = buildHermesProviderReadiness();
      const command = 'buddy hermes providers status --json';
      const payload = {
        command,
        kind: 'hermes_provider_readiness_status',
        schemaVersion: 1,
        readiness,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(renderHermesProviderReadiness(readiness));
    });

  const model = hermes
    .command('model')
    .alias('models')
    .description('Inspect the active Hermes model with compact setup guidance');

  model
    .command('status')
    .description('Print active model, credential source names, and next setup checks')
    .option('--json', 'output JSON')
    .action((options: HermesCommandOptions) => {
      const status = buildHermesModelStatus();
      const command = 'buddy hermes model status --json';
      const payload = {
        command,
        ...status,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(renderHermesModelStatus(status));
    });

  hermes
    .command('plan')
    .description('Print a short Hermes integration checklist for the selected dispatch profile')
    .argument('[dispatchProfile]', `default Fleet profile (${FLEET_DISPATCH_PROFILES.join(', ')})`, 'balanced')
    .option('--json', 'output JSON')
    .option('--markdown', 'output Markdown')
    .option('--plan-output <file>', 'write plan output to a file')
    .action((profileArg: string, options: HermesCommandOptions) => {
      const dispatchProfile = normalizeDispatchProfile(profileArg);
      const plan = buildHermesIntegrationPlan(dispatchProfile);
      const outputFormat = inferHermesPlanOutputFormat(options);
      const output = renderHermesPlanOutput(profileArg, plan, outputFormat);

      if (options.planOutput) {
        writeHermesPlanOutput(options.planOutput, output);
        console.log(`Hermes plan exported to ${options.planOutput}`);
        return;
      }

      console.log(output);
    });

  hermes
    .command('agent')
    .description('Print the built-in Hermes Agent system prompt')
    .argument('[dispatchProfile]', `default Fleet profile (${FLEET_DISPATCH_PROFILES.join(', ')})`, 'balanced')
    .option('--json', 'output JSON')
    .action((profileArg: string, options: HermesCommandOptions) => {
      const dispatchProfile = normalizeDispatchProfile(profileArg);
      const systemPrompt = buildHermesAgentSystemPrompt(dispatchProfile);

      if (options.json) {
        console.log(JSON.stringify({
          id: 'hermes',
          name: 'Hermes Agent',
          requestedProfile: profileArg,
          dispatchProfile,
          systemPrompt,
        }, null, 2));
        return;
      }

      console.log('\nHermes Agent system prompt:\n');
      console.log(systemPrompt);
      console.log('');
    });

  hermes
    .command('hooks')
    .description('Show the Hermes lifecycle hook contract and configured handlers')
    .option('--json', 'output JSON')
    .action((options: HermesCommandOptions) => {
      const manifest = buildHermesHookLifecycleManifest(process.cwd());
      const command = 'buddy hermes hooks --json';
      const publicManifest = {
        command,
        ...manifest,
        workingDirectory: '[workspace]',
      };

      if (options.json) {
        console.log(stableJson(publicManifest));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(renderHermesHookLifecycleManifest(publicManifest));
    });

  hermes
    .command('doctor')
    .description('Check the built-in Hermes Agent profile and effective tool filter')
    .argument('[dispatchProfile]', `default Fleet profile (${FLEET_DISPATCH_PROFILES.join(', ')})`, 'balanced')
    .option('--json', 'output JSON')
    .action((profileArg: string, options: HermesCommandOptions) => {
      const diagnostics = buildHermesAgentDiagnostics({ dispatchProfile: profileArg });
      const command = `buddy hermes doctor ${profileArg} --json`;

      if (options.json) {
        console.log(stableJson({
          command,
          requestedProfile: profileArg,
          diagnostics,
        }));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(`\nHermes Agent doctor: ${formatOk(diagnostics.ok)}`);
      if (profileArg !== diagnostics.dispatchProfile) {
        console.log(`  Requested: ${profileArg} (normalized to balanced)`);
      }
      console.log(`  Source: ${diagnostics.source}`);
      console.log(`  Agent path: ${diagnostics.agentPath ?? 'none'}`);
      console.log(`  Dispatch profile: ${diagnostics.dispatchProfile}`);
      console.log(`  Agent default dispatch profile: ${diagnostics.fleetDispatchProfile ?? 'none'}`);
      console.log(
        `  Requires explicit delegation profile: ${diagnostics.requireExplicitDispatchProfile ? 'yes' : 'no'}`,
      );
      console.log(`  Active toolset: ${diagnostics.activeToolset.toolsetId}`);
      console.log(`  Agent tools: ${formatAllowList(diagnostics.enabledTools)}`);
      console.log(`  Agent disabled tools: ${formatList(diagnostics.disabledTools)}`);
      console.log(`  Effective runnable tools: ${formatAllowList(diagnostics.effectiveEnabledTools)}`);
      console.log(
        `  Effective filter allow: ${formatAllowList(diagnostics.effectiveToolFilter.enabledPatterns)}`,
      );
      console.log(
        `  Effective filter deny: ${formatList(diagnostics.effectiveToolFilter.disabledPatterns)}`,
      );
      console.log('  Provider/model readiness:');
      console.log(`    Model: ${diagnostics.providerReadiness.activeModel.model}`);
      console.log(`    Provider: ${diagnostics.providerReadiness.activeProvider.label}`);
      console.log(
        `    Credentials/endpoint: ${diagnostics.providerReadiness.activeProvider.configured ? 'configured' : 'missing'}`,
      );
      console.log(
        `    Capabilities: tool-calls=${diagnostics.providerReadiness.activeModel.supportsToolCalls ? 'yes' : 'no'}, ` +
        `reasoning=${diagnostics.providerReadiness.activeModel.supportsReasoning ? 'yes' : 'no'}, ` +
        `vision=${diagnostics.providerReadiness.activeModel.supportsVision ? 'yes' : 'no'}`,
      );
      console.log(
        `    Context/output: ${diagnostics.providerReadiness.activeModel.contextWindow ?? 'unknown'} / ` +
        `${diagnostics.providerReadiness.activeModel.maxOutputTokens ?? 'unknown'} tokens`,
      );
      console.log(
        `    Nous Tool Gateway: ${diagnostics.providerReadiness.portal.portal.toolGatewayConfigured ? 'configured' : 'not configured'}`,
      );
      console.log('  Runtime backends:');
      console.log(
        `    Available: ${diagnostics.runtimeBackends.availableCount}/${diagnostics.runtimeBackends.backends.length}, ` +
        `runnable: ${diagnostics.runtimeBackends.runnableCount}/${diagnostics.runtimeBackends.backends.length}, ` +
        `configured remote: ${diagnostics.runtimeBackends.configuredRemoteCount}`,
      );
      for (const backend of diagnostics.runtimeBackends.backends) {
        console.log(
          `    ${backend.id}: ${backend.status}` +
          `${backend.version ? ` (${backend.version})` : ''}`,
        );
      }
      console.log('  Browser automation backends:');
      console.log(
        `    Local runnable: ${diagnostics.browserBackends.localRunnableCount}, ` +
        `managed configured: ${diagnostics.browserBackends.managedConfiguredCount}`,
      );
      for (const backend of diagnostics.browserBackends.backends) {
        console.log(
          `    ${backend.id}: ${backend.status}` +
          `${backend.version ? ` (${backend.version})` : ''}`,
        );
      }
      console.log('  Dispatch profile selection:');
      for (const guidance of diagnostics.dispatchProfileGuidance) {
        console.log(`    ${guidance.profile}: ${guidance.useWhen}`);
      }
      console.log(`  Native surfaces: ${formatList(diagnostics.nativeSurfaceIds)}`);

      if (diagnostics.issues.length > 0) {
        console.log('\nIssues:');
        for (const issue of diagnostics.issues) {
          console.log(`  - ${issue}`);
        }
      }

      if (diagnostics.recommendations.length > 0) {
        console.log('\nRecommendations:');
        for (const recommendation of diagnostics.recommendations) {
          console.log(`  - ${recommendation}`);
        }
      }

      if (diagnostics.providerReadiness.issues.length > 0) {
        console.log('\nProvider/model issues:');
        for (const issue of diagnostics.providerReadiness.issues) {
          console.log(`  - ${issue}`);
        }
      }

      if (diagnostics.providerReadiness.recommendations.length > 0) {
        console.log('\nProvider/model recommendations:');
        for (const recommendation of diagnostics.providerReadiness.recommendations) {
          console.log(`  - ${recommendation}`);
        }
      }

      if (diagnostics.runtimeBackends.issues.length > 0) {
        console.log('\nRuntime backend issues:');
        for (const issue of diagnostics.runtimeBackends.issues) {
          console.log(`  - ${issue}`);
        }
      }

      if (diagnostics.runtimeBackends.recommendations.length > 0) {
        console.log('\nRuntime backend recommendations:');
        for (const recommendation of diagnostics.runtimeBackends.recommendations) {
          console.log(`  - ${recommendation}`);
        }
      }

      if (diagnostics.browserBackends.issues.length > 0) {
        console.log('\nBrowser backend issues:');
        for (const issue of diagnostics.browserBackends.issues) {
          console.log(`  - ${issue}`);
        }
      }

      if (diagnostics.browserBackends.recommendations.length > 0) {
        console.log('\nBrowser backend recommendations:');
        for (const recommendation of diagnostics.browserBackends.recommendations) {
          console.log(`  - ${recommendation}`);
        }
      }

      if (
        diagnostics.issues.length === 0 &&
        diagnostics.recommendations.length === 0 &&
        diagnostics.providerReadiness.issues.length === 0 &&
        diagnostics.providerReadiness.recommendations.length === 0 &&
        diagnostics.runtimeBackends.issues.length === 0 &&
        diagnostics.runtimeBackends.recommendations.length === 0 &&
        diagnostics.browserBackends.issues.length === 0 &&
        diagnostics.browserBackends.recommendations.length === 0
      ) {
        console.log('\nNo issues or recommendations.');
      }

      console.log('');
    });

  const browser = hermes
    .command('browser')
    .description('Inspect Hermes browser backend readiness');

  browser
    .command('status')
    .description('Print local and managed browser backend readiness')
    .option('--json', 'output JSON')
    .action((options: HermesCommandOptions) => {
      const readiness = buildHermesBrowserBackendsReadiness();
      const command = 'buddy hermes browser status --json';
      const payload = {
        command,
        kind: 'hermes_browser_backends_status',
        schemaVersion: 1,
        readiness,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(renderHermesBrowserBackendsReadiness(readiness));
    });

  hermes
    .command('browser-smoke')
    .description('Run an opt-in live smoke for one Hermes browser backend')
    .argument('<backendId>', 'backend id from buddy hermes browser status, for example local-playwright')
    .option('--cdp-url <url>', 'Chrome DevTools endpoint for remote-cdp smoke')
    .option('--recording-dir <dir>', 'directory for browser recording artifacts')
    .option('--json', 'output JSON')
    .action(async (backendId: string, options: HermesBrowserSmokeOptions) => {
      const result = await runHermesBrowserBackendSmoke({
        artifactsDir: options.recordingDir,
        backendId,
        cdpUrl: options.cdpUrl,
      });
      const payload = {
        kind: 'hermes_browser_backend_smoke',
        schemaVersion: 1,
        result,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(renderHermesBrowserSmoke(result));
    });

  const runtime = hermes
    .command('runtime')
    .description('Inspect Hermes runtime backend readiness');

  runtime
    .command('status')
    .description('Print local, sandbox, and remote runtime backend readiness')
    .option('--json', 'output JSON')
    .action((options: HermesCommandOptions) => {
      const readiness = buildHermesRuntimeBackendsReadiness();
      const command = 'buddy hermes runtime status --json';
      const payload = {
        command,
        kind: 'hermes_runtime_backends_status',
        schemaVersion: 1,
        readiness,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(`Command: ${command}`);
      console.log(renderHermesRuntimeBackendsReadiness(readiness));
    });

  hermes
    .command('runtime-smoke')
    .description('Run an opt-in live smoke for one Hermes runtime backend')
    .argument('<backendId>', 'backend id from buddy hermes runtime status, or auto for the safe local-first route')
    .option('--allow-docker', 'allow Docker smoke to start a no-network container and pull the image if missing')
    .option('--allow-remote', 'allow configured remote backend smoke commands to contact their provider')
    .option('--json', 'output JSON')
    .option('--timeout-ms <ms>', 'smoke timeout in milliseconds')
    .action((backendId: string, options: HermesRuntimeSmokeOptions) => {
      const result = runHermesRuntimeBackendSmoke({
        allowDockerSmoke: options.allowDocker,
        allowRemoteSmoke: options.allowRemote,
        backendId,
        timeoutMs: parseOptionalPositiveInteger(options.timeoutMs, '--timeout-ms'),
      });
      const payload = {
        kind: 'hermes_runtime_backend_smoke',
        schemaVersion: 1,
        result,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(renderHermesRuntimeSmoke(result));
    });
}
