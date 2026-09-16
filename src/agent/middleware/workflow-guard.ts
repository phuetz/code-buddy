/**
 * Workflow Guard Middleware
 *
 * Detects tasks that require planning before acting (priority 45).
 * When the first user message contains 3+ distinct action verbs AND
 * there is no existing PLAN.md, emits a `steer` hint suggesting
 * the agent create a plan before diving into implementation.
 *
 * This resolves the plan-first vs bug-fix tension:
 * - Single-file fixes with 1-2 verbs: proceed directly
 * - Multi-verb, multi-file tasks: steer toward plan init
 *
 * Priority 45 — runs after cost-limit (10) and turn-limit (10),
 * but before most business logic middlewares (100+).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConversationMiddleware, MiddlewareContext, MiddlewareResult } from './types.js';
import type { KnowledgeGraph } from '../../knowledge/knowledge-graph.js';
import { getRepoProfiler } from '../repo-profiler.js';

// Action verbs that indicate non-trivial scope
const ACTION_VERBS = new Set([
  'create', 'add', 'implement', 'build', 'write',
  'fix', 'repair', 'resolve', 'debug', 'patch',
  'update', 'change', 'modify', 'edit', 'refactor',
  'test', 'verify', 'validate', 'check',
  'deploy', 'release', 'publish', 'push',
  'remove', 'delete', 'drop', 'clean',
  'migrate', 'upgrade', 'downgrade',
  'integrate', 'connect', 'setup', 'configure',
  'optimise', 'optimize', 'improve', 'enhance',
  'document', 'explain', 'analyse', 'analyze',
]);

function countDistinctActionVerbs(text: string): number {
  const words = text.toLowerCase().match(/\b\w+\b/g) ?? [];
  const found = new Set<string>();
  for (const word of words) {
    // Check base form and common conjugations
    if (ACTION_VERBS.has(word)) found.add(word);
    // Strip trailing 's' for 3rd person singular (creates → create)
    else if (word.endsWith('s') && ACTION_VERBS.has(word.slice(0, -1))) found.add(word.slice(0, -1));
    // Strip 'ing' (creating → create)
    else if (word.endsWith('ing') && ACTION_VERBS.has(word.slice(0, -3))) found.add(word.slice(0, -3));
    // Strip 'ed' (created → create)
    else if (word.endsWith('ed') && ACTION_VERBS.has(word.slice(0, -2))) found.add(word.slice(0, -2));
  }
  return found.size;
}

function hasPlanFile(cwd: string): boolean {
  return (
    fs.existsSync(path.join(cwd, 'PLAN.md')) ||
    fs.existsSync(path.join(cwd, '.codebuddy', 'PLAN.md'))
  );
}

/** Cached entity extractor — loaded lazily from context provider */
let _extractEntities: ((msg: string) => string[]) | null = null;
import('../../knowledge/code-graph-context-provider.js')
  .then(mod => { _extractEntities = mod.extractEntities; })
  .catch(() => { /* optional */ });

/**
 * Compute structural complexity from the code graph.
 * High fan-in entities and cross-module changes indicate risky tasks.
 */
function computeStructuralComplexity(text: string, graph: KnowledgeGraph): number {
  if (!_extractEntities) return 0;

  const candidates = _extractEntities(text);
  if (candidates.length === 0) return 0;

  let score = 0;
  const resolvedModules = new Set<string>();

  for (const candidate of candidates.slice(0, 6)) {
    const entity = graph.findEntity(candidate);
    if (!entity) continue;

    // Fan-in: callers and importers count
    const callers = graph.query({ predicate: 'calls', object: entity });
    const importers = graph.query({ predicate: 'imports', object: entity });
    score += Math.min(callers.length, 5);
    score += Math.min(importers.length, 5);

    // Track module for cross-module detection
    const modPath = entity.replace(/^(mod|cls|fn|iface):/, '').split('/').slice(0, 3).join('/');
    if (modPath) resolvedModules.add(modPath);
  }

  // Cross-module bonus: touching 3+ distinct module paths = risky
  if (resolvedModules.size > 2) score += 3;

  return score;
}

/** Lazy-loaded graph reference for structural complexity */
let _graphProvider: (() => KnowledgeGraph | null) | null = null;

/**
 * Wire the graph provider into the workflow guard.
 * Called from codebuddy-agent.ts during initialization.
 */
export function setWorkflowGuardGraphProvider(provider: () => KnowledgeGraph | null): void {
  _graphProvider = provider;
}

/** Docs context provider for suggesting relevant docs (wired from codebuddy-agent) */
let _docsProvider: ((message: string) => string | null) | null = null;
export function setWorkflowGuardDocsProvider(provider: (message: string) => string | null): void {
  _docsProvider = provider;
}

