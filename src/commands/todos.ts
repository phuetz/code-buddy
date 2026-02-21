/**
 * `buddy todo` CLI command
 *
 * Manages the persistent todo.md task list (Manus AI attention bias pattern).
 * The same list is automatically injected at the end of every LLM context
 * turn to keep objectives in focus across long sessions.
 */

import { Command } from 'commander';
import { getTodoTracker } from '../agent/todo-tracker.js';
import type { TodoPriority, TodoStatus } from '../agent/todo-tracker.js';

export function createTodosCommand(): Command {
  const cmd = new Command('todo');
  cmd.description('Manage the persistent task list (todo.md) — injected into every agent turn');

  // list
  cmd
    .command('list')
    .alias('ls')
    .description('List all todo items')
    .option('--pending', 'Show only pending items')
    .action((opts) => {
      const tracker = getTodoTracker(process.cwd());
      tracker.load();
      const items = opts.pending ? tracker.getPending() : tracker.getAll();
      if (items.length === 0) {
        console.log('No items.');
        return;
      }
      const statusIcon: Record<TodoStatus, string> = {
        pending: '⬜',
        in_progress: '🔄',
        done: '✅',
        blocked: '🚫',
      };
      for (const item of items) {
        const icon = statusIcon[item.status];
        const prio = item.priority !== 'medium' ? ` [${item.priority}]` : '';
        console.log(`${icon} [${item.id}]${prio} ${item.text}`);
        for (const sub of item.subtasks) {
          console.log(`  ${statusIcon[sub.status]} ${sub.text}`);
        }
      }
    });

  // add
  cmd
    .command('add <text>')
    .description('Add a new todo item')
    .option('-p, --priority <priority>', 'Priority: high|medium|low', 'medium')
    .action((text, opts) => {
      const tracker = getTodoTracker(process.cwd());
      const item = tracker.add(text, opts.priority as TodoPriority);
      console.log(`Added [${item.id}]: ${item.text}`);
    });

  // done
  cmd
    .command('done <id>')
    .description('Mark an item as completed')
    .action((id) => {
      const tracker = getTodoTracker(process.cwd());
      const ok = tracker.complete(id);
      if (ok) console.log(`Marked done: ${id}`);
      else console.error(`Item not found: ${id}`);
    });

  // update
  cmd
    .command('update <id>')
    .description('Update an item')
    .option('-t, --text <text>', 'New text')
    .option('-s, --status <status>', 'New status: pending|in_progress|done|blocked')
    .option('-p, --priority <priority>', 'New priority: high|medium|low')
    .action((id, opts) => {
      const tracker = getTodoTracker(process.cwd());
      const ok = tracker.update(id, {
        text: opts.text,
        status: opts.status as TodoStatus | undefined,
        priority: opts.priority as TodoPriority | undefined,
      });
      if (ok) console.log(`Updated: ${id}`);
      else console.error(`Item not found: ${id}`);
    });

  // remove
  cmd
    .command('remove <id>')
    .alias('rm')
    .description('Remove an item')
    .action((id) => {
      const tracker = getTodoTracker(process.cwd());
      const ok = tracker.remove(id);
      if (ok) console.log(`Removed: ${id}`);
      else console.error(`Item not found: ${id}`);
    });

  // clear-done
  cmd
    .command('clear-done')
    .description('Remove all completed items')
    .action(() => {
      const tracker = getTodoTracker(process.cwd());
      const n = tracker.clearDone();
      console.log(`Cleared ${n} completed items.`);
    });

  // context
  cmd
    .command('context')
    .description('Preview the todo context block injected into each agent turn')
    .action(() => {
      const tracker = getTodoTracker(process.cwd());
      const block = tracker.buildContextSuffix();
      if (!block) console.log('No pending items — nothing to inject.');
      else console.log(block);
    });

  return cmd;
}
