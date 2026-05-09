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
    if (this.instance) {
      return this.status();
    }
    if (this.bootInFlight) {
      return this.bootInFlight;
    }
    this.lastError = null;
    this.bootInFlight = (async () => {
      try {
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
}

let singleton: ServerBridge | null = null;

export function getServerBridge(): ServerBridge {
  if (!singleton) singleton = new ServerBridge();
  return singleton;
}
