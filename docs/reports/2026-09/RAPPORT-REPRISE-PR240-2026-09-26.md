# Reprise locale de la PR #240 — 26/09/2026

Chantier réservé sur `docs/inventaire-preuves-2026-09-25` à partir de `f14ced7f4`.
Le rapport de livraison et les sorties brutes de commandes sont conservés dans le dossier de remise privé demandé par le pilote.

| État | Portée |
|---|---|
| Source | 24 lignes de captures exposaient un préfixe absolu du poste, soit 27 occurrences ; la capture CLI nommait un outil privé ; le HOME P3 n'était pas ignoré. |
| Candidat | Six captures assainies par substitution exacte du préfixe ; ligne d'aide privée neutralisée ; capture de ports retirée ; P3 déplacé sous `_qa/p3/` ; garde étendu aux chemins Unix de poste. |
| Déployé | Aucun. Travail local uniquement, sans push ni fusion. |

Deux témoins du garde ont échoué avant correction, puis 45 tests distincts ont passé. Le mutant supprimant les deux nouveaux motifs échoue sur les deux témoins ; un chemin réintroduit dans une capture et le libellé privé réintroduit font chacun échouer le balayage complet. L'invariance des six captures a été vérifiée : seuls les préfixes de chemins, le libellé privé et deux espaces terminaux ont changé, ainsi qu'une phrase explicative dans P1. Les mesures numériques sont conservées.

Constats moyens : la capture des ports a été retirée ; les mentions « non exercé » trompeuses de l'inventaire ont été changées en « non rejoué ». Le journal brut historique P3 et le correctif `ws search` utilisé lors de P4 ne sont pas présents sur cette branche ; aucune preuve de rejeu complet n'est revendiquée pour eux.

Les vérifications finales et les limites de la livraison figurent dans le rapport privé.
