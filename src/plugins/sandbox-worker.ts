/**
 * Plugin Sandbox Worker
 *
 * Executes plugins in isolated worker threads with restricted capabilities.
 * This provides security isolation between plugins and the main application.
 *
 * Features:
 * - Memory isolation via Worker threads
 * - Restricted API surface
 * - Timeout protection
 * - Resource limits
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as path from 'path';
import * as vm from 'vm';
import * as fs from 'fs/promises';

// ============================================================================
// Types
// ============================================================================

export interface SandboxOptions {
  timeout: number;
  memoryLimit: number;
  permissions: SandboxPermission[];
  pluginPath: string;
  pluginId: string;
}

export interface SandboxPermission {
  type: 'filesystem' | 'network' | 'env' | 'timer';
  scope?: string;
}

export interface SandboxMessage {
  type: 'init' | 'call' | 'result' | 'error' | 'log';
  id?: string;
  method?: string;
  args?: unknown[];
  result?: unknown;
  error?: string;
  level?: string;
  message?: string;
}

export interface SandboxAPI {
  call: (method: string, args: unknown[]) => Promise<unknown>;
  terminate: () => Promise<void>;
}

// ============================================================================
// Worker Thread Code (runs in sandbox)
// ============================================================================

if (!isMainThread && parentPort) {
  const port = parentPort;
  const data = workerData as SandboxOptions;

  // Create restricted context
  const createSandboxedGlobals = (permissions: SandboxPermission[]) => {
    const hasPermission = (type: string) =>
      permissions.some(p => p.type === type);

    const globals: Record<string, unknown> = {
      // Safe built-ins
      console: {
        log: (...args: unknown[]) => port.postMessage({ type: 'log', level: 'info', message: args.join(' ') }),
        error: (...args: unknown[]) => port.postMessage({ type: 'log', level: 'error', message: args.join(' ') }),
        warn: (...args: unknown[]) => port.postMessage({ type: 'log', level: 'warn', message: args.join(' ') }),
        info: (...args: unknown[]) => port.postMessage({ type: 'log', level: 'info', message: args.join(' ') }),
      },
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Promise,
      Symbol,
      RegExp,
      Error,
      TypeError,
      RangeError,
      SyntaxError,

      // Restricted timers (only if permitted)
      setTimeout: hasPermission('timer')
        ? (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, data.timeout))
        : undefined,
      setInterval: hasPermission('timer')
        ? (fn: () => void, ms: number) => setInterval(fn, Math.max(ms, 100))
        : undefined,
      clearTimeout: hasPermission('timer') ? clearTimeout : undefined,
      clearInterval: hasPermission('timer') ? clearInterval : undefined,

      // Plugin API (injected by main thread)
      __pluginAPI: null as unknown,
    };

    // Remove undefined values
    for (const key of Object.keys(globals)) {
      if (globals[key] === undefined) {
        delete globals[key];
      }
    }

    return globals;
  };

  let pluginModule: { activate?: (api: unknown) => unknown; deactivate?: () => void } | null = null;
  let pluginAPI: unknown = null;

  port.on('message', async (msg: SandboxMessage) => {
    try {
      switch (msg.type) {
        case 'init': {
          // Load plugin in sandboxed context
          const code = await fs.readFile(data.pluginPath, 'utf-8');

          // Create sandbox context
          const sandbox = createSandboxedGlobals(data.permissions);

          // Inject plugin API
          pluginAPI = msg.args?.[0];
          sandbox.__pluginAPI = pluginAPI;

          // Create module wrapper
          const wrappedCode = `
            (function(module, exports, __pluginAPI) {
              const api = __pluginAPI;
              ${code}
              return module.exports;
            })
          `;

          // Execute in sandbox
          const context = vm.createContext(sandbox, {
            codeGeneration: { strings: false, wasm: false },
          });

          const moduleObj = { exports: {} };
          const factory = vm.runInContext(wrappedCode, context, {
            timeout: data.timeout,
            filename: data.pluginPath,
          });

          pluginModule = factory(moduleObj, moduleObj.exports, pluginAPI);

          // Activate plugin
          if (typeof pluginModule?.activate === 'function') {
            await pluginModule.activate(pluginAPI);
          }

          port.postMessage({ type: 'result', id: msg.id, result: true });
          break;
        }

        case 'call': {
          if (!pluginModule) {
            throw new Error('Plugin not initialized');
          }

          const method = msg.method as keyof typeof pluginModule;
          const fn = pluginModule[method];

          if (typeof fn !== 'function') {
            throw new Error(`Method ${msg.method} not found`);
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (fn as (...args: any[]) => any).apply(pluginModule, msg.args || []);
          port.postMessage({ type: 'result', id: msg.id, result });
          break;
        }
      }
    } catch (error) {
      port.postMessage({
        type: 'error',
        id: msg.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

// ============================================================================
// Main Thread API
// ============================================================================

export class PluginSandbox {
  private worker: Worker | null = null;
  private pendingCalls: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();
  private messageId = 0;
  private options: SandboxOptions;
  private onLog?: (level: string, message: string) => void;

  constructor(options: SandboxOptions, onLog?: (level: string, message: string) => void) {
    this.options = options;
    this.onLog = onLog;
  }

  /**
   * Initialize the sandbox and load the plugin
   */
  async initialize(pluginAPI: unknown): Promise<void> {
    // Create worker with resource limits
    this.worker = new Worker(__filename, {
      workerData: this.options,
      resourceLimits: {
        maxOldGenerationSizeMb: Math.floor(this.options.memoryLimit / (1024 * 1024)),
        maxYoungGenerationSizeMb: Math.floor(this.options.memoryLimit / (1024 * 1024 * 4)),
        stackSizeMb: 4,
      },
    });

    // Handle messages from worker
    this.worker.on('message', (msg: SandboxMessage) => {
      if (msg.type === 'log' && this.onLog) {
        this.onLog(msg.level || 'info', msg.message || '');
        return;
      }

      if (msg.id) {
        const pending = this.pendingCalls.get(msg.id);
        if (pending) {
          this.pendingCalls.delete(msg.id);
          if (msg.type === 'error') {
            pending.reject(new Error(msg.error || 'Unknown error'));
          } else {
            pending.resolve(msg.result);
          }
        }
      }
    });

    // Handle worker errors
    this.worker.on('error', (error) => {
      for (const pending of this.pendingCalls.values()) {
        pending.reject(error);
      }
      this.pendingCalls.clear();
    });

    // Initialize plugin
    await this.sendMessage('init', [pluginAPI]);
  }

  /**
   * Call a method on the sandboxed plugin
   */
  async call(method: string, args: unknown[] = []): Promise<unknown> {
    return this.sendMessage('call', args, method);
  }

  /**
   * Send message to worker and wait for response
   */
  private sendMessage(type: string, args: unknown[], method?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Sandbox not initialized'));
        return;
      }

      const id = String(++this.messageId);
      this.pendingCalls.set(id, { resolve, reject });

      // Set timeout for the call
      const timeoutId = setTimeout(() => {
        this.pendingCalls.delete(id);
        reject(new Error(`Sandbox call timed out after ${this.options.timeout}ms`));
      }, this.options.timeout);

      // Wrap resolve to clear timeout
      const originalResolve = this.pendingCalls.get(id)!.resolve;
      this.pendingCalls.get(id)!.resolve = (value) => {
        clearTimeout(timeoutId);
        originalResolve(value);
      };

      this.worker.postMessage({ type, id, method, args } as SandboxMessage);
    });
  }

  /**
   * Terminate the sandbox
   */
  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }

    for (const pending of this.pendingCalls.values()) {
      pending.reject(new Error('Sandbox terminated'));
    }
    this.pendingCalls.clear();
  }

  /**
   * Check if sandbox is running
   */
  isRunning(): boolean {
    return this.worker !== null;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a sandboxed plugin instance
 */
export async function createPluginSandbox(
  pluginPath: string,
  pluginId: string,
  permissions: SandboxPermission[],
  pluginAPI: unknown,
  options: {
    timeout?: number;
    memoryLimit?: number;
    onLog?: (level: string, message: string) => void;
  } = {}
): Promise<PluginSandbox> {
  // Validate plugin path
  const normalizedPath = path.normalize(path.resolve(pluginPath));
  if (normalizedPath.includes('..') || normalizedPath.includes('\0')) {
    throw new Error('Invalid plugin path');
  }

  const sandbox = new PluginSandbox({
    pluginPath: normalizedPath,
    pluginId,
    permissions,
    timeout: options.timeout || 30000,
    memoryLimit: options.memoryLimit || 128 * 1024 * 1024, // 128MB default
  }, options.onLog);

  await sandbox.initialize(pluginAPI);
  return sandbox;
}
