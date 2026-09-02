# Réparation R4 — échange et import de skills

## État initial

- Branche attendue : `fix/repar-skills-2026-09-02`
- HEAD initial : `7e3f5037e`
- Audit lu intégralement : `AUDIT-A-REPARER.md`
- Fichiers non suivis présents avant le chantier : `AUDIT-A-REPARER.md`, `node_modules/` ; ils sont hors périmètre et seront préservés.

## Défauts à traiter

- D1 — aligner la destination par défaut de `skill-importer` sur `skill-exchange`, vérifier la lecture des deux emplacements par `buddy skills imported`.
- D2 — propager les erreurs de clone/pull de `skill-sources`.
- D3 — attendre le rechargement du registre après import/install et rendre les erreurs visibles en `logger.warn`.

## Méthode et preuves

Ce rapport sera complété au fil de l’eau. Pour chaque défaut : test écrit avant le correctif, sortie rouge, correctif minimal, sortie verte. Les commandes et résultats finaux de typecheck et ESLint seront ajoutés avant le commit.

### Sortie rouge — tests avant correctif

Commande :

```text
node_modules/.bin/vitest run tests/skills/skill-importer.test.ts tests/skills/skill-sources.test.ts tests/skills/skill-exchange.test.ts
```

Résultat : exit 1, **3 fichiers en échec, 5 tests en échec, 27 réussis**. Les échecs probants étaient :

- D1 destination par défaut : fichier absent sous `~/.codebuddy/skills/imported-*` ; CLI : seul `imported-legacy` listé au lieu des deux racines.
- D2 : `resolveSourceDir` ne levait pas après `git clone` simulé en échec.
- D3 : importer et installer renvoyaient un objet au lieu d’une `Promise` attendue.

Extrait de sortie :

```text

 RUN  v4.1.9 /home/patrice/DEV/cb-repar-skills-2026-09-02

 ❯ tests/skills/skill-sources.test.ts (1 test | 1 failed) 5ms
     × propagates a git clone failure instead of returning a phantom directory 4ms
 ❯ tests/skills/skill-importer.test.ts (13 tests | 3 failed) 59ms
     × installs by default directly under the managed skills root 16ms
     × waits for the registry reload before resolving 7ms
     × lists imported skills from both the current and legacy managed roots 5ms
 ❯ tests/skills/skill-exchange.test.ts (18 tests | 1 failed) 86ms
     × waits for the registry reload before resolving installation 6ms

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/skills/skill-exchange.test.ts > skill exchange hardening (post-review) > waits for the registry reload before resolving installation
AssertionError: expected { author: '3wEf1n4aTrXY', …(5) } to be an instance of Promise
 ❯ tests/skills/skill-exchange.test.ts:368:21

 FAIL  tests/skills/skill-importer.test.ts > skill-importer — discovery > installs by default directly under the managed skills root
AssertionError: expected false to be true // Object.is equality
 ❯ tests/skills/skill-importer.test.ts:80:105

 FAIL  tests/skills/skill-importer.test.ts > skill-importer — discovery > waits for the registry reload before resolving
AssertionError: expected { imported: [ { …(3) } ], …(5) } to be an instance of Promise
 ❯ tests/skills/skill-importer.test.ts:98:21

 FAIL  tests/skills/skill-importer.test.ts > skill-importer — discovery > lists imported skills from both the current and legacy managed roots
AssertionError: expected [ 'imported-legacy' ] to deeply equal [ 'imported-current', …(1) ]
 ❯ tests/skills/skill-importer.test.ts:129:65

 FAIL  tests/skills/skill-sources.test.ts > skill sources > propagates a git clone failure instead of returning a phantom directory
AssertionError: expected function to throw an error, but it didn't
 ❯ tests/skills/skill-sources.test.ts:38:44

 Tests  5 failed | 27 passed (32)
```

### Correctif et sortie verte

- D1 : `skill-importer` écrit désormais par défaut sous `~/.codebuddy/skills/<skill>`. La commande `buddy skills imported` parcourt la racine actuelle et l’ancien `~/.codebuddy/skills/managed`, sans doublonner les noms.
- D2 : `resolveSourceDir` conserve l’avertissement puis relance l’erreur de `git clone` ou `git pull`; aucun chemin fantôme ne parvient à l’importateur.
- D3 : `importSkills` et `installSkill` retournent une `Promise`, attendent `reloadAll()`, et journalisent un échec de rechargement en `logger.warn`.

Commande ciblée après correctif :

```text
node_modules/.bin/vitest run tests/skills/skill-importer.test.ts tests/skills/skill-sources.test.ts tests/skills/skill-exchange.test.ts
```

Résultat : exit 0.

```text

 RUN  v4.1.9 /home/patrice/DEV/cb-repar-skills-2026-09-02


 Test Files  3 passed (3)
      Tests  32 passed (32)
   Start at  12:23:18
   Duration  557ms (transform 530ms, setup 68ms, import 649ms, tests 133ms, environment 0ms)
```

### Vérifications obligatoires

Commande : `npm run typecheck`

Résultat : exit 0 ; `tsc --noEmit` et `tsc --project tsconfig.gpuNode-identity.json` terminés sans erreur.

Commande : `npx eslint src/skills/skill-importer.ts src/skills/skill-sources.ts src/skills/skill-exchange.ts src/commands/skills-cli/index.ts tests/skills/skill-importer.test.ts tests/skills/skill-sources.test.ts tests/skills/skill-exchange.test.ts`

Résultat : exit 0, aucune sortie ESLint.

## Fichiers touchés

- `src/skills/skill-importer.ts`
- `src/skills/skill-sources.ts`
- `src/skills/skill-exchange.ts`
- `src/commands/skills-cli/index.ts`
- `tests/skills/skill-importer.test.ts`
- `tests/skills/skill-sources.test.ts`
- `tests/skills/skill-exchange.test.ts`
- `docs/FABLE5-CODEX-COORDINATION.md`
- `REPARATION-R4.md`

Un seul commit thématique a été livré, avec ajout explicite de chacun de ces fichiers ; son hash final est relevé dans le bilan de passation.

## Fichiers touchés

À compléter.

## Défauts non réparés

- D4 (`skill-importer.ts` : découverte insensible à la casse puis lecture stricte de `SKILL.md`/`skill.md`) n’est pas réparé : il est démontré dans l’audit mais ne fait pas partie des trois défauts demandés par cette mission ; le corriger élargirait la famille au-delà du correctif R4.
- `copySupportDirs` et `exportSkill` sont restés inchangés : l’audit les classe comme pistes non démontrées, sans chemin d’échec reproductible fourni.
