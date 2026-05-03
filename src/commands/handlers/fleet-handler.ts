/**
 * Fleet listener slash command handler — `/fleet` (Phase (d).5 + (d).6 V0.4.1).
 *
 * Closes the inter-Claude streaming loop started in (d).1: connects to a
 * peer Code Buddy's Gateway WebSocket, subscribes to fleet:* events, and
 * prints them live to the chat. Authentication uses the existing apiKey
 * path; the key must have the `fleet:listen` scope.
 *
 * Sub-actions:
 *   /fleet listen <ws-url> [--api-key <key>]
 *                  [--auto-reconnect [--max-attempts <n>]]
 *                                              Connect + start streaming.
 *                                              --auto-reconnect (Phase (d).6)
 *                                              keeps the listener alive
 *                                              across ws drops with
 *                                              exponential-backoff retry.
 *   /fleet stop                                 Disconnect (cancels any
 *                                              pending reconnect).
 *   /fleet status                               Show connection state +
 *                                              reconnect counter.
 *
 * Honest scope cuts (V0.4.1):
 * - Only ONE listener at a time (singleton). Multiple peer connections
 *   would need a fleet of fleets, V0.5+ if needed.
 * - apiKey can come from --api-key flag or CODEBUDDY_FLEET_API_KEY env;
 *   no TOML wiring yet (the rest of the codebase reads server keys from
 *   env, so this matches).
 */

import type { CommandHandlerResult } from './branch-handlers.js';
import { logger } from '../../utils/logger.js';

const HELP = `Usage: /fleet <action> [args]

Actions:
  listen <ws-url> [--api-key <key>]   Connect to a peer Code Buddy's WS
         [--auto-reconnect]           and stream fleet:* events live.
         [--max-attempts <n>]         Example: /fleet listen ws://100.98.18.76:3000/ws
                                      apiKey from --api-key flag or
                                      CODEBUDDY_FLEET_API_KEY env. Must
                                      have fleet:listen scope on the peer.
                                      --auto-reconnect (Phase (d).6) keeps
                                      the listener alive across ws drops.
                                      --max-attempts caps retry tries
                                      (default 5; only used with
                                      --auto-reconnect).
  stop                                Disconnect the active listener
                                      (cancels any pending reconnect).
  status                              Show whether a listener is active.

Phase (d).5 + (d).6 V0.4.1 — single listener at a time, opt-in
auto-reconnect with exponential backoff.`;

interface ActiveListener {
  url: string;
  startedAt: Date;
  eventCount: number;
  autoReconnect: boolean;
  // FleetListener instance kept as `unknown` so this module doesn't pull
  // in the ws import at handler-load time (matches lazy-import patterns).
  listener: {
    disconnect: () => Promise<void>;
    getReconnectAttempts: () => number;
    isReconnecting: () => boolean;
  };
}

let activeListener: ActiveListener | null = null;

function textResult(content: string): CommandHandlerResult {
  return {
    handled: true,
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}

interface ParsedListenArgs {
  url: string | null;
  apiKey: string | null;
  autoReconnect: boolean;
  maxAttempts: number | null;
}

function parseArgs(rest: string[]): ParsedListenArgs {
  let url: string | null = null;
  let apiKey: string | null = null;
  let autoReconnect = false;
  let maxAttempts: number | null = null;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--api-key' && i + 1 < rest.length) {
      apiKey = rest[i + 1];
      i++;
    } else if (arg === '--auto-reconnect') {
      autoReconnect = true;
    } else if (arg === '--max-attempts' && i + 1 < rest.length) {
      const n = parseInt(rest[i + 1], 10);
      if (Number.isFinite(n) && n > 0) maxAttempts = n;
      i++;
    } else if (!url && (arg.startsWith('ws://') || arg.startsWith('wss://'))) {
      url = arg;
    }
  }
  return { url, apiKey, autoReconnect, maxAttempts };
}

