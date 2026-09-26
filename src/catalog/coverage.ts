import type { Catalog, CatalogEntry, CatalogFamily } from './generate.js';

export interface CoverageArea {
  id: string;
  paths: string[];
}

export interface CatalogAssignment {
  id: string;
  family: CatalogFamily;
  domainId: string | null;
  rule: string | null;
}

export interface CatalogCoverage {
  catalogCommit: string;
  catalogSchemaVersion: number;
  total: number;
  assigned: number;
  unassigned: number;
  percent: number;
  byDomain: Record<string, number>;
  byFamily: Record<string, { total: number; assigned: number }>;
  assignments: CatalogAssignment[];
  unmatched: CatalogAssignment[];
  codeExplorer: 'not_requested';
}

type MatchRule = { domain: string; test: RegExp };

// A name is used only where the source file is a shared declaration table.
// Ambiguous names deliberately stay unmatched.
const nameRules: Partial<Record<CatalogFamily, MatchRule[]>> = {
  cli: [
    { domain: 'self-improvement', test: /^(evolve|improve|forge|self)(\b|$)/i },
    { domain: 'skills', test: /^(skills?|hub|hermes)(\b|$)/i },
    { domain: 'fleet', test: /^(fleet|team|swarm|council|peer)(\b|$)/i },
    { domain: 'sessions-checkpoints', test: /^(sessions?|checkpoint|replay|backup)(\b|$)/i },
    { domain: 'model-routing', test: /^(models?|provider|llm|login|logout|whoami|cost)(\b|$)/i },
    { domain: 'code-intelligence', test: /^(code-explorer|lsp)(\b|$)/i },
    { domain: 'deep-research', test: /^(research|flow)(\b|$)/i },
    { domain: 'research-ingest', test: /^(science|papers)(\b|$)/i },
    { domain: 'autonomy', test: /^(autonomous-code|autonomy|goal|loop|daemon)(\b|$)/i },
    { domain: 'voice-loop', test: /^(voice|speak)(\b|$)/i },
  ],
  slash: [
    { domain: 'self-improvement', test: /^(improve|evolve|forge|lessons?)(\b|$)/i },
    { domain: 'skills', test: /^(skills?|hub)(\b|$)/i },
    { domain: 'fleet', test: /^(fleet|team|swarm|batch|peer|council)(\b|$)/i },
    { domain: 'sessions-checkpoints', test: /^(sessions?|checkpoint|restore|rewind)(\b|$)/i },
    { domain: 'persistent-memory', test: /^(memory|remember|forget)(\b|$)/i },
    { domain: 'reasoning', test: /^think(\b|$)/i },
    { domain: 'context-rag', test: /^(context|compact)(\b|$)/i },
    { domain: 'model-routing', test: /^(model|switch|cost)(\b|$)/i },
    { domain: 'autonomy', test: /^(goal|loop|yolo)(\b|$)/i },
    { domain: 'voice-loop', test: /^(voice|speak)(\b|$)/i },
  ],
  tool: [
    { domain: 'computer-use', test: /^(computer_control|gui_control|web_test|browser(?:_|$)|snapshot_with_screenshot$|omniparser)/ },
    { domain: 'messaging-channels', test: /^(discord|slack|telegram|feishu|whatsapp|signal|teams|matrix)(_|$)/ },
    { domain: 'security-sandbox', test: /^(security_|secrets_|permission_|sandbox_)/ },
    { domain: 'integrations-mcp', test: /^(mcp_|a2a_|feishu_drive_|feishu_doc_)/ },
    { domain: 'operational-self-model', test: /^self_describe$/ },
    { domain: 'collective-memory-ckg', test: /^(ckg_|collective_)/ },
    { domain: 'persistent-memory', test: /^(memory_|remember_|forget_)/ },
    { domain: 'fleet', test: /^(fleet_|peer_|route_peer$|delegate_agent$)/ },
    { domain: 'skills', test: /^(skill_|skills_)/ },
    { domain: 'sessions-checkpoints', test: /^(session_|checkpoint_)/ },
    { domain: 'code-intelligence', test: /^(code_explorer_|code_graph|find_symbols|find_references|find_definition)/ },
    { domain: 'voice-loop', test: /^(speak|text_to_speech|speech_to_text)/ },
    { domain: 'multimodal', test: /^(video_|image_|audio_|multimodal_)/ },
    { domain: 'deep-research', test: /^(research_|deep_research|storm_)/ },
    { domain: 'tool-selection', test: /^(tool_search|list_tools)$/ },
  ],
  http: [
    { domain: 'sessions-checkpoints', test: /session|checkpoint/i },
    { domain: 'fleet', test: /fleet|peer|a2a/i },
    { domain: 'persistent-memory', test: /memory|lessons/i },
    { domain: 'autonomy', test: /daemon|cron|trigger/i },
    { domain: 'model-routing', test: /routing|models/i },
    { domain: 'agent-executor', test: /\/api\/chat|\/v1\/chat/i },
  ],
  websocket: [
    { domain: 'fleet', test: /^peer[.:_-]/i },
    { domain: 'agent-executor', test: /^(chat|chat_stream|execute_tool|tool_execute|stop)$/i },
  ],
  channel: [],
  cowork: [
    { domain: 'fleet', test: /^(Fleet|Team|SubAgent)/ },
    { domain: 'persistent-memory', test: /^Memory/ },
    { domain: 'sessions-checkpoints', test: /^Session/ },
    { domain: 'autonomy', test: /^Autonomy/ },
  ],
};

