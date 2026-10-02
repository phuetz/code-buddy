/**
 * Proxy Command
 *
 * `buddy proxy` starts a minimal HTTP server that exposes Code Buddy's
 * existing OpenAI-compatible chat-completions surface so third-party clients
 * (OpenAI SDK, LangChain, LiteLLM, etc.) can talk to Code Buddy as if it were
 * an OpenAI endpoint. This is parity with `hermes proxy` upstream.
 *
 * It reuses the production server bootstrap (`startServer`) but disables the
 * fleet WebSocket mesh and inbound channel intake — the proxy is HTTP-only and
 * scoped to the OpenAI-compatible routes that the chat router already serves at
 * both `/v1/chat/completions` and `/api/chat/completions`.
 *
 * Usage:
 *   buddy proxy
 *   buddy proxy --port 8080 --host 127.0.0.1
 *   buddy proxy --json
 */

import { isIP } from 'node:net';
import type { Command } from 'commander';
import { logger } from '../../utils/logger.js';

const DEFAULT_PROXY_PORT = 8787;
const DEFAULT_PROXY_HOST = '127.0.0.1';

interface ProxyCommandOptions {
  port: string;
  host: string;
  allowUnauthenticatedNetworkAccess?: boolean;
  auth?: boolean;
  json?: boolean;
}

interface ProxyStartupInfo {
  baseUrl: string;
  openaiEndpoint: string;
  legacyEndpoint: string;
  modelsEndpoint: string;
  host: string;
  port: number;
  authEnabled: boolean;
}

function buildStartupInfo(baseUrl: string, host: string, port: number, authEnabled: boolean): ProxyStartupInfo {
  return {
    baseUrl,
    openaiEndpoint: `${baseUrl}/v1/chat/completions`,
    legacyEndpoint: `${baseUrl}/api/chat/completions`,
    modelsEndpoint: `${baseUrl}/v1/models`,
    host,
    port,
    authEnabled,
  };
}

function printStartupInfo(info: ProxyStartupInfo, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  console.log('\nCode Buddy OpenAI-compatible proxy');
  console.log(`  Listening:  ${info.baseUrl}`);
  console.log(`  Chat (v1):  ${info.openaiEndpoint}`);
  console.log(`  Chat (api): ${info.legacyEndpoint}`);
  console.log(`  Models:     ${info.modelsEndpoint}`);
  console.log(`  Auth:       ${info.authEnabled ? 'enabled (JWT)' : 'disabled'}`);
  console.log('\nPoint an OpenAI SDK at the base URL above (e.g. baseURL=' + info.baseUrl + '/v1).');
  console.log('Press Ctrl+C to stop.\n');
}

export function registerProxyCommands(program: Command): void {
  program
    .command('proxy')
    .description('Start an OpenAI-compatible HTTP proxy in front of Code Buddy (for third-party clients)')
    .option('--port <port>', 'proxy port', String(DEFAULT_PROXY_PORT))
    .option('--host <host>', 'proxy host', DEFAULT_PROXY_HOST)
    .option('--no-auth', 'disable JWT authentication (loopback dev only)')
    .option('--allow-unauthenticated-network-access', 'explicitly allow network clients without JWT authentication (unsafe)')
    .option('--json', 'print startup info as JSON')
    .action(async (options: ProxyCommandOptions) => {
      const port = Number.parseInt(options.port, 10);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        logger.error(`Invalid proxy port: ${options.port}`);
        process.exit(1);
        return;
      }
      const host = options.host || DEFAULT_PROXY_HOST;
      const authEnabled = options.auth !== false;
      const loopback = host === 'localhost' || host === '::1'
        || (isIP(host) === 4 && host.startsWith('127.'));
      if (!authEnabled && !loopback && !options.allowUnauthenticatedNetworkAccess) {
        logger.error(
          `Refusing proxy --no-auth on non-loopback host ${host}. ` +
          'Use a loopback address, enable authentication, or explicitly pass --allow-unauthenticated-network-access.',
        );
        process.exit(1);
        return;
      }

      const { startServer } = await import('../../server/index.js');
      try {
        const { server, config } = await startServer({
          port,
          host,
          authEnabled,
          // OpenAI-compat HTTP proxy only: no fleet WS mesh, no channel intake.
          websocketEnabled: false,
          channelIntakeEnabled: false,
        });

        const { getServerBaseUrl } = await import('../../server/index.js');
        const baseUrl = getServerBaseUrl(server, config);
        const info = buildStartupInfo(baseUrl, host, config.port, config.authEnabled);

        logger.info(`OpenAI-compatible proxy started on ${baseUrl}`);
        printStartupInfo(info, options.json === true);
      } catch (error) {
        logger.error(
          'Failed to start proxy',
          error instanceof Error ? error : new Error(String(error))
        );
        process.exit(1);
      }
    });
}
