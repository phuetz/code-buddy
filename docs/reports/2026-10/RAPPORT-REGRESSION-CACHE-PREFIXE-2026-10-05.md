# Rapport — régression banc 2.3.0, préfixe de cache (2026-10-05)

Agent : Grok 4.7. Branche `perf/cache-prefixe-2026-10-04`. Départ `27f63802a48d6a7de1ed5c4b40deb6b30183c62d`. Correctif de test `be83e3b550ea78fc9ba1b682a3ca41de19deb99f`. Aucun push.

Ce n'est pas une régression du garde-fou. Le test dépendait d'un ordre de messages que la branche a changé pour de bon. Le rapport détaillé, avec la tête finale à 40 caractères, est sous le partage `20261005-grok-regression-cache-prefixe/auteur/RAPPORT.md`.

## Cause

`fakeModel`, recopié dans les trois fichiers, n'émet l'appel d'outil que si `messages[messages.length - 1].role === 'user'`. Sinon il répond `done`.

`sealAppendOnlyTranscript` (`src/prompts/append-only-context.ts`, appelé dans `runTurnLoop` juste avant `chatStream`) sort la date, le dossier et `Project:` du premier message system et les ajoute en queue dans `<environment_context>`. Le dernier message n'est plus le tour utilisateur. L'outil n'est jamais demandé, donc les garde-fous MCP ne s'exécutent pas. Ces garde-fous ne sont pas dans le diff de la branche.

Preuve : sur origin/main `70bcab004f822bccadb73f931e9de1d932b900a5`, les 10 tests sont verts (le dernier message reste le tour user). Sur la tête de départ, les 10 sont rouges, texte reçu `done`. Après adaptation, le cas ajouté voit un dernier message `system` qui contient `<environment_context>`, le fichier hors espace est absent, et le texte est le refus réel `unconfined escalation refused in MCP mode`.

## Correctif

Le faux modèle émet l'outil dès que le transcript contient un message `user` et que l'appel n'a pas encore été servi. Les tours suivants répondent encore `done`. Les assertions des garde-fous sont inchangées. Produit non modifié.

## Barrière

`tests/middleware` n'existe pas. `npx vitest run tests/agent tests/mcp` :

```
 Test Files  274 passed (274)
      Tests  3275 passed (3275)
   Start at  03:17:03
   Duration  121.67s (transform 11.89s, setup 2.96s, import 53.32s, tests 159.69s, environment 19ms)
```

Code de sortie 0. Les trois fichiers ciblés, après correctif : 11 tests verts (les 10 d'origine plus le cas d'ordre).

`npm run typecheck` : premier passage, code 2, deux `TS2307` sur `@phuetz/companion-core` (`core-adapter.ts` lignes 20 et 53). Le fichier est identique à origin/main ; `dist/index.d.ts` manquait dans ce worktree et était présent sur la référence. Après `npm run build` dans le paquet (sortie gitignorée), second passage code 0 (`tsc --noEmit`, `tsconfig.gpuNode-identity.json`, `packages/companion-core`).

## Ce que je n'ai pas pu vérifier

- La suite Vitest entière hors `tests/agent` et `tests/mcp`.
- Windows, macOS, et un `tsc` dont le code de sortie a été isolé sur origin/main (aucune ligne `error TS` observée, le code du processus était masqué par un pipe).
- Le cas d'ordre échouerait sur origin/main : le dernier message y est encore `user`. C'est le contrat de cette branche, pas un garde-fou.
- Aucun push.

## Mesure des outils

LM Resizer, `stats --json --project` dans le HOME isolé `_qa/regression-cache-prefixe/home` : 5 commandes, 102205 octets bruts, 102036 réduits, 169 octets économisés (69 jetons). Les 3 `npx vitest` (101464 octets, filtre `lossless:npm-test`) n'ont rien perdu : la vue réduite n'a caché aucune assertion. Les 2 `npm run typecheck` ont perdu les bannières `@phuetz/code-buddy@…` ; `lm-resizer tee read e458bf95fa9a` les a rendues. Aucune erreur n'était masquée. Le rejeu sur origin/main (autre répertoire, environ 6 Ko, 0 octet économisé) est hors de ce `--project`.

Code Explorer : 4 requêtes. Une a désigné `src/prompts/append-only-context.ts` et ses fonctions avant l'ouverture ; aucune ne m'a dispensé de lire le fichier ensuite. Réponses fausses ou incomplètes : la requête sur le faux modèle MCP a renvoyé des tests `buddy-vision` / `buddy-sense` ; la requête sur le site d'appel a renvoyé tout `runTurnLoop` (lignes 1162-2822), pas l'appel. `code-explorer analyze --incremental` une fois (128 s), index amené à `27f63802`, puis périmé par le commit de test, non relancé.

Défaut : `code-explorer query "Where does the MCP agent_task test fake model decide to emit a tool call versus the text done?" --limit 8` ne trouve pas `fakeModel`. Un second défaut, reproduit : `code-explorer status | head -20` panique (`failed printing to stdout: Broken pipe`).
