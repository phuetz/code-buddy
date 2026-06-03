/**
 * ServerBridge — wraps the core `src/server/index.ts:startServer/stopServer`
 * so the Cowork UI can boot/stop the Code Buddy HTTP server (default port
 * 3000, WS gateway 3001) from a button in the titlebar.
 *
 * Single instance per Cowork process. The server runs in-process (no child
 * fork) so all IPC handlers, hooks, and tools share the same registries.
 *
 * @module main/server/server-bridge
 */
import * as crypto from 'crypto';
import { log, logError } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';

interface CoreServerModule {
  startServer: (config?: Record<string, unknown>) => Promise<{
    app: unknown;
    server: { close: (cb?: (err?: Error) => void) => void; address(): unknown };
    config: { port: number; host: string; websocketEnabled?: boolean };
  }>;
  stopServer: (server: { close: (cb?: (err?: Error) => void) => void }) => Promise<void>;
}

interface CoreLoggingModule {
  getRecentRequests: (limit?: number) => Array<{
    timestamp: number;
    method: string;
    path: string;
    statusCode: number;
    responseTimeMs: number;
    ip: string;
  }>;
  getRequestStats: () => {
    total: number;
    errors: number;
    averageLatency: number;
    uptime: number;
    byEndpoint: Record<string, number>;
    byStatus: Record<string, number>;
  };
}

interface CoreDatabaseModule {
  getDatabaseManager: (config?: { dbPath?: string }) => {
    isInitialized(): boolean;
    initialize(): Promise<void>;
  };
}

export interface ServerStatus {
  running: boolean;
  port: number | null;
  host: string | null;
  startedAt: number | null;
  websocket: boolean;
  error?: string | null;
}

export class ServerBridge {
  private module: CoreServerModule | null = null;
  private instance: { close: (cb?: (err?: Error) => void) => void } | null = null;
  private port: number | null = null;
  private host: string | null = null;
  private startedAt: number | null = null;
  private websocket = false;
  private lastError: string | null = null;
  private bootInFlight: Promise<ServerStatus> | null = null;

  async status(): Promise<ServerStatus> {
    return {
      running: this.instance !== null,
      port: this.port,
      host: this.host,
      startedAt: this.startedAt,
      websocket: this.websocket,
      error: this.lastError,
    };
  }

  async start(userConfig: { port?: number; host?: string; websocketEnabled?: boolean } = {}): Promise<ServerStatus> {
    // Merge persisted server settings (Settings → Server) with the
    // explicit `userConfig` argument. Argument wins so the IPC caller
    // can still override.
    try {
      const { configStore } = await import('../config/config-store');
      const persisted = configStore.getAll().server;
      if (persisted) {
        userConfig = {
          port: userConfig.port ?? persisted.port,
          host: userConfig.host ?? persisted.host,
          websocketEnabled: userConfig.websocketEnabled ?? persisted.websocketEnabled,
        };
        // If the user persisted a JWT secret, honour it instead of the
        // runtime fallback.
        if (persisted.jwtSecret && !process.env.JWT_SECRET) {
          process.env.JWT_SECRET = persisted.jwtSecret;
        }
      }
    } catch {
      /* ignore — fallback to defaults */
    }

    // If the host is a local loopback IP, map it to 'localhost' so it binds to both IPv4 and IPv6 loopbacks,
    // avoiding Windows IPv6/IPv4 lookup mismatch issues for clients fetching 'localhost:3000'.
    if (userConfig.host === '127.0.0.1' || userConfig.host === '::1') {
      userConfig.host = 'localhost';
    }

    if (this.instance) {
      return this.status();
    }
    if (this.bootInFlight) {
      return this.bootInFlight;
    }
    this.lastError = null;
    this.bootInFlight = (async () => {
      try {
        // The core server's auth middleware throws at module-load time
        // ("SECURITY ERROR: JWT_SECRET …") under NODE_ENV=production
        // unless the env var is set. Cowork runs in production mode by
        // default, so we mint a random secret at runtime — fine for a
        // local/single-user desktop app where issued tokens don't need
        // to survive a restart.
        if (!process.env.JWT_SECRET) {
          process.env.JWT_SECRET = crypto.randomBytes(64).toString('hex');
          log('[ServerBridge] minted runtime JWT_SECRET (single-user fallback)');
        }

        // Boot the core SQLite DB first — `getDatabaseManager()` is the
        // singleton consumed by `health.ts:checkDatabase` and by every
        // repository class. Default path is `~/.codebuddy/codebuddy.db`
        // (created on first call). Idempotent.
        try {
          const dbModule = await loadCoreModule<CoreDatabaseModule>('database/database-manager.js');
          if (dbModule) {
            const dbManager = dbModule.getDatabaseManager();
            if (!dbManager.isInitialized()) {
              await dbManager.initialize();
              log('[ServerBridge] core DatabaseManager initialized');
            }
          } else {
            logError('[ServerBridge] core database-manager module unavailable; health.checks.database will be "error"');
          }
        } catch (dbErr) {
          logError('[ServerBridge] DB init failed (server boot continues):', dbErr);
        }

        if (!this.module) {
          this.module = await loadCoreModule<CoreServerModule>('server/index.js');
        }
        if (!this.module) {
          throw new Error('Core server module unavailable (run `npx tsc -p .` from the repo root)');
        }
        const result = await this.module.startServer(userConfig);
        this.instance = result.server;
        this.port = result.config.port;
        this.host = result.config.host;
        this.websocket = !!result.config.websocketEnabled;
        this.startedAt = Date.now();
        log(`[ServerBridge] started on ${this.host}:${this.port}${this.websocket ? ' (+WS)' : ''}`);
        return this.status();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.lastError = message;
        logError('[ServerBridge] start failed:', message);
        return this.status();
      } finally {
        this.bootInFlight = null;
      }
    })();
    return this.bootInFlight;
  }

  async stop(): Promise<ServerStatus> {
    if (!this.instance || !this.module) {
      return this.status();
    }
    try {
      await this.module.stopServer(this.instance);
      log(`[ServerBridge] stopped (was on ${this.host}:${this.port})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      logError('[ServerBridge] stop failed:', message);
    } finally {
      this.instance = null;
      this.port = null;
      this.host = null;
      this.startedAt = null;
      this.websocket = false;
    }
    return this.status();
  }

  /**
   * Read-only window into the live request log + aggregate stats.
   * Powers the "Server activity" modal opened from the titlebar.
   */
  async dashboard(): Promise<{
    recent: Array<{
      timestamp: number;
      method: string;
      path: string;
      statusCode: number;
      responseTimeMs: number;
      ip: string;
    }>;
    stats: {
      total: number;
      errors: number;
      averageLatency: number;
      uptime: number;
      byStatus: Record<string, number>;
    } | null;
  }> {
    try {
      const mod = await loadCoreModule<CoreLoggingModule>('server/middleware/logging.js');
      if (!mod) return { recent: [], stats: null };
      const recent = mod.getRecentRequests(50);
      const fullStats = mod.getRequestStats();
      return {
        recent,
        stats: {
          total: fullStats.total,
          errors: fullStats.errors,
          averageLatency: fullStats.averageLatency,
          uptime: fullStats.uptime,
          byStatus: fullStats.byStatus,
        },
      };
    } catch {
      return { recent: [], stats: null };
    }
  }
}

let singleton: ServerBridge | null = null;

export function getServerBridge(): ServerBridge {
  if (!singleton) singleton = new ServerBridge();
  return singleton;
}
