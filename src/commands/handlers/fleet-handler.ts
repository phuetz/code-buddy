/**
 * Fleet listener slash command handler — `/fleet` (Phase (d).5 → (d).12 V0.4.1).
 *
 * Closes the inter-Claude streaming loop started in (d).1: connects to a
 * peer Code Buddy's Gateway WebSocket, subscribes to fleet:* events, and
 * prints them live to the chat. Authentication uses the existing apiKey
 * path; the key must have the `fleet:listen` scope.
 *
 * Sub-actions:
 *   /fleet listen <ws-url> [--api-key <key>] [--name <id>]
 *                  [--auto-reconnect [--max-attempts <n>]]
 *                                              Connect + start streaming.
 *                                              --name (Phase (d).12) gives
 *                                              the peer a stable id; default
 *                                              is derived from the WS host.
 *                                              --auto-reconnect (Phase (d).6)
 *                                              keeps the listener alive
 *                                              across ws drops with
 *                                              exponential-backoff retry.
 *   /fleet stop [name|--all]                    Disconnect a peer (or all).
 *                                              Defaults to the only active
 *                                              listener when there's one.
 *   /fleet status                               Show all connected peers.
 *   /fleet history [N] [--peer <name>]          Show last N fleet:* events
 *                                              from one peer (or the only
 *                                              one if not specified).
 *
 * Phase (d).12 — multi-peer fan-in: a single Claude can now hold N
 * simultaneous /fleet listen sessions to different peers, each with its
 * own auto-reconnect, presence beacon, compaction state and event ring.
 *
 * Honest scope cuts (V0.4.1):
 * - apiKey can come from --api-key flag or CODEBUDDY_FLEET_API_KEY env;
 *   no TOML wiring yet (the rest of the codebase reads server keys from
 *   env, so this matches).
 * - Routing actif (sending tasks to peers) is Phase (d).13.
 */

import type { CommandHandlerResult } from './branch-handlers.js';
import { logger } from '../../utils/logger.js';
import {
  getFleetRegistry,
  type ActiveListenerEntry,
} from '../../fleet/fleet-registry.js';

const HELP = `Usage: /fleet <action> [args]

Actions:
  listen <ws-url> [--api-key <key>]   Connect to a peer Code Buddy's WS
         [--name <id>]                and stream fleet:* events live.
         [--auto-reconnect]           Example: /fleet listen ws://100.98.18.76:3000/ws
         [--max-attempts <n>]         apiKey from --api-key flag or
                                      CODEBUDDY_FLEET_API_KEY env. Must
                                      have fleet:listen scope on the peer.
                                      --name (d).12 gives the peer a stable
                                      id; default derived from the WS host.
                                      --auto-reconnect (d).6 keeps the
                                      listener alive across ws drops.
                                      --max-attempts caps retry tries
                                      (default 5; with --auto-reconnect).
  stop [name|--all]                   Disconnect a peer (or all). Defaults
                                      to the only active listener when one.
  status [--with-sessions]            Show all connected peers + their state.
                                      --with-sessions fans out peer.chat-session.list
                                      to each peer (in parallel, 5s timeout) and
                                      prints the open chat sessions per peer.
  history [N] [--peer <name>]         Show last N fleet:* events from one
            [--type <glob>] [--json]   peer (default 20, caps at ring size).
                                      --type filters by event-type glob
                                      (e.g. "fleet:agent:tool*"). --json
                                      emits raw event records as JSON
                                      for pipe-to-jq workflows.
  send <peer> <method> [json-params]  (Phase (d).13) Invoke a peer RPC
            [--timeout <ms>]          method synchronously and print the
                                      response. Method names are dotted,
                                      e.g. "peer.describe" / "peer.ping" /
                                      "peer.echo". The peer's apiKey must
                                      have peer:invoke scope. Default
                                      timeout is 30000ms.
  tool <peer> <name> [json-args]      (Phase (d).23 / V1.3) UX wrapper
            [--timeout <ms>]          around peer.tool.invoke for the
            [--stream]                read-only allowlist {view_file,
                                      list_directory, search}. With
                                      --stream, prints peer:chunk frames
                                      live (uses peer.tool.invoke.stream).
                                      Example: /fleet tool darkstar
                                      view_file {"file_path":"README.md"}
  chat start <peer>                   (V1.2.1) UX wrapper around
       [--system "<prompt>"]          peer.chat-session.* — opens a
       [--model <id>]                 multi-turn session with stable alias
       [--name <alias>]               so you don't have to copy sessionId
                                      between turns.
  chat say <message>                  Send the next user turn. Uses the
       [--session <alias>]            single active session, the last
                                      started one, or --session override.
  chat end [<alias>] | --all          Close one (or all) chat sessions.
  chat list                           Show open chat sessions.
  autonomous status                   (Phase (d).18) Show Autonomous Fleet
            tick-now                  Protocol v0.1 config + state. tick-now
                                      fires a one-shot tick (pull, claim a
                                      task, run, log, push). Configured via
                                      TOML [autonomous_fleet].

Phase (d).5 → (d).18 — multi-peer fan-in, opt-in auto-reconnect,
presence beacon, compaction notices, in-memory event history, active peer
RPC routing, autonomous task claim/exec loop.`;

/**
 * The `ActiveListenerEntry` interface (formerly local `ActiveListener`)
 * + the `Map<string, ActiveListenerEntry>` registry both live in
 * `src/fleet/fleet-registry.ts` since Phase (d).17, so the LLM-facing
 * `peer_delegate` and `list_peers` tools can read peer state without
 * depending on this command-handler module. Behaviour unchanged.
 */
type ActiveListener = ActiveListenerEntry;

/** Default count rendered by `/fleet history` when no N supplied. */
const HISTORY_DEFAULT_COUNT = 20;

/** Stale threshold for /fleet status `⚠ stale` flag (Phase (d).9). */
const STALE_THRESHOLD_MS = 90_000;

