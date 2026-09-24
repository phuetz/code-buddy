/**
 * Graph Slash Command Handlers — CodeExplorer Knowledge Graph
 *
 * /impact <symbol>  — Analyze blast radius of changing a symbol
 * /processes         — Detect execution flows in the codebase
 * /communities       — Detect architectural modules
 */

import type { CommandHandlerResult } from './branch-handlers.js';
import type { KnowledgeGraph } from '../../knowledge/knowledge-graph.js';
import { failureFlag } from '../slash-failure.js';

/** Ensure the graph is loaded from disk cache then populated if still empty */
async function ensureGraphLoaded(graph: KnowledgeGraph): Promise<void> {
  if (graph.getStats().tripleCount === 0) {
    try {
      const { loadCodeGraph, codeGraphExists } = await import('../../knowledge/code-graph-persistence.js');
      if (codeGraphExists(process.cwd())) {
        loadCodeGraph(graph, process.cwd());
      }
    } catch { /* persistence optional */ }
  }
  if (graph.getStats().tripleCount === 0) {
    try {
      const { populateDeepCodeGraph } = await import('../../knowledge/code-graph-deep-populator.js');
      populateDeepCodeGraph(graph, process.cwd());
    } catch { /* ignore */ }
  }
}

/**
 * /impact <symbol> [--direction up|down|both] [--depth N]
 */
export async function handleImpact(args: string[]): Promise<CommandHandlerResult> {
  if (args.length === 0) {
    return {
      handled: true,
...failureFlag('Impact Analysis Commands:\n\n' +
          '  /impact <symbol>                    — Analyze blast radius (both directions)\n' +
          '  /impact <symbol> --direction up      — Show only callers (upstream)\n' +
          '  /impact <symbol> --direction down     — Show only callees (downstream)\n' +
          '  /impact <symbol> --depth 3            — Limit traversal depth\n' +
          '\nExamples:\n' +
          '  /impact handleLogin\n' +
          '  /impact CodeBuddyAgent --direction up\n' +
          '  /impact executeTool --depth 2'),
      entry: {
        type: 'assistant',
        content: 'Impact Analysis Commands:\n\n' +
          '  /impact <symbol>                    — Analyze blast radius (both directions)\n' +
          '  /impact <symbol> --direction up      — Show only callers (upstream)\n' +
          '  /impact <symbol> --direction down     — Show only callees (downstream)\n' +
          '  /impact <symbol> --depth 3            — Limit traversal depth\n' +
          '\nExamples:\n' +
          '  /impact handleLogin\n' +
          '  /impact CodeBuddyAgent --direction up\n' +
          '  /impact executeTool --depth 2',
        timestamp: new Date(),
      },
    };
  }

  const { getKnowledgeGraph } = await import('../../knowledge/knowledge-graph.js');
  const { analyzeImpact } = await import('../../knowledge/impact-analyzer.js');

  const graph = getKnowledgeGraph();
  await ensureGraphLoaded(graph);

  if (graph.getStats().tripleCount === 0) {
    return {
      handled: true,
...failureFlag('Code graph is empty. Run /docs-generate or use the codebase_map tool first.'),
      entry: {
        type: 'assistant',
        content: 'Code graph is empty. Run /docs-generate or use the codebase_map tool first.',
        timestamp: new Date(),
      },
    };
  }

  // Parse args
  let target = '';
  let direction: 'up' | 'down' | 'both' = 'both';
  let maxDepth = 5;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--direction' && i + 1 < args.length) {
      const d = (args[i + 1] ?? '').toLowerCase();
      if (d === 'up' || d === 'down' || d === 'both') {
        direction = d;
      }
      i++;
    } else if (arg === '--depth' && i + 1 < args.length) {
      maxDepth = parseInt(args[i + 1] ?? '', 10) || 5;
      i++;
    } else if (!target) {
      target = arg;
    }
  }

  if (!target) {
    return {
      handled: true,
...failureFlag('Usage: /impact <symbol> [--direction up|down|both] [--depth N]'),
      entry: {
        type: 'assistant',
        content: 'Usage: /impact <symbol> [--direction up|down|both] [--depth N]',
        timestamp: new Date(),
      },
    };
  }

  const report = analyzeImpact(graph, target, maxDepth);

  // Use the pre-formatted output or build a simple summary
  const lines: string[] = report.formatted
    ? [report.formatted]
    : [
        `Impact analysis for '${report.entity}':`,
        `  Direct callers (${report.directCallers.length}): ${report.directCallers.slice(0, 10).join(', ')}`,
        `  Indirect callers (${report.indirectCallers.length}): ${report.indirectCallers.slice(0, 10).join(', ')}`,
        `  Affected files (${report.affectedFiles.length}): ${report.affectedFiles.slice(0, 10).join(', ')}`,
      ];

  return {
    handled: true,
...failureFlag(lines.join('\n')),
    entry: {
      type: 'assistant',
      content: lines.join('\n'),
      timestamp: new Date(),
    },
  };
}

