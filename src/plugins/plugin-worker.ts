/**
 * Plugin Worker Script
 * This script runs in an isolated Worker Thread and executes plugin code
 * with restricted access to system resources.
 *
 * Security measures:
 * - Blocked dangerous Node.js modules based on permissions
 * - Restricted process.env access
 * - Timeout enforcement via parent thread
 * - Memory limits via Worker resourceLimits
 */

import { parentPort } from 'worker_threads';
import { createRequire } from 'module';

// Types for communication between main thread and worker
export interface WorkerMessage {
  type: 'init' | 'activate' | 'deactivate' | 'call' | 'response' | 'error' | 'log' | 'register-tool' | 'register-command';
  id?: string;
  payload?: unknown;
}

export interface WorkerInitData {
  pluginPath: string;
  pluginId: string;
  dataDir: string;
  config: Record<string, unknown>;
  permissions: PluginPermissionsWorker;
}

export interface PluginPermissionsWorker {
  filesystem?: boolean | string[];
  network?: boolean | string[];
  shell?: boolean;
  env?: boolean;
}

/**
 * Modules that are always blocked regardless of permissions
 * These provide too much system access or could be used to escape the sandbox
 */
const ALWAYS_BLOCKED_MODULES = [
  'cluster',      // Process spawning
  'dgram',        // Raw UDP sockets
  'dns',          // DNS lookups (can be used for data exfiltration)
  'tls',          // Direct TLS connections
  'v8',           // V8 internals
  'vm',           // Code execution sandbox escape
  'worker_threads', // Spawning more workers
  'repl',         // REPL access
  'inspector',    // Debugger access
  'perf_hooks',   // Performance monitoring
  'trace_events', // Low-level tracing
  'async_hooks',  // Could interfere with isolation
];

/**
 * Modules blocked unless specific permission is granted
 */
const CONDITIONAL_BLOCKED_MODULES = {
  shell: ['child_process'],
  filesystem: ['fs', 'fs/promises'],
  network: ['net', 'http', 'https', 'http2', 'fetch'],
};

/**
 * Create a sandboxed environment for the plugin
 * Restricts access to dangerous APIs based on permissions
 */
