export interface GenerationStack {
  id: string;
  label: string;
  description: string;
  planStack: string;
  guidance: string;
  previewNote: string;
  runnable: boolean;
}

export const GENERATION_STACKS: GenerationStack[] = [
  {
    id: 'static',
    label: 'Static web',
    description: 'Pure HTML/CSS/JS, with an index.html you can open directly and no build required.',
    planStack: 'HTML/CSS/JS',
    guidance:
      '- Stack : génère une application HTML/CSS/JS pur avec index.html, styles intégrés ou fichier CSS simple, script JS autonome, sans dépendance, sans package.json et ouvrable directement dans un navigateur.',
    previewNote: 'Preview available via a local http.server exposed on loopback.',
    runnable: true,
  },
  {
    id: 'react-vite',
    label: 'React + Vite',
    description: 'React/TypeScript SPA with Vite, package.json, and an npm run dev command.',
    planStack: 'React + Vite',
    guidance:
      '- Stack : génère une SPA React/TypeScript avec Vite, incluant package.json, index.html, src/main.tsx, src/App.tsx et les styles nécessaires, lançable avec npm run dev.',
    previewNote: 'Preview available via the Vite dev server.',
    runnable: true,
  },
  {
    id: 'vue-vite',
    label: 'Vue + Vite',
    description: 'Vue 3/TypeScript SPA with Vite, package.json, and an npm run dev command.',
    planStack: 'Vue + Vite',
    guidance:
      '- Stack : génère une SPA Vue 3/TypeScript avec Vite, incluant package.json, index.html, src/main.ts, src/App.vue et les styles nécessaires, lançable avec npm run dev.',
    previewNote: 'Preview available via the Vite dev server.',
    runnable: true,
  },
  {
    id: 'pwa',
    label: 'PWA mobile',
    description:
      'Installable mobile web app with manifest, service worker, icons, and offline support.',
    planStack: 'PWA (HTML/CSS/JS)',
    guidance:
      '- Stack : génère une PWA mobile en HTML/CSS/JS avec index.html, manifest.webmanifest, service worker enregistré, icônes référencées, meta viewport et stratégie hors-ligne honnête pour les assets locaux.',
    previewNote: 'Web preview available; the app installs from the mobile browser.',
    runnable: true,
  },
  {
    id: 'expo',
    label: 'Mobile (React Native / Expo)',
    description: 'Native mobile app via Expo/React Native with App.tsx and an Expo package.json.',
    planStack: 'React Native (Expo)',
    guidance:
      '- Stack : génère une application React Native/Expo avec App.tsx, package.json Expo, tsconfig si utile, composants compatibles mobile et sans supposer de preview navigateur Cowork.',
    previewNote:
      'No preview in Cowork; run it with `npx expo start` on a device or emulator.',
    runnable: false,
  },
];

export function findStack(id: string | undefined): GenerationStack | undefined {
  return GENERATION_STACKS.find((stack) => stack.id === id) ?? GENERATION_STACKS[0];
}
