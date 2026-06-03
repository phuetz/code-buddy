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
const ignoredWatchPaths = [
  '**/release/**',
  '**/dist/**',
  '**/dist-electron/**',
  '**/dist-wsl-agent/**',
  '**/dist-lima-agent/**',
  '**/dist-mcp/**',
];

function rendererManualChunks(id: string): string | undefined {
  const normalized = id.replace(/\\/g, '/');
  if (!normalized.includes('/node_modules/')) {
    return undefined;
  }

  if (
    normalized.includes('/react/') ||
    normalized.includes('/react-dom/') ||
    normalized.includes('/scheduler/') ||
    normalized.includes('/use-sync-external-store/') ||
    normalized.includes('/zustand/') ||
    normalized.includes('/i18next/') ||
    normalized.includes('/react-i18next/')
  ) {
    return 'vendor-react';
  }

  if (normalized.includes('/lucide-react/')) {
    return 'vendor-icons';
  }

  if (normalized.includes('/highlight.js/')) {
    return 'vendor-highlight';
  }

  if (normalized.includes('/katex/')) {
    return 'vendor-katex';
  }

  if (
    normalized.includes('/react-markdown/') ||
    normalized.includes('/remark-') ||
    normalized.includes('/rehype-') ||
    normalized.includes('/micromark') ||
    normalized.includes('/mdast-') ||
    normalized.includes('/hast-') ||
    normalized.includes('/unified/') ||
    normalized.includes('/unist-') ||
    normalized.includes('/vfile')
  ) {
    return 'vendor-markdown';
  }

  return undefined;
}

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
            rollupOptions: {
              external: [
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
                'ngrok',
                'ws',
                'glob',
                'dotenv',
              ],
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
    rollupOptions: {
      output: {
        manualChunks: rendererManualChunks,
      },
    },
  },
  define: {
    // Bake NODE_ENV at build time so React picks the correct prod/dev
    // bundle. Without this, vite leaves `process.env.NODE_ENV` as a
    // runtime expression which evaluates to "production" inside the
    // packaged bundle even when launched with NODE_ENV=development.
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
  },
});
