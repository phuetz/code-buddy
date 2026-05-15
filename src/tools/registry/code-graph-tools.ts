/**
 * Code Graph Tool — Dedicated tool for code structure queries
 *
 * Operations:
 *   who_calls    — Find all callers of a function
 *   what_calls   — Find all callees of a function
 *   impact       — Transitive impact analysis
 *   flowchart    — Mermaid diagram of call chain
 *   class_tree   — Class inheritance hierarchy (Mermaid)
 *   file_map     — All functions in a file with signatures and connections
 *   find_path    — Dependency path between two entities
 *   module_deps  — Module import dependency diagram (Mermaid)
 *   stats        — Graph statistics
 *   dead_code    — Detect uncalled functions, unimported modules, unused classes
 *   coupling     — Inter-module coupling heatmap (call + import density)
 *   refactor     — Refactoring suggestions (god functions, hub modules, cross-community hubs)
 *   drift        — Architecture drift vs saved snapshot
 *   snapshot     — Save current graph as baseline for drift detection
 *   visualize    — Generate interactive D3.js HTML visualization
 *   impact_preview — PR impact preview based on git diff
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';

export class CodeGraphTool implements ITool {
  readonly name = 'code_graph';
  readonly description = 'Query the code dependency graph: find callers, callees, impact analysis, generate flowcharts, class hierarchies, and dependency paths';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const operation = input.operation as string;
    const query = (input.query as string) ?? '';
    const target = (input.target as string) ?? '';
    const depth = Math.min((input.depth as number) ?? 2, 6);

    // Lazy-load graph and utilities
    const { getKnowledgeGraph } = await import('../../knowledge/knowledge-graph.js');
    const graph = getKnowledgeGraph();

    if (graph.getStats().tripleCount === 0) {
      return {
        success: true,
        output: 'Code graph is empty. Run `codebase_map build` first to populate the graph, or use `codebase_map` with `deep: true` to include call graph data.',
      };
    }

    // Ensure deep graph is populated for call-related operations
    const needsDeep = ['who_calls', 'what_calls', 'impact', 'flowchart', 'file_map'].includes(operation);
    if (needsDeep) {
      const hasCallData = graph.query({ predicate: 'calls' }).length > 0
        || graph.query({ predicate: 'hasMethod' }).length > 0;
      if (!hasCallData) {
        try {
          const { populateDeepCodeGraph } = await import('../../knowledge/code-graph-deep-populator.js');
          const added = populateDeepCodeGraph(graph, process.cwd());
          if (added === 0) {
            return {
              success: true,
              output: `No call graph data found. The project may have no source files in recognized directories (src/, lib/, app/), or all files may be unsupported languages.`,
            };
          }
        } catch (err) {
          return {
            success: false,
            error: `Failed to populate call graph: ${err instanceof Error ? err.message : String(err)}. Try running \`codebase_map build\` first.`,
          };
        }
      }
    }

    switch (operation) {
      case 'who_calls': return this.whoCalls(graph, query);
      case 'what_calls': return this.whatCalls(graph, query);
      case 'impact': return this.impact(graph, query, depth);
      case 'flowchart': return this.flowchart(graph, query, depth);
      case 'class_tree': return this.classTree(graph, query);
      case 'file_map': return this.fileMap(graph, query);
      case 'find_path': return this.findPath(graph, query, target);
      case 'module_deps': return this.moduleDeps(graph, query, depth);
      case 'communities': return this.communities(graph);
      case 'semantic_search': return this.semanticSearch(graph, query);
      case 'dead_code': return this.deadCode(graph);
      case 'coupling': return this.coupling(graph);
      case 'refactor': return this.refactorSuggestions(graph);
      case 'drift': return this.drift(graph);
      case 'snapshot': return this.saveSnapshot(graph);
      case 'visualize': return this.visualize(graph);
      case 'impact_preview': return this.impactPreview(graph);
      case 'stats': return this.stats(graph);
      default:
        return { success: false, error: `Unknown operation: ${operation}. Available: who_calls, what_calls, impact, flowchart, class_tree, file_map, find_path, module_deps, communities, semantic_search, dead_code, coupling, refactor, drift, snapshot, visualize, impact_preview, stats` };
    }
  }

  // --- Operations ---

  private whoCalls(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph, query: string): ToolResult {
    if (!query) return { success: false, error: 'query (function name) is required' };

    const entity = graph.findEntity(query);
    if (!entity) return { success: true, output: `No entity found matching "${query}".` };

    const callers = graph.query({ predicate: 'calls', object: entity });
    if (callers.length === 0) {
      return { success: true, output: `No callers found for ${entity}.` };
    }

    const lines = [`Who calls ${entity}:\n`];
    for (const t of callers.slice(0, 30)) {
      // Find which file the caller is defined in
      const defIn = graph.query({ subject: t.subject, predicate: 'definedIn' });
      const file = defIn.length > 0 ? ` (${defIn[0].object})` : '';
      lines.push(`  ${t.subject}${file}`);
    }
    if (callers.length > 30) lines.push(`  +${callers.length - 30} more`);

    return { success: true, output: lines.join('\n') };
  }

  private whatCalls(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph, query: string): ToolResult {
    if (!query) return { success: false, error: 'query (function name) is required' };

    const entity = graph.findEntity(query);
    if (!entity) return { success: true, output: `No entity found matching "${query}".` };

    const callees = graph.query({ subject: entity, predicate: 'calls' });
    if (callees.length === 0) {
      return { success: true, output: `${entity} doesn't call any known functions.` };
    }

    const lines = [`${entity} calls:\n`];
    for (const t of callees.slice(0, 30)) {
      const defIn = graph.query({ subject: t.object, predicate: 'definedIn' });
      const file = defIn.length > 0 ? ` (${defIn[0].object})` : '';
      lines.push(`  ${t.object}${file}`);
    }
    if (callees.length > 30) lines.push(`  +${callees.length - 30} more`);

    return { success: true, output: lines.join('\n') };
  }

  private async impact(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph, query: string, depth: number): Promise<ToolResult> {
    if (!query) return { success: false, error: 'query (function name) is required' };

    const entity = graph.findEntity(query);
    if (!entity) return { success: true, output: `No entity found matching "${query}".` };

    const { analyzeImpact } = await import('../../knowledge/impact-analyzer.js');
    const result = analyzeImpact(graph, entity, depth);

    return { success: true, output: result.formatted };
  }

  private async flowchart(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph, query: string, depth: number): Promise<ToolResult> {
    if (!query) return { success: false, error: 'query (function name) is required' };

    const entity = graph.findEntity(query);
    if (!entity) return { success: true, output: `No entity found matching "${query}".` };

    const { generateCallFlowchart } = await import('../../knowledge/mermaid-generator.js');
    const mermaid = generateCallFlowchart(graph, entity, depth);

    if (!mermaid) {
      return { success: true, output: `No call relationships found for ${entity}.` };
    }

    return {
      success: true,
      output: `Call flowchart for ${entity}:\n\n\`\`\`mermaid\n${mermaid}\n\`\`\``,
    };
  }

  private async classTree(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph, query: string): Promise<ToolResult> {
    if (!query) return { success: false, error: 'query (class name) is required' };

    const entity = graph.findEntity(query);
    if (!entity) return { success: true, output: `No entity found matching "${query}".` };

    const { generateClassHierarchy } = await import('../../knowledge/mermaid-generator.js');
    const mermaid = generateClassHierarchy(graph, entity);

    if (!mermaid) {
      // Fallback: show methods
      const methods = graph.query({ subject: entity, predicate: 'hasMethod' });
      if (methods.length > 0) {
        const lines = [`${entity} methods:\n`];
        for (const m of methods) {
          const params = m.metadata?.params ?? '';
          const ret = m.metadata?.returnType ? `: ${m.metadata.returnType}` : '';
          lines.push(`  ${m.object}${params}${ret}`);
        }
        return { success: true, output: lines.join('\n') };
      }
      return { success: true, output: `No hierarchy found for ${entity}.` };
    }

    // Also include methods list
    const methods = graph.query({ subject: entity, predicate: 'hasMethod' });
    let methodsList = '';
    if (methods.length > 0) {
      const mLines = methods.map(m => {
        const params = m.metadata?.params ?? '';
        const ret = m.metadata?.returnType ? `: ${m.metadata.returnType}` : '';
        return `  ${m.object}${params}${ret}`;
      });
      methodsList = `\n\nMethods of ${entity.replace(/^cls:/, '')}:\n${mLines.join('\n')}`;
    }

    return {
      success: true,
      output: `Class hierarchy for ${entity}:\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`${methodsList}`,
    };
  }

  private fileMap(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph, query: string): ToolResult {
    if (!query) return { success: false, error: 'query (file name or path) is required' };

    const entity = graph.findEntity(query);
    if (!entity || !entity.startsWith('mod:')) {
      return { success: true, output: `No module found matching "${query}".` };
    }

    const containedFns = graph.query({ subject: entity, predicate: 'containsFunction' });
    if (containedFns.length === 0) {
      return { success: true, output: `No functions found in ${entity}. Run with deep graph data to scan function definitions.` };
    }

    const sorted = [...containedFns].sort((a, b) => {
      const lineA = parseInt(a.metadata?.line ?? '0', 10);
      const lineB = parseInt(b.metadata?.line ?? '0', 10);
      return lineA - lineB;
    });

    const outputLines: string[] = [];
    outputLines.push(`${entity} — ${sorted.length} functions/methods:\n`);

    for (const fnTriple of sorted) {
      const fnId = fnTriple.object;
      const line = fnTriple.metadata?.line ? `:${fnTriple.metadata.line}` : '';
      const kind = fnTriple.metadata?.nodeType ?? 'function';
      const cls = fnTriple.metadata?.className ? `[${fnTriple.metadata.className}] ` : '';
      const params = fnTriple.metadata?.params ?? '';
      const retType = fnTriple.metadata?.returnType ? `: ${fnTriple.metadata.returnType}` : '';
      const signature = params ? `${params}${retType}` : '';

      outputLines.push(`${cls}${fnId}${line} (${kind}) ${signature}`.trimEnd());

      const callsOut = graph.query({ subject: fnId, predicate: 'calls' });
      const callsIn = graph.query({ predicate: 'calls', object: fnId });

      if (callsOut.length > 0) {
        const targets = callsOut.slice(0, 10).map(t => t.object);
        const more = callsOut.length > 10 ? ` +${callsOut.length - 10} more` : '';
        outputLines.push(`  → calls: ${targets.join(', ')}${more}`);
      }
      if (callsIn.length > 0) {
        const callers = callsIn.slice(0, 10).map(t => t.subject);
        const more = callsIn.length > 10 ? ` +${callsIn.length - 10} more` : '';
        outputLines.push(`  ← called by: ${callers.join(', ')}${more}`);
      }
    }

    return { success: true, output: outputLines.join('\n') };
  }

  private findPath(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph, query: string, target: string): ToolResult {
    if (!query || !target) return { success: false, error: 'query (source) and target are required' };

    const fromEntity = graph.findEntity(query);
    const toEntity = graph.findEntity(target);
    if (!fromEntity) return { success: true, output: `No entity found matching "${query}".` };
    if (!toEntity) return { success: true, output: `No entity found matching "${target}".` };

    const paths = graph.findPath(fromEntity, toEntity, 6);
    if (paths.length === 0) {
      return { success: true, output: `No path found from ${fromEntity} to ${toEntity}.` };
    }

    const lines = [`Path from ${fromEntity} to ${toEntity}:\n`];
    // Show the shortest path
    const shortest = paths.sort((a, b) => a.length - b.length)[0];
    let current = fromEntity;
    for (const triple of shortest) {
      const next = triple.subject === current ? triple.object : triple.subject;
      lines.push(`  ${current} --${triple.predicate}--> ${next}`);
      current = next;
    }

    if (paths.length > 1) {
      lines.push(`\n(${paths.length} paths found, showing shortest)`);
    }

    return { success: true, output: lines.join('\n') };
  }

  private async moduleDeps(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph, query: string, depth: number): Promise<ToolResult> {
    if (!query) return { success: false, error: 'query (module name) is required' };

    const entity = graph.findEntity(query);
    if (!entity) return { success: true, output: `No entity found matching "${query}".` };

    const { generateModuleDependencies } = await import('../../knowledge/mermaid-generator.js');
    const mermaid = generateModuleDependencies(graph, entity, depth);

    if (!mermaid) {
      return { success: true, output: `No import relationships found for ${entity}.` };
    }

    return {
      success: true,
      output: `Module dependencies for ${entity}:\n\n\`\`\`mermaid\n${mermaid}\n\`\`\``,
    };
  }

  private async communities(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph): Promise<ToolResult> {
    const { detectCommunities, summarizeCommunity } = await import('../../knowledge/community-detection.js');

    let pageRankScores: Map<string, number> | undefined;
    try { pageRankScores = graph.getPageRank(); } catch { /* skip */ }

    const result = detectCommunities(graph, {}, pageRankScores);

    if (result.communityMembers.size === 0) {
      return { success: true, output: 'No communities detected. Make sure the graph has module import relationships.' };
    }

    const lines: string[] = [`Detected ${result.communityMembers.size} communities (modularity: ${result.modularity.toFixed(3)}):\n`];

    // Sort by size
    const sorted = [...result.communityMembers.entries()]
      .sort((a, b) => b[1].length - a[1].length);

    for (const [cid, members] of sorted) {
      lines.push(`Community ${cid}:`);
      lines.push(summarizeCommunity(graph, members, pageRankScores));
      lines.push('');
    }

    // Mermaid diagram
    const { generateCommunityDiagram } = await import('../../knowledge/mermaid-generator.js');
    const mermaid = generateCommunityDiagram(graph, result);
    if (mermaid) {
      lines.push(`\`\`\`mermaid\n${mermaid}\n\`\`\``);
    }

    return { success: true, output: lines.join('\n') };
  }

  private async semanticSearch(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph, query: string): Promise<ToolResult> {
    if (!query) return { success: false, error: 'query is required for semantic_search' };

    const { createGraphEmbeddingIndex } = await import('../../knowledge/graph-embeddings.js');
    const index = createGraphEmbeddingIndex(graph);
    const results = await index.search(query, 10);

    if (results.length === 0) {
      return { success: true, output: `No semantic matches found for "${query}". Embeddings may not be available.` };
    }

    const lines = [`Semantic search for "${query}":\n`];
    for (const { entityId, score } of results) {
      const ego = graph.formatEgoGraph(entityId, 1, 200);
      lines.push(`  ${entityId} (score: ${score.toFixed(3)})`);
      if (ego) lines.push(`    ${ego.split('\n').slice(0, 3).join('\n    ')}`);
    }

    return { success: true, output: lines.join('\n') };
  }

  private stats(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph): ToolResult {
    const stats = graph.getStats();
    const predicateCounts: Record<string, number> = {};
    const typeCounts: Record<string, number> = {};

    // Count by predicate
    for (const pred of ['imports', 'exports', 'calls', 'extends', 'implements',
      'definedIn', 'contains', 'usedBy', 'belongsTo', 'patternOf',
      'hasMethod', 'containsFunction', 'hasDirectory', 'importCount']) {
      const count = graph.query({ predicate: pred }).length;
      if (count > 0) predicateCounts[pred] = count;
    }

    // Count entity types
    const allSubjects = new Set<string>();
    for (const t of graph.toJSON()) {
      allSubjects.add(t.subject);
      allSubjects.add(t.object);
    }
    for (const e of allSubjects) {
      const prefix = e.split(':')[0] || 'other';
      typeCounts[prefix] = (typeCounts[prefix] ?? 0) + 1;
    }

    const lines = [
      `Code Graph Statistics:`,
      `  Total triples: ${stats.tripleCount}`,
      `  Unique subjects: ${stats.subjectCount}`,
      `  Unique predicates: ${stats.predicateCount}`,
      `  Unique objects: ${stats.objectCount}`,
      '',
      'By predicate:',
      ...Object.entries(predicateCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`),
      '',
      'By entity type:',
      ...Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`),
    ];

    // Top-10 entities by PageRank
    try {
      const prScores = graph.getPageRank();
      if (prScores.size > 0) {
        const top10 = [...prScores.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);
        lines.push('');
        lines.push('Top-10 entities by PageRank:');
        for (const [entity, score] of top10) {
          lines.push(`  ${entity}: ${score.toFixed(4)}`);
        }
      }
    } catch { /* skip if PageRank unavailable */ }

    return { success: true, output: lines.join('\n') };
  }

  // --- Analytics Operations ---

  private async deadCode(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph): Promise<ToolResult> {
    const { detectDeadCode } = await import('../../knowledge/graph-analytics.js');
    const result = detectDeadCode(graph);

    if (result.totalDead === 0) {
      return { success: true, output: 'No dead code detected. All entities have incoming references.' };
    }

    const { high, medium, low } = result.byConfidence;
    const lines: string[] = [
      `Dead Code Analysis: ${result.totalDead} candidates`,
      `  High confidence: ${high.length} | Medium: ${medium.length} | Low (likely false positives): ${low.length}\n`,
    ];

    if (high.length > 0) {
      lines.push(`HIGH confidence — likely truly dead (${high.length}):`);
      for (const fn of high.slice(0, 20)) lines.push(`  ${fn}`);
      if (high.length > 20) lines.push(`  +${high.length - 20} more`);
      lines.push('');
    }

    if (medium.length > 0) {
      lines.push(`MEDIUM confidence — exported but no callers found (${medium.length}):`);
      for (const fn of medium.slice(0, 15)) lines.push(`  ${fn}`);
      if (medium.length > 15) lines.push(`  +${medium.length - 15} more`);
      lines.push('');
    }

    if (low.length > 0) {
      lines.push(`LOW confidence — dynamic dispatch / factory / barrel export (${low.length}):`);
      for (const fn of low.slice(0, 10)) lines.push(`  ${fn}`);
      if (low.length > 10) lines.push(`  +${low.length - 10} more`);
      lines.push('');
    }

    if (result.unimportedModules.length > 0) {
      lines.push(`Unimported modules (${result.unimportedModules.length}):`);
      for (const m of result.unimportedModules.slice(0, 20)) lines.push(`  ${m}`);
      if (result.unimportedModules.length > 20) lines.push(`  +${result.unimportedModules.length - 20} more`);
      lines.push('');
    }

    if (result.unusedClasses.length > 0) {
      lines.push(`Unused classes (${result.unusedClasses.length}):`);
      for (const c of result.unusedClasses.slice(0, 20)) lines.push(`  ${c}`);
      if (result.unusedClasses.length > 20) lines.push(`  +${result.unusedClasses.length - 20} more`);
    }

    return { success: true, output: lines.join('\n') };
  }

  private async coupling(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph): Promise<ToolResult> {
    const { computeCoupling } = await import('../../knowledge/graph-analytics.js');
    const result = computeCoupling(graph, 20);

    if (result.hotspots.length === 0) {
      return { success: true, output: 'No inter-module coupling detected.' };
    }

    const lines: string[] = ['Coupling Heatmap — Top module pairs by interaction density\n'];
    lines.push(`Average coupling: ${result.averageCoupling.toFixed(1)}`);
    if (result.mostDependentModule) lines.push(`Most connected module: ${result.mostDependentModule}`);
    if (result.mostDependendUponModule) lines.push(`Most depended-upon: ${result.mostDependendUponModule}`);
    lines.push('');

    lines.push('Rank  Calls  Imports  Total  Module A ↔ Module B');
    lines.push('─'.repeat(80));
    for (let i = 0; i < result.hotspots.length; i++) {
      const e = result.hotspots[i];
      const a = e.moduleA.replace(/^mod:/, '');
      const b = e.moduleB.replace(/^mod:/, '');
      lines.push(`#${i + 1}    ${String(e.calls).padEnd(7)}${String(e.imports).padEnd(9)}${String(e.total).padEnd(7)}${a} ↔ ${b}`);
    }

    return { success: true, output: lines.join('\n') };
  }

  private async refactorSuggestions(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph): Promise<ToolResult> {
    const { suggestRefactoring } = await import('../../knowledge/graph-analytics.js');

    let communities: import('../../knowledge/community-detection.js').CommunityResult | undefined;
    try {
      const { detectCommunities } = await import('../../knowledge/community-detection.js');
      const prScores = graph.getPageRank();
      communities = detectCommunities(graph, {}, prScores);
    } catch { /* proceed without communities */ }

    const suggestions = suggestRefactoring(graph, communities);

    if (suggestions.length === 0) {
      return { success: true, output: 'No refactoring suggestions. Code structure looks healthy.' };
    }

    const lines: string[] = [`Refactoring Suggestions (${suggestions.length}):\n`];
    for (let i = 0; i < suggestions.length; i++) {
      const s = suggestions[i];
      lines.push(`${i + 1}. ${s.entity} (PageRank: ${s.pageRank.toFixed(3)})`);
      lines.push(`   ${s.reason}`);
      if (s.totalCallers > 0) lines.push(`   Callers: ${s.totalCallers}, Cross-community: ${s.crossCommunityCallers}`);
      lines.push('');
    }

    return { success: true, output: lines.join('\n') };
  }

  private async drift(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph): Promise<ToolResult> {
    const { detectDrift, formatDrift, getSnapshotInfo } = await import('../../knowledge/graph-drift.js');
    const cwd = process.cwd();

    const info = getSnapshotInfo(cwd);
    if (!info) {
      return { success: true, output: 'No snapshot found. Run `code_graph snapshot` first to save a baseline, then `code_graph drift` to detect changes.' };
    }

    const drift = detectDrift(graph, cwd);
    if (!drift) {
      return { success: false, error: 'Failed to compute drift. Snapshot may be corrupted.' };
    }

    return { success: true, output: formatDrift(drift) };
  }

  private async saveSnapshot(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph): Promise<ToolResult> {
    const { saveSnapshot } = await import('../../knowledge/graph-drift.js');
    const cwd = process.cwd();
    saveSnapshot(graph, cwd);
    return { success: true, output: `Snapshot saved (${graph.getStats().tripleCount} triples). Use \`code_graph drift\` later to detect architecture changes.` };
  }

  private async visualize(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph): Promise<ToolResult> {
    const { generateVisualization } = await import('../../knowledge/graph-visualizer.js');
    const cwd = process.cwd();

    let communities: import('../../knowledge/community-detection.js').CommunityResult | undefined;
    try {
      const { detectCommunities } = await import('../../knowledge/community-detection.js');
      communities = detectCommunities(graph);
    } catch { /* proceed without */ }

    const outPath = generateVisualization(graph, cwd, communities);

    return {
      success: true,
      output: `Interactive visualization generated: ${outPath}\nOpen in a browser to explore. Features: pan/zoom, search, predicate filters, color by type, size by PageRank.`,
    };
  }

  private async impactPreview(graph: import('../../knowledge/knowledge-graph.js').KnowledgeGraph): Promise<ToolResult> {
    // Get changed files from git diff
    const { execSync } = await import('child_process');
    let changedFiles: string[];
    try {
      const diff = execSync('git diff --name-only HEAD', { encoding: 'utf-8', cwd: process.cwd() });
      const staged = execSync('git diff --name-only --cached', { encoding: 'utf-8', cwd: process.cwd() });
      changedFiles = [...new Set([...diff.trim().split('\n'), ...staged.trim().split('\n')])]
        .filter(f => f.length > 0);
    } catch {
      return { success: false, error: 'Failed to get git diff. Are you in a git repository?' };
    }

    if (changedFiles.length === 0) {
      return { success: true, output: 'No changed files in git diff. Nothing to analyze.' };
    }

    const { analyzeImpact } = await import('../../knowledge/impact-analyzer.js');
    const allAffectedFiles = new Set<string>();
    const allAffectedFunctions = new Set<string>();
    const fileDetails: string[] = [];

    for (const file of changedFiles) {
      const moduleId = file.replace(/\.[^.]+$/, '');
      const modEntity = `mod:${moduleId}`;

      // Find all functions in this file
      const functions = graph.query({ subject: modEntity, predicate: 'containsFunction' });

      let fileImpact = 0;
      for (const fn of functions) {
        const impact = analyzeImpact(graph, fn.object, 3);
        fileImpact += impact.totalAffected;
        for (const f of impact.affectedFiles) allAffectedFiles.add(f);
        for (const c of [...impact.directCallers, ...impact.indirectCallers]) allAffectedFunctions.add(c);
      }

      // Also check who imports this module
      const importers = graph.query({ predicate: 'imports', object: modEntity });
      for (const t of importers) allAffectedFiles.add(t.subject);

      fileDetails.push(`  ${file} → ${fileImpact} affected functions, ${importers.length} importers`);
    }

    const lines: string[] = [
      `PR Impact Preview — ${changedFiles.length} changed files\n`,
      `Total affected: ${allAffectedFunctions.size} functions across ${allAffectedFiles.size} files\n`,
      'Changed files:',
      ...fileDetails,
    ];

    if (allAffectedFiles.size > 0) {
      lines.push('');
      lines.push(`Affected modules (${allAffectedFiles.size}):`);
      const sorted = [...allAffectedFiles].sort();
      for (const f of sorted.slice(0, 20)) lines.push(`  ${f}`);
      if (sorted.length > 20) lines.push(`  +${sorted.length - 20} more`);
    }

    return { success: true, output: lines.join('\n') };
  }

  // --- ITool interface ---

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['who_calls', 'what_calls', 'impact', 'flowchart', 'class_tree', 'file_map', 'find_path', 'module_deps', 'communities', 'semantic_search', 'dead_code', 'coupling', 'refactor', 'drift', 'snapshot', 'visualize', 'impact_preview', 'stats'],
            description: 'The operation to perform',
          },
          query: { type: 'string', description: 'Function, class, or module name to query' },
          target: { type: 'string', description: 'Target entity for find_path' },
          depth: { type: 'number', description: 'Depth for flowchart/impact (default 2, max 6)' },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) return { valid: false, errors: ['Input must be an object'] };
    const d = input as Record<string, unknown>;
    if (!d.operation || typeof d.operation !== 'string') return { valid: false, errors: ['operation is required'] };
    const ops = ['who_calls', 'what_calls', 'impact', 'flowchart', 'class_tree', 'file_map', 'find_path', 'module_deps', 'communities', 'semantic_search', 'dead_code', 'coupling', 'refactor', 'drift', 'snapshot', 'visualize', 'impact_preview', 'stats'];
    if (!ops.includes(d.operation)) return { valid: false, errors: [`Unknown operation. Available: ${ops.join(', ')}`] };
    const noQueryOps = ['stats', 'communities', 'dead_code', 'coupling', 'refactor', 'drift', 'snapshot', 'visualize', 'impact_preview'];
    if (!noQueryOps.includes(d.operation) && typeof d.query !== 'string') return { valid: false, errors: ['query is required for this operation'] };
    if (d.operation === 'find_path' && typeof d.target !== 'string') return { valid: false, errors: ['target is required for find_path'] };
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'codebase' as ToolCategoryType,
      keywords: [
        'code graph', 'call graph', 'who calls', 'what calls', 'callers', 'callees',
        'impact analysis', 'flowchart', 'mermaid', 'diagram', 'organigramme',
        'class hierarchy', 'inheritance', 'extends', 'implements',
        'file functions', 'methods', 'signatures', 'parameters',
        'dependency path', 'module dependencies', 'imports',
        'communities', 'clusters', 'subsystems', 'architecture',
        'semantic search', 'embedding', 'similarity', 'pagerank',
        'dead code', 'unused', 'uncalled', 'orphan',
        'coupling', 'heatmap', 'tightly coupled', 'dependency density',
        'refactoring', 'god function', 'hub module', 'extract', 'simplify',
        'drift', 'snapshot', 'baseline', 'changed', 'evolution',
        'visualize', 'visualization', 'interactive', 'd3', 'explore',
        'impact preview', 'pr impact', 'diff impact', 'what breaks',
      ],
      priority: 7,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createCodeGraphTools(): ITool[] {
  return [new CodeGraphTool()];
}
