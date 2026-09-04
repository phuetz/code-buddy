/**
 * extension_forge - one safe conversational entry point for authoring runtime
 * widgets, executable tools, and reusable skills.
 *
 * The calling model writes the artifact source in the tool arguments. This
 * tool validates and installs it through the same gates used by the dedicated
 * self-improvement engines; it never edits Code Buddy's own `src/` tree.
 */

import * as path from 'path';
import type {
  ITool,
  IToolExecutionContext,
  IToolMetadata,
  IValidationResult,
  ToolSchema,
} from './registry/types.js';
import type { ToolResult } from '../types/index.js';
import { stableStringify } from '../utils/stable-json.js';
import {
  AUTHORED_LANGUAGES,
  toAuthoredName,
  type AuthoredToolSpec,
} from '../agent/self-improvement/authored-tool-runtime.js';
import { AuthoredToolStore } from '../agent/self-improvement/authored-tool-store.js';
import { LiveToolMutator } from '../agent/self-improvement/tool-skill-mutator.js';
import { validateToolProposal } from '../agent/self-improvement/tool-gate.js';
import type { ToolBenchmarkScenario, ToolCase } from '../agent/self-improvement/tool-types.js';
import {
  LiveSkillMutator,
  toAuthoredSkillName,
} from '../agent/self-improvement/skill-mutator.js';
import type { SkillSpec } from '../agent/self-improvement/skill-types.js';
import { getSkillRegistry } from '../skills/registry.js';
import { gateWidget } from '../widgets/widget-gate.js';
import { keepAuthoredWidget } from '../widgets/widget-engine.js';
import type { WidgetProposal } from '../widgets/widget-types.js';

export type ExtensionKind = 'widget' | 'tool' | 'skill';

export interface ExtensionForgeDeps {
  env?: NodeJS.ProcessEnv;
}

const MAX_CASES_PER_GROUP = 8;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_ARTIFACT_SOURCE_LENGTH = 64 * 1024;

function slug(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
}

function parseCases(value: unknown): ToolCase[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CASES_PER_GROUP) return null;
  const cases: ToolCase[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;
    if (!item.input || typeof item.input !== 'object' || Array.isArray(item.input)) return null;
    if (typeof item.expect_output !== 'string' || item.expect_output.trim().length === 0) return null;
    cases.push({ input: item.input as Record<string, unknown>, expectedOutput: item.expect_output });
  }
  return cases;
}

function failure(error: string, data?: Record<string, unknown>): ToolResult {
  return { success: false, error, ...(data ? { data } : {}) };
}

export class ExtensionForgeTool implements ITool {
  readonly name = 'extension_forge';
  readonly description =
    'Write and install a new runtime widget, sandboxed tool, or SKILL.md for Code Buddy. ' +
    'You must author the source yourself. Every artifact is safety-gated; tools must also ' +
    'pass functional and robustness cases before they become immediately callable.';

  constructor(private readonly deps: ExtensionForgeDeps = {}) {}

