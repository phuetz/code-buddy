# Recette des 140 commandes slash et wiki utilisateur

Version de référence : branche `integration/improvements-persistence-2026-09-13`, base `6388b6188`, avant corrections Opus. Les résultats sont ceux de ce build, pas une certification d’une version future.

## Résultat de la campagne

140 commandes intégrées du menu ont chacune reçu une invocation dans un vrai CLI compilé Node20, en PTY Linux, avec profil HOME/USERPROFILE/XDG et dépôt Git jetables. Dix replays complètent ces 140 premières exécutions. Aucun résultat ne repose uniquement sur une sortie de processus réussie.

| Verdict | Commandes | Signification |
| --- | ---: | --- |
| TESTE_LOCAL | 103 | Le scénario local décrit a produit le résultat attendu |
| VALIDATION_SEULE | 19 | Sélecteur, aide ou garde-fou ; opération complète non validée |
| BLOQUE_PREREQUIS | 5 | Dépendance, option ou confirmation nécessaire |
| PARTIEL | 1 | Persistance mémoire prouvée, réconciliation des faits encore en erreur dans une capture |
| ECHEC | 12 | Erreur, refus ou délai de recette dépassé, détaillé par commande |

Ce ne sont pas 12 défauts racines indépendants démontrés : certains peuvent partager une cause ; deux sont des délais de 45 secondes à diagnostiquer. Une invocation par commande ne couvre pas toutes ses sous-commandes. Windows, comptes OAuth/cloud et commandes personnalisées ne sont pas validés par cette campagne.

## AGY et relecture des preuves

AGY a été réellement appelé via la flotte Code Buddy (`agy-cli`, Gemini 3.8 Flash (High)) : cinq lots couvrant les 140 plans, puis les 140 résultats individuels et des replays. Les captures ont été exécutées par le runner, pas simulées par le modèle. Les réponses, métadonnées et traces sont dans `Partage/20260914-commandes-wiki/agy/`.

Les décisions originales sont conservées. Le pilote les a confrontées aux fixtures et aux fichiers : AGY avait classé une recherche vide comme normale alors que le marqueur existait, pris des refus de commandes natives pour des validations et ignoré certaines postconditions de fichiers. `pilot-adjustments.json` consigne les corrections de verdict. Les suggestions de sous-commandes inventées n’ont pas été reprises dans le wiki.

## Problèmes et limites retenus

- `/export markdown` : base de données non initialisée.
- `/search QA_CHANGE` : zéro résultat malgré le marqueur présent dans invoice.js, attesté par Git.
- `/conflicts scan` : Git ou dépôt annoncé absent malgré une fixture Git valide.
- `/starter list` : syntaxe annoncée, mais `list` traité comme un nom de pack.
- `/switch auto` : session active non reconnue dans le CLI.
- `/agent list`, `/scan-todos`, `/infra status` : absence de réponse, confirmée avec attente de 60 secondes.
- `/debug-issue`, `/grill-me` : refus du modèle sur des commandes natives légitimes.
- `/docs`, `/ai-test quick` : délai de recette de 45 secondes dépassé ; diagnostic nécessaire avant d’affirmer un défaut d’exécution.
- `/remember test_key test_valeur` : clé et valeur réellement persistées, mais erreur de réconciliation des faits dans la première capture.

Faux échecs réconciliés : `/init` termine en environ 60 secondes et crée AGENTS.md ; `/save` écrit 23 049 octets avec le contenu de l’aide ; `/btw` répond réellement 4 à 2+2 ; `/fix` répond après attente mais la fixture n’a pas de configuration ESLint. `/replace` est vérifié par diff, pas seulement par message de réussite.

## Wiki accessible

Ouvrir `Z:\Partage\20260914-commandes-wiki\wiki\index.html`. Le wiki est autonome et hors ligne, avec recherche, filtres de verdict et liens vers les captures voisines. Il contient 140 fiches Markdown, un accueil et la version HTML. Une copie est suivie dans `wiki/slash-commands/`.

Vérification dans un vrai Chromium sur `file://` : recherche, filtres et ancres fonctionnent ; affichages 1200 et 480 pixels sans débordement horizontal ; pas d’erreur JavaScript. Captures dans `wiki-browser/`. Le premier contrôle navigateur utilisait un instantané provisoire. Le contrôle final confirme 140 fiches, 12 entrées sous le filtre ECHEC, une sous PARTIEL, et ouvre réellement la capture locale de /export ; preuves dans wiki-browser/FINAL.md.

Générateur : `scripts/generate-slash-wiki.mjs`. Runner : `scripts/qa/slash-menu-live.py`. Données et preuves : `catalog.json`, `plan-executed.json`, `results-raw.json`, `results.json`, `summary.json`, `cases/`, `replays/`, `replays-memory/`, `replays-async/`. Les anciennes captures restent conservées.

## Vérifications et suite

`npm run validate` passe : lint sans erreur, typage, pack 10 tests, puis 54 tests ciblés. Générateur vérifié par Node, Python compilé, 140 entrées uniques et liens vers captures contrôlés. Aucun profil utilisateur ni paquet global remplacé, aucune publication npm.

À la demande de Patrice, les douze cas d’échec/délai et la mémoire partielle sont réunis dans **un seul prompt Opus**, avec causes communes, traces, fichiers et critères de recette : `Partage/20260914-commandes-wiki/PROMPT-UNIQUE-OPUS.md`. Le worktree `fix/slash-audit-opus-2026-09-14` est séparé de cette documentation. Les correctifs futurs devront être rejoués avant de modifier ces verdicts.
