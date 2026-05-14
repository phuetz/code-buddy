/**
 * Channel -> A2A bridge.
 *
 * Listens to ChannelManager.onMessage and forwards inbound messages
 * (Telegram, Discord, Slack, ...) to the local A2A task router via an
 * HTTP self-call to /api/a2a/tasks/send. The result is sent back to the
 * originating channel as a reply.
 *
 * Why a self-call rather than a direct method invocation: the
 * A2AAgentClient is instantiated inside the route handler closure
 * (createA2AProtocolRoutes) and not exported as a singleton. A
 * loopback fetch keeps the protocol layer untouched and pays a
 * single-digit-ms cost per message — invisible against an LLM round-trip.
 *
 * @module server/channel-a2a-bridge
 */

import { logger } from '../utils/logger.js';
import type { BaseChannel, ChannelManager, InboundMessage } from '../channels/index.js';

export interface ChannelA2ABridgeOptions {
  /** Hub base URL, e.g. `http://127.0.0.1:3000`. No trailing slash required. */
  hubBaseUrl: string;
  /** ChannelManager singleton (or any compatible event source). */
  channelManager: ChannelManager;
  /** Skill ID used when the user sends a plain message (no command). */
  defaultSkill?: string;
  /** Agent key fallback if defaultSkill is not set. */
  defaultAgent?: string;
  /** metadata.model attached to every task. Hub-level hint, not propagated. */
  defaultModel?: string;
  /** Override fetch (used by tests). */
  fetchImpl?: typeof fetch;
  /** Optional auth headers for authenticated hub self-calls. */
  authHeaders?: Record<string, string> | (() => Record<string, string> | undefined);
  /** Hub call timeout. Default 60 s — long-context generation can be slow. */
  taskTimeoutMs?: number;
}

export interface ChannelA2ABridge {
  /** Best-effort detach. ChannelManager has no per-handler removal API today,
   * so this is mainly useful in tests via resetChannelManager(). */
  stop(): void;
}

const HELP_TEXT = [
  'Code Buddy A2A bridge — I forward your message to the fleet via the hub.',
  '',
  'Commands:',
  '  /help, /start          Show this message.',
  '  /skill <id> <text>     Route to a specific A2A skill (e.g. /skill ollama-qwen3-4b hello).',
  '  /agent <name> <text>   Route to a specific spoke (e.g. /agent ollama-darkstar hello).',
  '',
  'Plain text routes via the default skill picked by smart skill selection.',
].join('\n');

/**
 * Wire the bridge into a running ChannelManager.
 *
 * The bridge registers a single message handler. After this call, every
 * inbound message that passes the channel's allow-list is forwarded to the
 * hub's task router and the result is sent back as a reply.
 */
