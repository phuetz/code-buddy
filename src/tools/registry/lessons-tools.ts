/**
 * Lessons Tool Adapters
 *
 * ITool-compliant adapters for the self-improvement loop:
 * - LessonsAddTool      (`lessons_add`)      — capture a lesson after a correction
 * - LessonsProposeTool  (`lessons_propose`)  — propose a lesson for human review
 * - LessonsSearchTool   (`lessons_search`)   — find relevant lessons before a task
 * - LessonsListTool   (`lessons_list`)   — list all lessons (with optional filter)
 * - TaskVerifyTool    (`task_verify`)    — run tsc/tests/lint verification contract
 */

import { spawnSync } from 'child_process';
import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType, IToolExecutionContext } from './types.js';
import {
  getLessonsTracker,
  renderLessonConceptGraph,
} from '../../agent/lessons-tracker.js';
import type { LessonGraphRenderFormat } from '../../agent/lessons-tracker.js';
import type { LessonCategory } from '../../agent/lessons-tracker.js';

// ============================================================================
// LessonsAddTool
// ============================================================================

export class LessonsAddTool implements ITool {
  readonly name = 'lessons_add';
  readonly description = [
    'Capture a lesson learned into the persistent lessons.md file.',
    'Use category=PATTERN for "what went wrong → correct approach" after a user correction.',
    'Use category=RULE for invariants to always follow.',
    'Use category=CONTEXT for project/domain-specific facts.',
    'Use category=INSIGHT for non-obvious observations.',
    'Call this immediately after any user correction to prevent the same mistake.',
  ].join(' ');

