/**
 * Computer Skills Module
 *
 * Skills library for reusable automations and workflows.
 * Inspired by Open Interpreter's computer.skills capabilities.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { safeEval, safeEvalAsync, safeInterpolate } from '../../sandbox/safe-eval.js';
import { detectProviderFromEnv } from '../../utils/provider-detector.js';

// ============================================================================
// Types
// ============================================================================

export interface Skill {
  /** Unique skill identifier */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Version */
  version: string;
  /** Author */
  author?: string;
  /** Tags for categorization */
  tags: string[];
  /** Input parameters schema */
  parameters: SkillParameter[];
  /** Steps to execute */
  steps: SkillStep[];
  /** Required capabilities */
  capabilities?: string[];
  /** Example usage */
  examples?: SkillExample[];
  /** Source file path */
  sourcePath?: string;
  /** Built-in skill */
  builtin?: boolean;
}

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
}

export interface SkillStep {
  id?: string;
  type: 'code' | 'shell' | 'llm' | 'condition' | 'loop' | 'skill';
  content: string;
  language?: string;
  model?: string;
  systemPrompt?: string;
  condition?: string;
  items?: string;
  skillId?: string;
  args?: Record<string, unknown>;
  onError?: 'stop' | 'continue' | 'retry';
  retryCount?: number;
}

export interface SkillExample {
  input: Record<string, unknown>;
  description: string;
}

export interface SkillRunResult {
  skillId: string;
  success: boolean;
  output: unknown;
  error?: string;
  duration: number;
  steps: StepResult[];
}

export interface StepResult {
  stepId: string;
  success: boolean;
  output: unknown;
  error?: string;
  duration: number;
}

export interface SkillSearchResult {
  skill: Skill;
  score: number;
  matchedTags: string[];
  matchedDescription: boolean;
}

export interface SkillLibraryConfig {
  /** Paths to search for skills */
  skillPaths: string[];
  /** Enable built-in skills */
  enableBuiltin: boolean;
  /** Cache skills */
  cacheEnabled: boolean;
}

export const DEFAULT_SKILL_LIBRARY_CONFIG: SkillLibraryConfig = {
  skillPaths: [
    '~/.codebuddy/skills',
    '.codebuddy/skills',
  ],
  enableBuiltin: true,
  cacheEnabled: true,
};

// ============================================================================
// Built-in Skills
// ============================================================================