export function startChannelA2ABridge(opts: ChannelA2ABridgeOptions): ChannelA2ABridge {
  const fetchFn = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
  if (!fetchFn) {
    throw new Error('startChannelA2ABridge: no fetch implementation (Node 18+ or pass fetchImpl).');
  }
  const tasksUrl = `${opts.hubBaseUrl.replace(/\/+$/, '')}/api/a2a/tasks/send`;
  const timeoutMs = opts.taskTimeoutMs ?? 60_000;

  const handler = async (msg: InboundMessage, channel: BaseChannel): Promise<void> => {
    if (!channel.isUserAllowed(msg.sender.id)) {
      logger.warn('[channel-a2a-bridge] rejected unauthorized user', {
        channel: channel.type,
        userId: msg.sender.id,
        username: msg.sender.username,
      });
      return;
    }

    let skill: string | undefined = opts.defaultSkill;
    let agent: string | undefined = opts.defaultAgent;
    let text: string;

    if (msg.isCommand && msg.commandName) {
      const cmd = msg.commandName.toLowerCase();
      const args = msg.commandArgs ?? [];
      switch (cmd) {
        case 'help':
        case 'start':
          await replyText(channel, msg, HELP_TEXT);
          return;
        case 'skill': {
          if (args.length < 2) {
            await replyText(channel, msg, 'Usage: /skill <skill-id> <text>');
            return;
          }
          skill = args[0];
          agent = undefined;
          text = args.slice(1).join(' ');
          break;
        }
        case 'agent': {
          if (args.length < 2) {
            await replyText(channel, msg, 'Usage: /agent <agent-name> <text>');
            return;
          }
          skill = undefined;
          agent = args[0];
          text = args.slice(1).join(' ');
          break;
        }
        default:
          await replyText(channel, msg, `Unknown command /${cmd}. Try /help.`);
          return;
      }
    } else {
      text = msg.content;
      if (!text || !text.trim()) return;
    }

    const payload: Record<string, unknown> = {
      message: { role: 'user', parts: [{ type: 'text', text }] },
    };
    if (opts.defaultModel) payload.metadata = { model: opts.defaultModel };
    if (skill) payload.skill = skill;
    else if (agent) payload.agent = agent;
    else {
      await replyText(channel, msg, 'Bridge is misconfigured: no defaultSkill or defaultAgent set.');
      logger.error('[channel-a2a-bridge] no routing target configured');
      return;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let resp: Response;
    try {
      resp = await fetchFn(tasksUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...resolveAuthHeaders(opts.authHeaders),
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      logger.error('[channel-a2a-bridge] hub call failed', {
        channel: channel.type,
        error: err instanceof Error ? err.message : String(err),
        timeout: isTimeout,
      });
      await replyText(
        channel,
        msg,
        isTimeout
          ? `Hub timed out after ${Math.round(timeoutMs / 1000)}s. Try again or pick a faster skill / model.`
          : `Hub unreachable: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    clearTimeout(timer);

    let data: unknown;
    try {
      data = await resp.json();
    } catch {
      data = null;
    }

    if (!resp.ok || !data || typeof data !== 'object') {
      const reason = (data as { error?: string; message?: string } | null)?.error
        ?? (data as { error?: string; message?: string } | null)?.message
        ?? `HTTP ${resp.status}`;
      logger.warn('[channel-a2a-bridge] hub returned error', {
        channel: channel.type,
        status: resp.status,
        reason,
      });
      await replyText(channel, msg, `Hub error: ${reason}`);
      return;
    }

    const dataObj = data as {
      status?: string | { status?: string; message?: string };
      result?: unknown;
      error?: string;
    };
    const statusStr = typeof dataObj.status === 'string'
      ? dataObj.status
      : dataObj.status?.status;
    if (statusStr && /^(failed|error)$/i.test(statusStr)) {
      const reason = (typeof dataObj.status === 'object' && dataObj.status?.message)
        || dataObj.error
        || 'task failed without reason';
      await replyText(channel, msg, `Task failed: ${reason}`);
      return;
    }

    const result = typeof dataObj.result === 'string' ? dataObj.result : '';
    if (!result) {
      await replyText(channel, msg, '(empty reply from fleet)');
      return;
    }
    await replyText(channel, msg, result);
  };

  opts.channelManager.onMessage(handler);
  logger.info('[channel-a2a-bridge] active', {
    hubBaseUrl: opts.hubBaseUrl,
    defaultSkill: opts.defaultSkill,
    defaultAgent: opts.defaultAgent,
    defaultModel: opts.defaultModel,
  });

  return {
    stop(): void {
      // ChannelManager has no per-handler off() today; tests rely on
      // resetChannelManager() to wipe state. Production stops via the
      // manager's full shutdown() in stopServer(). This stop() is a
      // marker that exposes intent without touching private fields.
    },
  };
}

function resolveAuthHeaders(
  authHeaders: ChannelA2ABridgeOptions['authHeaders'],
): Record<string, string> {
  if (!authHeaders) return {};
  return typeof authHeaders === 'function' ? authHeaders() ?? {} : authHeaders;
}

async function replyText(channel: BaseChannel, msg: InboundMessage, content: string): Promise<void> {
  try {
    await channel.send({
      channelId: msg.channel.id,
      content,
      replyTo: msg.id,
    });
  } catch (err) {
    logger.error('[channel-a2a-bridge] channel.send failed', {
      channel: channel.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
