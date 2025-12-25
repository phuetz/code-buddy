/**
 * Health Check module for API endpoints
 *
 * Provides:
 * - Endpoint health monitoring
 * - Latency tracking
 * - Automatic failover support
 * - Health status reporting
 */

import { EventEmitter } from 'events';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface HealthCheckResult {
  status: HealthStatus;
  latency: number;
  timestamp: Date;
  error?: string;
}

export interface EndpointHealth {
  url: string;
  status: HealthStatus;
  lastCheck: Date | null;
  lastSuccess: Date | null;
  latency: number;
  failureCount: number;
  successCount: number;
  history: HealthCheckResult[];
}

export interface HealthCheckOptions {
  /** Check interval in ms (default: 30000) */
  interval?: number;
  /** Request timeout in ms (default: 5000) */
  timeout?: number;
  /** Number of failures before marking unhealthy (default: 3) */
  failureThreshold?: number;
  /** Latency threshold for degraded status in ms (default: 2000) */
  degradedThreshold?: number;
  /** Maximum history entries to keep (default: 100) */
  maxHistory?: number;
  /** Custom health check function */
  checkFn?: (url: string) => Promise<boolean>;
}

const DEFAULT_OPTIONS: Required<Omit<HealthCheckOptions, 'checkFn'>> = {
  interval: 30000,
  timeout: 5000,
  failureThreshold: 3,
  degradedThreshold: 2000,
  maxHistory: 100,
};

/**
 * Health Check Manager
 */
export class HealthCheckManager extends EventEmitter {
  private options: Required<Omit<HealthCheckOptions, 'checkFn'>>;
  private customCheckFn?: (url: string) => Promise<boolean>;
  private endpoints: Map<string, EndpointHealth> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(options: HealthCheckOptions = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.customCheckFn = options.checkFn;
  }

  /**
   * Add an endpoint to monitor
   */
  addEndpoint(url: string): void {
    if (this.endpoints.has(url)) return;

    const health: EndpointHealth = {
      url,
      status: 'unknown',
      lastCheck: null,
      lastSuccess: null,
      latency: 0,
      failureCount: 0,
      successCount: 0,
      history: [],
    };

    this.endpoints.set(url, health);

    // Perform initial check
    this.checkEndpoint(url);
  }

  /**
   * Remove an endpoint from monitoring
   */
  removeEndpoint(url: string): void {
    this.stopMonitoring(url);
    this.endpoints.delete(url);
  }

  /**
   * Start continuous monitoring for an endpoint
   */
  startMonitoring(url: string): void {
    if (this.intervals.has(url)) return;

    // Add endpoint if not exists
    if (!this.endpoints.has(url)) {
      this.addEndpoint(url);
    }

    // Set up interval
    const intervalId = setInterval(() => {
      this.checkEndpoint(url);
    }, this.options.interval);

    this.intervals.set(url, intervalId);
  }

  /**
   * Stop monitoring an endpoint
   */
  stopMonitoring(url: string): void {
    const intervalId = this.intervals.get(url);
    if (intervalId) {
      clearInterval(intervalId);
      this.intervals.delete(url);
    }
  }

  /**
   * Perform a health check on an endpoint
   */
  async checkEndpoint(url: string): Promise<HealthCheckResult> {
    const health = this.endpoints.get(url);
    if (!health) {
      throw new Error(`Endpoint not registered: ${url}`);
    }

    const startTime = Date.now();
    let result: HealthCheckResult;

    try {
      const isHealthy = await this.performCheck(url);
      const latency = Date.now() - startTime;

      if (isHealthy) {
        health.successCount++;
        health.failureCount = 0;
        health.lastSuccess = new Date();
        health.latency = latency;

        const status: HealthStatus =
          latency > this.options.degradedThreshold ? 'degraded' : 'healthy';

        result = {
          status,
          latency,
          timestamp: new Date(),
        };

        health.status = status;
      } else {
        throw new Error('Health check returned false');
      }
    } catch (error) {
      const latency = Date.now() - startTime;
      health.failureCount++;

      const status: HealthStatus =
        health.failureCount >= this.options.failureThreshold ? 'unhealthy' : 'degraded';

      result = {
        status,
        latency,
        timestamp: new Date(),
        error: error instanceof Error ? error.message : String(error),
      };

      health.status = status;
    }

    // Update health record
    health.lastCheck = result.timestamp;
    health.history.push(result);

    // Trim history
    if (health.history.length > this.options.maxHistory) {
      health.history = health.history.slice(-this.options.maxHistory);
    }

    // Emit events
    this.emit('check', { url, result });
    if (result.status === 'unhealthy') {
      this.emit('unhealthy', { url, result });
    } else if (result.status === 'healthy' && health.failureCount === 0) {
      this.emit('recovered', { url, result });
    }

    return result;
  }

