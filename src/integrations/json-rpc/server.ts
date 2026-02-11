/**
 * JSON-RPC Server for code-buddy
 *
 * Standalone server that communicates via stdin/stdout.
 * Can be used by any JSON-RPC client (FileCommander, VS Code, etc.)
 */

import * as readline from 'readline';
import {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  ErrorCodes,
  createResponse,
  createErrorResponse,
  createNotification,
  isRequest,
  InitializeParams,
  InitializeResult,
  AiCompleteParams,
  AiCompleteResult,
  AiChatParams,
  AiChatResult,
  ToolsCallParams,
  ToolsCallResult,
  FcsExecuteParams,
  FcsExecuteResult,
  FcsParseParams,
  FcsParseResult,
  ContextAddParams,
  ContextAddResult,
  ToolDefinition,
  ServerCapabilities,
} from './protocol.js';

// Import code-buddy internals (lazy loaded to reduce startup time)
let codebuddyClient: unknown = null;
let fcsRuntime: unknown = null;

export interface JsonRpcServerOptions {
  /** Enable verbose logging */
  verbose?: boolean;
  /** Custom API key (overrides env) */
  apiKey?: string;
  /** Working directory */
  workdir?: string;
}

export class JsonRpcServer {
  private rl: readline.Interface | null = null;
  private initialized = false;
  private clientName = 'unknown';
  private clientVersion = 'unknown';
  private conversationHistory: Map<string, Array<{ role: string; content: string }>> = new Map();
  private contextFiles: Map<string, { content: string; size: number }> = new Map();
  private options: JsonRpcServerOptions;

  constructor(options: JsonRpcServerOptions = {}) {
    this.options = options;
  }

  /**
   * Start the server and listen for requests on stdin
   */
  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.log('info', 'JSON-RPC server starting...');

