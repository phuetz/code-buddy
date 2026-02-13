/**
 * MCP Server - Expose Code Buddy tools via the Model Context Protocol
 *
 * Allows Code Buddy to act as a tool provider for other AI agents
 * (VS Code, Cursor, Claude Desktop, etc.) over stdio transport.
 *
 * Exposed tools:
 * - read_file: Read file contents
 * - write_file: Write/create a file
 * - edit_file: String replacement editing
 * - bash: Execute shell commands
 * - search_files: Search file contents (ripgrep-based)
 * - list_files: List directory contents
 * - git: Git operations (status, diff, log, add, commit, etc.)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs';
import type { ToolResult } from '../types/index.js';

// Read version from package.json (avoid import.meta.url for ts-jest compat)
let packageVersion = '0.1.0';
try {
  const pkgPath = path.resolve(__dirname, '../../package.json');
  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  packageVersion = pkgJson.version || packageVersion;
} catch {
  // Ignore - use default version
}

/**
 * Tool definition metadata for listing purposes.
 */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * CodeBuddyMCPServer - MCP server that exposes Code Buddy tools.
 *
 * Usage:
 *   const server = new CodeBuddyMCPServer();
 *   await server.start();  // Blocks on stdio transport
 *   await server.stop();   // Clean shutdown
 */
export class CodeBuddyMCPServer {
  private mcpServer: McpServer;
  private transport: StdioServerTransport | null = null;
  private running = false;

  // Lazily initialized tool instances
  private textEditor: InstanceType<typeof import('../tools/text-editor.js').TextEditorTool> | null = null;
  private searchTool: InstanceType<typeof import('../tools/search.js').SearchTool> | null = null;
  private gitTool: InstanceType<typeof import('../tools/git-tool.js').GitTool> | null = null;
  private bashTool: InstanceType<typeof import('../tools/bash/index.js').BashTool> | null = null;

