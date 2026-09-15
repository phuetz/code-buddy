// Private Vite config for the Cowork Electron recette (P4/P6/P8).
// Mirrors cowork/vite.config.ts, but every output and cache goes under
// $RECETTE_ELECTRON_DIR and nothing is written in the repo or
// in the shared node_modules. Loaded with --configLoader native (no bundling).
import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
if (!process.env.RECETTE_WORKTREE || !process.env.RECETTE_ELECTRON_DIR) throw new Error('set RECETTE_WORKTREE (repo under test) and RECETTE_ELECTRON_DIR (private output dir)');
const cowork = `${process.env.RECETTE_WORKTREE}/cowork`;
const out = `${process.env.RECETTE_ELECTRON_DIR}/out`;
const { defineConfig } = await import(`${cowork}/node_modules/vite/dist/node/index.js`);
const react = (await import(`${cowork}/node_modules/@vitejs/plugin-react/dist/index.js`)).default;
const electron = (await import(`${cowork}/node_modules/vite-plugin-electron/dist/index.mjs`)).default;
const { alasqlReactNativeModules, mainProcessExternals } = await import(`${cowork}/vite.config.ts`).catch(() => ({}));

const nodeBuiltins = builtinModules.flatMap((m) => [m, `node:${m}`]);
const externals = mainProcessExternals ?? [
  ...nodeBuiltins, 'better-sqlite3', 'bufferutil', 'utf-8-validate', 'electron', '@anthropic-ai/sdk', '@larksuiteoapi/node-sdk',
  'openai', '@modelcontextprotocol/sdk', 'electron-updater', 'chokidar', 'archiver', '@ngrok/ngrok', 'ws', 'glob', 'dotenv',
];
const ignore = alasqlReactNativeModules ?? ['react-native', 'react-native-fs', 'react-native-fetch-blob'];
const cacheDir = `${process.env.RECETTE_ELECTRON_DIR}/vite-cache`;

export default defineConfig({
  root: cowork,
  cacheDir,
  logLevel: 'warn',
  plugins: [
    react(),
    electron([
      {
        entry: `${cowork}/src/main/index.ts`,
        vite: {
          root: cowork,
          cacheDir,
          build: {
            outDir: `${out}/dist-electron/main`,
            emptyOutDir: true,
            minify: false,
            sourcemap: false,
            commonjsOptions: { ignore },
            rollupOptions: { external: externals, output: { interop: 'auto' } },
          },
          resolve: { alias: { '@': `${cowork}/src`, '@main': `${cowork}/src/main`, '@renderer': `${cowork}/src/renderer`, '@codebuddy': resolve(cowork, '..', 'src') } },
        },
      },
      {
        entry: `${cowork}/src/preload/index.ts`,
        vite: {
          root: cowork,
          cacheDir,
          build: { outDir: `${out}/dist-electron/preload`, emptyOutDir: true, minify: false, sourcemap: false, rollupOptions: { external: ['electron'] } },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': `${cowork}/src`,
      '@main': `${cowork}/src/main`,
      '@renderer': `${cowork}/src/renderer`,
      '@codebuddy': resolve(cowork, '..', 'src'),
    },
  },
  build: { outDir: `${out}/dist`, emptyOutDir: true, sourcemap: false, minify: false },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
});
