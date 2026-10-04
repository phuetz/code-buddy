# Reprise 1 — appels ChatGPT, suite CLI rouge

Branche `fix/appels-chatgpt-imprevus-2026-10-04`, worktree `cb-appels-chatgpt-2026-10-04`.
Tête relue par la revue : `88999db11487613c99958be076b2e0c1a1627e13`.
Correctif de cette reprise : `ea031e8494bc1a47599a08618848372ba4f35bed`.
Aucun push. Rapport de livraison : `/home/patrice/Videos/Partage/20261004-grok-appels-chatgpt/reprise-1/auteur/RAPPORT.md`.

La revue juge le correctif produit juste. Il n'a pas été retouché (`src/providers/auxiliary-llm.ts`, `session-llm-route.ts`, `src/cli/headless-argv.ts`, `src/index.ts`, `docs/fournisseur-auxiliaire.md`, CHANGELOG).

## Bloquant — `tests/cli/middleware-resume-project.test.ts`, 5 échecs

**Cause.** Le faux serveur compte chaque POST `/chat/completions` comme un tour. Depuis le flush de fin de session (`runSessionEndFlush({ client: agent.getClient() })` dans `processPromptHeadless`), les deux appels auxiliaires — leçons (`REUSABLE PROCEDURAL LESSONS`) et mémoire (`durable declarative long-term memory`) — arrivent sur ce même serveur. Le plafond `[middleware]` est toujours 3 ou 2 ; le compteur voyait 5 ou 4.

**Correction.** Le test sépare les tours (`hits`) des deux POST de flush (`flush`). Les attentes de plafond restent 3 et 2. Chaque scénario exige en plus `flush === 2`, pour qu'un flush qui repartirait ailleurs ne passe pas inaperçu. Relever le plafond de 2 aurait masqué un tour de trop.

**Preuve.**

Avant, sur `88999db`, HOME `/tmp/reprise1-appels-chatgpt-home`, clés de fournisseurs retirées :

```
npx vitest run tests/cli/middleware-resume-project.test.ts
# Test Files  1 failed (1)
# Tests  5 failed (5)
# AssertionError: expected 5 to be 3 (×3), expected 4 to be 2 (×2)
```

Après `ea031e849`, même commande : `Test Files  1 passed (1)`, `Tests  5 passed (5)`, 58,10 s.

Mutant : `CODEBUDDY_SESSION_END_FLUSH=false` et `-t "le premier tour"`. L'échec est `expected 0 to be 2` sur `flush`, à la ligne qui suit `expect(hits).toBe(3)`. Le plafond tient sans le flush ; l'assertion nouvelle tombe quand les deux POST n'ont plus lieu. 1 failed, 4 skipped.

`npx eslint tests/cli/middleware-resume-project.test.ts` : sortie 0. `git diff --check` : sortie 0.

## Ce que je n'ai pas pu vérifier

- `tests/cli` entier, `npm run typecheck` et `npm run lint` complets. Aucun fichier de production n'a changé. Le seul fichier de `tests/cli` qui compte les POST `/chat/completions` est celui-ci (recherche dans le dépôt). L'échec préexistant `headless-exit-code` signalé par la revue n'a pas été rejoué.
- La base `70bcab004`. La revue annonce 11 tests passés et 1 échec `headless-exit-code` pour « le même fichier » ; le fichier actuel contient 5 tests. Je n'ai pas réconcilié ce décompte.
- Windows, macOS, CI GitHub.
- Le rejeu OpenRouter. Le routage produit n'a pas changé ; la revue l'avait déjà mesuré sur `88999db` (4 POST `openrouter.ai`, 0 `chatgpt.com`).

## Mesure des outils

HOME des mesures : `/tmp/reprise1-appels-chatgpt-home`.

### LM Resizer

`lm-resizer stats --json` : `commands` 5, `original_bytes` 7912, `compressed_bytes` 7912, `bytes_saved` 0, `original_tokens` 2752, `compressed_tokens` 2752. Filtre `lossless:npm-test` : 3 commandes `npx vitest`, 7883 octets bruts et réduits. Filtre `lossless:generic` : 2 `echo` de sonde, 29 octets.

Aucune vue réduite n'a caché une information : les trois Vitest sont restitués octet pour octet (`bytes_saved` 0), assertions comprises. `tee read` n'a pas été nécessaire pour les relire.

Défaut reproduit : `lm-resizer exec` n'affiche pas l'identifiant `[tee:…]`, ni sur la sortie standard ni sur l'erreur.

```
HOME=/tmp/reprise1-appels-chatgpt-home lm-resizer exec -- echo hello-reprise2
# stdout : hello-reprise2
# stderr : vide
HOME=/tmp/reprise1-appels-chatgpt-home lm-resizer tee list
# un fichier nouveau de 15 octets apparaît quand même
```

L'original est récupérable seulement après `tee list`.

### Code Explorer

Index périmé au départ (commit `70bcab004`, tête `88999db`). `code-explorer analyze --incremental` : 38 fichiers reparsés, 157,19 s, puis index à jour.

6 `query`, 1 `context`, 1 `impact`, 1 `status`.

`context runSessionEndFlush` a donné les appelants réels (`processPromptHeadless` `src/index.ts:1144`, `flushThenExit` `src/index.ts:2676`, `dispose`). Je n'ai pas ouvert le corps de ces fonctions. Les 6 `query` n'ont pas dispensé d'ouvrir le test ni `session-end-flush.ts`.

Réponses incomplètes ou fausses :

- `code-explorer query "session end flush client agent.getClient CODEBUDDY_SESSION_END_FLUSH"` — fonctions internes de `session-end-flush.ts`, pas les appelants. Attendu : `processPromptHeadless` et `flushThenExit`. `context runSessionEndFlush` les a donnés.
- `code-explorer query "flushSessionEnd"`, `query "sessionEndFlush"` et `query "proposeLessonsAtSessionEnd proposeMemory"` — aucun résultat, alors que `runSessionEndFlush` et `proposeLessonsFromSession` existent.
- `code-explorer query "function that flushes lessons and memory at end of headless session"` — un faux positif `overlap_at_k` dans `buddy-memory/src/synth.rs`, plus des aides du flush, pas l'appelant headless.
