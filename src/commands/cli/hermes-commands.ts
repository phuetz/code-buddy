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
} from '../../agent/hermes-tool-parity-local.js';
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
  buildHermesRuntimeLifecyclePlan,
  buildHermesRuntimeBackendsReadiness,
  isHermesRuntimeLifecycleAction,
  runHermesRuntimeLifecycleAction,
  renderHermesRuntimeBackendsReadiness,
  runHermesRuntimeBackendSmoke,
  type HermesRuntimeLifecyclePlan,
  type HermesRuntimeLifecycleResult,
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
} from '../../agent/hermes-memory-providers.js';
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
}

interface HermesRuntimeSmokeOptions extends HermesCommandOptions {
  timeoutMs?: string;
}

interface HermesRuntimeLifecycleOptions extends HermesCommandOptions {
  execute?: boolean;
  target?: string;
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
    pairing: string;
    approvals: string;
  };
  recommendations: string[];
}

type HermesPlanOutputFormat = 'text' | 'json' | 'markdown';

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

function formatAllowList(values: readonly string[]): string {
  return values.length > 0 ? values.join(', ') : 'all';
}

function formatOk(ok: boolean): string {
  return ok ? 'ok' : 'needs attention';
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
    notes: [
      'This is the Code Buddy native Fleet/Hermes toolset mapping, not the upstream Python runtime.',
      'Decisions are policy previews for representative tools; model-facing schemas are filtered again at runtime.',
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
  const lines = [
    `Hermes TODO: ${todo.summary.activeTodoCount} active feature items ` +
      `(${todo.summary.partial} partial, ${todo.summary.gaps} gaps in full manifest)`,
    `Official source: ${todo.officialSource.repository} @ ${todo.officialSource.inspectedCommit}`,
    `Audit: ${todo.officialSource.auditDocument}`,
    '',
    'Next active work:',
  ];

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

function renderHermesRuntimeLifecyclePlan(plan: HermesRuntimeLifecyclePlan): string {
  const lines = [
    `Hermes runtime lifecycle (${plan.backendId}/${plan.action}): ${plan.status}`,
    `  Backend: ${plan.label ?? plan.backendId}`,
    `  Target: ${plan.target ?? 'n/a'}`,
    `  Command: ${plan.displayCommand ?? 'none'}`,
    `  Side effect: ${plan.sideEffect}`,
    `  Requires approval: ${plan.requiresApproval ? 'yes' : 'no'}`,
  ];

  if (plan.docs.length > 0) {
    lines.push(`  Docs: ${plan.docs.join(', ')}`);
  }

  if (plan.notes.length > 0) {
    lines.push('', 'Notes:', ...plan.notes.map((note) => `  - ${note}`));
  }

  if (plan.remediation.length > 0) {
    lines.push('', 'Remediation:', ...plan.remediation.map((item) => `  - ${item}`));
  }

  return lines.join('\n');
}

function renderHermesRuntimeLifecycleResult(result: HermesRuntimeLifecycleResult): string {
  const lines = [
    `Hermes runtime lifecycle execution (${result.plan.backendId}/${result.plan.action}): ${result.status}`,
    `  Backend: ${result.plan.label ?? result.plan.backendId}`,
    `  Target: ${result.plan.target ?? 'n/a'}`,
    `  Command: ${result.plan.displayCommand ?? 'none'}`,
    `  Exit: ${result.exitCode ?? 'n/a'}`,
    `  Duration: ${result.durationMs}ms`,
  ];

  if (result.output) {
    lines.push(`  Output: ${result.output}`);
  }

  if (result.stateBefore || result.stateAfter) {
    lines.push('', 'State reconciliation:');
    if (result.stateBefore) {
      lines.push(
        `  - before: ${result.stateBefore.ok ? 'ok' : 'failed'} ` +
        `${result.stateBefore.command ?? 'none'} ${result.stateBefore.args.join(' ')}`.trim() +
        ` targetSeen=${result.stateBefore.targetSeen ?? 'n/a'}`,
      );
    }
    if (result.stateAfter) {
      lines.push(
        `  - after: ${result.stateAfter.ok ? 'ok' : 'failed'} ` +
        `${result.stateAfter.command ?? 'none'} ${result.stateAfter.args.join(' ')}`.trim() +
        ` targetSeen=${result.stateAfter.targetSeen ?? 'n/a'}`,
      );
    }
  }

  return lines.join('\n');
}

function buildKanbanStore(): KanbanStore {
  return new KanbanStore({ rootDir: process.cwd() });
}

function parseKanbanStatus(value: string | undefined): KanbanStatus | undefined {
  if (!value) return undefined;
  if (value === 'todo' || value === 'in_progress' || value === 'blocked' || value === 'done') {
    return value;
  }
  throw new Error('status must be one of: todo, in_progress, blocked, done');
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
    lines.push(`${tool.label.padEnd(22)} ${tool.partner.padEnd(28)} ${state}`);
    if (tool.notes.length > 0) {
      lines.push(`  ${tool.notes.join(' ')}`);
    }
  }

  return lines.join('\n');
}

function printHermesPortalStatus(status: HermesPortalStatus, options: HermesCommandOptions, toolsOnly = false): void {
  if (options.json) {
    console.log(stableJson(status));
    return;
  }

  console.log(toolsOnly ? renderHermesPortalTools(status) : renderHermesPortalStatus(status));
}

async function buildHermesMessagingGatewayStatus(configPath?: string): Promise<ChannelStatusReport> {
  const { getChannelManager } = await import('../../channels/index.js');
  const manager = getChannelManager();
  return buildChannelStatusReport(manager.getStatus(), configPath);
}

function renderHermesMessagingGatewayStatus(report: ChannelStatusReport): string {
  const lines = [
    'Hermes messaging gateway:',
    `  Configured: ${report.config.configuredCount} (${report.config.enabledCount} enabled, ${report.config.disabledCount} disabled)`,
    `  Runtime: ${report.runtime.connectedCount}/${report.runtime.registeredCount} connected`,
    `  Authenticated: ${report.runtime.authenticatedCount}`,
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
      lines.push(`  - ${provider.label}: ${state}`);
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
      pairing: `buddy run mobile-pairing-state "${contract.query}" --json`,
      approvals: `buddy run mobile-approval-queue "${contract.query}" --json`,
    },
    recommendations: [
      'Start the local server before using a phone: buddy server --port 3000.',
      'Pairing-code and approval routes are local-operator-only; do not expose them directly over LAN.',
      'Mobile devices may read snapshots and submit draft prompts, but execution and file mutations remain local.',
      'Use buddy run mobile-gateway-check to evaluate any new route before implementing it.',
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
  lines.push(`  - ${status.commands.server}`);
  lines.push(`  - ${status.commands.snapshot}`);
  lines.push(`  - ${status.commands.contract}`);
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
      printHermesPortalStatus(buildHermesPortalStatus(), options);
    });

  portal
    .command('tools')
    .description('List Tool Gateway tools and whether Code Buddy routes them via Nous or direct providers')
    .option('--json', 'output JSON')
    .action((options: HermesCommandOptions) => {
      printHermesPortalStatus(buildHermesPortalStatus(), options, true);
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
      const store = buildKanbanStore();
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
      const store = buildKanbanStore();
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
      const store = buildKanbanStore();
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
      const store = buildKanbanStore();
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
      const store = buildKanbanStore();
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
      const store = buildKanbanStore();
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
      const store = buildKanbanStore();
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
      const store = buildKanbanStore();
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
      const store = buildKanbanStore();
      const card = await store.linkCard(id, target, options.label);
      printKanbanResult(
        { kind: 'hermes_kanban_link', boardPath: store.path, card },
        options,
        `Linked ${renderKanbanCardSummary(card)} -> ${target}`,
      );
    });
}

