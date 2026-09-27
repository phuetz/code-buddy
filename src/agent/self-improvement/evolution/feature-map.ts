/**
 * Feature map — a cartography of Code Buddy's own functionalities, so ingested research articles
 * can be matched to the CONCERNED area (and turned into targeted improvement goals).
 *
 * Hybrid, per the design: a small CURATED registry (human-meaningful areas with descriptions +
 * representative paths — the legible, anti-Leviathan base) enriched, when the repo is indexed in
 * Code Explorer/gitnexus, by its module/process docs. Enrichment is best-effort and injectable;
 * with no Code Explorer it degrades to the curated base. The description field is what gets
 * semantically matched against research discoveries, so it names the technical domain of the area.
 *
 * @module agent/self-improvement/evolution/feature-map
 */
import { logger } from '../../../utils/logger.js';
import { buildCatalogCoverage } from '../../../catalog/coverage.js';
import type { Catalog } from '../../../catalog/generate.js';

export interface FeatureArea {
  id: string;
  name: string;
  /** What the area does + its technical domain — the text matched against research articles. */
  description: string;
  /** Representative source paths (handed to the goal so the mutator knows where to work). */
  paths: string[];
  /** Stable catalogue IDs attached by deterministic rules when source is available. */
  catalogIds?: string[];
}