  constructor() {
    this.mcpServer = new McpServer(
      {
        name: 'code-buddy',
        version: packageVersion,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.registerTools();
  }

  /**
   * Get the list of tools exposed by this MCP server.
   */
  static getToolDefinitions(): MCPToolDefinition[] {
    return [
      {
        name: 'read_file',
        description: 'Read the contents of a file. Returns the file content with line numbers.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute or relative path to the file to read' },
            start_line: { type: 'number', description: 'Optional start line (1-indexed)' },
            end_line: { type: 'number', description: 'Optional end line (1-indexed)' },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Write content to a file. Creates the file if it does not exist, or overwrites it if it does.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute or relative path to the file to write' },
            content: { type: 'string', description: 'The content to write to the file' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'edit_file',
        description: 'Edit a file by replacing an exact string match with new content. The old_string must match exactly one location in the file.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file to edit' },
            old_string: { type: 'string', description: 'The exact string to find and replace' },
            new_string: { type: 'string', description: 'The replacement string' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
      },
      {
        name: 'bash',
        description: 'Execute a shell command and return its output. Use for running scripts, installing packages, or any terminal operation.',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to execute' },
            timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
          },
          required: ['command'],
        },
      },
      {
        name: 'search_files',
        description: 'Search for text patterns in files using ripgrep. Supports regex patterns and file type filtering.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query (text or regex pattern)' },
            path: { type: 'string', description: 'Directory to search in (defaults to cwd)' },
            include_pattern: { type: 'string', description: 'Glob pattern for files to include (e.g., "*.ts")' },
            case_sensitive: { type: 'boolean', description: 'Whether the search is case-sensitive (default: false)' },
            max_results: { type: 'number', description: 'Maximum number of results to return (default: 50)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'list_files',
        description: 'List files and directories at a given path. Returns names with type indicators (/ for directories).',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path to list (defaults to cwd)' },
          },
          required: [],
        },
      },
      {
        name: 'git',
        description: 'Execute git operations: status, diff, log, add, commit, branch, checkout, etc.',
        inputSchema: {
          type: 'object',
          properties: {
            subcommand: {
              type: 'string',
              description: 'Git subcommand to run',
              enum: ['status', 'diff', 'log', 'add', 'commit', 'branch', 'checkout'],
            },
            args: {
              type: 'object',
              description: 'Arguments for the git subcommand',
              properties: {
                files: { type: 'array', items: { type: 'string' }, description: 'Files for add/diff' },
                message: { type: 'string', description: 'Commit message' },
                staged: { type: 'boolean', description: 'Show staged changes (for diff)' },
                count: { type: 'number', description: 'Number of log entries' },
                branch_name: { type: 'string', description: 'Branch name for branch/checkout' },
              },
            },
          },
          required: ['subcommand'],
        },
      },
    ];
  }

  /**
   * Lazily initialize tool instances on first use.
   */
  private async ensureTools(): Promise<void> {
    if (this.textEditor) return;

    const [
      { TextEditorTool },
      { SearchTool },
      { GitTool },
      { BashTool },
    ] = await Promise.all([
      import('../tools/text-editor.js'),
      import('../tools/search.js'),
      import('../tools/git-tool.js'),
      import('../tools/bash/index.js'),
    ]);

    // Enable auto-approve for MCP server mode (no interactive confirmation)
    const { ConfirmationService } = await import('../utils/confirmation-service.js');
    const confirmService = ConfirmationService.getInstance();
    confirmService.setSessionFlag('allOperations', true);

    this.textEditor = new TextEditorTool();
    this.searchTool = new SearchTool();
    this.gitTool = new GitTool();
    this.bashTool = new BashTool();
  }

  /**
   * Convert a ToolResult to MCP CallToolResult format.
   */
  private formatResult(result: ToolResult): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
    const text = result.success
      ? (result.output || result.content || 'Done')
      : (result.error || 'Unknown error');

    return {
      content: [{ type: 'text' as const, text }],
      isError: !result.success,
    };
  }

  /**
   * Register all Code Buddy tools with the MCP server.
   */
  private registerTools(): void {
    // read_file
    this.mcpServer.tool(
      'read_file',
      'Read the contents of a file. Returns the file content with line numbers.',
      {
        path: z.string().describe('Absolute or relative path to the file to read'),
        start_line: z.number().optional().describe('Optional start line (1-indexed)'),
        end_line: z.number().optional().describe('Optional end line (1-indexed)'),
      },
      async (args) => {
        await this.ensureTools();
        const viewRange = (args.start_line !== undefined && args.end_line !== undefined)
          ? [args.start_line, args.end_line] as [number, number]
          : undefined;
        const result = await this.textEditor!.view(args.path, viewRange);
        return this.formatResult(result);
      }
    );

    // write_file
    this.mcpServer.tool(
      'write_file',
      'Write content to a file. Creates the file if it does not exist, or overwrites it.',
      {
        path: z.string().describe('Absolute or relative path to the file to write'),
        content: z.string().describe('The content to write to the file'),
      },
      async (args) => {
        await this.ensureTools();
        const result = await this.textEditor!.create(args.path, args.content);
        return this.formatResult(result);
      }
    );

    // edit_file
    this.mcpServer.tool(
      'edit_file',
      'Edit a file by replacing an exact string match with new content.',
      {
        path: z.string().describe('Path to the file to edit'),
        old_string: z.string().describe('The exact string to find and replace'),
        new_string: z.string().describe('The replacement string'),
      },
      async (args) => {
        await this.ensureTools();
        const result = await this.textEditor!.strReplace(args.path, args.old_string, args.new_string);
        return this.formatResult(result);
      }
    );

    // bash
    this.mcpServer.tool(
      'bash',
      'Execute a shell command and return its output.',
      {
        command: z.string().describe('The shell command to execute'),
        timeout: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
      },
      async (args) => {
        await this.ensureTools();
        const result = await this.bashTool!.execute(args.command, args.timeout ?? 30000);
        return this.formatResult(result);
      }
    );

    // search_files
    this.mcpServer.tool(
      'search_files',
      'Search for text patterns in files using ripgrep.',
      {
        query: z.string().describe('The search query (text or regex pattern)'),
        path: z.string().optional().describe('Directory to search in (defaults to cwd)'),
        include_pattern: z.string().optional().describe('Glob pattern for files to include (e.g., "*.ts")'),
        case_sensitive: z.boolean().optional().describe('Whether the search is case-sensitive (default: false)'),
        max_results: z.number().optional().describe('Maximum number of results to return (default: 50)'),
      },
      async (args) => {
        await this.ensureTools();
        const result = await this.searchTool!.search(args.query, {
          searchType: 'text',
          includePattern: args.include_pattern,
          caseSensitive: args.case_sensitive ?? false,
          maxResults: args.max_results ?? 50,
        });
        return this.formatResult(result);
      }
    );

    // list_files
    this.mcpServer.tool(
      'list_files',
      'List files and directories at a given path.',
      {
        path: z.string().optional().describe('Directory path to list (defaults to cwd)'),
      },
      async (args) => {
        await this.ensureTools();
        const targetPath = args.path || process.cwd();
        const result = await this.textEditor!.view(targetPath);
        return this.formatResult(result);
      }
    );

    // git
    this.mcpServer.tool(
      'git',
      'Execute git operations: status, diff, log, add, commit, branch, checkout.',
      {
        subcommand: z.enum(['status', 'diff', 'log', 'add', 'commit', 'branch', 'checkout'])
          .describe('Git subcommand to run'),
        args: z.object({
          files: z.array(z.string()).optional().describe('Files for add/diff'),
          message: z.string().optional().describe('Commit message'),
          staged: z.boolean().optional().describe('Show staged changes (for diff)'),
          count: z.number().optional().describe('Number of log entries'),
          branch_name: z.string().optional().describe('Branch name for branch/checkout'),
        }).optional().describe('Arguments for the git subcommand'),
      },
      async (args) => {
        await this.ensureTools();
        const git = this.gitTool!;
        const subArgs = args.args || {};

        try {
          switch (args.subcommand) {
            case 'status': {
              const status = await git.getStatus();
              const lines: string[] = [
                `Branch: ${status.branch}`,
                `Ahead: ${status.ahead}, Behind: ${status.behind}`,
              ];
              if (status.staged.length > 0) lines.push(`Staged:\n  ${status.staged.join('\n  ')}`);
              if (status.unstaged.length > 0) lines.push(`Unstaged:\n  ${status.unstaged.join('\n  ')}`);
              if (status.untracked.length > 0) lines.push(`Untracked:\n  ${status.untracked.join('\n  ')}`);
              return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
            }

            case 'diff': {
              const diff = await git.getDiff(subArgs.staged ?? false);
              return { content: [{ type: 'text' as const, text: diff || 'No changes' }] };
            }

            case 'log': {
              const log = await git.getLog(subArgs.count ?? 10);
              return { content: [{ type: 'text' as const, text: log || 'No commits' }] };
            }

            case 'add': {
              const files = subArgs.files;
              const result = await git.add(files && files.length > 0 ? files : 'all');
              return this.formatResult(result);
            }

            case 'commit': {
              if (!subArgs.message) {
                return { content: [{ type: 'text' as const, text: 'Error: commit message is required' }], isError: true };
              }
              const result = await git.commit(subArgs.message);
              return this.formatResult(result);
            }

            case 'branch': {
              // List branches or create one
              const result = await git.branch(subArgs.branch_name);
              return this.formatResult(result);
            }

            case 'checkout': {
              if (!subArgs.branch_name) {
                return { content: [{ type: 'text' as const, text: 'Error: branch_name is required for checkout' }], isError: true };
              }
              const result = await git.checkout(subArgs.branch_name);
              return this.formatResult(result);
            }

            default:
              return { content: [{ type: 'text' as const, text: `Unknown git subcommand: ${args.subcommand}` }], isError: true };
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return { content: [{ type: 'text' as const, text: `Git error: ${message}` }], isError: true };
        }
      }
    );
  }

  /**
   * Start the MCP server over stdio transport.
   * This method blocks until the transport is closed.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('MCP server is already running');
    }

    this.transport = new StdioServerTransport();
    await this.mcpServer.connect(this.transport);
    this.running = true;
  }

  /**
   * Stop the MCP server and close the transport.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    await this.mcpServer.close();
    this.transport = null;
    this.running = false;
  }

  /**
   * Whether the server is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }
}
