import { describe, expect, it } from 'vitest';
import type { CodeBuddyMessage } from '../../src/codebuddy/client.js';
import { ContextManagerV3 } from '../../src/context/context-manager-v3.js';
import { ContextManagerV2 } from '../../src/context/context-manager-v2.js';

describe('Mission G1 — Trou 6 : cas multimodal ignoré lors du comptage et de la compaction', () => {
  it('ContextManagerV3 doit compter les tokens du texte contenu dans un message multimodal', () => {
    const manager = new ContextManagerV3({
      model: 'gpt-4',
      maxContextTokens: 4000,
      responseReserveTokens: 500,
    });

    const multimodalText = 'This is a detailed analysis request with extensive instructions. '.repeat(100);
    const multimodalMessage: CodeBuddyMessage = {
      role: 'user',
      content: [
        { type: 'text', text: multimodalText },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' } },
      ],
    } as unknown as CodeBuddyMessage;

    const stats = manager.getStats([multimodalMessage]);

    // Le message multimodal contient ~1000 mots (~1300 tokens de texte).
    // ACTUELLEMENT : ContextManagerV3 lignes 84 et 172 fait :
    // `content: typeof msg.content === 'string' ? msg.content : null`
    // Ce qui écrase le contenu à null et compte 0 tokens de contenu (seulement les 3-6 tokens de cadrage) !
    expect(
      stats.totalTokens,
      `ContextManagerV3 ignored multimodal text content and counted only ${stats.totalTokens} tokens`,
    ).toBeGreaterThan(500);

    manager.dispose();
  });

  it('ContextManagerV3.prepareMessages ne doit pas laisser passer une requête multimodale qui dépasse le budget réel', () => {
    const manager = new ContextManagerV3({
      model: 'gpt-4',
      maxContextTokens: 200,
      responseReserveTokens: 20,
    });

    // Requête multimodale massive qui dépasse largement la limite de 200 tokens
    const hugeMultimodalMessage: CodeBuddyMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'VERY_LONG_MULTIMODAL_PROMPT_ '.repeat(1000) },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } },
      ],
    } as unknown as CodeBuddyMessage;

    // Invariant : doit lever CURRENT_REQUEST_EXCEEDS_BUDGET
    // ACTUELLEMENT : comme le comptage renvoie ~3 tokens, rejectIfCurrentRequestExceedsBudget ne détecte rien
    // et la requête géante passe sans erreur !
    expect(() => manager.prepareMessages([hugeMultimodalMessage])).toThrow(/budget/i);

    manager.dispose();
  });
});
