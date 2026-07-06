# Vague — App Studio : sélecteur de design system + génération brandée

Tu es GPT-5.5 (Codex). Tu branches les **150 design systems** (déjà vendus) dans le flux de création
d'apps d'**App Studio** : on choisit un style (Spotify, Apple, Brutalism…) et l'app générée est brandée
avec (couleurs, typo, géométrie). Worktree isolé `feat/studio-design-systems` — ne change pas de branche.

## Ce qui existe DÉJÀ (à réutiliser, ne pas recréer)
- `assets/design-systems/catalog.json` — index `{ schema, count, systems:[{id,name,category,tagline}] }` (150).
- `assets/design-systems/<id>/{DESIGN.md, tokens.css, design-tokens.json}` — le branding.
- Service noyau `src/design/design-system-registry.ts` : `loadCatalog()`, `getDesignSystem(id)`
  (retourne `{ id,name,category,tagline, design, tokensCss?, designTokens? }`), `buildDesignGuidance(id)`.
  (Si un nom d'export diffère, adapte-toi à la signature réelle du fichier.)
- App Studio : `StudioComposer.tsx` (prompt + template + Générer), `use-app-studio.ts` (hook, `scaffold()`
  appelle `apis.scaffold.generate({ template, targetDir, vars })`), `studio-api.ts` (`ScaffoldApi`),
  `studio-api-bridge.ts` (construit les APIs depuis window.electronAPI).
- Le scaffold noyau : `src/templates/project-scaffolding.ts` — `TemplateEngine.generate(options)` +
  hooks `postGenerate`. Le template `react-ts` écrit `src/index.css` avec un bloc `:root { … }` (l. ~422).

## Objectif : 2 parties

### Partie A — Sélecteur de design system dans StudioComposer (renderer, PAS d'IPC nouveau)
1. **Catalogue côté renderer sans IPC** : ajoute un petit module
   `cowork/src/renderer/components/studio/design-systems-catalog.ts` qui EXPORTE le catalogue.
   Copie le contenu de `assets/design-systems/catalog.json` dans un `.json` importable par le renderer
   (`cowork/src/renderer/components/studio/design-systems-catalog.json`) OU génère le module TS à partir
   de ce JSON. (Vite bundle le JSON — pas besoin d'IPC pour une liste de 150 entrées.) Type
   `DesignSystemSummary = { id, name, category, tagline }`.
2. **UI sélecteur** dans `StudioComposer.tsx` : un contrôle « Style » (dropdown recherchable OU petite
   grille groupée par catégorie) à côté du sélecteur de template. Valeur par défaut « Aucun » (`''`).
   État `designSystem` remonté dans la requête (voir Partie B). Garde l'UI cohérente (tokens Tailwind
   sémantiques `bg-surface`/`text-foreground`/`border-border`, lucide-react). Affiche la `tagline` du style choisi.

### Partie B — Injecter le branding dans le scaffold (core, thread l'id, PAS de nouvel IPC)
3. **Thread l'id** : ajoute `designSystem?: string` à `StudioScaffoldRequest` (studio-api.ts / là où le type
   vit) et à l'appel `apis.scaffold.generate({ template, targetDir, vars, designSystem })`. Le champ traverse
   l'IPC scaffold EXISTANT (l'objet request est déjà forwardé — n'ajoute PAS de méthode IPC). Côté main,
   le handler scaffold passe `designSystem` aux `GenerateOptions` du TemplateEngine.
4. **Applique le branding (helper séparé, édits minimaux dans project-scaffolding.ts)** : crée
   `src/templates/design-system-apply.ts` avec `applyDesignSystem(projectDir, designSystemId)` qui :
   - lit le design system via le registry (`getDesignSystem(id)`),
   - écrit ses **tokens.css** dans le projet généré : crée `src/design-system.css` (ou `styles/…`) avec le
     contenu tokens.css, ET assure qu'il est importé (ajoute l'import dans le point d'entrée CSS/TSX du
     template — pour `react-ts`, importe-le depuis `src/main.tsx` ou fusionne dans `src/index.css`),
   - écrit aussi `DESIGN.md` du système à la racine du projet (référence pour toi/l'agent + le futur mode IA),
   - ne casse RIEN si l'id est absent/inconnu (no-op, log).
   Dans `TemplateEngine.generate` (ou juste après, dans le handler scaffold), APRÈS la génération des fichiers
   du template, si `options.designSystem` est défini, appelle `applyDesignSystem(projectDir, options.designSystem)`.
   Garde l'édit de `project-scaffolding.ts` MINIMAL (juste passer/consommer le champ + 1 appel).
5. **Résultat attendu** : générer une « todo app React » avec le style **Spotify** → le projet a les tokens
   Spotify (vert `#1ed760`, near-black) dans son CSS + un DESIGN.md. Sans style choisi → comportement actuel inchangé.

## Contraintes
- Modifie/crée : `cowork/src/renderer/components/studio/*` (StudioComposer, studio-api, studio-api-bridge,
  use-app-studio, + le module catalogue), `cowork/src/main/studio/*` (le handler scaffold pour passer le champ —
  SEULEMENT ça), `src/templates/design-system-apply.ts` (NOUVEAU), `src/templates/project-scaffolding.ts`
  (édit MINIMAL : accepter+forwarder `designSystem`). **NE TOUCHE PAS** `App.tsx`/`NewShell.tsx`/`store/index.ts`.
  Pour l'IPC : n'ajoute PAS de méthode ; le champ passe dans l'objet request scaffold existant.
- TS strict, `noUncheckedIndexedAccess` ON, single quotes, semicolons, imports `.js`. `git add` explicite.
  NE PUSH PAS, NE MERGE PAS. Commits atomiques, trailer :
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Wten2ENavfScZnAfZRCSix
  ```
  Messages : `feat(cowork): design system selector in App Studio` / `feat(templates): brand scaffold with chosen design system`.
- Gate : `npx tsc --noEmit` (racine) = 0 sur tes fichiers noyau ; `cd cowork && npx tsc --noEmit` = 0 (ignore
  `Cannot find module 'openai'`) + `npx vite build` exit 0. Smoke core : `applyDesignSystem` sur un dossier temp
  écrit bien `design-system.css` avec les tokens Spotify. `git status` propre.

## Compte-rendu (français) : le sélecteur (où/comment le catalogue est lu), le threading de `designSystem`,
l'injection tokens (fichiers écrits + import), édits de project-scaffolding.ts, tsc/vite, smoke, SHA(s), limites.
Ne pousse pas — Fable gate + valide via computer-use (générer une app brandée + screenshot).
