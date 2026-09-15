# Mémoire : fournisseur lié à chaque tour agent

Base : `01fc0dbd3`. Branche : `fix/memory-turn-scope-2026-09-14`.

## Défaut reproduit

Un CLI headless configuré sur un endpoint session pouvait réconcilier `remember` sur un autre fournisseur auto-détecté dans l’environnement. Le correctif précédent couvrait les commandes, pas la boucle agent commune.

## Correction

Chaque reprise `next`, `return`, `throw` de la boucle agent est liée au client de cette instance par AsyncLocalStorage. Le scope couvre les appels d’outils asynchrones et le nettoyage, sans contaminer le consommateur entre deux événements. Le chemin commun couvre les collecteurs séquentiel et streaming utilisés par les surfaces headless et Cowork. Aucun nouveau setter global, changement de permission ou fournisseur de repli.

## Preuves

- `npm run validate -- tests/unit/facts-memory.test.ts tests/agent/execution/agent-executor.test.ts` : lint sans erreur, typecheck, check:pack 10 tests, 152 tests ciblés passent.
- `npm run build` passe.
- Concurrence : deux vrais exécuteurs dans le test, l’un séquentiel et l’autre streaming, gardent chacun leur client ; le consommateur conserve son contexte.
- Générateur : reprise, erreur et nettoyage restent liés au client.
- CLI compilé réel, deux endpoints HTTP loopback scriptés : avant 1 requête au fallback ; après 0. Dans les deux cas fichier mémoire créé ; après la réconciliation est observée sur le fournisseur session.
- Il s’agit de transports déterministes, pas d’un test avec un vrai LLM distant. Aucun nouveau replay Electron n’est revendiqué.

Reproduction : `CODEBUDDY_QA_NODE=/chemin/node python3 scripts/qa/headless-memory-routing.py --entry /chemin/dist/index.js --output /dossier/preuves --revision COMMIT`. Pour la base défectueuse ajouter `--expected-fallback 1`.

Les preuves avant/après restent dans `20260914-code-buddy-flotte/memory-fix/`. Aucun endpoint externe, identifiant utilisateur ou jeton n’a été nécessaire.
