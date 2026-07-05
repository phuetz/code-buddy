/**
 * App Studio scaffolding service.
 *
 * This exposes the core TemplateEngine without reimplementing project
 * generation. `targetDir` is the final project directory; the core API receives
 * its parent as `outputDir` plus the basename as `projectName`.
 *
 * @module main/studio/scaffold-service
 */

import { basename, dirname } from 'path';
import { loadCoreModule } from '../utils/core-loader.js';

export type StudioTemplateId = 'react-ts' | 'express-api' | 'node-cli';
export type StudioTemplateVars = Record<string, string | boolean>;

export interface TemplateCard {
  id: StudioTemplateId;
  label: string;
  description: string;
  category: 'web' | 'api' | 'cli';
}

export interface ScaffoldProjectInput {
  template: StudioTemplateId;
  targetDir: string;
  vars?: StudioTemplateVars;
}

export interface ScaffoldProjectResult {
  projectDir: string;
  files: string[];
}

export type ScaffoldResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type CoreGenerateOptions = {
  template: string;
  projectName: string;
  outputDir: string;
  variables: StudioTemplateVars;
};

type CoreGenerateResult = {
  success: boolean;
  projectPath: string;
  filesCreated: string[];
  warnings?: string[];
};

interface CoreTemplateEngine {
  generate(options: CoreGenerateOptions): Promise<CoreGenerateResult>;
}

interface CoreTemplateModule {
  getTemplateEngine(): CoreTemplateEngine;
}

export const STUDIO_TEMPLATES: TemplateCard[] = [
  {
    id: 'react-ts',
    label: 'React + TypeScript',
    description: 'Application web Vite avec React et TypeScript.',
    category: 'web',
  },
  {
    id: 'express-api',
    label: 'Express API',
    description: 'API Node/Express avec structure TypeScript.',
    category: 'api',
  },
  {
    id: 'node-cli',
    label: 'Node CLI',
    description: 'CLI Node.js TypeScript prête à compiler.',
    category: 'cli',
  },
];

const SUPPORTED_TEMPLATE_IDS = new Set<StudioTemplateId>(STUDIO_TEMPLATES.map((template) => template.id));

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function projectNameFrom(targetDir: string, vars: StudioTemplateVars): string {
  const explicit = vars.projectName;
  return typeof explicit === 'string' && explicit.trim() ? explicit.trim() : basename(targetDir);
}

export class ScaffoldService {
  private enginePromise: Promise<CoreTemplateEngine | null> | null = null;

  listTemplates(): TemplateCard[] {
    return STUDIO_TEMPLATES;
  }

  async scaffoldProject(input: ScaffoldProjectInput): Promise<ScaffoldResult<ScaffoldProjectResult>> {
    try {
      const targetDir = input.targetDir.trim();
      if (!targetDir) return { ok: false, error: 'targetDir is required' };
      if (!SUPPORTED_TEMPLATE_IDS.has(input.template)) {
        return { ok: false, error: `Unsupported template: ${input.template}` };
      }

      const engine = await this.getEngine();
      if (!engine) return { ok: false, error: 'Core TemplateEngine is unavailable' };

      const vars = input.vars ?? {};
      const projectName = projectNameFrom(targetDir, vars);
      const result = await engine.generate({
        template: input.template,
        projectName,
        outputDir: dirname(targetDir),
        variables: { ...vars, projectName },
      });
      if (!result.success) {
        return { ok: false, error: result.warnings?.join('\n') || 'Template generation failed' };
      }
      return {
        ok: true,
        data: {
          projectDir: result.projectPath,
          files: result.filesCreated,
        },
      };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private async getEngine(): Promise<CoreTemplateEngine | null> {
    this.enginePromise ??= loadCoreModule<CoreTemplateModule>('templates/project-scaffolding.js')
      .then((mod) => mod?.getTemplateEngine() ?? null)
      .catch(() => null);
    return this.enginePromise;
  }
}

export function listScaffoldTemplates(): TemplateCard[] {
  return STUDIO_TEMPLATES;
}

export function scaffoldProject(input: ScaffoldProjectInput): Promise<ScaffoldResult<ScaffoldProjectResult>> {
  return new ScaffoldService().scaffoldProject(input);
}
