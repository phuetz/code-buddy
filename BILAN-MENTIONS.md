# Bilan — mentions `@file` dans le chat

Date : 2026-08-16

Branche : `feat/file-mentions-2026-08-16`

Commit de fonctionnalité : `5c3e1e7f` (`feat(chat): add secure file mentions`)

Publication distante : aucune (`git push` non exécuté)

## Résultat livré

- Un message peut référencer plusieurs fichiers avec des tokens relatifs tels que `@src/index.ts` et `@README.md`.
- Seuls les chemins qui existent réellement sont résolus. Les handles, adresses e-mail et chemins absents restent dans le message sans lecture ni bruit ajouté au contexte.
- Le contenu résolu est ajouté comme contexte système éphémère du tour. Il est présent à chaque appel fournisseur du même tour, y compris après un appel d'outil, mais n'est ni ajouté au texte utilisateur ni conservé dans l'historique des tours suivants.
- Le chemin `@file:...` historique réutilise désormais le même résolveur sécurisé.
- Le composant `FileAutocomplete` existant est effectivement rendu dans `ChatInterface`. La navigation déjà présente dans le hook couvre flèches haut/bas, Tab ou Entrée pour insérer, et Échap pour fermer.
- Les suggestions couvrent le projet, sont classées avec le fuzzy matcher existant, respectent le `.gitignore`, excluent `.git`, `node_modules` et les liens symboliques, et n'affichent les chemins cachés que si la requête les demande explicitement.

## Garde-fous

- Racine figée au projet lancé par le TUI; chemins absolus POSIX/Windows et traversées `..` refusés.
- Vérification lexicale puis `realpath`, ce qui refuse aussi un lien symbolique qui sortirait du projet.
- Fichiers réguliers uniquement; aucune expansion de répertoire dans le contexte.
- Limite par défaut de 100 Kio par fichier, lecture bornée à `limite + 1`, plafond configurable interne de 1 Mio.
- Fichiers binaires refusés par détection NUL/caractères de contrôle et décodage UTF-8 strict.
- Le contenu est balisé comme donnée projet non fiable. Aucun contenu de fichier refusé ou non demandé n'est journalisé ou transmis.

## Vérifications exécutées

Suite complète d'environ 27 000 tests non lancée, conformément à la consigne.

```text
$ npm run typecheck
> tsc --noEmit && npm run typecheck:gpuNode-identity
> tsc --project tsconfig.gpuNode-identity.json
exit 0
```

```text
$ npx vitest run tests/context/file-mentions.test.ts tests/ui/file-autocomplete.test.ts tests/unit/context-mentions.test.ts tests/unit/use-input-handler.test.ts tests/unit/ui-components.test.ts tests/unit/file-tree.test.ts tests/features/rewind-tasks-autocomplete.test.ts tests/agent/execution/agent-executor.test.ts

Test Files  8 passed (8)
Tests       400 passed (400)
Duration    5.77s
exit 0
```

Couverture ciblée : mentions multiples, chemin absent/handle/e-mail, traversée, chemins absolus POSIX et Windows, lien symbolique sortant, binaire, taille maximale, contexte fournisseur éphémère, fuzzy project-wide, sous-arbre, fichiers cachés, `.gitignore`, `node_modules` et refus des suggestions hors projet.

Contrôles complémentaires :

- ESLint ciblé : exit 0, aucune erreur; 31 avertissements préexistants dans les grands fichiers déjà touchés.
- Prettier ciblé sur les nouveaux fichiers et l'autocomplete : exit 0.
- `git diff --check` : exit 0.

## Limites explicites

- Une mention est un token délimité par des espaces; les noms de fichiers contenant des espaces ne sont pas pris en charge dans cette première version.
- Un répertoire apparaît dans l'autocomplete uniquement pour naviguer vers un fichier; son contenu n'est jamais injecté.
- L'index projet est construit de façon synchrone au premier `@`, puis mis en cache pendant cinq secondes.

## État du worktree

`node_modules` était non suivi avant le chantier et n'a été ni modifié, ni ajouté aux commits.