    for await (const line of this.rl) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        await this.handleMessage(message);
      } catch (error) {
        this.sendError(
          null,
          ErrorCodes.PARSE_ERROR,
          `Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    this.log('info', 'JSON-RPC server stopped');
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
   * Handle incoming message
   */
  private async handleMessage(message: unknown): Promise<void> {
    if (!isRequest(message)) {
      this.sendError(null, ErrorCodes.INVALID_REQUEST, 'Invalid JSON-RPC request');
      return;
    }

    const request = message as JsonRpcRequest;
    this.log('debug', `Received: ${request.method}`);

    try {
      const result = await this.dispatch(request);
      this.send(createResponse(request.id, result));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendError(request.id, ErrorCodes.INTERNAL_ERROR, errorMessage);
    }
  }

  /**
   * Validate required string field in params
   */
  private requireString(params: Record<string, unknown>, field: string, method: string): string {
    const value = params[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${method}: '${field}' is required and must be a non-empty string`);
    }
    return value;
  }

  /**
   * Cast validated params to a specific type.
   * Only call after requireString/field validation confirms required fields.
   */
  private checkedParams<T>(params: Record<string, unknown>): T {
    return params as T;
  }

  /**
   * Dispatch request to appropriate handler
   */
  private async dispatch(request: JsonRpcRequest): Promise<unknown> {
    const params = (request.params || {}) as Record<string, unknown>;

    // Initialize is always allowed
    if (request.method === 'initialize') {
      this.requireString(params, 'clientName', 'initialize');
      this.requireString(params, 'clientVersion', 'initialize');
      return this.handleInitialize(this.checkedParams<InitializeParams>(params));
    }

    // Shutdown is always allowed
    if (request.method === 'shutdown') {
      return this.handleShutdown();
    }

    // Other methods require initialization
    if (!this.initialized) {
      throw new Error('Server not initialized. Call "initialize" first.');
    }

    switch (request.method) {
      // AI methods
      case 'ai/complete':
        this.requireString(params, 'prompt', 'ai/complete');
        return this.handleAiComplete(this.checkedParams<AiCompleteParams>(params));
      case 'ai/chat':
        this.requireString(params, 'message', 'ai/chat');
        return this.handleAiChat(this.checkedParams<AiChatParams>(params));
      case 'ai/clearHistory':
        return this.handleAiClearHistory(params as { conversationId?: string });

      // Tool methods
      case 'tools/list':
        return this.handleToolsList();
      case 'tools/call':
        this.requireString(params, 'name', 'tools/call');
        if (typeof params.arguments !== 'object' || params.arguments === null || Array.isArray(params.arguments)) {
          throw new Error("tools/call: 'arguments' is required and must be an object");
        }
        return this.handleToolsCall(this.checkedParams<ToolsCallParams>(params));

      // FCS methods
      case 'fcs/execute':
        this.requireString(params, 'script', 'fcs/execute');
        return this.handleFcsExecute(this.checkedParams<FcsExecuteParams>(params));
      case 'fcs/parse':
        this.requireString(params, 'script', 'fcs/parse');
        return this.handleFcsParse(this.checkedParams<FcsParseParams>(params));

      // Context methods
      case 'context/add':
        if (!Array.isArray(params.files)) {
          throw new Error("context/add: 'files' is required and must be an array");
        }
        return this.handleContextAdd(this.checkedParams<ContextAddParams>(params));
      case 'context/list':
        return this.handleContextList();
      case 'context/clear':
        return this.handleContextClear();

      // Git methods
      case 'git/status':
        return this.handleGitStatus();
      case 'git/diff':
        return this.handleGitDiff(params as { staged?: boolean });

      default:
        throw new Error(`Method not found: ${request.method}`);
    }
  }

  // ============================================
  // Method Handlers
  // ============================================

  private async handleInitialize(params: InitializeParams): Promise<InitializeResult> {
    this.clientName = params.clientName;
    this.clientVersion = params.clientVersion;
    this.initialized = true;

    this.log('info', `Client connected: ${this.clientName} v${this.clientVersion}`);

    const capabilities: ServerCapabilities = {
      version: '1.0.0',
      methods: [
        'initialize', 'shutdown',
        'ai/complete', 'ai/chat', 'ai/clearHistory',
        'tools/list', 'tools/call',
        'fcs/execute', 'fcs/parse',
        'context/add', 'context/list', 'context/clear',
        'git/status', 'git/diff',
      ],
      features: {
        ai: true,
        tools: true,
        fcs: true,
        streaming: false, // Not yet implemented
      },
    };

    return {
      serverName: 'code-buddy',
      serverVersion: '1.0.0',
      capabilities,
    };
  }

  private async handleShutdown(): Promise<null> {
    this.log('info', 'Shutdown requested');
    setImmediate(() => this.stop());
    return null;
  }

  private async handleAiComplete(params: AiCompleteParams): Promise<AiCompleteResult> {
    // Lazy load grok client
    if (!codebuddyClient) {
      const { CodeBuddyClient } = await import('../../codebuddy/index.js');
      const apiKey = this.options.apiKey || process.env.GROK_API_KEY || '';
      codebuddyClient = new CodeBuddyClient(apiKey);
    }

    const client = codebuddyClient as { chat: (messages: Array<{ role: string; content: string }>) => Promise<{ choices: Array<{ message: { content: string } }>; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> };

    const systemPrompt = params.context?.language
      ? `You are a code completion assistant for ${params.context.language}. Provide only the code to complete, no explanations.`
      : 'You are a helpful AI assistant.';

    const userPrompt = params.context?.prefix
      ? `Complete this code:\n\`\`\`${params.context.language || ''}\n${params.context.prefix}[CURSOR]${params.context.suffix || ''}\n\`\`\`\n\nProvide only the code to insert at [CURSOR]:`
      : params.prompt;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await client.chat(messages);
    const content = response.choices?.[0]?.message?.content || '';

    return {
      text: content,
      model: params.options?.model || 'grok-2',
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
    };
  }

  private async handleAiChat(params: AiChatParams): Promise<AiChatResult> {
    const conversationId = params.conversationId || `conv_${Date.now()}`;

    // Get or create conversation history
    if (!this.conversationHistory.has(conversationId)) {
      this.conversationHistory.set(conversationId, []);
    }
    const history = this.conversationHistory.get(conversationId)!;

    // Add user message
    history.push({ role: 'user', content: params.message });

    // Lazy load grok client
    if (!codebuddyClient) {
      const { CodeBuddyClient } = await import('../../codebuddy/index.js');
      const apiKey = this.options.apiKey || process.env.GROK_API_KEY || '';
      codebuddyClient = new CodeBuddyClient(apiKey);
    }

    const client = codebuddyClient as { chat: (messages: Array<{ role: string; content: string }>) => Promise<{ choices: Array<{ message: { content: string } }> }> };

    // Build context from files
    let contextPrompt = '';
    if (params.context && params.context.length > 0) {
      contextPrompt = 'Context files:\n';
      for (const file of params.context) {
        const fileData = this.contextFiles.get(file);
        if (fileData) {
          contextPrompt += `\n--- ${file} ---\n${fileData.content}\n`;
        }
      }
      contextPrompt += '\n---\n\n';
    }

    // Call API
    const messages = contextPrompt
      ? [{ role: 'system', content: contextPrompt }, ...history]
      : history;

    const response = await client.chat(messages);
    const content = response.choices?.[0]?.message?.content || '';

    // Add assistant response to history
    history.push({ role: 'assistant', content });

    return {
      response: content,
      conversationId,
      model: 'grok-2',
    };
  }

  private async handleAiClearHistory(params: { conversationId?: string }): Promise<{ cleared: boolean }> {
    if (params.conversationId) {
      this.conversationHistory.delete(params.conversationId);
    } else {
      this.conversationHistory.clear();
    }
    return { cleared: true };
  }

  private async handleToolsList(): Promise<{ tools: ToolDefinition[] }> {
    const tools: ToolDefinition[] = [
      {
        name: 'read_file',
        description: 'Read the contents of a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file' },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Write content to a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'list_directory',
        description: 'List files in a directory',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the directory' },
            pattern: { type: 'string', description: 'Glob pattern to filter' },
          },
          required: ['path'],
        },
      },
      {
        name: 'search_files',
        description: 'Search for files matching a pattern',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Search pattern (regex)' },
            path: { type: 'string', description: 'Directory to search in' },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'execute_command',
        description: 'Execute a shell command',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to execute' },
            cwd: { type: 'string', description: 'Working directory' },
          },
          required: ['command'],
        },
      },
    ];

    return { tools };
  }

  private async handleToolsCall(params: ToolsCallParams): Promise<ToolsCallResult> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      switch (params.name) {
        case 'read_file': {
          const filePath = params.arguments.path as string;
          const content = await fs.readFile(filePath, 'utf-8');
          return { success: true, result: content };
        }

        case 'write_file': {
          const filePath = params.arguments.path as string;
          const content = params.arguments.content as string;
          await fs.writeFile(filePath, content, 'utf-8');
          return { success: true, result: { written: true, path: filePath } };
        }

        case 'list_directory': {
          const dirPath = params.arguments.path as string;
          const entries = await fs.readdir(dirPath, { withFileTypes: true });
          const result = entries.map(e => ({
            name: e.name,
            isDirectory: e.isDirectory(),
            path: path.join(dirPath, e.name),
          }));
          return { success: true, result };
        }

        case 'search_files': {
          const pattern = params.arguments.pattern as string;
          const searchPath = (params.arguments.path as string) || '.';
          const { stdout } = await execAsync(`grep -r -l "${pattern}" "${searchPath}" 2>/dev/null || true`);
          const files = stdout.trim().split('\n').filter(Boolean);
          return { success: true, result: files };
        }

        case 'execute_command': {
          const command = params.arguments.command as string;
          const cwd = (params.arguments.cwd as string) || this.options.workdir || process.cwd();
          const { stdout, stderr } = await execAsync(command, { cwd });
          return { success: true, result: { stdout, stderr } };
        }

        default:
          return { success: false, error: `Unknown tool: ${params.name}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async handleFcsExecute(params: FcsExecuteParams): Promise<FcsExecuteResult> {
    // Lazy load FCS runtime
    if (!fcsRuntime) {
      const { FCSRuntime } = await import('../../scripting/runtime.js');
      fcsRuntime = FCSRuntime;
    }

    const Runtime = fcsRuntime as new (config?: unknown) => {
      execute: (ast: unknown) => Promise<{ success: boolean; output: string[]; returnValue?: unknown; error?: string; duration: number }>;
    };

    const { tokenize } = await import('../../scripting/lexer.js');
    const { parse } = await import('../../scripting/parser.js');

    const startTime = Date.now();

    try {
      const tokens = tokenize(params.script);
      const ast = parse(tokens);
      const runtime = new Runtime({
        workdir: params.config?.workdir || this.options.workdir || process.cwd(),
        timeout: params.config?.timeout || 30000,
        dryRun: params.config?.dryRun || false,
      });

      const result = await runtime.execute(ast);
      return {
        success: result.success,
        output: result.output,
        returnValue: result.returnValue,
        error: result.error,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        output: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      };
    }
  }

  private async handleFcsParse(params: FcsParseParams): Promise<FcsParseResult> {
    const { tokenize } = await import('../../scripting/lexer.js');
    const { parse } = await import('../../scripting/parser.js');

    try {
      const tokens = tokenize(params.script);
      const ast = parse(tokens);
      return { valid: true, ast };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      // Try to extract line/column from error message
      const match = message.match(/line (\d+), column (\d+)/i);
      return {
        valid: false,
        errors: [{
          line: match ? parseInt(match[1]) : 1,
          column: match ? parseInt(match[2]) : 1,
          message,
        }],
      };
    }
  }

  private async handleContextAdd(params: ContextAddParams): Promise<ContextAddResult> {
    const fs = await import('fs/promises');
    const added: string[] = [];
    const failed: Array<{ file: string; reason: string }> = [];
    let totalSize = 0;

    for (const file of params.files) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const size = Buffer.byteLength(content, 'utf-8');
        this.contextFiles.set(file, { content, size });
        added.push(file);
        totalSize += size;
      } catch (error) {
        failed.push({
          file,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return { added, failed, totalSize };
  }

  private async handleContextList(): Promise<{ files: Array<{ path: string; size: number }>; totalSize: number }> {
    const files: Array<{ path: string; size: number }> = [];
    let totalSize = 0;

    for (const [path, data] of this.contextFiles) {
      files.push({ path, size: data.size });
      totalSize += data.size;
    }

    return { files, totalSize };
  }

  private async handleContextClear(): Promise<{ cleared: number }> {
    const count = this.contextFiles.size;
    this.contextFiles.clear();
    return { cleared: count };
  }

  private async handleGitStatus(): Promise<{ status: string; branch: string }> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const cwd = this.options.workdir || process.cwd();

    const { stdout: status } = await execAsync('git status --porcelain', { cwd });
    const { stdout: branch } = await execAsync('git branch --show-current', { cwd });

    return {
      status: status.trim(),
      branch: branch.trim(),
    };
  }

  private async handleGitDiff(params: { staged?: boolean }): Promise<{ diff: string }> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const cwd = this.options.workdir || process.cwd();
    const cmd = params.staged ? 'git diff --staged' : 'git diff';

    const { stdout } = await execAsync(cmd, { cwd });
    return { diff: stdout };
  }

  // ============================================
  // Utility Methods
  // ============================================

  private send(message: JsonRpcResponse | JsonRpcNotification): void {
    // console.log is intentional here - JSON-RPC protocol uses stdout
    console.log(JSON.stringify(message));
  }

  private sendError(id: string | number | null, code: number, message: string, data?: unknown): void {
    this.send(createErrorResponse(id ?? 0, code, message, data));
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    this.send(createNotification(method, params));
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    if (this.options.verbose || level !== 'debug') {
      this.sendNotification('$/log', {
        level,
        message,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

// Export factory function
export function createJsonRpcServer(options?: JsonRpcServerOptions): JsonRpcServer {
  return new JsonRpcServer(options);
}
