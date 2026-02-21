/**
 * Lessons Tool Adapters
 *
 * ITool-compliant adapters for the self-improvement loop:
 * - LessonsAddTool    (`lessons_add`)    — capture a lesson after a correction
 * - LessonsSearchTool (`lessons_search`) — find relevant lessons before a task
 * - LessonsListTool   (`lessons_list`)   — list all lessons (with optional filter)
 * - TaskVerifyTool    (`task_verify`)    — run tsc/tests/lint verification contract
 */

import { spawnSync } from 'child_process';
import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { getLessonsTracker } from '../../agent/lessons-tracker.js';
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

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
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
      const tracker = getLessonsTracker(process.cwd());
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
// LessonsSearchTool
// ============================================================================

export class LessonsSearchTool implements ITool {
  readonly name = 'lessons_search';
  readonly description = [
    'Search lessons learned by keyword and optional category filter.',
    'Call this before starting tasks similar to previous ones to avoid repeating mistakes.',
    'Returns matching lessons sorted by recency.',
  ].join(' ');

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    const category = input.category as LessonCategory | undefined;
    const limit = Math.min(Number(input.limit ?? 10), 50);

    if (!query) return { success: false, error: 'query is required' };

    try {
      const tracker = getLessonsTracker(process.cwd());
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

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const category = input.category as LessonCategory | undefined;

    try {
      const tracker = getLessonsTracker(process.cwd());
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

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const checksInput = input.checks as VerifyCheck[] | undefined;
    const workDir = (input.workDir as string) ?? process.cwd();

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
            testCmd = parts[0];
            testArgs = parts.slice(1);
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
    new LessonsSearchTool(),
    new LessonsListTool(),
    new TaskVerifyTool(),
  ];
}
