/** Agent-callable adapter for the shared local-first Meeting Notes pipeline. */

import { realpath, stat } from 'fs/promises';
import path from 'path';
import type { ToolResult } from '../types/index.js';
import {
  generateMeetingNotes,
  assertSupportedMeetingFilePath,
  resolveMeetingOutputTargets,
  writeMeetingOutputReports,
  type MeetingOutputTargets,
} from '../meeting/index.js';
import type {
  ITool,
  IToolExecutionContext,
  IToolMetadata,
  IValidationResult,
  ToolCategoryType,
  ToolSchema,
} from './registry/types.js';

export interface MeetingNotesToolDependencies {
  generate?: typeof generateMeetingNotes;
  writeReports?: typeof writeMeetingOutputReports;
}

function hasTraversal(raw: string): boolean {
  return raw.split(/[\\/]+/u).includes('..');
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertSafeAgentReportLocation(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  const segments = relative.split(path.sep).map((segment) => segment.toLowerCase());
  if (segments.some((segment) => ['.codebuddy', '.git', 'node_modules'].includes(segment))) {
    throw new Error('output_prefix cannot write into control or dependency directories');
  }
  const stem = path.basename(candidate, path.extname(candidate)).toLowerCase();
  if (['agents', 'codebuddy', 'codebuddy_memory', 'context', 'instructions', 'readme'].includes(stem)) {
    throw new Error('output_prefix cannot create an auto-loaded instruction file');
  }
}

function cleanPath(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`${label} must be a non-empty path`);
  const value = raw.trim();
  if (value.includes('\0')) throw new Error(`${label} contains a null byte`);
  if (hasTraversal(value)) throw new Error(`${label} contains a forbidden '..' traversal component`);
  return value;
}

async function realWorkspaceRoot(cwd: string): Promise<string> {
  const root = await realpath(path.resolve(cwd));
  const info = await stat(root);
  if (!info.isDirectory()) throw new Error('Meeting Notes workspace root is not a directory');
  return root;
}

/** Resolve and realpath an existing input file under the active tool workspace. */
export async function resolveMeetingInputPath(inputPath: string, cwd: string): Promise<string> {
  const value = cleanPath(inputPath, 'input_path');
  const root = await realWorkspaceRoot(cwd);
  const lexical = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  if (!isInside(root, lexical)) throw new Error('input_path resolves outside the active workspace');
  const actual = await realpath(lexical);
  if (!isInside(root, actual)) throw new Error('input_path resolves through a symlink outside the active workspace');
  const info = await stat(actual);
  if (!info.isFile()) throw new Error('input_path must point to a file');
  assertSupportedMeetingFilePath(actual);
  return actual;
}