function textResult(content: string): CommandHandlerResult {
  return {
    handled: true,
    entry: { type: 'assistant', content, timestamp: new Date() },
  };
}

const OSC_SEQUENCE_RE = /\x1B\][\s\S]*?(?:\x07|\x1B\\)/g;
const ANSI_SEQUENCE_RE = /[\x1B\x9B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\x07)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const UNSAFE_CONTROL_RE = /[\x00-\x08\x0B\x0C\x0D\x0E-\x1F\x7F]/g;

function sanitizePeerToolOutput(content: string): string {
  return content
    .replace(OSC_SEQUENCE_RE, '')
    .replace(ANSI_SEQUENCE_RE, '')
    .replace(UNSAFE_CONTROL_RE, '');
}

interface ParsedListenArgs {
  url: string | null;
  apiKey: string | null;
  name: string | null;
  autoReconnect: boolean;
  maxAttempts: number | null;
}

interface ParsedStopArgs {
  name: string | null;
  all: boolean;
}

interface ParsedHistoryArgs {
  count: number | null;
  peer: string | null;
  /** Glob-ish filter on event `type` (e.g. `fleet:agent:tool*`). */
  type: string | null;
  /** `true` when `--json` was passed — render as JSON array instead of text. */
  json: boolean;
}

/**
 * Phase (d).11 — format the time portion of a history line as HH:mm:ss.
 * Uses local timezone (matches the user's terminal display).
 */
function formatHistoryTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Phase (d).11 — render a one-line summary of a fleet event payload,
 * keyed off the event type. Goal: make /fleet history scannable at a
 * glance without forcing the reader to dig into the JSON.
 */
function summarizeHistoryPayload(
  type: string,
  payload: Record<string, unknown>,
): string {
  if (type === 'fleet:peer:heartbeat') return '(heartbeat)';
  if (type === 'fleet:peer:compacting:start') return '(compacting started)';
  if (type === 'fleet:peer:compacting:complete') {
    const strategy = typeof payload.strategy === 'string' ? payload.strategy : 'unknown';
    const dur = typeof payload.durationMs === 'number' ? `${payload.durationMs}ms` : 'n/a';
    return `(compacted: ${strategy} ${dur})`;
  }
  if (type.startsWith('fleet:agent:tool')) {
    const tool = typeof payload.toolName === 'string'
      ? payload.toolName
      : typeof payload.tool === 'string'
        ? payload.tool
        : 'unknown';
    return `tool=${tool}`;
  }
  if (type.startsWith('fleet:workflow:')) {
    const wid = typeof payload.workflowId === 'string' ? payload.workflowId : 'unknown';
    return `workflowId=${wid}`;
  }
  if (type.startsWith('fleet:session:')) {
    const child =
      typeof payload.childSessionId === 'string' ? payload.childSessionId :
      typeof payload.sessionId === 'string' ? payload.sessionId :
      'unknown';
    return `child=${child}`;
  }
  // Fallback: stringify and clip. Excludes the `source` key (already
  // rendered in the source column).
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k !== 'source') filtered[k] = v;
  }
  const json = JSON.stringify(filtered);
  return json.length > 60 ? json.slice(0, 57) + '...' : json;
}

/** Phase (d).11 — render the source column "[hostname:agentShort]" or "" when unknown. */
function formatHistorySource(record: { hostname?: string; agentId?: string }): string {
  if (!record.hostname && !record.agentId) return '';
  const host = record.hostname ?? '?';
  const agent = record.agentId ? `:${record.agentId.slice(0, 8)}` : '';
  return ` [${host}${agent}]`;
}

/**
 * Phase (d).12 — derive a default peer id from the WS URL (host:port).
 * `ws://100.98.18.76:3000/ws` → `100-98-18-76:3000` (dots → dashes for
 * easier shell typing in /fleet stop / --peer).
 */
function deriveDefaultPeerId(url: string): string {
  try {
    const u = new URL(url);
    return u.host.replace(/\./g, '-');
  } catch {
    return `peer-${Date.now()}`;
  }
}

function parseArgs(rest: string[]): ParsedListenArgs {
  let url: string | null = null;
  let apiKey: string | null = null;
  let name: string | null = null;
  let autoReconnect = false;
  let maxAttempts: number | null = null;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--api-key' && i + 1 < rest.length) {
      apiKey = rest[i + 1];
      i++;
    } else if (arg === '--name' && i + 1 < rest.length) {
      name = rest[i + 1];
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
  return { url, apiKey, name, autoReconnect, maxAttempts };
}

function parseStopArgs(rest: string[]): ParsedStopArgs {
  let name: string | null = null;
  let all = false;
  for (const arg of rest) {
    if (arg === '--all') all = true;
    else if (!name && !arg.startsWith('--')) name = arg;
  }
  return { name, all };
}

function parseHistoryArgs(rest: string[]): ParsedHistoryArgs {
  let count: number | null = null;
  let peer: string | null = null;
  let type: string | null = null;
  let json = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--peer' && i + 1 < rest.length) {
      peer = rest[i + 1];
      i++;
    } else if (arg === '--type' && i + 1 < rest.length) {
      type = rest[i + 1];
      i++;
    } else if (arg === '--json') {
      json = true;
    } else if (count === null && !arg.startsWith('--')) {
      const n = parseInt(arg, 10);
      if (Number.isFinite(n) && n > 0) count = n;
    }
  }
  return { count, peer, type, json };
}

/**
 * Compile a glob-ish event-type filter (e.g. `fleet:agent:tool*`) to
 * a RegExp. Only `*` is special — everything else is escaped. `*`
 * matches any run of non-empty characters except newline, which is
 * what users expect from a CLI glob.
 */
function compileTypeFilter(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const regex = escaped.replace(/\*/g, '.*');
  return new RegExp('^' + regex + '$');
}

/**
 * Phase (d).12 — render one peer block for /fleet status.
 * Reused logic from the V0.4.1 single-peer status; output now stacks
 * one block per active peer.
 */
