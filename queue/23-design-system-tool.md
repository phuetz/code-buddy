# Vague — Tool `design_system` + service (lire les 150 systèmes de design)

Tu es GPT-5.5 (Codex). Tu ajoutes au **noyau** de Code Buddy un service + un tool `design_system`
qui exposent les 150 systèmes de design déjà présents dans `assets/design-systems/`. But : l'agent
(et bientôt App Studio) peut **lister** les styles et **lire** le DESIGN.md d'un style choisi pour
générer une UI brandée (Spotify, Apple, Brutalism…). Worktree isolé `feat/design-system-tool` —
ne change pas de branche, ne fais pas `git worktree add`.

## Ce qui existe déjà (NE PAS recréer)
- `assets/design-systems/<id>/DESIGN.md` — le brief de design de marque (couleurs exactes, typo,
  géométrie, ombres). C'est LE contenu à injecter dans la génération.
- `assets/design-systems/<id>/design-tokens.json`, `tokens.css`, `manifest.json` (id/name/category/description).
  ⚠️ Le manifest référence aussi des fichiers NON copiés (`components.html`, `preview/`, `source/`,
  `tailwind-v4.css`) — **ne lis JAMAIS ces chemins**, ils n'existent pas ici. Utilise seulement
  DESIGN.md, design-tokens.json, tokens.css, manifest.json, catalog.json.
- `assets/design-systems/catalog.json` — index `{ schema, count, systems:[{id,name,category,tagline}] }`
  (déjà généré, 150 entrées). C'est la source de vérité pour lister ; ne re-scanne pas les 150 dossiers.

