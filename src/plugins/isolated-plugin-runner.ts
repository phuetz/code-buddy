/**
 * Isolated Plugin Runner
 * Manages Worker Thread lifecycle for isolated plugin execution
 *
 * Security features:
 * - Worker threads run with restricted resourceLimits
 * - All messages are validated before processing
 * - Timeouts prevent runaway plugins
 * - Permissions are enforced via sandboxed environment in worker
 */

import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { PluginPermissions, validatePermissions } from './types.js';
import { createLogger, Logger } from '../utils/logger.js';

export interface IsolatedPluginConfig {
  pluginPath: string;
  pluginId: string;
  dataDir: string;
  config: Record<string, unknown>;
  permissions: PluginPermissions;
  timeout?: number; // Default 30000ms (30 seconds)
  memoryLimitMb?: number; // Default 128MB
}

/** Valid message types from worker */
const VALID_MESSAGE_TYPES = [
  'init', 'activate', 'deactivate', 'call', 'response',
  'error', 'log', 'register-tool', 'register-command'
] as const;

type MessageType = typeof VALID_MESSAGE_TYPES[number];

interface WorkerMessage {
  type: MessageType;
  id?: string;
  payload?: unknown;
}

/**
 * Validate a message received from the worker
 * Prevents malformed or malicious messages from being processed
 */
function validateWorkerMessage(message: unknown): message is WorkerMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const m = message as Record<string, unknown>;

  // Type must be a valid string
  if (typeof m.type !== 'string' || !VALID_MESSAGE_TYPES.includes(m.type as MessageType)) {
    return false;
  }

  // ID must be string if present
  if (m.id !== undefined && typeof m.id !== 'string') {
    return false;
  }

  // Payload validation based on message type
  if (m.type === 'log' && m.payload) {
    const p = m.payload as Record<string, unknown>;
    if (typeof p.level !== 'string' || typeof p.message !== 'string') {
      return false;
    }
    // Sanitize log message length to prevent memory exhaustion
    if (p.message.length > 10000) {
      return false;
    }
  }

  if (m.type === 'error' && m.payload) {
    const p = m.payload as Record<string, unknown>;
    if (typeof p.message !== 'string') {
      return false;
    }
    // Sanitize error message length
    if (p.message.length > 10000) {
      return false;
    }
  }

  if (m.type === 'register-tool' && m.payload) {
    // Validate tool registration payload
    const p = m.payload as Record<string, unknown>;
    if (typeof p.name !== 'string' || !p.name.match(/^[a-zA-Z0-9_-]+$/)) {
      return false;
    }
    if (typeof p.description !== 'string') {
      return false;
    }
  }

  if (m.type === 'register-command' && m.payload) {
    // Validate command registration payload
    const p = m.payload as Record<string, unknown>;
    if (typeof p.name !== 'string' || !p.name.match(/^[a-zA-Z0-9_-]+$/)) {
      return false;
    }
  }

  return true;
}

/**
 * Validate plugin configuration before starting
 */