function formatPeerStatus(p: ActiveListener): string {
  const elapsed = Math.round((Date.now() - p.startedAt.getTime()) / 1000);
  const lines: string[] = [];
  lines.push(`Peer "${p.id}"`);
  lines.push(`  URL:     ${p.url}`);
  lines.push(`  Uptime:  ${elapsed}s`);
  lines.push(`  Events:  ${p.eventCount} received`);
  if (p.autoReconnect) {
    const attempts = p.listener.getReconnectAttempts();
    const pending = p.listener.isReconnecting();
    lines.push(
      `  Reconnect: enabled (${attempts}/${p.maxAttempts} attempts since last connect` +
        `${pending ? ', retry pending' : ''})`,
    );
  } else {
    lines.push('  Reconnect: disabled');
  }
  // Presence
  const seen = p.listener.getLastSeen();
  if (seen.at === null) {
    lines.push('  Last seen: never (no events received yet)');
  } else {
    const ageSec = Math.round((seen.ageMs ?? 0) / 1000);
    const reason = seen.reason ?? 'unknown';
    const stale = p.listener.isStale(STALE_THRESHOLD_MS);
    const prefix = stale ? `  ⚠ stale (>${STALE_THRESHOLD_MS / 1000}s) — ` : '  ';
    lines.push(`${prefix}Last seen: ${ageSec}s ago (${reason})`);
  }
  // Compaction
  const compactionState = p.listener.getPeerCompactionState();
  if (compactionState.active) {
    const ageSec = Math.round((compactionState.ageMs ?? 0) / 1000);
    lines.push(`  ⏸ Peer compacting (started ${ageSec}s ago, in progress)`);
  } else if (compactionState.lastResult) {
    const r = compactionState.lastResult;
    const saved =
      typeof r.originalTokens === 'number' && typeof r.compactedTokens === 'number'
        ? r.originalTokens - r.compactedTokens
        : null;
    const strategyTxt = r.strategy ?? 'unknown';
    const durTxt = typeof r.durationMs === 'number' ? `${r.durationMs}ms` : 'n/a';
    const savedTxt = saved !== null ? ` (saved ${saved} tokens)` : '';
    lines.push(`  Last compaction: ${strategyTxt} in ${durTxt}${savedTxt}`);
  }
  return lines.join('\n');
}

/**
 * Phase (d).12 — pick a default peer when /fleet stop / history is given
 * without a name and there's exactly one listener active. Returns null
 * when 0 or >1 listeners (caller must error / require name).
 */
function pickDefaultPeer(): ActiveListener | null {
  const reg = getFleetRegistry();
  if (reg.size() !== 1) return null;
  return reg.list()[0] ?? null;
}

// ──────────────────────────────────────────────────────────────────
// V1.2.1 — `/fleet chat` slash helper
// ──────────────────────────────────────────────────────────────────

/**
 * Local handle around a `peer.chat-session.*` session. The serverside
 * sessionId is opaque (`sess_…`) and gets re-quoted in every continue;
 * we keep a user-friendly alias on top so people don't have to copy it.
 */
/** Shape of one entry returned by peer.chat-session.list on the wire.
 *  Metadata only — never includes prompt/assistant content. */
interface ChatSessionSummary {
  sessionId: string;
  turnCount: number;
  model?: string;
  ageMs: number;
  idleMs: number;
  expiresInMs: number;
}

interface ChatSessionRef {
  alias: string;
  peerName: string;
  sessionId: string;
  systemPrompt?: string;
  model?: string;
  turnCount: number;
  startedAt: number;
  lastUsedAt: number;
}

/** Module-level state. Mirror of `dispatchedTasks` in peer-chat-bridge. */
const chatSessions: Map<string, ChatSessionRef> = new Map();
let activeAlias: string | null = null;

/** Test-only — reset state between cases. Not exported in the index. */
export function _resetChatSessionsForTests(): void {
  chatSessions.clear();
  activeAlias = null;
}

function deriveDefaultAlias(peerName: string): string {
  let n = 1;
  while (chatSessions.has(`${peerName}-${n}`)) n++;
  return `${peerName}-${n}`;
}

interface ParsedChatStartArgs {
  peerName: string | null;
  systemPrompt: string | null;
  model: string | null;
  alias: string | null;
}

function parseChatStartArgs(rest: string[]): ParsedChatStartArgs {
  let peerName: string | null = null;
  let systemPrompt: string | null = null;
  let model: string | null = null;
  let alias: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if ((arg === '--system' || arg === '--system-prompt') && i + 1 < rest.length) {
      systemPrompt = rest[i + 1];
      i++;
    } else if (arg === '--model' && i + 1 < rest.length) {
      model = rest[i + 1];
      i++;
    } else if (arg === '--name' && i + 1 < rest.length) {
      alias = rest[i + 1];
      i++;
    } else if (!peerName) {
      peerName = arg;
    }
  }
  return { peerName, systemPrompt, model, alias };
}

interface ParsedChatSayArgs {
  message: string;
  alias: string | null;
}

function parseChatSayArgs(rest: string[]): ParsedChatSayArgs {
  let alias: string | null = null;
  const messageParts: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--session' && i + 1 < rest.length) {
      alias = rest[i + 1];
      i++;
    } else {
      messageParts.push(arg);
    }
  }
  return { message: messageParts.join(' ').trim(), alias };
}

/**
 * Resolve which chat session a `say`/`end` command targets. Returns
 * either the alias or null + an error message when ambiguity prevents
 * a unique pick. Order: explicit `--session`, single existing, last
 * `start` (`activeAlias`).
 */
function resolveChatAlias(explicit: string | null): { alias: string | null; error: string | null } {
  if (explicit) {
    if (!chatSessions.has(explicit)) {
      return {
        alias: null,
        error: `No chat session named "${explicit}". Active: ${[...chatSessions.keys()].join(', ') || '(none)'}`,
      };
    }
    return { alias: explicit, error: null };
  }
  if (chatSessions.size === 0) {
    return { alias: null, error: 'No active chat sessions. Open one with /fleet chat start <peer>.' };
  }
  if (chatSessions.size === 1) {
    return { alias: [...chatSessions.keys()][0], error: null };
  }
  if (activeAlias && chatSessions.has(activeAlias)) {
    return { alias: activeAlias, error: null };
  }
  return {
    alias: null,
    error: `Multiple chat sessions active (${chatSessions.size}). Specify --session <alias>. Active: ${[...chatSessions.keys()].join(', ')}`,
  };
}

function formatRelativeAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h`;
}

/**
 * Drop any chat sessions tied to a peer that's been stopped. Called
 * from the `stop` branch right after `unregister`. The peer's
 * connection is gone so we can't politely `peer.chat-session.end` —
 * server-side sessions will idle out within 30 min anyway.
 */
function purgeChatSessionsForPeer(peerName: string): number {
  let dropped = 0;
  for (const [alias, ref] of chatSessions) {
    if (ref.peerName === peerName) {
      chatSessions.delete(alias);
      dropped++;
      if (activeAlias === alias) activeAlias = null;
    }
  }
  if (!activeAlias && chatSessions.size > 0) {
    activeAlias = [...chatSessions.keys()][chatSessions.size - 1] ?? null;
  }
  return dropped;
}

async function handleChat(rest: string[]): Promise<CommandHandlerResult> {
  const sub = (rest[0] || 'list').trim().toLowerCase();
  const inner = rest.slice(1);

  if (sub === 'list') {
    if (chatSessions.size === 0) {
      return textResult('No active chat sessions. Open one with /fleet chat start <peer>.');
    }
    const lines: string[] = [];
    lines.push(`Active chat sessions (${chatSessions.size}):`);
    const now = Date.now();
    for (const ref of chatSessions.values()) {
      const age = formatRelativeAge(now - ref.lastUsedAt);
      const modelTxt = ref.model ? `model ${ref.model}` : 'default model';
      const isActive = ref.alias === activeAlias ? '   ← active' : '';
      lines.push(
        `  ${ref.alias.padEnd(20)} → ${ref.peerName.padEnd(18)} [turn ${ref.turnCount}, ${age} ago, ${modelTxt}]${isActive}`,
      );
    }
    return textResult(lines.join('\n'));
  }

  if (sub === 'start') {
    const { peerName, systemPrompt, model, alias: explicitAlias } = parseChatStartArgs(inner);
    if (!peerName) {
      return textResult(
        'Usage: /fleet chat start <peer> [--system "<prompt>"] [--model <id>] [--name <alias>]',
      );
    }
    const target = getFleetRegistry().get(peerName);
    if (!target) {
      return textResult(
        `No fleet peer named "${peerName}". Active peers: ${getFleetRegistry().ids().join(', ') || '(none — /fleet listen first)'}`,
      );
    }
    const alias = explicitAlias ?? deriveDefaultAlias(peerName);
    if (chatSessions.has(alias)) {
      return textResult(
        `Chat alias "${alias}" already in use. End it first with /fleet chat end ${alias}, or pick another --name.`,
      );
    }
    const params: Record<string, unknown> = {};
    if (systemPrompt) params.systemPrompt = systemPrompt;
    if (model) params.model = model;

    try {
      const result = (await target.listener.request('peer.chat-session.start', params, {
        timeoutMs: 30_000,
      })) as { sessionId?: string };
      const sessionId = result?.sessionId;
      if (typeof sessionId !== 'string' || !sessionId) {
        return textResult(
          `Peer "${peerName}" → peer.chat-session.start returned no sessionId. Got: ${JSON.stringify(result)}`,
        );
      }
      const now = Date.now();
      chatSessions.set(alias, {
        alias,
        peerName,
        sessionId,
        systemPrompt: systemPrompt ?? undefined,
        model: model ?? undefined,
        turnCount: 0,
        startedAt: now,
        lastUsedAt: now,
      });
      activeAlias = alias;
      const sidShort = sessionId.length > 14 ? `${sessionId.slice(0, 14)}…` : sessionId;
      return textResult(
        `Chat session "${alias}" opened with ${peerName} (sessionId=${sidShort}). ` +
          `Send turns with /fleet chat say <message>.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Peer "${peerName}" → peer.chat-session.start FAILED:\n  ${message}`);
    }
  }

  if (sub === 'say' || sub === 'send') {
    const { message, alias: explicitAlias } = parseChatSayArgs(inner);
    if (!message) {
      return textResult('Usage: /fleet chat say <message> [--session <alias>]');
    }
    const { alias, error } = resolveChatAlias(explicitAlias);
    if (!alias) {
      return textResult(error ?? 'Unable to resolve chat session.');
    }
    const ref = chatSessions.get(alias)!;
    const target = getFleetRegistry().get(ref.peerName);
    if (!target) {
      // Peer disconnected behind our back. Drop the local handle.
      chatSessions.delete(alias);
      if (activeAlias === alias) activeAlias = null;
      return textResult(
        `Peer "${ref.peerName}" is no longer connected. Chat session "${alias}" dropped locally.`,
      );
    }
    try {
      const t0 = Date.now();
      const result = (await target.listener.request(
        'peer.chat-session.continue',
        { sessionId: ref.sessionId, prompt: message },
        { timeoutMs: 120_000 },
      )) as { text?: string };
      const elapsed = Date.now() - t0;
      ref.turnCount++;
      ref.lastUsedAt = Date.now();
      activeAlias = alias;
      const text = result?.text ?? '';
      return textResult(
        `← ${alias} (${ref.peerName}) [turn ${ref.turnCount}, ${elapsed}ms]:\n${text}`,
      );
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      // Server-side TTL or alias drift — drop our local handle so the
      // user sees the error once and can restart cleanly.
      if (messageText.includes('SESSION_NOT_FOUND') || messageText.includes('SESSION_EXPIRED')) {
        chatSessions.delete(alias);
        if (activeAlias === alias) activeAlias = null;
        return textResult(
          `Chat session "${alias}" expired or was dropped on ${ref.peerName}. ` +
            `Reopen with /fleet chat start ${ref.peerName} (--name ${alias}).`,
        );
      }
      return textResult(`Peer "${ref.peerName}" → peer.chat-session.continue FAILED:\n  ${messageText}`);
    }
  }

  if (sub === 'end') {
    const all = inner.includes('--all');
    if (all) {
      let closed = 0;
      const failures: string[] = [];
      for (const ref of [...chatSessions.values()]) {
        const target = getFleetRegistry().get(ref.peerName);
        if (target) {
          try {
            await target.listener.request(
              'peer.chat-session.end',
              { sessionId: ref.sessionId },
              { timeoutMs: 5_000 },
            );
          } catch (err) {
            failures.push(`${ref.alias}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        chatSessions.delete(ref.alias);
        closed++;
      }
      activeAlias = null;
      const failTxt = failures.length > 0 ? ` (${failures.length} server-side close failure(s) — sessions will TTL out)` : '';
      return textResult(`Closed ${closed} chat session(s)${failTxt}.`);
    }

    const explicitAlias = inner.find((a) => !a.startsWith('--')) ?? null;
    const { alias, error } = resolveChatAlias(explicitAlias);
    if (!alias) {
      return textResult(error ?? 'Unable to resolve chat session.');
    }
    const ref = chatSessions.get(alias)!;
    const target = getFleetRegistry().get(ref.peerName);
    let serverWarn = '';
    if (target) {
      try {
        await target.listener.request(
          'peer.chat-session.end',
          { sessionId: ref.sessionId },
          { timeoutMs: 5_000 },
        );
      } catch (err) {
        serverWarn = ` (server-side close failed: ${err instanceof Error ? err.message : String(err)} — session will TTL out)`;
      }
    }
    chatSessions.delete(alias);
    if (activeAlias === alias) {
      activeAlias = chatSessions.size > 0 ? [...chatSessions.keys()][chatSessions.size - 1] : null;
    }
    return textResult(`Chat session "${alias}" closed${serverWarn}.`);
  }

  return textResult(
    `Unknown chat sub-action: ${sub}\n` +
      `Usage: /fleet chat (start|say|end|list) ...\n` +
      `  start <peer> [--system <s>] [--model <m>] [--name <alias>]\n` +
      `  say <message> [--session <alias>]\n` +
      `  end [<alias>] | --all\n` +
      `  list`,
  );
}

