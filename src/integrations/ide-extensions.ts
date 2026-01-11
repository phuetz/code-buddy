/**
 * IDE Extensions Infrastructure
 *
 * Provides integration with popular IDEs:
 * - VS Code Extension Protocol
 * - JetBrains IDE Plugin Protocol
 * - Neovim integration
 * - Sublime Text integration
 *
 * Enables AI-powered features directly in editors:
 * - Inline code suggestions
 * - Code explanations
 * - Refactoring assistance
 * - Error diagnostics
 */

import { EventEmitter } from 'events';
import * as net from 'net';

// ============================================================================
// Types
// ============================================================================

export type IDEType = 'vscode' | 'jetbrains' | 'neovim' | 'sublime' | 'unknown';

export interface IDEConnection {
  id: string;
  type: IDEType;
  name: string;
  version?: string;
  socket?: net.Socket;
  connected: boolean;
  lastActivity: number;
}

export interface IDERequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface IDEResponse {
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface CompletionRequest {
  file: string;
  line: number;
  column: number;
  prefix: string;
  context?: string;
  language?: string;
}

export interface CompletionItem {
  label: string;
  kind: 'text' | 'function' | 'class' | 'variable' | 'snippet';
  detail?: string;
  documentation?: string;
  insertText: string;
  sortText?: string;
}

export interface DiagnosticRequest {
  file: string;
  content: string;
  language?: string;
}

export interface Diagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source: string;
  code?: string;
}

export interface HoverRequest {
  file: string;
  line: number;
  column: number;
  content?: string;
}

export interface HoverResult {
  contents: string;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface CodeActionRequest {
  file: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  context: {
    diagnostics: Diagnostic[];
    only?: string[];
  };
}

export interface CodeAction {
  title: string;
  kind: 'quickfix' | 'refactor' | 'source';
  diagnostics?: Diagnostic[];
  edit?: {
    changes: Record<string, Array<{
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      newText: string;
    }>>;
  };
  command?: {
    command: string;
    title: string;
    arguments?: unknown[];
  };
}

export interface IDEExtensionsConfig {
  /** Server port */
  port: number;
  /** Host to bind to */
  host: string;
  /** Enable VS Code integration */
  vscodeEnabled: boolean;
  /** Enable JetBrains integration */
  jetbrainsEnabled: boolean;
  /** Enable Neovim integration */
  neovimEnabled: boolean;
  /** Enable Sublime integration */
  sublimeEnabled: boolean;
  /** Socket path for Unix domain socket */
  socketPath?: string;
  /** Auto-start server */
  autoStart: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: IDEExtensionsConfig = {
  port: 9742,
  host: '127.0.0.1',
  vscodeEnabled: true,
  jetbrainsEnabled: true,
  neovimEnabled: true,
  sublimeEnabled: true,
  autoStart: false,
};

// ============================================================================
// IDE Extensions Server
// ============================================================================

export class IDEExtensionsServer extends EventEmitter {
  private config: IDEExtensionsConfig;
  private server: net.Server | null = null;
  private connections: Map<string, IDEConnection> = new Map();
  private handlers: Map<string, (request: IDERequest, connection: IDEConnection) => Promise<unknown>> = new Map();
  private running = false;

  constructor(config: Partial<IDEExtensionsConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registerDefaultHandlers();
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    if (this.running) return;

    await new Promise<void>((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleConnection(socket));

      this.server.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        this.running = true;
        this.emit('started', { port: this.config.port, host: this.config.host });
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (!this.running || !this.server) return;

    // Close all connections
    for (const [id, conn] of this.connections) {
      if (conn.socket) {
        conn.socket.destroy();
      }
      this.connections.delete(id);
    }

    // Close server
    await new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.running = false;
        this.emit('stopped');
        resolve();
      });
    });

    this.server = null;
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get connected clients
   */
  getConnections(): IDEConnection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Send notification to all connected clients
   */
  broadcast(method: string, params: unknown): void {
    const message = JSON.stringify({ method, params });

    for (const conn of this.connections.values()) {
      if (conn.socket && conn.connected) {
        conn.socket.write(message + '\n');
      }
    }
  }

  /**
   * Send notification to specific client
   */
  notify(connectionId: string, method: string, params: unknown): void {
    const conn = this.connections.get(connectionId);
    if (conn?.socket && conn.connected) {
      const message = JSON.stringify({ method, params });
      conn.socket.write(message + '\n');
    }
  }

