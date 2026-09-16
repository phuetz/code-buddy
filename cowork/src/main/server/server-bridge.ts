/**
 * ServerBridge — wraps the core `src/server/index.ts:startServer/stopServer`
 * so the Cowork UI can boot/stop the Code Buddy HTTP server (default port
 * 3000, WebSocket /ws on the same port) from a button in the titlebar.
 *
 * Single instance per Cowork process. The server runs in-process (no child
 * fork) so all IPC handlers, hooks, and tools share the same registries.
 *
 * @module main/server/server-bridge
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { log, logError } from '../utils/logger';
import { loadCoreModule } from '../utils/core-loader';

export interface CoreCognitiveContext {
  leaseId: string | null;
  turnContext: string;
  evidence: string;
  itemIds: readonly string[];
  commit(): Promise<void>;
  release(): Promise<void>;
}

export interface CoreCognitionPort {
  publish(draft: Record<string, unknown>, clientEventId?: string): Promise<{
    replayed: boolean;
    revision: number;
  }>;
  cancel(correlationId: string): Promise<boolean>;
  acquireContext(options?: Record<string, unknown>): Promise<CoreCognitiveContext>;
}

interface CoreHttpServer {
  close: (cb?: (err?: Error) => void) => void;
  address(): unknown;
  listening?: boolean;
}

interface StartedServer {
  app: unknown;
  server: CoreHttpServer;
  config: { port: number; host: string; websocketEnabled?: boolean };
  cognitionPort: CoreCognitionPort;
}

interface CoreServerModule {
  startServer: (config?: Record<string, unknown>) => Promise<StartedServer>;
  stopServer: (server: CoreHttpServer) => Promise<void>;
}

/**
 * Whether a server whose stopServer rejected is still up. The core can fail in
 * a teardown step before `server.close()` (still listening) or in the close
 * callback (`ERR_SERVER_NOT_RUNNING`, already closed). When the server does not
 * say, it is assumed up: forgetting a live server is the unsafe direction.
 */
