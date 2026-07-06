# Brief — Nouveaux tools agent (noyau Code Buddy)

Tu es **GPT-5.5 (Codex)**. Tu ajoutes une suite de **nouveaux tools agent** au **noyau** de Code Buddy (`src/tools/`) — des capacités **read-only / additives** à haute valeur, utiles pour l'App Studio et l'agent en général (scaffolding, inspection de projet, résumé git, stats de code…). Chaque tool = une classe neuve + un test réel.

Tu produis des **fichiers NEUFS**. **Tu ne câbles PAS l'enregistrement dans les god-files du registry** (`src/codebuddy/tools.ts`, `src/agent/codebuddy-agent.ts executeTool`, `src/tools/registry/index.ts`, `src/tools/metadata.ts`) — tu produis à la place un **manifeste** qui dit à l'intégrateur (Fable) exactement quoi enregistrer où. Fable câble en une passe.

## ⚠️ TU ES DÉJÀ DANS TON WORKTREE ISOLÉ
Tu tournes dans `/home/patrice/coretools-wt` sur la branche `feat/core-agent-tools`. **NE FAIS PAS `git worktree add`, NE CHANGE PAS DE BRANCHE, NE FAIS PAS `git checkout -b`.** Commits directement sur la branche courante. (D'autres agents travaillent en parallèle dans d'autres worktrees — changer de branche = course git.)

## Modèle de travail
- **UNE tranche (un tool) = UN commit atomique.** Fais le maximum. Batch partiel OK.
- Après CHAQUE tranche : `npx tsc --noEmit` à la racine (PAS dans cowork) = **0 erreur** sur tes fichiers. Le noyau a ses `node_modules` complets dans ce worktree ? Si tu vois des `Cannot find module`, symlink : `ln -sf /home/patrice/code-buddy/node_modules /home/patrice/coretools-wt/node_modules` (package.json identique), retire-le avant le `git status` final.
- Lance les tests de tes tools : `npx vitest run tests/tools/<ton-test>.test.ts`.
- **NE PUSH JAMAIS. NE MERGE JAMAIS.** Commits sur `feat/core-agent-tools`.