  /**
   * Register request handler
   */
  registerHandler(method: string, handler: (request: IDERequest, connection: IDEConnection) => Promise<unknown>): void {
    this.handlers.set(method, handler);
  }

  /**
   * Generate VS Code extension manifest
   */
  generateVSCodeExtension(): {
    packageJson: string;
    extensionTs: string;
  } {
    const packageJson = {
      name: 'grok-vscode',
      displayName: 'CodeBuddy AI Assistant',
      description: 'AI-powered coding assistant powered by Grok',
      version: '1.0.0',
      publisher: 'code-buddy',
      engines: { vscode: '^1.85.0' },
      categories: ['Machine Learning', 'Programming Languages', 'Snippets'],
      activationEvents: ['onStartupFinished'],
      main: './out/extension.js',
      contributes: {
        commands: [
          {
            command: 'codebuddy.askQuestion',
            title: 'Code Buddy: Ask AI',
          },
          {
            command: 'codebuddy.explainCode',
            title: 'Code Buddy: Explain Code',
          },
          {
            command: 'codebuddy.suggestFix',
            title: 'Code Buddy: Suggest Fix',
          },
          {
            command: 'codebuddy.refactor',
            title: 'Code Buddy: Refactor Selection',
          },
        ],
        keybindings: [
          {
            command: 'codebuddy.askQuestion',
            key: 'ctrl+shift+g',
            mac: 'cmd+shift+g',
          },
        ],
        configuration: {
          title: 'Code Buddy',
          properties: {
            'codebuddy.serverPort': {
              type: 'number',
              default: this.config.port,
              description: 'Code Buddy server port',
            },
            'codebuddy.autoConnect': {
              type: 'boolean',
              default: true,
              description: 'Auto-connect to Code Buddy server',
            },
          },
        },
      },
    };

    const extensionTs = `
import * as vscode from 'vscode';
import * as net from 'net';

let client: net.Socket | null = null;
let requestId = 0;
const pendingRequests = new Map<string, { resolve: Function; reject: Function }>();

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('codebuddy');
  const port = config.get<number>('serverPort', ${this.config.port});

  if (config.get<boolean>('autoConnect', true)) {
    connectToServer(port);
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('codebuddy.askQuestion', askQuestion),
    vscode.commands.registerCommand('codebuddy.explainCode', explainCode),
    vscode.commands.registerCommand('codebuddy.suggestFix', suggestFix),
    vscode.commands.registerCommand('codebuddy.refactor', refactorSelection),
  );

  // Provide completions
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('*', {
      async provideCompletionItems(document, position) {
        if (!client) return [];

        const result = await sendRequest('completion', {
          file: document.uri.fsPath,
          line: position.line,
          column: position.character,
          prefix: document.lineAt(position).text.substring(0, position.character),
          language: document.languageId,
        });

        return result?.items?.map((item: any) => {
          const completion = new vscode.CompletionItem(item.label);
          completion.detail = item.detail;
          completion.documentation = item.documentation;
          completion.insertText = item.insertText;
          return completion;
        }) || [];
      },
    }, '.')
  );
}

function connectToServer(port: number) {
  client = new net.Socket();

  client.connect(port, '127.0.0.1', () => {
    sendRequest('initialize', {
      ide: 'vscode',
      version: vscode.version,
    });
  });

  let buffer = '';
  client.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (message.id && pendingRequests.has(message.id)) {
          const { resolve, reject } = pendingRequests.get(message.id)!;
          pendingRequests.delete(message.id);
          if (message.error) {
            reject(new Error(message.error.message));
          } else {
            resolve(message.result);
          }
        }
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    }
  });

  client.on('error', (err) => {
    vscode.window.showWarningMessage('Code Buddy: Connection error - ' + err.message);
    client = null;
  });

  client.on('close', () => {
    client = null;
  });
}

function sendRequest(method: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!client) {
      reject(new Error('Not connected'));
      return;
    }

    const id = String(++requestId);
    pendingRequests.set(id, { resolve, reject });

    const message = JSON.stringify({ id, method, params });
    client.write(message + '\\n');

    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }
    }, 30000);
  });
}

async function askQuestion() {
  const input = await vscode.window.showInputBox({
    prompt: 'Ask CodeBuddy AI',
    placeHolder: 'Type your question...',
  });

  if (!input) return;

  try {
    const result = await sendRequest('ask', { question: input });
    const panel = vscode.window.createWebviewPanel(
      'codebuddyResponse',
      'Code Buddy Response',
      vscode.ViewColumn.Beside,
      {}
    );
    panel.webview.html = '<pre>' + result.answer + '</pre>';
  } catch (err) {
    vscode.window.showErrorMessage('Code Buddy: ' + (err instanceof Error ? err.message : String(err)));
  }
}

async function explainCode() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const selection = editor.selection;
  const code = editor.document.getText(selection);

  if (!code) {
    vscode.window.showInformationMessage('Select some code to explain');
    return;
  }

  try {
    const result = await sendRequest('explain', {
      code,
      language: editor.document.languageId,
    });

    vscode.window.showInformationMessage(result.explanation, { modal: true });
  } catch (err) {
    vscode.window.showErrorMessage('Code Buddy: ' + (err instanceof Error ? err.message : String(err)));
  }
}

async function suggestFix() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
  const selection = editor.selection;

  const relevantDiagnostics = diagnostics.filter(d =>
    d.range.contains(selection) || selection.contains(d.range)
  );

  if (relevantDiagnostics.length === 0) {
    vscode.window.showInformationMessage('No issues found at cursor position');
    return;
  }

  try {
    const result = await sendRequest('suggestFix', {
      file: editor.document.uri.fsPath,
      diagnostics: relevantDiagnostics.map(d => ({
        message: d.message,
        severity: d.severity,
        range: d.range,
      })),
      context: editor.document.getText(),
    });

    if (result.fix) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(editor.document.uri, result.range, result.fix);
      await vscode.workspace.applyEdit(edit);
    }
  } catch (err) {
    vscode.window.showErrorMessage('Code Buddy: ' + (err instanceof Error ? err.message : String(err)));
  }
}

async function refactorSelection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const selection = editor.selection;
  const code = editor.document.getText(selection);

  if (!code) {
    vscode.window.showInformationMessage('Select some code to refactor');
    return;
  }

  const instruction = await vscode.window.showInputBox({
    prompt: 'How should this code be refactored?',
    placeHolder: 'e.g., extract to function, add error handling...',
  });

  if (!instruction) return;

  try {
    const result = await sendRequest('refactor', {
      code,
      instruction,
      language: editor.document.languageId,
    });

    if (result.refactored) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(editor.document.uri, selection, result.refactored);
      await vscode.workspace.applyEdit(edit);
    }
  } catch (err) {
    vscode.window.showErrorMessage('Code Buddy: ' + (err instanceof Error ? err.message : String(err)));
  }
}

export function deactivate() {
  if (client) {
    client.destroy();
    client = null;
  }
}
`;

    return {
      packageJson: JSON.stringify(packageJson, null, 2),
      extensionTs: extensionTs.trim(),
    };
  }

