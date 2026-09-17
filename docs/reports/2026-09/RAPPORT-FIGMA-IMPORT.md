# Mission Grok — Import Figma → écrans (rattrapage bolt.new, point 4)

**STATUT : COMPLET après contre-revue AGY** (pas de commit, consigne de session)

Branche : `feat/figma-2026-09-17`  
Worktree : `worktree cb-figma-2026-09-17`  
HEAD de départ : `b5c50c189` (`origin/main`)  
Livrable : `<dépôt privé de passation>/20260917-cowork-comparaison/IMPORT-FIGMA.md`  
Contre-revue : `REVUE-AGY-figma.md` (2026-09-18)

## Garde-fous tenus

- Pas de commit, pas de `rm -rf` shell, pas de secret en clair.
- Aucun appel réseau dans les tests ; fetch injecté pour le chemin file-key.
- `git add` non effectué (pas de commit).

## Constat

Les occurrences « figma » étaient le pack de design vendu `assets/design-systems/figma/` + l’outil `design_system` + un exemple `@url:figma.com`. Pas d’importeur. Réutilisé : `applyDesignSystem` et la colonne de tokens `--bg` / `--space-*` / `--text-*`.

## Livraison

- IR + générateur React/CSS : `src/figma/`
- CLI : `buddy figma import`
- Outil agent : `figma_import` (baseline tool-surface mise à jour)
- Tests : `tests/figma/` (simple, répété, non géré, invalide, compile+rendu, fetch injecté, plus les trois cas de la contre-revue)

## Vérifications (lot initial)

- `npm test -- tests/figma/import-figma.test.ts` : 12/12 (avant contre-revue)
- tool-surface + dispatch invariant + design-system : verts
- eslint des fichiers nouveaux : 0
- tsc : 0 diagnostic sur la zone (rouge préexistant `@phuetz/companion-core` hors chantier)

## Corrections après contre-revue

Les trois anomalies de `REVUE-AGY-figma.md` sont justes. Aucune n’a été contestée. Aucun test existant n’a été affaibli, ignoré ou privé d’assertion.

### 1. Rayon pill — `radiusClass` (`src/figma/generate-react.ts`)

Le seuil `>= 999` était évalué après `>= 40`, donc jamais atteint. Ordre corrigé : `>= 999` (pill) → `>= 40` (sm) → `>= 6` (md).

**Test :** `positions nested absolute frames relative to their parent and maps pill radius`  
Fixture `tests/figma/fixtures/nested-absolute.json` : rectangle `10:4` à `cornerRadius: 9999` → `figma-radius-pill` ; `10:5` à `40` → `figma-radius-sm`. Assertion négative : le pill ne reçoit pas `figma-radius-sm`.

### 2. Coordonnées relatives au parent (`src/figma/extract-ir.ts`)

`absoluteBoundingBox` du canevas n’est plus recopié tel quel dans l’IR. `box.x` / `box.y` d’un enfant = boîte abs. enfant − boîte abs. du parent immédiat. Le générateur CSS `left`/`top` consomme déjà `node.box` ; un cadre imbriqué n’est plus projeté hors de son conteneur.

**Tests :**
- `stores child boxes relative to the parent, not the Figma canvas origin` — parent canevas `(500, 300)`, panneau Figma `(520, 340)` → IR `{ x: 20, y: 40 }` ; libellé `(530, 350)` → `{ x: 10, y: 10 }` par rapport au panneau.
- `positions nested absolute frames relative to their parent and maps pill radius` — JSX et HTML rendus contiennent `left: 20` / `top: 40`, pas `left: 520` / `top: 340`.

### 3. Composition de composants imbriqués (`src/figma/generate-react.ts`)

`generateComponentFile` reçoit la table globale, transmet `hostComponentId` pour ne pas s’auto-instancier, et émet `import { Child } from './Child.js'` pour les instances internes.

**Tests :**
- `keeps nested component instances on the parent component IR` — `Banner` contient une instance `Button` (`componentId` + `label: Open`).
- `emits nested component imports instead of flattening inner instances` — `Banner.tsx` importe `./Button.js` et rend `<Button` ; `Gallery.tsx` rend `<Banner` ; compile + rendu HTML : `Welcome` et `Open`.

### Preuve 2026-09-18

```
npx vitest run tests/figma/import-figma.test.ts
  Test Files  1 passed (1)
  Tests       16 passed (16)
```

- ESLint du périmètre Figma : exit 0.
- `tsc --noEmit` : 0 diagnostic sur `src/figma/`, `src/commands/figma.ts`, outils Figma, `tests/figma/`. Restent les 2 erreurs préexistantes `TS2307` sur `@phuetz/companion-core` dans `src/companion/core-adapter.ts`.
