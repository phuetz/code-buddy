# Vague — Tests réels (no-mocks) pour le TemplateEngine + le scaffold

Tu es GPT-5.5 (Codex). Tu écris des tests Vitest **réels** (no-mocks : vrais fichiers dans un tmpdir, pas de
mock de fs) pour le moteur de scaffolding du noyau. Worktree isolé `feat/scaffold-tests` — ne change pas de branche.

## Contexte
`src/templates/project-scaffolding.ts` : `class TemplateEngine` (singleton `getTemplateEngine()`), méthode
`generate(options: GenerateOptions): Promise<GenerateResult>`. `GenerateOptions = { template, projectName,
outputDir, variables, skipInstall?, skipGit?, designSystem? }`. `GenerateResult = { success, projectPath,
filesCreated, duration, warnings, nextSteps }`. Templates intégrés : `react-ts`, `express-api`, `node-cli`.
`src/templates/design-system-apply.ts` : `applyDesignSystem(projectDir, id)` (déjà testé par `tests/design/`, ne
le re-teste pas — teste l'INTÉGRATION via generate).

## Tâches — crée `tests/templates/project-scaffolding.test.ts` (no-mocks)
Utilise un vrai tmpdir (`fs.mkdtempSync(os.tmpdir()+...)`), nettoie en `afterEach`. Pour chaque test, appelle
`getTemplateEngine().generate({..., skipInstall: true, skipGit: true})` (PAS d'install npm ni git — rapide, hermétique).
Couvre :
1. **react-ts** : generate → `result.success===true`, `projectPath` existe, `filesCreated` contient `package.json`
   + `src/main.tsx` (ou l'entrée réelle — vérifie d'abord la vraie liste), le `package.json` écrit est un JSON valide
   contenant `projectName`.
2. **express-api** et **node-cli** : generate réussit, fichiers clés présents. `node-cli` exige la variable `binName` —
   teste qu'elle est bien interpolée dans le `package.json` (`bin`).
3. **Variable manquante** : un generate `node-cli` SANS `binName` → soit `success===false` avec un warning clair, soit
   l'erreur documentée (vérifie le comportement réel d'abord, teste-le tel qu'il est).
4. **Injection design system** : `generate({ template:'react-ts', designSystem:'spotify', skipInstall:true, skipGit:true })`
   → le projet généré contient `src/design-system.css` (tokens Spotify) + `DESIGN.md`, et `filesCreated` les liste.
   Sans `designSystem` → PAS de `design-system.css` (comportement inchangé).
5. **skipInstall/skipGit** respectés : aucun `node_modules` ni `.git` créé quand ils sont à true.

## Contraintes
- Crée UNIQUEMENT `tests/templates/project-scaffolding.test.ts` (+ éventuellement un helper `tests/templates/_util.ts`).
  NE MODIFIE PAS `src/`. Imports `.js`. `import { afterEach, describe, expect, it } from 'vitest'`.
- **Étudie le comportement RÉEL avant d'affirmer** : lis `project-scaffolding.ts` pour les vrais noms de fichiers/vars ;
  un test doit refléter ce que le code fait vraiment, pas ce que tu supposes. Un test qui échoue = tu t'es trompé sur le
  comportement, corrige le test (jamais le src).
- `git add` explicite. NE PUSH PAS. Trailer :
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Wten2ENavfScZnAfZRCSix
  ```
  `test(templates): real scaffold + design-system injection tests`.
- Gate : `npx vitest run tests/templates/project-scaffolding.test.ts` = TOUS verts (colle la sortie). `git status` propre.

## Compte-rendu (français) : les cas couverts, la sortie vitest (X passed), SHA, limites. Ne pousse pas — Fable gate.
