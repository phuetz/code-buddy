// Private Electron entry for the P4/P6/P8 recette (mirrors cowork/e2e/electron-main.cjs).
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const { app } = require('electron');

const worktree = process.env.RECETTE_WORKTREE;
if (!worktree) throw new Error('RECETTE_WORKTREE is required');
// CommonJS externals of the main bundle: shared Cowork deps, then root deps (read-only).
process.env.NODE_PATH = [path.join(worktree, 'cowork/node_modules'), path.join(worktree, 'node_modules')].join(path.delimiter);
Module._initPaths();
// ESM core build under /tmp: resolve bare imports from the worktree.
Module.register(pathToFileURL(path.join(__dirname, 'resolve-hooks.mjs')).href);

if (process.env.COWORK_E2E_USER_DATA_DIR) app.setPath('userData', process.env.COWORK_E2E_USER_DATA_DIR);
require(path.join(__dirname, 'out/dist-electron/main/index.js'));
