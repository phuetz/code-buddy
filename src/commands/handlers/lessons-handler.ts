import { getLessonsTracker } from '../../agent/lessons-tracker.js';
import type { CommandHandlerResult } from './branch-handlers.js';

export function handleLessonsCommand(args: string): CommandHandlerResult {
  const tracker = getLessonsTracker(process.cwd());
  const parts = args.trim().split(/\s+/);
  const sub = parts[0] ?? 'list';

  if (sub === 'list' || sub === '') {
    const block = tracker.buildContextBlock();
    const output = block ?? 'No lessons recorded yet.';
    return {
      handled: true,
      entry: { type: 'assistant', content: output, timestamp: new Date() },
    };
  }

  if (sub === 'stats') {
    const stats = tracker.getStats();
    const lines = [`Total: ${stats.total}`];
    for (const [cat, n] of Object.entries(stats.byCategory)) {
      lines.push(`  ${cat}: ${n}`);
    }
    if (stats.oldestAt) lines.push(`Oldest: ${new Date(stats.oldestAt).toISOString().slice(0, 10)}`);
    if (stats.newestAt) lines.push(`Newest: ${new Date(stats.newestAt).toISOString().slice(0, 10)}`);
    return {
      handled: true,
      entry: { type: 'assistant', content: lines.join('\n'), timestamp: new Date() },
    };
  }

  if (sub === 'add' && parts.length > 1) {
    const content = parts.slice(1).join(' ');
    const item = tracker.add('INSIGHT', content, 'manual');
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Lesson added [${item.id}]`,
        timestamp: new Date(),
      },
    };
  }

  if (sub === 'search' && parts.length > 1) {
    const query = parts.slice(1).join(' ');
    const results = tracker.search(query);
    const output =
      results.length === 0
        ? `No lessons matching "${query}"`
        : `Found ${results.length}:\n` +
          results.map(r => `  [${r.id}] ${r.category}: ${r.content}`).join('\n');
    return {
      handled: true,
      entry: { type: 'assistant', content: output, timestamp: new Date() },
    };
  }

  // Unknown sub-command → show help
  return {
    handled: true,
    entry: {
      type: 'assistant',
      content: 'Usage: /lessons [list|add <content>|search <query>|stats]',
      timestamp: new Date(),
    },
  };
}
