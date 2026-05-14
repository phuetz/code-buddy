# Build status - 2026-05-14

Etat mesure dans le worktree `D:\CascadeProjects\_audit-code-buddy-main`, branche
`codex/reprise-stabilisation`.

## Vert

```bash
npm test -- tests/server/peer-tool-bridge.test.ts tests/fleet/fleet-handler.test.ts tests/server/peer-websocket-smoke.test.ts
# 88 tests passed

npm --prefix cowork test -- run tests/regenerate-helpers.test.ts tests/textarea-autogrow.test.ts tests/backend-status.test.ts tests/tool-status.test.ts src/tests/prepare-skills.test.ts src/tests/pre-build-check.test.ts
# 49 tests passed

npm run typecheck
# passed

npm --prefix cowork run typecheck
# passed

npm run build
# passed

node dist/index.js --help
# passed

node cowork/scripts/pre-build-check.js
# 8 passed, 0 warnings, 0 failed after prepare:skills

npm --prefix cowork run build
# passed; generated cowork/release/Code Buddy Cowork-1.0.0-rc.8-win-x64.exe
```

## Debloque pendant la reprise

- `cowork/resources/tray-icon.png` et `tray-iconTemplate.png` etaient absents
  alors que `cowork/scripts/build-tray-icon.js` et `electron-builder.yml` les
  exigent.
- Les PNG de tray sont maintenant versionnables via des exceptions ciblees dans
  `cowork/.gitignore`.
- `cowork/scripts/prepare-skills.js` reconstruit
  `cowork/.bundle-resources/skills` depuis `src/skills/bundled/*.skill.md` au
  build, au lieu d'exiger un dossier manuel non versionne. Le package copie ce
  dossier vers `resources/skills`, sans inclure d'eventuelles skills locales
  dans `cowork/.claude`.
- `bufferutil` et `utf-8-validate` etaient declares comme dependances
  optionnelles directes de Cowork. Electron Builder essayait donc de les
  reconstruire avec `node-gyp`, ce qui exigeait Visual Studio Build Tools sur
  Windows. Ils ont ete retires: `ws` fonctionne sans ces accelerateurs natifs.
- `peer:request` accepte maintenant les cles `admin` pour les appels Fleet
  d'administration et renvoie une reponse `peer:response` correlee sur refus de
  scope, au lieu de laisser le client expirer en timeout.

## Blocage leve

Avant cette reprise, `npm --prefix cowork run build` avancait jusqu'a
`electron-builder`, puis echouait sur le rebuild natif de `bufferutil`:

```text
Error: Could not find any Visual Studio installation to use
node-gyp failed to rebuild ... cowork\node_modules\bufferutil
```

Le build complet passe maintenant sans Visual Studio Build Tools dans cet
environnement. Les warnings restants sont des warnings Vite de taille de chunks
et de dynamic/static import; ils ne bloquent pas le packaging.

## Lecture produit

- Le CLI est dans une zone beta proche: build, help, typecheck et tests Fleet
  cibles passent.
- Cowork compile, bundle et package son installeur Windows.
- Fleet minimal a de meilleurs garde-fous: lecture fichier bornee sans charger
  tout le fichier en memoire, listing plafonne, sortie `/fleet tool` nettoyee
  avant affichage, et refus d'autorisation renvoye au bon appelant.
