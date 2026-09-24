# Code de sortie des commandes slash en mode headless

Branche `fix/slash-code-sortie-2026-09-23`, base `d56373e5b` (`origin/main`). Aucun push, aucune fusion.

## Défaut

`buddy -p "/commande …"` renvoyait 0 même quand la commande slash échouait (commande inconnue, `/config set` sans valeur, argument invalide). Le retour de `processPromptHeadless` ne distinguait que `denied`.

## Correctif

Le code de sortie d'un échec slash headless est **1**, le même que les autres échecs headless (surface refusée, réponse vide, schéma invalide). Un succès reste **0**, et le texte ou le JSON est toujours émis.

`CommandHandlerResult.failed` est posé par le gestionnaire quand la commande n'a pas abouti. `dispatchSlashPrompt` le pose aussi pour une commande rejetée par l'analyseur. Le mode interactif ne lit pas ce drapeau et ne quitte pas le processus.

## Preuve

Le vrai point d'entrée (`tsx` sur `src/index.ts`), dans une barrière sans réseau, avec un profil jetable et un serveur factice qui n'a reçu aucun appel de modèle :

- avant : 7 tests en échec, assertion `expected 1 received 0`, et 2 succès (`/help`, `/config schemas`) déjà à 0 ;
- après : 9 tests passés, dont les échecs à 1 (texte, JSON, entrée standard) et les succès à 0 ;
- mutant : seule la ligne de code de sortie est retirée sur une copie ; 6 tests ré-échouent avec `expected 1 received 0`, le worktree garde le correctif.

`tests/cli` et `tests/commands` : 1 577 tests. Hors le nouveau fichier, 127 échecs identiques des deux côtés, 0 rouge nouveau. Ces 127 échecs existent déjà sur la base dans la même barrière (dépôt en lecture seule, outils absents). La suite complète du dépôt n'a pas été relancée.

## Ce qui n'est pas couvert

Tous les gestionnaires ne posent pas encore `failed` sur chaque texte d'erreur. Une commande dont le gestionnaire ne signale ni `failed` ni un champ `error` non vide peut encore sortir en 0. Les cas exigés (inconnue, `/config set` sans valeur, JSON invalide, thème inconnu) sont couverts. Le binaire compilé `dist/` n'a pas été reconstruit : l'entrée exécutée est le source via `tsx`, le même chemin que les tests CLI existants.
