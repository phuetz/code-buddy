/**
 * Inter-Agent Announcements Tests
 */

import {
  AnnouncementQueue,
  getAnnouncementQueue,
  resetAnnouncementQueue,
  announceResult,
  announceError,
  announceProgress,
  announceRequest,
  requestAndWait,
  type Announcement,
} from '../../../src/agent/isolation/announcements.js';

describe('Inter-Agent Announcements', () => {
  beforeEach(() => {
    resetAnnouncementQueue();
  });

  afterEach(() => {
    resetAnnouncementQueue();
  });

  describe('AnnouncementQueue', () => {
    it('should create queue with default config', () => {
      const queue = new AnnouncementQueue();
      expect(queue.getStats().totalTargets).toBe(0);
      queue.stop();
    });

    it('should announce and consume', () => {
      const queue = new AnnouncementQueue({ cleanupIntervalMs: 0 });

      const announcement = queue.announce('agent-1', 'agent-2', 'result', { data: 'test' });

      expect(announcement.id).toBeDefined();
      expect(announcement.source).toBe('agent-1');
      expect(announcement.target).toBe('agent-2');
      expect(announcement.type).toBe('result');
      expect(announcement.payload).toEqual({ data: 'test' });

      const consumed = queue.consume('agent-2');
      expect(consumed.length).toBe(1);
      expect(consumed[0].id).toBe(announcement.id);
      expect(consumed[0].consumed).toBe(true);

      queue.stop();
    });

    it('should filter announcements', () => {
      const queue = new AnnouncementQueue({ cleanupIntervalMs: 0 });

      queue.announce('agent-1', 'agent-2', 'result', { n: 1 });
      queue.announce('agent-1', 'agent-2', 'error', { n: 2 });
      queue.announce('agent-3', 'agent-2', 'result', { n: 3 });

      const results = queue.consume('agent-2', { type: 'result' });
      expect(results.length).toBe(2);

      queue.stop();
    });

    it('should filter by source', () => {
      const queue = new AnnouncementQueue({ cleanupIntervalMs: 0 });

      queue.announce('agent-1', 'agent-2', 'result', { n: 1 });
      queue.announce('agent-3', 'agent-2', 'result', { n: 2 });

      const fromAgent1 = queue.consume('agent-2', { source: 'agent-1' });
      expect(fromAgent1.length).toBe(1);
      expect((fromAgent1[0].payload as { n: number }).n).toBe(1);

      queue.stop();
    });

    it('should filter by correlation ID', () => {
      const queue = new AnnouncementQueue({ cleanupIntervalMs: 0 });

      queue.announce('agent-1', 'agent-2', 'result', { n: 1 }, { correlationId: 'req-1' });
      queue.announce('agent-1', 'agent-2', 'result', { n: 2 }, { correlationId: 'req-2' });

      const forReq1 = queue.consume('agent-2', { correlationId: 'req-1' });
      expect(forReq1.length).toBe(1);
      expect((forReq1[0].payload as { n: number }).n).toBe(1);

      queue.stop();
    });

    it('should emit events', () => {
      const queue = new AnnouncementQueue({ cleanupIntervalMs: 0 });
      const events: string[] = [];

      queue.on('announce', () => events.push('announce'));
      queue.on('consume', () => events.push('consume'));

      queue.announce('a', 'b', 'result', {});
      queue.consume('b');

      expect(events).toContain('announce');
      expect(events).toContain('consume');

      queue.stop();
    });

    it('should peek without consuming', () => {
      const queue = new AnnouncementQueue({ cleanupIntervalMs: 0 });

      queue.announce('a', 'b', 'result', { data: 1 });

      const peeked = queue.peek('b');
      expect(peeked.length).toBe(1);
      expect(peeked[0].consumed).toBe(false);

      // Should still be available
      const consumed = queue.consume('b');
      expect(consumed.length).toBe(1);

      queue.stop();
    });

    it('should track pending count', () => {
      const queue = new AnnouncementQueue({ cleanupIntervalMs: 0 });

      queue.announce('a', 'b', 'result', {});
      queue.announce('a', 'b', 'result', {});

      expect(queue.getPendingCount('b')).toBe(2);
      expect(queue.hasPending('b')).toBe(true);

      queue.consume('b');

      expect(queue.getPendingCount('b')).toBe(0);
      expect(queue.hasPending('b')).toBe(false);

      queue.stop();
    });

    it('should respect max queue size', () => {
      const queue = new AnnouncementQueue({ maxPerTarget: 2, cleanupIntervalMs: 0 });
      const expired: Announcement[] = [];

      queue.on('expire', (a) => expired.push(a));

      queue.announce('a', 'b', 'result', { n: 1 });
      queue.announce('a', 'b', 'result', { n: 2 });
      queue.announce('a', 'b', 'result', { n: 3 });

      // Oldest should be expired
      expect(expired.length).toBe(1);
      expect((expired[0].payload as { n: number }).n).toBe(1);

      queue.stop();
    });

    it('should order by priority', () => {
      const queue = new AnnouncementQueue({ cleanupIntervalMs: 0 });

      queue.announce('a', 'b', 'result', { n: 1 }, { priority: 'low' });
      queue.announce('a', 'b', 'result', { n: 2 }, { priority: 'urgent' });
      queue.announce('a', 'b', 'result', { n: 3 }, { priority: 'normal' });

      const consumed = queue.consume('b');

      // Urgent should be first
      expect((consumed[0].payload as { n: number }).n).toBe(2);
      expect((consumed[1].payload as { n: number }).n).toBe(3);
      expect((consumed[2].payload as { n: number }).n).toBe(1);

      queue.stop();
    });

    it('should wait for announcement', async () => {
      const queue = new AnnouncementQueue({ cleanupIntervalMs: 0 });

      // Schedule announcement for later
      setTimeout(() => {
        queue.announce('a', 'b', 'result', { data: 'delayed' });
      }, 50);

      const result = await queue.waitFor('b', undefined, 1000);

      expect(result).not.toBeNull();
      expect((result?.payload as { data: string }).data).toBe('delayed');

      queue.stop();
    });

    it('should timeout on wait', async () => {
      const queue = new AnnouncementQueue({ cleanupIntervalMs: 0 });

      const result = await queue.waitFor('b', undefined, 50);

      expect(result).toBeNull();

      queue.stop();
    });

    it('should cleanup expired announcements', () => {
      const queue = new AnnouncementQueue({ ttlMs: 50, cleanupIntervalMs: 0 });

      queue.announce('a', 'b', 'result', {});

      // Wait for TTL to pass
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          queue.cleanup();
          expect(queue.getPendingCount('b')).toBe(0);
          queue.stop();
          resolve();
        }, 100);
      });
    });

    it('should provide statistics', () => {
      const queue = new AnnouncementQueue({ cleanupIntervalMs: 0 });

      queue.announce('a', 'b', 'result', {});
      queue.announce('a', 'c', 'result', {});

      // Before consuming
      let stats = queue.getStats();
      expect(stats.totalTargets).toBe(2);
      expect(stats.totalPending).toBe(2);

      queue.consume('b');

      // After consuming - consumed items are removed
      stats = queue.getStats();
      expect(stats.totalPending).toBe(1);
      expect(stats.byTarget['c'].pending).toBe(1);

      queue.stop();
    });

    it('should clear all announcements', () => {
      const queue = new AnnouncementQueue({ cleanupIntervalMs: 0 });

      queue.announce('a', 'b', 'result', {});
      queue.announce('a', 'c', 'result', {});

      queue.clear();

      expect(queue.getStats().totalTargets).toBe(0);

      queue.stop();
    });
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      const q1 = getAnnouncementQueue();
      const q2 = getAnnouncementQueue();
      expect(q1).toBe(q2);
    });

    it('should reset instance', () => {
      const q1 = getAnnouncementQueue();
      resetAnnouncementQueue();
      const q2 = getAnnouncementQueue();
      expect(q1).not.toBe(q2);
    });
  });

  describe('Convenience functions', () => {
    it('should announce result', () => {
      const announcement = announceResult('a', 'b', { success: true });
      expect(announcement.type).toBe('result');
      expect(announcement.payload).toEqual({ success: true });
    });

    it('should announce error', () => {
      const announcement = announceError('a', 'b', new Error('test error'));
      expect(announcement.type).toBe('error');
      expect(announcement.priority).toBe('high');
      expect((announcement.payload as { message: string }).message).toBe('test error');
    });

    it('should announce progress', () => {
      const announcement = announceProgress('a', 'b', { percent: 50, message: 'halfway' });
      expect(announcement.type).toBe('progress');
      expect(announcement.priority).toBe('low');
    });

    it('should announce request', () => {
      const announcement = announceRequest('a', 'b', { action: 'doSomething' });
      expect(announcement.type).toBe('request');
    });

    it('should request and wait for response', async () => {
      const queue = getAnnouncementQueue();

      // Simulate responder
      queue.on('announce', (a) => {
        if (a.type === 'request') {
          setTimeout(() => {
            announceResult('b', 'a', { response: 'ok' }, a.correlationId);
          }, 10);
        }
      });

      const response = await requestAndWait<{ action: string }, { response: string }>(
        'a',
        'b',
        { action: 'test' },
        1000
      );

      expect(response).toEqual({ response: 'ok' });
    });
  });
});
