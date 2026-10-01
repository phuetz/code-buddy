import { describe, it, expect, beforeEach } from 'vitest';
import { DataRedactionEngine, resetDataRedactionEngine, getDataRedactionEngine } from '../../src/security/data-redaction';
import { SandboxManager } from '../../src/security/sandbox';

describe('Isolation des configurations partagées', () => {
  beforeEach(() => {
    resetDataRedactionEngine();
  });

  describe('DataRedactionEngine', () => {
    it('ne doit pas partager la whitelist entre les instances (mutations de DEFAULT_CONFIG)', () => {
      const engine1 = new DataRedactionEngine();
      engine1.addToWhitelist('secret-xyz');

      const engine2 = new DataRedactionEngine();

      // On ajoute un pattern pour que 'secret-xyz' soit masqué
      engine2.addPattern({
        name: 'Test Secret',
        pattern: /secret-xyz/g,
        replacement: '[REDACTED]',
        category: 'custom',
        severity: 'high',
      });

      const result = engine2.redact('Mon texte avec secret-xyz caché');
      expect(result.redacted).not.toContain('secret-xyz');
      expect(result.redactions.length).toBeGreaterThan(0);
    });

    it('ne doit pas partager les customPatterns entre les instances', () => {
      const engine1 = new DataRedactionEngine();
      engine1.addPattern({
        name: 'Test Pattern',
        pattern: /mon-pattern-secret/g,
        replacement: '[REDACTED]',
        category: 'custom',
        severity: 'low',
      });

      const engine2 = new DataRedactionEngine();
      const result = engine2.redact('Texte avec mon-pattern-secret visible');
      // Le pattern ne doit pas avoir fuité dans le second moteur
      expect(result.redacted).toContain('mon-pattern-secret');
    });

    it('resetDataRedactionEngine doit recréer une instance vierge de toute modification passée', () => {
      const engine1 = getDataRedactionEngine();
      engine1.addToWhitelist('super-secret');

      resetDataRedactionEngine();
      const engine2 = getDataRedactionEngine();
      engine2.addPattern({
        name: 'Test Secret 2',
        pattern: /super-secret/g,
        replacement: '[REDACTED]',
        category: 'custom',
        severity: 'high',
      });

      const result = engine2.redact('Texte avec super-secret caché');
      expect(result.redacted).not.toContain('super-secret');
    });
  });

  describe('SandboxManager', () => {
    it('ne doit pas partager blockedPaths entre les instances', () => {
      const sandbox1 = new SandboxManager();
      sandbox1.blockPath('/tmp/chemin-bloque-123');

      const sandbox2 = new SandboxManager();
      expect(sandbox2.getConfig().blockedPaths).not.toContain('/tmp/chemin-bloque-123');
    });

    it('ne doit pas muter la configuration fournie en paramètre', () => {
      const myAllowedPaths = ['/tmp/allowed-1'];
      const sandbox = new SandboxManager({ allowedPaths: myAllowedPaths });
      sandbox.allowPath('/tmp/allowed-2');

      expect(myAllowedPaths).not.toContain('/tmp/allowed-2');
      expect(myAllowedPaths.length).toBe(1);
    });
  });
});
