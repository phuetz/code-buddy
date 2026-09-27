/**
 * Starter skeletons seeded into an EMPTY target directory before App Studio's
 * AI generation turn (idea taken from bolt.diy's starter templates: the model
 * edits a known-good project instead of inventing package.json, Vite config and
 * entry points from memory — the part weak/local models get wrong most often).
 *
 * Pure data + helpers: no fs, no IPC. NewShell writes the files through the
 * existing `studio.files.write` IPC; the generation prompt is told the skeleton
 * exists (buildAiGenerationPrompt `starterSeeded`).
 *
 * Versions are pinned to majors that exist on npm and that models know well
 * (React 18 + Vite 5). `build` is plain `vite build` so the preview health
 * check measures what breaks rendering, not strict type-check noise; type
 * checking stays available as `npm run typecheck`.
 *
 * @module renderer/components/studio/starter-templates
 */

export interface StarterFile {
  path: string;
  content: string;
}

/** Marker rendered by the placeholder App: its presence means "not generated yet". */
export const STARTER_PLACEHOLDER_ATTR = 'data-studio-starter';

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
`;

const REACT_VITE: StarterFile[] = [
  {
    path: 'package.json',
    content: `{
  "name": "studio-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.7.0",
    "typescript": "~5.6.3",
    "vite": "^5.4.21"
  }
}
`,
  },
  {
    path: 'vite.config.ts',
    content: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`,
  },
  { path: 'tsconfig.json', content: TSCONFIG },
  {
    path: 'index.html',
    content: `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
  },
  {
    path: 'src/main.tsx',
    content: `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
  },
  {
    path: 'src/index.css',
    content: `*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
}
`,
  },
  {
    path: 'src/App.tsx',
    content: `// Placeholder written by App Studio's starter skeleton: REPLACE this file.
export default function App() {
  return <main ${STARTER_PLACEHOLDER_ATTR}="">Génération en cours…</main>;
}
`,
  },
];

const VUE_VITE: StarterFile[] = [
  {
    path: 'package.json',
    content: `{
  "name": "studio-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.5.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.2.4",
    "typescript": "~5.6.3",
    "vite": "^5.4.21"
  }
}
`,
  },
  {
    path: 'vite.config.ts',
    content: `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
});
`,
  },
  {
    path: 'index.html',
    content: `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
  },
  {
    path: 'src/main.ts',
    content: `import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

createApp(App).mount('#app');
`,
  },
  {
    path: 'src/env.d.ts',
    content: `/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
`,
  },
  {
    path: 'src/style.css',
    content: `*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
}
`,
  },
  {
    path: 'src/App.vue',
    content: `<!-- Placeholder written by App Studio's starter skeleton: REPLACE this file. -->
<template>
  <main ${STARTER_PLACEHOLDER_ATTR}="">Génération en cours…</main>
</template>
`,
  },
];

const STARTERS: Record<string, StarterFile[]> = {
  'react-vite': REACT_VITE,
  'vue-vite': VUE_VITE,
};

/** Skeleton files for a generation stack, or [] when the stack has none. */
export function getStarterFiles(stackId: string | undefined): StarterFile[] {
  return (stackId && STARTERS[stackId]) ? STARTERS[stackId].map((f) => ({ ...f })) : [];
}

export function hasStarter(stackId: string | undefined): boolean {
  return getStarterFiles(stackId).length > 0;
}

/**
 * Seed only into a directory that holds no project yet: never overwrite a
 * user's existing package.json / index.html (an "iterate on my project" run).
 */
export function shouldSeedStarter(stackId: string | undefined, existingRootFiles: readonly string[]): boolean {
  if (!hasStarter(stackId)) return false;
  const lower = existingRootFiles.map((f) => f.toLowerCase());
  return !lower.includes('package.json') && !lower.includes('index.html');
}

/** Short description injected in the generation prompt (kept in sync with the files above). */
export function describeStarter(stackId: string | undefined): string | null {
  if (stackId === 'react-vite') {
    return (
      'SQUELETTE DÉJÀ EN PLACE (ne le recrée pas, ne le supprime pas) : package.json (React 18, Vite 5, ' +
      'TypeScript ; scripts dev/build/typecheck), vite.config.ts, tsconfig.json, index.html (#root), ' +
      'src/main.tsx (monte <App /> et importe ./index.css), src/index.css, et un src/App.tsx PROVISOIRE à ' +
      'REMPLACER entièrement. Écris l\'application dans src/App.tsx (export default) et src/components/*. ' +
      'Ne modifie main.tsx, vite.config.ts, tsconfig.json et index.html que si c\'est indispensable (titre de page autorisé).'
    );
  }
  if (stackId === 'vue-vite') {
    return (
      'SQUELETTE DÉJÀ EN PLACE (ne le recrée pas, ne le supprime pas) : package.json (Vue 3, Vite 5), ' +
      'vite.config.ts, index.html (#app), src/main.ts (monte App.vue et importe ./style.css), src/env.d.ts, ' +
      'src/style.css, et un src/App.vue PROVISOIRE à REMPLACER entièrement. Écris l\'application dans ' +
      'src/App.vue et src/components/*.'
    );
  }
  return null;
}
