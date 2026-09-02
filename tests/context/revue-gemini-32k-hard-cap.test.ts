import { describe, expect, it } from 'vitest';
import type { Message } from '../../src/context/smart-compaction.js';
import {
  getSmartCompactionEngine,
  resetSmartCompactionEngine,
} from '../../src/context/smart-compaction.js';
import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';

describe('Mission G1 — Trou 8 : limite 32K hard cap vs modèle 1M', () => {
  it('getSmartCompactionEngine ne doit pas plafonner à 32 000 tokens un modèle à fenêtre 1M', async () => {
    resetSmartCompactionEngine();
    // getSmartCompactionEngine est appelé sans paramètre dans retry-fallback.ts et divers services
    const engine = getSmartCompactionEngine();

    const messages: Message[] = [
      { role: 'user', content: 'Here is a large dataset that fits well within 1M context.' },
    ];
    // Simuler un volume de 45 000 tokens
    for (let i = 0; i < 40; i++) {
      messages.push({
        role: i % 2 === 0 ? 'assistant' : 'user',
        content: `Segment ${i}: ${'data '.repeat(1000)}`,
      });
    }

    const { messages: compacted, result } = await engine.compact(messages);

    // Invariant : pour un modèle contemporain (ex: Gemini 1M), un volume de 45 000 tokens ne doit pas
    // être tronqué agressivement sous la barre artificielle de 32 000 tokens.
    // ACTUELLEMENT : DEFAULT_COMPACTION_CONFIG (ligne 720) hardcode maxTokens: 32000 et targetTokens: 25600,
    // détruisant 97% de la capacité utile !
    expect(
      result.compactedTokens,
      `SmartCompactionEngine aggressively truncated context to ${result.compactedTokens} tokens because of hardcoded 32k default cap`,
    ).toBeGreaterThan(35_000);

    resetSmartCompactionEngine();
  });

  it('ContextManagerV2 par défaut ne doit pas limiter un modèle 1M au hardcap 4096 tokens', () => {
    // Si ContextManagerV2 est instancié avec model: 'gemini-2.5-flash' sans maxContextTokens explicite
    const manager = new ContextManagerV2({
      model: 'gemini-2.5-flash',
    });

    // Invariant : la limite effective doit être proportionnelle à la fenêtre du modèle (1M)
    // ACTUELLEMENT : DEFAULT_CONFIG.maxContextTokens = 4096 (ligne 294), donc effectiveLimit = ~3400 !
    expect(
      manager.effectiveLimit,
      `ContextManagerV2 default maxContextTokens capped Gemini 1M at ${manager.effectiveLimit} tokens`,
    ).toBeGreaterThan(500_000);

    manager.dispose();
  });
});
