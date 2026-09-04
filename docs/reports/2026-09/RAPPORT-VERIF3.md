# RAPPORT VERIF3 — vérification croisée par MUTATION des fusions de la nuit 03→04/09

Date : 2026-09-04
Agent : Fable 5.1, vérificateur, **pas** l'auteur des lanes
Clone : `~/DEV/cb-verif3-2026-09-04`
Branche : `verif/verif3-mutation-2026-09-04`
HEAD de départ : `7337b6883`
Lanes visées : HEADLESS2, DELEG2, SWARMFIX1, MEMFIX2A, MEMFIX2B, MEMFIX1,
dm-pairing fail-closed, BRANCH1, PRIV1

Ce rapport a été créé **avant** toute inspection, puis complété au fil des
mutations. Rien n'a été réparé.

## Contraintes et méthode

Chaque mutation est appliquée isolément, testée, consignée, puis restaurée
immédiatement par `git checkout -- <fichier>`. Aucune réparation n'est
conservée. `~/code-buddy` est interdit en écriture. Aucun push, aucune API
payante, aucun service, aucun `git reset --hard`, `git prune`, `rm -rf` hors du
clone, `git add -A` ou `git commit -a`. Le HOME de test reste dans le clone,
sous `_qa/verif3/home`.

## Tableau des mutations

(à compléter)

## Trouvailles

(à compléter)

## Vérifications finales

(à compléter)

## Bilan

(à compléter)
