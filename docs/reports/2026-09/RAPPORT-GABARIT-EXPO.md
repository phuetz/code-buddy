# Rapport — Gabarit mobile Expo (rattrapage bolt.new, point 5)

- Date : 2026-09-17
- Agent : Grok 4.6
- Worktree : `/home/patrice/DEV/cb-expo-2026-09-17`
- Branche : `feat/expo-2026-09-17`
- Base : `origin/main` `b5c50c189`
- Consignes : pas de commit, pas de `rm -rf`, aucun appel réseau dans les tests unitaires, ports jetables, HOME QA `_qa/gabarit-expo/home`

## Objectif

Ajouter un gabarit Expo / React Native au `TemplateEngine` existant (`src/templates/`), avec la même mécanique que `node-cli` / `react-ts` / `react-tailwind` / `express-api`, puis le vérifier réellement (install, types, tests du gabarit, serveur de développement).

## Constat initial

Quatre gabarits intégrés, enregistrés par `TEMPLATES.set` dans `src/templates/project-scaffolding.ts`, exposés ensuite par `scaffold_app` et par App Studio (listes main + renderer, test de parité).

## Livrable utilisateur

`/home/patrice/Videos/Partage/20260917-cowork-comparaison/GABARIT-EXPO.md`

## Résultat

Gabarit `expo-rn` enregistré comme les quatre starters existants (`TEMPLATES.set` + listes `scaffold_app` / App Studio). Vérifié : install `--prefer-offline` (cache local, 954 paquets), `tsc --noEmit` 0, Vitest gabarit 6/6 hors réseau, Metro web port 54589 HTTP 200 + bundle 3,9 Mo, port arrêté. Premier install sans cache npm = réseau obligatoire (dit dans le livrable). `expo-asset` et `query-string` sont des dépendances runtime Metro/expo-router, ajoutées au descripteur. Pas de commit, pas de compte EAS.