  /**
   * Generate Neovim plugin
   */
  generateNeovimPlugin(): string {
    return `
-- CodeBuddy AI integration for Neovim
-- Add to your init.lua or lazy.nvim config

local M = {}

M.config = {
  port = ${this.config.port},
  host = '127.0.0.1',
  auto_connect = true,
}

local client = nil
local request_id = 0
local pending_requests = {}

-- Connect to Grok server
function M.connect()
  local uv = vim.loop
  client = uv.new_tcp()

  client:connect(M.config.host, M.config.port, function(err)
    if err then
      vim.schedule(function()
        vim.notify('Code Buddy: Connection failed - ' .. err, vim.log.levels.WARN)
      end)
      return
    end

    -- Send initialization
    M.send_request('initialize', {
      ide = 'neovim',
      version = vim.version().major .. '.' .. vim.version().minor,
    })

    -- Start reading
    client:read_start(function(err, data)
      if err then
        vim.schedule(function()
          vim.notify('Code Buddy: Read error - ' .. err, vim.log.levels.ERROR)
        end)
        return
      end

      if data then
        vim.schedule(function()
          M.handle_response(data)
        end)
      end
    end)
  end)
end

-- Send request to server
function M.send_request(method, params, callback)
  if not client then
    if callback then callback(nil, 'Not connected') end
    return
  end

  request_id = request_id + 1
  local id = tostring(request_id)

  if callback then
    pending_requests[id] = callback
  end

  local message = vim.json.encode({
    id = id,
    method = method,
    params = params,
  }) .. '\\n'

  client:write(message)
end

-- Handle server response
function M.handle_response(data)
  for line in data:gmatch('[^\\n]+') do
    local ok, response = pcall(vim.json.decode, line)
    if ok and response.id then
      local callback = pending_requests[response.id]
      pending_requests[response.id] = nil

      if callback then
        if response.error then
          callback(nil, response.error.message)
        else
          callback(response.result, nil)
        end
      end
    end
  end
end

-- Ask AI a question
function M.ask(question)
  M.send_request('ask', { question = question }, function(result, err)
    if err then
      vim.notify('Code Buddy: ' .. err, vim.log.levels.ERROR)
      return
    end

    -- Show in floating window
    local buf = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, vim.split(result.answer, '\\n'))

    local width = math.min(80, vim.o.columns - 4)
    local height = math.min(20, vim.o.lines - 4)

    vim.api.nvim_open_win(buf, true, {
      relative = 'editor',
      width = width,
      height = height,
      col = (vim.o.columns - width) / 2,
      row = (vim.o.lines - height) / 2,
      style = 'minimal',
      border = 'rounded',
    })
  end)
end

-- Explain selected code
function M.explain()
  local start_line = vim.fn.line("'<")
  local end_line = vim.fn.line("'>")
  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  local code = table.concat(lines, '\\n')

  M.send_request('explain', {
    code = code,
    language = vim.bo.filetype,
  }, function(result, err)
    if err then
      vim.notify('Code Buddy: ' .. err, vim.log.levels.ERROR)
      return
    end

    vim.notify(result.explanation, vim.log.levels.INFO)
  end)
end

-- Refactor selected code
function M.refactor(instruction)
  local start_line = vim.fn.line("'<")
  local end_line = vim.fn.line("'>")
  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  local code = table.concat(lines, '\\n')

  M.send_request('refactor', {
    code = code,
    instruction = instruction,
    language = vim.bo.filetype,
  }, function(result, err)
    if err then
      vim.notify('Code Buddy: ' .. err, vim.log.levels.ERROR)
      return
    end

    if result.refactored then
      local new_lines = vim.split(result.refactored, '\\n')
      vim.api.nvim_buf_set_lines(0, start_line - 1, end_line, false, new_lines)
    end
  end)
end

-- Setup keymaps
function M.setup(opts)
  M.config = vim.tbl_deep_extend('force', M.config, opts or {})

  -- Commands
  vim.api.nvim_create_user_command('CodeBuddyAsk', function(args)
    M.ask(args.args)
  end, { nargs = '+' })

  vim.api.nvim_create_user_command('CodeBuddyExplain', function()
    M.explain()
  end, { range = true })

  vim.api.nvim_create_user_command('CodeBuddyRefactor', function(args)
    M.refactor(args.args)
  end, { range = true, nargs = '+' })

  -- Keymaps
  vim.keymap.set('n', '<leader>ga', ':CodeBuddyAsk ', { desc = 'Code Buddy: Ask AI' })
  vim.keymap.set('v', '<leader>ge', ':CodeBuddyExplain<CR>', { desc = 'Code Buddy: Explain' })
  vim.keymap.set('v', '<leader>gr', ':CodeBuddyRefactor ', { desc = 'Code Buddy: Refactor' })

  -- Auto-connect
  if M.config.auto_connect then
    M.connect()
  end
end

return M
`;
  }

