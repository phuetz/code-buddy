import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitNexusTool } from '../../src/tools/gitnexus-tool.js';

describe('GitNexusTool', () => {
  const originalEnvEndpoint = process.env.GITNEXUS_ENDPOINT;
  const originalEnvApiKey = process.env.GITNEXUS_API_KEY;

  beforeEach(() => {
    process.env.GITNEXUS_ENDPOINT = 'http://test-gitnexus:3000';
    process.env.GITNEXUS_API_KEY = 'test-gitnexus-key';
  });

  afterEach(() => {
    process.env.GITNEXUS_ENDPOINT = originalEnvEndpoint;
    process.env.GITNEXUS_API_KEY = originalEnvApiKey;
    vi.restoreAllMocks();
  });

  describe('ask', () => {
    it('queries ask endpoint and returns context', async () => {
      const mockContext = {
        likelyFiles: ['src/index.ts'],
        dependentSymbols: ['run()'],
        testsToWatch: ['tests/index.test.ts'],
        notes: 'Consult with GitNexus details.',
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockContext),
        text: () => Promise.resolve(''),
      } as any);

      const tool = new GitNexusTool();
      const result = await tool.ask('how does it start?');

      expect(result.likelyFiles).toEqual(['src/index.ts']);
      expect(result.dependentSymbols).toEqual(['run()']);
      expect(result.testsToWatch).toEqual(['tests/index.test.ts']);
      expect(result.notes).toBe('Consult with GitNexus details.');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://test-gitnexus:3000/ask',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-gitnexus-key',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ query: 'how does it start?' }),
        })
      );
    });

    it('degrades gracefully when GitNexus returns an HTTP error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Error text'),
      } as any);

      const tool = new GitNexusTool();
      const result = await tool.ask('should fail');

      expect(result.likelyFiles).toEqual([]);
      expect(result.dependentSymbols).toEqual([]);
      expect(result.testsToWatch).toEqual([]);
      expect(result.notes).toContain('offline or returned an error');
    });

    it('degrades gracefully when GitNexus fetch throws an error (offline)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));

      const tool = new GitNexusTool();
      const result = await tool.ask('should fail');

      expect(result.likelyFiles).toEqual([]);
      expect(result.dependentSymbols).toEqual([]);
      expect(result.testsToWatch).toEqual([]);
      expect(result.notes).toContain('offline or returned an error');
    });

    it('degrades gracefully when endpoint is not configured', async () => {
      delete process.env.GITNEXUS_ENDPOINT;
      const tool = new GitNexusTool({ endpoint: '' });
      const result = await tool.ask('where is it?');

      expect(result.likelyFiles).toEqual([]);
      expect(result.notes).toContain('missing endpoint');
    });
  });

  describe('pushSession', () => {
    it('sends summary to push-session endpoint', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
        text: () => Promise.resolve(''),
      } as any);

      const tool = new GitNexusTool();
      const result = await tool.pushSession('We resolved the issue.');

      expect(result.ok).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://test-gitnexus:3000/push-session',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ summary: 'We resolved the issue.' }),
        })
      );
    });

    it('degrades gracefully on HTTP error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const tool = new GitNexusTool();
      const result = await tool.pushSession('summary');

      expect(result.ok).toBe(false);
    });
  });

  describe('readWorldModel', () => {
    it('queries world-model endpoint and returns invariants', async () => {
      const mockInvariants = {
        architecture: ['Layers: CLI, Core, Agent'],
        invariants: ['No direct file access allowed'],
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockInvariants),
        text: () => Promise.resolve(''),
      } as any);

      const tool = new GitNexusTool();
      const result = await tool.readWorldModel();

      expect(result).toEqual(mockInvariants);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://test-gitnexus:3000/world-model',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('degrades gracefully on HTTP error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Timeout'));

      const tool = new GitNexusTool();
      const result = await tool.readWorldModel();

      expect(result).toBeNull();
    });
  });
});
