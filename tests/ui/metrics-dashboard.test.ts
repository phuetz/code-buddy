/**
 * Tests for MetricsDashboard pure logic
 *
 * Uses tmpDir for metrics persistence — no UI rendering.
 */

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { MetricsDashboard } from '../../src/ui/metrics-dashboard';

describe('MetricsDashboard', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'metrics-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  function createDashboard(): MetricsDashboard {
    return new MetricsDashboard(path.join(tmpDir, 'metrics.json'));
  }

  // --------------------------------------------------------------------------
  // Session tracking
  // --------------------------------------------------------------------------

  describe('session tracking', () => {
    it('should start and end a session', () => {
      const db = createDashboard();
      db.startSession('s1');
      db.endSession('s1');

      const data = db.getDashboardData();
      expect(data.summary.totalSessions).toBe(1);
    });

    it('should record messages and accumulate tokens/cost', () => {
      const db = createDashboard();
      db.startSession('s1');
      db.recordMessage('s1', 100, 0.01);
      db.recordMessage('s1', 200, 0.02);

      const data = db.getDashboardData();
      expect(data.summary.totalMessages).toBe(2);
      expect(data.summary.totalTokens).toBe(300);
      expect(data.summary.totalCost).toBeCloseTo(0.03, 4);
    });

    it('should ignore recordMessage for unknown session', () => {
      const db = createDashboard();
      db.recordMessage('unknown', 100, 0.01);
      expect(db.getDashboardData().summary.totalMessages).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Tool call tracking
  // --------------------------------------------------------------------------

  describe('tool call tracking', () => {
    it('should record tool calls with success/failure', () => {
      const db = createDashboard();
      db.startSession('s1');
      db.recordToolCall('s1', 'bash', true, 100);
      db.recordToolCall('s1', 'bash', true, 200);
      db.recordToolCall('s1', 'bash', false, 50);

      const data = db.getDashboardData();
      expect(data.summary.totalToolCalls).toBe(3);
      expect(data.summary.totalErrors).toBe(1);

      const bashTool = data.tools.find(t => t.name === 'bash');
      expect(bashTool).toBeDefined();
      expect(bashTool!.calls).toBe(3);
      expect(bashTool!.successes).toBe(2);
      expect(bashTool!.failures).toBe(1);
    });

    it('should calculate average duration', () => {
      const db = createDashboard();
      db.startSession('s1');
      db.recordToolCall('s1', 'read', true, 100);
      db.recordToolCall('s1', 'read', true, 300);

      const data = db.getDashboardData();
      const readTool = data.tools.find(t => t.name === 'read');
      expect(readTool!.avgDuration).toBe(200);
      expect(readTool!.totalDuration).toBe(400);
    });

    it('should sort tools by call count', () => {
      const db = createDashboard();
      db.startSession('s1');
      db.recordToolCall('s1', 'less-used', true, 10);
      db.recordToolCall('s1', 'most-used', true, 10);
      db.recordToolCall('s1', 'most-used', true, 10);
      db.recordToolCall('s1', 'most-used', true, 10);

      const data = db.getDashboardData();
      expect(data.tools[0].name).toBe('most-used');
    });
  });

  // --------------------------------------------------------------------------
  // getDashboardData()
  // --------------------------------------------------------------------------

  describe('getDashboardData()', () => {
    it('should return empty summary for fresh dashboard', () => {
      const db = createDashboard();
      const data = db.getDashboardData();
      expect(data.summary.totalSessions).toBe(0);
      expect(data.summary.totalMessages).toBe(0);
      expect(data.summary.avgSessionDuration).toBe(0);
      expect(data.summary.avgMessagesPerSession).toBe(0);
    });

    it('should calculate avgSessionDuration in minutes', () => {
      const db = createDashboard();
      db.startSession('s1');
      // Manually set start/end for predictable duration
      const sessions = (db as any).sessions;
      sessions[0].startTime = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
      sessions[0].endTime = new Date();

      const data = db.getDashboardData();
      expect(data.summary.avgSessionDuration).toBeCloseTo(10, 0);
    });

    it('should calculate avgMessagesPerSession', () => {
      const db = createDashboard();
      db.startSession('s1');
      db.recordMessage('s1', 100, 0);
      db.recordMessage('s1', 100, 0);
      db.startSession('s2');
      db.recordMessage('s2', 100, 0);

      const data = db.getDashboardData();
      expect(data.summary.avgMessagesPerSession).toBe(1.5);
    });

    it('should return last 10 recent sessions reversed', () => {
      const db = createDashboard();
      for (let i = 0; i < 15; i++) {
        db.startSession(`s${i}`);
      }

      const data = db.getDashboardData();
      expect(data.recentSessions.length).toBeLessThanOrEqual(10);
    });
  });

  // --------------------------------------------------------------------------
  // Trends
  // --------------------------------------------------------------------------

  describe('trends', () => {
    it('should return stable when less than 7 days of data', () => {
      const db = createDashboard();
      db.startSession('s1');
      const data = db.getDashboardData(3);
      expect(data.trends.costTrend).toBe('stable');
      expect(data.trends.usageTrend).toBe('stable');
      expect(data.trends.errorTrend).toBe('stable');
    });
  });

  // --------------------------------------------------------------------------
  // Daily metrics
  // --------------------------------------------------------------------------

  describe('daily metrics', () => {
    it('should initialize all days in range', () => {
      const db = createDashboard();
      const data = db.getDashboardData(7);
      expect(data.daily.length).toBe(7);
    });

    it('should aggregate sessions into correct day', () => {
      const db = createDashboard();
      db.startSession('today');
      db.recordMessage('today', 500, 0.05);

      const data = db.getDashboardData(7);
      const today = new Date().toISOString().split('T')[0];
      const todayMetrics = data.daily.find(d => d.date === today);
      expect(todayMetrics).toBeDefined();
      expect(todayMetrics!.sessions).toBe(1);
      expect(todayMetrics!.messages).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // formatDashboard()
  // --------------------------------------------------------------------------

  describe('formatDashboard()', () => {
    it('should contain section headers', () => {
      const db = createDashboard();
      const output = db.formatDashboard();
      expect(output).toContain('METRICS DASHBOARD');
      expect(output).toContain('SUMMARY');
      expect(output).toContain('TRENDS');
    });

    it('should show tool section when tools exist', () => {
      const db = createDashboard();
      db.startSession('s1');
      db.recordToolCall('s1', 'bash', true, 100);
      const output = db.formatDashboard();
      expect(output).toContain('TOP TOOLS');
      expect(output).toContain('bash');
    });
  });

  // --------------------------------------------------------------------------
  // exportData() / clear()
  // --------------------------------------------------------------------------

  describe('exportData()', () => {
    it('should return valid JSON', () => {
      const db = createDashboard();
      db.startSession('s1');
      const json = db.exportData();
      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed.summary).toBeDefined();
      expect(parsed.daily).toBeDefined();
    });
  });

  describe('clear()', () => {
    it('should reset all metrics', () => {
      const db = createDashboard();
      db.startSession('s1');
      db.recordMessage('s1', 100, 0.01);
      db.recordToolCall('s1', 'bash', true, 50);
      db.clear();

      const data = db.getDashboardData();
      expect(data.summary.totalSessions).toBe(0);
      expect(data.tools).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  describe('persistence', () => {
    it('should persist and reload sessions', () => {
      const metricsPath = path.join(tmpDir, 'metrics.json');
      const db1 = new MetricsDashboard(metricsPath);
      db1.startSession('persist-1');
      db1.recordMessage('persist-1', 200, 0.02);

      const db2 = new MetricsDashboard(metricsPath);
      const data = db2.getDashboardData();
      expect(data.summary.totalSessions).toBe(1);
      expect(data.summary.totalTokens).toBe(200);
    });

    it('should persist and reload tool metrics', () => {
      const metricsPath = path.join(tmpDir, 'metrics.json');
      const db1 = new MetricsDashboard(metricsPath);
      db1.startSession('s1');
      db1.recordToolCall('s1', 'grep', true, 50);

      const db2 = new MetricsDashboard(metricsPath);
      const data = db2.getDashboardData();
      const grepTool = data.tools.find(t => t.name === 'grep');
      expect(grepTool).toBeDefined();
      expect(grepTool!.calls).toBe(1);
    });
  });
});