export async function handleFleet(args: string[]): Promise<CommandHandlerResult> {
  const action = (args[0] || 'status').trim().toLowerCase();
  const rest = args.slice(1);

  if (action === 'help' || action === '') {
    return textResult(HELP);
  }

  if (action === 'status') {
    if (!activeListener) {
      return textResult('No fleet listener active.\n\n' + HELP);
    }
    const elapsed = Math.round((Date.now() - activeListener.startedAt.getTime()) / 1000);
    let reconnectLine = '';
    if (activeListener.autoReconnect) {
      const attempts = activeListener.listener.getReconnectAttempts();
      const pending = activeListener.listener.isReconnecting();
      reconnectLine =
        `  Reconnect: enabled (` +
        `${attempts} attempt(s) since last connect` +
        `${pending ? ', retry pending' : ''})\n`;
    } else {
      reconnectLine = `  Reconnect: disabled\n`;
    }
    return textResult(
      `Fleet listener ACTIVE\n` +
        `  URL:     ${activeListener.url}\n` +
        `  Uptime:  ${elapsed}s\n` +
        `  Events:  ${activeListener.eventCount} received\n` +
        reconnectLine +
        `\nStop with /fleet stop.`,
    );
  }

  if (action === 'stop') {
    if (!activeListener) {
      return textResult('No fleet listener active to stop.');
    }
    const url = activeListener.url;
    const count = activeListener.eventCount;
    try {
      await activeListener.listener.disconnect();
    } catch (err) {
      logger.debug('Fleet listener disconnect error (ignored)', { error: String(err) });
    }
    activeListener = null;
    return textResult(`Fleet listener stopped. URL: ${url}\nReceived ${count} event(s) total.`);
  }

  if (action === 'listen') {
    if (activeListener) {
      return textResult(
        `Fleet listener already active for ${activeListener.url}.\n` +
          `Stop it first with /fleet stop, then re-issue /fleet listen.`,
      );
    }

    const { url, apiKey: cliKey, autoReconnect, maxAttempts } = parseArgs(rest);
    if (!url) {
      return textResult(
        'Usage: /fleet listen <ws-url> [--api-key <key>] [--auto-reconnect] [--max-attempts <n>]\n\n' + HELP,
      );
    }
    const apiKey = cliKey ?? process.env.CODEBUDDY_FLEET_API_KEY;
    if (!apiKey) {
      return textResult(
        'Error: no apiKey provided.\n' +
          'Pass --api-key <key> or set CODEBUDDY_FLEET_API_KEY env.\n' +
          'Key must have fleet:listen scope on the peer.',
      );
    }

    try {
      const { FleetListener } = await import('../../fleet/fleet-listener.js');
      const listener = new FleetListener({
        url,
        apiKey,
        autoReconnect,
        // Tighter default for /fleet listen than the manager's default (10):
        // a remote peer that drops 5 times in a row is probably gone.
        reconnect: autoReconnect ? { maxRetries: maxAttempts ?? 5 } : undefined,
      });
      const startedAt = new Date();
      let eventCount = 0;

      listener.on('fleet:event', (data: { type: string; payload: Record<string, unknown> }) => {
        eventCount++;
        if (activeListener) activeListener.eventCount = eventCount;
        const source = (data.payload?.source as { hostname?: string; agentId?: string } | undefined);
        const hostInfo = source ? ` [${source.hostname}${source.agentId ? `:${source.agentId.slice(0, 8)}` : ''}]` : '';
        // Direct stdout write for live streaming (same pattern as /agents).
        process.stdout.write(`  [fleet${hostInfo}] ${data.type}\n`);
      });

      listener.on('disconnected', () => {
        process.stdout.write(`  [fleet] disconnected from ${url}\n`);
        // Phase (d).6 — only clear the singleton when the listener is
        // really down. With auto-reconnect, a `disconnected` event is the
        // start of a retry cycle, not the end of the session — keep the
        // singleton so /fleet status still shows useful state and /fleet
        // listen rejects a parallel connect attempt.
        if (!autoReconnect) {
          activeListener = null;
        }
      });

      listener.on('error', (err: Error) => {
        process.stdout.write(`  [fleet] error: ${err.message}\n`);
      });

      // Phase (d).6 — reconnect lifecycle visibility.
      if (autoReconnect) {
        listener.on('reconnecting', (data: { attempt: number; delayMs: number }) => {
          process.stdout.write(
            `  [fleet] reconnect attempt ${data.attempt}/${maxAttempts ?? 5} in ${data.delayMs}ms\n`,
          );
        });
        listener.on('reconnected', (data: { attempt: number }) => {
          process.stdout.write(`  [fleet] reconnected after ${data.attempt} attempt(s)\n`);
        });
        listener.on('exhausted', (data: { totalAttempts: number }) => {
          process.stdout.write(
            `  [fleet] reconnect exhausted after ${data.totalAttempts} attempt(s) — listener stopped\n`,
          );
          activeListener = null;
        });
      }

      await listener.connect();
      activeListener = { url, startedAt, eventCount: 0, autoReconnect, listener };
      logger.info('Fleet listener started', { url, autoReconnect });
      const reconnectNote = autoReconnect
        ? ` Auto-reconnect enabled (max ${maxAttempts ?? 5} attempts).`
        : '';
      return textResult(
        `Fleet listener connected to ${url}.\n` +
          `Streaming fleet:* events live.${reconnectNote} Stop with /fleet stop.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return textResult(`Fleet listener connect failed: ${msg}`);
    }
  }

  return textResult(`Unknown fleet action: ${args[0]}\n\n${HELP}`);
}

/** Test reset hook. */
export function _resetFleetHandlerForTests(): void {
  if (activeListener) {
    activeListener.listener.disconnect().catch(() => { /* ignore */ });
  }
  activeListener = null;
}
