import { describe, it, expect, vi } from 'vitest';
import { SynologyChatAdapter } from '../../src/channels/synology-chat/index.js';
import * as secretCompare from '../../src/security/secret-compare.js';

describe('SynologyChatAdapter', () => {
  describe('validateWebhookToken', () => {
    it('doit renvoyer true si la configuration na pas de jeton', () => {
      const adapter = new SynologyChatAdapter({
        incomingWebhookUrl: 'https://test.com',
      });
      expect(adapter.validateWebhookToken('any-token')).toBe(true);
    });

    it('doit renvoyer true pour un jeton valide', () => {
      const adapter = new SynologyChatAdapter({
        incomingWebhookUrl: 'https://test.com',
        outgoingWebhookToken: 'secret123',
      });
      expect(adapter.validateWebhookToken('secret123')).toBe(true);
    });

    it('doit renvoyer false pour un jeton de longueur différente', () => {
      const adapter = new SynologyChatAdapter({
        incomingWebhookUrl: 'https://test.com',
        outgoingWebhookToken: 'secret123',
      });
      expect(adapter.validateWebhookToken('secret1234')).toBe(false);
      expect(adapter.validateWebhookToken('secret12')).toBe(false);
    });

    it('doit renvoyer false pour undefined si configuré', () => {
      const adapter = new SynologyChatAdapter({
        incomingWebhookUrl: 'https://test.com',
        outgoingWebhookToken: 'secret123',
      });
      expect(adapter.validateWebhookToken(undefined as unknown as string)).toBe(false);
    });

    it('doit utiliser secretsEqual', () => {
      const adapter = new SynologyChatAdapter({
        incomingWebhookUrl: 'https://test.com',
        outgoingWebhookToken: 'secret123',
      });
      const spy = vi.spyOn(secretCompare, 'secretsEqual');
      adapter.validateWebhookToken('secret123');
      expect(spy).toHaveBeenCalledWith('secret123', 'secret123');
      spy.mockRestore();
    });
  });
});
