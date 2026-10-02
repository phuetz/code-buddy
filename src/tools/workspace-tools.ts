import { resolveToolPath, getToolWorkingDirectory } from '../utils/tool-execution-context.js';
import { constants as fsConstants, promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ToolResult } from '../types/index.js';
import { checkSecretFileAccess, formatSecretRefusal } from '../security/secret-files.js';
import {
  getWorkspace,
  type Workspace,
  type WorkspaceConfigOptions,
  type WorkspaceRepo,
} from '../workspace/workspace-config.js';
import { SearchTool, type SearchResult } from './search.js';
import type {
  ITool,
  IToolExecutionContext,
  IToolMetadata,
  IValidationResult,
  ToolSchema,
} from './registry/types.js';

const DEFAULT_MAX_RESULTS = 50;
const MAX_RESULTS = 200;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_FILE_KB = 512;

interface WorkspaceSearchOptions {
  maxResults: number;
  glob?: string;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface WorkspaceToolDependencies {
  workspaceProvider?: (options?: WorkspaceConfigOptions) => Workspace | null;
  searchRepo?: (
    repo: WorkspaceRepo,
    query: string,
    options: WorkspaceSearchOptions,
  ) => Promise<SearchResult[]>;
}

function parsePositiveEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hasTraversal(value: string): boolean {
  return value.split(/[\\/]+/u).includes('..');
}

function isAbsoluteOnAnyPlatform(value: string): boolean {
  return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function validationFailure(errors: string[]): IValidationResult {
  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

async function defaultSearchRepo(
  repo: WorkspaceRepo,
  query: string,
  options: WorkspaceSearchOptions,
): Promise<SearchResult[]> {
  const search = new SearchTool();
  search.setCurrentDirectory(repo.path);
  return await search.searchText(query, {
    ...(options.glob !== undefined ? { includePattern: options.glob } : {}),
    maxResults: options.maxResults,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
}

function workspaceFor(
  provider: NonNullable<WorkspaceToolDependencies['workspaceProvider']>,
  context?: IToolExecutionContext,
): Workspace | null {
  return provider(context?.cwd ? { cwd: context.cwd } : undefined);
}

export class WorkspaceSearchTool implements ITool {
  readonly name = 'workspace_search';
  readonly description =
    'Search text across the opt-in multi-repository workspace with bounded, repository-prefixed results.';

  private readonly workspaceProvider: NonNullable<WorkspaceToolDependencies['workspaceProvider']>;
  private readonly searchRepo: NonNullable<WorkspaceToolDependencies['searchRepo']>;

  constructor(dependencies: WorkspaceToolDependencies = {}) {
    this.workspaceProvider = dependencies.workspaceProvider ?? getWorkspace;
    this.searchRepo = dependencies.searchRepo ?? defaultSearchRepo;
  }

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    const validation = this.validate(input);
    if (!validation.valid) {
      return { success: false, error: `workspace_search validation failed: ${validation.errors?.join(', ')}` };
    }

    const workspace = workspaceFor(this.workspaceProvider, context);
    if (!workspace) {
      return { success: false, error: 'Multi-repo workspace is not enabled or has no valid repositories' };
    }

    const query = (input.query as string).trim();
    const glob = typeof input.glob === 'string' ? input.glob.trim() : undefined;
    if (hasTraversal(query) || isAbsoluteOnAnyPlatform(query)) {
      return { success: false, error: 'workspace_search query may not contain traversal or an absolute path' };
    }
    if (glob && (hasTraversal(glob) || isAbsoluteOnAnyPlatform(glob))) {
      return { success: false, error: 'workspace_search glob may not leave repository roots' };
    }

    const requestedRepos = input.repos as string[] | undefined;
    const selectedNames = requestedRepos ? new Set(requestedRepos) : null;
    if (selectedNames) {
      const knownNames = new Set(workspace.repos.map((repo) => repo.name));
      const unknown = [...selectedNames].filter((name) => !knownNames.has(name));
      if (unknown.length > 0) {
        return { success: false, error: `Unknown workspace repositories: ${unknown.join(', ')}` };
      }
    }
    const repos = selectedNames
      ? workspace.repos.filter((repo) => selectedNames.has(repo.name))
      : workspace.repos;
    const requestedMax = typeof input.max_results === 'number'
      ? Math.floor(input.max_results)
      : DEFAULT_MAX_RESULTS;
    const maxResults = Math.min(requestedMax, MAX_RESULTS);
    const timeoutMs = parsePositiveEnv(process.env.CODEBUDDY_WORKSPACE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    const controller = new AbortController();
    let timeoutHandle: NodeJS.Timeout | undefined;

    const searchAll = async (): Promise<string[]> => {
      const lines: string[] = [];
      const startedAt = Date.now();
      for (const repo of repos) {
        if (controller.signal.aborted || lines.length >= maxResults) break;
        const elapsed = Date.now() - startedAt;
        const remainingTimeout = Math.max(1, timeoutMs - elapsed);
        const matches = await this.searchRepo(repo, query, {
          maxResults: maxResults - lines.length,
          ...(glob ? { glob } : {}),
          timeoutMs: remainingTimeout,
          signal: controller.signal,
        });
        for (const match of matches) {
          if (lines.length >= maxResults) break;
          const lexical = path.isAbsolute(match.file)
            ? path.resolve(getToolWorkingDirectory(), match.file)
            : path.resolve(repo.path, match.file);
          if (!isInside(repo.path, lexical)) {
            throw new Error(`Search match escaped repository root: ${repo.name}`);
          }
          const canonical = await fs.realpath(resolveToolPath(lexical));
          if (!isInside(repo.path, canonical)) {
            throw new Error(`Search match resolved outside repository root: ${repo.name}`);
          }
          const relative = path.relative(repo.path, canonical).split(path.sep).join('/');
          const text = match.text.replace(/[\r\n]+/gu, ' ').trim();
          lines.push(`${repo.name}:${relative}:${match.line}: ${text}`);
        }
      }
      return lines;
    };

    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort();
          reject(new Error(`Workspace search timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      const lines = await Promise.race([searchAll(), timeout]);
      if (lines.length === 0) {
        return { success: true, output: `No workspace results found for "${query}"`, data: [] };
      }
      return { success: true, output: lines.join('\n'), data: lines };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (controller.signal.aborted || /timed out/iu.test(message)) {
        return { success: false, error: `Workspace search timed out after ${timeoutMs}ms` };
      }
      return { success: false, error: `Workspace search failed: ${message}` };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      controller.abort();
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Literal text to search for in every selected repository.' },
          repos: {
            type: 'array',
            description: 'Optional workspace repository names to search.',
            items: { type: 'string' },
          },
          max_results: {
            type: 'number',
            description: 'Maximum aggregated matches (default 50, hard limit 200).',
            minimum: 1,
            maximum: MAX_RESULTS,
          },
          glob: { type: 'string', description: 'Optional ripgrep include glob such as **/*.ts.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return { valid: false, errors: ['input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    const errors: string[] = [];
    if (typeof data.query !== 'string' || data.query.trim() === '') {
      errors.push('query must be a non-empty string');
    }
    if (data.repos !== undefined && (
      !Array.isArray(data.repos) ||
      data.repos.length === 0 ||
      data.repos.some((repo) => typeof repo !== 'string' || repo.trim() === '')
    )) {
      errors.push('repos must be a non-empty array of repository names');
    }
    if (data.max_results !== undefined && (
      typeof data.max_results !== 'number' ||
      !Number.isInteger(data.max_results) ||
      data.max_results < 1
    )) {
      errors.push('max_results must be a positive integer');
    }
    if (data.glob !== undefined && (typeof data.glob !== 'string' || data.glob.trim() === '')) {
      errors.push('glob must be a non-empty string');
    }
    return validationFailure(errors);
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_search',
      keywords: ['workspace', 'multi-repo', 'repository', 'search', 'grep', 'ecosystem'],
      priority: 10,
      modifiesFiles: false,
      makesNetworkRequests: false,
      fleetSafe: true,
    };
  }

  isAvailable(): boolean {
    return this.workspaceProvider() !== null;
  }
}

export class WorkspaceReadTool implements ITool {
  readonly name = 'workspace_read';
  readonly description =
    'Read a bounded file from a named repository in the opt-in multi-repository workspace.';

  private readonly workspaceProvider: NonNullable<WorkspaceToolDependencies['workspaceProvider']>;

  constructor(dependencies: Pick<WorkspaceToolDependencies, 'workspaceProvider'> = {}) {
    this.workspaceProvider = dependencies.workspaceProvider ?? getWorkspace;
  }

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    const validation = this.validate(input);
    if (!validation.valid) {
      return { success: false, error: `workspace_read validation failed: ${validation.errors?.join(', ')}` };
    }

    const workspace = workspaceFor(this.workspaceProvider, context);
    if (!workspace) {
      return { success: false, error: 'Multi-repo workspace is not enabled or has no valid repositories' };
    }
    const repoName = input.repo as string;
    const repo = workspace.repos.find((candidate) => candidate.name === repoName);
    if (!repo) return { success: false, error: `Unknown workspace repository: ${repoName}` };

    const requestedPath = (input.path as string).trim();
    if (requestedPath.includes('\0') || hasTraversal(requestedPath) || isAbsoluteOnAnyPlatform(requestedPath)) {
      return { success: false, error: 'workspace_read path must be a safe repository-relative path' };
    }

    try {
      const lexical = path.resolve(repo.path, requestedPath);
      if (!isInside(repo.path, lexical)) {
        return { success: false, error: 'workspace_read path resolves outside the repository root' };
      }
      const canonical = await fs.realpath(resolveToolPath(lexical));
      if (!isInside(repo.path, canonical)) {
        return { success: false, error: 'workspace_read path resolves through a symlink outside the repository root' };
      }
      const secret = checkSecretFileAccess(canonical, 'read');
      if (secret.secret) return { success: false, error: formatSecretRefusal(canonical, secret) };
      const maxFileKb = parsePositiveEnv(
        process.env.CODEBUDDY_WORKSPACE_MAX_FILE_KB,
        DEFAULT_MAX_FILE_KB,
      );
      const maxBytes = maxFileKb * 1024;
      const handle = await fs.open(resolveToolPath(canonical), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      let content: string;
      try {
        const info = await handle.stat();
        if (!info.isFile()) return { success: false, error: 'workspace_read path is not a file' };
        if (info.size > maxBytes) {
          return {
            success: false,
            error: `workspace_read file exceeds the ${maxFileKb}KB size limit`,
          };
        }
        const buffer = Buffer.alloc(maxBytes + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > maxBytes) {
          return {
            success: false,
            error: `workspace_read file exceeds the ${maxFileKb}KB size limit`,
          };
        }
        content = buffer.subarray(0, bytesRead).toString('utf8');
      } finally {
        await handle.close();
      }
      const allLines = content.split('\n');
      const offset = (input.offset as number | undefined) ?? 0;
      const limit = (input.limit as number | undefined) ?? allLines.length;
      const selected = allLines.slice(offset, offset + limit);
      const output = selected.map((line, index) => `${offset + index + 1}: ${line}`).join('\n');
      const relative = path.relative(repo.path, canonical).split(path.sep).join('/');
      return {
        success: true,
        output,
        data: { repo: repo.name, path: relative, offset, lines: selected.length },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `workspace_read failed: ${message}` };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'Workspace repository name.' },
          path: { type: 'string', description: 'Repository-relative file path.' },
          offset: { type: 'number', description: 'Zero-based first line offset.', minimum: 0 },
          limit: { type: 'number', description: 'Maximum number of lines to return.', minimum: 1 },
        },
        required: ['repo', 'path'],
        additionalProperties: false,
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return { valid: false, errors: ['input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    const errors: string[] = [];
    if (typeof data.repo !== 'string' || data.repo.trim() === '') {
      errors.push('repo must be a non-empty string');
    }
    if (typeof data.path !== 'string' || data.path.trim() === '') {
      errors.push('path must be a non-empty string');
    }
    if (data.offset !== undefined && (
      typeof data.offset !== 'number' || !Number.isInteger(data.offset) || data.offset < 0
    )) {
      errors.push('offset must be a non-negative integer');
    }
    if (data.limit !== undefined && (
      typeof data.limit !== 'number' || !Number.isInteger(data.limit) || data.limit < 1
    )) {
      errors.push('limit must be a positive integer');
    }
    return validationFailure(errors);
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'file_read',
      keywords: ['workspace', 'multi-repo', 'repository', 'read', 'file', 'ecosystem'],
      priority: 10,
      modifiesFiles: false,
      makesNetworkRequests: false,
      fleetSafe: true,
    };
  }

  isAvailable(): boolean {
    return this.workspaceProvider() !== null;
  }
}

export function createWorkspaceTools(): ITool[] {
  return [new WorkspaceSearchTool(), new WorkspaceReadTool()];
}
