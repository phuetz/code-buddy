/**
 * `buddy lessons` CLI command
 *
 * Manages the persistent lessons.md self-improvement loop.
 * Lessons are automatically injected before every LLM turn (before the
 * todo suffix) so the agent internalises learned patterns across sessions.
 *
 * Subcommands: list, add, search, clear
 */

import * as fs from 'fs';
import { Command } from 'commander';
import { getLessonsTracker } from '../agent/lessons-tracker.js';
import type { LessonCategory } from '../agent/lessons-tracker.js';

const VALID_CATEGORIES: LessonCategory[] = ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'];

export function createLessonsCommand(): Command {
  const cmd = new Command('lessons');
  cmd.description(
    'Manage lessons learned (self-improvement loop) — injected into every agent turn'
  );

  // ---- list ----------------------------------------------------------------
  cmd
    .command('list')
    .alias('ls')
    .description('List all lessons, optionally filtered by category')
    .option('-c, --category <cat>', `Filter by category: ${VALID_CATEGORIES.join('|')}`)
    .action((opts) => {
      const cat = opts.category?.toUpperCase() as LessonCategory | undefined;
      if (cat && !VALID_CATEGORIES.includes(cat)) {
        console.error(`Invalid category: ${cat}. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
        process.exit(1);
      }
      const tracker = getLessonsTracker(process.cwd());
      const items = tracker.list(cat);
      if (items.length === 0) {
        console.log('No lessons recorded yet.');
        return;
      }
      // Group by category for readability
      const grouped = new Map<LessonCategory, typeof items>();
      for (const item of items) {
        const arr = grouped.get(item.category) ?? [];
        arr.push(item);
        grouped.set(item.category, arr);
      }
      for (const category of VALID_CATEGORIES) {
        const catItems = grouped.get(category);
        if (!catItems || catItems.length === 0) continue;
        console.log(`\n## ${category}`);
        for (const item of catItems) {
          const ctx = item.context ? ` (${item.context})` : '';
          const date = new Date(item.createdAt).toISOString().slice(0, 10);
          console.log(`  [${item.id}]${ctx} ${item.content}  — ${date} ${item.source}`);
        }
      }
    });

  // ---- add -----------------------------------------------------------------
  cmd
    .command('add <content>')
    .description('Add a new lesson')
    .option('-c, --category <cat>', `Category: ${VALID_CATEGORIES.join('|')}`, 'INSIGHT')
    .option('--context <ctx>', 'Optional domain context (e.g. TypeScript, React)')
    .action((content, opts) => {
      const cat = opts.category.toUpperCase() as LessonCategory;
      if (!VALID_CATEGORIES.includes(cat)) {
        console.error(`Invalid category: ${cat}. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
        process.exit(1);
      }
      const tracker = getLessonsTracker(process.cwd());
      const item = tracker.add(cat, content, 'manual', opts.context);
      console.log(`Added [${item.id}] (${item.category}): ${item.content}`);
    });

  // ---- search --------------------------------------------------------------
  cmd
    .command('search <query>')
    .description('Search lessons by keyword')
    .option('-c, --category <cat>', `Filter by category: ${VALID_CATEGORIES.join('|')}`)
    .option('-n, --limit <n>', 'Max results', '10')
    .action((query, opts) => {
      const cat = opts.category?.toUpperCase() as LessonCategory | undefined;
      if (cat && !VALID_CATEGORIES.includes(cat)) {
        console.error(`Invalid category: ${cat}`);
        process.exit(1);
      }
      const limit = parseInt(opts.limit, 10) || 10;
      const tracker = getLessonsTracker(process.cwd());
      const results = tracker.search(query, cat).slice(0, limit);
      if (results.length === 0) {
        console.log(`No lessons found matching "${query}".`);
        return;
      }
      console.log(`Found ${results.length} lesson(s) matching "${query}":\n`);
      for (const item of results) {
        const ctx = item.context ? ` (${item.context})` : '';
        console.log(`  [${item.id}] ${item.category}${ctx}: ${item.content}`);
      }
    });

  // ---- clear ---------------------------------------------------------------
  cmd
    .command('clear')
    .description('Remove lessons (all or by category)')
    .option('-c, --category <cat>', `Remove only this category: ${VALID_CATEGORIES.join('|')}`)
    .option('-y, --yes', 'Skip confirmation prompt')
    .action((opts) => {
      const cat = opts.category?.toUpperCase() as LessonCategory | undefined;
      if (cat && !VALID_CATEGORIES.includes(cat)) {
        console.error(`Invalid category: ${cat}`);
        process.exit(1);
      }
      if (!opts.yes) {
        const target = cat ? `category ${cat}` : 'ALL lessons';
        console.log(`This will remove ${target}. Pass --yes to confirm.`);
        return;
      }
      const tracker = getLessonsTracker(process.cwd());
      const n = tracker.clearByCategory(cat);
      console.log(`Cleared ${n} lesson(s)${cat ? ` in category ${cat}` : ''}.`);
    });

  // ---- context (preview) ---------------------------------------------------
  cmd
    .command('context')
    .description('Preview the lessons context block injected into each agent turn')
    .action(() => {
      const tracker = getLessonsTracker(process.cwd());
      const block = tracker.buildContextBlock();
      if (!block) console.log('No lessons — nothing to inject.');
      else console.log(block);
    });

  // ---- stats ---------------------------------------------------------------
  cmd
    .command('stats')
    .description('Show statistics about recorded lessons')
    .action(() => {
      const tracker = getLessonsTracker(process.cwd());
      const stats = tracker.getStats();
      console.log(`Total: ${stats.total}`);
      for (const cat of VALID_CATEGORIES) {
        console.log(`  ${cat}: ${stats.byCategory[cat] ?? 0}`);
      }
      if (stats.oldestAt) console.log(`Oldest: ${new Date(stats.oldestAt).toISOString().slice(0, 10)}`);
      if (stats.newestAt) console.log(`Newest: ${new Date(stats.newestAt).toISOString().slice(0, 10)}`);
    });

  // ---- export --------------------------------------------------------------
  cmd
    .command('export')
    .description('Export lessons to stdout or a file')
    .option('-f, --format <fmt>', 'Output format: md|json|csv', 'md')
    .option('-o, --output <file>', 'Write to file instead of stdout')
    .action((opts) => {
      const fmt = (opts.format as 'md' | 'json' | 'csv') || 'md';
      if (!['md', 'json', 'csv'].includes(fmt)) {
        console.error(`Invalid format: ${fmt}. Must be one of: md, json, csv`);
        process.exit(1);
      }
      const tracker = getLessonsTracker(process.cwd());
      const content = tracker.export(fmt);
      if (opts.output) {
        fs.writeFileSync(opts.output, content, 'utf-8');
        console.log(`Exported to ${opts.output}`);
      } else {
        console.log(content);
      }
    });

  // ---- decay ---------------------------------------------------------------
  cmd
    .command('decay')
    .description('Remove old INSIGHT lessons past their age limit')
    .option('-d, --days <n>', 'Max age in days for INSIGHT lessons', '90')
    .option('--dry-run', 'Show what would be removed without deleting')
    .action((opts) => {
      const maxAge = parseInt(opts.days, 10) || 90;
      const tracker = getLessonsTracker(process.cwd());
      if (opts.dryRun) {
        const threshold = Date.now() - maxAge * 86_400_000;
        const toRemove = tracker.list('INSIGHT').filter(i => i.createdAt > 0 && i.createdAt < threshold);
        console.log(`Would remove ${toRemove.length} INSIGHT lesson(s) older than ${maxAge} days.`);
      } else {
        const n = tracker.autoDecay(maxAge);
        console.log(`Removed ${n} expired INSIGHT lesson(s).`);
      }
    });

  return cmd;
}
