# Rapport — Cowork aide par écran

- Date : 2026-09-17, corrections 2026-09-18
- Agent : Grok 4.6
- Worktree : `worktree cb-cowork-help-2026-09-17`
- Branche : `feat/cowork-help-2026-09-17`
- Base : `origin/main` `b5c50c189` (Code Buddy 2.2.0)
- Contre-revue : `REVUE-AGY-deploy.md`
- Contraintes : pas de git commit, pas de `rm -rf`, pas de publication, pas de sous-agent

## Objectif

Un utilisateur qui ouvre Cowork doit comprendre, sans documentation externe, à quoi sert chaque écran de la navigation réelle (`ShellNavigation.tsx`).

## Livrable

`Partage/20260917-cowork-comparaison/AIDE-ECRANS.md` **dans ce worktree** (copies `aide-work-home.png` et `aide-fleet-command.png` à côté).

36/36 écrans documentés (aucun « à documenter »). Pas de commit.

## Vérifications (après contre-revue)

```
cd cowork && npx vitest run \
  tests/shell-nav-help-coverage.test.tsx \
  tests/help-docs.test.tsx \
  tests/mission-board-surface.test.ts \
  tests/desktop-snapshot-surface.test.ts
```

4 fichiers, **20/20** tests (dont les 7 tests de surface **non réécrits**).

Voisins :

```
cd cowork && npx vitest run \
  tests/home-view.test.tsx \
  tests/live-launcher-panel.test.tsx \
  tests/global-search-dialog.test.ts
```

3 fichiers, **17/17**. Ensemble périmètre + voisins : **37/37**.

- `npm run lint` (paquet cowork) — 0 erreur, 1 avertissement préexistant `ModelInstallDialog.tsx`
- `./node_modules/.bin/tsc --noEmit` — aucun diagnostic sur `ShellNavigation.tsx`, `App.tsx`, `help/`, `HelpDocs.tsx`, `ScreenHelpButton.tsx`. Le typecheck complet du paquet reste rouge sur `../src/*` faute de `node_modules` à la racine du worktree (constat déjà dans la contre-revue).

---

## Corrections après contre-revue

Source : `REVUE-AGY-deploy.md` (2026-09-18). Tous les points ont été traités. Aucun test existant n’a été affaibli, ignoré ou réécrit pour faire passer la suite.

### 1. Régression des libellés de navigation (critique)

**Reproche** : le refactoring `actionById` + `SHELL_NAV_TREE` cassait

- `cowork/tests/mission-board-surface.test.ts` (l.27)
- `cowork/tests/desktop-snapshot-surface.test.ts` (l.32)

qui cherchent encore `label: t('missionBoard.title', 'Mission Board')` et `label: t('desktopSnapshot.title', 'Desktop Snapshot')`.

**Correction** : dans `ShellNavigation.tsx`, ces deux actions reçoivent à nouveau le libellé sous la forme exacte exigée par les tests, avec `active: showMissionBoard` / `onClick: () => setShowMissionBoard(true)` (idem snapshot). Le catalogue `SHELL_NAV_TREE` reste la source de la barre. Les deux fichiers de tests de surface n’ont **pas** été modifiés (`git diff` vide).

**Test** : `mission-board-surface` + `desktop-snapshot-surface` — 7/7. En plus, le test de couverture clique réellement les boutons `data-help-screen="mission-board"` et `desktop-snapshot` et vérifie le store.

### 2. Livrables écrits hors du worktree

**Reproche** : `AIDE-ECRANS.md` et les captures étaient dans `<dépôt privé de passation>/…`, pas dans le worktree.

**Correction** : copie **dans** le worktree, sans toucher au dossier personnel ensuite :

- `Partage/20260917-cowork-comparaison/AIDE-ECRANS.md`
- `Partage/20260917-cowork-comparaison/aide-work-home.png`
- `Partage/20260917-cowork-comparaison/aide-fleet-command.png`

**Test** : `keeps the screen-help deliverable inside the worktree` dans `tests/shell-nav-help-coverage.test.tsx`.

### 3. Dossier parasite `${APPDATA}/`

**Reproche** : créé par une installation npm locale.

**Faits** : le dossier était **déjà suivi dans HEAD** `b5c50c189` (`git cat-file -e HEAD:'${APPDATA}/npm/tsc'` → existe). Ce n’est donc pas une création exclusive de ce lot. La demande de le retirer reste valable.

**Correction** : suppression fichier par fichier (pas de `rm -rf`) des 6 shims `tsc`/`tsserver` puis `rmdir` des deux répertoires. Le working tree n’a plus `${APPDATA}/` (suppressions non commitées vs HEAD).

**Test** : `does not leave the stray APPDATA directory at the repo root`.

