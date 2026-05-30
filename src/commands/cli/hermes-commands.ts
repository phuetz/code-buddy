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

import {
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
import { buildHermesAgentDiagnostics } from '../../agent/hermes-agent-diagnostics.js';
import {
  buildHermesParityManifest,
  renderHermesParityManifestMarkdown,
} from '../../agent/hermes-parity-manifest.js';
import {
  buildHermesToolParityManifest,
  renderHermesToolParityManifestMarkdown,
  type HermesToolParityManifest,
} from '../../agent/hermes-tool-parity-manifest.js';
import {
  buildHermesHookLifecycleManifest,
  renderHermesHookLifecycleManifest,
} from '../../hooks/hermes-lifecycle-hooks.js';
import type { CodeBuddyTool } from '../../codebuddy/client.js';
import {
  CORE_TOOLS,
  MORPH_EDIT_TOOL,
  isMorphEnabled,
  SEARCH_TOOLS,
  TODO_TOOLS,
  CRON_TOOLS,
  WEB_TOOLS,
  ADVANCED_TOOLS,
  MULTIMODAL_TOOLS,
  COMPUTER_CONTROL_TOOLS,
  BROWSER_TOOLS,
  CANVAS_TOOLS,
  AGENT_TOOLS,
  FIRECRAWL_TOOLS,
  LSP_TOOLS,
  SECRETS_TOOLS,
  ADVISOR_TOOLS,
  ASK_USER_QUESTION_TOOLS,
  EXIT_PLAN_MODE_TOOLS,
  CODEBASE_REPLACE_TOOLS,
  SESSION_TOOLS,
  GITNEXUS_TOOLS,
} from '../../codebuddy/tool-definitions/index.js';
import { FLEET_TOOLS } from '../../codebuddy/fleet-tool-defs.js';
import { filterTools } from '../../utils/tool-filter.js';

interface HermesCommandOptions {
  json?: boolean;
  markdown?: boolean;
  planOutput?: string;
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

function collectOfflineBuiltinTools(): CodeBuddyTool[] {
  const groups: CodeBuddyTool[][] = [
    CORE_TOOLS,
    ...(isMorphEnabled() ? [[MORPH_EDIT_TOOL]] : []),
    SEARCH_TOOLS,
    TODO_TOOLS,
    CRON_TOOLS,
    WEB_TOOLS,
    ADVANCED_TOOLS,
    MULTIMODAL_TOOLS,
    COMPUTER_CONTROL_TOOLS,
    BROWSER_TOOLS,
    CANVAS_TOOLS,
    AGENT_TOOLS,
    ...(process.env.FIRECRAWL_API_KEY ? [FIRECRAWL_TOOLS] : []),
    LSP_TOOLS,
    SECRETS_TOOLS,
    ADVISOR_TOOLS,
    ASK_USER_QUESTION_TOOLS,
    EXIT_PLAN_MODE_TOOLS,
    CODEBASE_REPLACE_TOOLS,
    SESSION_TOOLS,
    FLEET_TOOLS,
    GITNEXUS_TOOLS,
  ];
  const byName = new Map<string, CodeBuddyTool>();
  for (const tool of groups.flat()) {
    if (!byName.has(tool.function.name)) {
      byName.set(tool.function.name, tool);
    }
  }
  return [...byName.values()];
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

export function registerHermesCommands(program: Command): void {
  const hermes = program
    .command('hermes')
    .description('Inspect the native Hermes-inspired Code Buddy agent profile');

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
    .command('tools-parity')
    .alias('tools')
    .description('Compare official Hermes tool names against built-in Code Buddy tool schemas')
    .option('--json', 'output JSON')
    .option('--markdown', 'output Markdown')
    .action((options: HermesCommandOptions) => {
      const localTools = collectOfflineBuiltinTools().map((tool) => tool.function.name);
      const manifest = buildHermesToolParityManifest(localTools);

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

      if (diagnostics.issues.length === 0 && diagnostics.recommendations.length === 0) {
        console.log('\nNo issues or recommendations.');
      }

      console.log('');
    });
}