## Référence de câblage (copie ce motif EXACT)
Le tool `weather` montre le câblage complet d'un tool read-only :
- classe : `src/tools/weather.ts` (retourne `Promise<ToolResult>` = `{ success, output?, error? }`)
- définition OpenAI : `src/codebuddy/tools.ts` (cherche le bloc `name: 'weather'`)
- case d'exécution : `src/agent/codebuddy-agent.ts` `executeTool()` (cherche `case 'weather'`)
- factory registry : `src/tools/registry/web-tools.ts` (cherche l'enregistrement weather)
- metadata : `src/tools/metadata.ts:~227` (`name:'weather'`, keywords, priority)
Étudie ces 5 points AVANT de coder, puis reproduis-les pour `design_system`.

## Tâches

### 1. Service `src/design/design-system-registry.ts` (NOUVEAU)
- `resolveDesignAssetsDir(): string` — trouve `assets/design-systems/` de façon ROBUSTE depuis src
  (dev/tsx) ET dist (runtime Cowork embedded charge depuis `dist/`). Depuis `import.meta.url` +
  `fileURLToPath`, remonte les dossiers parents jusqu'à en trouver un contenant
  `assets/design-systems/catalog.json`. (Depuis `dist/design/…` → remonte à la racine repo ;
  depuis `src/design/…` → idem.) Cache le résultat. Lève une erreur claire si introuvable.
- `loadCatalog(): DesignSystemSummary[]` — parse `catalog.json`. Type `DesignSystemSummary = { id, name, category, tagline }`.
- `listDesignSystems(opts?: { category?: string; query?: string }): DesignSystemSummary[]` — filtre le
  catalogue (category insensible casse ; query = match sur id/name/tagline/category, insensible casse).
- `getDesignSystem(id: string): DesignSystemDetail | null` — VALIDE d'abord que `id` est dans le
  catalogue (rejette tout id inconnu → protège du path traversal, ne concatène jamais un id non validé).
  Retourne `{ id, name, category, tagline, design: string /*DESIGN.md*/, tokensCss?: string, designTokens?: unknown }`.
  Lis DESIGN.md (obligatoire), tokens.css et design-tokens.json (optionnels, tolère l'absence).
- `buildDesignGuidance(id: string, opts?: { maxChars?: number }): string | null` — produit le BLOC de
  guidance à injecter dans une génération d'app : un en-tête impératif
  (« Applique fidèlement ce système de design — couleurs, typographie, géométrie, ombres, espacements »)
  suivi du DESIGN.md (tronqué proprement à `maxChars`, défaut ~6000, coupe sur une frontière de ligne,
  ajoute « …[tronqué] » si coupé). Retourne null si id inconnu. (App Studio l'utilisera plus tard.)
- Tout synchrone (fs.readFileSync) c'est OK ici (petits fichiers, appelé rarement).

### 2. Tool `src/tools/design-system-tool.ts` (NOUVEAU)
Classe `DesignSystemTool` (mirroir de `WeatherTool`). `execute(args)` avec :
- `action: 'list' | 'get'` (requis).
- `list` : params optionnels `category`, `query` → `output` = un résumé lisible (markdown) des systèmes
  filtrés (id — name — category — tagline), + note du total. Groupé par catégorie si pas de filtre.
- `get` : param `id` requis → `output` = la guidance de design (`buildDesignGuidance(id)`) + un rappel
  des tokens clés si dispo. Erreur claire (`success:false`) si id inconnu (liste 3-4 ids proches en indice).
- Read-only, ne touche aucun fichier utilisateur, ne fait aucun réseau.

### 3. Câblage (les 4 points, motif weather)
- `src/codebuddy/tools.ts` : définition OpenAI `design_system` (params action/id/category/query, enum sur action).
- `src/agent/codebuddy-agent.ts` : `case 'design_system':` dans `executeTool()` qui instancie et exécute.
- registry : ajoute un enregistrement — crée `src/tools/registry/design-tools.ts` (petit, propre) et
  importe-le/enregistre-le là où les autres factories le sont (`src/tools/registry/index.ts`), OU ajoute
  au factory le plus proche si c'est le motif. Suis EXACTEMENT comment weather est enregistré.
- `src/tools/metadata.ts` : entrée `name:'design_system'`, keywords (`design`, `design system`, `ui`,
  `brand`, `branding`, `style`, `theme`, `spotify`, `apple`, `brutalism`, `interface`, `landing`,
  `esthétique`, `charte`…), priority raisonnable, **`fleetSafe: true`** (read-only, exposable via peer.tool.invoke).

### 4. Packaging
- `package.json` (racine) : si un champ `files` existe et liste ce qui est publié npm, ajoute
  `"assets/design-systems"` pour que les assets soient embarqués. S'il n'y a pas de champ `files`, ne fais rien.

## Contraintes
- Modifie/crée UNIQUEMENT : `src/design/design-system-registry.ts`, `src/tools/design-system-tool.ts`,
  `src/tools/registry/design-tools.ts`, et les points de câblage minimaux dans `src/codebuddy/tools.ts`,
  `src/agent/codebuddy-agent.ts`, `src/tools/registry/index.ts`, `src/tools/metadata.ts`, `package.json`.
  **NE TOUCHE PAS** `cowork/` ni `src/templates/` (des vagues y travaillent en parallèle).
- TS strict, éviter `any`, single quotes, semicolons, imports `.js` (même depuis `.ts`). `noUncheckedIndexedAccess` est ON.
- `git add` explicite fichier par fichier. NE PUSH PAS, NE MERGE PAS. Commits atomiques.
- Trailer sur chaque commit :
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Wten2ENavfScZnAfZRCSix
  ```
  Message type : `feat(design): design_system tool + registry service`.
- Gate avant de finir : `npx tsc --noEmit` (racine) = 0 sur tes fichiers. **Smoke réel** (pas de mock) :
  un petit script tsx/node qui importe le service et vérifie `loadCatalog().length === 150`,
  `getDesignSystem('spotify')?.design` contient `Spotify`, `buildDesignGuidance('spotify')` non vide,
  `getDesignSystem('inconnu-xyz')` === null. Colle la sortie dans le compte-rendu. `git status` propre.

## Compte-rendu (français)
Les fichiers créés/touchés, comment `resolveDesignAssetsDir` remonte (dev + dist), le résultat du smoke
(catalogue=150, get spotify OK, id inconnu=null), tsc, SHA(s), limites honnêtes. Ne pousse pas — Fable gate + intègre.
