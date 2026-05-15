/**
 * Gateway Self-Management Tool
 *
 * Provides self-management capabilities for the gateway including
 * status monitoring, configuration, health checks, and restart.
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface GatewayStatus {
  running: boolean;
  uptime: number;
  version: string;
  channels: number;
  agents: number;
  sessions: number;
  memoryUsage: number;
}

export interface HealthCheckResult {
  healthy: boolean;
  checks: Record<string, boolean>;
}

// ============================================================================
// GatewayTool
// ============================================================================

export class GatewayTool {
  private static instance: GatewayTool | null = null;
  private running = false;
  private startTime = 0;
  private version = '0.1.16';
  private channelCount = 0;
  private agentCount = 1;
  private sessionCount = 0;
  private config: Record<string, unknown> = {};

  static getInstance(): GatewayTool {
    if (!GatewayTool.instance) {
      GatewayTool.instance = new GatewayTool();
    }
    return GatewayTool.instance;
  }

  static resetInstance(): void {
    GatewayTool.instance = null;
  }

  start(): void {
    this.running = true;
    this.startTime = Date.now();
    logger.info('Gateway started');
  }

  getStatus(): GatewayStatus {
    return {
      running: this.running,
      uptime: this.getUptime(),
      version: this.version,
      channels: this.channelCount,
      agents: this.agentCount,
      sessions: this.sessionCount,
      memoryUsage: process.memoryUsage?.()?.heapUsed || 0,
    };
  }

  restart(): void {
    logger.info('Restarting gateway');
    this.running = true;
    this.startTime = Date.now();
  }

  getConfig(): Record<string, unknown> {
    return { ...this.config };
  }

  updateConfig(key: string, value: unknown): void {
    logger.info(`Updating gateway config: ${key}`);
    this.config[key] = value;
  }

  getVersion(): string {
    return this.version;
  }

  getUptime(): number {
    if (!this.running || this.startTime === 0) {
      return 0;
    }
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  getChannelCount(): number {
    return this.channelCount;
  }

  setChannelCount(count: number): void {
    this.channelCount = count;
  }

  getSessionCount(): number {
    return this.sessionCount;
  }

  setSessionCount(count: number): void {
    this.sessionCount = count;
  }

  healthCheck(): HealthCheckResult {
    logger.info('Running gateway health check');
    const memoryUsage = process.memoryUsage?.()?.heapUsed;
    const checks = {
      api: this.running,
      channels: this.channelCount > 0,
      memory: typeof memoryUsage === 'number' && Number.isFinite(memoryUsage),
    };

    return {
      healthy: checks.api && checks.memory,
      checks,
    };
  }
}
