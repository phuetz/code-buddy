/**
 * E2B Cloud Sandbox
 *
 * Cloud-based sandboxed execution using E2B (e2b.dev) Firecracker microVMs.
 * Alternative to DockerSandbox for cases where Docker isn't available
 * or full VM isolation is needed (Manus AI pattern).
 *
 * Features:
 * - Firecracker microVM per task (full isolation)
 * - Pre-installed Python, Node.js, browser headless
 * - Persistent filesystem within session
 * - Network access for dependency installation
 *
 * Requires: E2B_API_KEY environment variable
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface E2BSandboxConfig {
  /** E2B template ID (default: 'base') */
  template: string;
  /** Timeout for sandbox creation in ms */
  createTimeout: number;
  /** Timeout for command execution in ms */
  commandTimeout: number;
  /** Memory in MB (default: 512) */
  memoryMb: number;
  /** CPUs (default: 1) */
  cpus: number;
  /** Keep sandbox alive between commands */
  keepAlive: boolean;
  /** Sandbox idle timeout in ms before auto-shutdown (default: 300000 = 5 min) */
  idleTimeout: number;
}

export interface E2BSandboxResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  durationMs: number;
  sandboxId?: string;
}

export interface E2BFileInfo {
  path: string;
  size: number;
  isDir: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_E2B_CONFIG: E2BSandboxConfig = {
  template: 'base',
  createTimeout: 30000,
  commandTimeout: 120000,
  memoryMb: 512,
  cpus: 1,
  keepAlive: true,
  idleTimeout: 300000,
};

// ============================================================================
// E2B Cloud Sandbox
// ============================================================================

export class E2BSandbox {
  private config: E2BSandboxConfig;
  private sandboxId: string | null = null;
  private sdk: E2BSDKWrapper | null = null;
  private lastActivity: number = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config?: Partial<E2BSandboxConfig>) {
    this.config = { ...DEFAULT_E2B_CONFIG, ...config };
  }

  /**
   * Check if E2B is available (API key configured)
   */
  static isAvailable(): boolean {
    return !!process.env.E2B_API_KEY;
  }

  /**
   * Get the API key
   */
  private getApiKey(): string {
    const key = process.env.E2B_API_KEY;
    if (!key) {
      throw new Error('E2B_API_KEY environment variable is not set. Get one at https://e2b.dev');
    }
    return key;
  }

  /**
   * Create or reuse a sandbox instance
   */
  async ensureSandbox(): Promise<string> {
    if (this.sandboxId && this.sdk) {
      this.touchActivity();
      return this.sandboxId;
    }

    const apiKey = this.getApiKey();
    this.sdk = new E2BSDKWrapper(apiKey);

    logger.info(`Creating E2B sandbox (template: ${this.config.template})...`);
    const startTime = Date.now();

    const sandboxId = await this.sdk.create({
      template: this.config.template,
      timeout: this.config.createTimeout,
    });

    this.sandboxId = sandboxId;
    this.touchActivity();

    logger.info(`E2B sandbox created: ${sandboxId} (${Date.now() - startTime}ms)`);
    return sandboxId;
  }

  /**
   * Execute a command in the sandbox
   */
  async execute(
    command: string,
    options?: { timeout?: number; cwd?: string; env?: Record<string, string> }
  ): Promise<E2BSandboxResult> {
    const startTime = Date.now();

    try {
      await this.ensureSandbox();
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
        exitCode: 1,
        durationMs: Date.now() - startTime,
      };
    }

    const timeout = options?.timeout ?? this.config.commandTimeout;

    try {
      const result = await this.sdk!.exec(this.sandboxId!, command, {
        timeout,
        cwd: options?.cwd,
        env: options?.env,
      });

      this.touchActivity();

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.stderr || undefined,
        exitCode: result.exitCode,
        durationMs: Date.now() - startTime,
        sandboxId: this.sandboxId!,
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
        exitCode: 1,
        durationMs: Date.now() - startTime,
        sandboxId: this.sandboxId ?? undefined,
      };
    }
  }

  /**
   * Write a file to the sandbox filesystem
   */
  async writeFile(path: string, content: string): Promise<void> {
    await this.ensureSandbox();
    await this.sdk!.writeFile(this.sandboxId!, path, content);
    this.touchActivity();
  }

  /**
   * Read a file from the sandbox filesystem
   */
  async readFile(path: string): Promise<string> {
    await this.ensureSandbox();
    this.touchActivity();
    return await this.sdk!.readFile(this.sandboxId!, path);
  }

  /**
   * List files in the sandbox
   */
  async listFiles(dir: string = '/workspace'): Promise<E2BFileInfo[]> {
    await this.ensureSandbox();
    this.touchActivity();
    return await this.sdk!.listFiles(this.sandboxId!, dir);
  }

  /**
   * Upload a file to the sandbox
   */
  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    const fs = await import('fs/promises');
    const content = await fs.readFile(localPath, 'utf8');
    await this.writeFile(remotePath, content);
  }

  /**
   * Install packages in the sandbox
   */
  async installPackages(
    packages: string[],
    language: 'python' | 'node' = 'node'
  ): Promise<E2BSandboxResult> {
    const cmd = language === 'python'
      ? `pip install ${packages.join(' ')}`
      : `npm install ${packages.join(' ')}`;

    return this.execute(cmd, { timeout: 120000 });
  }

  /**
   * Run a script in the sandbox
   */
  async runScript(
    script: string,
    language: 'python' | 'typescript' | 'javascript' | 'shell'
  ): Promise<E2BSandboxResult> {
    const ext = { python: 'py', typescript: 'ts', javascript: 'js', shell: 'sh' }[language];
    const filename = `/workspace/script_${Date.now()}.${ext}`;
    await this.writeFile(filename, script);

    const runners: Record<string, string> = {
      python: `python ${filename}`,
      typescript: `npx tsx ${filename}`,
      javascript: `node ${filename}`,
      shell: `sh ${filename}`,
    };

    return this.execute(runners[language]);
  }

  /**
   * Get sandbox info
   */
  getSandboxId(): string | null {
    return this.sandboxId;
  }

  /**
   * Check if sandbox is active
   */
  isActive(): boolean {
    return this.sandboxId !== null && this.sdk !== null;
  }

  /**
   * Destroy the sandbox
   */
  async destroy(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    if (this.sandboxId && this.sdk) {
      try {
        await this.sdk.destroy(this.sandboxId);
        logger.info(`E2B sandbox destroyed: ${this.sandboxId}`);
      } catch (err) {
        logger.debug('E2B sandbox destroy failed (may already be dead)', { err });
      }
    }

    this.sandboxId = null;
    this.sdk = null;
  }

  private touchActivity(): void {
    this.lastActivity = Date.now();

    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.config.keepAlive) {
      this.idleTimer = setTimeout(() => {
        logger.info('E2B sandbox idle timeout — destroying');
        this.destroy().catch(() => {});
      }, this.config.idleTimeout);
    }
  }
}

