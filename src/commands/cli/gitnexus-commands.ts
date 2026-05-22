/**
 * GitNexus CLI commands
 *
 * Exposes commands to consult GitNexus and push session summaries.
 */

import type { Command } from 'commander';
import { GitNexusTool } from '../../tools/gitnexus-tool.js';

export function registerGitNexusCommands(program: Command): void {
  const gitnexus = program
    .command('gitnexus')
    .description('Interact with GitNexus for code understanding and session syncing');

  gitnexus
    .command('ask')
    .description('Consult GitNexus for a query or code understanding request')
    .argument('<query>', 'The query or task description to ask GitNexus about')
    .action(async (query: string) => {
      try {
        const gitNexus = new GitNexusTool();
        const result = await gitNexus.ask(query);
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error('Error querying GitNexus:', error);
        process.exit(1);
      }
    });

  gitnexus
    .command('push-session')
    .description('Push the session summary to GitNexus as technical memory')
    .argument('<summary>', 'The session summary to push')
    .action(async (summary: string) => {
      try {
        const gitNexus = new GitNexusTool();
        const result = await gitNexus.pushSession(summary);
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error('Error pushing session to GitNexus:', error);
        process.exit(1);
      }
    });
}