  /**
   * Perform the actual health check
   */
  private async performCheck(url: string): Promise<boolean> {
    if (this.customCheckFn) {
      return this.customCheckFn(url);
    }

    // Default: HEAD request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal: controller.signal,
      });
      return response.ok;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get health status for an endpoint
   */
  getHealth(url: string): EndpointHealth | undefined {
    return this.endpoints.get(url);
  }

  /**
   * Get all endpoint health statuses
   */
  getAllHealth(): EndpointHealth[] {
    return Array.from(this.endpoints.values());
  }

  /**
   * Get the healthiest endpoint from a list
   */
  getHealthiestEndpoint(urls: string[]): string | null {
    let healthiest: { url: string; score: number } | null = null;

    for (const url of urls) {
      const health = this.endpoints.get(url);
      if (!health) continue;

      // Calculate score (lower is better)
      let score = health.latency;
      if (health.status === 'unhealthy') score += 100000;
      if (health.status === 'degraded') score += 10000;
      if (health.status === 'unknown') score += 5000;

      if (!healthiest || score < healthiest.score) {
        healthiest = { url, score };
      }
    }

    return healthiest?.url || null;
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
    unknown: number;
  } {
    const summary = { total: 0, healthy: 0, degraded: 0, unhealthy: 0, unknown: 0 };

    for (const health of this.endpoints.values()) {
      summary.total++;
      summary[health.status]++;
    }

    return summary;
  }

  /**
   * Format health status for display
   */
  formatHealth(): string {
    const lines: string[] = ['Endpoint Health Status:', ''];

    for (const health of this.endpoints.values()) {
      const statusIcon =
        health.status === 'healthy'
          ? '[OK]'
          : health.status === 'degraded'
            ? '[WARN]'
            : health.status === 'unhealthy'
              ? '[FAIL]'
              : '[?]';

      lines.push(`${statusIcon} ${health.url}`);
      lines.push(`    Status: ${health.status}`);
      lines.push(`    Latency: ${health.latency}ms`);
      lines.push(`    Success: ${health.successCount}, Failures: ${health.failureCount}`);
      if (health.lastCheck) {
        lines.push(`    Last Check: ${health.lastCheck.toISOString()}`);
      }
      lines.push('');
    }

    const summary = this.getSummary();
    lines.push(
      `Summary: ${summary.healthy} healthy, ${summary.degraded} degraded, ${summary.unhealthy} unhealthy`
    );

    return lines.join('\n');
  }

  /**
   * Stop all monitoring and cleanup
   */
  dispose(): void {
    for (const intervalId of this.intervals.values()) {
      clearInterval(intervalId);
    }
    this.intervals.clear();
    this.endpoints.clear();
    this.removeAllListeners();
  }
}

// Singleton instance
let healthCheckManager: HealthCheckManager | null = null;

/**
 * Get or create the health check manager
 */
export function getHealthCheckManager(options?: HealthCheckOptions): HealthCheckManager {
  if (!healthCheckManager) {
    healthCheckManager = new HealthCheckManager(options);
  }
  return healthCheckManager;
}

/**
 * Reset the health check manager
 */
export function resetHealthCheckManager(): void {
  if (healthCheckManager) {
    healthCheckManager.dispose();
    healthCheckManager = null;
  }
}