  async execute(input: Record<string, unknown>, execContext?: IToolExecutionContext): Promise<ToolResult> {
    const category = (input.category as LessonCategory) ?? 'INSIGHT';
    const content = input.content as string;
    const context = input.context as string | undefined;
    const source = (input.source as 'user_correction' | 'self_observed' | 'manual') ?? 'manual';

    if (!content) return { success: false, error: 'content is required' };

    const validCats: LessonCategory[] = ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'];
    if (!validCats.includes(category)) {
      return { success: false, error: `category must be one of: ${validCats.join(', ')}` };
    }

    try {
      const tracker = getLessonsTracker(execContext?.cwd ?? process.cwd());
      const item = tracker.add(category, content, source, context);

      // Emit lesson_added event to active RunStore if one is running (non-fatal)
      try {
        const { getActiveRunStore } = await import('../../observability/run-store.js');
        const store = getActiveRunStore();
        store?.appendEvent('lesson_added', { id: item.id, category, content });
      } catch {
        // non-fatal: RunStore may not be active
      }

      return {
        success: true,
        output: `Lesson saved [${item.id}] (${category}): ${content}`,
      };
    } catch (err) {
      return {
        success: false,
        error: `lessons_add failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'],
            description: 'Lesson category',
          },
          content: {
            type: 'string',
            description: 'The lesson content. For PATTERN: "[what went wrong] → [correct behaviour]"',
          },
          context: {
            type: 'string',
            description: 'Optional domain context (e.g. "TypeScript", "bash", "React")',
          },
          source: {
            type: 'string',
            enum: ['user_correction', 'self_observed', 'manual'],
            description: 'Source of this lesson (default: manual)',
          },
        },
        required: ['content'],
      },
    };
  }

  validate(input: Record<string, unknown>): IValidationResult {
    if (!input.content) {
      return { valid: false, errors: ['content is required'] };
    }
    const validCats = ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'];
    if (input.category && !validCats.includes(input.category as string)) {
      return { valid: false, errors: [`category must be one of: ${validCats.join(', ')}`] };
    }
    return { valid: true, errors: [] };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'planning' as ToolCategoryType,
      keywords: ['lessons', 'self-improvement', 'patterns', 'learning'],
      priority: 80,
      version: '1.0.0',
      author: 'Code Buddy',
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// LessonsProposeTool
// ============================================================================

export class LessonsProposeTool implements ITool {
  readonly name = 'lessons_propose';
  readonly description = [
    'Propose a lesson candidate for human review instead of writing it directly.',
    'Use this (not lessons_add) when YOU noticed a reusable pattern after a complex',
    'successful task and no user correction prompted it — the candidate stays pending',
    'until a human approves, edits, or discards it, so procedural memory is never',
    'silently mutated. Categories: PATTERN/RULE/CONTEXT/INSIGHT.',
  ].join(' ');

  async execute(input: Record<string, unknown>, execContext?: IToolExecutionContext): Promise<ToolResult> {
    const category = (input.category as LessonCategory) ?? 'INSIGHT';
    const content = input.content as string;
    const context = input.context as string | undefined;
    const note = input.note as string | undefined;

    if (!content) return { success: false, error: 'content is required' };

    const validCats: LessonCategory[] = ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'];
    if (!validCats.includes(category)) {
      return { success: false, error: `category must be one of: ${validCats.join(', ')}` };
    }

    try {
      const { getLessonCandidateQueue } = await import('../../agent/lesson-candidate-queue.js');
      const queue = getLessonCandidateQueue(execContext?.cwd ?? process.cwd());

      // Tag provenance with the active run id when one is available.
      let runId: string | undefined;
      try {
        const { getActiveRunStore } = await import('../../observability/run-store.js');
        runId = getActiveRunStore()?.getCurrentRunId() ?? undefined;
      } catch {
        // RunStore may not be active — provenance is best-effort.
      }

      const { candidate, existingLesson, deduped, alreadyRecorded } = queue.propose({
        category,
        content,
        ...(context ? { context } : {}),
        source: 'self_observed',
        ...(runId || note
          ? { provenance: { ...(runId ? { runId } : {}), ...(note ? { note } : {}) } }
          : {}),
      });

      if (alreadyRecorded && existingLesson) {
        return {
          success: true,
          output:
            `Lesson already recorded [${existingLesson.id}] (${existingLesson.category}): ${existingLesson.content}\n` +
            'No new review candidate was created.',
        };
      }
      if (!candidate) {
        return {
          success: true,
          output: 'No new review candidate was created.',
        };
      }

      try {
        const { getActiveRunStore } = await import('../../observability/run-store.js');
        getActiveRunStore()?.appendEvent('lesson_candidate_proposed', {
          id: candidate.id,
          category,
          content,
          deduped,
        });
      } catch {
        // non-fatal: RunStore may not be active
      }

      const verb = deduped ? 'Matched existing pending candidate' : 'Proposed lesson candidate';
      return {
        success: true,
        output:
          `${verb} [${candidate.id}] (${category}): ${content}\n` +
          'It is awaiting human review and was NOT written to lessons.md. ' +
          `Approve with: buddy lessons candidate approve ${candidate.id} --by <name>`,
      };
    } catch (err) {
      return {
        success: false,
        error: `lessons_propose failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'],
            description: 'Lesson category',
          },
          content: {
            type: 'string',
            description: 'The proposed lesson. For PATTERN: "[what went wrong] → [correct behaviour]"',
          },
          context: {
            type: 'string',
            description: 'Optional domain context (e.g. "TypeScript", "bash", "React")',
          },
          note: {
            type: 'string',
            description: 'Optional provenance note, e.g. why this pattern is worth keeping',
          },
        },
        required: ['content'],
      },
    };
  }

  validate(input: Record<string, unknown>): IValidationResult {
    if (!input.content) {
      return { valid: false, errors: ['content is required'] };
    }
    const validCats = ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'];
    if (input.category && !validCats.includes(input.category as string)) {
      return { valid: false, errors: [`category must be one of: ${validCats.join(', ')}`] };
    }
    return { valid: true, errors: [] };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'planning' as ToolCategoryType,
      keywords: ['lessons', 'candidate', 'propose', 'review', 'self-improvement', 'learning'],
      priority: 78,
      version: '1.0.0',
      author: 'Code Buddy',
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// LessonsSearchTool
// ============================================================================

export class LessonsSearchTool implements ITool {
  readonly name = 'lessons_search';
  readonly description = [
    'Search lessons learned by keyword and optional category filter.',
    'Call this before starting tasks similar to previous ones to avoid repeating mistakes.',
    'Returns matching lessons sorted by recency.',
  ].join(' ');

  async execute(input: Record<string, unknown>, execContext?: IToolExecutionContext): Promise<ToolResult> {
    const query = input.query as string;
    const category = input.category as LessonCategory | undefined;
    const limit = Math.min(Number(input.limit ?? 10), 50);

    if (!query) return { success: false, error: 'query is required' };

    try {
      const tracker = getLessonsTracker(execContext?.cwd ?? process.cwd());
      const results = tracker.search(query, category).slice(0, limit);
      if (results.length === 0) {
        return { success: true, output: `No lessons found matching "${query}".` };
      }
      const lines = results.map(
        l => `[${l.id}] **${l.category}** ${l.context ? `_(${l.context})_ ` : ''}${l.content}`
      );
      return { success: true, output: `Found ${results.length} lesson(s):\n\n${lines.join('\n')}` };
    } catch (err) {
      return {
        success: false,
        error: `lessons_search failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keyword(s) to search for in lesson content',
          },
          category: {
            type: 'string',
            enum: ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'],
            description: 'Optional: filter to a specific category',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 10)',
          },
        },
        required: ['query'],
      },
    };
  }

  validate(input: Record<string, unknown>): IValidationResult {
    if (!input.query) {
      return { valid: false, errors: ['query is required'] };
    }
    return { valid: true, errors: [] };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'planning' as ToolCategoryType,
      keywords: ['lessons', 'search', 'self-improvement'],
      priority: 80,
      version: '1.0.0',
      author: 'Code Buddy',
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// LessonsListTool
// ============================================================================

export class LessonsListTool implements ITool {
  readonly name = 'lessons_list';
  readonly description = 'List all lessons learned, optionally filtered by category (PATTERN|RULE|CONTEXT|INSIGHT).';

  async execute(input: Record<string, unknown>, execContext?: IToolExecutionContext): Promise<ToolResult> {
    const category = input.category as LessonCategory | undefined;

    try {
      const tracker = getLessonsTracker(execContext?.cwd ?? process.cwd());
      const items = tracker.list(category);
      if (items.length === 0) {
        return { success: true, output: 'No lessons recorded yet.' };
      }
      const lines = items.map(
        l => `[${l.id}] **${l.category}** ${l.context ? `_(${l.context})_ ` : ''}${l.content}`
      );
      return { success: true, output: `${items.length} lesson(s):\n\n${lines.join('\n')}` };
    } catch (err) {
      return {
        success: false,
        error: `lessons_list failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'],
            description: 'Optional: filter to a specific category',
          },
        },
        required: [],
      },
    };
  }

  validate(_input: Record<string, unknown>): IValidationResult {
    return { valid: true, errors: [] };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'planning' as ToolCategoryType,
      keywords: ['lessons', 'list', 'self-improvement'],
      priority: 80,
      version: '1.0.0',
      author: 'Code Buddy',
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// LessonsGraphTool
// ============================================================================

export class LessonsGraphTool implements ITool {
  readonly name = 'lessons_graph';
  readonly description = [
    'Build a mini-Obsidian concept graph from persistent lessons.md.',
    'Keeps Markdown as the source of truth and derives concepts from [[wiki links]], Markdown links, #tags, context, related/tags metadata, and keywords.',
    'Use this to find nearby lessons and connected notions before similar work.',
  ].join(' ');

  async execute(input: Record<string, unknown>, execContext?: IToolExecutionContext): Promise<ToolResult> {
    const query = input.query as string | undefined;
    const concept = input.concept as string | undefined;
    const category = input.category as LessonCategory | undefined;
    const includeKeywords = input.includeKeywords !== false;
    const limit = Number(input.limit ?? 50);
    const format = (input.format as LessonGraphRenderFormat | undefined) ?? 'summary';

    try {
      const tracker = getLessonsTracker(execContext?.cwd ?? process.cwd());
      const graph = tracker.buildConceptGraph({ query, concept, category, includeKeywords, limit });
      return { success: true, output: renderLessonConceptGraph(graph, format) };
    } catch (err) {
      return {
        success: false,
        error: `lessons_graph failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional text filter before graphing lessons',
          },
          concept: {
            type: 'string',
            description: 'Only graph lessons linked to this concept slug, label, wiki link, or Markdown target',
          },
          category: {
            type: 'string',
            enum: ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'],
            description: 'Optional category filter',
          },
          limit: {
            type: 'number',
            description: 'Maximum lessons to graph (default: 50, max: 200)',
          },
          includeKeywords: {
            type: 'boolean',
            description: 'Whether to include fallback keyword concepts. Set false for a cleaner explicit-link/tag graph.',
          },
          format: {
            type: 'string',
            enum: ['summary', 'json', 'markdown', 'mermaid'],
            description: 'Return a concise Markdown summary, the full graph JSON, an Obsidian-friendly Markdown index, or a Mermaid diagram',
          },
        },
        required: [],
      },
    };
  }

  validate(input: Record<string, unknown>): IValidationResult {
    const validCats = ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'];
    if (input.category && !validCats.includes(input.category as string)) {
      return { valid: false, errors: [`category must be one of: ${validCats.join(', ')}`] };
    }
    if (input.format && !['summary', 'json', 'markdown', 'mermaid'].includes(input.format as string)) {
      return { valid: false, errors: ['format must be summary, json, markdown, or mermaid'] };
    }
    return { valid: true, errors: [] };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'planning' as ToolCategoryType,
      keywords: ['lessons', 'graph', 'obsidian', 'concepts', 'related', 'wiki', 'self-improvement'],
      priority: 80,
      version: '1.0.0',
      author: 'Code Buddy',
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// TaskVerifyTool
// ============================================================================

type VerifyCheck = 'typescript' | 'tests' | 'lint';

function runCheck(cmd: string, args: string[], cwd: string, timeoutMs = 60_000): { pass: boolean; output: string } {
  const result = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf-8',
    timeout: timeoutMs,
    shell: false,
  });

  const raw = [result.stdout ?? '', result.stderr ?? ''].join('\n').trim();
  // Truncate to last 2000 chars to keep output manageable
  const output = raw.length > 2000 ? '...(truncated)\n' + raw.slice(-2000) : raw;
  const pass = result.status === 0 && !result.error;

  return { pass, output };
}

export class TaskVerifyTool implements ITool {
  readonly name = 'task_verify';
  readonly description = [
    'Run verification checks before marking a task complete (Verification Contract).',
    'Checks: typescript (npx tsc --noEmit), tests (auto-detected from package.json), lint (eslint).',
    'Returns pass/fail per check with truncated output.',
    'Call this before every task completion to satisfy the Verification Contract.',
  ].join(' ');

  async execute(input: Record<string, unknown>, execContext?: IToolExecutionContext): Promise<ToolResult> {
    const checksInput = input.checks as VerifyCheck[] | undefined;
    const workDir = (input.workDir as string) ?? execContext?.cwd ?? process.cwd();

    const checks: VerifyCheck[] = checksInput ?? ['typescript', 'tests'];
    const validChecks: VerifyCheck[] = ['typescript', 'tests', 'lint'];
    const invalid = checks.filter(c => !validChecks.includes(c));
    if (invalid.length > 0) {
      return { success: false, error: `Invalid checks: ${invalid.join(', ')}. Valid: ${validChecks.join(', ')}` };
    }

    const results: Array<{ check: VerifyCheck; pass: boolean; output: string }> = [];

    for (const check of checks) {
      let res: { pass: boolean; output: string };

      if (check === 'typescript') {
        res = runCheck('npx', ['tsc', '--noEmit'], workDir);
      } else if (check === 'tests') {
        // Try to detect test command from RepoProfiler cache
        let testCmd = 'npm';
        let testArgs = ['test', '--', '--passWithNoTests'];
        try {
          const { getRepoProfiler } = await import('../../agent/repo-profiler.js');
          const profile = await getRepoProfiler(workDir).getProfile();
          if (profile.commands.test) {
            const parts = profile.commands.test.split(/\s+/);
            const [cmd, ...rest] = parts;
            if (cmd) {
              testCmd = cmd;
              testArgs = rest;
            }
          }
        } catch {
          // use default npm test
        }
        res = runCheck(testCmd, testArgs, workDir, 120_000);
      } else {
        // lint
        res = runCheck('npx', ['eslint', '.', '--max-warnings=0'], workDir, 60_000);
      }

      results.push({ check, pass: res.pass, output: res.output });
    }

    const allPass = results.every(r => r.pass);
    const lines = results.map(r => {
      const icon = r.pass ? '✅' : '❌';
      return `${icon} **${r.check}**: ${r.pass ? 'PASS' : 'FAIL'}\n${r.output ? r.output + '\n' : ''}`;
    });

    return {
      success: allPass,
      output: lines.join('\n---\n'),
      error: allPass ? undefined : `Verification failed for: ${results.filter(r => !r.pass).map(r => r.check).join(', ')}`,
    };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          checks: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['typescript', 'tests', 'lint'],
            },
            description: 'List of checks to run (default: ["typescript", "tests"])',
          },
          workDir: {
            type: 'string',
            description: 'Working directory to run checks in (default: current directory)',
          },
        },
        required: [],
      },
    };
  }

  validate(_input: Record<string, unknown>): IValidationResult {
    return { valid: true, errors: [] };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'testing' as ToolCategoryType,
      keywords: ['verify', 'typescript', 'tests', 'lint', 'quality'],
      priority: 90,
      version: '1.0.0',
      author: 'Code Buddy',
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createLessonsTools(): ITool[] {
  return [
    new LessonsAddTool(),
    new LessonsProposeTool(),
    new LessonsSearchTool(),
    new LessonsListTool(),
    new LessonsGraphTool(),
    new TaskVerifyTool(),
  ];
}