### 4. Licence `BUSL-1.1` dans `cowork/package-lock.json` (le plus grave)

**Reproche** : le verrou passait de `"license": "MIT"` à `"license": "BUSL-1.1"`.

**Comment ça a changé** :

1. `cowork/package.json` porte **déjà** `"license": "BUSL-1.1"` dans HEAD (inchangé par ce lot ; le fichier `cowork/LICENSE` reste MIT).
2. Une `devDependency` `happy-dom@20.14.5` a été ajoutée au paquet Cowork pour les tests DOM, alors que `happy-dom` est déjà un *peer* optionnel de Vitest et une devDep du `package.json` racine (`^20.7.0`).
3. `npm install` dans `cowork/` a réécrit `package-lock.json` : il a recopié le champ `license` de `package.json` dans `packages[""].license`, d’où MIT → BUSL-1.1, plus l’entrée `node_modules/happy-dom` et des transitives (`buffer-image-size`, `entities`, `@types/whatwg-mimetype`).

Ce n’est pas un changement de licence voulu du produit : c’est un effet de bord de `npm install` qui aligne le verrou sur `package.json`.

**Correction** :

- `git checkout HEAD -- cowork/package-lock.json` → `packages[""].license` = **MIT** à nouveau.
- Retrait de `happy-dom` dans `cowork/package.json` (retour à HEAD). Les tests `@vitest-environment happy-dom` continuent de passer via le peer Vitest déjà présent dans `cowork/node_modules`.
- Aucun `npm install` relancé, pour ne pas réécrire le verrou.

**Non traité volontairement** : le `"license": "BUSL-1.1"` de `cowork/package.json` HEAD. Ce n’est pas une modification de ce lot ; le changer serait une décision juridique, pas un rattrapage de lockfile.

**Test** : `keeps the cowork lockfile root license as MIT`.

Preuve :

```
python3 -c "import json; print(json.load(open('cowork/package-lock.json'))['packages']['']['license'])"
# MIT
git diff --stat -- cowork/package.json cowork/package-lock.json
# (vide)
```

### 5. `toContain` sur le source au lieu d’un test de comportement

**Reproche** : `expect(navigationSource).toContain('SHELL_NAV_TREE')` et `expect(appSource).toContain("e.key === 'F1'")`.

**Correction** : `cowork/tests/shell-nav-help-coverage.test.tsx` (renommé `.tsx`) :

- monte `ShellNavigation` et exige un bouton `data-help-screen` pour **chaque** id de `listShellNavScreenIds()`, dans l’ordre du catalogue ;
- appelle `handleHelpKeyDown` (F1 ouvre l’index, F2 ne fait rien, `preventDefault` honoré, store `showHelpDocs` / `helpDocsAnchor`) ;
- clique Mission Board et Desktop Snapshot et lit le store.

Le raccourci F1 d’`App.tsx` passe par `handleHelpKeyDown` exporté de `open-screen-help.ts`.

Les assertions i18n structurelles (groupes, 4 champs EN/FR, pas d’orphelin) sont conservées.

### 6. Script de capture HTML fabriqué (point d’attention)

**Reproche** : HTML ad-hoc, arbre des 6 groupes dupliqué, échec si Chromium Playwright n’est pas dans le cache hôte.

**Correction** : `cowork/scripts/screenshot-help-docs.mjs` lit `SHELL_NAV_TREE` depuis `shell-nav-catalog.ts` (plus de liste en dur), documente qu’il s’agit d’une capture HTML statique **et non** d’Electron/`HelpDocs`, et affiche une erreur explicite sans télécharger de navigateur si `chromium.launch()` échoue.

Sur cette machine, un essai `node scripts/screenshot-help-docs.mjs /tmp/test-screens-help` a produit les deux PNG (Chromium déjà présent). Le parseur de catalogue : 6 groupes, 36 écrans, `mission-board` inclus.

---

## Cartographie point → test

| Point contre-revue | Test qui le couvre |
|---|---|
| Libellés mission-board / desktop-snapshot | `mission-board-surface.test.ts`, `desktop-snapshot-surface.test.ts` (inchangés) + clic store dans `shell-nav-help-coverage.test.tsx` |
| Livrable hors worktree | `keeps the screen-help deliverable inside the worktree` |
| `${APPDATA}/` | `does not leave the stray APPDATA directory at the repo root` |
| Licence lockfile MIT | `keeps the cowork lockfile root license as MIT` |
| Coverage `toContain` | rendu DOM 36 écrans + `handleHelpKeyDown` |
| Script capture | parseur catalogue (6×36) ; message d’erreur Chromium si launch échoue |

Aucun commit. Aucune publication.
