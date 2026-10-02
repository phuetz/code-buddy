/**
 * `buddy acp` — run Code Buddy as an ACP (Agent Client Protocol) agent over
 * stdio, so editors like Zed can spawn it as an agent subprocess.
 *
 * Zed config example (`~/.config/zed/settings.json`):
 *   "agent_servers": {
 *     "Code Buddy": { "type": "custom", "command": "buddy", "args": ["acp"] }
 *   }
 *
 * stdout is reserved for the newline-delimited JSON-RPC protocol channel; all
 * logging goes to stderr (the logger already writes via console.error, and we
 * drop its level to `error` here as belt-and-suspenders).
 */

import type { Command } from 'commander';
import {
  AcpStdioServer,
  type AcpPromptRunner,
} from '../../protocols/acp/acp-stdio-server.js';

export function registerAcpCommand(program: Command): void {
  program
    .command('acp')
    .description('Run Code Buddy as an ACP (Agent Client Protocol) agent over stdio for editor integration (e.g. Zed)')
    .action(async () => {
      const { logger } = await import('../../utils/logger.js');
      logger.setLevel('error'); // keep stdout clean for the protocol channel

      const { detectProviderFromEnv } = await import('../../utils/provider-detector.js');
      const { createAcpAgenticRunner } = await import('../../protocols/acp/acp-agentic-runner.js');

      const detected = detectProviderFromEnv();
      const agenticRunner = detected
        ? createAcpAgenticRunner({ apiKey: detected.apiKey, baseURL: detected.baseURL, model: detected.defaultModel })
        : null;

      const promptRunner: AcpPromptRunner = async (ctx) => {
        if (!agenticRunner) {
          ctx.sendUpdate({
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: 'No LLM provider is configured. Set a provider key (e.g. GROK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY) or run `buddy login`.',
            },
          });
          return { stopReason: 'refusal' };
        }
        return agenticRunner(ctx);
      };

      const server = new AcpStdioServer({ promptRunner });
      server.start();

      // Drain accepted requests, responses and atomic session writes at EOF.
      const shutdown = async (): Promise<void> => {
        server.stop();
        await server.whenIdle();
        await agenticRunner?.dispose();
        process.exit(0);
      };
      process.stdin.once('end', () => { void shutdown(); });
    });
}
