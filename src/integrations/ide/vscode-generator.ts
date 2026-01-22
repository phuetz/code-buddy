/**
 * VS Code Extension Generator
 *
 * Generates VS Code extension code for IDE integration.
 */

import type { IDEExtensionsConfig } from './types.js';

export interface VSCodeExtensionOutput {
  packageJson: string;
  extensionTs: string;
}

/**
 * Generate VS Code extension manifest and code.
 */
export function generateVSCodeExtension(config: IDEExtensionsConfig): VSCodeExtensionOutput {
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
            default: config.port,
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

interface CompletionItem {
  label: string;
  detail?: string;
  documentation?: string;
  insertText?: string;
}

interface RequestResult {
  items?: CompletionItem[];
  answer?: string;
  explanation?: string;
  fix?: string;
  range?: vscode.Range;
  refactored?: string;
}

let client: net.Socket | null = null;
let requestId = 0;
const pendingRequests = new Map<string, { resolve: (value: RequestResult) => void; reject: (reason: Error) => void }>();

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('codebuddy');
  const port = config.get<number>('serverPort', ${config.port});

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

        return result?.items?.map((item: CompletionItem) => {
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

function sendRequest(method: string, params: Record<string, unknown>): Promise<RequestResult> {
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
