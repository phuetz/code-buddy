# Réparation E18 — fermeture des points D5 à D11

Rapport initialisé avant toute inspection du dépôt, conformément à la mission E18.

## Journal de vérification

| Point | Rouge | Correctif | Vert | Commit |
|---|---|---|---|---|
| D5 | `npx vitest run tests/scripts/package-lifecycle.test.ts` : 1 échec ; clone frais : `ENOENT ... codebuddy-runtime.json`, exit 1 | `package.json` : `prepack` exécute `npm run build`, retire les sourcemaps puis génère le manifeste | `npx vitest run tests/scripts/package-lifecycle.test.ts` : 1 fichier / 1 test PASS. Preuve `npm pack` sur clone corrigé à faire après commit. | À faire |
| D6 | À établir | À faire | À faire | À faire |
| D7 | À établir | À faire | À faire | À faire |
| D8 | À établir | À faire | À faire | À faire |
| D9 | À établir | À faire | À faire | À faire |
| D10 | À établir | À faire | À faire | À faire |
| D11 | À établir | À faire | À faire | À faire |

## Défauts non réglés

- D5 réglé dans le code ; la preuve `npm pack` après commit reste à coller.

## Commandes, sorties et commits

### D5 — paquet depuis un checkout frais

Rouge avant correctif :

```text
$ npx vitest run tests/scripts/package-lifecycle.test.ts
FAIL — expected prepack to contain `npm run build`; received `node scripts/strip-sourcemaps.mjs && node scripts/write-runtime-manifest.mjs --verify`

$ npm pack  # dans _e18/fresh-d5-red, clone sans dist ni manifeste
> @phuetz/code-buddy@2.0.0 prepack
> node scripts/strip-sourcemaps.mjs && node scripts/write-runtime-manifest.mjs --verify
ENOENT: no such file or directory, open '.../codebuddy-runtime.json'
npm error code 1
```

Correctif et vert local :

```text
package.json: prepack = npm run build && node scripts/strip-sourcemaps.mjs && node scripts/write-runtime-manifest.mjs

$ npx vitest run tests/scripts/package-lifecycle.test.ts
Test Files  1 passed (1)
Tests       1 passed
```

Commit D5 : à compléter après commit ; `npm pack` sur un clone frais issu de ce commit sera collé ci-dessous.
