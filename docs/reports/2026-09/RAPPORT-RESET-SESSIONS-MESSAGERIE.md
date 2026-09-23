# Rapport — remise à zéro des sessions de messagerie

Branche `feat/reset-sessions-messagerie-2026-09-23`, base `f48f5c1e426702515b5631c7516a54c7db97aa68` (`origin/main`). Code `256f4a7ef`, tests `e9bc93c62`. Le dossier de livraison du lot contient les journaux de barrière. Ce fichier résume le contrat et les comptes.

## Sessions de canaux, avant correctif

- `src/commands/handlers/channel-handlers.ts:662` — un agent par clé de conversation. `restoreChannelSession` (1074) et `persistChannelSession` (1098) tiennent le disque.
- `src/companion/channel-history.ts:181` — historique compagnon (vingt tours).
- Le receveur unique est `registerAIMessageHandler`. La politique est appelée ligne 1424, après le calcul de la clé, avant la suite du tour.
- `src/daemon/daily-reset.ts` ne vide pas ces transcripts.

## Contrat

`[session_reset]` dans le TOML existant. Défaut `none` : pas de lecture de session, pas de sauvegarde, pas d'effacement. Modes `idle`, `daily`, `both`. L'archive est relue ; sans reçu sha256, la remise à zéro est annulée. Horloge injectée, aucun sommeil.

## Preuves

Barrière Docker `--network none`, racine en lecture seule, faux profil. Canaris `BARRIERE_OK`, 45 contrôles, `canari_hote bad=0` avant et après.

| Campagne | Tests distincts |
| --- | --- |
| Rouge (stub qui garde toujours la session) | 6 échecs, 2 réussites sur 8. `expected null to be 'idle'`. `refus: expected 'kept' to be 'cancelled'`. |
| Vert | 8 réussites sur 8. |
| Mutant (garde du reçu retirée) | 2 échecs, 6 réussites. `refus: expected true to be false`. `blockedReset` vrai alors que l'archive est impossible. |
| Non-régression, source et candidat | 4 fichiers, 272 réussites des deux côtés. |

ESLint `--quiet` : code 0. `git diff --check` : code 0. Aucun terme privé dans les lignes ajoutées.

## Déployé

Aucun. Pas de push, pas de fusion, pas de service, profil réel non lu.