/** The legible base map. Hand-maintained (~one entry per real subsystem). */
export const CURATED_FEATURES: FeatureArea[] = [
  { id: 'operational-self-model', name: 'Operational self-model', description: 'Evidence-backed, read-only inspection of Code Buddy identity, implementation, runtime capabilities, limits, and subjective-consciousness boundary.', paths: ['src/identity/operational-self-model.ts', 'src/identity/lisa-introspection.ts', 'src/codebuddy/tool-definitions/self-describe-tools.ts', 'src/tools/self-describe.ts'] },
  { id: 'voice-loop', name: 'Voice loop', description: 'Spoken companion loop: speech-to-text, response gating, text-to-speech, turn-taking, barge-in, echo suppression.', paths: ['src/sensory/voice-loop.ts', 'src/sensory/speech-reaction.ts', 'src/sensory/respond-decider.ts'] },
  { id: 'vision-sensory', name: 'Vision & sensory perception', description: 'Camera presence detection, motion, face landmarks, drowsiness, keyframe description; brain-inspired sensory bus.', paths: ['src/sensory/vision-reaction.ts', 'src/sensory/semantic-vision-reaction.ts', 'buddy-sense/'] },
  { id: 'collective-memory-ckg', name: 'Collective knowledge graph (CKG)', description: 'Shared multi-agent memory as a knowledge graph with vector embeddings, hybrid semantic+keyword retrieval, cross-agent corroboration, supports/contradicts relations.', paths: ['src/memory/collective-knowledge-graph.ts', 'src/embeddings/embedding-provider.ts'] },
  { id: 'persistent-memory', name: 'Persistent & prospective memory', description: 'Long-term memory writeback and retrieval across sessions; prospective/goal-oriented memory, forgetting and reinforcement.', paths: ['src/memory/persistent-memory.ts', 'src/memory/prospective-memory.ts'] },
  { id: 'reasoning', name: 'Reasoning (ToT / MCTS)', description: 'Tree-of-Thought and Monte-Carlo-Tree-Search reasoning, extended thinking, deliberate multi-step problem solving.', paths: ['src/agent/reasoning/'] },
  { id: 'context-rag', name: 'Context & RAG', description: 'Retrieval-augmented context assembly, dependency-aware code RAG, context-window compression and summarization.', paths: ['src/context/', 'src/context/context-manager-v2.ts'] },
  { id: 'self-improvement', name: 'Self-improvement & evolution', description: 'Darwin-Gödel-Machine-style evolutionary self-improvement: generate code variants, empirical fitness, MAP-Elites diversity, lessons/tools/skills authoring.', paths: ['src/agent/self-improvement/'] },
  { id: 'fleet', name: 'Fleet & multi-agent orchestration', description: 'Multi-AI fleet mesh, peer chat/tool invocation, task routing, agent teams, swarm, orchestration of specialist models.', paths: ['src/fleet/', 'src/agent/multi-agent/'] },
  { id: 'agent-executor', name: 'Agent executor & middleware', description: 'The core agentic loop, composable before/after middleware pipeline, tool-call streaming, transcript repair.', paths: ['src/agent/execution/', 'src/agent/middleware/'] },
  { id: 'tool-selection', name: 'Tool selection (RAG/BM25)', description: 'Per-query tool selection via embeddings and BM25 to reduce prompt tokens; tool metadata and retrieval.', paths: ['src/codebuddy/tools.ts', 'src/tools/metadata.ts'] },
  { id: 'model-routing', name: 'Model routing & selection', description: 'Model selection by capability/latency/cost, provider failover, ensembles, architect/editor split.', paths: ['src/agent/facades/model-routing-facade.ts', 'src/fleet/model-selector.ts'] },
  { id: 'prompt-building', name: 'System prompt construction', description: 'System-prompt assembly with model-aware token-budget truncation and per-turn context injection.', paths: ['src/services/prompt-builder.ts'] },
  { id: 'code-intelligence', name: 'Code intelligence', description: 'Code knowledge graph, Code Explorer integration, impact analysis, hotspots, coupling, symbol search.', paths: ['src/knowledge/', 'src/plugins/code-explorer/'] },
  { id: 'autonomy', name: 'Autonomy & goal loops', description: 'Autonomous continuous loop, judge-gated goal loop, YOLO mode with guardrails, task board claiming.', paths: ['src/daemon/autonomous-loop.ts', 'src/utils/autonomy-manager.ts'] },
  { id: 'skills', name: 'Skills', description: 'Authoring, importing and executing procedural skills; skill gates, firewall, consolidation.', paths: ['src/skills/', 'src/agent/self-improvement/skill-engine.ts'] },
  { id: 'sessions-checkpoints', name: 'Sessions & checkpoints', description: 'Session persistence, resume, checkpoints and rewind/undo of agent work.', paths: ['src/agent/facades/session-facade.ts', 'src/checkpoints/'] },
  { id: 'output-sanitization', name: 'Output sanitization', description: 'Stripping model-leakage control tokens and unpronounceable/foreign-script content from model output before display or speech.', paths: ['src/utils/output-sanitizer.ts', 'src/sensory/speech-sanitizer.ts'] },
  { id: 'research-ingest', name: 'Research ingestion', description: 'Wide research and ingestion of scientific publications into the collective knowledge graph.', paths: ['src/research/'] },
  { id: 'deep-research', name: 'Deep Research (cited pipeline)', description: 'Multi-source, cited research pipeline: query planning, deterministic web search/scrape fan-out, near-duplicate dedup, iterative gap loops, STORM multi-perspective co-writing, and Collective-Knowledge-Graph bridging into a referenced report.', paths: ['src/agent/deep-research.ts', 'src/agent/deep-research-storm.ts', 'src/agent/deep-research-ckg.ts', 'src/commands/research/'] },
  { id: 'multimodal', name: 'Multimodal & video understanding', description: 'Image/audio/video perception: frame sampling and dedup, keyframe description, long-form transcription, YouTube captions, cloud/local video understanding and multimodal tool routing.', paths: ['src/tools/video/', 'src/tools/multimodal-index.ts', 'src/codebuddy/tool-definitions/multimodal-tools.ts', 'src/tools/registry/multimodal-tools.ts'] },
  { id: 'computer-use', name: 'Computer use & GUI automation', description: 'Computer use and GUI automation: computer_control, OmniParser visual grounding, snapshot_with_screenshot, browser agent and web_test flows.', paths: ['src/tools/computer-control-tool.ts', 'src/desktop-automation/omniparser-runner.ts', 'src/browser-automation/', 'src/tools/registry/web-test-tool.ts', 'src/codebuddy/tool-definitions/computer-control-tools.ts'] },
  { id: 'messaging-channels', name: 'Messaging channels', description: 'Messaging channel adapters, chat transports, inbound and outbound messages, delivery and channel-specific commands.', paths: ['src/channels/', 'src/channels/index.ts'] },
  { id: 'http-api', name: 'HTTP & WebSocket API', description: 'HTTP API routes, WebSocket protocol, authentication, request handling and server lifecycle.', paths: ['src/server/', 'src/gateway/'] },
  { id: 'configuration', name: 'Configuration', description: 'Configuration files, environment settings, profiles, policy resolution, secret references and validation.', paths: ['src/config/', 'src/commands/cli/config-command.ts'] },
  { id: 'cowork-gui', name: 'Cowork GUI', description: 'Cowork Electron desktop GUI, renderer panels, main-process IPC, windows and visual workflows.', paths: ['cowork/src/renderer/App.tsx', 'cowork/src/renderer/components/', 'cowork/src/main/index.ts'] },
  { id: 'cli-interface', name: 'CLI & slash interface', description: 'Command-line and slash command interface, terminal interaction, help and command dispatch.', paths: ['src/index.ts', 'src/commands/slash/', 'src/ui/'] },
  { id: 'tool-execution', name: 'Tools & workspace operations', description: 'Agent tool execution, file and shell operations, registry, permissions and tool results.', paths: ['src/tools/registry/', 'src/tools/bash/bash-tool.ts', 'src/codebuddy/tool-definitions/'] },
  { id: 'security-sandbox', name: 'Security & sandbox', description: 'Security policies, sandbox isolation, permission checks, auditing and secret protection.', paths: ['src/security/', 'src/sandbox/'] },
  { id: 'companion', name: 'Companion & personal assistant', description: 'Companion persona, relationship state, personal assistant interaction and reminders.', paths: ['src/companion/', 'src/commands/assistant.ts'] },
  { id: 'automation-workflows', name: 'Automation & workflows', description: 'Scheduled automation, cron jobs, workflow orchestration, task pipelines and triggers.', paths: ['src/orchestration/', 'src/commands/cron-cli/'] },
  { id: 'integrations-mcp', name: 'Integrations & MCP', description: 'Model Context Protocol integrations, connectors, resources, OAuth and external tool servers.', paths: ['src/mcp/', 'src/commands/mcp.ts'] },
  { id: 'model-training', name: 'Model training & LoRA', description: 'LoRA model training, dataset preparation, training quality gates and model adaptation.', paths: ['src/lora/', 'src/commands/lora.ts'] },
  { id: 'devices', name: 'Devices & remote nodes', description: 'Device pairing, remote node management, transport and device authorization.', paths: ['src/nodes/device-node.ts', 'src/commands/cli/device-commands.ts', 'src/commands/cli/node-commands.ts'] },
  { id: 'home-automation', name: 'Home automation', description: 'Home automation commands, household integrations and connected device control.', paths: ['src/commands/maison.ts', 'src/commands/maison-food.ts'] },
  { id: 'developer-workflows', name: 'Developer workflows', description: 'Software development workflows, specifications, issue pipelines, code review and project checks.', paths: ['src/commands/dev/', 'src/commands/spec.ts', 'src/commands/spec-plan.ts'] },
  { id: 'observability', name: 'Observability & diagnostics', description: 'Run traces, telemetry, metrics, diagnostics and execution trajectory inspection.', paths: ['src/observability/', 'src/telemetry/'] },
];

