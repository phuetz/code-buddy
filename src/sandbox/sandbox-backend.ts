/**
 * Sandbox Backend Interface
 *
 * Common interface for all sandbox execution backends.
 * Native Engine v2026.3.14 — pluggable sandbox architecture.
 */

// ============================================================================
// Types
// ============================================================================

export interface SandboxExecOptions {
  /** Command timeout in ms */
  timeout?: number;
  /** Working directory inside the sandbox */
  workDir?: string;
  /** Environment variables to pass */
  env?: Record<string, string>;
  /** Whether networking is enabled */
  networkEnabled?: boolean;
  /** Memory limit (backend-specific format) */
  memoryLimit?: string;
  /** Abort the running sandbox process/container. */
  signal?: AbortSignal;
  /** Logical SSH host name (ssh backend only). */
  host?: string;
}

export interface SandboxExecResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  durationMs: number;
  containerId?: string;
}

// ============================================================================
// Backend Interface
// ============================================================================

/**
 * Abstract sandbox backend.
 * Implement this interface to add a new sandbox execution environment.
 */
export interface SandboxBackendInterface {
  /** Backend identifier */
  readonly name: string;

  /** Check if this backend is available on the current system */
  isAvailable(): Promise<boolean>;

  /** Execute a command in the sandbox */
  execute(command: string, opts?: SandboxExecOptions): Promise<SandboxExecResult>;

  /** Kill a running sandbox instance */
  kill(containerId: string): Promise<boolean>;

  /** Clean up resources */
  cleanup(): Promise<void>;
}
