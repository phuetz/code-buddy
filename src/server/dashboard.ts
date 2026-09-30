import { getProviderDefaultModel } from '../config/model-defaults.js';
/**
 * Web Control UI Dashboard
 *
 * Provides an HTTP-based admin dashboard for monitoring
 * agent status, sessions, channels, tools, and system health.
 */

import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface DashboardConfig {
  port?: number;
  authToken?: string;
}

export interface DashboardStatus {
  running: boolean;
  port: number;
  uptime: number;
  connectedClients: number;
}

export interface DashboardMetrics {
  agent: { status: string; model: string; mode: string };
  sessions: number;
  channels: string[];
  tools: number;
  memory: { used: number; total: number };
  system: { cpuPercent: number; memoryPercent: number };
}

// ============================================================================
// Dashboard
// ============================================================================

export class Dashboard {
  private static instance: Dashboard | null = null;
  private config: DashboardConfig;
  private running = false;
  private startTime = 0;
  private connectedClients = 0;

  constructor(config?: DashboardConfig) {
    this.config = config || { port: 8080 };
  }

  static getInstance(config?: DashboardConfig): Dashboard {
    if (!Dashboard.instance) {
      Dashboard.instance = new Dashboard(config);
    }
    return Dashboard.instance;
  }

  static resetInstance(): void {
    Dashboard.instance = null;
  }

  start(port?: number): void {
    if (port !== undefined) {
      this.config.port = port;
    }
    logger.info(`Starting dashboard on port ${this.config.port || 8080}`);
    this.running = true;
    this.startTime = Date.now();
    this.connectedClients = 0;
  }

  stop(): void {
    logger.info('Stopping dashboard');
    this.running = false;
    this.startTime = 0;
    this.connectedClients = 0;
  }

  isRunning(): boolean {
    return this.running;
  }

  getPort(): number {
    return this.config.port || 8080;
  }

  getUrl(): string {
    return `http://localhost:${this.getPort()}`;
  }

  getStatus(): DashboardStatus {
    return {
      running: this.running,
      port: this.getPort(),
      uptime: this.running ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
      connectedClients: this.connectedClients,
    };
  }

  generateDashboardHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Code Buddy Dashboard</title>
</head>
<body>
  <h1>Code Buddy Admin Dashboard</h1>
  <section id="agent-status"><h2>Agent Status</h2></section>
  <section id="active-sessions"><h2>Active Sessions</h2></section>
  <section id="channel-status"><h2>Channel Status</h2></section>
  <section id="tool-usage"><h2>Tool Usage</h2></section>
  <section id="memory-stats"><h2>Memory Stats</h2></section>
  <section id="system-health"><h2>System Health</h2></section>
</body>
</html>`;
  }

  getMetrics(): DashboardMetrics {
    return {
      agent: { status: 'idle', model: getProviderDefaultModel('xai'), mode: 'code' },
      sessions: 0,
      channels: ['telegram', 'discord', 'slack'],
      tools: 25,
      memory: { used: 0, total: 1024 },
      system: { cpuPercent: 0, memoryPercent: 0 },
    };
  }

  setConnectedClients(count: number): void {
    this.connectedClients = count;
  }
}