/** Starter pack name keywords for lightweight intent detection */
const STARTER_KEYWORDS: Record<string, string> = {
  'react native': 'typescript-react-native', 'react-native': 'typescript-react-native',
  'react': 'typescript-react', 'nextjs': 'typescript-nextjs', 'next.js': 'typescript-nextjs',
  'vue': 'typescript-vue', 'svelte': 'typescript-svelte', 'angular': 'typescript-angular',
  'electron': 'typescript-electron',
  'express': 'typescript-node', 'node': 'typescript-node', 'typescript': 'typescript-node',
  'python': 'python', 'django': 'python-django', 'flask': 'python-flask', 'fastapi': 'python-fastapi',
  'rust': 'rust', 'axum': 'rust-axum', 'tauri': 'rust-tauri',
  'golang': 'go', 'gin': 'go-gin', 'fiber': 'go-fiber',
  'ruby': 'ruby', 'rails': 'ruby-rails',
  'php': 'php', 'laravel': 'php-laravel',
  'java': 'java', 'spring': 'java-spring', 'kotlin': 'kotlin', 'ktor': 'kotlin-ktor',
  'c#': 'csharp-dotnet', 'csharp': 'csharp-dotnet', '.net': 'csharp-dotnet', 'aspnet': 'csharp-aspnet', 'maui': 'csharp-maui',
  'elixir': 'elixir', 'phoenix': 'elixir-phoenix',
  'swift': 'swift', 'vapor': 'swift-vapor',
  'zig': 'zig',
};

/** Keywords needing word-boundary matching to avoid false positives */
const WB_KEYWORDS = new Set(['go']);

/**
 * Sorted keyword entries: longest first so "react native" matches before "react".
 * Pre-computed once at module load.
 */
const SORTED_STARTER_ENTRIES = Object.entries(STARTER_KEYWORDS)
  .sort((a, b) => b[0].length - a[0].length);

/** Detect if the text mentions a framework/language that has a starter pack */
export function detectStarterIntent(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [keyword, starterName] of SORTED_STARTER_ENTRIES) {
    if (WB_KEYWORDS.has(keyword)) {
      if (new RegExp(`\\b${keyword}\\b`).test(lower)) return starterName;
    } else {
      if (lower.includes(keyword)) return starterName;
    }
  }
  return null;
}


export class WorkflowGuardMiddleware implements ConversationMiddleware {
  readonly name = 'workflow-guard';
  readonly priority = 45;

  beforeTurn(context: MiddlewareContext): MiddlewareResult {
    // Only trigger on the very first turn (round 0) of a session
    if (context.toolRound !== 0) {
      return { action: 'continue' };
    }

    // Extract last user message
    const lastUser = [...context.messages]
      .reverse()
      .find(m => m.role === 'user');
    if (!lastUser) return { action: 'continue' };

    const text = typeof lastUser.content === 'string'
      ? lastUser.content
      : Array.isArray(lastUser.content)
        ? lastUser.content.map((c: unknown) => {
            if (typeof c === 'object' && c !== null && 'text' in c) {
              return (c as { text: string }).text;
            }
            return '';
          }).join(' ')
        : '';

    // `buddy dev plan` already IS the plan step — do not nag it to create PLAN.md.
    const lower = text.toLowerCase();
    if (
      /do not implement yet/.test(lower) ||
      /\bplan only\b/.test(lower) ||
      /start with plan only/.test(lower)
    ) {
      return { action: 'continue' };
    }

    // Detect empty project and suggest starter pack
    if (getRepoProfiler().isEmptyProject()) {
      const starterHint = detectStarterIntent(text);
      if (starterHint) {
        return {
          action: 'warn',
          message: `[workflow-guard] Empty project detected. ` +
            `A "${starterHint}" starter pack is available — it will be auto-injected as guidance. ` +
            `You can also browse all starters with /starter`,
        };
      }
    }

    const verbCount = countDistinctActionVerbs(text);

    // Compute structural complexity from graph (if available)
    let structuralScore = 0;
    if (_graphProvider) {
      try {
        const graph = _graphProvider();
        if (graph && graph.getStats().tripleCount > 0) {
          structuralScore = computeStructuralComplexity(text, graph);
        }
      } catch { /* graph not available — degrade gracefully */ }
    }

    const needsPlan = !hasPlanFile(process.cwd());

    // Trigger if 3+ action verbs OR high structural complexity (>8)
    if (needsPlan && (verbCount >= 3 || structuralScore > 8)) {
      const reason = structuralScore > 8
        ? `structural complexity ${structuralScore} (high fan-in / cross-module)`
        : `${verbCount} distinct actions`;
      // Suggest relevant docs alongside plan
      let docsHint = '';
      if (_docsProvider) {
        try {
          const ctx = _docsProvider(text);
          if (ctx) {
            const titles = [...ctx.matchAll(/^### (.+)$/gm)].map(m => m[1]).slice(0, 2);
            if (titles.length > 0) docsHint = ` Relevant docs: ${titles.join(', ')}.`;
          }
        } catch { /* docs optional */ }
      }

      return {
        action: 'warn',
        message: [
          `[workflow-guard] This task has ${reason}.`,
          'Consider initialising a plan first: call the `plan` tool with action="init"',
          'or create PLAN.md to break the work into verifiable steps before acting.',
          `Proceeding without a plan — but be mindful of the Verification Contract.${docsHint}`,
        ].join(' '),
      };
    }

    return { action: 'continue' };
  }
}