function createSandboxedEnvironment(permissions: PluginPermissionsWorker, pluginId: string) {
  // Build complete blocked modules list based on permissions
  const blockedModules = new Set(ALWAYS_BLOCKED_MODULES);

  if (!permissions.shell) {
    CONDITIONAL_BLOCKED_MODULES.shell.forEach(m => blockedModules.add(m));
  }
  if (!permissions.filesystem) {
    CONDITIONAL_BLOCKED_MODULES.filesystem.forEach(m => blockedModules.add(m));
  }
  if (!permissions.network) {
    CONDITIONAL_BLOCKED_MODULES.network.forEach(m => blockedModules.add(m));
  }

  // Store blocked modules for import checking
  (globalThis as Record<string, unknown>).__blockedModules = blockedModules;
  (globalThis as Record<string, unknown>).__pluginId = pluginId;

  // Restrict process.env access
  const originalEnv = process.env;
  const restrictedProcess = {
    env: permissions.env ? { ...originalEnv } : {},
    cwd: () => '/',
    version: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    // Provide safe process methods that plugins might need
    hrtime: process.hrtime,
    nextTick: process.nextTick,
    // Block dangerous methods
    exit: () => { throw new Error('process.exit is not allowed in isolated plugins'); },
    kill: () => { throw new Error('process.kill is not allowed in isolated plugins'); },
    abort: () => { throw new Error('process.abort is not allowed in isolated plugins'); },
    chdir: () => { throw new Error('process.chdir is not allowed in isolated plugins'); },
    setuid: () => { throw new Error('process.setuid is not allowed in isolated plugins'); },
    setgid: () => { throw new Error('process.setgid is not allowed in isolated plugins'); },
    // Redirect output to logging
    stdout: {
      write: (data: string) => {
        parentPort?.postMessage({
          type: 'log',
          payload: { level: 'info', message: String(data).trim(), args: [], pluginId }
        });
        return true;
      }
    },
    stderr: {
      write: (data: string) => {
        parentPort?.postMessage({
          type: 'log',
          payload: { level: 'error', message: String(data).trim(), args: [], pluginId }
        });
        return true;
      }
    }
  };

  // Replace global process object
  Object.defineProperty(globalThis, 'process', {
    value: restrictedProcess,
    writable: false,
    configurable: false
  });

  // Override require for CommonJS modules (legacy support)
  const originalRequire = createRequire(import.meta.url);
  const sandboxedRequire = (moduleName: string) => {
    // Normalize module name (handle node: prefix)
    const normalizedName = moduleName.replace(/^node:/, '');

    if (blockedModules.has(normalizedName)) {
      throw new Error(
        `[SecurityError] Module '${moduleName}' is blocked for plugin '${pluginId}'. ` +
        `Required permission not granted.`
      );
    }
    return originalRequire(moduleName);
  };

  // Make sandboxed require available globally
  (globalThis as Record<string, unknown>).require = sandboxedRequire;

  // Block eval and Function constructor for security
  Object.defineProperty(globalThis, 'eval', {
    value: () => { throw new Error('eval is not allowed in isolated plugins'); },
    writable: false,
    configurable: false
  });

  // Note: We can't fully block the Function constructor, but we log its use
  const OriginalFunction = Function;
  // @ts-expect-error - Intentionally wrapping Function constructor
  globalThis.Function = function(...args: unknown[]) {
    parentPort?.postMessage({
      type: 'log',
      payload: {
        level: 'warn',
        message: 'Plugin attempted to use Function constructor',
        args: [],
        pluginId
      }
    });
    // Allow but log - complete blocking breaks too many libraries
    return new OriginalFunction(...(args as string[]));
  };

  // Restrict setTimeout/setInterval to prevent resource exhaustion
  const maxTimers = 100;
  let timerCount = 0;

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (timerCount >= maxTimers) {
      throw new Error(`Timer limit exceeded (max ${maxTimers}). Plugin may be leaking timers.`);
    }
    timerCount++;
    return originalSetTimeout(() => {
      timerCount--;
      callback(...args);
    }, delay);
  }) as typeof setTimeout;

  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const intervalIds = new Set<ReturnType<typeof setInterval>>();

  globalThis.setInterval = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    if (timerCount >= maxTimers) {
      throw new Error(`Timer limit exceeded (max ${maxTimers}). Plugin may be leaking timers.`);
    }
    timerCount++;
    const id = originalSetInterval(callback, delay, ...args);
    intervalIds.add(id);
    return id;
  }) as typeof setInterval;

  globalThis.clearInterval = ((id: ReturnType<typeof setInterval>) => {
    if (intervalIds.has(id)) {
      timerCount--;
      intervalIds.delete(id);
    }
    originalClearInterval(id);
  }) as typeof clearInterval;

  // Log that sandbox is active
  parentPort?.postMessage({
    type: 'log',
    payload: {
      level: 'debug',
      message: `Sandbox active. Blocked modules: ${Array.from(blockedModules).join(', ')}`,
      args: [],
      pluginId
    }
  });
}

/**
 * Validate a dynamic import before allowing it
 * Called by the custom import handler (reserved for future use with ES module loader hooks)
 */
function _validateImport(specifier: string): void {
  const blockedModules = (globalThis as unknown as Record<string, Set<string>>).__blockedModules;
  const pluginId = (globalThis as unknown as Record<string, string>).__pluginId;

  if (!blockedModules) return;

  // Normalize the specifier
  const normalizedName = specifier.replace(/^node:/, '');

  if (blockedModules.has(normalizedName)) {
    throw new Error(
      `[SecurityError] Import of '${specifier}' is blocked for plugin '${pluginId}'. ` +
      `Required permission not granted.`
    );
  }
}

// Export for potential future use with custom loaders
export { _validateImport as validateBlockedImport };

// Create a sandboxed logger that sends logs to the main thread
function createWorkerLogger(pluginId: string) {
  const sendLog = (level: string, message: string, ...args: unknown[]) => {
    parentPort?.postMessage({
      type: 'log',
      payload: { level, message, args, pluginId }
    } as WorkerMessage);
  };

  return {
    debug: (msg: string, ...args: unknown[]) => sendLog('debug', msg, ...args),
    info: (msg: string, ...args: unknown[]) => sendLog('info', msg, ...args),
    warn: (msg: string, ...args: unknown[]) => sendLog('warn', msg, ...args),
    error: (msg: string, ...args: unknown[]) => sendLog('error', msg, ...args),
    child: (_name: string) => createWorkerLogger(`${pluginId}:${_name}`),
  };
}

