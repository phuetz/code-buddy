/**
 * Ce qui ne sort JAMAIS d'un projet App Studio par l'export zip : dépendances,
 * dépôts git (celui de l'utilisateur et celui des versions sous `.codebuddy`),
 * sorties de build (un bundle peut contenir une variable `VITE_`),
 * et tout fichier `.env` / `.env.*` à n'importe quel niveau (secrets).
 *
 * @module main/studio/studio-export-excludes
 */

export const STUDIO_ZIP_IGNORE: readonly string[] = [
  'node_modules/**',
  '**/node_modules/**',
  '.git/**',
  '**/.git/**',
  '.codebuddy/**',
  // Sorties de build : un bundle peut contenir une variable VITE_ (publique une fois construite).
  'dist/**',
  'build/**',
  'out/**',
  '.studio-probe-dist/**',
  '.env',
  '.env.*',
  '**/.env',
  '**/.env.*',
];
