/**
 * Project Templates & Scaffolding
 *
 * Generate project structures from templates:
 * - Built-in templates for common project types
 * - Custom template support
 * - Variable substitution
 * - Post-generation hooks
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { performance } from 'perf_hooks';
import { applyDesignSystem } from './design-system-apply.js';

// ============================================================================
// Types
// ============================================================================

export interface ProjectTemplate {
  name: string;
  description: string;
  category: TemplateCategory;
  version: string;
  author?: string;
  repository?: string;
  variables: TemplateVariable[];
  files: TemplateFile[];
  directories: string[];
  postGenerate?: PostGenerateHook[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export type TemplateCategory =
  | 'web'
  | 'api'
  | 'cli'
  | 'library'
  | 'fullstack'
  | 'mobile'
  | 'desktop'
  | 'microservice'
  | 'custom';

export interface TemplateVariable {
  name: string;
  description: string;
  type: 'string' | 'boolean' | 'choice';
  default?: string | boolean;
  choices?: string[];
  required?: boolean;
  validate?: string; // Regex pattern
}

export interface TemplateFile {
  path: string;
  content: string;
  condition?: string; // Variable-based condition
  executable?: boolean;
}

export interface PostGenerateHook {
  name: string;
  command: string;
  args: string[];
  condition?: string;
  optional?: boolean;
}

export interface GenerateOptions {
  template: string;
  projectName: string;
  outputDir: string;
  variables: Record<string, string | boolean>;
  skipInstall?: boolean;
  skipGit?: boolean;
  /** Optional brand design system id (e.g. 'spotify') applied after generation. */
  designSystem?: string;
}

export interface GenerateResult {
  success: boolean;
  projectPath: string;
  filesCreated: string[];
  duration: number;
  warnings: string[];
  nextSteps: string[];
}

// ============================================================================
// Built-in Templates
// ============================================================================

const TEMPLATES: Map<string, ProjectTemplate> = new Map();