const BUILTIN_SKILLS: Skill[] = [
  {
    id: 'web-search',
    name: 'Web Search',
    description: 'Search the web and return results',
    version: '1.0.0',
    tags: ['web', 'search', 'research'],
    builtin: true,
    parameters: [
      { name: 'query', type: 'string', description: 'Search query', required: true },
      { name: 'numResults', type: 'number', description: 'Number of results', default: 5 },
    ],
    steps: [
      {
        type: 'code',
        language: 'javascript',
        content: `
          const { getComputerBrowser } = await import('./browser.js');
          const browser = getComputerBrowser();
          return await browser.search(params.query, { numResults: params.numResults });
        `,
      },
    ],
    examples: [
      { input: { query: 'TypeScript best practices' }, description: 'Search for TypeScript articles' },
    ],
  },
  {
    id: 'read-file',
    name: 'Read File',
    description: 'Read contents of a file',
    version: '1.0.0',
    tags: ['file', 'read', 'io'],
    builtin: true,
    parameters: [
      { name: 'path', type: 'string', description: 'File path', required: true },
      { name: 'lines', type: 'number', description: 'Number of lines to read' },
    ],
    steps: [
      {
        type: 'code',
        language: 'javascript',
        content: `
          const { getComputerFiles } = await import('./files.js');
          const files = getComputerFiles();
          if (params.lines) {
            return await files.readLines(params.path, 0, params.lines);
          }
          return await files.read(params.path);
        `,
      },
    ],
  },
  {
    id: 'write-file',
    name: 'Write File',
    description: 'Write content to a file',
    version: '1.0.0',
    tags: ['file', 'write', 'io'],
    builtin: true,
    parameters: [
      { name: 'path', type: 'string', description: 'File path', required: true },
      { name: 'content', type: 'string', description: 'Content to write', required: true },
      { name: 'append', type: 'boolean', description: 'Append to file', default: false },
    ],
    steps: [
      {
        type: 'code',
        language: 'javascript',
        content: `
          const { getComputerFiles } = await import('./files.js');
          const files = getComputerFiles();
          await files.write(params.path, params.content, { append: params.append, createDirs: true });
          return { success: true, path: params.path };
        `,
      },
    ],
  },
  {
    id: 'run-shell',
    name: 'Run Shell Command',
    description: 'Execute a shell command',
    version: '1.0.0',
    tags: ['shell', 'command', 'exec'],
    builtin: true,
    capabilities: ['shellCommands'],
    parameters: [
      { name: 'command', type: 'string', description: 'Command to run', required: true },
      { name: 'cwd', type: 'string', description: 'Working directory' },
      { name: 'timeout', type: 'number', description: 'Timeout in ms', default: 30000 },
    ],
    steps: [
      {
        type: 'shell',
        content: '{{command}}',
      },
    ],
  },
  {
    id: 'get-clipboard',
    name: 'Get Clipboard',
    description: 'Get clipboard contents',
    version: '1.0.0',
    tags: ['clipboard', 'os'],
    builtin: true,
    parameters: [],
    steps: [
      {
        type: 'code',
        language: 'javascript',
        content: `
          const { getComputerOS } = await import('./os.js');
          const computerOS = getComputerOS();
          return await computerOS.getClipboardText();
        `,
      },
    ],
  },
  {
    id: 'set-clipboard',
    name: 'Set Clipboard',
    description: 'Set clipboard contents',
    version: '1.0.0',
    tags: ['clipboard', 'os'],
    builtin: true,
    parameters: [
      { name: 'text', type: 'string', description: 'Text to copy', required: true },
    ],
    steps: [
      {
        type: 'code',
        language: 'javascript',
        content: `
          const { getComputerOS } = await import('./os.js');
          const computerOS = getComputerOS();
          await computerOS.setClipboardText(params.text);
          return { success: true };
        `,
      },
    ],
  },
  {
    id: 'open-url',
    name: 'Open URL',
    description: 'Open a URL in the default browser',
    version: '1.0.0',
    tags: ['browser', 'url', 'open'],
    builtin: true,
    parameters: [
      { name: 'url', type: 'string', description: 'URL to open', required: true },
    ],
    steps: [
      {
        type: 'code',
        language: 'javascript',
        content: `
          const { getComputerOS } = await import('./os.js');
          const computerOS = getComputerOS();
          await computerOS.open(params.url);
          return { success: true, url: params.url };
        `,
      },
    ],
  },
  {
    id: 'summarize-webpage',
    name: 'Summarize Webpage',
    description: 'Fetch and summarize a webpage',
    version: '1.0.0',
    tags: ['web', 'summarize', 'research'],
    builtin: true,
    capabilities: ['webSearch'],
    parameters: [
      { name: 'url', type: 'string', description: 'URL to summarize', required: true },
      { name: 'maxLength', type: 'number', description: 'Max content length', default: 10000 },
    ],
    steps: [
      {
        type: 'code',
        language: 'javascript',
        content: `
          const { getComputerBrowser } = await import('./browser.js');
          const browser = getComputerBrowser();
          const page = await browser.fetch(params.url, { maxLength: params.maxLength });
          return { title: page.title, content: page.content.substring(0, 2000) };
        `,
      },
      {
        type: 'llm',
        content: 'Summarize the following webpage content in 3-5 bullet points:\n\nTitle: {{stepResults[0].title}}\n\n{{stepResults[0].content}}',
      },
    ],
  },
  {
    id: 'git-status',
    name: 'Git Status',
    description: 'Get git repository status',
    version: '1.0.0',
    tags: ['git', 'vcs', 'dev'],
    builtin: true,
    capabilities: ['shellCommands'],
    parameters: [
      { name: 'path', type: 'string', description: 'Repository path', default: '.' },
    ],
    steps: [
      {
        type: 'shell',
        content: 'cd "{{path}}" && git status --porcelain',
      },
    ],
  },
  {
    id: 'llm-ask',
    name: 'Ask LLM',
    description: 'Ask the LLM a question and return the answer',
    version: '1.0.0',
    tags: ['llm', 'ai', 'question'],
    builtin: true,
    parameters: [
      { name: 'prompt', type: 'string', description: 'The question or prompt to send', required: true },
      { name: 'systemPrompt', type: 'string', description: 'Custom system prompt', default: 'You are a helpful assistant. Be concise.' },
      { name: 'model', type: 'string', description: 'Model to use (optional)' },
    ],
    steps: [
      {
        type: 'llm',
        content: '{{prompt}}',
        systemPrompt: '{{systemPrompt}}',
      },
    ],
    examples: [
      { input: { prompt: 'What is the capital of France?' }, description: 'Ask a factual question' },
    ],
  },
  {
    id: 'list-processes',
    name: 'List Processes',
    description: 'List running processes',
    version: '1.0.0',
    tags: ['os', 'process', 'system'],
    builtin: true,
    parameters: [
      { name: 'filter', type: 'string', description: 'Filter by name' },
    ],
    steps: [
      {
        type: 'code',
        language: 'javascript',
        content: `
          const { getComputerOS } = await import('./os.js');
          const computerOS = getComputerOS();
          let processes = await computerOS.listProcesses();
          if (params.filter) {
            const filter = params.filter.toLowerCase();
            processes = processes.filter(p =>
              p.name.toLowerCase().includes(filter) ||
              (p.command && p.command.toLowerCase().includes(filter))
            );
          }
          return processes.slice(0, 20);
        `,
      },
    ],
  },
];

