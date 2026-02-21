/**
 * buddy knowledge – Knowledge base CLI commands
 *
 * Subcommands:
 *   buddy knowledge list              – list all loaded knowledge entries
 *   buddy knowledge show <title>      – display a knowledge entry
 *   buddy knowledge add               – interactive: add a new entry
 *   buddy knowledge remove <title>    – remove a knowledge entry
 *   buddy knowledge search <query>    – search knowledge base
 *   buddy knowledge context           – show the full context block the agent would see
 */

import { Command } from 'commander';
import { getKnowledgeManager } from '../knowledge/knowledge-manager.js';

export function createKnowledgeCommand(): Command {
  const cmd = new Command('knowledge')
    .description('Manage agent knowledge bases (Knowledge.md files injected as agent context)');

  cmd
    .command('list')
    .description('List all loaded knowledge entries')
    .action(async () => {
      const km = getKnowledgeManager();
      await km.load();
      const entries = km.list();

      if (entries.length === 0) {
        console.log('No knowledge entries found.');
        console.log('');
        console.log('Add knowledge files to:');
        console.log('  ~/.codebuddy/knowledge/*.md    (global)');
        console.log('  .codebuddy/knowledge/*.md      (project)');
        console.log('  Knowledge.md                   (local quick-add)');
        return;
      }

      console.log(`\nKnowledge entries (${entries.length}):`);
      console.log('─'.repeat(60));
      for (const e of entries) {
        const tags = e.tags.length > 0 ? `  [${e.tags.join(', ')}]` : '';
        const scope = e.scope.length > 0 ? `  scope: ${e.scope.join(', ')}` : '';
        console.log(`  ${e.title}${tags}${scope}  (${e.source})`);
      }
    });

  cmd
    .command('show <title>')
    .description('Display a knowledge entry by title')
    .action(async (title: string) => {
      const km = getKnowledgeManager();
      await km.load();

      const entry = km.list().find(e =>
        e.title.toLowerCase() === title.toLowerCase()
      );

      if (!entry) {
        console.error(`❌ No knowledge entry found: "${title}"`);
        process.exit(1);
      }

      console.log(`\n# ${entry.title}`);
      console.log(`Source: ${entry.source}  |  Path: ${entry.path}`);
      if (entry.tags.length > 0) console.log(`Tags: ${entry.tags.join(', ')}`);
      if (entry.scope.length > 0) console.log(`Scope: ${entry.scope.join(', ')}`);
      console.log('\n' + entry.content);
    });

  cmd
    .command('search <query>')
    .description('Search knowledge base with keyword query')
    .option('-n, --limit <n>', 'Max results', '5')
    .action(async (query: string, opts) => {
      const km = getKnowledgeManager();
      await km.load();

      const results = km.search(query, parseInt(opts.limit, 10));

      if (results.length === 0) {
        console.log(`No matches for "${query}".`);
        return;
      }

      console.log(`\nSearch results for "${query}" (${results.length}):`);
      console.log('─'.repeat(60));
      for (const { entry, score, excerpt } of results) {
        console.log(`\n[${score.toFixed(2)}] ${entry.title} (${entry.source})`);
        console.log(excerpt.slice(0, 300));
      }
    });

  cmd
    .command('add')
    .description('Add a new knowledge entry (interactive)')
    .option('-t, --title <title>', 'Entry title')
    .option('-f, --file <file>', 'Read content from a file')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--scope <scope>', 'Comma-separated scope modes')
    .action(async (opts) => {
      const { createInterface } = await import('readline');

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> =>
        new Promise(resolve => rl.question(q, resolve));

      const title = opts.title || await ask('Title: ');
      const tags = opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : [];
      const scope = opts.scope ? opts.scope.split(',').map((s: string) => s.trim()) : [];

      let content: string;
      if (opts.file) {
        const { readFileSync } = await import('fs');
        content = readFileSync(opts.file, 'utf-8');
      } else {
        console.log('Content (end with a line containing only "---"):');
        const lines: string[] = [];
        for await (const line of rl) {
          if (line === '---') break;
          lines.push(line);
        }
        content = lines.join('\n');
      }

      rl.close();

      const km = getKnowledgeManager();
      const filePath = await km.add(title, content, tags, scope);
      console.log(`✅ Knowledge entry saved: ${filePath}`);
    });

  cmd
    .command('remove <title>')
    .description('Remove a knowledge entry by title')
    .action(async (title: string) => {
      const km = getKnowledgeManager();
      await km.load();
      const ok = await km.remove(title);

      if (!ok) {
        console.error(`❌ Could not remove "${title}" – not found or not removable.`);
        process.exit(1);
      }

      console.log(`✅ Removed knowledge entry: "${title}"`);
    });

  cmd
    .command('context')
    .description('Show the full knowledge context block the agent would receive')
    .option('-s, --scope <scope>', 'Filter by agent mode scope')
    .action(async (opts) => {
      const km = getKnowledgeManager();
      await km.load();

      const block = km.buildContextBlock({ scope: opts.scope });

      if (!block) {
        console.log('(no knowledge entries loaded)');
        return;
      }

      console.log(block);
    });

  return cmd;
}
