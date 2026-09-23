# Suite du travail de Grok sur code-buddy — 21 septembre 2026

Rapport de mission. Chaque affirmation vient d'une exécution.

## Ce que Grok a livré

**46 commits en 24 h, directement sur `main`** : 64 fichiers, +3 356 / −698 lignes.
Thèmes : `/companion-loops` et `/heartbeat` pour Lisa, une porte à preuves
« Hermes-style » sur les buts, des clés de session par conversation, l'import
d'espace de travail OpenClaw, des métriques par outil, un raviveur de mémoire.

C'est du volume réel et des idées justes. Mais livré sur `main` sans que ça
compile.

## L'état trouvé

| Mesure | Base d'avant (`096c187e6`) | Après les 46 commits |
|---|---|---|
| Erreurs de compilation | **0** | **16** |
| Tests des zones touchées | verts | **5 échecs** |

La base a été typecheckée séparément pour établir que ces défauts viennent bien
de ce lot, et non d'un état antérieur.

## Les six défauts, et ce qu'ils étaient vraiment

### 1. Deux fonctions supprimées par écrasement de fichier

`post-tool-handlers.ts` a été **réécrit** pour accueillir des métriques, ce qui a
fait disparaître `applyObservationVariator` et `logYoloCostIfEnabled` — encore
importées et appelées par `agent-executor.ts`. Le fichier a *grandi* (68 → 99
lignes), ce qui masque la perte à qui regarde les volumes.

Restaurées depuis la base, à l'identique.

### 2. Les métriques écrivaient dans le mauvais répertoire

`beginSession(id, workDir)` et `loadSessionMetrics(workDir)` acceptent un
répertoire ; `handlePostTool(ctx)` n'en acceptait pas et retombait sur
`process.cwd()`. Les métriques d'une session ouverte ailleurs partaient donc
ailleurs qu'elle. `workDir` ajouté au contexte et propagé aux trois enregistreurs.

**À noter : `handlePostTool` n'est appelé nulle part en production.** Il est
défini et testé, branché sur rien.

### 3. Le raviveur de mémoire n'était pas idempotent

`reviveMemory` écrit `- [agent · date] texte` mais dédupliquait en cherchant
`texte` seul dans les lignes existantes. La comparaison ne pouvait jamais
réussir : **chaque passage repromouvait l'intégralité des entrées**. En
production, la mémoire aurait enflé à chaque exécution. Les deux côtés sont
désormais comparés sous la même forme.

### 4. Deux garde-fous qui s'annulaient

Le défaut le plus intéressant. `applyEvidenceGate` rétrograde tout « done » sans
preuve en « continue » quand le but est `verifyGated`. Or le Verifier gate de
`goal-loop.ts` ne s'active que `if (base.verdict === 'done')`.

Conséquence : **le Verifier indépendant n'était jamais appelé.** Le second
garde-fou était rendu inatteignable par le premier. Les trois tests le disaient —
`expected vi.fn() to be called once, but got 0 times`.

Corrigé en tranchant : quand un Verifier est branché, c'est lui qui apporte la
preuve, et la porte à preuves du juge s'efface. Un seul garde-fou agit, le plus
fort.

### 5. Le semis rendait deux tests sans objet

`seed HEARTBEAT.md on first tick` crée le fichier local absent — qui cesse donc
d'être absent. Les deux tests qui vérifiaient le comportement « fichier
manquant » ne testaient plus rien et échouaient. Ils coupent désormais le semis
explicitement.

### 6. Un import pointant à côté

`session-skill-generator.test.ts` importait `LiveSkillMutator` depuis
`create-skill-tool.js`, qui ne fait que l'importer lui-même sans le réexporter ;
et par un chemin relatif faux. Corrigé vers `skill-mutator.js`.

Le reste : sept accès indexés non gardés (`noUncheckedIndexedAccess` est actif) et
quatre objets typés passés à `logger` là où `LogContext` exige une signature
d'index.

## L'état après

- **Compilation : 0 erreur** (16 avant).
- **852 tests verts, 1 ignoré, 0 échec** sur 108 fichiers des zones touchées
  (`tests/agent/execution`, `tests/memory`, `tests/goals`, `tests/daemon`, plus
  les tests que Grok a placés dans `src/`).

Avant de corriger, les 5 échecs ont été rejoués sur `origin/main` pur : ils s'y
produisent à l'identique. Ils ne viennent donc pas de mes corrections.

## Ce qui reste ouvert — trois points de fond

1. **`enhanced-command-handler.ts` fait 544 lignes contre 816 avant.** Trois
   commits successifs disent « restore after accidental truncate », et il manque
   toujours 272 lignes. Le fichier compile, donc la perte est peut-être
   intentionnelle — mais elle n'est documentée nulle part et mérite un examen.

2. **`session-skill-generator.ts` existe en double** :
   `src/skills/` (195 lignes) et `src/agent/self-improvement/` (212 lignes), avec
   chacun son test. Deux modules au même nom pour le même rôle.

3. **Cinq fichiers `.test.ts` ont été créés dans `src/`**, alors que la
   convention du dépôt est explicite : « Tests live in `tests/` only ». Ils y
   sont restés pour ne pas mélanger un déplacement avec des corrections de fond.

Et le constat qui vaut pour l'ensemble : **`handlePostTool` n'est appelé nulle
part**. Un module écrit, testé, corrigé — et qui ne s'exécute jamais.