export function registerHermesCommands(program: Command): void {
  const hermes = program
    .command('hermes')
    .description('Inspect the native Hermes-inspired Code Buddy agent profile');

  registerHermesKanbanCommands(hermes);
  registerHermesPortalCommands(hermes);

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

  hermes
    .command('prompt-size')
    .description('Show an offline byte breakdown of the Hermes prompt and active tool schemas')
    .argument('[dispatchProfile]', `default Fleet profile (${FLEET_DISPATCH_PROFILES.join(', ')})`, 'balanced')
    .option('--json', 'output JSON')
    .action((profileArg: string, options: HermesCommandOptions) => {
      const diagnostic = buildHermesPromptSizeDiagnostic(profileArg);

      if (options.json) {
        console.log(stableJson(diagnostic));
        return;
      }

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
      const payload = {
        kind: 'hermes_memory_providers_status',
        schemaVersion: 1,
        readiness,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(renderHermesMemoryProvidersReadiness(readiness));
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
      const payload = {
        kind: 'hermes_messaging_gateway_status',
        schemaVersion: 1,
        status,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

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
      const status = await buildHermesMobileSupervisionStatus(queryParts ?? [], options);

      if (options.json) {
        console.log(stableJson(status));
        return;
      }

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
      const report = buildHermesTrajectoryCompatibilityReport({
        includeArtifactContent: options.includeArtifactContent === true,
        maxArtifactBytes: parseOptionalPositiveInteger(options.maxArtifactBytes, '--max-artifact-bytes'),
        query: (queryParts ?? []).join(' '),
        runId: options.runId,
      });

      if (options.json) {
        console.log(stableJson(report));
        return;
      }

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

      if (options.json) {
        console.log(stableJson(readiness));
        return;
      }

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
      const payload = {
        kind: 'hermes_provider_readiness_status',
        schemaVersion: 1,
        readiness,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(renderHermesProviderReadiness(readiness));
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

      if (options.json) {
        console.log(JSON.stringify(manifest, null, 2));
        return;
      }

      console.log(renderHermesHookLifecycleManifest(manifest));
    });

  hermes
    .command('doctor')
    .description('Check the built-in Hermes Agent profile and effective tool filter')
    .argument('[dispatchProfile]', `default Fleet profile (${FLEET_DISPATCH_PROFILES.join(', ')})`, 'balanced')
    .option('--json', 'output JSON')
    .action((profileArg: string, options: HermesCommandOptions) => {
      const diagnostics = buildHermesAgentDiagnostics({ dispatchProfile: profileArg });

      if (options.json) {
        console.log(JSON.stringify({
          requestedProfile: profileArg,
          diagnostics,
        }, null, 2));
        return;
      }

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
      const payload = {
        kind: 'hermes_browser_backends_status',
        schemaVersion: 1,
        readiness,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

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
      const payload = {
        kind: 'hermes_runtime_backends_status',
        schemaVersion: 1,
        readiness,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(renderHermesRuntimeBackendsReadiness(readiness));
    });

  runtime
    .command('lifecycle')
    .description('Plan or explicitly execute a guarded lifecycle action for a managed remote runtime backend')
    .argument('<backendId>', 'backend id from buddy hermes runtime status, for example daytona')
    .argument('<action>', 'one of provision, hibernate, wake, attach, teardown')
    .option('--target <id>', 'sandbox, workspace, or host id/name required by attach/hibernate/wake/teardown')
    .option('--execute', 'execute the lifecycle plan when the required allow flags are present')
    .option('--timeout-ms <ms>', 'execution timeout in milliseconds')
    .option('--json', 'output JSON')
    .action((backendId: string, actionArg: string, options: HermesRuntimeLifecycleOptions) => {
      if (!isHermesRuntimeLifecycleAction(actionArg)) {
        throw new Error('action must be one of: provision, hibernate, wake, attach, teardown');
      }

      if (options.execute) {
        const result = runHermesRuntimeLifecycleAction({
          action: actionArg,
          backendId,
          target: options.target,
          timeoutMs: parseOptionalPositiveInteger(options.timeoutMs, '--timeout-ms'),
        });
        const payload = {
          kind: 'hermes_runtime_lifecycle_result',
          schemaVersion: 1,
          result,
        };

        if (options.json) {
          console.log(stableJson(payload));
          return;
        }

        console.log(renderHermesRuntimeLifecycleResult(result));
        return;
      }

      const plan = buildHermesRuntimeLifecyclePlan({
        action: actionArg,
        backendId,
        target: options.target,
      });
      const payload = {
        kind: 'hermes_runtime_lifecycle_plan',
        schemaVersion: 1,
        plan,
      };

      if (options.json) {
        console.log(stableJson(payload));
        return;
      }

      console.log(renderHermesRuntimeLifecyclePlan(plan));
    });

  hermes
    .command('runtime-smoke')
    .description('Run an opt-in live smoke for one Hermes runtime backend')
    .argument('<backendId>', 'backend id from buddy hermes runtime status, for example local')
    .option('--json', 'output JSON')
    .option('--timeout-ms <ms>', 'smoke timeout in milliseconds')
    .action((backendId: string, options: HermesRuntimeSmokeOptions) => {
      const result = runHermesRuntimeBackendSmoke({
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
