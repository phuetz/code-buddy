/**
 * Audit 2026-09-02 — famille « ressources non bornées » :
 * `dispatchedTasks` (peer-chat-bridge) garde le prompt + le résultat COMPLETS
 * de chaque `peer.dispatch` pour toujours — `clearDispatch` n'est appelé nulle
 * part en production, et n'importe quel pair distant peut créer des entrées
 * sans limite. Un serveur qui tourne des semaines accumule indéfiniment.
 * Le magasin doit être borné (cap dur + TTL des états terminaux).
 */
import { describe, it, expect } from 'vitest';
import {
  dispatchPeerTask,
  _listDispatchesForTests,
  _unwireForTests,
} from '../../src/fleet/peer-chat-bridge.js';

describe('peer.dispatch — bornes mémoire', () => {
  it('le nombre d\'états retenus est plafonné même sous flood distant', async () => {
    _unwireForTests();
    for (let i = 0; i < 800; i++) {
      dispatchPeerTask({ runId: `flood-${i}`, prompt: 'x'.repeat(2000) });
    }
    // Laisse les échecs async (aucun provider en test) se poser.
    await new Promise((r) => setTimeout(r, 50));
    const kept = _listDispatchesForTests().length;
    expect(kept).toBeLessThanOrEqual(500);
    // Les plus récents survivent (l'éviction retire les plus anciens).
    const ids = new Set(_listDispatchesForTests().map((d) => d.runId));
    expect(ids.has('flood-799')).toBe(true);
  });
});
