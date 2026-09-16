import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import { resolve } from 'path';
import { builtinModules } from 'module';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';

/**
 * Copy auxiliary main-process assets (Python workers, native helpers)
 * next to the compiled main bundle. Vite/rollup ignores anything that
 * isn't reachable from the JS entry, so we copy here.
 */
function copyMainAssets(): Plugin {
  const sources = [
    {
      from: resolve(__dirname, 'src/main/voice/transcribe-worker.py'),
      to: resolve(__dirname, 'dist-electron/main/transcribe-worker.py'),
    },
  ];
  return {
    name: 'cowork-copy-main-assets',
    closeBundle() {
      for (const { from, to } of sources) {
        if (!existsSync(from)) continue;
        mkdirSync(resolve(to, '..'), { recursive: true });
        copyFileSync(from, to);
      }
    },
  };
}

// Node built-in modules must be external for Electron main process
const nodeBuiltins = builtinModules.flatMap(m => [m, `node:${m}`]);

/**
 * React Native modules required by AlaSQL's Node entry (`dist/alasql.fs.js`,
 * picked by the `node` export condition), reached through the core SqlAgent
 * fallback: `require('react-native')` inside a try/catch, then
 * `react-native-fs` and `react-native-fetch-blob` only when that probe
 * succeeds. npm installs `react-native` and `react-native-fs` as peers of
 * AlaSQL's optional dependency, so the CommonJS plugin would parse their Flow
 * sources and abort the main build. Marking them external is not enough: the
 * plugin hoists the unguarded requires to the top of the chunk, which throws at
 * load time wherever they are absent. `commonjsOptions.ignore` leaves the calls
 * untouched and lazy: AlaSQL is never externalized, stays bundled whenever the
 * main graph includes it, and the probe simply fails under Electron.
 */
export const alasqlReactNativeModules = [
  'react-native',
  'react-native-fs',
  'react-native-fetch-blob',
];

export const mainProcessExternals = [
  ...nodeBuiltins,
  'better-sqlite3',
  'bufferutil',
  'utf-8-validate',
  'electron',
  // Externalize large CJS-compatible main-process dependencies
  // NOTE: ESM-only packages (pi-coding-agent, pi-ai, electron-store, uuid)
  // must stay bundled — CJS require() can't load them
  '@anthropic-ai/sdk',
  '@larksuiteoapi/node-sdk',
  'openai',
  '@modelcontextprotocol/sdk',
  'electron-updater',
  'chokidar',
  'archiver',
  // Native N-API bindings are packaged separately and must not be
  // parsed or inlined by Rollup.
  '@ngrok/ngrok',
  'ws',
  'glob',
  'dotenv',
];

const ignoredWatchPaths = [
  '**/release/**',
  '**/dist/**',
  '**/dist-electron/**',
  '**/dist-wsl-agent/**',
  '**/dist-lima-agent/**',
  '**/dist-mcp/**',
];

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        onstart(args) {
          args.startup();
        },
        vite: {
          plugins: [copyMainAssets()],
          build: {
            outDir: 'dist-electron/main',
            emptyOutDir: true,
            commonjsOptions: {
              ignore: alasqlReactNativeModules,
            },
            rollupOptions: {
              external: mainProcessExternals,
              output: {
                // Ensure consistent interop for CJS/ESM
                interop: 'auto',
              },
            },
          },
        },
      },
      {
        entry: 'src/preload/index.ts',
        onstart(args) {
          args.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            emptyOutDir: true,
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@codebuddy': resolve(__dirname, '..', 'src'),
    },
  },
  server: {
    watch: {
      ignored: ignoredWatchPaths,
    },
  },
  build: {
    sourcemap: process.env.NODE_ENV !== 'production',
    outDir: 'dist',
    emptyOutDir: true,
    minify: process.env.NODE_ENV === 'production',
  },
  define: {
    // Bake NODE_ENV at build time so React picks the correct prod/dev
    // bundle. Without this, vite leaves `process.env.NODE_ENV` as a
    // runtime expression which evaluates to "production" inside the
    // packaged bundle even when launched with NODE_ENV=development.
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
});
