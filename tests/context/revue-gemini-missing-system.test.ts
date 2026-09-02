import { describe, expect, it } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { ContextCompressor } from '../../src/context/compression.js';
import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';
import { createTokenCounter } from '../../src/context/token-counter.js';

describe('Mission G1 — Trou 7 : gestion défaillante des messages système', () => {
  it('ContextCompressor doit préserver l\'intégralité des messages système multiples lors de la compression', () => {
    const tokenCounter = createTokenCounter('gpt-4');
    const compressor = new ContextCompressor(tokenCounter);

    const messages: CodeBuddyMessage[] = [
      { role: 'system', content: 'SYSTEM_PROMPT_1: Core agent personality.' },
      { role: 'system', content: 'SYSTEM_PROMPT_2: Injected workspace guidelines and boundaries.' },
      { role: 'system', content: 'SYSTEM_PROMPT_3: Memory decisions and active constraints.' },
      { role: 'user', content: 'What are my current guidelines?' },
      { role: 'assistant', content: 'Here is the summary of your project.' },
      { role: 'user', content: 'LATEST_REQUEST give me the full report.' },
    ];

    // Limite stricte pour forcer la compression
    const result = compressor.compress(messages, 80, {
      preserveSystemPrompt: true,
      preserveRecentMessages: 2,
    });

    // Invariant : les 3 messages système doivent être préservés
    // ACTUELLEMENT : ContextCompressor lignes 63-69 utilise .find(m => m.role === 'system')
    // qui ne retient que le PREMIER, et .filter(m => m.role !== 'system') qui supprime tous les autres !
    const survivingSystemMessages = result.messages.filter(m => m.role === 'system');
    expect(
      survivingSystemMessages.length,
      `ContextCompressor kept only ${survivingSystemMessages.length} system messages out of 3; subsequent system prompts were discarded`,
    ).toBe(3);
  });

  it('ContextManagerV2 ne doit pas injecter un message rôle system dans une conversation qui n\'en a aucun', () => {
    const manager = new ContextManagerV2({
      maxContextTokens: 300,
      responseReserveTokens: 20,
      recentMessagesCount: 2,
      enableSummarization: true,
      enableEnhancedCompression: false, // Forcer legacy sliding-window/summarization
      model: 'gpt-4',
    });

    // Conversation purement utilisateur/assistant sans aucun message système préalable
    const messages: CodeBuddyMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Turn ${i} with long description ${'payload '.repeat(20)}`,
      });
    }
    messages.push({ role: 'user', content: 'LATEST_REQUEST finish up.' });

    const prepared = manager.prepareMessages(messages);

    // Invariant : si aucun message système n'existait, la compaction ne doit pas inventer de message
    // role: 'system' qui violerait le protocole de providers n'acceptant pas le rôle system ou exigeant
    // l'alternance stricte user/assistant.
    // ACTUELLEMENT : applySlidingWindow (ligne 903) et applySummarization (ligne 968) injectent inconditionnellement
    // des messages `{ role: 'system', content: '[Previous ...]' }`.
    const systemMessagesInPrepared = prepared.filter(m => m.role === 'system');
    expect(
      systemMessagesInPrepared.length,
      'ContextManagerV2 injected synthetic role:system messages into a system-less conversation',
    ).toBe(0);

    manager.dispose();
  });
});