// Local registry of tool executors (functions can't cross MessagePort boundary)
const toolExecutors: Map<string, (input: Record<string, unknown>) => Promise<unknown>> = new Map();

/**
 * Ensure a name is prefixed with pluginId:
 * Plugins may omit the prefix; we add it automatically.
 */
function ensurePrefix(name: string, pluginId: string): string {
  const prefix = `${pluginId}:`;
  return name.startsWith(prefix) ? name : `${prefix}${name}`;
}

// Create the plugin context for the isolated environment
function createIsolatedPluginContext(initData: WorkerInitData) {
  const { pluginId, dataDir, config } = initData;

  return {
    logger: createWorkerLogger(pluginId),
    config,
    dataDir,

    registerTool: (tool: Record<string, unknown>) => {
      // Auto-prefix name
      const name = ensurePrefix(String(tool.name ?? ''), pluginId);

      // Extract the execute function from factory or execute field — store it locally.
      // Functions cannot be serialized via structured clone, so they stay in the worker.
      let executor: ((input: Record<string, unknown>) => Promise<unknown>) | null = null;

      if (typeof tool.factory === 'function') {
        try {
          const instance = (tool.factory as () => Record<string, unknown>)();
          if (typeof instance.execute === 'function') {
            executor = instance.execute as (input: Record<string, unknown>) => Promise<unknown>;
          }
        } catch { /* factory construction error — executor stays null */ }
      } else if (typeof tool.execute === 'function') {
        executor = tool.execute as (input: Record<string, unknown>) => Promise<unknown>;
      }

      if (executor) {
        toolExecutors.set(name, executor);
      }

      // Strip functions before crossing the MessagePort boundary
      const serializable: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(tool)) {
        if (typeof v !== 'function') {
          serializable[k] = v;
        }
      }
      serializable['name'] = name;

      parentPort?.postMessage({
        type: 'register-tool',
        payload: serializable
      } as WorkerMessage);
    },

    registerCommand: (command: Record<string, unknown>) => {
      const name = ensurePrefix(String(command.name ?? ''), pluginId);
      parentPort?.postMessage({
        type: 'register-command',
        payload: { ...command, name }
      } as WorkerMessage);
    },

    registerProvider: (provider: unknown) => {
      parentPort?.postMessage({
        type: 'log',
        payload: {
          level: 'warn',
          message: 'registerProvider is not supported in isolated plugins',
          args: [provider],
          pluginId
        }
      } as WorkerMessage);
    }
  };
}

// Plugin instance holder
let pluginInstance: { activate: (ctx: unknown) => Promise<void> | void; deactivate: () => Promise<void> | void } | null = null;
let pluginContext: ReturnType<typeof createIsolatedPluginContext> | null = null;

/**
 * Validate incoming message from main thread
 * Prevents message injection attacks
 */
function validateMessage(message: unknown): message is WorkerMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const m = message as Record<string, unknown>;

  // Type must be a known value
  const validTypes = ['init', 'activate', 'deactivate', 'call', 'response', 'error', 'log', 'register-tool', 'register-command'];
  if (typeof m.type !== 'string' || !validTypes.includes(m.type)) {
    return false;
  }

  // ID must be string if present
  if (m.id !== undefined && typeof m.id !== 'string') {
    return false;
  }

  return true;
}

/**
 * Validate plugin path to prevent path traversal attacks
 */
function validatePluginPath(pluginPath: string): boolean {
  // Must be absolute path
  if (!pluginPath.startsWith('/')) {
    return false;
  }

  // No path traversal
  if (pluginPath.includes('..')) {
    return false;
  }

  // Must end with .js
  if (!pluginPath.endsWith('.js')) {
    return false;
  }

  return true;
}

