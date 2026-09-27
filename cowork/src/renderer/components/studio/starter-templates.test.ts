import { describe, expect, it } from 'vitest';
import { buildAiGenerationPrompt } from './studio-ai-generation.js';
import {
  STARTER_PLACEHOLDER_ATTR,
  describeStarter,
  getStarterFiles,
  hasStarter,
  shouldSeedStarter,
} from './starter-templates.js';

describe('starter templates', () => {
  it('ships a coherent React + Vite skeleton', () => {
    const files = getStarterFiles('react-vite');
    const byPath = new Map(files.map((f) => [f.path, f.content]));
    const pkg = JSON.parse(byPath.get('package.json')!);
    expect(pkg.scripts.dev).toBe('vite');
    expect(pkg.scripts.build).toBe('vite build');
    expect(Object.keys(pkg.dependencies)).toEqual(['react', 'react-dom']);
    expect(pkg.devDependencies['@vitejs/plugin-react']).toBeDefined();
    // index.html -> src/main.tsx -> ./App + ./index.css all exist in the skeleton
    expect(byPath.get('index.html')).toContain('src="/src/main.tsx"');
    expect(byPath.get('src/main.tsx')).toContain("import App from './App'");
    expect(byPath.has('src/App.tsx')).toBe(true);
    expect(byPath.has('src/index.css')).toBe(true);
    expect(byPath.get('src/App.tsx')).toContain(STARTER_PLACEHOLDER_ATTR);
    expect(() => JSON.parse(byPath.get('tsconfig.json')!)).not.toThrow();
  });

  it('ships a coherent Vue + Vite skeleton', () => {
    const byPath = new Map(getStarterFiles('vue-vite').map((f) => [f.path, f.content]));
    expect(byPath.get('index.html')).toContain('src="/src/main.ts"');
    expect(byPath.get('src/main.ts')).toContain("import App from './App.vue'");
    expect(byPath.get('src/App.vue')).toContain(STARTER_PLACEHOLDER_ATTR);
  });

  it('has no starter for static / pwa / expo stacks', () => {
    for (const id of ['static', 'pwa', 'expo', undefined]) {
      expect(hasStarter(id)).toBe(false);
      expect(describeStarter(id)).toBeNull();
    }
  });

  it('returns copies (callers cannot mutate the catalogue)', () => {
    getStarterFiles('react-vite')[0]!.content = 'mutated';
    expect(getStarterFiles('react-vite')[0]!.content).not.toBe('mutated');
  });

  it('seeds only an empty target, never over an existing project', () => {
    expect(shouldSeedStarter('react-vite', [])).toBe(true);
    expect(shouldSeedStarter('react-vite', ['README.md'])).toBe(true);
    expect(shouldSeedStarter('react-vite', ['package.json'])).toBe(false);
    expect(shouldSeedStarter('react-vite', ['INDEX.HTML'])).toBe(false);
    expect(shouldSeedStarter('static', [])).toBe(false);
  });
});

describe('generation prompt with a seeded starter', () => {
  const req = { template: 'react-ts' as const, prompt: 'Une todo list', targetDir: '/x', vars: {}, stack: 'react-vite' };

  it('tells the model the skeleton exists and to replace the placeholder App', () => {
    const prompt = buildAiGenerationPrompt(req, { starterSeeded: true });
    expect(prompt).toContain('SQUELETTE DÉJÀ EN PLACE');
    expect(prompt).toContain('src/App.tsx PROVISOIRE');
    expect(prompt).toContain('Remplacer le src/App provisoire');
    expect(prompt).not.toContain('Créer la structure (index.html, style.css, app.js)');
  });

  it('adds the code contract (full files, resolvable imports) for npm stacks', () => {
    const prompt = buildAiGenerationPrompt(req);
    expect(prompt).toContain('RÈGLES DE CODE');
    expect(prompt).toMatch(/Chaque import doit pointer vers un fichier/);
    expect(prompt).not.toContain('SQUELETTE DÉJÀ EN PLACE');
    expect(prompt).not.toContain('(ouvrir index.html)');
  });

  it('keeps the static stack prompt on its historical scaffold step', () => {
    const prompt = buildAiGenerationPrompt({ ...req, stack: 'static' }, { starterSeeded: true });
    expect(prompt).toContain('Créer la structure (index.html, style.css, app.js)');
    expect(prompt).not.toContain('RÈGLES DE CODE');
    expect(prompt).toContain('(ouvrir index.html)');
  });
});
