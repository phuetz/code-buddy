# Portage JIT context depuis l'audit Tools de juillet

**Date :** 3 août 2026
**Branche :** `codex/portage-jit-tools-july-2026`
**Source examinée :** `fix/tools-audit` à `064cdca1`
**Base de la branche avant portage :** `09ab8dab`
**Méthode :** réécriture ciblée, aucun cherry-pick ni merge

## Résultat

Deux défauts JIT réellement absents de la cible ont été portés, chacun avec son
test de régression et son commit thématique :

| Commit cible | Source de juillet | Correctif |
|---|---|---|
| `c40f9c84` | `14b9a89a` | Conserver les messages JIT dans le transcript persistant afin qu'ils atteignent la requête provider suivante, après tous les résultats d'outils frères. |
| `a99e90a6` | `2eed9b57` | Ne pas lancer la découverte JIT après un résultat d'outil en échec, afin qu'un accès refusé ne devienne pas une lecture indirecte des fichiers de contexte. |

Le chemin de production est actif : `runTurnLoop()` appelle
`runJitContextDiscovery()` après l'exécution des outils fichier. Le premier
défaut perdait toutefois le résultat dans `preparedMessages`, copie éphémère de
la requête déjà envoyée. La cible exécute désormais des lots d'outils en
parallèle ; le portage accumule donc le JIT dans l'ordre de restitution, puis
l'ajoute à `messages` seulement lorsque tous les résultats frères, y compris les
résultats synthétiques du mode mono-outil, sont présents. Cela évite d'insérer un
message système entre un `tool_call` et ses `tool` siblings.

Le second correctif garde l'appel derrière `result.success`. Les outils refusés
par un hook étaient déjà exclus par le `continue` de la cible ; aucun doublon de
garde n'a été ajouté pour ce cas.

## Éléments écartés

### Déjà présents sur la cible

Le socle JIT n'a pas été retransplanté :

- `ee39d9dd` : chargeur hiérarchique unifié de contexte projet ;
- `17f348e4` : branchement JIT sur le chargeur et registre de déduplication
  partagé ;
- `7c75d8d3` : troncature JIT sûre pour Markdown et budget de prompt ;
- `3df68e95` : extraction de `runJitContextDiscovery()` et promotion dans la
  boucle streaming ;
- `85bc2e4d` : fusion des chemins séquentiel et streaming dans `runTurnLoop()`.

Ces cinq commits sont ancêtres de la cible. De plus :

- `src/context/jit-context.ts` ne présente aucun diff entre la cible et
  `fix/tools-audit` ;
- la fonction `runJitContextDiscovery()` et sa liste d'outils fichier sont déjà
  équivalentes ;
- découverte de `CODEBUDDY.md`/`CONTEXT.md`/`INSTRUCTIONS.md`/`AGENTS.md`/
  `README.md`, règles par chemin, pages `.codebuddy/docs`, déduplication et coupe
  à 4 000 caractères sont donc conservées telles quelles.

Les porter de nouveau aurait augmenté le diff sans corriger un comportement
absent.

### Hors du sous-lot JIT

Les commits suivants ont été identifiés mais volontairement laissés intacts :

- feedback et options RAG : `29ecb540`, `4791a30d` ;
- réponse finale vide : `e7440979` ;
- coûts : `526582d2`, `6e6263df` ;
- compression adaptative : `0c63facc` ;
- annulation : `820900fa`, `a1e63c74`, `064cdca1` ;
- Bash gardé et index dynamiques : déjà traités séparément par `02735e6d` et
  `fe04829f`.

Ils ne sont ni nécessaires aux deux invariants JIT ni inclus indirectement dans
les commits de ce lot. La matrice demande qu'ils soient évalués séparément ; ce
rapport ne donne donc aucun verdict d'intégration sur eux.

## Preuves rouge avant / vert après

### `c40f9c84` — persistance et ordre des messages JIT

Commande :

```text
npm test -- tests/agent/execution/agent-executor.test.ts \
  -t "persists JIT context into the next request after all sibling tool results"
```

Avant le correctif de production : **ROUGE**, 1 test exécuté, 1 échec. Le test
attendait qu'aucun JIT ne soit ajouté à la première requête ; l'objet de cette
requête était au contraire muté après l'appel provider (`expected false`, reçu
`true`). Le contexte ne se retrouvait pas dans le transcript persistant du round
suivant.

Après le correctif : **VERT**, 1 test réussi, 136 ignorés par le filtre. Le test
vérifie aussi l'ordre assistant → résultat outil 1 → résultat outil 2 → contexte
JIT.

Une première tentative de test avait quitté avec le code 127 avant collecte,
car ce worktree neuf n'avait pas encore `node_modules` (`vitest: not found`).
Elle n'est pas comptée comme preuve rouge. `npm ci` a ensuite révélé un
désalignement préexistant du lockfile (`matrix-js-sdk` absent) ; les dépendances
ont été installées localement avec `npm install --package-lock=false`, sans
modification suivie du lockfile.

### `a99e90a6` — aucun JIT après échec

Commande :

```text
npm test -- tests/agent/execution/agent-executor.test.ts \
  -t "does not discover JIT context after a failed tool access"
```

Avant la garde `result.success` : **ROUGE**, 1 test exécuté, 1 échec. Le mock de
découverte JIT avait été appelé exactement une fois pour
`/denied/secret.ts`.

Après la garde : **VERT**, 1 test réussi, 137 ignorés par le filtre. La requête
provider suivante ne contient pas le marqueur de contexte interdit.

Les deux tests ensemble :

```text
npm test -- tests/agent/execution/agent-executor.test.ts -t "JIT context"
```

Résultat : **2/2 réussis**.

## Vérifications finales

| Vérification | Résultat |
|---|---|
| `npm test -- tests/agent/execution/agent-executor.test.ts tests/context/jit-truncation.test.ts tests/unit/gemini-inspired-features.test.ts` | **3 fichiers, 188/188 tests réussis** |
| `npm run typecheck` | **réussi** : `tsc --noEmit` puis `tsconfig.darkstar-identity.json` |
| `npm run lint` | **réussi, 0 erreur** ; 2 472 avertissements sur le dépôt, hors lignes de ce lot |
| `npx eslint src/agent/execution/agent-executor.ts tests/agent/execution/agent-executor.test.ts` | **0 erreur** ; 27 avertissements existants dans le fichier de test, aucun sur les lignes ajoutées |
| `git diff --check` | **réussi** sur le diff final |

La suite complète d'environ 27 000 tests n'a pas été lancée, conformément au
garde-fou de la mission.
