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
  channel: [
    { domain: 'voice-loop', test: /voice/i },
  ],
  cowork: [
    { domain: 'fleet', test: /^(Fleet|Team|SubAgent)/ },
    { domain: 'persistent-memory', test: /^Memory/ },
    { domain: 'sessions-checkpoints', test: /^Session/ },
    { domain: 'autonomy', test: /^Autonomy/ },
  ],
};

const pathRules: MatchRule[] = [
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
];

const sharedFiles = new Set([
  'src/index.ts', 'src/tools/metadata.ts', 'src/commands/slash/builtin-commands.ts',
  'src/providers/provider-catalog.ts', 'src/server/index.ts', 'src/server/types.ts',
  'cowork/src/renderer/App.tsx',
]);

function resolveAssignment(entry: CatalogEntry, domains: Set<string>, areas: readonly CoverageArea[]): { domainId: string | null; rule: string | null } {
  const accept = (domain: string, rule: string): { domainId: string; rule: string } | null =>
    domains.has(domain) ? { domainId: domain, rule } : null;
  if (entry.family === 'provider') return accept('model-routing', 'family:provider') ?? { domainId: null, rule: null };
  if (entry.family === 'middleware') return accept('agent-executor', 'family:middleware') ?? { domainId: null, rule: null };

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
  return { domainId: null, rule: null };
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