const pathRules: MatchRule[] = [
  { domain: 'computer-use', test: /^src\/(desktop-automation\/|browser-automation\/|tools\/(computer-control|browser)|tools\/registry\/(web-test|browser|gui-)|codebuddy\/tool-definitions\/(computer-control|browser))/ },
  { domain: 'messaging-channels', test: /^src\/channels\// },
  { domain: 'cowork-gui', test: /^cowork\/src\// },
  { domain: 'security-sandbox', test: /^src\/(security\/|sandbox\/|tools\/(security|sandbox|secret))/ },
  { domain: 'integrations-mcp', test: /^src\/(mcp\/|commands\/mcp\.|tools\/registry\/mcp)/ },
  { domain: 'companion', test: /^src\/(companion\/|commands\/assistant\.)/ },
  { domain: 'automation-workflows', test: /^src\/(orchestration\/|commands\/cron-cli\/|commands\/pipeline\.|commands\/campaign\.)/ },
  { domain: 'model-training', test: /^src\/(lora\/|commands\/lora\.)/ },
  { domain: 'devices', test: /^src\/(nodes\/|commands\/cli\/(device|node)-commands\.|commands\/device-auth\.)/ },
  { domain: 'home-automation', test: /^src\/commands\/maison/ },
  { domain: 'developer-workflows', test: /^src\/commands\/(dev\/|spec(?:-plan|-next)?\.)/ },
  { domain: 'observability', test: /^src\/(observability\/|telemetry\/)/ },
  { domain: 'self-improvement', test: /^src\/commands\/(cli\/(evolve|improve|forge)-command|lessons\.)/ },
  { domain: 'fleet', test: /^src\/commands\/(cli\/(fleet|team|swarm|peer|council)|team|swarm)/ },
  { domain: 'skills', test: /^src\/commands\/(skills-cli\/|cli\/(skills|hermes)-)/ },
  { domain: 'model-routing', test: /^src\/commands\/(cli\/(models|provider|login|logout)-|models\.|providers\.)/ },
  { domain: 'autonomy', test: /^src\/commands\/cli\/daemon-/ },
  { domain: 'sessions-checkpoints', test: /^src\/(sessions\/|cli\/session-commands\.|commands\/(run-cli\/|.*(?:session|backup|checkpoint)))/ },
  { domain: 'configuration', test: /^src\/(config\/|commands\/(cli\/)?(?:config|secrets|policy|execpolicy|approvals)[-/.])/ },
  { domain: 'sessions-checkpoints', test: /^src\/server\/routes\/sessions\.ts$/ },
  { domain: 'fleet', test: /^src\/server\/routes\/(a2a|fleet)/ },
  { domain: 'persistent-memory', test: /^src\/server\/routes\/(memory|lessons)/ },
  { domain: 'autonomy', test: /^src\/server\/routes\/(cron|triggers)/ },
  { domain: 'agent-executor', test: /^src\/server\/routes\/chat\.ts$/ },
  { domain: 'model-routing', test: /^src\/server\/routes\/models/ },
  { domain: 'operational-self-model', test: /^src\/(identity\/|tools\/self-describe|codebuddy\/tool-definitions\/self-describe)/ },
  { domain: 'voice-loop', test: /^src\/(sensory\/(voice|speech|text-to-speech)|input\/text-to-speech)/ },
  { domain: 'vision-sensory', test: /^src\/sensory\/(vision|semantic-vision|camera|presence)/ },
  { domain: 'collective-memory-ckg', test: /^src\/(memory\/collective-|embeddings\/)/ },
  { domain: 'persistent-memory', test: /^src\/memory\// },
  { domain: 'reasoning', test: /^src\/agent\/(reasoning|thinking)\// },
  { domain: 'context-rag', test: /^src\/context\// },
  { domain: 'self-improvement', test: /^src\/agent\/self-improvement\// },
  { domain: 'fleet', test: /^src\/(fleet\/|agent\/multi-agent\/)/ },
  { domain: 'agent-executor', test: /^src\/agent\/(execution|middleware)\// },
  { domain: 'tool-selection', test: /^src\/tools\/tool-selector/ },
  { domain: 'model-routing', test: /^src\/(codebuddy\/(client\.ts|providers\/)|providers\/)/ },
  { domain: 'model-routing', test: /^src\/(providers\/|config\/model-|agent\/facades\/model-routing)/ },
  { domain: 'prompt-building', test: /^src\/services\/prompt-builder/ },
  { domain: 'code-intelligence', test: /^src\/(knowledge\/|plugins\/code-explorer\/)/ },
  { domain: 'autonomy', test: /^src\/(daemon\/|utils\/autonomy-manager)/ },
  { domain: 'skills', test: /^src\/skills\// },
  { domain: 'sessions-checkpoints', test: /^src\/(checkpoints\/|agent\/facades\/session-facade)/ },
  { domain: 'output-sanitization', test: /^src\/(utils\/output-sanitizer|sensory\/speech-sanitizer)/ },
  { domain: 'research-ingest', test: /^src\/research\// },
  { domain: 'deep-research', test: /^src\/(agent\/deep-research|commands\/research\/)/ },
  { domain: 'multimodal', test: /^src\/(tools\/video\/|tools\/multimodal|codebuddy\/tool-definitions\/multimodal)/ },
  { domain: 'http-api', test: /^src\/(server\/|gateway\/)/ },
  { domain: 'cli-interface', test: /^src\/(index\.ts$|commands\/|cli\/|ui\/)/ },
  { domain: 'tool-execution', test: /^src\/(tools\/|codebuddy\/tool-definitions\/)/ },
  { domain: 'agent-executor', test: /^src\/(agent\/|codebuddy\/)/ },
];

const sharedFiles = new Set([
  'src/index.ts', 'src/tools/metadata.ts', 'src/commands/slash/builtin-commands.ts',
  'src/providers/provider-catalog.ts', 'src/server/index.ts', 'src/server/types.ts',
  'cowork/src/renderer/App.tsx',
]);

const familyDefaults: Record<CatalogFamily, string> = {
  cli: 'cli-interface', slash: 'cli-interface', tool: 'tool-execution',
  http: 'http-api', websocket: 'http-api', channel: 'messaging-channels',
  cowork: 'cowork-gui', environment: 'configuration',
  provider: 'model-routing', middleware: 'agent-executor',
};

function resolveAssignment(entry: CatalogEntry, domains: Set<string>, areas: readonly CoverageArea[]): { domainId: string | null; rule: string | null } {
  const accept = (domain: string, rule: string): { domainId: string; rule: string } | null =>
    domains.has(domain) ? { domainId: domain, rule } : null;
  if (entry.family === 'provider') return accept('model-routing', 'family:provider') ?? { domainId: null, rule: null };
  if (entry.family === 'middleware') return accept('agent-executor', 'family:middleware') ?? { domainId: null, rule: null };

  // Environment ownership follows the code that reads the variable. A config
  // reader is considered only after all more specific readers have been tried.
  if (entry.family === 'environment') {
    for (const rule of pathRules.filter((item) => item.domain !== 'configuration')) {
      for (const source of entry.sources) {
        if (rule.test.test(source.file)) {
          const match = accept(rule.domain, `reader:${source.file}`);
          if (match) return match;
        }
      }
    }
    for (const area of areas.filter((item) => item.id !== 'configuration')) {
      for (const source of entry.sources) {
        if (area.paths.some((candidate) => candidate.endsWith('/')
          ? source.file.startsWith(candidate) : source.file === candidate)) {
          const match = accept(area.id, `reader:${source.file}`);
          if (match) return match;
        }
      }
    }
    return accept('configuration', 'reader:fallback:configuration') ?? { domainId: null, rule: null };
  }

  // Names distinguish entries in shared registries and nested commands whose
  // declarations share one file. A non-shared source is then resolved by path.
  for (const rule of nameRules[entry.family] ?? []) {
    if (rule.test.test(entry.name)) {
      const match = accept(rule.domain, `name:${entry.family}:${rule.test.source}`);
      if (match) return match;
    }
  }
  for (const source of entry.sources) {
    if (sharedFiles.has(source.file)) continue;
    for (const rule of pathRules) {
      if (rule.test.test(source.file)) {
        const match = accept(rule.domain, `path:${rule.test.source}`);
        if (match) return match;
      }
    }
    for (const area of areas) {
      if (area.paths.some((candidate) => candidate.endsWith('/')
        ? source.file.startsWith(candidate)
        : source.file === candidate)) {
        const match = accept(area.id, `curated-path:${source.file}`);
        if (match) return match;
      }
    }
  }
  const fallback = familyDefaults[entry.family];
  return fallback ? accept(fallback, `family:${entry.family}`) ?? { domainId: null, rule: null }
    : { domainId: null, rule: null };
}

/** Every catalogue ID receives either one curated domain or an explicit unmatched record. */
export function buildCatalogCoverage(catalog: Catalog, areas: readonly CoverageArea[]): CatalogCoverage {
  const domains = new Set(areas.map((area) => area.id));
  if (domains.size !== areas.length) throw new Error('Duplicate feature domain IDs');
  const ids = new Set<string>();
  const assignments: CatalogAssignment[] = [];
  const byDomain: Record<string, number> = Object.fromEntries([...domains].sort().map((id) => [id, 0]));
  const byFamily: Record<string, { total: number; assigned: number }> = {};
  for (const entry of catalog.entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate catalogue ID: ${entry.id}`);
    ids.add(entry.id);
    const resolved = resolveAssignment(entry, domains, areas);
    assignments.push({ id: entry.id, family: entry.family, ...resolved });
    if (!byFamily[entry.family]) byFamily[entry.family] = { total: 0, assigned: 0 };
    byFamily[entry.family]!.total += 1;
    if (resolved.domainId) {
      byFamily[entry.family]!.assigned += 1;
      byDomain[resolved.domainId]! += 1;
    }
  }
  assignments.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const unmatched = assignments.filter((assignment) => assignment.domainId === null);
  const total = assignments.length;
  const assigned = total - unmatched.length;
  return {
    catalogCommit: catalog.commit, catalogSchemaVersion: catalog.schemaVersion,
    total, assigned, unassigned: unmatched.length,
    percent: total === 0 ? 0 : Math.round((assigned / total) * 10000) / 100,
    byDomain,
    byFamily: Object.fromEntries(Object.entries(byFamily).sort(([a], [b]) => a.localeCompare(b, 'en'))),
    assignments, unmatched, codeExplorer: 'not_requested',
  };
}

export function renderCatalogCoverageMarkdown(coverage: CatalogCoverage): string {
  return [
    '# Couverture de la carte DGM', '',
    `Catalogue : \`${coverage.catalogCommit}\` (schéma ${coverage.catalogSchemaVersion}).`,
    `Rattachés : ${coverage.assigned}/${coverage.total} (${coverage.percent} %). Non rattachés : ${coverage.unassigned}.`,
    'Code Explorer : non demandé.', '',
    '| Domaine | Entrées |', '|---|---:|',
    ...Object.entries(coverage.byDomain).map(([id, count]) => `| \`${id}\` | ${count} |`),
    '', '| Famille technique | Rattachés | Total |', '|---|---:|---:|',
    ...Object.entries(coverage.byFamily).map(([family, counts]) => `| \`${family}\` | ${counts.assigned} | ${counts.total} |`),
    '', '## Non rattachés', '',
    ...coverage.unmatched.map((item) => `- \`${item.id}\``), '',
  ].join('\n');
}