/** Enrichment source: extra areas discovered dynamically (e.g. from Code Explorer). Injectable. */
export type FeatureEnrichment = (repo?: string) => Promise<FeatureArea[]>;

/** Merge two area lists, deduping by id (curated wins on conflict). Pure. */
export function mergeFeatures(base: FeatureArea[], extra: FeatureArea[]): FeatureArea[] {
  const byId = new Map(base.map((f) => [f.id, f]));
  for (const f of extra) {
    if (!f?.id || !f.name) continue;
    if (!byId.has(f.id)) byId.set(f.id, { ...f, paths: f.paths ?? [] });
  }
  return [...byId.values()];
}

/**
 * Best-effort enrichment from Code Explorer's module docs (`list_sfd_pages`) when the repo is
 * indexed in gitnexus. Returns [] (curated-only) when Code Explorer is absent/unparseable.
 */
export async function defaultCodeExplorerEnrichment(repo?: string): Promise<FeatureArea[]> {
  try {
    const { getCodeExplorerClient } = await import('../../../plugins/code-explorer/code-explorer-client.js');
    const text = await getCodeExplorerClient().call('list_sfd_pages', repo ? { repo } : {});
    if (!text || !text.trim()) return [];
    // Extract module/page names from the listing (one per line, e.g. "- <module>" or "<module>.md").
    const areas: FeatureArea[] = [];
    for (const line of text.split('\n')) {
      const m = line.match(/([\w./-]+?)(?:\.md)?\s*$/);
      const name = m?.[1]?.replace(/^[-*\s]+/, '').trim();
      if (!name || name.length < 3 || /^(draft|module|page)s?$/i.test(name)) continue;
      const id = `ce:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 48);
      areas.push({ id, name, description: `Code Explorer module: ${name}`, paths: [] });
    }
    return areas.slice(0, 40);
  } catch (err) {
    logger.debug(`[evolve] Code Explorer feature enrichment unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** The feature map: curated base + best-effort enrichment (injectable). */
export async function getFeatureMap(opts: { enrich?: FeatureEnrichment; repo?: string; catalog?: Catalog | 'generate' } = {}): Promise<FeatureArea[]> {
  const enrich = opts.enrich ?? defaultCodeExplorerEnrichment;
  let extra: FeatureArea[] = [];
  try {
    extra = await enrich(opts.repo);
  } catch {
    extra = [];
  }
  const areas = mergeFeatures(CURATED_FEATURES, extra);
  if (!opts.catalog) return areas;
  try {
    const catalog = opts.catalog === 'generate'
      ? (await import('../../../catalog/generate.js')).generateCatalog(opts.repo ?? process.cwd())
      : opts.catalog;
    return attachCatalogToFeatureMap(catalog, areas);
  } catch (err) {
    logger.debug(`[evolve] Source catalogue unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return areas;
  }
}

/** Attach IDs only to the curated domains; Code Explorer additions remain optional. */
export function attachCatalogToFeatureMap(catalog: Catalog, areas: FeatureArea[] = CURATED_FEATURES): FeatureArea[] {
  const coverage = buildCatalogCoverage(catalog, CURATED_FEATURES);
  const idsByDomain = new Map(CURATED_FEATURES.map((area) => [area.id, [] as string[]]));
  for (const assignment of coverage.assignments) {
    if (assignment.domainId) idsByDomain.get(assignment.domainId)?.push(assignment.id);
  }
  return areas.map((area) => idsByDomain.has(area.id)
    ? { ...area, catalogIds: idsByDomain.get(area.id) }
    : area);
}
