/**
 * Sandbox Bridge
 *
 * Bridges Cowork's sandbox path resolution (WSL/Lima) with
 * Code Buddy's file tools. When the GUI is running in sandbox mode,
 * file paths need to be translated between host and sandbox mounts.
 *
 * @module desktop/sandbox-bridge
 */

import { logger } from '../utils/logger.js';
import { isPathWithin } from '../utils/path-within.js';


export interface SandboxConfig {
  enabled: boolean;
  type: 'wsl' | 'lima' | 'none';
  /** Host path that maps to the sandbox workspace */
  hostPath: string;
  /** Sandbox-side mount point (e.g. /mnt/workspace) */
  sandboxMountPath: string;
}

/**
 * Resolves paths between host filesystem and sandbox environment.
 *
 * When sandbox mode is active, Code Buddy tools operate on the
 * sandbox filesystem. This bridge translates paths so the GUI
 * can display host-relative paths while the engine uses sandbox paths.
 */
export class SandboxPathBridge {
  private config: SandboxConfig;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = {
      enabled: false,
      type: 'none',
      hostPath: process.cwd(),
      sandboxMountPath: '/mnt/workspace',
      ...config,
    };
  }

  /**
   * Convert a host path to a sandbox path.
   * If sandbox is disabled, returns the path unchanged.
   */
  toSandboxPath(hostPath: string): string {
    if (!this.config.enabled) return hostPath;

    const normalizedHost = hostPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const normalizedBase = this.config.hostPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const mountPath = this.config.sandboxMountPath.replace(/\/+$/, '');

    if (isPathWithin(normalizedHost, normalizedBase)) {
      const relative = normalizedHost.slice(normalizedBase.length);
      // relative is either empty or starts with '/'
      return `${mountPath}${relative}`;
    }

    return hostPath;
  }

  /**
   * Convert a sandbox path back to a host path.
   * If sandbox is disabled, returns the path unchanged.
   */
  toHostPath(sandboxPath: string): string {
    if (!this.config.enabled) return sandboxPath;

    const mountPath = this.config.sandboxMountPath.replace(/\/+$/, '');
    const hostBase = this.config.hostPath.replace(/\/+$/, '');

    if (isPathWithin(sandboxPath, mountPath)) {
      const relative = sandboxPath.slice(mountPath.length);
      return `${hostBase}${relative}`;
    }

    return sandboxPath;
  }

  /**
   * Get the working directory for the engine.
   * Returns sandbox mount path if enabled, host path otherwise.
   */
  getEngineWorkingDirectory(): string {
    return this.config.enabled
      ? this.config.sandboxMountPath
      : this.config.hostPath;
  }

  /**
   * Update sandbox configuration (e.g., when user toggles sandbox mode).
   */
  updateConfig(config: Partial<SandboxConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('[SandboxPathBridge] config updated', {
      enabled: this.config.enabled,
      type: this.config.type,
    });
  }

  /**
   * Check if sandbox mode is active.
   */
  get isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the sandbox type.
   */
  get sandboxType(): string {
    return this.config.type;
  }
}