function validateConfig(config: IsolatedPluginConfig): string[] {
  const errors: string[] = [];

  // Validate plugin ID
  if (!/^[a-zA-Z0-9_-]+$/.test(config.pluginId)) {
    errors.push('Invalid plugin ID format');
  }

  // Validate plugin path
  if (!config.pluginPath || config.pluginPath.includes('..')) {
    errors.push('Invalid plugin path (path traversal detected)');
  }

  // Validate permissions
  const permResult = validatePermissions(config.permissions);
  if (!permResult.valid) {
    errors.push(...permResult.errors);
  }

  // Validate timeout
  if (config.timeout !== undefined && (config.timeout < 1000 || config.timeout > 300000)) {
    errors.push('Timeout must be between 1000ms and 300000ms (5 minutes)');
  }

  // Validate memory limit
  if (config.memoryLimitMb !== undefined && (config.memoryLimitMb < 32 || config.memoryLimitMb > 512)) {
    errors.push('Memory limit must be between 32MB and 512MB');
  }

  return errors;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class IsolatedPluginRunner extends EventEmitter {
  private worker: Worker | null = null;
  private config: IsolatedPluginConfig;
  private logger: Logger;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private messageIdCounter = 0;
  private isTerminated = false;
  private readonly defaultTimeout: number;

  constructor(config: IsolatedPluginConfig) {
    super();
    this.config = config;
    this.defaultTimeout = config.timeout ?? 30000;
    this.logger = createLogger({ source: `IsolatedPlugin:${config.pluginId}` });
  }

  /**
   * Generate a unique message ID
   */
  private generateMessageId(): string {
    return `msg-${++this.messageIdCounter}-${Date.now()}`;
  }

  /**
   * Send a message to the worker and wait for response
   */
  private sendMessage(type: string, payload?: unknown, timeout?: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker || this.isTerminated) {
        reject(new Error('Worker is not running'));
        return;
      }

      const id = this.generateMessageId();
      const timeoutMs = timeout ?? this.defaultTimeout;

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Plugin operation timed out after ${timeoutMs}ms`));
        // Terminate worker on timeout
        this.terminate();
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      this.worker.postMessage({ type, id, payload } as WorkerMessage);
    });
  }

  /**
   * Handle messages from the worker
   * All messages are validated before processing
   */
  private handleWorkerMessage(rawMessage: unknown): void {
    // Validate message structure and content
    if (!validateWorkerMessage(rawMessage)) {
      this.logger.warn(`Received invalid message from plugin ${this.config.pluginId}`);
      return;
    }

    const message = rawMessage as WorkerMessage;
    const { type, id, payload } = message;

    // Track message count for stats
    this.messageCount++;

    switch (type) {
      case 'response': {
        if (id && this.pendingRequests.has(id)) {
          const pending = this.pendingRequests.get(id)!;
          clearTimeout(pending.timer);
          this.pendingRequests.delete(id);
          pending.resolve(payload);
        }
        break;
      }

      case 'error': {
        this.errorCount++;
        const errorPayload = payload as { message: string; stack?: string };
        // Sanitize error message
        const sanitizedMessage = String(errorPayload.message).slice(0, 1000);
        const error = new Error(sanitizedMessage);
        if (errorPayload.stack) {
          error.stack = String(errorPayload.stack).slice(0, 5000);
        }

        if (id && this.pendingRequests.has(id)) {
          const pending = this.pendingRequests.get(id)!;
          clearTimeout(pending.timer);
          this.pendingRequests.delete(id);
          pending.reject(error);
        } else {
          this.logger.error('Worker error:', error);
          this.emit('error', error);
        }
        break;
      }

      case 'log': {
        const logPayload = payload as { level: string; message: string; args: unknown[]; pluginId: string };
        // Validate log level
        const validLevels = ['debug', 'info', 'warn', 'error'];
        const level = validLevels.includes(logPayload.level) ? logPayload.level : 'info';
        const logFn = (this.logger as unknown as Record<string, (...args: unknown[]) => void>)[level] ?? this.logger.info;
        // Sanitize log output
        const sanitizedMessage = String(logPayload.message).slice(0, 1000);
        logFn.call(this.logger, `[${this.config.pluginId}] ${sanitizedMessage}`);
        break;
      }

      case 'register-tool': {
        // Additional validation: ensure tool name is prefixed with plugin ID for namespacing
        const tool = payload as { name: string; [key: string]: unknown };
        if (!tool.name.startsWith(`${this.config.pluginId}:`)) {
          this.logger.warn(`Tool registration rejected: name must be prefixed with plugin ID (${this.config.pluginId}:)`);
          return;
        }
        this.emit('register-tool', payload);
        break;
      }

      case 'register-command': {
        // Additional validation: ensure command name is prefixed with plugin ID for namespacing
        const command = payload as { name: string; [key: string]: unknown };
        if (!command.name.startsWith(`${this.config.pluginId}:`)) {
          this.logger.warn(`Command registration rejected: name must be prefixed with plugin ID (${this.config.pluginId}:)`);
          return;
        }
        this.emit('register-command', payload);
        break;
      }
    }
  }

  /** Message count for stats */
  private messageCount = 0;
  /** Error count for stats */
  private errorCount = 0;

  /**
   * Resolve plugin worker path in both ESM and CommonJS transpilation contexts.
   * Jest transpiles TS to CommonJS for tests, where direct `import.meta.url`
   * syntax is rejected by TypeScript (TS1343).
   */
  private resolveWorkerPath(): string {
    try {
      const moduleUrl = Function('return import.meta.url')() as string;
      return fileURLToPath(new URL('plugin-worker.js', moduleUrl));
    } catch {
      const baseDir =
        typeof __dirname !== 'undefined'
          ? __dirname
          : path.join(process.cwd(), 'dist', 'plugins');
      return path.join(baseDir, 'plugin-worker.js');
    }
  }

  /**
   * Start the worker and initialize the plugin
   */
  async start(): Promise<void> {
    if (this.worker) {
      throw new Error('Worker already running');
    }

    // Validate configuration before starting
    const configErrors = validateConfig(this.config);
    if (configErrors.length > 0) {
      throw new Error(`Invalid plugin configuration: ${configErrors.join(', ')}`);
    }

    this.isTerminated = false;
    this.messageCount = 0;
    this.errorCount = 0;

    // Get the worker script path (compiled JS)
    const workerPath = this.resolveWorkerPath();

    // Calculate memory limits
    const memoryLimitMb = this.config.memoryLimitMb ?? 128;

    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(workerPath, {
          // Worker options for isolation
          // Only pass through env if permission granted, and only safe subset
          env: this.config.permissions.env ? this.getSafeEnv() : {},
          // Restrict resource limits based on config
          resourceLimits: {
            maxOldGenerationSizeMb: memoryLimitMb, // Configurable heap
            maxYoungGenerationSizeMb: Math.min(32, memoryLimitMb / 4), // 32MB or 1/4 of heap
            codeRangeSizeMb: 32, // 32MB for code
            stackSizeMb: 4, // 4MB stack
          },
        });

        this.worker.on('message', (message: WorkerMessage) => {
          // Handle initial ready message
          if (message.type === 'response' && (message.payload as { ready?: boolean })?.ready) {
            // Worker is ready, now initialize the plugin
            this.initializePlugin()
              .then(() => resolve())
              .catch(reject);
            return;
          }
          this.handleWorkerMessage(message);
        });

        this.worker.on('error', (error) => {
          this.logger.error('Worker error:', error);
          this.emit('error', error);
          reject(error);
        });

        this.worker.on('exit', (code) => {
          this.isTerminated = true;
          this.worker = null;

          // Reject all pending requests
          for (const [_id, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(new Error(`Worker exited with code ${code}`));
          }
          this.pendingRequests.clear();

          this.emit('exit', code);
          this.logger.debug(`Worker exited with code ${code}`);
        });

        this.worker.on('messageerror', (error) => {
          this.logger.error('Worker message error:', error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Initialize the plugin in the worker
   */
  private async initializePlugin(): Promise<void> {
    const entryPoint = path.join(this.config.pluginPath, 'index.js');

    await this.sendMessage('init', {
      pluginPath: entryPoint,
      pluginId: this.config.pluginId,
      dataDir: this.config.dataDir,
      config: this.config.config,
      permissions: this.config.permissions,
    });
  }

  /**
   * Activate the plugin
   */
  async activate(): Promise<void> {
    await this.sendMessage('activate');
  }

  /**
   * Deactivate the plugin
   */
  async deactivate(): Promise<void> {
    if (!this.worker || this.isTerminated) {
      return;
    }

    try {
      await this.sendMessage('deactivate', undefined, 5000); // 5s timeout for deactivation
    } catch (err) {
      this.logger.warn(`Failed to deactivate plugin gracefully: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Call a method on the plugin
   */
  async call<T>(method: string, ...args: unknown[]): Promise<T> {
    const result = await this.sendMessage('call', { method, args });
    return (result as { result: T }).result;
  }

  /**
   * Terminate the worker immediately
   */
  async terminate(): Promise<void> {
    if (!this.worker || this.isTerminated) {
      return;
    }

    this.isTerminated = true;

    // Cancel all pending requests
    for (const [_id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Worker terminated'));
    }
    this.pendingRequests.clear();

    try {
      await this.worker.terminate();
    } catch (err) {
      this.logger.error(`Failed to terminate worker: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.worker = null;
    this.emit('terminated');
  }

  /**
   * Check if the worker is running
   */
  isRunning(): boolean {
    return this.worker !== null && !this.isTerminated;
  }

  /**
   * Get the plugin ID
   */
  getPluginId(): string {
    return this.config.pluginId;
  }

  /**
   * Get execution statistics for this plugin
   */
  getStats() {
    return {
      pluginId: this.config.pluginId,
      isRunning: this.isRunning(),
      messageCount: this.messageCount,
      errorCount: this.errorCount,
      memoryLimitMb: this.config.memoryLimitMb ?? 128,
      timeoutMs: this.defaultTimeout,
    };
  }

  /**
   * Get a safe subset of environment variables
   * Filters out sensitive variables that shouldn't be passed to plugins
   */
  private getSafeEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };

    // List of sensitive env vars that should never be passed to plugins
    const sensitiveVars = [
      // API keys and secrets
      'GROK_API_KEY',
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'MORPH_API_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_ACCESS_KEY_ID',
      'GITHUB_TOKEN',
      'GH_TOKEN',
      'GITLAB_TOKEN',
      'NPM_TOKEN',
      'DOCKER_PASSWORD',
      // Database credentials
      'DATABASE_URL',
      'DB_PASSWORD',
      'REDIS_URL',
      'MONGO_URI',
      // SSH and encryption
      'SSH_AUTH_SOCK',
      'GPG_TTY',
      // Other sensitive
      'SUDO_ASKPASS',
      'HISTFILE',
    ];

    // Also filter any var containing these patterns
    const sensitivePatterns = [
      /SECRET/i,
      /PASSWORD/i,
      /TOKEN/i,
      /KEY$/i,
      /CREDENTIALS/i,
      /PRIVATE/i,
    ];

    for (const key of Object.keys(env)) {
      if (sensitiveVars.includes(key)) {
        delete env[key];
        continue;
      }
      for (const pattern of sensitivePatterns) {
        if (pattern.test(key)) {
          delete env[key];
          break;
        }
      }
    }

    return env;
  }
}

/**
 * Factory function to create an isolated plugin runner
 */
export function createIsolatedPluginRunner(config: IsolatedPluginConfig): IsolatedPluginRunner {
  return new IsolatedPluginRunner(config);
}
