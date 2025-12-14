/**
 * MCP (Model Context Protocol) Server for code-buddy
 *
 * Implements the MCP specification for tool and resource sharing.
 * Allows any MCP client (Claude Desktop, FileCommander, etc.) to use code-buddy capabilities.
 *
 * @see https://modelcontextprotocol.io/
 */

import * as readline from 'readline';

// ============================================
// MCP Protocol Types
// ============================================

interface McpRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface McpNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

// ============================================
// MCP Server Implementation
// ============================================

export interface McpServerOptions {
  name?: string;
  version?: string;
  verbose?: boolean;
  workdir?: string;
}

export class McpServer {
  private rl: readline.Interface | null = null;
  private initialized = false;
  private options: McpServerOptions;

  // Tool handlers
  private tools: Map<string, {
    definition: McpTool;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
  }> = new Map();

  // Resources
  private resources: Map<string, {
    definition: McpResource;
    handler: () => Promise<string>;
  }> = new Map();

  // Prompts
  private prompts: Map<string, {
    definition: McpPrompt;
    handler: (args: Record<string, unknown>) => Promise<{ messages: Array<{ role: string; content: { type: string; text: string } }> }>;
  }> = new Map();

  constructor(options: McpServerOptions = {}) {
    this.options = {
      name: options.name || 'code-buddy-mcp',
      version: options.version || '1.0.0',
      verbose: options.verbose || false,
      workdir: options.workdir || process.cwd(),
    };

    this.registerBuiltInTools();
    this.registerBuiltInResources();
    this.registerBuiltInPrompts();
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.log('MCP Server starting...');

    for await (const line of this.rl) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        await this.handleMessage(message);
      } catch (error) {
        this.sendError(
          null,
          -32700,
          `Parse error: ${error instanceof Error ? error.message : 'Unknown'}`
        );
      }
    }
  }

  /**
   * Stop the server
   */
  stop(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  /**
   * Register a custom tool
   */
  registerTool(
    name: string,
    description: string,
    inputSchema: McpTool['inputSchema'],
    handler: (args: Record<string, unknown>) => Promise<unknown>
  ): void {
    this.tools.set(name, {
      definition: { name, description, inputSchema },
      handler,
    });
  }

  /**
   * Register a custom resource
   */
  registerResource(
    uri: string,
    name: string,
    handler: () => Promise<string>,
    options?: { description?: string; mimeType?: string }
  ): void {
    this.resources.set(uri, {
      definition: { uri, name, ...options },
      handler,
    });
  }

  // ============================================
  // Message Handling
  // ============================================

  private async handleMessage(message: McpRequest): Promise<void> {
    if (typeof message !== 'object' || message.jsonrpc !== '2.0') {
      this.sendError(null, -32600, 'Invalid Request');
      return;
    }

    this.log(`Received: ${message.method}`);

    try {
      const result = await this.dispatch(message);
      this.send({ jsonrpc: '2.0', id: message.id, result });
    } catch (error) {
      this.sendError(
        message.id,
        -32603,
        error instanceof Error ? error.message : 'Internal error'
      );
    }
  }

  private async dispatch(request: McpRequest): Promise<unknown> {
    switch (request.method) {
      // Lifecycle
      case 'initialize':
        return this.handleInitialize(request.params);
      case 'initialized':
        return this.handleInitialized();
      case 'shutdown':
        return this.handleShutdown();

      // Tools
      case 'tools/list':
        return this.handleToolsList();
      case 'tools/call':
        return this.handleToolsCall(request.params as { name: string; arguments?: Record<string, unknown> });

      // Resources
      case 'resources/list':
        return this.handleResourcesList();
      case 'resources/read':
        return this.handleResourcesRead(request.params as { uri: string });

      // Prompts
      case 'prompts/list':
        return this.handlePromptsList();
      case 'prompts/get':
        return this.handlePromptsGet(request.params as { name: string; arguments?: Record<string, unknown> });

      // Completion (optional)
      case 'completion/complete':
        return this.handleCompletion(request.params);

      default:
        throw new Error(`Method not found: ${request.method}`);
    }
  }

  // ============================================
  // Lifecycle Handlers
  // ============================================

  private async handleInitialize(_params: unknown): Promise<unknown> {
    this.initialized = true;

    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: false, listChanged: true },
        prompts: { listChanged: true },
      },
      serverInfo: {
        name: this.options.name,
        version: this.options.version,
      },
    };
  }

  private async handleInitialized(): Promise<null> {
    this.log('Client initialized');
    return null;
  }

  private async handleShutdown(): Promise<null> {
    this.log('Shutdown requested');
    setImmediate(() => this.stop());
    return null;
  }

  // ============================================
  // Tools Handlers
  // ============================================

  private async handleToolsList(): Promise<{ tools: McpTool[] }> {
    const tools = Array.from(this.tools.values()).map(t => t.definition);
    return { tools };
  }

  private async handleToolsCall(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown> {
    const tool = this.tools.get(params.name);
    if (!tool) {
      throw new Error(`Tool not found: ${params.name}`);
    }

    try {
      const result = await tool.handler(params.arguments || {});
      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  }

  // ============================================
  // Resources Handlers
  // ============================================

  private async handleResourcesList(): Promise<{ resources: McpResource[] }> {
    const resources = Array.from(this.resources.values()).map(r => r.definition);
    return { resources };
  }

  private async handleResourcesRead(params: { uri: string }): Promise<unknown> {
    const resource = this.resources.get(params.uri);
    if (!resource) {
      throw new Error(`Resource not found: ${params.uri}`);
    }

    const content = await resource.handler();
    return {
      contents: [
        {
          uri: params.uri,
          mimeType: resource.definition.mimeType || 'text/plain',
          text: content,
        },
      ],
    };
  }

  // ============================================
  // Prompts Handlers
  // ============================================

  private async handlePromptsList(): Promise<{ prompts: McpPrompt[] }> {
    const prompts = Array.from(this.prompts.values()).map(p => p.definition);
    return { prompts };
  }

  private async handlePromptsGet(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown> {
    const prompt = this.prompts.get(params.name);
    if (!prompt) {
      throw new Error(`Prompt not found: ${params.name}`);
    }

    return prompt.handler(params.arguments || {});
  }

  // ============================================
  // Completion Handler
  // ============================================

  private async handleCompletion(_params: unknown): Promise<unknown> {
    // Basic completion support
    return { completion: { values: [] } };
  }

  // ============================================
  // Built-in Tools Registration
  // ============================================

  private registerBuiltInTools(): void {
    // AI Ask Tool
    this.registerTool(
      'grok_ask',
      'Ask Grok AI a question and get a response',
      {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The question or prompt for the AI' },
          context: { type: 'string', description: 'Optional context to include' },
        },
        required: ['prompt'],
      },
      async (args) => {
        const { GrokClient } = await import('../../grok/index.js');
        const apiKey = process.env.GROK_API_KEY || '';
        const client = new GrokClient(apiKey);

        const userPrompt = args.context
          ? `Context:\n${args.context}\n\nQuestion: ${args.prompt}`
          : args.prompt as string;

        const messages = [{ role: 'user' as const, content: userPrompt }];
        const response = await client.chat(messages);
        return response.choices?.[0]?.message?.content || '';
      }
    );

    // Code Completion Tool
    this.registerTool(
      'grok_complete_code',
      'Get AI code completion suggestions',
      {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'The code to complete' },
          language: { type: 'string', description: 'Programming language' },
          instruction: { type: 'string', description: 'What to complete or add' },
        },
        required: ['code', 'language'],
      },
      async (args) => {
        const { GrokClient } = await import('../../grok/index.js');
        const apiKey = process.env.GROK_API_KEY || '';
        const client = new GrokClient(apiKey);

        const prompt = `Complete or modify this ${args.language} code${args.instruction ? ` (${args.instruction})` : ''}:

\`\`\`${args.language}
${args.code}
\`\`\`

Provide only the completed code, no explanations.`;

        const messages = [{ role: 'user' as const, content: prompt }];
        const response = await client.chat(messages);
        return response.choices?.[0]?.message?.content || '';
      }
    );

    // FCS Execute Tool
    this.registerTool(
      'fcs_execute',
      'Execute FCS (FileCommander Script) code',
      {
        type: 'object',
        properties: {
          script: { type: 'string', description: 'FCS script to execute' },
          dryRun: { type: 'boolean', description: 'Run without making changes' },
        },
        required: ['script'],
      },
      async (args) => {
        const { executeFCS } = await import('../../fcs/index.js');
        const result = await executeFCS(args.script as string, {
          workdir: this.options.workdir,
          dryRun: args.dryRun as boolean || false,
        });
        return {
          success: result.success,
          output: result.output,
          error: result.error,
        };
      }
    );

    // File Read Tool
    this.registerTool(
      'read_file',
      'Read the contents of a file',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file' },
        },
        required: ['path'],
      },
      async (args) => {
        const fs = await import('fs/promises');
        const content = await fs.readFile(args.path as string, 'utf-8');
        return content;
      }
    );

    // File Write Tool
    this.registerTool(
      'write_file',
      'Write content to a file',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
      async (args) => {
        const fs = await import('fs/promises');
        await fs.writeFile(args.path as string, args.content as string, 'utf-8');
        return { success: true, path: args.path };
      }
    );

    // Directory List Tool
    this.registerTool(
      'list_directory',
      'List files and directories in a path',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path' },
          recursive: { type: 'boolean', description: 'List recursively' },
        },
        required: ['path'],
      },
      async (args) => {
        const fs = await import('fs/promises');
        const path = await import('path');

        async function listDir(dir: string, recursive: boolean): Promise<string[]> {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const results: string[] = [];

          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            results.push(fullPath);

            if (recursive && entry.isDirectory()) {
              const subResults = await listDir(fullPath, true);
              results.push(...subResults);
            }
          }

          return results;
        }

        return listDir(args.path as string, args.recursive as boolean || false);
      }
    );

    // Search Tool
    this.registerTool(
      'search_content',
      'Search for text in files',
      {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (regex)' },
          path: { type: 'string', description: 'Directory to search' },
          filePattern: { type: 'string', description: 'File glob pattern' },
        },
        required: ['pattern'],
      },
      async (args) => {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        const searchPath = (args.path as string) || this.options.workdir || '.';
        const includeFlag = args.filePattern ? `--include="${args.filePattern}"` : '';

        try {
          const { stdout } = await execAsync(
            `grep -r -n ${includeFlag} "${args.pattern}" "${searchPath}" 2>/dev/null | head -100`
          );
          return stdout.trim().split('\n').filter(Boolean);
        } catch {
          return [];
        }
      }
    );

    // Git Status Tool
    this.registerTool(
      'git_status',
      'Get git repository status',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Repository path' },
        },
      },
      async (args) => {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        const cwd = (args.path as string) || this.options.workdir || process.cwd();

        const { stdout: status } = await execAsync('git status --porcelain', { cwd });
        const { stdout: branch } = await execAsync('git branch --show-current', { cwd });

        return {
          branch: branch.trim(),
          changes: status.trim().split('\n').filter(Boolean).map(line => ({
            status: line.substring(0, 2).trim(),
            file: line.substring(3),
          })),
        };
      }
    );

    // Shell Execute Tool
    this.registerTool(
      'execute_shell',
      'Execute a shell command',
      {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute' },
          cwd: { type: 'string', description: 'Working directory' },
          timeout: { type: 'number', description: 'Timeout in milliseconds' },
        },
        required: ['command'],
      },
      async (args) => {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        const { stdout, stderr } = await execAsync(args.command as string, {
          cwd: (args.cwd as string) || this.options.workdir || process.cwd(),
          timeout: (args.timeout as number) || 30000,
        });

        return { stdout, stderr };
      }
    );
  }

  // ============================================
  // Built-in Resources Registration
  // ============================================

  private registerBuiltInResources(): void {
    // Current working directory info
    this.registerResource(
      'grok://cwd',
      'Current Working Directory',
      async () => {
        const cwd = this.options.workdir || process.cwd();
        const fs = await import('fs/promises');
        const entries = await fs.readdir(cwd, { withFileTypes: true });

        return JSON.stringify({
          path: cwd,
          files: entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file',
          })),
        }, null, 2);
      },
      { description: 'Information about the current working directory', mimeType: 'application/json' }
    );

    // Git info resource
    this.registerResource(
      'grok://git',
      'Git Repository Information',
      async () => {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const cwd = this.options.workdir || process.cwd();

        try {
          const { stdout: branch } = await execAsync('git branch --show-current', { cwd });
          const { stdout: status } = await execAsync('git status --porcelain', { cwd });
          const { stdout: log } = await execAsync('git log -5 --oneline', { cwd });

          return JSON.stringify({
            branch: branch.trim(),
            changes: status.trim().split('\n').filter(Boolean).length,
            recentCommits: log.trim().split('\n'),
          }, null, 2);
        } catch {
          return JSON.stringify({ error: 'Not a git repository' });
        }
      },
      { description: 'Current git repository status', mimeType: 'application/json' }
    );

    // System info resource
    this.registerResource(
      'grok://system',
      'System Information',
      async () => {
        const os = await import('os');
        return JSON.stringify({
          platform: os.platform(),
          arch: os.arch(),
          hostname: os.hostname(),
          cpus: os.cpus().length,
          memory: {
            total: os.totalmem(),
            free: os.freemem(),
          },
          uptime: os.uptime(),
        }, null, 2);
      },
      { description: 'System information', mimeType: 'application/json' }
    );
  }

  // ============================================
  // Built-in Prompts Registration
  // ============================================

  private registerBuiltInPrompts(): void {
    // Code review prompt
    this.prompts.set('code_review', {
      definition: {
        name: 'code_review',
        description: 'Generate a code review for the given code',
        arguments: [
          { name: 'code', description: 'The code to review', required: true },
          { name: 'language', description: 'Programming language' },
        ],
      },
      handler: async (args) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please review this ${args.language || ''} code and provide feedback on:
1. Code quality and best practices
2. Potential bugs or issues
3. Performance considerations
4. Security concerns
5. Suggestions for improvement

\`\`\`${args.language || ''}
${args.code}
\`\`\``,
            },
          },
        ],
      }),
    });

    // Explain code prompt
    this.prompts.set('explain_code', {
      definition: {
        name: 'explain_code',
        description: 'Explain what the given code does',
        arguments: [
          { name: 'code', description: 'The code to explain', required: true },
          { name: 'language', description: 'Programming language' },
        ],
      },
      handler: async (args) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please explain what this ${args.language || ''} code does, step by step:

\`\`\`${args.language || ''}
${args.code}
\`\`\``,
            },
          },
        ],
      }),
    });

    // Generate tests prompt
    this.prompts.set('generate_tests', {
      definition: {
        name: 'generate_tests',
        description: 'Generate unit tests for the given code',
        arguments: [
          { name: 'code', description: 'The code to test', required: true },
          { name: 'language', description: 'Programming language' },
          { name: 'framework', description: 'Testing framework to use' },
        ],
      },
      handler: async (args) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Generate comprehensive unit tests for this ${args.language || ''} code${args.framework ? ` using ${args.framework}` : ''}:

\`\`\`${args.language || ''}
${args.code}
\`\`\`

Include tests for:
1. Normal use cases
2. Edge cases
3. Error handling`,
            },
          },
        ],
      }),
    });

    // FCS script prompt
    this.prompts.set('fcs_script', {
      definition: {
        name: 'fcs_script',
        description: 'Generate an FCS script for a task',
        arguments: [
          { name: 'task', description: 'Description of the task', required: true },
        ],
      },
      handler: async (args) => ({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Generate an FCS (FileCommander Script) script to: ${args.task}

FCS is a scripting language with these built-in namespaces:
- grok: AI operations (ask, chat, generate)
- tool: File operations (read, write, edit, glob, grep)
- context: Context management (add, remove, clear)
- git: Git operations (status, diff, commit)
- agent: Agent tasks (run, parallel)

Example syntax:
\`\`\`fcs
let files = tool.glob("**/*.ts")
for f in files {
  let content = tool.read(f)
  let review = grok.ask("Review this code: " + content)
  print(review)
}
\`\`\``,
            },
          },
        ],
      }),
    });
  }

  // ============================================
  // Utility Methods
  // ============================================

  private send(message: McpResponse | McpNotification): void {
    console.log(JSON.stringify(message));
  }

  private sendError(id: string | number | null, code: number, message: string, data?: unknown): void {
    this.send({
      jsonrpc: '2.0',
      id: id ?? 0,
      error: { code, message, data },
    });
  }

  private log(message: string): void {
    if (this.options.verbose) {
      console.error(`[MCP] ${message}`);
    }
  }
}

// Factory function
export function createMcpServer(options?: McpServerOptions): McpServer {
  return new McpServer(options);
}
