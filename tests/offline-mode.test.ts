/**
 * Tests for Offline Mode
 */

import { OfflineMode, getOfflineMode, resetOfflineMode } from '../src/offline/offline-mode';

// Mock dependencies
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  pathExists: jest.fn().mockResolvedValue(false),
  readJSON: jest.fn().mockResolvedValue([]),
  writeJSON: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(''),
  remove: jest.fn().mockResolvedValue(undefined),
  emptyDir: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('axios', () => ({
  get: jest.fn().mockRejectedValue(new Error('Network error')),
  post: jest.fn().mockRejectedValue(new Error('Network error')),
}));

describe('OfflineMode', () => {
  let offline: OfflineMode;

  beforeEach(() => {
    resetOfflineMode();
    offline = new OfflineMode({
      enabled: true,
      cacheEnabled: true,
      localLLMEnabled: false,
    });
  });

  afterEach(() => {
    offline.dispose();
  });

  describe('Constructor', () => {
    it('should create with default config', () => {
      const o = new OfflineMode();
      expect(o).toBeDefined();
      o.dispose();
    });

    it('should accept custom config', () => {
      const config = offline.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.cacheEnabled).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return stats', () => {
      const stats = offline.getStats();

      expect(stats).toHaveProperty('cacheHits');
      expect(stats).toHaveProperty('cacheMisses');
      expect(stats).toHaveProperty('localLLMCalls');
      expect(stats).toHaveProperty('queuedRequests');
      expect(stats).toHaveProperty('cacheSize');
      expect(stats).toHaveProperty('isOnline');
    });
  });

  describe('cacheResponse', () => {
    it('should cache a response', async () => {
      await offline.cacheResponse('test query', 'test response', 'grok-3', 100);

      const cached = await offline.getCachedResponse('test query');
      expect(cached).toBeDefined();
      expect(cached?.response).toBe('test response');
    });
  });

  describe('getCachedResponse', () => {
    it('should return null for non-cached query', async () => {
      const cached = await offline.getCachedResponse('unknown query');
      expect(cached).toBeNull();
    });

    it('should return cached response', async () => {
      await offline.cacheResponse('my query', 'my response', 'grok-3', 50);

      const cached = await offline.getCachedResponse('my query');
      expect(cached).not.toBeNull();
      expect(cached?.query).toBe('my query');
    });

    it('should increment cache hits', async () => {
      await offline.cacheResponse('query', 'response', 'grok-3', 50);

      await offline.getCachedResponse('query');
      await offline.getCachedResponse('query');

      const stats = offline.getStats();
      expect(stats.cacheHits).toBeGreaterThan(0);
    });
  });

  describe('queueRequest', () => {
    it('should queue a request', () => {
      const id = offline.queueRequest('chat', { message: 'test' });

      expect(id).toBeDefined();
      expect(offline.getStats().queuedRequests).toBe(1);
    });

    it('should prioritize requests', () => {
      offline.queueRequest('chat', { message: 'low' }, 0);
      offline.queueRequest('chat', { message: 'high' }, 10);

      expect(offline.getStats().queuedRequests).toBe(2);
    });
  });

  describe('clearCache', () => {
    it('should clear the cache', async () => {
      await offline.cacheResponse('q1', 'r1', 'grok-3', 50);
      await offline.cacheResponse('q2', 'r2', 'grok-3', 50);

      await offline.clearCache();

      const cached = await offline.getCachedResponse('q1');
      expect(cached).toBeNull();
    });
  });

  describe('clearQueue', () => {
    it('should clear the queue', async () => {
      offline.queueRequest('chat', { message: 'test' });
      offline.queueRequest('chat', { message: 'test2' });

      await offline.clearQueue();

      expect(offline.getStats().queuedRequests).toBe(0);
    });
  });

  describe('formatStatus', () => {
    it('should render status', () => {
      const status = offline.formatStatus();

      expect(status).toContain('OFFLINE MODE');
      expect(status).toContain('Status');
      expect(status).toContain('Cache');
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      offline.updateConfig({ cacheMaxSize: 1000 });

      const config = offline.getConfig();
      expect(config.cacheMaxSize).toBe(1000);
    });
  });

  describe('events', () => {
    it('should emit cache:cleared event', async () => {
      const handler = jest.fn();
      offline.on('cache:cleared', handler);

      await offline.clearCache();

      expect(handler).toHaveBeenCalled();
    });

    it('should emit request:queued event', () => {
      const handler = jest.fn();
      offline.on('request:queued', handler);

      offline.queueRequest('chat', { message: 'test' });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('singleton', () => {
    it('should return same instance', () => {
      resetOfflineMode();
      const instance1 = getOfflineMode();
      const instance2 = getOfflineMode();
      expect(instance1).toBe(instance2);
    });
  });
});