## Contraintes DURES
1. **Fichiers NEUFS uniquement.** Les classes de tools sous `src/tools/` (un fichier par tool, ex. `src/tools/scaffold-app-tool.ts`). Les tests sous `tests/tools/`. Le manifeste sous `src/tools/authored-tools-manifest.ts`.
2. **INTERDIT de modifier un fichier existant.** En particulier NE TOUCHE PAS : `src/codebuddy/tools.ts`, `src/agent/codebuddy-agent.ts`, `src/tools/registry/index.ts`, `src/tools/metadata.ts`, `src/codebuddy/client.ts`, ni `cowork/` (un autre agent y travaille). Que du neuf.
3. **Read-only par défaut.** Ces tools NE MODIFIENT PAS le système de fichiers de l'utilisateur (sauf `scaffold_app` qui écrit dans un `targetDir` explicite, et UNIQUEMENT là). Pas de réseau sortant sauf si indiqué. Pas d'exécution de commandes arbitraires.
4. **Sécurité des chemins** : tout tool qui lit un chemin doit valider (rejeter la traversée hors d'un root quand un root est fourni ; ne jamais suivre un chemin vers `/etc`, `~/.ssh`, secrets). Fail-closed sur chemin invalide.
5. `git add` **explicite fichier par fichier**. Ne touche jamais `.codebuddy/*`, `ETUDE-*.md`, `buddy-memory/`, `COWORK-*BRIEF*.md`, `CORE-*BRIEF*.md`.
6. Trailer de commit exact :
   ```
   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01Wten2ENavfScZnAfZRCSix
   ```
   Conventional Commits : `feat(tools): <tool>`.

## Le contrat d'un tool (respecte-le EXACTEMENT)
Regarde un tool simple existant comme modèle : `src/tools/registry/process-tools.ts` (ex. la classe `AppServerExecuteTool`) ou `src/tools/registry/web-test-tool.ts`. Le contrat :
- Une classe avec `name: string`, `description: string`, une méthode `execute(input): Promise<ToolResult>` où `ToolResult = { success: boolean; output?: string; error?: string; data?: unknown }`.
- **Never-throws** : toute erreur → `{ success: false, error: '<message actionnable>' }`, jamais une exception qui remonte.
- Entrées validées (types, chemins). Sorties déterministes.
- Un **schéma JSON de définition** (le format OpenAI function) exporté à côté de la classe, modèle `src/codebuddy/tool-definitions/` (regarde-en un pour le format `{ type:'function', function:{ name, description, parameters:{...} } }`).
- Chaque tool est **testé pour de vrai** (no-mocks quand possible) : crée un tmpdir, écris-y des fichiers réels, exécute le tool, assert la sortie.

## LES TOOLS À LIVRER (1 commit chacun)

### T1 — `scaffold_app` (`src/tools/scaffold-app-tool.ts`)
Expose le `TemplateEngine` orphelin (`src/templates/project-scaffolding.ts`, `getTemplateEngine()`/`generateProject()`). Input `{ template: 'react-ts'|'express-api'|'node-cli', targetDir: string, vars?: Record<string,string> }`. Écrit le projet dans `targetDir` (le SEUL chemin d'écriture autorisé ; refuse si `targetDir` existe non-vide, refuse chemins système). Output = liste des fichiers créés. Test : scaffolde `node-cli` dans un tmpdir, assert les fichiers attendus.

### T2 — `project_map` (`src/tools/project-map-tool.ts`)
Résume la structure d'un projet : arbre (profondeur bornée), langages détectés (par extension), fichiers d'entrée probables (`package.json main`, `src/index.*`, `main.*`), nombre de fichiers/dossiers. Input `{ root: string, maxDepth?: number }`. Read-only, respecte `.gitignore` basiquement (ignore `node_modules`, `.git`, `dist`). Test : sur un tmpdir avec quelques fichiers.

### T3 — `dep_inspect` (`src/tools/dep-inspect-tool.ts`)
Lit `package.json` (+ lockfile si présent) d'un projet : deps/devDeps avec versions, scripts, moteur node requis, nombre total de deps. **Pas de réseau** — juste du parse. Input `{ root: string }`. Test : sur un package.json de fixture.

### T4 — `code_stats` (`src/tools/code-stats-tool.ts`)
Statistiques de code d'un dossier : lignes de code par langage, nombre de fichiers, plus gros fichiers, ratio commentaires (heuristique simple). Input `{ root: string, extensions?: string[] }`. Ignore `node_modules`/`.git`/binaires. Test.

### T5 — `git_summary` (`src/tools/git-summary-tool.ts`)
Résumé **read-only** de l'état git d'un repo via `child_process.execFile('git', [...])` (jamais de commande git mutante) : branche courante, ahead/behind vs upstream, fichiers modifiés/staged/untracked (compteurs), dernier commit. Input `{ root: string }`. Never-throws (répond proprement si pas un repo git). Test : `git init` un tmpdir, un commit, assert le résumé.

### T6 — `todo_scan` (`src/tools/todo-scan-tool.ts`)
Scanne les marqueurs `TODO`/`FIXME`/`HACK`/`XXX` d'un projet : fichier, ligne, texte, type. Input `{ root: string, markers?: string[] }`. Read-only, ignore `node_modules`. Sortie groupée par type + total. Test.

### T7 — `json_query` (`src/tools/json-query-tool.ts`)
Requête sur un fichier JSON via un chemin pointé simple (`a.b.c`, `a.items.0.name`) — pas de dépendance JSONPath, implémente un accès par segments. Input `{ file: string, path: string }`. Read-only. Test : sur un JSON de fixture, chemins valides + invalides (retourne une erreur propre).

### T8 — `csv_preview` (`src/tools/csv-preview-tool.ts`)
Aperçu + stats d'un CSV : colonnes détectées, nombre de lignes, N premières lignes, type inféré par colonne (nombre/texte/date). Parse CSV robuste (quotes, virgules échappées) sans dépendance nouvelle. Input `{ file: string, previewRows?: number }`. Test.

### T9 — `env_doctor` (`src/tools/env-doctor-tool.ts`)
Diagnostique l'environnement d'un projet : version node courante, `node_modules` présent ?, scripts npm disponibles, présence d'outils clés (`git`, `docker` via `which`), fichiers de config détectés (tsconfig, vite, .env.example). Input `{ root: string }`. Read-only. Test.

### T10 — `port_check` (`src/tools/port-check-tool.ts`)
Vérifie si un port loopback est libre (réutilise la logique `net.connect` de `app-server-tool.ts:isPortListening`). Input `{ port: number, host?: string }`. Utile avant `app_server`. Test : sur un port très probablement libre + un serveur temporaire qui occupe un port.

## MANIFESTE (dernière tranche, OBLIGATOIRE)
`src/tools/authored-tools-manifest.ts` — data-only. Pour chaque tool livré, dis à l'intégrateur exactement quoi enregistrer (les 5 points de la section « Adding a Tool » du CLAUDE.md) :
```ts
export interface ToolWiring {
  name: string;            // 'scaffold_app'
  classFile: string;       // 'src/tools/scaffold-app-tool.ts'
  className: string;       // 'ScaffoldAppTool'
  definitionFile: string;  // où est le schéma JSON
  registryFactory: string; // dans quelle factory de src/tools/registry/ l'ajouter
  metadata: { keywords: string[]; priority: number; fleetSafe: boolean };  // pour src/tools/metadata.ts
  readOnly: boolean;
  testFile: string;
}
export const AUTHORED_TOOLS: ToolWiring[] = [ /* une entrée par tool livré */ ];
```

## COMPTE-RENDU FINAL (en français)
Tools livrés (nom + fichiers + SHA), résultat tsc, tests verts (avec le vrai comportement observé — no-mocks), tools non faits, limites honnêtes. Ne pousse rien. La branche `feat/core-agent-tools` suffit.
