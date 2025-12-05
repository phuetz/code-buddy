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
    const startTime = Date.now();
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

      filesCreated.push(path.relative(projectPath, filePath));
    }

    this.emit('progress', { phase: 'files-created', count: filesCreated.length });

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
      duration: Date.now() - startTime,
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