// Node.js TypeScript CLI Template
TEMPLATES.set('node-cli', {
  name: 'node-cli',
  description: 'Node.js CLI application with TypeScript',
  category: 'cli',
  version: '1.0.0',
  variables: [
    {
      name: 'description',
      description: 'Project description',
      type: 'string',
      default: 'A CLI application',
    },
    {
      name: 'author',
      description: 'Author name',
      type: 'string',
      default: '',
    },
    {
      name: 'binName',
      description: 'CLI command name',
      type: 'string',
      required: true,
    },
  ],
  directories: ['src', 'tests'],
  files: [
    {
      path: 'package.json',
      content: `{
  "name": "{{projectName}}",
  "version": "0.1.0",
  "description": "{{description}}",
  "author": "{{author}}",
  "license": "MIT",
  "type": "module",
  "bin": {
    "{{binName}}": "./dist/index.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "test": "jest",
    "lint": "eslint src --ext .ts",
    "format": "prettier --write src"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "tsx": "^4.0.0",
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "eslint": "^8.0.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "prettier": "^3.0.0"
  },
  "dependencies": {
    "commander": "^11.0.0",
    "chalk": "^5.0.0"
  }
}`,
    },
    {
      path: 'tsconfig.json',
      content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}`,
    },
    {
      path: 'src/index.ts',
      content: `#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();

program
  .name('{{binName}}')
  .description('{{description}}')
  .version('0.1.0');

program
  .command('hello')
  .description('Say hello')
  .argument('[name]', 'Name to greet', 'World')
  .action((name: string) => {
    console.log(chalk.green(\`Hello, \${name}!\`));
  });

program.parse();
`,
    },
    {
      path: '.gitignore',
      content: `node_modules/
dist/
.env
.env.local
*.log
.DS_Store
coverage/
`,
    },
    {
      path: 'README.md',
      content: `# {{projectName}}

{{description}}

## Installation

\`\`\`bash
npm install -g {{projectName}}
\`\`\`

## Usage

\`\`\`bash
{{binName}} hello [name]
\`\`\`

## Development

\`\`\`bash
npm install
npm run dev
\`\`\`

## Build

\`\`\`bash
npm run build
\`\`\`
`,
    },
  ],
  postGenerate: [
    {
      name: 'Install dependencies',
      command: 'npm',
      args: ['install'],
    },
    {
      name: 'Initialize git',
      command: 'git',
      args: ['init'],
    },
  ],
});

// React TypeScript Template
TEMPLATES.set('react-ts', {
  name: 'react-ts',
  description: 'React application with TypeScript and Vite',
  category: 'web',
  version: '1.0.0',
  variables: [
    {
      name: 'description',
      description: 'Project description',
      type: 'string',
      default: 'A React application',
    },
    {
      name: 'styling',
      description: 'Styling solution',
      type: 'choice',
      choices: ['css', 'tailwind', 'styled-components'],
      default: 'css',
    },
  ],
  directories: ['src', 'src/components', 'src/hooks', 'src/utils', 'public'],
  files: [
    {
      path: 'package.json',
      content: `{
  "name": "{{projectName}}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext ts,tsx",
    "test": "vitest"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "vitest": "^1.0.0",
    "@testing-library/react": "^14.0.0",
    "eslint": "^8.0.0",
    "eslint-plugin-react-hooks": "^4.0.0"
  }
}`,
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
    {
      path: 'tsconfig.json',
      content: `{
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
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}`,
    },
    {
      path: 'tsconfig.node.json',
      content: `{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}`,
    },
    {
      path: 'index.html',
      content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{projectName}}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
    },
    {
      path: 'src/main.tsx',
      content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
    },
    {
      path: 'src/App.tsx',
      content: `import { useState } from 'react';

function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="app">
      <h1>{{projectName}}</h1>
      <p>{{description}}</p>
      <button onClick={() => setCount(c => c + 1)}>
        Count: {count}
      </button>
    </div>
  );
}

export default App;
`,
    },
    {
      path: 'src/index.css',
      content: `:root {
  font-family: Inter, system-ui, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color: #213547;
  background-color: #ffffff;
}

.app {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

button {
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid #213547;
  border-radius: 8px;
  transition: border-color 0.25s;
}

button:hover {
  border-color: #646cff;
}
`,
    },
    {
      path: '.gitignore',
      content: `node_modules/
dist/
.env
.env.local
*.log
.DS_Store
`,
    },
  ],
  postGenerate: [
    {
      name: 'Install dependencies',
      command: 'npm',
      args: ['install'],
    },
    {
      name: 'Initialize git',
      command: 'git',
      args: ['init'],
    },
  ],
});

// React + Tailwind App Studio Template
//
// This is deliberately additive: `react-ts` remains the minimal, unopinionated
// Vite scaffold. This template is the presentation-ready App Studio default.
TEMPLATES.set('react-tailwind', {
  name: 'react-tailwind',
  description: 'Presentation-ready React app with Tailwind, design tokens, reusable UI primitives, and light/dark themes',
  category: 'web',
  version: '1.0.0',
  variables: [
    {
      name: 'description',
      description: 'Project description',
      type: 'string',
      default: 'A thoughtfully designed React application',
    },
  ],
  directories: ['src', 'src/components', 'src/components/ui', 'src/styles', 'public'],
  files: [
    {
      path: 'package.json',
      content: `{
  "name": "{{projectName}}",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext ts,tsx",
    "test": "vitest"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.0.0",
    "autoprefixer": "^10.4.20",
    "eslint": "^8.0.0",
    "eslint-plugin-react-hooks": "^4.0.0",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "vitest": "^1.0.0"
  }
}`,
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
    {
      path: 'tailwind.config.ts',
      content: `import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        ink: 'rgb(var(--color-ink) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        line: 'rgb(var(--color-line) / <alpha-value>)',
        accent: 'rgb(var(--color-accent) / <alpha-value>)',
        action: 'rgb(var(--color-action) / <alpha-value>)',
        'action-contrast': 'rgb(var(--color-action-contrast) / <alpha-value>)',
        highlight: 'rgb(var(--color-highlight) / <alpha-value>)',
      },
      fontFamily: {
        display: 'var(--font-display)',
        body: 'var(--font-body)',
      },
      fontSize: {
        display: ['var(--text-display)', { lineHeight: 'var(--leading-display)', letterSpacing: '-0.045em' }],
        title: ['var(--text-title)', { lineHeight: 'var(--leading-title)', letterSpacing: '-0.035em' }],
        heading: ['var(--text-heading)', { lineHeight: 'var(--leading-heading)' }],
        body: ['var(--text-body)', { lineHeight: 'var(--leading-body)' }],
        small: ['var(--text-small)', { lineHeight: 'var(--leading-small)' }],
      },
      spacing: {
        section: 'var(--space-section)',
        gutter: 'var(--space-gutter)',
        cluster: 'var(--space-cluster)',
        panel: 'var(--space-panel)',
      },
      borderRadius: {
        control: 'var(--radius-control)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        panel: 'var(--shadow-panel)',
      },
    },
  },
  plugins: [],
} satisfies Config;
`,
    },
    {
      path: 'postcss.config.cjs',
      content: `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,
    },
    {
      path: 'tsconfig.json',
      content: `{
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
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src", "tailwind.config.ts"],
  "references": [{ "path": "./tsconfig.node.json" }]
}`,
    },
    {
      path: 'tsconfig.node.json',
      content: `{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}`,
    },
    {
      path: 'index.html',
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="{{description}}" />
    <meta name="theme-color" content="#f6f4ee" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%230d4e3b'/%3E%3Cpath d='M18 45 30 18h5l12 27h-7l-2-6H26l-2 6Zm11-12h7l-3.5-9Z' fill='white'/%3E%3C/svg%3E" />
    <title>{{projectName}}</title>
    <script>
      try {
        const savedTheme = localStorage.getItem('app-theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.classList.toggle('dark', savedTheme === 'dark' || (!savedTheme && prefersDark));
      } catch (_) {
        // Storage can be unavailable in privacy modes; the light theme remains usable.
      }
    </script>
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
      content: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,
    },
    {
      path: 'src/styles/tokens.css',
      content: `/*
 * Single source of truth for the visual system.
 * Tailwind maps these semantic tokens in tailwind.config.ts; components never
 * carry raw colour, type-scale, or layout values.
 */
:root {
  color-scheme: light;

  --color-canvas: 246 244 238;
  --color-surface: 255 253 247;
  --color-ink: 28 39 35;
  --color-muted: 78 96 88;
  --color-line: 184 197 190;
  --color-accent: 13 92 67;
  --color-action: 13 78 59;
  --color-action-contrast: 255 255 255;
  --color-highlight: 207 91 42;

  --font-display: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif;
  --font-body: "Avenir Next", Avenir, "Segoe UI", Helvetica, Arial, sans-serif;
  --text-display: clamp(3.4rem, 8.5vw, 7.6rem);
  --text-title: clamp(2.3rem, 5vw, 4.8rem);
  --text-heading: clamp(1.35rem, 2vw, 1.7rem);
  --text-body: 1rem;
  --text-small: 0.8125rem;
  --leading-display: 0.9;
  --leading-title: 0.98;
  --leading-heading: 1.2;
  --leading-body: 1.7;
  --leading-small: 1.5;

  --space-section: clamp(5rem, 10vw, 9rem);
  --space-gutter: clamp(1.25rem, 5vw, 5rem);
  --space-cluster: clamp(1.25rem, 3vw, 2.25rem);
  --space-panel: clamp(1.5rem, 3vw, 2.75rem);

  --radius-control: 0.35rem;
  --radius-pill: 999px;
  --shadow-panel: 0 22px 60px rgb(28 39 35 / 0.12);
}

.dark {
  color-scheme: dark;

  --color-canvas: 14 23 20;
  --color-surface: 23 35 31;
  --color-ink: 241 239 230;
  --color-muted: 166 185 175;
  --color-line: 61 81 73;
  --color-accent: 135 232 190;
  --color-action: 92 208 160;
  --color-action-contrast: 14 23 20;
  --color-highlight: 244 151 96;
  --shadow-panel: 0 24px 70px rgb(0 0 0 / 0.34);
}
`,
    },
    {
      path: 'src/index.css',
      content: `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  * {
    @apply border-line;
  }

  html {
    @apply scroll-smooth bg-canvas;
  }

  body {
    @apply m-0 min-w-[320px] bg-canvas font-body text-body text-ink antialiased;
  }

  button,
  a {
    @apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 focus-visible:ring-offset-canvas;
  }

  ::selection {
    @apply bg-highlight/25 text-ink;
  }
}
`,
    },
    {
      path: 'src/components/ui/Button.tsx',
      content: `import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'quiet';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
}

const base =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-5 py-2.5 text-sm font-semibold tracking-[0.01em] transition duration-200 disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-action text-action-contrast shadow-sm hover:-translate-y-0.5 hover:bg-accent',
  secondary: 'border border-line bg-surface text-ink hover:border-action hover:text-accent',
  quiet: 'px-2 text-accent hover:text-highlight',
};

export function Button({ children, className = '', variant = 'primary', type = 'button', ...props }: ButtonProps) {
  return (
    <button className={[base, variants[variant], className].filter(Boolean).join(' ')} type={type} {...props}>
      {children}
    </button>
  );
}
`,
    },
    {
      path: 'src/components/ui/Card.tsx',
      content: `import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <article
      className={['border border-line bg-surface p-panel transition duration-200 hover:-translate-y-1 hover:shadow-panel', className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </article>
  );
}
`,
    },
    {
      path: 'src/components/ui/Badge.tsx',
      content: `import type { HTMLAttributes, ReactNode } from 'react';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function Badge({ children, className = '', ...props }: BadgeProps) {
  return (
    <span
      className={['inline-flex items-center rounded-pill border border-line bg-surface px-3 py-1 text-small font-semibold uppercase tracking-[0.14em] text-muted', className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {children}
    </span>
  );
}
`,
    },
    {
      path: 'src/components/ThemeToggle.tsx',
      content: `import { useEffect, useState } from 'react';
import { Button } from './ui/Button';

function ThemeIcon({ dark }: { dark: boolean }) {
  return dark ? (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path d="M20.2 15.2A8.2 8.2 0 0 1 8.8 3.8a8.3 8.3 0 1 0 11.4 11.4Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('app-theme', dark ? 'dark' : 'light');
    } catch (_) {
      // The theme still works for this session when storage is unavailable.
    }
  }, [dark]);

  return (
    <Button variant="secondary" className="px-3" onClick={() => setDark((current) => !current)} aria-label={dark ? 'Use light theme' : 'Use dark theme'}>
      <ThemeIcon dark={dark} />
      <span className="hidden sm:inline">{dark ? 'Light' : 'Dark'}</span>
    </Button>
  );
}
`,
    },
    {
      path: 'src/App.tsx',
      content: `import { ThemeToggle } from './components/ThemeToggle';
import { Badge } from './components/ui/Badge';
import { Button } from './components/ui/Button';
import { Card } from './components/ui/Card';

const principles = [
  {
    index: '01',
    title: 'A system, not a mood board',
    copy: 'Semantic tokens keep colour, type, and spacing decisions consistent across every screen.',
  },
  {
    index: '02',
    title: 'Components with restraint',
    copy: 'A compact primitive set gives the interface rhythm without making every surface look identical.',
  },
  {
    index: '03',
    title: 'Contrast in every theme',
    copy: 'Light and dark palettes are designed together, with legible states for actions and supporting text.',
  },
];

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
      <path d="M4 10h11M11 6l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function App() {
  const scrollToSystem = () => document.getElementById('system')?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="min-h-screen overflow-hidden bg-canvas text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-gutter py-5">
          <a href="#top" className="flex items-center gap-3 font-semibold tracking-tight" aria-label="{{projectName}} home">
            <span className="grid h-9 w-9 place-items-center bg-action font-display text-xl text-action-contrast">A</span>
            <span>{{projectName}}</span>
          </a>
          <div className="flex items-center gap-3">
            <a href="#system" className="hidden text-sm font-semibold text-muted transition hover:text-ink sm:block">System</a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main id="top">
        <section className="mx-auto grid max-w-[1440px] gap-12 px-gutter py-section lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
          <div>
            <Badge>App Studio starter</Badge>
            <h1 className="mt-7 max-w-5xl font-display text-display">
              Build with a clear <span className="text-accent">point of view.</span>
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-8 text-muted sm:text-xl">
              {{description}}. Start from a durable visual system, then make the product unmistakably your own.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button onClick={scrollToSystem}>Explore the system <ArrowIcon /></Button>
              <Button variant="secondary" onClick={() => document.getElementById('principles')?.scrollIntoView({ behavior: 'smooth' })}>
                See principles
              </Button>
            </div>
          </div>

          <aside className="border-l-4 border-highlight bg-surface p-panel shadow-panel" aria-label="Starter overview">
            <p className="text-small font-semibold uppercase tracking-[0.16em] text-muted">Release brief</p>
            <p className="mt-4 font-display text-title">Ready before the first prompt.</p>
            <dl className="mt-8 grid grid-cols-2 gap-px border border-line bg-line">
              <div className="bg-surface p-5">
                <dt className="text-small uppercase tracking-[0.12em] text-muted">Themes</dt>
                <dd className="mt-2 font-display text-3xl">02</dd>
              </div>
              <div className="bg-surface p-5">
                <dt className="text-small uppercase tracking-[0.12em] text-muted">Primitives</dt>
                <dd className="mt-2 font-display text-3xl">04</dd>
              </div>
            </dl>
          </aside>
        </section>

        <section id="system" className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-[1440px] gap-10 px-gutter py-section lg:grid-cols-[0.7fr_1.3fr]">
            <div>
              <p className="text-small font-semibold uppercase tracking-[0.16em] text-highlight">Design foundation</p>
              <h2 className="mt-4 max-w-xl font-display text-title">One source of truth. Two distinct voices.</h2>
            </div>
            <div className="grid content-start gap-8 sm:grid-cols-2">
              <div className="border-t-2 border-accent pt-5">
                <p className="font-display text-heading">Display type</p>
                <p className="mt-3 text-muted">Editorial and expressive, reserved for moments that shape the page hierarchy.</p>
              </div>
              <div className="border-t-2 border-highlight pt-5">
                <p className="font-body text-heading font-semibold">Interface type</p>
                <p className="mt-3 text-muted">Direct and highly legible for navigation, actions, labels, and long-form copy.</p>
              </div>
              <div className="sm:col-span-2">
                <div className="flex h-20 overflow-hidden border border-line" aria-label="Theme colour palette">
                  <span className="flex-1 bg-action" title="Action" />
                  <span className="flex-1 bg-accent" title="Accent" />
                  <span className="flex-1 bg-highlight" title="Highlight" />
                  <span className="flex-1 bg-canvas" title="Canvas" />
                  <span className="flex-1 bg-ink" title="Ink" />
                </div>
                <p className="mt-3 text-small text-muted">Semantic colours adapt together when the theme changes.</p>
              </div>
            </div>
          </div>
        </section>

        <section id="principles" className="mx-auto max-w-[1440px] px-gutter py-section">
          <div className="flex flex-col justify-between gap-5 border-b border-line pb-7 md:flex-row md:items-end">
            <div>
              <p className="text-small font-semibold uppercase tracking-[0.16em] text-highlight">Working principles</p>
              <h2 className="mt-3 font-display text-title">Designed to be changed.</h2>
            </div>
            <p className="max-w-md text-muted">Use the starter as a strong baseline, not as a finished brand. Replace the tokens first; the components follow.</p>
          </div>
          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {principles.map((principle) => (
              <Card key={principle.index}>
                <span className="font-display text-4xl text-accent">{principle.index}</span>
                <h3 className="mt-10 font-display text-heading">{principle.title}</h3>
                <p className="mt-4 text-muted">{principle.copy}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="bg-action text-action-contrast">
          <div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-8 px-gutter py-14 md:flex-row md:items-center">
            <div>
              <p className="text-small font-semibold uppercase tracking-[0.16em] opacity-75">Next move</p>
              <h2 className="mt-2 font-display text-title">Make the system yours.</h2>
            </div>
            <button onClick={scrollToSystem} className="inline-flex min-h-11 items-center justify-center gap-2 self-start border border-current px-5 py-2.5 text-sm font-semibold transition hover:bg-action-contrast hover:text-action md:self-auto">
              Review the foundation <ArrowIcon />
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-3 px-gutter py-7 text-small text-muted sm:flex-row">
          <span>{{projectName}}</span>
          <span>React · Tailwind · semantic tokens</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
`,
    },
    {
      path: '.gitignore',
      content: `node_modules/
dist/
.env
.env.local
*.log
.DS_Store
`,
    },
    {
      path: 'README.md',
      content: `# {{projectName}}

{{description}}

## Start

Run npm install, then npm run dev.

Use npm run build for a production build.

## Design system

- Edit colours, the two font roles, type scale, and spacing in src/styles/tokens.css.
- Tailwind exposes those semantic tokens through tailwind.config.ts.
- Reusable primitives live in src/components/ui/.
- ThemeToggle persists light/dark preference locally; both palettes work without a network connection.
`,
    },
  ],
  postGenerate: [
    {
      name: 'Install dependencies',
      command: 'npm',
      args: ['install'],
    },
    {
      name: 'Initialize git',
      command: 'git',
      args: ['init'],
    },
  ],
});

// Express API Template
TEMPLATES.set('express-api', {
  name: 'express-api',
  description: 'Express.js REST API with TypeScript',
  category: 'api',
  version: '1.0.0',
  variables: [
    {
      name: 'description',
      description: 'Project description',
      type: 'string',
      default: 'A REST API',
    },
    {
      name: 'port',
      description: 'Server port',
      type: 'string',
      default: '3000',
    },
    {
      name: 'database',
      description: 'Database type',
      type: 'choice',
      choices: ['none', 'postgresql', 'mongodb', 'sqlite'],
      default: 'none',
    },
  ],
  directories: ['src', 'src/routes', 'src/middleware', 'src/controllers', 'src/types'],
  files: [
    {
      path: 'package.json',
      content: `{
  "name": "{{projectName}}",
  "version": "0.1.0",
  "description": "{{description}}",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "jest",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "express": "^4.18.0",
    "cors": "^2.8.0",
    "helmet": "^7.0.0",
    "dotenv": "^16.0.0",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/cors": "^2.8.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "tsx": "^4.0.0",
    "jest": "^29.0.0",
    "@types/jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "supertest": "^6.0.0",
    "@types/supertest": "^2.0.0"
  }
}`,
    },
    {
      path: 'tsconfig.json',
      content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}`,
    },
    {
      path: 'src/index.ts',
      content: `import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { healthRouter } from './routes/health.js';
import { errorHandler } from './middleware/error-handler.js';

config();

const app = express();
const PORT = process.env.PORT || {{port}};

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Routes
app.use('/health', healthRouter);

// Error handler
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});

export default app;
`,
    },
    {
      path: 'src/routes/health.ts',
      content: `import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});
`,
    },
    {
      path: 'src/middleware/error-handler.ts',
      content: `import { Request, Response, NextFunction } from 'express';

interface ApiError extends Error {
  statusCode?: number;
}

export function errorHandler(
  err: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: {
      message,
      statusCode,
    },
  });
}
`,
    },
    {
      path: '.env.example',
      content: `PORT={{port}}
NODE_ENV=development
`,
    },
    {
      path: '.gitignore',
      content: `node_modules/
dist/
.env
*.log
.DS_Store
`,
    },
  ],
  postGenerate: [
    {
      name: 'Install dependencies',
      command: 'npm',
      args: ['install'],
    },
    {
      name: 'Copy env file',
      command: 'cp',
      args: ['.env.example', '.env'],
    },
    {
      name: 'Initialize git',
      command: 'git',
      args: ['init'],
    },
  ],
});

// ============================================================================
// Template Engine
// ============================================================================

export class TemplateEngine extends EventEmitter {
  private templates: Map<string, ProjectTemplate> = new Map(TEMPLATES);
  private customTemplatesDir?: string;

  constructor(customTemplatesDir?: string) {
    super();
    this.customTemplatesDir = customTemplatesDir;
  }

  /**
   * Get available templates
   */
  getTemplates(): ProjectTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * Get template by name
   */
  getTemplate(name: string): ProjectTemplate | undefined {
    return this.templates.get(name);
  }

  /**
   * Register custom template
   */
  registerTemplate(template: ProjectTemplate): void {
    this.templates.set(template.name, template);
  }

  /**
   * Load custom templates from directory
   */
  async loadCustomTemplates(): Promise<void> {
    if (!this.customTemplatesDir || !existsSync(this.customTemplatesDir)) {
      return;
    }

    const entries = await fs.readdir(this.customTemplatesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const templatePath = path.join(this.customTemplatesDir, entry.name, 'template.json');
      if (existsSync(templatePath)) {
        try {
          const content = await fs.readFile(templatePath, 'utf-8');
          const template = JSON.parse(content) as ProjectTemplate;
          this.templates.set(template.name, template);
        } catch (error) {
          this.emit('error', { template: entry.name, error });
        }
      }
    }
  }

  /**
   * Generate project from template
   */
  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startTime = performance.now();
    const warnings: string[] = [];
    const filesCreated: string[] = [];

    // Get template
    const template = this.templates.get(options.template);
    if (!template) {
      throw new Error(`Template not found: ${options.template}`);
    }

    // Prepare variables
    const variables: Record<string, string | boolean> = {
      projectName: options.projectName,
      ...options.variables,
    };

    // Apply defaults
    for (const v of template.variables) {
      if (variables[v.name] === undefined && v.default !== undefined) {
        variables[v.name] = v.default;
      }
    }

    // Validate required variables
    for (const v of template.variables) {
      if (v.required && variables[v.name] === undefined) {
        throw new Error(`Missing required variable: ${v.name}`);
      }
      if (v.validate && typeof variables[v.name] === 'string') {
        const regex = new RegExp(v.validate);
        if (!regex.test(variables[v.name] as string)) {
          throw new Error(`Variable ${v.name} does not match pattern: ${v.validate}`);
        }
      }
    }

    // Create project directory
    const projectPath = path.join(options.outputDir, options.projectName);

    if (existsSync(projectPath)) {
      throw new Error(`Directory already exists: ${projectPath}`);
    }

    await fs.mkdir(projectPath, { recursive: true });

    this.emit('progress', { phase: 'creating', projectPath });

    // Create directories
    for (const dir of template.directories) {
      const dirPath = path.join(projectPath, dir);
      await fs.mkdir(dirPath, { recursive: true });
    }

    // Create files
    for (const file of template.files) {
      // Check condition
      if (file.condition && !this.evaluateCondition(file.condition, variables)) {
        continue;
      }

      const filePath = path.join(projectPath, this.interpolate(file.path, variables));
      const content = this.interpolate(file.content, variables);

      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      await fs.writeFile(filePath, content);

      if (file.executable) {
        await fs.chmod(filePath, 0o755);
      }

      // Template file keys are POSIX-style; report created files the same way
      // on every platform so callers/tests can match them verbatim.
      filesCreated.push(path.relative(projectPath, filePath).split(path.sep).join('/'));
    }

    this.emit('progress', { phase: 'files-created', count: filesCreated.length });

    // Apply the chosen brand design system (tokens.css + DESIGN.md) if requested.
    if (options.designSystem) {
      const branding = applyDesignSystem(projectPath, options.designSystem);
      if (branding.applied) {
        filesCreated.push(...branding.files);
        this.emit('progress', { phase: 'design-system', id: options.designSystem, files: branding.files.length });
      } else if (branding.warning) {
        warnings.push(`Design system not applied: ${branding.warning}`);
      }
    }

    // Run post-generate hooks
    if (!options.skipInstall) {
      for (const hook of template.postGenerate || []) {
        if (hook.condition && !this.evaluateCondition(hook.condition, variables)) {
          continue;
        }

        // Skip git init if requested
        if (options.skipGit && hook.command === 'git') {
          continue;
        }

        this.emit('progress', { phase: 'hook', name: hook.name });

        try {
          await this.runCommand(hook.command, hook.args, projectPath);
        } catch (error) {
          if (hook.optional) {
            warnings.push(`Optional hook failed: ${hook.name}`);
          } else {
            throw error;
          }
        }
      }
    }

    // Generate next steps
    const nextSteps = [
      `cd ${options.projectName}`,
    ];

    if (options.skipInstall) {
      nextSteps.push('npm install');
    }

    nextSteps.push('npm run dev');

    return {
      success: true,
      projectPath,
      filesCreated,
      duration: Math.max(1, Math.ceil(performance.now() - startTime)),
      warnings,
      nextSteps,
    };
  }

  /**
   * Interpolate variables in string
   */
  private interpolate(text: string, variables: Record<string, string | boolean>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, name) => {
      const value = variables[name];
      return value !== undefined ? String(value) : `{{${name}}}`;
    });
  }

  /**
   * Evaluate condition
   */
  private evaluateCondition(condition: string, variables: Record<string, string | boolean>): boolean {
    // Simple condition evaluation: "variable == value" or "variable != value"
    const match = condition.match(/^(\w+)\s*(==|!=)\s*(.+)$/);
    if (!match) return true;

    const [, name, operator, expected] = match;
    if (name === undefined || operator === undefined || expected === undefined) return true;
    const actual = String(variables[name] || '');
    const expectedValue = expected.replace(/^["']|["']$/g, '');

    if (operator === '==') {
      return actual === expectedValue;
    } else {
      return actual !== expectedValue;
    }
  }

  /**
   * Run command
   */
  private runCommand(command: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { cwd, stdio: 'pipe' });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed: ${command} ${args.join(' ')}`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.removeAllListeners();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let templateEngineInstance: TemplateEngine | null = null;

export function getTemplateEngine(customTemplatesDir?: string): TemplateEngine {
  if (!templateEngineInstance) {
    templateEngineInstance = new TemplateEngine(customTemplatesDir);
  }
  return templateEngineInstance;
}

export function resetTemplateEngine(): void {
  if (templateEngineInstance) {
    templateEngineInstance.dispose();
  }
  templateEngineInstance = null;
}

/**
 * Quick generate project
 */
export async function generateProject(options: GenerateOptions): Promise<GenerateResult> {
  const engine = getTemplateEngine();
  return engine.generate(options);
}
