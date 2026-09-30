/**
 * CodeExplorer CLI commands
 *
 * Exposes commands to consult CodeExplorer and push session summaries.
 */

import type { Command } from 'commander';
import { CodeExplorerTool } from '../../tools/code-explorer-tool.js';

export function registerCodeExplorerCommands(program: Command): void {
  const codeExplorerCmd = program
    .command('code-explorer')
    .description('Interact with CodeExplorer for code understanding and session syncing');

  codeExplorerCmd    .command('ask')
    .description('Consult CodeExplorer for a query or code understanding request')
    .argument('<query>', 'The query or task description to ask CodeExplorer about')
    .action(async (query: string) => {
      const { initializeMCPServers, getMCPManager } = await import('../../codebuddy/tools.js');
      try {
        if (process.env.CODEBUDDY_DISABLE_MCP !== 'true') await initializeMCPServers();
        const codeExplorer = new CodeExplorerTool();
        const result = await codeExplorer.ask(query);
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error('Error querying CodeExplorer:', error);
        process.exitCode = 1;
      } finally {
        await getMCPManager().dispose();
      }
    });

  codeExplorerCmd    .command('push-session')
    .description('Push the session summary to CodeExplorer as technical memory')
    .argument('<summary>', 'The session summary to push')
    .action(async (summary: string) => {
      try {
        const codeExplorer = new CodeExplorerTool();
        const result = await codeExplorer.pushSession(summary);
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error('Error pushing session to CodeExplorer:', error);
        process.exit(1);
      }
    });
}