// ============================================================================
// Skills Library Class
// ============================================================================

export class ComputerSkills extends EventEmitter {
  private config: SkillLibraryConfig;
  private skills: Map<string, Skill> = new Map();
  private loaded: boolean = false;
  private llmClient: import('../../codebuddy/client.js').CodeBuddyClient | null = null;

  constructor(config: Partial<SkillLibraryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_SKILL_LIBRARY_CONFIG, ...config };
  }

  // ==========================================================================
  // Skill Discovery
  // ==========================================================================

  /**
   * Load all available skills
   */
  async load(): Promise<void> {
    if (this.loaded && this.config.cacheEnabled) {
      return;
    }

    this.skills.clear();

    // Load built-in skills
    if (this.config.enableBuiltin) {
      for (const skill of BUILTIN_SKILLS) {
        this.skills.set(skill.id, skill);
      }
    }

    // Load skills from paths
    for (const skillPath of this.config.skillPaths) {
      await this.loadSkillsFromPath(skillPath);
    }

    this.loaded = true;
    this.emit('loaded', this.skills.size);
  }

  /**
   * Load skills from a directory
   */
  private async loadSkillsFromPath(skillPath: string): Promise<void> {
    const resolved = this.resolvePath(skillPath);

    if (!fs.existsSync(resolved)) {
      return;
    }

    const files = await fs.promises.readdir(resolved);

    for (const file of files) {
      if (file.endsWith('.json') || file.endsWith('.yaml') || file.endsWith('.yml')) {
        try {
          const fullPath = path.join(resolved, file);
          const content = await fs.promises.readFile(fullPath, 'utf-8');

          let skill: Skill;
          if (file.endsWith('.json')) {
            skill = JSON.parse(content);
          } else {
            // YAML support would require yaml package
            continue;
          }

          skill.sourcePath = fullPath;
          this.skills.set(skill.id, skill);
        } catch (err) {
          this.emit('error', { file, error: err });
        }
      }
    }
  }

  /**
   * List all available skills
   */
  list(filter?: { tags?: string[]; search?: string }): Skill[] {
    let skills = Array.from(this.skills.values());

    if (filter?.tags && filter.tags.length > 0) {
      skills = skills.filter(s =>
        filter.tags!.some(tag => s.tags.includes(tag))
      );
    }

    if (filter?.search) {
      const search = filter.search.toLowerCase();
      skills = skills.filter(s =>
        s.name.toLowerCase().includes(search) ||
        s.description.toLowerCase().includes(search) ||
        s.tags.some(t => t.toLowerCase().includes(search))
      );
    }

    return skills;
  }

  /**
   * Search for skills
   */
  search(query: string): SkillSearchResult[] {
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);
    const results: SkillSearchResult[] = [];

    for (const skill of this.skills.values()) {
      let score = 0;
      const matchedTags: string[] = [];
      let matchedDescription = false;

      // Check name
      if (skill.name.toLowerCase().includes(queryLower)) {
        score += 10;
      }

      // Check tags
      for (const tag of skill.tags) {
        if (queryWords.some(word => tag.toLowerCase().includes(word))) {
          score += 5;
          matchedTags.push(tag);
        }
      }

      // Check description
      for (const word of queryWords) {
        if (skill.description.toLowerCase().includes(word)) {
          score += 2;
          matchedDescription = true;
        }
      }

      if (score > 0) {
        results.push({ skill, score, matchedTags, matchedDescription });
      }
    }

    // Sort by score descending
    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Get a skill by ID
   */
  get(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  // ==========================================================================
  // Skill Execution
  // ==========================================================================

  /**
   * Run a skill
   */
  async run(skillId: string, params: Record<string, unknown> = {}): Promise<SkillRunResult> {
    const startTime = Date.now();
    const skill = this.skills.get(skillId);

    if (!skill) {
      return {
        skillId,
        success: false,
        output: null,
        error: `Skill not found: ${skillId}`,
        duration: Date.now() - startTime,
        steps: [],
      };
    }

    // Validate parameters
    const validationError = this.validateParams(skill, params);
    if (validationError) {
      return {
        skillId,
        success: false,
        output: null,
        error: validationError,
        duration: Date.now() - startTime,
        steps: [],
      };
    }

    // Apply defaults
    const fullParams = this.applyDefaults(skill, params);

    // Execute steps
    const stepResults: StepResult[] = [];
    let lastOutput: unknown = null;

    for (let i = 0; i < skill.steps.length; i++) {
      const step = skill.steps[i];
      const stepId = step.id || `step-${i}`;
      const stepStart = Date.now();

      try {
        const output = await this.executeStep(step, fullParams, stepResults);
        lastOutput = output;

        stepResults.push({
          stepId,
          success: true,
          output,
          duration: Date.now() - stepStart,
        });

        this.emit('step:complete', { skillId, stepId, output });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);

        stepResults.push({
          stepId,
          success: false,
          output: null,
          error,
          duration: Date.now() - stepStart,
        });

        this.emit('step:error', { skillId, stepId, error });

        if (step.onError !== 'continue') {
          return {
            skillId,
            success: false,
            output: null,
            error: `Step ${stepId} failed: ${error}`,
            duration: Date.now() - startTime,
            steps: stepResults,
          };
        }
      }
    }

    const result: SkillRunResult = {
      skillId,
      success: true,
      output: lastOutput,
      duration: Date.now() - startTime,
      steps: stepResults,
    };

    this.emit('complete', result);

    return result;
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: SkillStep,
    params: Record<string, unknown>,
    previousResults: StepResult[]
  ): Promise<unknown> {
    const context = {
      params,
      stepResults: previousResults.map(r => r.output),
    };

    switch (step.type) {
      case 'code':
        return this.executeCodeStep(step, context);

      case 'shell':
        return this.executeShellStep(step, context);

      case 'llm':
        return this.executeLLMStep(step, context);

      case 'condition':
        return this.executeConditionStep(step, context);

      case 'loop':
        return this.executeLoopStep(step, context, params, previousResults);

      case 'skill':
        if (!step.skillId) {
          throw new Error('Skill step requires skillId');
        }
        return this.run(step.skillId, { ...params, ...step.args });

      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  private async executeCodeStep(
    step: SkillStep,
    context: { params: Record<string, unknown>; stepResults: unknown[] }
  ): Promise<unknown> {
    // Sandboxed JavaScript execution via vm.runInNewContext
    return safeEvalAsync(step.content, {
      context: {
        params: context.params,
        stepResults: context.stepResults,
      },
      timeout: 10000,
    });
  }

  private async executeShellStep(
    step: SkillStep,
    context: { params: Record<string, unknown>; stepResults: unknown[] }
  ): Promise<unknown> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // Interpolate template variables
    const command = this.interpolate(step.content, context);

    const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  }

  private async getLLMClient(): Promise<import('../../codebuddy/client.js').CodeBuddyClient> {
    if (this.llmClient) return this.llmClient;
    const provider = detectProviderFromEnv();
    if (!provider) {
      throw new Error('No AI provider configured for LLM skill steps. Run `buddy login chatgpt` or set a provider API key.');
    }
    const { CodeBuddyClient } = await import('../../codebuddy/client.js');
    this.llmClient = new CodeBuddyClient(provider.apiKey, provider.defaultModel, provider.baseURL);
    return this.llmClient;
  }

  private async executeLLMStep(
    step: SkillStep,
    context: { params: Record<string, unknown>; stepResults: unknown[] }
  ): Promise<unknown> {
    const client = await this.getLLMClient();

    const prompt = this.interpolate(step.content, context);
    const systemPrompt = step.systemPrompt
      ? this.interpolate(step.systemPrompt, context)
      : 'You are a helpful assistant. Be concise and precise.';

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ];

    const response = await client.chat(messages, [], {
      model: step.model,
    });

    const content = response.choices[0]?.message?.content ?? '';
    const usage = response.usage;

    return {
      content,
      tokens: {
        input: usage?.prompt_tokens ?? 0,
        output: usage?.completion_tokens ?? 0,
        total: usage?.total_tokens ?? 0,
      },
    };
  }

  private async executeConditionStep(
    step: SkillStep,
    context: { params: Record<string, unknown>; stepResults: unknown[] }
  ): Promise<unknown> {
    if (!step.condition) {
      throw new Error('Condition step requires condition');
    }

    const condition = this.interpolate(step.condition, context);
    return safeEval(condition, {
      context: {
        params: context.params,
        stepResults: context.stepResults,
      },
    });
  }

  private async executeLoopStep(
    step: SkillStep,
    context: { params: Record<string, unknown>; stepResults: unknown[] },
    params: Record<string, unknown>,
    _previousResults: StepResult[]
  ): Promise<unknown> {
    if (!step.items) {
      throw new Error('Loop step requires items');
    }

    const itemsExpr = this.interpolate(step.items, context);
    const items = safeEval(itemsExpr, {
      context: {
        params: context.params,
        stepResults: context.stepResults,
      },
    }) as unknown[];

    const results: unknown[] = [];

    for (const item of items) {
      const itemParams = { ...params, _item: item };
      const innerContext = {
        params: itemParams,
        stepResults: context.stepResults,
      };

      const result = await this.executeCodeStep(
        { ...step, type: 'code' },
        innerContext
      );
      results.push(result);
    }

    return results;
  }

  // ==========================================================================
  // Skill Management
  // ==========================================================================

  /**
   * Register a new skill
   */
  register(skill: Skill): void {
    const validation = this.validateSkill(skill);
    if (!validation.valid) {
      throw new Error(`Invalid skill: ${validation.errors.join(', ')}`);
    }

    this.skills.set(skill.id, skill);
    this.emit('registered', skill.id);
  }

  /**
   * Unregister a skill
   */
  unregister(skillId: string): boolean {
    const deleted = this.skills.delete(skillId);
    if (deleted) {
      this.emit('unregistered', skillId);
    }
    return deleted;
  }

  /**
   * Save a skill to disk
   */
  async save(skill: Skill, filePath?: string): Promise<void> {
    const resolved = filePath
      ? this.resolvePath(filePath)
      : path.join(
          this.resolvePath(this.config.skillPaths[0]),
          `${skill.id}.json`
        );

    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    await fs.promises.writeFile(resolved, JSON.stringify(skill, null, 2), 'utf-8');
    skill.sourcePath = resolved;
  }

  /**
   * Delete a skill from disk
   */
  async delete(skillId: string): Promise<boolean> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return false;
    }

    if (skill.builtin) {
      throw new Error('Cannot delete built-in skill');
    }

    if (skill.sourcePath && fs.existsSync(skill.sourcePath)) {
      await fs.promises.unlink(skill.sourcePath);
    }

    return this.unregister(skillId);
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  private validateParams(skill: Skill, params: Record<string, unknown>): string | null {
    for (const param of skill.parameters) {
      if (param.required && !(param.name in params)) {
        return `Missing required parameter: ${param.name}`;
      }

      if (param.name in params) {
        const value = params[param.name];
        const actualType = Array.isArray(value) ? 'array' : typeof value;

        if (actualType !== param.type && value !== undefined) {
          return `Invalid type for ${param.name}: expected ${param.type}, got ${actualType}`;
        }

        if (param.enum && !param.enum.includes(value)) {
          return `Invalid value for ${param.name}: must be one of ${param.enum.join(', ')}`;
        }
      }
    }

    return null;
  }

  private applyDefaults(skill: Skill, params: Record<string, unknown>): Record<string, unknown> {
    const result = { ...params };

    for (const param of skill.parameters) {
      if (!(param.name in result) && param.default !== undefined) {
        result[param.name] = param.default;
      }
    }

    return result;
  }

  private validateSkill(skill: Skill): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!skill.id) errors.push('ID is required');
    if (!skill.name) errors.push('Name is required');
    if (!skill.description) errors.push('Description is required');
    if (!skill.version) errors.push('Version is required');
    if (!skill.steps || skill.steps.length === 0) errors.push('At least one step is required');

    return { valid: errors.length === 0, errors };
  }

  private interpolate(template: string, context: Record<string, unknown>): string {
    return safeInterpolate(template, context);
  }

  private resolvePath(p: string): string {
    if (p.startsWith('~')) {
      return path.join(os.homedir(), p.slice(1));
    }
    return path.resolve(p);
  }

  /**
   * Get skill count
   */
  get count(): number {
    return this.skills.size;
  }

  /**
   * Get all tags
   */
  getTags(): string[] {
    const tags = new Set<string>();
    for (const skill of this.skills.values()) {
      for (const tag of skill.tags) {
        tags.add(tag);
      }
    }
    return Array.from(tags).sort();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let skillsInstance: ComputerSkills | null = null;

export function getComputerSkills(config?: Partial<SkillLibraryConfig>): ComputerSkills {
  if (!skillsInstance) {
    skillsInstance = new ComputerSkills(config);
  }
  return skillsInstance;
}

export function resetComputerSkills(): void {
  skillsInstance = null;
}

export default ComputerSkills;
