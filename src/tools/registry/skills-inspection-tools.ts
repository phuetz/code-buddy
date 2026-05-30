import {
  SKILL_MANAGE_TOOL,
  SKILLS_LIST_TOOL,
  SKILL_VIEW_TOOL,
} from '../../codebuddy/tool-definitions/agent-tools.js';
import type { ToolResult } from '../../types/index.js';
import {
  executeSkillsListTool,
  executeSkillViewTool,
} from '../skills-inspection-tool.js';
import { getCreateSkillTool } from '../create-skill-tool.js';
import { SkillDiscoveryTool } from '../skill-discovery-tool.js';
import {
  installResearchScriptSkillCandidate,
  listMaterializedResearchScriptSkillCandidates,
  readMaterializedResearchScriptSkillCandidate,
  type ResearchScriptSkillCandidate,
} from '../../agent/research-script-skill-candidate.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';

class CodeBuddyToolAdapter implements ITool {
  constructor(
    private readonly tool: typeof SKILLS_LIST_TOOL | typeof SKILL_VIEW_TOOL,
    private readonly executor: (input: Record<string, unknown>) => Promise<ToolResult>,
    private readonly keywords: string[],
  ) {}

  get name(): string {
    return this.tool.function.name;
  }

  get description(): string {
    return this.tool.function.description;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await this.executor(input);
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: this.tool.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    if (this.name === 'skill_view') {
      const name = (input as Record<string, unknown>).name;
      if (typeof name !== 'string' || name.trim().length === 0) {
        return { valid: false, errors: ['name is required'] };
      }
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: this.keywords,
      priority: this.name === 'skill_view' ? 6 : 5,
      modifiesFiles: false,
      makesNetworkRequests: false,
      fleetSafe: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

type SkillManageAction =
  | 'list'
  | 'view'
  | 'create'
  | 'discover'
  | 'candidate_list'
  | 'candidate_view'
  | 'candidate_install';

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return strings.length > 0 ? strings : undefined;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function serializePayload(payload: Record<string, unknown>): ToolResult {
  return {
    success: true,
    output: JSON.stringify(payload, null, 2),
    data: payload,
  };
}

function summarizeCandidate(candidate: ResearchScriptSkillCandidate): Record<string, unknown> {
  return {
    eligible: candidate.eligible,
    id: candidate.id,
    kind: candidate.kind,
    reason: candidate.reason,
    skillName: candidate.skillName,
    skillPath: candidate.skillPath,
    sourceJobId: candidate.sourceJobId,
    ...(candidate.sourceRunId ? { sourceRunId: candidate.sourceRunId } : {}),
    successfulRunCount: candidate.successfulRunCount,
    title: candidate.title,
    ...(candidate.toolSequence ? { toolSequence: candidate.toolSequence } : {}),
  };
}

function candidateReviewPath(candidate: ResearchScriptSkillCandidate): string {
  return candidate.skillPath.replace(/\\/g, '/').replace(/\/?SKILL\.md$/i, '/candidate-review.json');
}

export class SkillManageExecuteTool implements ITool {
  readonly name = SKILL_MANAGE_TOOL.function.name;
  readonly description = SKILL_MANAGE_TOOL.function.description;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = readString(input.action) as SkillManageAction | '';

    if (action === 'list') {
      return await executeSkillsListTool(input);
    }

    if (action === 'view') {
      return await executeSkillViewTool(input);
    }

    if (action === 'create') {
      const name = readString(input.name);
      const description = readString(input.description);
      const body = readString(input.body);

      if (!name) {
        return { success: false, error: 'skill_manage create: name is required' };
      }
      if (!description) {
        return { success: false, error: 'skill_manage create: description is required' };
      }
      if (!body) {
        return { success: false, error: 'skill_manage create: body is required' };
      }

      return await getCreateSkillTool().execute({
        name,
        description,
        body,
        tags: readStringArray(input.tags),
        env: readStringRecord(input.env),
        requires: readStringArray(input.requires),
        overwrite: input.overwrite === true,
      });
    }

    if (action === 'discover') {
      const query = readString(input.query);
      if (!query) {
        return { success: false, error: 'skill_manage discover: query is required' };
      }

      return await new SkillDiscoveryTool().execute({
        query,
        tags: readStringArray(input.tags),
        auto_install: input.auto_install === true,
        limit: typeof input.limit === 'number' ? input.limit : undefined,
      });
    }

    if (action === 'candidate_list') {
      const candidates = await listMaterializedResearchScriptSkillCandidates({
        rootDir: process.cwd(),
        skillRoot: readString(input.skill_root) || undefined,
      });
      const shown = input.eligible_only === true
        ? candidates.filter((candidate) => candidate.eligible)
        : candidates;

      return serializePayload({
        action: 'skill_manage_candidate_list',
        count: shown.length,
        total: candidates.length,
        candidates: shown.map(summarizeCandidate),
      });
    }

    if (action === 'candidate_view') {
      const candidatePath = readString(input.candidate_path);
      if (!candidatePath) {
        return { success: false, error: 'skill_manage candidate_view: candidate_path is required' };
      }
      const candidate = await readMaterializedResearchScriptSkillCandidate(candidatePath, {
        rootDir: process.cwd(),
      });

      return serializePayload({
        action: 'skill_manage_candidate_view',
        candidate: summarizeCandidate(candidate),
        reviewManifestPath: candidateReviewPath(candidate),
        ...(input.include_content === false ? {} : { content: candidate.markdown }),
      });
    }

    if (action === 'candidate_install') {
      const candidatePath = readString(input.candidate_path);
      const approvedBy = readString(input.approved_by);
      if (!candidatePath) {
        return { success: false, error: 'skill_manage candidate_install: candidate_path is required' };
      }
      if (!approvedBy) {
        return { success: false, error: 'skill_manage candidate_install: approved_by is required' };
      }

      const candidate = await readMaterializedResearchScriptSkillCandidate(candidatePath, {
        rootDir: process.cwd(),
      });
      const installed = await installResearchScriptSkillCandidate(candidate, {
        approvedAt: readString(input.approved_at) || undefined,
        approvedBy,
        overwrite: input.overwrite === true,
        rootDir: process.cwd(),
        workspaceSkillRoot: readString(input.workspace_skill_root) || undefined,
      });

      return serializePayload({
        action: 'skill_manage_candidate_install',
        candidate: summarizeCandidate(candidate),
        installed,
      });
    }

    return {
      success: false,
      error: 'skill_manage: action must be one of list, view, create, discover, candidate_list, candidate_view, candidate_install',
    };
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: SKILL_MANAGE_TOOL.function.parameters as ToolSchema['parameters'],
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;
    const action = readString(data.action);
    if (![
      'list',
      'view',
      'create',
      'discover',
      'candidate_list',
      'candidate_view',
      'candidate_install',
    ].includes(action)) {
      return {
        valid: false,
        errors: ['action must be one of list, view, create, discover, candidate_list, candidate_view, candidate_install'],
      };
    }
    if (action === 'view' && !readString(data.name)) {
      return { valid: false, errors: ['name is required for view'] };
    }
    if (action === 'discover' && !readString(data.query)) {
      return { valid: false, errors: ['query is required for discover'] };
    }
    if (action === 'create') {
      const missing = ['name', 'description', 'body'].filter((key) => !readString(data[key]));
      if (missing.length > 0) {
        return { valid: false, errors: [`${missing.join(', ')} required for create`] };
      }
    }
    if (action === 'candidate_view' && !readString(data.candidate_path)) {
      return { valid: false, errors: ['candidate_path is required for candidate_view'] };
    }
    if (action === 'candidate_install') {
      const missing = ['candidate_path', 'approved_by'].filter((key) => !readString(data[key]));
      if (missing.length > 0) {
        return { valid: false, errors: [`${missing.join(', ')} required for candidate_install`] };
      }
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['skills', 'skill', 'manage', 'list', 'view', 'create', 'discover', 'candidate', 'review', 'install', 'hermes'],
      priority: 6,
      modifiesFiles: true,
      makesNetworkRequests: true,
      fleetSafe: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createSkillsInspectionTools(): ITool[] {
  return [
    new CodeBuddyToolAdapter(
      SKILLS_LIST_TOOL,
      executeSkillsListTool,
      ['skills', 'skill', 'list', 'installed', 'enabled', 'disabled', 'hermes'],
    ),
    new CodeBuddyToolAdapter(
      SKILL_VIEW_TOOL,
      executeSkillViewTool,
      ['skills', 'skill', 'view', 'read', 'content', 'inspect', 'show', 'hermes'],
    ),
    new SkillManageExecuteTool(),
  ];
}
