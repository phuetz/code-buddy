/**
 * `buddy lessons` CLI command
 *
 * Manages the persistent lessons.md self-improvement loop.
 * Lessons are automatically injected before every LLM turn (before the
 * todo suffix) so the agent internalises learned patterns across sessions.
 *
 * Subcommands: list, add, search, graph, clear
 */

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import {
  getLessonsTracker,
  renderLessonConceptGraph,
  renderLessonConceptVaultFiles,
} from '../agent/lessons-tracker.js';
import type { LessonCategory, LessonGraphRenderFormat } from '../agent/lessons-tracker.js';
import { getLessonCandidateQueue } from '../agent/lesson-candidate-queue.js';
import type { LessonCandidate, LessonCandidateStatus } from '../agent/lesson-candidate-queue.js';

const VALID_CATEGORIES: LessonCategory[] = ['PATTERN', 'RULE', 'CONTEXT', 'INSIGHT'];
const VALID_CANDIDATE_STATUSES: LessonCandidateStatus[] = ['pending', 'approved', 'discarded'];

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

  // ---- graph ---------------------------------------------------------------
  cmd
    .command('graph')
    .description('Build a mini-Obsidian concept graph from lessons')
    .option('-q, --query <query>', 'Optional text filter before graphing')
    .option('--concept <concept>', 'Only graph lessons linked to a concept slug, label, wiki link, or Markdown target')
    .option('-c, --category <cat>', `Filter by category: ${VALID_CATEGORIES.join('|')}`)
    .option('-n, --limit <n>', 'Max lessons to graph', '50')
    .option('--json', 'Print full graph JSON')
    .option('--markdown', 'Print an Obsidian-friendly Markdown index')
    .option('--mermaid', 'Print Mermaid graph diagram')
    .option('--no-keywords', 'Exclude fallback keyword concepts and keep only explicit links, tags, context, and related metadata')
    .option('--graph-output <file>', 'Write graph output to a file')
    .option('--vault <dir>', 'Write an Obsidian-style lessons vault directory')
    .action((opts) => {
      const cat = opts.category?.toUpperCase() as LessonCategory | undefined;
      if (cat && !VALID_CATEGORIES.includes(cat)) {
        console.error(`Invalid category: ${cat}`);
        process.exit(1);
      }
      const limit = parseInt(opts.limit, 10) || 50;
      const tracker = getLessonsTracker(process.cwd());
      const graph = tracker.buildConceptGraph({
        query: opts.query,
        concept: opts.concept,
        category: cat,
        includeKeywords: opts.keywords !== false,
        limit,
      });
      const format: LessonGraphRenderFormat = opts.json
        ? 'json'
        : opts.markdown
          ? 'markdown'
          : opts.mermaid
            ? 'mermaid'
            : inferGraphOutputFormat(opts.graphOutput);
      const output = renderLessonConceptGraph(graph, format);

      if (opts.vault) {
        const files = renderLessonConceptVaultFiles(graph);
        writeLessonVault(opts.vault, files);
        console.log(`Lessons vault exported to ${opts.vault} (${files.length} files)`);
        return;
      }

      if (opts.graphOutput) {
        const outputDir = path.dirname(path.resolve(opts.graphOutput));
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(opts.graphOutput, output, 'utf-8');
        console.log(`Graph exported to ${opts.graphOutput}`);
        return;
      }

      console.log(output);
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

  // ---- provenance ----------------------------------------------------------
  cmd
    .command('provenance <lessonId>')
    .description('Show what created a lesson and which runs have used it')
    .option('--json', 'Output JSON')
    .action(async (lessonId: string, opts: { json?: boolean }) => {
      const { getLessonProvenanceIndex } = await import('../agent/lesson-provenance.js');
      const record = getLessonProvenanceIndex(process.cwd()).getProvenance(lessonId);

      if (opts.json) {
        console.log(JSON.stringify(record ?? { lessonId, createdBy: undefined, usedBy: [] }, null, 2));
        return;
      }

      if (!record) {
        console.log(`No provenance recorded for lesson ${lessonId}.`);
        return;
      }
      console.log(`\nProvenance for lesson ${lessonId}`);
      if (record.createdBy) {
        const c = record.createdBy;
        const parts = [
          c.runId ? `run ${c.runId}` : null,
          c.outcomeId ? `outcome ${c.outcomeId}` : null,
          c.sagaId ? `saga ${c.sagaId}` : null,
        ].filter(Boolean).join(', ');
        console.log(`  Created by: ${parts || '(unknown)'}${c.note ? ` — ${c.note}` : ''}`);
        console.log(`              at ${new Date(c.at).toISOString()}`);
      } else {
        console.log('  Created by: (not recorded)');
      }
      console.log(`  Used by (${record.usedBy.length} run(s)):`);
      for (const usage of record.usedBy.slice(-20)) {
        console.log(`    - ${usage.runId}  ${new Date(usage.at).toISOString()}`);
      }
      console.log('');
    });

  // ---- use (record that a run loaded a lesson) -----------------------------
  cmd
    .command('use <lessonId>')
    .description('Record that a run loaded a lesson (used-by provenance)')
    .requiredOption('--run <runId>', 'The run that used the lesson')
    .action(async (lessonId: string, opts: { run: string }) => {
      const { getLessonProvenanceIndex } = await import('../agent/lesson-provenance.js');
      getLessonProvenanceIndex(process.cwd()).recordUsage(lessonId, opts.run);
      console.log(`Recorded usage: lesson ${lessonId} used by run ${opts.run}`);
    });

  // ---- candidate (review queue, Hermes parity item 7) ----------------------
  cmd.addCommand(createLessonCandidateCommand());

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

/**
 * `buddy lessons candidate ...` — review queue for proposed lessons.
 *
 * The agent (or a human) PROPOSES lessons here; nothing is written into
 * lessons.md until a reviewer explicitly approves a candidate. This is the
 * "no silent procedural memory mutation" guarantee from the Hermes learning
 * loop (parity TODO item 7).
 */
function createLessonCandidateCommand(): Command {
  const cmd = new Command('candidate');
  cmd.alias('candidates');
  cmd.description('Review queue for proposed lessons (approve/edit/discard before they reach lessons.md)');

  cmd
    .command('propose <content>')
    .description('Propose a lesson candidate (does NOT write lessons.md)')
    .option('-c, --category <cat>', `Category: ${VALID_CATEGORIES.join('|')}`, 'INSIGHT')
    .option('--context <ctx>', 'Optional domain context (e.g. TypeScript, React)')
    .option('--run <runId>', 'Originating run id for provenance')
    .option('--note <note>', 'Free-form provenance note')
    .option('--json', 'Output JSON')
    .action((content: string, opts: { category: string; context?: string; json?: boolean; run?: string; note?: string }) => {
      const cat = opts.category.toUpperCase() as LessonCategory;
      if (!VALID_CATEGORIES.includes(cat)) {
        console.error(`Invalid category: ${cat}. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
        process.exit(1);
      }
      try {
        const queue = getLessonCandidateQueue(process.cwd());
        const { candidate, existingLesson, deduped, alreadyRecorded } = queue.propose({
          category: cat,
          content,
          ...(opts.context ? { context: opts.context } : {}),
          source: 'manual',
          ...(opts.run || opts.note
            ? { provenance: { ...(opts.run ? { runId: opts.run } : {}), ...(opts.note ? { note: opts.note } : {}) } }
            : {}),
        });
        const reviewCommand = candidate
          ? `buddy lessons candidate approve ${candidate.id} --by <name>`
          : undefined;
        if (opts.json) {
          console.log(JSON.stringify({
            candidate,
            existingLesson,
            deduped,
            alreadyRecorded,
            ...(reviewCommand ? { reviewCommand } : {}),
          }, null, 2));
          return;
        }
        if (alreadyRecorded && existingLesson) {
          console.log(
            `Lesson already recorded [${existingLesson.id}] (${existingLesson.category}): ` +
            existingLesson.content,
          );
          console.log('No new review candidate was created.');
          return;
        }
        if (!candidate || !reviewCommand) {
          console.log('No new review candidate was created.');
          return;
        }
        const prefix = deduped ? 'Matched existing pending candidate' : 'Proposed candidate';
        console.log(`${prefix} [${candidate.id}] (${candidate.category}): ${candidate.content}`);
        console.log('Approve it with: ' + reviewCommand);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  cmd
    .command('list')
    .alias('ls')
    .description('List lesson candidates, optionally filtered by status')
    .option('-s, --status <status>', `Filter: ${VALID_CANDIDATE_STATUSES.join('|')}`)
    .option('--json', 'Output JSON')
    .action((opts: { status?: string; json?: boolean }) => {
      const status = opts.status?.toLowerCase() as LessonCandidateStatus | undefined;
      if (status && !VALID_CANDIDATE_STATUSES.includes(status)) {
        console.error(`Invalid status: ${status}. Must be one of: ${VALID_CANDIDATE_STATUSES.join(', ')}`);
        process.exit(1);
      }
      const queue = getLessonCandidateQueue(process.cwd());
      const items = queue.list(status);
      if (opts.json) {
        console.log(JSON.stringify(items, null, 2));
        return;
      }
      if (items.length === 0) {
        console.log(status ? `No ${status} lesson candidates.` : 'No lesson candidates yet.');
        return;
      }
      for (const item of items) {
        console.log(formatCandidateLine(item));
      }
    });

  cmd
    .command('show <id>')
    .description('Show a single lesson candidate')
    .option('--json', 'Output JSON')
    .action((id: string, opts: { json?: boolean }) => {
      const candidate = getLessonCandidateQueue(process.cwd()).get(id);
      if (!candidate) {
        console.error(`Lesson candidate not found: ${id}`);
        process.exit(1);
        return;
      }
      if (opts.json) {
        console.log(JSON.stringify(candidate, null, 2));
        return;
      }
      console.log(formatCandidateLine(candidate));
      if (candidate.context) console.log(`  context: ${candidate.context}`);
      if (candidate.provenance) console.log(`  provenance: ${JSON.stringify(candidate.provenance)}`);
      if (candidate.reviewedBy) console.log(`  reviewed by: ${candidate.reviewedBy}`);
      if (candidate.reviewNote) console.log(`  review note: ${candidate.reviewNote}`);
      if (candidate.approvedLessonId) console.log(`  approved lesson: ${candidate.approvedLessonId}`);
    });

  cmd
    .command('approve <id>')
    .description('Approve a candidate — writes it into lessons.md (requires a reviewer)')
    .requiredOption('--by <name>', 'Human reviewer approving the candidate')
    .option('--content <content>', 'Edit the lesson content before writing')
    .option('-c, --category <cat>', `Override category: ${VALID_CATEGORIES.join('|')}`)
    .option('--context <ctx>', 'Override domain context')
    .option('--note <note>', 'Reviewer note')
    .action(async (
      id: string,
      opts: { by: string; content?: string; category?: string; context?: string; note?: string },
    ) => {
      const cat = opts.category?.toUpperCase() as LessonCategory | undefined;
      if (cat && !VALID_CATEGORIES.includes(cat)) {
        console.error(`Invalid category: ${cat}. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
        process.exit(1);
      }
      try {
        const queue = getLessonCandidateQueue(process.cwd());
        const { candidate, lesson } = await queue.approve(id, {
          reviewedBy: opts.by,
          ...(opts.content ? { content: opts.content } : {}),
          ...(cat ? { category: cat } : {}),
          ...(opts.context !== undefined ? { context: opts.context } : {}),
          ...(opts.note ? { reviewNote: opts.note } : {}),
        });
        console.log(`Approved candidate ${candidate.id} → lesson [${lesson.id}] (${lesson.category}): ${lesson.content}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  cmd
    .command('discard <id>')
    .description('Discard a candidate (it will never reach lessons.md)')
    .option('--by <name>', 'Reviewer discarding the candidate')
    .option('--reason <reason>', 'Why it was discarded')
    .action((id: string, opts: { by?: string; reason?: string }) => {
      try {
        const candidate = getLessonCandidateQueue(process.cwd()).discard(id, {
          ...(opts.by ? { reviewedBy: opts.by } : {}),
          ...(opts.reason ? { reason: opts.reason } : {}),
        });
        console.log(`Discarded candidate ${candidate.id}.`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  return cmd;
}

function formatCandidateLine(item: LessonCandidate): string {
  const ctx = item.context ? ` (${item.context})` : '';
  const date = new Date(item.createdAt).toISOString().slice(0, 10);
  return `[${item.id}] ${item.status.toUpperCase()} ${item.category}${ctx}: ${item.content}  — ${date}`;
}

function inferGraphOutputFormat(outputPath?: string): LessonGraphRenderFormat {
  if (!outputPath) return 'summary';

  const ext = path.extname(outputPath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.mmd' || ext === '.mermaid') return 'mermaid';
  return 'summary';
}

function writeLessonVault(root: string, files: { path: string; content: string }[]): void {
  const rootPath = path.resolve(root);
  fs.mkdirSync(rootPath, { recursive: true });

  for (const file of files) {
    const target = path.resolve(rootPath, file.path);
    if (target !== rootPath && !target.startsWith(rootPath + path.sep)) {
      throw new Error(`Refusing to write outside vault: ${file.path}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.content, 'utf-8');
  }
}