  async execute(
    input: Record<string, unknown>,
    context?: IToolExecutionContext,
  ): Promise<ToolResult> {
    const kind = String(input.kind ?? '').toLowerCase() as ExtensionKind;
    if (!['widget', 'tool', 'skill'].includes(kind)) {
      return failure('extension_forge: kind must be widget, tool, or skill.');
    }
    const name = slug(input.name);
    if (!name) return failure('extension_forge: name is required and must contain letters or digits.');
    if (name.length > MAX_NAME_LENGTH) {
      return failure(`extension_forge: name must be at most ${MAX_NAME_LENGTH} characters.`);
    }
    if (typeof input.description === 'string' && input.description.length > MAX_DESCRIPTION_LENGTH) {
      return failure(
        `extension_forge: description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
      );
    }

    switch (kind) {
      case 'widget':
        return this.createWidget(name, input);
      case 'tool':
        return await this.createTool(name, input, context);
      case 'skill':
        return await this.createSkill(name, input, context);
    }
  }

  private createWidget(name: string, input: Record<string, unknown>): ToolResult {
    const template = typeof input.template === 'string' ? input.template.trim() : '';
    if (!template) return failure('extension_forge(widget): template is required.');
    if (template.length > MAX_ARTIFACT_SOURCE_LENGTH) {
      return failure('extension_forge(widget): template is too large.');
    }
    if (!input.sample || typeof input.sample !== 'object' || Array.isArray(input.sample)) {
      return failure('extension_forge(widget): sample must be a JSON object.');
    }

    const sample = { ...(input.sample as Record<string, unknown>), type: name };
    const proposal: WidgetProposal = {
      kind: name,
      template,
      sample,
      ...(typeof input.description === 'string' && input.description.trim()
        ? { brief: input.description.trim() }
        : {}),
    };
    const verdict = gateWidget(proposal);
    if (!verdict.accepted) {
      return failure(
        `extension_forge(widget): rejected by ${verdict.reason ?? 'gate'}: ${(verdict.reasons ?? []).join('; ')}`,
        { artifactKind: 'widget', name, gate: verdict.reason ?? 'unknown' },
      );
    }
    if (!keepAuthoredWidget(proposal, this.deps.env ?? process.env)) {
      return failure('extension_forge(widget): validated template could not be persisted.');
    }
    return {
      success: true,
      output: `Created authored widget \`${name}\`; it now renders payloads with \`type: "${name}"\`.`,
      data: { artifactKind: 'widget', name, createdWidgets: [name] },
    };
  }

  private async createTool(
    name: string,
    input: Record<string, unknown>,
    context?: IToolExecutionContext,
  ): Promise<ToolResult> {
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    const code = typeof input.code === 'string' ? input.code.trim() : '';
    const language = String(input.language ?? 'javascript').toLowerCase() as AuthoredToolSpec['language'];
    const validationCases = parseCases(input.validation_cases);
    const robustnessCases = parseCases(input.robustness_cases);

    if (!description) return failure('extension_forge(tool): description is required.');
    if (!code) return failure('extension_forge(tool): code is required.');
    if (code.length > MAX_ARTIFACT_SOURCE_LENGTH) {
      return failure('extension_forge(tool): code is too large.');
    }
    if (!AUTHORED_LANGUAGES.includes(language)) {
      return failure(`extension_forge(tool): language must be one of ${AUTHORED_LANGUAGES.join(', ')}.`);
    }
    if (!validationCases || !robustnessCases) {
      return failure(
        `extension_forge(tool): provide 1-${MAX_CASES_PER_GROUP} validation_cases and ` +
        `1-${MAX_CASES_PER_GROUP} robustness_cases with input + expect_output.`,
      );
    }
    const validationInputs = new Set(validationCases.map((testCase) => stableStringify(testCase.input)));
    if (robustnessCases.some((testCase) => validationInputs.has(stableStringify(testCase.input)))) {
      return failure(
        'extension_forge(tool): robustness_cases must use inputs distinct from validation_cases.',
      );
    }

    const parameters = input.parameters && typeof input.parameters === 'object' && !Array.isArray(input.parameters)
      ? input.parameters as Record<string, unknown>
      : { type: 'object', properties: {} };
    const authoredName = toAuthoredName(name);
    const spec: AuthoredToolSpec = { name: authoredName, description, parameters, language, code };
    const scenario: ToolBenchmarkScenario = {
      id: `extension-forge:${authoredName}`,
      capability: description,
      description: `User-requested runtime tool ${authoredName}`,
      visibleCases: validationCases,
      heldOutCases: robustnessCases,
    };
    const proposal = {
      id: `extension-forge:${authoredName}:${Date.now()}`,
      targetScenarioId: scenario.id,
      spec,
    };
    const cwd = context?.cwd ?? process.cwd();
    const mutator = new LiveToolMutator({ store: new AuthoredToolStore({ workDir: cwd }) });
    const verdict = await validateToolProposal(proposal, scenario, mutator, { keepOnAccept: true });
    if (!verdict.accepted) {
      return failure(
        `extension_forge(tool): rejected by ${verdict.rejectionReason ?? 'gate'}: ${verdict.reasons.join('; ')}`,
        {
          artifactKind: 'tool',
          name: authoredName,
          gate: verdict.rejectionReason ?? 'unknown',
          visiblePassed: verdict.visiblePassed,
          visibleTotal: verdict.visibleTotal,
          robustnessPassed: verdict.heldOutPassed,
          robustnessTotal: verdict.heldOutTotal,
        },
      );
    }
    return {
      success: true,
      output:
        `Created tool \`${authoredName}\`; passed ${verdict.visiblePassed}/${verdict.visibleTotal} ` +
        `functional and ${verdict.heldOutPassed}/${verdict.heldOutTotal} robustness cases. ` +
        'It is callable immediately.',
      data: {
        artifactKind: 'tool',
        name: authoredName,
        createdTools: [authoredName],
        visiblePassed: verdict.visiblePassed,
        robustnessPassed: verdict.heldOutPassed,
      },
    };
  }

  private async createSkill(
    name: string,
    input: Record<string, unknown>,
    context?: IToolExecutionContext,
  ): Promise<ToolResult> {
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    const content = typeof input.body === 'string' ? input.body.trim() : '';
    if (!description) return failure('extension_forge(skill): description is required.');
    if (!content) return failure('extension_forge(skill): body is required.');
    if (content.length > MAX_ARTIFACT_SOURCE_LENGTH) {
      return failure('extension_forge(skill): body is too large.');
    }

    const authoredName = toAuthoredSkillName(name);
    const cwd = context?.cwd ?? process.cwd();
    const skillsRoot = path.join(cwd, '.codebuddy', 'skills');
    const mutator = new LiveSkillMutator(skillsRoot);
    const spec: SkillSpec = { name: authoredName, description, content };
    try {
      mutator.create(spec);
      const skillPath = path.join(skillsRoot, authoredName, 'SKILL.md');
      await getSkillRegistry().registerSkillFile(skillPath, 'workspace');
      if (!getSkillRegistry().get(authoredName)) {
        throw new Error('skill registry refused the authored skill');
      }
      return {
        success: true,
        output: `Created skill \`${authoredName}\`; it is loaded and available for matching immediately.`,
        data: { artifactKind: 'skill', name: authoredName, createdSkills: [authoredName], path: skillPath },
      };
    } catch (error) {
      return failure(
        `extension_forge(skill): rejected: ${error instanceof Error ? error.message : String(error)}`,
        { artifactKind: 'skill', name: authoredName },
      );
    }
  }

  getSchema(): ToolSchema {
    const caseSchema = {
      type: 'object' as const,
      properties: {
        input: { type: 'object' as const, description: 'Arguments passed to the generated tool' },
        expect_output: {
          type: 'string' as const,
          description: 'Exact stdout the tool must print for this input (compared after trimming and collapsing whitespace)',
        },
      },
      required: ['input', 'expect_output'],
    };
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['widget', 'tool', 'skill'], description: 'Extension type' },
          name: { type: 'string', description: 'Short extension name; a safe namespace is added automatically' },
          description: { type: 'string', description: 'Purpose and when the extension should be used' },
          template: { type: 'string', description: 'Widget only: inert Mustache HTML+CSS authored by you' },
          sample: { type: 'object', description: 'Widget only: representative JSON payload' },
          code: { type: 'string', description: 'Tool only: complete source authored by you; read CODEBUDDY_TOOL_INPUT and print stdout' },
          language: { type: 'string', enum: ['javascript', 'typescript', 'python'], description: 'Tool only' },
          parameters: { type: 'object', description: 'Tool only: JSON Schema for arguments' },
          validation_cases: {
            type: 'array',
            items: caseSchema,
            description: 'Tool only: functional examples the implementation must pass',
          },
          robustness_cases: {
            type: 'array',
            items: caseSchema,
            description: 'Tool only: different inputs that catch hardcoding and edge-case failures',
          },
          body: { type: 'string', description: 'Skill only: complete reusable SKILL.md guidance authored by you' },
        },
        required: ['kind', 'name', 'description'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (!input || typeof input !== 'object') return { valid: false, errors: ['input must be an object'] };
    const data = input as Record<string, unknown>;
    const errors: string[] = [];
    if (!['widget', 'tool', 'skill'].includes(String(data.kind ?? ''))) errors.push('kind must be widget, tool, or skill');
    if (!slug(data.name)) errors.push('name is required');
    if (typeof data.description !== 'string' || !data.description.trim()) errors.push('description is required');
    return { valid: errors.length === 0, errors };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'system',
      keywords: ['extension', 'forge', 'create', 'widget', 'tool', 'skill', 'self-extension', 'code'],
      priority: 9,
      requiresConfirmation: true,
      modifiesFiles: true,
      makesNetworkRequests: false,
    };
  }
}

export function createExtensionForgeTool(deps: ExtensionForgeDeps = {}): ExtensionForgeTool {
  return new ExtensionForgeTool(deps);
}

export function createExtensionForgeTools(deps: ExtensionForgeDeps = {}): ITool[] {
  return [createExtensionForgeTool(deps)];
}
