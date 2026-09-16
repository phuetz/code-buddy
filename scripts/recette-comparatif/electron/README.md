# Recette Electron P4 / P6 / P8 (fenêtre Cowork réelle)

Deux variables obligatoires, sans valeur par défaut pour ne jamais tester un ancien build par erreur :
`RECETTE_WORKTREE` (dépôt testé) et `RECETTE_ELECTRON_DIR` (répertoire privé de sorties et caches, hors dépôt).
Dépendances partagées lues seulement, à travers `cowork/node_modules` et le `node_modules` racine.

1. Copier `vite.e2e.config.mjs`, `electron-main.cjs`, `resolve-hooks.mjs` et `recette.mjs` dans `$RECETTE_ELECTRON_DIR`.
2. `node scripts/recette-comparatif/electron/build.mjs` : build Vite renderer, main et preload vers `$RECETTE_ELECTRON_DIR/out` (cacheDir privé).
3. `node node_modules/typescript/bin/tsc -p tsconfig.json --outDir $RECETTE_ELECTRON_DIR/core/dist --incremental false --sourceMap false --declaration false --declarationMap false`,
   puis copier `core-package.json` vers `$RECETTE_ELECTRON_DIR/core/package.json` (type module).
   Variante : `RECETTE_ENGINE_DIST=<préfixe jetable>/lib/node_modules/@phuetz/code-buddy/dist` pour tester le moteur du paquet installé.
4. `xvfb-run -a -s "-screen 0 1440x900x24" node $RECETTE_ELECTRON_DIR/recette.mjs <label>`

Le `summary.json` enregistre HEAD, l'état propre ou non du worktree, la version et le build moteur utilisé.
La recette utilise un HOME et un userData jetables, un fournisseur FIXTURE sur 127.0.0.1 (pas un modèle), un serveur de
contrôle loopback pour les endpoints de ressources et le préchargement `no-external-network.cjs`. Aucun compte, aucun cloud.
