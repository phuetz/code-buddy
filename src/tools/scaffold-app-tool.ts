import { constants as fsConstants } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ToolResult } from '../types/index.js';
import { getTemplateEngine } from '../templates/project-scaffolding.js';

const ALLOWED_TEMPLATES = ['react-tailwind', 'react-ts', 'express-api', 'node-cli'] as const;
type ScaffoldTemplate = (typeof ALLOWED_TEMPLATES)[number];

export interface ScaffoldAppInput {
  template: ScaffoldTemplate;
  targetDir: string;
  vars?: Record<string, string>;
}

export interface ScaffoldAppData {
  template: ScaffoldTemplate;
  targetDir: string;
  filesCreated: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertSafeTargetDir(targetDir: string): Promise<string> {
  if (!path.isAbsolute(targetDir)) {
    throw new Error('targetDir must be an absolute path');
  }

  const resolved = path.resolve(targetDir);
  const parsed = path.parse(resolved);
  const forbidden = new Set([parsed.root, '/etc', '/bin', '/sbin', '/usr', '/var', '/dev', '/proc', '/sys', '/run', '/boot']);
  if (forbidden.has(resolved)) {
    throw new Error(`Refusing to scaffold into system path: ${resolved}`);
  }

  const home = process.env.HOME ? path.resolve(process.env.HOME) : undefined;
  if (home) {
    const relativeToHome = path.relative(home, resolved);
    if (relativeToHome === '.ssh' || relativeToHome.startsWith(`.ssh${path.sep}`)) {
      throw new Error('Refusing to scaffold inside ~/.ssh');
    }
  }

  const parent = path.dirname(resolved);
  if (!(await pathExists(parent))) {
    throw new Error(`Parent directory does not exist: ${parent}`);
  }

  if (await pathExists(resolved)) {
    const stat = await fs.lstat(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`targetDir exists and is not a directory: ${resolved}`);
    }
    const entries = await fs.readdir(resolved);
    if (entries.length > 0) {
      throw new Error(`targetDir already exists and is not empty: ${resolved}`);
    }
  }

  return resolved;
}

function interpolate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => variables[name] ?? `{{${name}}}`);
}

export class ScaffoldAppTool {
  readonly name = 'scaffold_app';
  readonly description = 'Scaffold a new app from a built-in Code Buddy template into an explicit empty target directory.';

  async execute(input: unknown): Promise<ToolResult> {
    try {
      if (!isRecord(input)) {
        return { success: false, error: 'Input must be an object' };
      }

      const templateInput = input.template;
      const targetDir = input.targetDir;
      const vars = input.vars;

      if (typeof templateInput !== 'string' || !ALLOWED_TEMPLATES.includes(templateInput as ScaffoldTemplate)) {
        return { success: false, error: `template must be one of: ${ALLOWED_TEMPLATES.join(', ')}` };
      }
      const template = templateInput as ScaffoldTemplate;
      if (typeof targetDir !== 'string' || targetDir.trim() === '') {
        return { success: false, error: 'targetDir must be a non-empty absolute path' };
      }
      if (vars !== undefined && (!isRecord(vars) || Object.values(vars).some((value) => typeof value !== 'string'))) {
        return { success: false, error: 'vars must be an object with string values' };
      }

      const resolvedTarget = await assertSafeTargetDir(targetDir);
      const engine = getTemplateEngine();
      const projectTemplate = engine.getTemplate(template);
      if (!projectTemplate) {
        return { success: false, error: `Template not found: ${template}` };
      }

      const variables: Record<string, string> = {
        projectName: path.basename(resolvedTarget),
        ...(vars as Record<string, string> | undefined),
      };

      for (const variable of projectTemplate.variables) {
        if (variables[variable.name] === undefined && variable.default !== undefined) {
          variables[variable.name] = String(variable.default);
        }
        if (variable.required && variables[variable.name] === undefined) {
          return { success: false, error: `Missing required variable: ${variable.name}` };
        }
      }

      await fs.mkdir(resolvedTarget, { recursive: true });
      for (const directory of projectTemplate.directories) {
        await fs.mkdir(path.join(resolvedTarget, interpolate(directory, variables)), { recursive: true });
      }

      const filesCreated: string[] = [];
      for (const file of projectTemplate.files) {
        const relativePath = interpolate(file.path, variables);
        const absolutePath = path.resolve(resolvedTarget, relativePath);
        if (!absolutePath.startsWith(`${resolvedTarget}${path.sep}`)) {
          throw new Error(`Template attempted to write outside targetDir: ${relativePath}`);
        }
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, interpolate(file.content, variables));
        if (file.executable) {
          await fs.chmod(absolutePath, 0o755);
        }
        filesCreated.push(relativePath);
      }

      filesCreated.sort();
      const data: ScaffoldAppData = { template, targetDir: resolvedTarget, filesCreated };
      return {
        success: true,
        output: `Created ${filesCreated.length} files in ${resolvedTarget}`,
        data,
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export const SCAFFOLD_APP_TOOL_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'scaffold_app',
    description: 'Scaffold a new project from a built-in template. Writes only inside the explicit targetDir.',
    parameters: {
      type: 'object',
      properties: {
        template: { type: 'string', enum: ALLOWED_TEMPLATES, description: 'Built-in template to generate' },
        targetDir: { type: 'string', description: 'Absolute empty directory path to create or fill' },
        vars: {
          type: 'object',
          description: 'Template variables such as binName, description, author, port',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['template', 'targetDir'],
    },
  },
};
