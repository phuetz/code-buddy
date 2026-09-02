import { describe, it, expect, vi } from 'vitest';
import { FactsMemoryService, Fact, FactsExtractionError } from '../../src/memory/facts-memory.js';
import { CodeBuddyClient } from '../../src/codebuddy/client.js';
import { logger } from '../../src/utils/logger.js';

vi.mock('../../src/codebuddy/client.js', () => {
  return {
    CodeBuddyClient: class {
      chat() {}
    }
  };
});

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

describe('FactsMemoryService', () => {
  describe('extractFacts', () => {
    it('should extract structured facts from context', async () => {
      const mockClient = new CodeBuddyClient('key', 'model', 'url');
      const chatSpy = vi.spyOn(mockClient, 'chat').mockResolvedValue({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify([
              { category: 'Projet', text: 'Uses TypeScript and ESM.' },
              { category: 'Preferences', text: 'Prefers 2-spaces tabs.' }
            ])
          },
          finish_reason: 'stop'
        }]
      } as any);

      const service = new FactsMemoryService(mockClient);
      const facts = await service.extractFacts('Some conversation');

      expect(chatSpy).toHaveBeenCalledTimes(1);
      expect(facts.length).toBe(2);
      expect(facts[0].category).toBe('Projet');
      expect(facts[0].text).toBe('Uses TypeScript and ESM.');
    });

    it('returns an empty list when the model extracts no facts', async () => {
      const mockClient = new CodeBuddyClient('key', 'model', 'url');
      vi.spyOn(mockClient, 'chat').mockResolvedValue({
        choices: [{
          message: { role: 'assistant', content: '[]' },
          finish_reason: 'stop'
        }]
      } as any);

      const service = new FactsMemoryService(mockClient);
      await expect(service.extractFacts('Nothing memorable')).resolves.toEqual([]);
    });

    it('throws FactsExtractionError instead of returning [] when generation fails', async () => {
      const mockClient = new CodeBuddyClient('key', 'model', 'url');
      vi.spyOn(mockClient, 'chat').mockRejectedValue(new Error('provider down'));

      const service = new FactsMemoryService(mockClient);
      const failure = await service.extractFacts('Some conversation').catch((err: unknown) => err);
      expect(failure).toBeInstanceOf(FactsExtractionError);
      expect((failure as Error).message).toMatch(/extraction impossible|provider down/i);
      expect(logger.warn).toHaveBeenCalled();
      expect(vi.mocked(logger.warn).mock.calls.some(
        (call) => String(call[0]).includes('Failed to extract facts'),
      )).toBe(true);
    });
  });

  describe('reconcileFacts', () => {
    it('should reconcile and execute transaction actions', async () => {
      const mockClient = new CodeBuddyClient('key', 'model', 'url');
      const chatSpy = vi.spyOn(mockClient, 'chat').mockResolvedValue({
        choices: [{
          message: {
            role: 'assistant',
            content: JSON.stringify([
              { action: 'ADD', fact: { category: 'Projet', text: 'Uses ESM.' } },
              { action: 'UPDATE', targetIndex: 0, fact: { category: 'Preferences', text: 'Prefers 2 spaces instead of 4.' } },
              { action: 'DELETE', targetIndex: 1 }
            ])
          },
          finish_reason: 'stop'
        }]
      } as any);

      const currentFacts: Fact[] = [
        { category: 'Preferences', text: 'Prefers 4 spaces.' },
        { category: 'Profil', text: 'User is junior.' }
      ];

      const newFacts: Fact[] = [
        { category: 'Projet', text: 'Uses ESM.' }
      ];

      const service = new FactsMemoryService(mockClient);
      const result = await service.reconcileFacts(currentFacts, newFacts);

      expect(chatSpy).toHaveBeenCalledTimes(1);
      // Expected result:
      // Index 1 (Profil: junior) is DELETED first. currentFacts becomes [Preferences: 4 spaces]
      // Index 0 (Preferences: 4 spaces) is UPDATED to [Preferences: 2 spaces]
      // [Projet: Uses ESM] is ADDED.
      // Total length should be 2.
      expect(result.length).toBe(2);
      expect(result[0].text).toBe('Prefers 2 spaces instead of 4.');
      expect(result[1].text).toBe('Uses ESM.');
    });
  });
});
