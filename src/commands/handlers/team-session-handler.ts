/**
 * Team Session slash command handler (`/share`)
 *
 * Renamed from `/session` after grep revealed `/sessions` (HTTP sessions
 * persistance, src/commands/handlers/session-handlers.ts) — singular vs
 * plural would tab-collide. `/share` is unambiguous and matches the user-
 * facing intent: "share my coding session with team members".
 *
 * Wires user-facing activation of the TeamSessionManager
 * (`src/collaboration/team-session.ts`). The manager has existed since
 * the OpenClaw heritage import but had no slash command nor TOML hook,
 * so it was effectively unreachable in production (audit OpenClaw
 * findings 2026-05-02 — top 1 priority).
 *
 * Sub-actions:
 *   /share enable                — instantiate the singleton (idempotent)
 *   /share disable               — dispose the singleton, clear timers
 *   /share status                — show enabled, active session, sync state
 *   /share create <name>         — create a new local session
 *   /share join <sessionId>      — join an existing local session by id
 *   /share list                  — list sessions on disk
 *   /share leave                 — leave the current session
 *
 * **Limitation V0.1**: real-time sync requires a WebSocket server,
 * which is not wired in V0.1. All session metadata is persisted locally
 * under ~/.codebuddy/sessions/, but cross-host members will not see each
 * other's edits. V0.2 will wire `src/server/websocket/handler.ts` to a
 * `/ws/shares/:id` endpoint and hook the share* / annotation methods
 * into broadcast.
 *
 * Slash name `session` (not `team`/`team-session`/`collab`) chosen to:
 * - avoid collision with `/team` (Agent Teams multi-agent coordination,
 *   `src/commands/handlers/team-handlers.ts`)
 * - avoid collision with `/colab` (AI Collaboration workflow,
 *   `src/commands/handlers/colab-handler.ts`)
 * - match the internal `TeamSession*` class naming
 *
 * TOML section is `[team_session]` (more descriptive than `[session]`,
 * outlives any future slash UX rename).
 */

import { CommandHandlerResult } from './branch-handlers.js';
import { logger } from '../../utils/logger.js';

const VALID_ACTIONS = new Set([
  'enable', 'disable', 'status', 'create', 'join', 'list', 'leave', 'help', '',
]);

const HELP_TEXT = `Usage: /share <action> [args]

Actions:
  enable                Instantiate the team-session singleton (idempotent).
  disable               Dispose the singleton, clear WS reconnect timers.
  status                Show enabled flag, active session, real-time sync state.
  create <name>         Create a new local session named <name>.
  join <sessionId>      Join an existing local session.
  list                  List sessions persisted under ~/.codebuddy/sessions/.
  leave                 Leave the current session.

V0.1 limitation: real-time sync requires a WebSocket server (V0.2 work).
Sessions are persisted locally; remote members will not see live edits.

Configure defaults in TOML under [team_session]:
  enabled            = false       # auto-instantiate at boot
  server_url         = ""          # WebSocket sync server (V0.2)
  enable_encryption  = true        # AES-256-GCM when encryption_key is set
  auto_reconnect     = true
  reconnect_interval = 5000        # ms
  heartbeat_interval = 30000       # ms
  max_reconnect_attempts = 10`;

interface ManagerInternals {
  currentMember: { id: string; name: string } | null;
  config: { serverUrl?: string; enableEncryption?: boolean; encryptionKey?: string };
  loadMemberProfile?: () => void;
}

let sessionEnabled = false;

function isInstantiated(): boolean {
  return sessionEnabled;
}

function formatStatusLines(
  enabled: boolean,
  serverUrl: string | undefined,
  encryptionLabel: string,
  sessionSummary: string,
): string {
  const lines: string[] = [];
  lines.push('Team Session Manager Status');
  lines.push('═'.repeat(40));
  lines.push(`Enabled:           ${enabled ? 'yes' : 'no'}`);
  lines.push(`Real-time sync:    ${serverUrl ? `enabled (${serverUrl})` : 'DISABLED — V0.2'}`);
  lines.push(`Encryption:        ${encryptionLabel}`);
  lines.push('');
  lines.push(sessionSummary);
  return lines.join('\n');
}

