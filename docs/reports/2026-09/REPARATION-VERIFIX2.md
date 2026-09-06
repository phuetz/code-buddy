# Réparation VERIFIX2

Date : 2026-09-04  
Branche : `fix/verifix2-trouvailles-2026-09-04`  
Clone : `~/DEV/cb-verifix2-2026-09-04`

## Périmètre et contraintes

Le rapport a été créé avant toute inspection, puis la réservation VERIFIX2 a été
inscrite dans `docs/FABLE5-CODEX-COORDINATION.md`. Le travail est resté dans ce
clone, avec le HOME temporaire `_qa/verifix2/home`. Aucun push, appel d’API
payante, service ou dépôt original n’a été touché.

## F1 — FIFO des délégués

Le test ajouté dans `tests/agent/delegation/thread-delegation.test.ts` démarre un
enfant actif avec `concurrency: 1`, puis met trois enfants en attente avant de
libérer le premier créneau. Il vérifie l’ordre d’admission exact :
`active`, `first`, `second`, `third`.

Preuve par mutation :

| État | Commande | Résultat |
|---|---|---|
| `shift()` muté en `pop()` | `npx vitest run tests/agent/delegation/thread-delegation.test.ts -t "admits three queued children in arrival order with concurrency one" --reporter=verbose` | **ROUGE**, 1 échec / 9 ignorés ; ordre reçu `active`, `third`, `second`, `first` |
| restauration de `shift()` | même commande | **VERT**, 1 passé / 9 ignorés |

Commit fonctionnel : `6550facfc` (`test(delegation): cover FIFO admission with queued children`).

## F2 — six motifs PRIV1 pris isolément

La décision existante a été extraite dans `detecterMotifsInterdits()` ; le
balayage conserve le même chemin et les mêmes règles. Six cas unitaires
indépendants couvrent respectivement le chemin home auteur, les deux formes de
chemin Windows, le dépôt de passation, l’ancien moteur d’exploration et l’outil
éditorial hors pont MCP. Chaque fixture et son motif attendu sont construits par
concaténation, sans réutiliser la constante mutée du garde-fou.

Preuve par mutation, une mutation à la fois, avec restauration immédiate :

| Motif muté | Résultat de `npx vitest run tests/security/donnees-personnelles.test.ts --reporter=verbose` |
|---|---|
| chemin home auteur | **ROUGE**, 1 échec / 6 passés |
| chemin Windows avec slash | **ROUGE**, 1 échec / 6 passés |
| chemin Windows avec antislash | **ROUGE**, 1 échec / 6 passés |
| dépôt privé de passation | **ROUGE**, 1 échec / 6 passés |
| ancien moteur d’exploration privé | **ROUGE**, 1 échec / 6 passés |
| outil éditorial hors pont MCP | **ROUGE**, 1 échec / 6 passés |

Après restauration de chaque motif : **VERT**, 7 tests passés.

Commit fonctionnel : `031e36eaf` (`test(security): cover each personal-data guard motif`).

## Vérifications finales

| Commande | Résultat |
|---|---|
| `HOME="$PWD/_qa/verifix2/home" TMPDIR="$PWD/_qa/verifix2/home/tmp" npx vitest run tests/agent/delegation tests/security` | **46 fichiers / 871 tests verts** |
| `npx tsc --noEmit -p .` | **code 0** |
| `npx eslint tests/agent/delegation/thread-delegation.test.ts tests/security/donnees-personnelles.test.ts` | **code 0** |
| `git diff --check` | **code 0** |

## Bilan (10 lignes)

1. F1 ferme la couverture FIFO avec trois waiters sous concurrence 1.
2. La mutation `shift()` → `pop()` est ROUGE, puis la restauration est VERTE.
3. F1 est commitée dans `6550facfc`.
4. F2 extrait la détection sans modifier le balayage fonctionnel.
5. Les six motifs PRIV1 ont chacun une fixture indépendante par concaténation.
6. Les six mutations F2 sont ROUGES, chacune sur son cas dédié.
7. La restauration F2 est VERTE : 7 tests.
8. F2 est commitée dans `031e36eaf`.
9. La suite exacte demandée est VERTE : 46 fichiers et 871 tests.
10. Typecheck, ESLint ciblé et `git diff --check` sont à 0 ; aucun push effectué.