/**
 * /processes [entry-point] [--min-steps N]
 */
export async function handleProcesses(args: string[]): Promise<CommandHandlerResult> {
  const { getKnowledgeGraph } = await import('../../knowledge/knowledge-graph.js');
  const { detectProcesses } = await import('../../knowledge/process-detector.js');

  const graph = getKnowledgeGraph();
  await ensureGraphLoaded(graph);

  if (graph.getStats().tripleCount === 0) {
    return {
      handled: true,
...failureFlag('Code graph is empty. Run /docs-generate or use the codebase_map tool first.'),
      entry: {
        type: 'assistant',
        content: 'Code graph is empty. Run /docs-generate or use the codebase_map tool first.',
        timestamp: new Date(),
      },
    };
  }

  // Parse args
  let entryPoint: string | undefined;
  let minSteps = 3;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--min-steps' && i + 1 < args.length) {
      minSteps = parseInt(args[i + 1] ?? '', 10) || 3;
      i++;
    } else if (!entryPoint) {
      entryPoint = arg;
    }
  }

  const processes = detectProcesses(graph, { entryPoint, minSteps });

  if (processes.length === 0) {
    return {
      handled: true,
...failureFlag(entryPoint
          ? `No processes found from entry point "${entryPoint}" with at least ${minSteps} steps.`
          : `No processes detected with at least ${minSteps} steps.`),
      entry: {
        type: 'assistant',
        content: entryPoint
          ? `No processes found from entry point "${entryPoint}" with at least ${minSteps} steps.`
          : `No processes detected with at least ${minSteps} steps.`,
        timestamp: new Date(),
      },
    };
  }

  const lines: string[] = [
    `Detected ${processes.length} execution process${processes.length > 1 ? 'es' : ''}:`,
    '',
  ];

  for (const proc of processes) {
    lines.push(`## ${proc.name}`);
    lines.push(`  Entry: ${proc.entryPoint}`);
    lines.push(`  Steps: ${proc.steps.length} | Files: ${proc.files.length}`);
    const steps = proc.steps.slice(0, 10);
    for (const step of steps) {
      lines.push(`    ${step.stepIndex + 1}. [${step.type}] ${step.symbolName}`);
    }
    if (proc.steps.length > 10) {
      lines.push(`    +${proc.steps.length - 10} more`);
    }
    lines.push('');
  }

  return {
    handled: true,
...failureFlag(lines.join('\n')),
    entry: { type: 'assistant', content: lines.join('\n'), timestamp: new Date() },
  };
}

/**
 * /communities [--min-size N]
 */
export async function handleCommunities(args: string[]): Promise<CommandHandlerResult> {
  const { getKnowledgeGraph } = await import('../../knowledge/knowledge-graph.js');
  const { detectCommunities } = await import('../../knowledge/community-detector.js');

  const graph = getKnowledgeGraph();
  await ensureGraphLoaded(graph);

  if (graph.getStats().tripleCount === 0) {
    return {
      handled: true,
...failureFlag('Code graph is empty. Run /docs-generate or use the codebase_map tool first.'),
      entry: {
        type: 'assistant',
        content: 'Code graph is empty. Run /docs-generate or use the codebase_map tool first.',
        timestamp: new Date(),
      },
    };
  }

  // Parse args
  let minSize = 3;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--min-size' && i + 1 < args.length) {
      minSize = parseInt(args[i + 1] ?? '', 10) || 3;
      i++;
    }
  }

  const communities = detectCommunities(graph, { minSize });

  if (communities.length === 0) {
    return {
      handled: true,
...failureFlag(`No communities detected with at least ${minSize} symbols.`),
      entry: {
        type: 'assistant',
        content: `No communities detected with at least ${minSize} symbols.`,
        timestamp: new Date(),
      },
    };
  }

  const lines: string[] = [
    `Detected ${communities.length} architectural communit${communities.length > 1 ? 'ies' : 'y'}:`,
    '',
  ];

  for (const comm of communities) {
    lines.push(`## ${comm.name} (id: ${comm.id})`);
    lines.push(`  Symbols: ${comm.symbols.length} | Files: ${comm.files.length} | Cohesion: ${(comm.cohesion * 100).toFixed(1)}%`);

    if (comm.entryPoints.length > 0) {
      const shown = comm.entryPoints.slice(0, 5);
      lines.push(`  Entry points: ${shown.join(', ')}${comm.entryPoints.length > 5 ? ` +${comm.entryPoints.length - 5}` : ''}`);
    }

    if (comm.files.length > 0) {
      const shown = comm.files.slice(0, 5);
      lines.push(`  Files: ${shown.join(', ')}${comm.files.length > 5 ? ` +${comm.files.length - 5}` : ''}`);
    }
    lines.push('');
  }

  return {
    handled: true,
...failureFlag(lines.join('\n')),
    entry: { type: 'assistant', content: lines.join('\n'), timestamp: new Date() },
  };
}