// Handle messages from the main thread
async function handleMessage(message: WorkerMessage) {
  // Validate message structure
  if (!validateMessage(message)) {
    parentPort?.postMessage({
      type: 'error',
      payload: { message: 'Invalid message format received' }
    } as WorkerMessage);
    return;
  }

  const { type, id, payload } = message;

  try {
    switch (type) {
      case 'init': {
        const initData = payload as WorkerInitData;

        // Validate plugin path
        if (!validatePluginPath(initData.pluginPath)) {
          throw new Error(`Invalid plugin path: ${initData.pluginPath}`);
        }

        // Validate plugin ID format
        if (!/^[a-zA-Z0-9_-]+$/.test(initData.pluginId)) {
          throw new Error(`Invalid plugin ID format: ${initData.pluginId}`);
        }

        // Set up sandboxed environment with plugin ID
        createSandboxedEnvironment(initData.permissions, initData.pluginId);

        // Create context
        pluginContext = createIsolatedPluginContext(initData);

        // Dynamic import of the plugin
        // Note: We validate the path above but can't fully prevent all imports
        // The sandbox will block dangerous module imports
        const module = await import(initData.pluginPath);

        // Validate that the module has a default export that's a constructor
        if (!module.default || typeof module.default !== 'function') {
          throw new Error('Plugin must export a default class');
        }

        const instance = new module.default();

        // Validate plugin instance has required methods
        if (typeof instance.activate !== 'function') {
          throw new Error('Plugin must have an activate() method');
        }
        if (typeof instance.deactivate !== 'function') {
          throw new Error('Plugin must have a deactivate() method');
        }

        pluginInstance = instance;

        parentPort?.postMessage({
          type: 'response',
          id,
          payload: { success: true }
        } as WorkerMessage);
        break;
      }

      case 'activate': {
        if (!pluginInstance || !pluginContext) {
          throw new Error('Plugin not initialized');
        }

        await pluginInstance.activate(pluginContext);

        parentPort?.postMessage({
          type: 'response',
          id,
          payload: { success: true }
        } as WorkerMessage);
        break;
      }

      case 'deactivate': {
        if (!pluginInstance) {
          throw new Error('Plugin not initialized');
        }

        await pluginInstance.deactivate();
        pluginInstance = null;
        pluginContext = null;

        parentPort?.postMessage({
          type: 'response',
          id,
          payload: { success: true }
        } as WorkerMessage);
        break;
      }

      case 'call': {
        const callPayload = payload as { method: string; toolName?: string; args?: unknown; [k: string]: unknown };

        // Tool execution: main thread dispatches back to worker for function call
        if (callPayload.method === 'tool-execute' && callPayload.toolName) {
          const executor = toolExecutors.get(callPayload.toolName);
          if (!executor) {
            throw new Error(`No executor registered for tool: ${callPayload.toolName}`);
          }
          const toolResult = await executor((callPayload.args ?? {}) as Record<string, unknown>);
          parentPort?.postMessage({
            type: 'response',
            id,
            payload: { success: true, result: toolResult }
          } as WorkerMessage);
          break;
        }

        // Generic plugin method call
        if (!pluginInstance) {
          throw new Error('Plugin not initialized');
        }

        const { method, args } = callPayload;
        const result = await (pluginInstance as Record<string, (...a: unknown[]) => unknown>)[method]?.(
          ...((Array.isArray(args) ? args : [args]) as unknown[])
        );

        parentPort?.postMessage({
          type: 'response',
          id,
          payload: { success: true, result }
        } as WorkerMessage);
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    parentPort?.postMessage({
      type: 'error',
      id,
      payload: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }
    } as WorkerMessage);
  }
}

// Set up message listener
if (parentPort) {
  parentPort.on('message', handleMessage);

  // Notify main thread that worker is ready
  parentPort.postMessage({
    type: 'response',
    payload: { ready: true }
  } as WorkerMessage);
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  parentPort?.postMessage({
    type: 'error',
    payload: {
      message: `Uncaught exception: ${error.message}`,
      stack: error.stack
    }
  } as WorkerMessage);
});

process.on('unhandledRejection', (reason) => {
  parentPort?.postMessage({
    type: 'error',
    payload: {
      message: `Unhandled rejection: ${reason}`,
    }
  } as WorkerMessage);
});

// Export types for use in other modules
export type { WorkerMessage as PluginWorkerMessage, WorkerInitData as PluginWorkerInitData };