// ============================================================================
// E2B SDK Wrapper (abstracts the actual SDK or HTTP API calls)
// ============================================================================

/**
 * Lightweight wrapper around E2B API.
 * Uses fetch-based REST calls to avoid hard dependency on @e2b/code-interpreter.
 * If the SDK is installed, it will be used instead.
 */
class E2BSDKWrapper {
  private apiKey: string;
  private baseUrl = 'https://api.e2b.dev/v1';
  private sdkModule: unknown = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async create(opts: { template: string; timeout: number }): Promise<string> {
    // Try using installed SDK first
    const sdk = await this.tryLoadSDK();
    if (sdk) {
      const sandbox = await sdk.create(opts.template, { apiKey: this.apiKey });
      return sandbox.id;
    }

    // Fallback: REST API
    const resp = await fetch(`${this.baseUrl}/sandboxes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ template: opts.template }),
      signal: AbortSignal.timeout(opts.timeout),
    });

    if (!resp.ok) {
      throw new Error(`E2B API error: ${resp.status} ${await resp.text()}`);
    }

    const data = await resp.json() as { id: string };
    return data.id;
  }

  async exec(
    sandboxId: string,
    command: string,
    opts: { timeout: number; cwd?: string; env?: Record<string, string> }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const resp = await fetch(`${this.baseUrl}/sandboxes/${sandboxId}/exec`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        command,
        cwd: opts.cwd,
        env: opts.env,
      }),
      signal: AbortSignal.timeout(opts.timeout),
    });

    if (!resp.ok) {
      throw new Error(`E2B exec error: ${resp.status} ${await resp.text()}`);
    }

    return await resp.json() as { stdout: string; stderr: string; exitCode: number };
  }

  async writeFile(sandboxId: string, path: string, content: string): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/sandboxes/${sandboxId}/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ path, content }),
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      throw new Error(`E2B writeFile error: ${resp.status}`);
    }
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    const resp = await fetch(`${this.baseUrl}/sandboxes/${sandboxId}/files?path=${encodeURIComponent(path)}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      throw new Error(`E2B readFile error: ${resp.status}`);
    }

    const data = await resp.json() as { content: string };
    return data.content;
  }

  async listFiles(sandboxId: string, dir: string): Promise<E2BFileInfo[]> {
    const resp = await fetch(`${this.baseUrl}/sandboxes/${sandboxId}/files/list?dir=${encodeURIComponent(dir)}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      return [];
    }

    return await resp.json() as E2BFileInfo[];
  }

  async destroy(sandboxId: string): Promise<void> {
    await fetch(`${this.baseUrl}/sandboxes/${sandboxId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
  }

  private async tryLoadSDK(): Promise<{ create: (template: string, opts: { apiKey: string }) => Promise<{ id: string }> } | null> {
    if (this.sdkModule !== null) return this.sdkModule as never;

    try {
      // Dynamic import — @e2b/code-interpreter is an optional peer dependency
      const modName = '@e2b/code-interpreter';
      const mod = await import(/* webpackIgnore: true */ modName);
      this.sdkModule = mod.Sandbox || mod.default;
      return this.sdkModule as never;
    } catch {
      this.sdkModule = false as never;
      return null;
    }
  }
}

// ============================================================================
// Singleton + Exports
// ============================================================================

let e2bInstance: E2BSandbox | null = null;

export function getE2BSandbox(config?: Partial<E2BSandboxConfig>): E2BSandbox {
  if (!e2bInstance) {
    e2bInstance = new E2BSandbox(config);
  }
  return e2bInstance;
}

export function resetE2BSandbox(): void {
  if (e2bInstance) {
    e2bInstance.destroy().catch(() => {});
  }
  e2bInstance = null;
}