export async function handleFleet(args: string[]): Promise<CommandHandlerResult> {
  const action = (args[0] || 'status').trim().toLowerCase();
  const rest = args.slice(1);

  if (action === 'help' || action === '') {
    return textResult(HELP);
  }

  if (action === 'status') {
    if (getFleetRegistry().size() === 0) {
      return textResult('No fleet listeners active.\n\n' + HELP);
    }
    const withSessions = rest.includes('--with-sessions');
    const blocks: string[] = [];
    blocks.push(`Fleet listeners — ${getFleetRegistry().size()} active`);
    blocks.push('');

    // When --with-sessions, fetch peer.chat-session.list from each peer
    // in parallel so the slowest peer doesn't serialise the whole
    // status command. Best-effort: a failing peer just gets a short
    // "(unreachable)" note instead of a session list.
    const sessionsByPeer = new Map<string, ChatSessionSummary[] | { error: string }>();
    if (withSessions) {
      await Promise.all(
        getFleetRegistry().list().map(async (peer) => {
          try {
            const result = await peer.listener.request(
              'peer.chat-session.list',
              {},
              { timeoutMs: 5_000 },
            );
            const payload = result as { sessions?: ChatSessionSummary[] };
            sessionsByPeer.set(peer.id, payload?.sessions ?? []);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            sessionsByPeer.set(peer.id, { error: message });
          }
        }),
      );
    }

    for (const peer of getFleetRegistry().list()) {
      blocks.push(formatPeerStatus(peer));
      if (withSessions) {
        const entry = sessionsByPeer.get(peer.id);
        if (entry && 'error' in entry) {
          blocks.push(`  Chat sessions: (unreachable — ${entry.error})`);
        } else if (entry && entry.length > 0) {
          blocks.push(`  Chat sessions (${entry.length}):`);
          for (const s of entry) {
            const modelTxt = s.model ? `model ${s.model}` : 'default model';
            blocks.push(
              `    ${s.sessionId.padEnd(22)} turn ${String(s.turnCount).padEnd(2)} ` +
                `idle ${formatRelativeAge(s.idleMs)}  ${modelTxt}`,
            );
          }
        } else {
          blocks.push('  Chat sessions: (none open on this peer)');
        }
      }
      blocks.push('');
    }
    blocks.push('Stop a peer with /fleet stop <name>, or all with /fleet stop --all.');
    return textResult(blocks.join('\n'));
  }

  if (action === 'stop') {
    if (getFleetRegistry().size() === 0) {
      return textResult('No fleet listeners active to stop.');
    }
    const { name, all } = parseStopArgs(rest);
    if (all) {
      const stopped: string[] = [];
      let chatPurged = 0;
      for (const peer of getFleetRegistry().list()) {
        try {
          await peer.listener.disconnect();
        } catch (err) {
          logger.debug('Fleet listener disconnect error (ignored)', { error: String(err) });
        }
        getFleetRegistry().unregister(peer.id);
        chatPurged += purgeChatSessionsForPeer(peer.id);
        stopped.push(`${peer.id} (${peer.eventCount} event(s))`);
      }
      const chatTxt = chatPurged > 0 ? ` Dropped ${chatPurged} chat session(s).` : '';
      return textResult(`Fleet stopped ${stopped.length} listener(s): ${stopped.join(', ')}.${chatTxt}`);
    }
    let target: ActiveListener | null = null;
    if (name) {
      target = getFleetRegistry().get(name) ?? null;
      if (!target) {
        return textResult(
          `No fleet peer named "${name}". Active peers: ${getFleetRegistry().ids().join(', ')}`,
        );
      }
    } else {
      target = pickDefaultPeer();
      if (!target) {
        return textResult(
          `Multiple fleet listeners active (${getFleetRegistry().size()}). ` +
            `Specify a peer name or use --all. Active: ${getFleetRegistry().ids().join(', ')}`,
        );
      }
    }
    const url = target.url;
    const count = target.eventCount;
    const id = target.id;
    try {
      await target.listener.disconnect();
    } catch (err) {
      logger.debug('Fleet listener disconnect error (ignored)', { error: String(err) });
    }
    getFleetRegistry().unregister(id);
    const chatPurged = purgeChatSessionsForPeer(id);
    const chatTxt = chatPurged > 0 ? `\nDropped ${chatPurged} chat session(s) tied to "${id}".` : '';
    return textResult(`Fleet listener "${id}" stopped. URL: ${url}\nReceived ${count} event(s) total.${chatTxt}`);
  }

  if (action === 'listen') {
    const { url, apiKey: cliKey, name: explicitName, autoReconnect, maxAttempts } = parseArgs(rest);
    if (!url) {
      return textResult(
        'Usage: /fleet listen <ws-url> [--api-key <key>] [--name <id>] [--auto-reconnect] [--max-attempts <n>]\n\n' + HELP,
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

    const peerId = explicitName ?? deriveDefaultPeerId(url);
    if (getFleetRegistry().has(peerId)) {
      return textResult(
        `Fleet peer "${peerId}" is already active for ${getFleetRegistry().get(peerId)!.url}. ` +
          `Stop it first with /fleet stop ${peerId}, then re-issue /fleet listen, ` +
          `or pick a different --name.`,
      );
    }

    try {
      const { FleetListener } = await import('../../fleet/fleet-listener.js');
      const cap = maxAttempts ?? 5;
      const listener = new FleetListener({
        url,
        apiKey,
        autoReconnect,
        reconnect: autoReconnect ? { maxRetries: cap } : undefined,
      });
      const startedAt = new Date();

      // Phase (d).12 — wire stdout streaming with the peer id in the prefix
      // so multi-peer output stays distinguishable when interleaved.
      listener.on('fleet:event', (data: { type: string; payload: Record<string, unknown> }) => {
        const peer = getFleetRegistry().get(peerId);
        if (peer) peer.eventCount++;
        const source = data.payload?.source as { hostname?: string; agentId?: string } | undefined;
        const hostInfo = source ? ` [${source.hostname}${source.agentId ? `:${source.agentId.slice(0, 8)}` : ''}]` : '';
        process.stdout.write(`  [fleet:${peerId}${hostInfo}] ${data.type}\n`);
      });

      listener.on('disconnected', () => {
        process.stdout.write(`  [fleet:${peerId}] disconnected from ${url}\n`);
        // Without auto-reconnect, the disconnected event marks the end of
        // the session — clear the registry entry. With auto-reconnect,
        // disconnected starts a retry cycle, so we keep the entry.
        if (!autoReconnect) {
          getFleetRegistry().unregister(peerId);
        }
      });

      listener.on('error', (err: Error) => {
        process.stdout.write(`  [fleet:${peerId}] error: ${err.message}\n`);
      });

      if (autoReconnect) {
        listener.on('reconnecting', (data: { attempt: number; delayMs: number }) => {
          process.stdout.write(
            `  [fleet:${peerId}] reconnect attempt ${data.attempt}/${cap} in ${data.delayMs}ms\n`,
          );
        });
        listener.on('reconnected', (data: { attempt: number }) => {
          process.stdout.write(`  [fleet:${peerId}] reconnected after ${data.attempt} attempt(s)\n`);
        });
        listener.on('exhausted', (data: { totalAttempts: number }) => {
          process.stdout.write(
            `  [fleet:${peerId}] reconnect exhausted after ${data.totalAttempts} attempt(s) — listener stopped\n`,
          );
          getFleetRegistry().unregister(peerId);
        });
      }

      await listener.connect();
      getFleetRegistry().register({
        id: peerId,
        url,
        startedAt,
        eventCount: 0,
        autoReconnect,
        maxAttempts: cap,
        listener,
      });
      logger.info('Fleet listener started', { id: peerId, url, autoReconnect });
      const reconnectNote = autoReconnect
        ? ` Auto-reconnect enabled (max ${cap} attempts).`
        : '';
      return textResult(
        `Fleet peer "${peerId}" connected to ${url}.\n` +
          `Streaming fleet:* events live.${reconnectNote} ` +
          `Stop with /fleet stop ${peerId}.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return textResult(`Fleet listener connect failed: ${msg}`);
    }
  }

  if (action === 'history') {
    if (getFleetRegistry().size() === 0) {
      return textResult('No fleet listeners active.\n\n' + HELP);
    }
    const { count, peer: peerName, type: typeFilter, json } = parseHistoryArgs(rest);
    const n = count ?? HISTORY_DEFAULT_COUNT;

    let target: ActiveListener | null = null;
    if (peerName) {
      target = getFleetRegistry().get(peerName) ?? null;
      if (!target) {
        return textResult(
          `No fleet peer named "${peerName}". Active peers: ${getFleetRegistry().ids().join(', ')}`,
        );
      }
    } else {
      target = pickDefaultPeer();
      if (!target) {
        return textResult(
          `Multiple fleet listeners active (${getFleetRegistry().size()}). ` +
            `Specify --peer <name>. Active: ${getFleetRegistry().ids().join(', ')}`,
        );
      }
    }

    let history = target.listener.getEventHistory();
    if (typeFilter) {
      let re: RegExp;
      try {
        re = compileTypeFilter(typeFilter);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return textResult(`Invalid --type pattern "${typeFilter}": ${msg}`);
      }
      history = history.filter((rec) => re.test(rec.type));
    }
    if (history.length === 0) {
      if (json) return textResult('[]');
      const noteSuffix = typeFilter ? ` matching "${typeFilter}"` : '';
      return textResult(`No fleet events recorded yet for "${target.id}"${noteSuffix}.`);
    }
    const slice = history.slice(Math.max(0, history.length - n));

    if (json) {
      // JSON output: emit each event verbatim, augmented with the
      // peer id so consumers can pipe multiple peers' history into
      // jq without losing context.
      const targetId = target.id;
      const payload = slice.map((rec) => ({
        peer: targetId,
        at: rec.at,
        type: rec.type,
        hostname: rec.hostname ?? null,
        agentId: rec.agentId ?? null,
        payload: rec.payload ?? null,
      }));
      return textResult(JSON.stringify(payload, null, 2));
    }

    const lines: string[] = [];
    const filterNote = typeFilter ? ` (filter: "${typeFilter}")` : '';
    lines.push(
      `Fleet event history for "${target.id}" — last ${slice.length} of ${history.length}${filterNote}`,
    );
    for (const rec of slice) {
      lines.push(
        `  [${formatHistoryTime(rec.at)}] ${rec.type}${formatHistorySource(rec)} ${summarizeHistoryPayload(rec.type, rec.payload)}`,
      );
    }
    return textResult(lines.join('\n'));
  }

  if (action === 'send') {
    if (getFleetRegistry().size() === 0) {
      return textResult('No fleet listeners active. Connect with /fleet listen first.');
    }
    // Parse: send <peer> <method> [json-params] [--timeout <ms>]
    let peerName: string | null = null;
    let method: string | null = null;
    let jsonParams: string | null = null;
    let timeoutMs = 30_000;
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === '--timeout' && i + 1 < rest.length) {
        const n = parseInt(rest[i + 1], 10);
        if (Number.isFinite(n) && n > 0) timeoutMs = n;
        i++;
      } else if (!peerName) {
        peerName = arg;
      } else if (!method) {
        method = arg;
      } else if (!jsonParams) {
        // Take everything from here until --timeout as the params blob,
        // re-joining with spaces. Lets users paste un-quoted JSON.
        const remaining = rest.slice(i);
        const tIdx = remaining.indexOf('--timeout');
        const blobEnd = tIdx === -1 ? remaining.length : tIdx;
        jsonParams = remaining.slice(0, blobEnd).join(' ');
        i += blobEnd - 1;
      }
    }
    if (!peerName || !method) {
      return textResult(
        'Usage: /fleet send <peer> <method> [json-params] [--timeout <ms>]\n\n' + HELP,
      );
    }
    const target = getFleetRegistry().get(peerName);
    if (!target) {
      return textResult(
        `No fleet peer named "${peerName}". Active peers: ${getFleetRegistry().ids().join(', ')}`,
      );
    }
    let params: Record<string, unknown> = {};
    if (jsonParams) {
      try {
        const parsed = JSON.parse(jsonParams);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return textResult('Error: params must be a JSON object (e.g. {"key":"value"}).');
        }
        params = parsed as Record<string, unknown>;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return textResult(`Error: invalid JSON params: ${msg}`);
      }
    }
    try {
      const t0 = Date.now();
      const result = await target.listener.request(method, params, { timeoutMs });
      const elapsed = Date.now() - t0;
      const formatted = JSON.stringify(result, null, 2);
      return textResult(
        `Peer "${peerName}" → ${method} OK (${elapsed}ms):\n${formatted}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return textResult(`Peer "${peerName}" → ${method} FAILED:\n  ${message}`);
    }
  }

  if (action === 'chat') {
    return await handleChat(rest);
  }

  if (action === 'tool') {
    return await handleTool(rest);
  }

  if (action === 'autonomous') {
    return await handleAutonomous(rest);
  }

  return textResult(`Unknown fleet action: ${args[0]}\n\n${HELP}`);
}

/**
 * Phase (d).23 / V1.3 — `/fleet tool <peer> <name> [json-args]`
 * [--timeout <ms>] [--stream]
 *
 * UX wrapper around peer.tool.invoke. Same JSON-blob parser as
 * `/fleet send` (joins tokens until --timeout/--stream so users can
 * paste un-quoted JSON). With --stream, uses
 * peer.tool.invoke.stream and prints peer:chunk deltas via
 * `process.stdout.write` (the user sees output flow while the call
 * is in flight, then a final OK summary line).
 */
async function handleTool(rest: string[]): Promise<CommandHandlerResult> {
  if (getFleetRegistry().size() === 0) {
    return textResult('No fleet listeners active. Connect with /fleet listen first.');
  }

  let peerName: string | null = null;
  let toolName: string | null = null;
  let jsonArgs: string | null = null;
  let timeoutMs = 30_000;
  let stream = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--timeout' && i + 1 < rest.length) {
      const n = parseInt(rest[i + 1], 10);
      if (Number.isFinite(n) && n > 0) timeoutMs = n;
      i++;
    } else if (arg === '--stream') {
      stream = true;
    } else if (!peerName) {
      peerName = arg;
    } else if (!toolName) {
      toolName = arg;
    } else if (!jsonArgs) {
      // Consume tokens until we hit a flag, mirroring /fleet send.
      const remaining = rest.slice(i);
      const flagIdx = remaining.findIndex((r) => r === '--timeout' || r === '--stream');
      const blobEnd = flagIdx === -1 ? remaining.length : flagIdx;
      jsonArgs = remaining.slice(0, blobEnd).join(' ');
      i += blobEnd - 1;
    }
  }

  if (!peerName || !toolName) {
    return textResult(
      'Usage: /fleet tool <peer> <name> [json-args] [--timeout <ms>] [--stream]\n\n' + HELP,
    );
  }

  const target = getFleetRegistry().get(peerName);
  if (!target) {
    return textResult(
      `No fleet peer named "${peerName}". Active peers: ${getFleetRegistry().ids().join(', ')}`,
    );
  }

  let parsedArgs: Record<string, unknown> = {};
  if (jsonArgs && jsonArgs.trim().length > 0) {
    try {
      const parsed = JSON.parse(jsonArgs);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return textResult('Error: tool args must be a JSON object (e.g. {"file_path":"README.md"}).');
      }
      parsedArgs = parsed as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return textResult(`Error: invalid JSON args: ${msg}`);
    }
  }

  // The optional shape on FleetListenerPublicAPI lets test mocks omit
  // these — guard so we fail clean instead of TypeError'ing in JS.
  const invokeTool = target.listener.invokeTool?.bind(target.listener);
  const invokeToolStream = target.listener.invokeToolStream?.bind(target.listener);
  if (!invokeTool || !invokeToolStream) {
    return textResult(
      `Peer "${peerName}" listener does not expose invokeTool/invokeToolStream — likely an older Code Buddy build (pre-Phase d.23).`,
    );
  }

  try {
    const t0 = Date.now();
    let payload: { tool: string; output: string; durationMs: number; truncated?: boolean };
    if (stream) {
      let streamedAny = false;
      payload = await invokeToolStream(
        toolName,
        parsedArgs,
        (delta: string) => {
          streamedAny = true;
          const safeDelta = sanitizePeerToolOutput(delta);
          // Best-effort live print. In a TUI session this gives the
          // operator immediate feedback without waiting for the final
          // peer:response. Errors writing to stdout are non-fatal.
          try { process.stdout.write(safeDelta); } catch { /* ignore */ }
        },
        { timeoutMs },
      );
      if (streamedAny) {
        try { process.stdout.write('\n'); } catch { /* ignore */ }
      }
    } else {
      payload = await invokeTool(toolName, parsedArgs, { timeoutMs });
    }
    const elapsed = Date.now() - t0;
    const tag = stream ? `${toolName} (stream)` : toolName;
    const trunc = payload.truncated ? ' [truncated]' : '';
    if (stream) {
      // The body has already been streamed live — keep the summary terse.
      return textResult(
        `Peer "${peerName}" → ${tag} OK (${elapsed}ms)${trunc}: ${sanitizePeerToolOutput(payload.output).length} bytes`,
      );
    }
    const safeOutput = sanitizePeerToolOutput(payload.output);
    return textResult(
      `Peer "${peerName}" → ${tag} OK (${elapsed}ms)${trunc}:\n${safeOutput}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return textResult(`Peer "${peerName}" → ${toolName} FAILED:\n  ${message}`);
  }
}

/**
 * Phase (d).18 — `/fleet autonomous` sub-command.
 * Sub-actions: status | tick-now (manual fire). Configuration lives in
 * TOML `[autonomous_fleet]` and is honoured at boot — this slash is
 * for inspection and ad-hoc one-shot ticks.
 */
async function handleAutonomous(rest: string[]): Promise<CommandHandlerResult> {
  const sub = (rest[0] || 'status').trim().toLowerCase();
  const { getConfigManager } = await import('../../config/toml-config.js');
  const af = getConfigManager().getConfig().autonomous_fleet;

  if (sub === 'status' || sub === '') {
    if (!af?.enabled) {
      return textResult(
        'Autonomous fleet: disabled.\n\n' +
          'Enable in .codebuddy/config.toml:\n' +
          '  [autonomous_fleet]\n' +
          '  enabled = true\n' +
          '  repo_path = "/path/to/claude-et-patrice"\n' +
          '  host = "ministar/grok-cli"\n' +
          '  interval_minutes = 30\n' +
          '  priority_threshold = "high"   # critical is always skipped\n' +
          '  llm_provider = "cloud"        # or "auto" / "ollama" / "grok" / etc.\n',
      );
    }
    // Resolve preview of the provider that the next tick would use for a
    // task with no `preferLocal` hint, so the user sees the host-default.
    const { resolveTickProvider } = await import(
      '../../agent/autonomous/fleet-tick-handler.js'
    );
    const previewProvider = resolveTickProvider(
      { preferLocal: false },
      af.llm_provider,
    );
    return textResult(
      [
        'Autonomous fleet: ENABLED',
        `  Repo path:           ${af.repo_path ?? '(unset!)'}`,
        `  Host:                ${af.host ?? '(unset!)'}`,
        `  Interval:            ${af.interval_minutes ?? 30} min`,
        `  Max task ms:         ${af.max_task_ms ?? 600_000}`,
        `  Priority threshold:  ${af.priority_threshold ?? 'high'}  (critical always skipped)`,
        `  LLM provider config: ${af.llm_provider ?? 'cloud'}`,
        `  Resolved (preview):  ${previewProvider.provider} model=${previewProvider.model}` +
          ` ${previewProvider.isLocal ? '[LOCAL]' : '[cloud]'} (reason=${previewProvider.reason})`,
        '',
        'Tasks tagged `preferLocal: true` may use Ollama instead — see fleet-task-types.ts.',
        'Use /fleet autonomous tick-now to fire a tick immediately.',
      ].join('\n'),
    );
  }

  if (sub === 'tick-now') {
    if (!af?.enabled || !af.repo_path || !af.host) {
      return textResult(
        'Autonomous fleet not configured. Run /fleet autonomous status to see required keys.',
      );
    }
    const { runFleetTick } = await import('../../agent/autonomous/fleet-tick-handler.js');
    try {
      const outcome = await runFleetTick({
        repoPath: af.repo_path,
        host: af.host,
        maxTaskMs: af.max_task_ms,
        priorityThreshold: af.priority_threshold ?? 'high',
        llmProvider: af.llm_provider,
      });
      return textResult(`Autonomous fleet tick result:\n${JSON.stringify(outcome, null, 2)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return textResult(`Autonomous fleet tick FAILED:\n  ${msg}`);
    }
  }

  return textResult(
    `Unknown /fleet autonomous sub-action: ${sub}\n\nAvailable: status, tick-now`,
  );
}

/** Test reset hook. Stops all listeners and clears the registry. */
export function _resetFleetHandlerForTests(): void {
  const reg = getFleetRegistry();
  for (const peer of reg.list()) {
    peer.listener.disconnect().catch(() => { /* ignore */ });
  }
  reg.clear();
}
