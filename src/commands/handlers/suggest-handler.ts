/**
 * /suggest Slash Command Handler
 *
 * Provides proactive suggestions for the current project context.
 *
 * Usage:
 *   /suggest                — get all suggestions for current context
 *   /suggest code           — suggest code improvements
 *   /suggest perf           — suggest performance improvements
 *   /suggest security       — suggest security improvements
 */

import type { CommandHandlerResult } from './branch-handlers.js';
import { failureFlag } from '../slash-failure.js';

export async function handleSuggest(args: string[]): Promise<CommandHandlerResult> {
  const category = args[0]?.toLowerCase() || 'all';

  const validCategories = ['all', 'code', 'perf', 'security', 'git', 'testing', 'docs', 'workflow'];

  if (category === 'help' || category === '--help') {
    return result(
      'Usage: /suggest [category]\n\n' +
      'Get proactive suggestions for the current project.\n\n' +
      'Categories:\n' +
      '  all        — all suggestions (default)\n' +
      '  code       — code quality improvements\n' +
      '  perf       — performance improvements\n' +
      '  security   — security improvements\n' +
      '  git        — git workflow suggestions\n' +
      '  testing    — testing coverage suggestions\n' +
      '  docs       — documentation suggestions\n' +
      '  workflow   — workflow and process suggestions'
    );
  }

  if (!validCategories.includes(category)) {
    return result(`Unknown suggestion category: "${category}".\nValid categories: ${validCategories.join(', ')}`);
  }

  try {
    const { generateSuggestions } = await import('../../intelligence/proactive-suggestions.js');
    const suggestions = await generateSuggestions(process.cwd());

    // Filter by category if specified
    const filtered = category === 'all'
      ? suggestions
      : suggestions.filter(s => matchesCategory(s.type, category));

    if (filtered.length === 0) {
      return result(category === 'all'
        ? 'No suggestions at this time. Your project looks good!'
        : `No ${category} suggestions at this time.`);
    }

    // Format suggestions
    const lines: string[] = [
      `Found ${filtered.length} suggestion(s)${category !== 'all' ? ` (${category})` : ''}:\n`,
    ];

    for (const s of filtered) {
      const priorityTag = s.priority === 'urgent' ? '[URGENT]'
        : s.priority === 'high' ? '[HIGH]'
        : s.priority === 'medium' ? '[MEDIUM]'
        : '[LOW]';

      lines.push(`${priorityTag} ${s.title}`);
      lines.push(`  ${s.description}`);
      if (s.command) {
        lines.push(`  Suggested: ${s.command}`);
      }
      lines.push('');
    }

    return result(lines.join('\n'));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return result(`Failed to generate suggestions: ${msg}`);
  }
}

/**
 * Map user-facing category names to SuggestionType values.
 */
function matchesCategory(type: string, category: string): boolean {
  const categoryMap: Record<string, string[]> = {
    code: ['code-quality', 'maintenance'],
    perf: ['performance'],
    security: ['security'],
    git: ['git'],
    testing: ['testing'],
    docs: ['documentation'],
    workflow: ['workflow'],
  };

  const types = categoryMap[category];
  if (!types) return false;
  return types.includes(type);
}

function result(content: string): CommandHandlerResult {
  return {
    handled: true,
    ...failureFlag(content),
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}