  /**
   * Format server status
   */
  formatStatus(): string {
    const connections = this.getConnections();
    const lines: string[] = [
      '🔌 IDE Extensions Server',
      '═'.repeat(40),
      '',
      `Status: ${this.running ? '✅ Running' : '❌ Stopped'}`,
      `Port: ${this.config.port}`,
      `Host: ${this.config.host}`,
      '',
      `Connected Clients: ${connections.length}`,
    ];

    if (connections.length > 0) {
      lines.push('');
      for (const conn of connections) {
        const idle = Math.round((Date.now() - conn.lastActivity) / 1000);
        lines.push(`  • ${conn.name} (${conn.type}) - idle ${idle}s`);
      }
    }

    lines.push('', 'Supported IDEs:');
    lines.push(`  • VS Code: ${this.config.vscodeEnabled ? '✓' : '✗'}`);
    lines.push(`  • JetBrains: ${this.config.jetbrainsEnabled ? '✓' : '✗'}`);
    lines.push(`  • Neovim: ${this.config.neovimEnabled ? '✓' : '✗'}`);
    lines.push(`  • Sublime: ${this.config.sublimeEnabled ? '✓' : '✗'}`);

    return lines.join('\n');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private handleConnection(socket: net.Socket): void {
    const connectionId = `conn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const connection: IDEConnection = {
      id: connectionId,
      type: 'unknown',
      name: 'Unknown IDE',
      socket,
      connected: true,
      lastActivity: Date.now(),
    };

    this.connections.set(connectionId, connection);
    this.emit('connection', connection);

    let buffer = '';

    socket.on('data', async (data) => {
      connection.lastActivity = Date.now();
      buffer += data.toString();

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const request = JSON.parse(line) as IDERequest;
          const response = await this.handleRequest(request, connection);

          if (response && socket.writable) {
            socket.write(JSON.stringify(response) + '\n');
          }
        } catch (error) {
          const errorResponse: IDEResponse = {
            id: 'error',
            error: {
              code: -32700,
              message: 'Parse error',
              data: error instanceof Error ? error.message : String(error),
            },
          };

          if (socket.writable) {
            socket.write(JSON.stringify(errorResponse) + '\n');
          }
        }
      }
    });

    socket.on('close', () => {
      connection.connected = false;
      this.connections.delete(connectionId);
      this.emit('disconnection', connection);
    });

    socket.on('error', (err) => {
      this.emit('client-error', { connection, error: err });
    });
  }

  private async handleRequest(request: IDERequest, connection: IDEConnection): Promise<IDEResponse | null> {
    const handler = this.handlers.get(request.method);

    if (!handler) {
      return {
        id: request.id,
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`,
        },
      };
    }

    try {
      const result = await handler(request, connection);
      return {
        id: request.id,
        result,
      };
    } catch (error) {
      return {
        id: request.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private registerDefaultHandlers(): void {
    // Initialize handler
    this.registerHandler('initialize', async (request, connection) => {
      const params = request.params;

      connection.type = this.detectIDEType(params.ide as string);
      connection.name = (params.ide as string) || 'Unknown';
      connection.version = params.version as string | undefined;

      return {
        capabilities: {
          completion: true,
          hover: true,
          codeAction: true,
          diagnostics: true,
        },
        serverVersion: '1.0.0',
      };
    });

    // Completion handler (stub - integrate with actual AI)
    this.registerHandler('completion', async (_request) => {
      // This would integrate with the actual Grok agent
      return {
        items: [],
      };
    });

    // Ask handler
    this.registerHandler('ask', async (request) => {
      // Integrate with Grok agent
      this.emit('request:ask', request.params);

      return {
        answer: 'AI integration pending - connect to Grok agent for actual responses',
      };
    });

    // Explain handler
    this.registerHandler('explain', async (request) => {
      this.emit('request:explain', request.params);

      return {
        explanation: 'Code explanation pending - connect to Grok agent',
      };
    });

    // Refactor handler
    this.registerHandler('refactor', async (request) => {
      this.emit('request:refactor', request.params);

      return {
        refactored: request.params.code,
      };
    });

    // Suggest fix handler
    this.registerHandler('suggestFix', async (request) => {
      this.emit('request:fix', request.params);

      return {
        fix: null,
        message: 'No fix available',
      };
    });
  }

  private detectIDEType(ide: string): IDEType {
    const lower = (ide || '').toLowerCase();

    if (lower.includes('vscode') || lower.includes('code')) return 'vscode';
    if (lower.includes('jetbrains') || lower.includes('idea') || lower.includes('pycharm')) return 'jetbrains';
    if (lower.includes('nvim') || lower.includes('neovim')) return 'neovim';
    if (lower.includes('sublime')) return 'sublime';

    return 'unknown';
  }
}

// ============================================================================
// Singleton
// ============================================================================

let serverInstance: IDEExtensionsServer | null = null;

export function getIDEExtensionsServer(config?: Partial<IDEExtensionsConfig>): IDEExtensionsServer {
  if (!serverInstance) {
    serverInstance = new IDEExtensionsServer(config);
  }
  return serverInstance;
}

export function resetIDEExtensionsServer(): void {
  if (serverInstance) {
    serverInstance.stop();
  }
  serverInstance = null;
}
