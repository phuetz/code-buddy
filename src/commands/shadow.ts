/** Diagnostic CLI for the speculative shadow workspace. */

import { Command } from 'commander';
import { ShadowWorkspace } from '../speculative/shadow-workspace.js';

interface ShadowStatusOptions {
  directory?: string;
}

interface ShadowDirectoryOptions {
  directory?: string;
}

export function createShadowCommand(): Command {
  const command = new Command('shadow')
    .description('Inspect or run speculative validation in the persistent shadow worktree');

  command
    .command('status')
    .description('Show shadow worktree state and effective configuration')
    .option('-d, --directory <dir>', 'repository directory to inspect')
    .action(async (options: ShadowStatusOptions) => {
      const status = await new ShadowWorkspace(options.directory ?? process.cwd()).getStatus();
      console.log(`Enabled: ${status.enabled ? 'yes' : 'no'}`);
      console.log(`Repository: ${status.repoRoot ?? status.repoPath}`);
      console.log(`Shadow: ${status.shadowPath ?? 'unavailable'}`);
      console.log(`Created: ${status.exists ? 'yes' : 'no'}`);
      console.log(`Validator: ${status.command ?? 'inactive'}`);
      console.log(`Timeout: ${status.timeoutMs}ms`);
      if (status.detail) console.log(`Detail: ${status.detail}`);
    });

  command
    .command('run')
    .description('Validate the current working tree changes in the shadow worktree')
    .option('-d, --directory <dir>', 'repository directory to validate')
    .action(async (options: ShadowDirectoryOptions) => {
      const result = await new ShadowWorkspace(options.directory ?? process.cwd()).runWorkingTree();
      if (result.unavailable) {
        console.error(`Shadow unavailable: ${result.stdoutTail}`);
        process.exitCode = 2;
        return;
      }
      const state = result.ok ? 'passed' : 'failed';
      const cached = result.cached ? ' (cached)' : '';
      console.log(`Shadow validation ${state}${cached} in ${result.durationMs}ms (exit ${String(result.exitCode)})`);
      if (result.stdoutTail) console.log(result.stdoutTail);
      if (!result.ok) process.exitCode = 1;
    });

  command
    .command('list')
    .description('List persistent shadow worktrees')
    .option('-d, --directory <dir>', 'repository directory whose shadow store to inspect')
    .action(async (options: ShadowDirectoryOptions) => {
      const workspace = new ShadowWorkspace(options.directory ?? process.cwd());
      const entries = await workspace.list();
      if (entries.length === 0) {
        console.log('No shadow worktrees.');
        return;
      }
      for (const entry of entries) {
        const repo = entry.repoRoot ?? 'unknown repository';
        const state = entry.exists ? 'present' : 'missing';
        console.log(`${entry.hash}\t${state}\t${repo}\t${entry.shadowPath}`);
      }
    });

  command
    .command('clean')
    .description('Remove the persistent shadow worktree for a repository')
    .option('-d, --directory <dir>', 'repository directory whose shadow to remove')
    .action(async (options: ShadowDirectoryOptions) => {
      const result = await new ShadowWorkspace(options.directory ?? process.cwd()).clean();
      if (!result.removed) {
        console.log(`Nothing to clean${result.shadowPath ? `: ${result.shadowPath}` : ''}${result.detail ? ` (${result.detail})` : ''}.`);
        return;
      }
      console.log(`Removed shadow ${result.shadowPath}`);
    });

  return command;
}