async function closestExistingRealPath(candidate: string): Promise<string> {
  let cursor = candidate;
  while (true) {
    try {
      return await realpath(cursor);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
      if (code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      cursor = parent;
    }
  }
}

/** Validate a report target, including its closest existing (possibly symlinked) parent. */
export async function assertMeetingOutputPath(target: string, cwd: string): Promise<void> {
  const root = await realWorkspaceRoot(cwd);
  const lexical = path.resolve(target);
  if (!isInside(root, lexical)) throw new Error('output_prefix resolves outside the active workspace');
  const actualAncestor = await closestExistingRealPath(lexical);
  if (!isInside(root, actualAncestor)) {
    throw new Error('output_prefix resolves through a symlink outside the active workspace');
  }
}

/** Resolve a relative or absolute output candidate under cwd; final targets are checked after title derivation. */
export async function resolveMeetingOutputCandidate(outputPrefix: string, cwd: string): Promise<string> {
  const value = cleanPath(outputPrefix, 'output_prefix');
  const root = await realWorkspaceRoot(cwd);
  const lexical = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  if (!isInside(root, lexical)) throw new Error('output_prefix resolves outside the active workspace');
  assertSafeAgentReportLocation(root, lexical);
  return lexical;
}

function relativeTargets(targets: MeetingOutputTargets, cwd: string): MeetingOutputTargets {
  return {
    markdown: path.relative(cwd, targets.markdown) || path.basename(targets.markdown),
    json: path.relative(cwd, targets.json) || path.basename(targets.json),
  };
}

export class MeetingNotesTool implements ITool {
  readonly name = 'meeting_notes';
  readonly description =
    'Create grounded meeting notes from a LOCAL transcript, audio, or video file inside the active workspace. Returns Markdown plus structured JSON data (title, summary, speakers, decisions, actions, deadlines, evidence, questions, timestamped transcript). This agent tool is strictly deterministic and never sends transcript data to an LLM or network service. Optionally writes paired .md/.json reports under the workspace; never sends or publishes the result.';

  private readonly deps: MeetingNotesToolDependencies;

  constructor(deps: MeetingNotesToolDependencies = {}) {
    this.deps = deps;
  }

  async execute(input: Record<string, unknown>, context?: IToolExecutionContext): Promise<ToolResult> {
    try {
      const validation = this.validate(input);
      if (!validation.valid) {
        return { success: false, error: `meeting_notes validation failed: ${validation.errors?.join(', ')}` };
      }
      const cwd = context?.cwd || process.cwd();
      const inputPath = await resolveMeetingInputPath(input.input_path as string, cwd);
      const language = typeof input.language === 'string' && input.language.trim()
        ? input.language.trim()
        : 'fr';
      const generate = this.deps.generate ?? generateMeetingNotes;
      const result = await generate(
        { kind: 'file', path: inputPath },
        { language, useAI: false },
      );

      let written: MeetingOutputTargets | null = null;
      if (typeof input.output_prefix === 'string' && input.output_prefix.trim()) {
        const output = await resolveMeetingOutputCandidate(input.output_prefix, cwd);
        const targets = await resolveMeetingOutputTargets(output, result);
        const root = await realWorkspaceRoot(cwd);
        assertSafeAgentReportLocation(root, targets.markdown);
        assertSafeAgentReportLocation(root, targets.json);
        await Promise.all([
          assertMeetingOutputPath(targets.markdown, cwd),
          assertMeetingOutputPath(targets.json, cwd),
        ]);
        written = await (this.deps.writeReports ?? writeMeetingOutputReports)(output, result);
      }

      const visiblePaths = written ? relativeTargets(written, await realWorkspaceRoot(cwd)) : null;
      const pathSummary = visiblePaths
        ? `\n\nReports written inside the workspace:\n- ${visiblePaths.markdown}\n- ${visiblePaths.json}`
        : '';
      return {
        success: true,
        output: `${result.markdown}${pathSummary}`,
        data: {
          notes: result.notes,
          markdown: result.markdown,
          json: result.json,
          paths: visiblePaths,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `meeting_notes failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          input_path: {
            type: 'string',
            description: 'Transcript (.txt/.md/.srt/.vtt/.json), audio, or video file under the active workspace. Relative paths resolve from workspace cwd; absolute paths are allowed only when still under it.',
          },
          language: {
            type: 'string',
            description: 'Report language (default: fr).',
            default: 'fr',
          },
          output_prefix: {
            type: 'string',
            description: 'Optional workspace-local report prefix. Writes new paired <prefix>.md and <prefix>.json files; existing targets are never overwritten. An existing directory receives a title-derived filename.',
          },
        },
        required: ['input_path'],
        additionalProperties: false,
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const value = input as Record<string, unknown>;
    const errors: string[] = [];
    if (typeof value.input_path !== 'string' || !value.input_path.trim()) {
      errors.push('input_path must be a non-empty string');
    } else if (value.input_path.length > 4_096) {
      errors.push('input_path is too long');
    } else if (hasTraversal(value.input_path)) {
      errors.push("input_path must not contain '..' traversal components");
    }
    if (value.language !== undefined && (typeof value.language !== 'string' || !value.language.trim() || value.language.length > 50)) {
      errors.push('language must be a non-empty string of at most 50 characters');
    }
    // Defense in depth for hand-authored calls made against an older schema:
    // this agent surface never authorizes transcript egress.
    if (value.use_ai !== undefined && value.use_ai !== false) {
      errors.push('use_ai=true is not allowed by the local-only meeting_notes agent tool');
    }
    if (value.output_prefix !== undefined) {
      if (typeof value.output_prefix !== 'string' || !value.output_prefix.trim()) {
        errors.push('output_prefix must be a non-empty string when provided');
      } else if (value.output_prefix.length > 4_096) {
        errors.push('output_prefix is too long');
      } else if (hasTraversal(value.output_prefix)) {
        errors.push("output_prefix must not contain '..' traversal components");
      }
    }
    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'document' as ToolCategoryType,
      keywords: [
        'meeting', 'notes', 'minutes', 'transcript', 'transcription', 'audio', 'video',
        'summary', 'decisions', 'actions', 'speakers', 'réunion', 'compte rendu',
        'résumé', 'décisions', 'tâches', 'horodatage',
      ],
      priority: 8,
      modifiesFiles: true,
      makesNetworkRequests: false,
      requiresConfirmation: true,
      fleetSafe: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}
