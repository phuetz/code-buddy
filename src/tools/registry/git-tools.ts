/**
 * Git Tool Adapters
 *
 * ITool-compliant adapter for GitTool operations.
 * This adapter wraps the existing GitTool methods to conform
 * to the formal ITool interface for use with the FormalToolRegistry.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { GitTool } from '../git-tool.js';

// ============================================================================
// Shared GitTool Instance
// ============================================================================

let gitInstance: GitTool | null = null;

function getGit(): GitTool {
  if (!gitInstance) {
    gitInstance = new GitTool();
  }
  return gitInstance;
}

/**
 * Reset the shared GitTool instance (for testing)
 */
export function resetGitInstance(): void {
  gitInstance = null;
}

// ============================================================================
// Valid operations
// ============================================================================

const VALID_OPERATIONS = [
  'status',
  'diff',
  'add',
  'commit',
  'push',
  'pull',
  'branch',
  'checkout',
  'stash',
  'auto_commit',
  'blame',
  'cherry_pick',
  'bisect_start',
  'bisect_step',
  'bisect_reset',
] as const;

type GitOperation = typeof VALID_OPERATIONS[number];

// ============================================================================
// GitOperationTool
// ============================================================================

/**
 * GitOperationTool - ITool adapter for Git operations
 *
 * Unified tool that handles all Git operations via an operation parameter.
 */
export class GitOperationTool implements ITool {
  readonly name = 'git';
  readonly description = 'Execute Git version control operations: status, diff, add, commit, push, pull, branch, checkout, stash, blame, cherry-pick, bisect';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const operation = input.operation as GitOperation;
    const args = (input.args as Record<string, unknown>) || {};

    const git = getGit();

    switch (operation) {
      case 'status': {
        const status = await git.getStatus();
        return {
          success: true,
          output: git.formatStatus(status),
          data: status,
        };
      }

      case 'diff':
        return {
          success: true,
          output: await git.getDiff(args.staged as boolean | undefined) || 'No differences',
        };

      case 'add':
        return await git.add(
          (args.files as string[] | undefined) || 'all'
        );

      case 'commit':
        return await git.commit(args.message as string);

      case 'push':
        return await git.push();

      case 'pull':
        return await git.pull();

      case 'branch':
        return await git.branch(
          args.branch as string | undefined,
          args.delete as boolean | undefined
        );

      case 'checkout':
        return await git.checkout(
          args.branch as string,
          args.create as boolean | undefined
        );

      case 'stash':
        if (args.pop) {
          return await git.stashPop();
        }
        return await git.stash(args.message as string | undefined);

      case 'auto_commit':
        return await git.autoCommit({
          message: args.message as string | undefined,
          push: args.push as boolean | undefined,
        });

      case 'blame':
        return await git.blame(
          args.file as string,
          {
            startLine: args.start_line as number | undefined,
            endLine: args.end_line as number | undefined,
          }
        );

      case 'cherry_pick':
        return await git.cherryPick(
          args.commit as string,
          {
            noCommit: args.no_commit as boolean | undefined,
          }
        );

      case 'bisect_start':
        return await git.bisectStart(
          args.bad_ref as string | undefined,
          args.good_ref as string | undefined
        );

      case 'bisect_step':
        return await git.bisectStep(
          args.result as 'good' | 'bad' | 'skip'
        );

      case 'bisect_reset':
        return await git.bisectReset();

      default:
        return {
          success: false,
          error: `Unknown git operation: ${operation}`,
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
          operation: {
            type: 'string',
            description: 'Git operation to perform',
            enum: [...VALID_OPERATIONS],
          },
          args: {
            type: 'object',
            description: 'Operation-specific arguments',
          },
        },
        required: ['operation'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;

    if (typeof data.operation !== 'string' || data.operation.trim() === '') {
      return { valid: false, errors: ['operation must be a non-empty string'] };
    }

    if (!(VALID_OPERATIONS as readonly string[]).includes(data.operation)) {
      return { valid: false, errors: [`Unknown operation: ${data.operation}`] };
    }

    // Validate required args for specific operations
    const args = (data.args as Record<string, unknown>) || {};

    switch (data.operation) {
      case 'commit':
        if (typeof args.message !== 'string' || args.message.trim() === '') {
          return { valid: false, errors: ['commit requires args.message'] };
        }
        break;

      case 'blame':
        if (typeof args.file !== 'string' || args.file.trim() === '') {
          return { valid: false, errors: ['blame requires args.file'] };
        }
        break;

      case 'cherry_pick':
        if (typeof args.commit !== 'string' || args.commit.trim() === '') {
          return { valid: false, errors: ['cherry_pick requires args.commit'] };
        }
        break;

      case 'bisect_step':
        if (!['good', 'bad', 'skip'].includes(args.result as string)) {
          return { valid: false, errors: ['bisect_step requires args.result to be "good", "bad", or "skip"'] };
        }
        break;

      case 'checkout':
        if (typeof args.branch !== 'string' || args.branch.trim() === '') {
          return { valid: false, errors: ['checkout requires args.branch'] };
        }
        break;
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'git' as ToolCategoryType,
      keywords: ['git', 'version-control', 'commit', 'branch', 'diff', 'blame', 'cherry-pick', 'bisect'],
      priority: 7,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: false,
    };
  }

  isAvailable(): boolean {
    return true;
  }

  dispose(): void {
    resetGitInstance();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create all git tool instances
 */
export function createGitTools(): ITool[] {
  return [
    new GitOperationTool(),
  ];
}
