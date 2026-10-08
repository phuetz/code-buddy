# Rapport de mission — assemblage et preuves de la version 2.3.0 (2026-10-08)

Branche : `release/v2.3.0-2026-10-08` (départ `origin/main` `aa328839c`).
Agent : Sonnet 5.5. Rapport créé avant toute inspection, complété au fil de la mission.

## Plan
1. Fusion (merge, jamais de rebase) de la candidate du 05/10, du correctif bac à sable (n° 13), du correctif Claude 5.5, puis, si relues PRÊT, des correctifs prix et sécurité.
2. Cause de l'échec de la CI de `main` (fusion de la PR #266).
3. Version, journal des changements, notes de version.
4. Preuves : typecheck, lint, build, Vitest complet par fragments, banc du harnais, paquet npm en HOME vierge, balayage.
5. Poussée de la branche seulement si le balayage est à zéro.

## Fusions (merge `--no-ff`, jamais de rebase ni de force)

| Branche | Tête | Conflits |
|---|---|---|
| `integration/2.3.0-candidate-2026-10-05` | `08950a208` | aucun |
| `fix/sandbox-sockets-2026-10-05` (n° 13) | `13cb35ca8` | aucun |
| `fix/anthropic-5-5-2026-10-08` | `55407d0f5` | `CHANGELOG.md` : deux entrées `[Unreleased]/Corrigé`, gardées toutes les deux |
| `fix/audit-dependances-2026-10-03` (hors liste, pour la CI) | `11409bca8` | aucun |

Non prises : `fix/prix-claude-5-5-2026-10-08` (même commit que la branche Claude 5.5, rien de distinct) et `fix/securite-2026-10-08` (relecture : à corriger). Reportées en 2.3.1.

Écart à signaler : le verdict « prêt » de la branche d'audit des dépendances porte sur `55062185a` ; deux commits postérieurs (`d5ed367c7`, `11409bca8`) ne sont pas relus. Le commit `660ea68c7` monte le SDK MCP de `^1.29.0` à `^1.32.1` (saut mineur) et `shell-quote` à 1.12.0.

## Cause de l'échec de la CI de `main` (fusion de la PR #266)

Un seul job rouge, « Security Audit » (`scripts/ci-audit-gate.mjs`) : cinq avis critiques et des avis hauts non listés. Après les fusions et `660ea68c7`, la porte passe : 0 critique, 27 hauts documentés.

## Correctifs d'assemblage

- `53fa7bfb9` : après la fusion du bac à sable, `tests/catalog/status.test.ts` devenait rouge (`security-sandbox` non câblé) parce que l'analyseur de code du catalogue prenait l'apostrophe d'un gabarit imbriqué pour un début de chaîne. La citation shell est réécrite sans gabarit imbriqué (résultat identique, vérifié sur quatre chemins). `tests/toml-config.test.ts` affirmait que le tarif d'Opus dépasse celui de Sonnet ; les tarifs 5.5 ne sont pas dans la table, l'assertion devient « au moins égal ».
- Chemins locaux retirés de la ligne de coordination et du rapport de la branche Claude 5.5.

## Preuves

Typecheck, lint (0 erreur, 2 602 avertissements) et build : verts. Vitest racine en 4 fragments : voir les notes de version, section Validation. Banc du harnais : 6 tâches sur 6 et 17 sur 17. Cache réel : 89,5 % sur 50 requêtes. Paquet npm installé dans un dossier vierge : version 2.3.0, `doctor` sans erreur, deux requêtes `buddy -p` réelles avec un abonnement ChatGPT.

## Reste à faire par le propriétaire

Relecture indépendante (dont un essai réel avec une clé Anthropic), demande de fusion, étiquette, publication npm.
