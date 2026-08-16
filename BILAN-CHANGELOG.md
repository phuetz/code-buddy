# Bilan — `buddy changelog`

- Date : 2026-08-16
- Branche : `feat/changelog-2026-08-16`
- Commit fonctionnel : `88f35b3e` (`feat(cli): generate changelog from conventional commits`)
- Publication distante : aucune

## Livré

- Commande lazy-loaded `buddy changelog` avec `--since <tag|YYYY-MM-DD|ref>`, `--to <ref>`, `--out <CHANGELOG.md>` et `--json`.
- Collecte Git read-only par `execFile`, sans shell. Les références sont résolues en SHA avant `git log`.
- Plage par défaut depuis le dernier tag atteignable depuis `--to`; repli sur tout l’historique lorsqu’aucun tag n’est atteignable.
- Module pur `src/git/changelog.ts` pour parser, regrouper et rendre une liste injectée de `{ hash, subject, body }`.
- Types Conventional Commits alignés sur `commitlint.config.js`; `!`, `BREAKING CHANGE:` et `BREAKING-CHANGE:` sont reconnus.
- Ordre stable : `⚠ Breaking Changes`, `Features`, `Bug Fixes`, `Performance`, `Docs`, `Autres`. Un breaking change n’est pas dupliqué dans sa section de type.
- Les commits hors convention et les types non autorisés restent visibles dans `Autres`.
- Markdown lisible avec scopes et SHA courts; JSON structuré avec plage et six sections.
- `--out` préfixe le contenu existant ou crée le fichier. `--json` reste une sortie stdout et est explicitement incompatible avec `--out` pour ne pas fabriquer un faux document JSON concaténé.
- Plage vide : message clair et aucun fichier créé/modifié. Hors dépôt : erreur Commander propre et code de sortie 1.

## Fichiers fonctionnels

- `src/git/changelog.ts`
- `src/commands/changelog.ts`
- `src/index.ts`
- `tests/git/changelog.test.ts`
- `tests/commands/changelog.test.ts`

## Vérifications exécutées

- `npm run typecheck` : succès (`tsc --noEmit` puis `typecheck:darkstar-identity`).
- `npm test -- tests/git/changelog.test.ts tests/commands/changelog.test.ts tests/cli/command-routing.test.ts tests/cli/help-output.test.ts` : 4 fichiers, 19 tests réussis.
- ESLint ciblé sur le module, la commande et leurs tests : succès, 0 erreur.
- Prettier ciblé : tous les fichiers correspondent au style attendu.
- `git diff --check` : succès.
- Smoke CLI `buddy changelog --help` : succès, quatre options exposées.
- Smoke CLI réel `--since HEAD~3 --to HEAD --json` : succès, plage et groupes JSON produits.
- Smoke CLI réel `--since HEAD --to HEAD` : succès, message `Aucun commit trouvé sur la plage HEAD → HEAD.`.
- Smoke hors dépôt : code 1 et message unique `Ce dossier n’est pas un dépôt Git : /tmp`, sans rapport de crash après correction.
- Smoke dans un dépôt Git temporaire sans tag : historique complet utilisé; sorties `Features` et `Autres` conformes. Le dépôt temporaire a ensuite été placé dans la corbeille.

La suite complète d’environ 27 000 tests n’a pas été lancée, conformément à la demande de tests ciblés.

## État de passation

- `node_modules` non suivi était présent avant le chantier et n’a pas été modifié ni ajouté.
- Aucun push, merge, reset, nettoyage du worktree ou mutation de ce dépôt hors commits locaux.
- Aucun choix humain restant dans le périmètre demandé.