function formatEncryptionStatus(config: { enableEncryption?: boolean; encryptionKey?: string }): string {
  if (!config.enableEncryption) {
    return 'plain';
  }
  return config.encryptionKey ? 'AES-256-GCM' : 'plain (encryption key not configured)';
}

/**
 * /share <action> [args]
 */
export async function handleShare(args: string[]): Promise<CommandHandlerResult> {
  const action = (args[0] || 'status').trim().toLowerCase();
  const rest = args.slice(1);

  if (!VALID_ACTIONS.has(action)) {
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Unknown share action: ${args[0]}\n\n${HELP_TEXT}`,
        timestamp: new Date(),
      },
    };
  }

  if (action === 'help' || action === '') {
    return {
      handled: true,
      entry: { type: 'assistant', content: HELP_TEXT, timestamp: new Date() },
    };
  }

  const { getTeamSessionManager, resetTeamSessionManager } = await import('../../collaboration/team-session.js');
  const { getConfigManager } = await import('../../config/toml-config.js');

  // Build config from TOML; only pass defined keys so DEFAULT_CONFIG fills
  // the rest. Mirrors the heartbeat-handler pattern (passing undefined
  // explicitly would overwrite defaults via spread merge).
  const cfg = getConfigManager().getConfig().team_session ?? {};
  type Partial = Parameters<typeof getTeamSessionManager>[0];
  const partial: Partial = {};
  if (cfg.server_url !== undefined) partial!.serverUrl = cfg.server_url;
  if (cfg.enable_encryption !== undefined) partial!.enableEncryption = cfg.enable_encryption;
  if (cfg.encryption_key !== undefined) partial!.encryptionKey = cfg.encryption_key;
  if (cfg.auto_reconnect !== undefined) partial!.autoReconnect = cfg.auto_reconnect;
  if (cfg.reconnect_interval !== undefined) partial!.reconnectInterval = cfg.reconnect_interval;
  if (cfg.heartbeat_interval !== undefined) partial!.heartbeatInterval = cfg.heartbeat_interval;
  if (cfg.max_reconnect_attempts !== undefined) partial!.maxReconnectAttempts = cfg.max_reconnect_attempts;

  if (action === 'disable') {
    if (!isInstantiated()) {
      return {
        handled: true,
        entry: { type: 'assistant', content: 'Team session manager is not enabled.', timestamp: new Date() },
      };
    }
    resetTeamSessionManager();
    sessionEnabled = false;
    logger.info('Team session manager disabled via slash command');
    return {
      handled: true,
      entry: { type: 'assistant', content: 'Team session manager stopped.', timestamp: new Date() },
    };
  }

  if (action === 'status') {
    // Status is read-only: report the current flag without instantiating.
    if (!sessionEnabled) {
      const text = formatStatusLines(
        false,
        cfg.server_url,
        formatEncryptionStatus({
          enableEncryption: cfg.enable_encryption ?? true,
          encryptionKey: cfg.encryption_key,
        }),
        'No active session.',
      );
      return {
        handled: true,
        entry: { type: 'assistant', content: text, timestamp: new Date() },
      };
    }
    // Already enabled — read live state from the singleton.
    const liveMgr = getTeamSessionManager(partial);
    const liveInternals = liveMgr as unknown as ManagerInternals;
    const current = liveMgr.getCurrentSession();
    const sessionSummary = current
      ? `Active session: ${current.name} (${current.members.length} member(s), id ${current.id.slice(0, 12)}…)`
      : 'No active session.';
    const text = formatStatusLines(
      sessionEnabled,
      liveInternals.config.serverUrl,
      formatEncryptionStatus(liveInternals.config),
      sessionSummary,
    );
    return {
      handled: true,
      entry: { type: 'assistant', content: text, timestamp: new Date() },
    };
  }

  // From here on, the manager is needed — instantiate it.
  const mgr = getTeamSessionManager(partial);
  const wasEnabled = sessionEnabled;
  sessionEnabled = true;

  // Attach an idempotent 'error' listener: TeamSessionManager emits
  // 'error' on routine soft-failures (e.g. joinSession with unknown id)
  // without ever throwing itself. Default EventEmitter behaviour, no
  // listener => throw — which would crash the slash and mask the
  // documented `null` return contract of joinSession.
  if (mgr.listenerCount('error') === 0) {
    mgr.on('error', (err: Error) => {
      logger.debug('Team session manager soft-error swallowed', { error: err.message });
    });
  }

  // The manager's constructor fires `initialize()` async (fs.ensureDir
  // then sync loadMemberProfile). For actions that read currentMember,
  // force a sync load if the async path hasn't run yet — loadMemberProfile
  // itself is synchronous (fs.existsSync + fs.readJSONSync).
  const internals = mgr as unknown as ManagerInternals;
  if (!internals.currentMember && typeof internals.loadMemberProfile === 'function') {
    internals.loadMemberProfile();
  }

  if (action === 'enable') {
    if (wasEnabled) {
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: 'Team session manager already enabled. Use /share status to see active session.',
          timestamp: new Date(),
        },
      };
    }
    logger.info('Team session manager enabled via slash command');
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: 'Team session manager started (local-first mode — V0.1).\nUse /share create <name> to start a session.',
        timestamp: new Date(),
      },
    };
  }

  if (action === 'create') {
    const name = rest.join(' ').trim();
    if (!name) {
      return {
        handled: true,
        entry: { type: 'assistant', content: 'Usage: /share create <name>', timestamp: new Date() },
      };
    }
    try {
      const session = await mgr.createSession(name);
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: `Session created: ${session.name}\nID: ${session.id}\nOwner: ${internals.currentMember?.name ?? '(unknown)'}\nStorage: ~/.codebuddy/sessions/${session.id}.json`,
          timestamp: new Date(),
        },
      };
    } catch (err) {
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: `Could not create session: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date(),
        },
      };
    }
  }

  if (action === 'join') {
    const sessionId = rest[0]?.trim();
    if (!sessionId) {
      return {
        handled: true,
        entry: { type: 'assistant', content: 'Usage: /share join <sessionId>', timestamp: new Date() },
      };
    }
    try {
      const session = await mgr.joinSession(sessionId);
      if (!session) {
        return {
          handled: true,
          entry: {
            type: 'assistant',
            content: `Session not found: ${sessionId}\nUse /share list to see available sessions.`,
            timestamp: new Date(),
          },
        };
      }
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: `Joined session: ${session.name} (${session.members.length} member${session.members.length === 1 ? '' : 's'})`,
          timestamp: new Date(),
        },
      };
    } catch (err) {
      return {
        handled: true,
        entry: {
          type: 'assistant',
          content: `Could not join session: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date(),
        },
      };
    }
  }

  if (action === 'list') {
    const sessions = await mgr.listSessions();
    if (sessions.length === 0) {
      return {
        handled: true,
        entry: { type: 'assistant', content: 'No sessions on disk.', timestamp: new Date() },
      };
    }
    const lines = sessions.map((s) =>
      `  ${s.id.slice(0, 12)}…  ${s.name.padEnd(30)}  ${s.members.length} member(s)  created ${new Date(s.createdAt).toISOString()}`
    );
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Found ${sessions.length} session(s):\n${lines.join('\n')}`,
        timestamp: new Date(),
      },
    };
  }

  if (action === 'leave') {
    const current = mgr.getCurrentSession();
    if (!current) {
      return {
        handled: true,
        entry: { type: 'assistant', content: 'No active session to leave.', timestamp: new Date() },
      };
    }
    await mgr.leaveSession();
    return {
      handled: true,
      entry: {
        type: 'assistant',
        content: `Left session: ${current.name}`,
        timestamp: new Date(),
      },
    };
  }

  // Should never reach: 'status' is handled earlier, all other valid
  // actions have explicit returns above. Defensive fallback so TS
  // typing on the function return type stays satisfied.
  return {
    handled: true,
    entry: { type: 'assistant', content: HELP_TEXT, timestamp: new Date() },
  };
}

/**
 * Test hook — reset the local enabled flag so test files can isolate state.
 * Call alongside resetTeamSessionManager() in beforeEach/afterEach.
 */
export function _resetSessionHandlerForTests(): void {
  sessionEnabled = false;
}