function isStillListening(server: CoreHttpServer): boolean {
  if (typeof server.listening === 'boolean') return server.listening;
  try {
    return server.address() !== null;
  } catch {
    return true;
  }
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

/**
 * A Cowork-minted secret is 128 hex characters. Anything shorter than the core
 * security audit's weak-secret threshold is a torn or truncated write, never a
 * secret worth keeping.
 */
const MIN_PERSISTED_JWT_SECRET_LENGTH = 32;

/**
 * Persist the secret atomically: an exclusive 0600 temp file in the same
 * directory, then a rename. A failed write never leaves an empty or partial
 * secret file that would break the next cold start.
 */
function persistJwtSecret(secretPath: string, secret: string): void {
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  const tempPath = `${secretPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tempPath, secret, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tempPath, secretPath);
  } catch (err) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      /* the original error is the one worth reporting */
    }
    throw err;
  }
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
  private instance: CoreHttpServer | null = null;
  private port: number | null = null;
  private host: string | null = null;
  private startedAt: number | null = null;
  private websocket = false;
  private lastError: string | null = null;
  private bootInFlight: Promise<ServerStatus> | null = null;
  private stopInFlight: Promise<ServerStatus> | null = null;
  /** Bumped by every stop() request: a start() called before it no longer boots. */
  private generation = 0;
  /** Generation of the start() that owns `bootInFlight`. */
  private bootGeneration = 0;
  private cognitionPort: CoreCognitionPort | null = null;

  /** Main-process-only projection authority. Never forward it through Electron IPC. */
  getCognitionPort(): CoreCognitionPort | null {
    return this.cognitionPort;
  }

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
    const generation = this.generation;
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

    // A stop requested after this call wins. An explicit start requested after a
    // stop waits for that stop, or for the boot it cancelled, then boots again.
    if (generation !== this.generation) {
      return this.status();
    }
    while (this.stopInFlight || (this.bootInFlight && this.bootGeneration !== this.generation)) {
      await (this.stopInFlight ?? this.bootInFlight);
      if (generation !== this.generation) {
        return this.status();
      }
    }

    if (this.instance) {
      return this.status();
    }
    if (this.bootInFlight) {
      return this.bootInFlight;
    }

    this.lastError = null;
    this.bootGeneration = generation;
    const cancelled = (): boolean => generation !== this.generation;
    this.bootInFlight = (async () => {
      try {
        // Resolve JWT_SECRET before loading any core module: under
        // NODE_ENV=production the core `startServer` refuses to run without it.
        if (!process.env.JWT_SECRET) {
          const secretPath = path.join(os.homedir(), '.codebuddy', '.jwt_secret');
          let persisted: string | null = null;
          try {
            persisted = fs.existsSync(secretPath) ? fs.readFileSync(secretPath, 'utf8').trim() : null;
          } catch (err) {
            process.env.JWT_SECRET = crypto.randomBytes(64).toString('hex');
            logError('[ServerBridge] could not read the persisted JWT_SECRET, using ephemeral fallback:', err);
          }
          if (!process.env.JWT_SECRET) {
            if (persisted !== null && persisted.length >= MIN_PERSISTED_JWT_SECRET_LENGTH) {
              process.env.JWT_SECRET = persisted;
              log('[ServerBridge] loaded persisted JWT_SECRET');
            } else {
              if (persisted !== null) {
                logError(
                  `[ServerBridge] persisted JWT_SECRET is ${persisted ? `too short (${persisted.length} characters)` : 'empty'}; replacing it`,
                );
              }
              const secret = crypto.randomBytes(64).toString('hex');
              process.env.JWT_SECRET = secret;
              try {
                persistJwtSecret(secretPath, secret);
                log('[ServerBridge] minted and persisted new JWT_SECRET');
              } catch (err) {
                logError('[ServerBridge] failed to persist JWT_SECRET, using ephemeral fallback:', err);
              }
            }
          }
        }

        // Boot the core SQLite DB first — `getDatabaseManager()` is the
        // singleton consumed by `health.ts:checkDatabase` and by every
        // repository class. Default path is `~/.codebuddy/codebuddy.db`
        // (created on first call). Idempotent.
        try {
          const dbModule = await loadCoreModule<CoreDatabaseModule>('database/database-manager.js');
          // A stop requested while the module was loading must not start a new
          // database initialization (one already under way is left to finish).
          if (cancelled()) {
            log('[ServerBridge] start cancelled by a stop request before the core database was initialized');
            return this.status();
          }
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

        if (cancelled()) {
          log('[ServerBridge] start cancelled by a stop request before the core server was created');
          return this.status();
        }
        if (!this.module) {
          this.module = await loadCoreModule<CoreServerModule>('server/index.js');
        }
        if (!this.module) {
          throw new Error('Core server module unavailable (run `npx tsc -p .` from the repo root)');
        }
        if (cancelled()) {
          log('[ServerBridge] start cancelled by a stop request before the core server was created');
          return this.status();
        }
        const result = await this.module.startServer(userConfig);
        if (cancelled()) {
          return await this.closeLateServer(this.module, result);
        }
        this.publish(result);
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

  private publish(result: StartedServer): void {
    this.instance = result.server;
    this.cognitionPort = result.cognitionPort;
    this.port = result.config.port;
    this.host = result.config.host;
    this.websocket = !!result.config.websocketEnabled;
    this.startedAt = Date.now();
  }

  /**
   * A stop was requested while startServer was creating the server: the server
   * exists, so close it instead of publishing it. If closing fails it is still
   * up, so it stays tracked with the error and a later stop can retry.
   */
  private async closeLateServer(module: CoreServerModule, result: StartedServer): Promise<ServerStatus> {
    try {
      await module.stopServer(result.server);
      log(
        `[ServerBridge] stop requested during start; closed the server on ${result.config.host}:${result.config.port}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isStillListening(result.server)) this.publish(result);
      this.lastError = `stop requested during start, but closing the server failed: ${message}`;
      logError('[ServerBridge] late stop failed:', message);
    }
    return this.status();
  }

  async stop(): Promise<ServerStatus> {
    // Every request cancels any start() called before it, including one that
    // has not reached its boot yet.
    this.generation += 1;
    if (this.stopInFlight) {
      return this.stopInFlight;
    }
    this.stopInFlight = (async () => {
      try {
        // A cancelled boot closes a server it already created before settling.
        return this.bootInFlight ? await this.bootInFlight : await this.stopInstance();
      } finally {
        this.stopInFlight = null;
      }
    })();
    return this.stopInFlight;
  }

  private async stopInstance(): Promise<ServerStatus> {
    if (!this.instance || !this.module) {
      return this.status();
    }
    try {
      await this.module.stopServer(this.instance);
      log(`[ServerBridge] stopped (was on ${this.host}:${this.port})`);
      this.lastError = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      if (isStillListening(this.instance)) {
        // Still up: keep it tracked so status stays true, start() does not boot a
        // second server, and a later stop() can retry.
        logError('[ServerBridge] stop failed; the server is still running:', message);
        return this.status();
      }
      logError('[ServerBridge] stop failed; the server is no longer listening:', message);
    }
    this.forgetInstance();
    return this.status();
  }

  private forgetInstance(): void {
    this.instance = null;
    this.port = null;
    this.host = null;
    this.startedAt = null;
    this.websocket = false;
    this.cognitionPort = null;
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
