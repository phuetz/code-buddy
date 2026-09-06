/**
 * Audit 2026-09-02 — famille « faux succès » :
 * un échec du LLM de réconciliation ne doit JAMAIS faire perdre le souvenir
 * en silence. reconcileFacts doit propager l'échec (throw) pour que les
 * appelants (remember(), autoCapture()) déclenchent leur repli d'écriture
 * directe — au lieu de retourner currentFacts SANS le nouveau fait avec un
 * statut « stored » mensonger.
 */
import { describe, it, expect, vi } from 'vitest';
import { FactsMemoryService, type Fact } from '../../src/memory/facts-memory.js';
import type { CodeBuddyClient } from '../../src/codebuddy/client.js';

const failingClient = {
  chat: vi.fn().mockRejectedValue(new Error('quota exceeded (429)')),
} as unknown as CodeBuddyClient;

describe('FactsMemoryService.reconcileFacts — échec LLM', () => {
  it('propage l\'échec au lieu de jeter silencieusement le nouveau fait', async () => {
    const service = new FactsMemoryService(failingClient);
    const currentFacts: Fact[] = [
      { category: 'Preferences', text: 'lang: répondre en français' },
    ];
    const newFacts: Fact[] = [
      { category: 'Besoins', text: 'rdv-dentiste: mardi 15h' },
    ];

    // ROUGE avant correctif : résout avec currentFacts (le nouveau fait est
    // perdu, l'appelant croit que la réconciliation a réussi).
    await expect(service.reconcileFacts(currentFacts, newFacts)).rejects.toThrow();
  });

  it('reste inchangé pour le cas sans client (repli assumé, pas un échec)', async () => {
    const service = new FactsMemoryService();
    const currentFacts: Fact[] = [
      { category: 'Preferences', text: 'lang: répondre en français' },
    ];
    // Sans client LLM, retourner currentFacts est le contrat documenté : les
    // appelants testent isAvailable() avant. Pas de throw ici.
    await expect(service.reconcileFacts(currentFacts, [
      { category: 'Besoins', text: 'x: y' },
    ])).resolves.toEqual(currentFacts);
  });
});
