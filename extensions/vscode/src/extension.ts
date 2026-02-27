import * as vscode from 'vscode';
import { CodeBuddyClient } from './api-client';
import { ChatViewProvider } from './chat-provider';

let statusBarItem: vscode.StatusBarItem;
let client: CodeBuddyClient;
let chatProvider: ChatViewProvider;

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('codebuddy');
  const serverUrl = config.get<string>('serverUrl', 'http://localhost:3000');
  const autoConnect = config.get<boolean>('autoConnect', true);

  client = new CodeBuddyClient(serverUrl);

  // Register chat webview provider
  chatProvider = new ChatViewProvider(context.extensionUri, client);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider)
  );

  // Status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'codebuddy.openChat';
  statusBarItem.text = '$(comment-discussion) Code Buddy';
  statusBarItem.tooltip = 'Code Buddy - Click to open chat';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('codebuddy.openChat', () => {
      vscode.commands.executeCommand('codebuddy.chatView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codebuddy.askAboutSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor with a selection.');
        return;
      }

      const selection = editor.document.getText(editor.selection);
      if (!selection.trim()) {
        vscode.window.showWarningMessage('No text selected. Select some code first.');
        return;
      }

      const question = await vscode.window.showInputBox({
        prompt: 'What would you like to ask about this code?',
        placeHolder: 'e.g., Explain this code, Find bugs, Suggest improvements',
      });

      if (!question) {
        return;
      }

      const fileName = editor.document.fileName;
      const language = editor.document.languageId;
      const message = `Regarding this ${language} code from ${fileName}:\n\n\`\`\`${language}\n${selection}\n\`\`\`\n\n${question}`;

      await vscode.commands.executeCommand('codebuddy.chatView.focus');
      await chatProvider.sendMessage(message);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codebuddy.reviewFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active file to review.');
        return;
      }

      const content = editor.document.getText();
      const fileName = editor.document.fileName;
      const language = editor.document.languageId;

      if (content.length > 50_000) {
        vscode.window.showWarningMessage('File is too large for review (>50KB). Select a portion instead.');
        return;
      }

      const message = `Please review this ${language} file (${fileName}) for bugs, improvements, and best practices:\n\n\`\`\`${language}\n${content}\n\`\`\``;

      await vscode.commands.executeCommand('codebuddy.chatView.focus');
      await chatProvider.sendMessage(message);
    })
  );

  // Listen for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codebuddy.serverUrl')) {
        const newUrl = vscode.workspace.getConfiguration('codebuddy').get<string>('serverUrl', 'http://localhost:3000');
        client.setBaseUrl(newUrl);
        updateConnectionStatus();
      }
    })
  );

  // Auto-connect
  if (autoConnect) {
    updateConnectionStatus();
  }
}

async function updateConnectionStatus(): Promise<void> {
  statusBarItem.text = '$(sync~spin) Code Buddy';
  statusBarItem.tooltip = 'Code Buddy - Connecting...';

  const connected = await client.isConnected();
  if (connected) {
    statusBarItem.text = '$(comment-discussion) Code Buddy';
    statusBarItem.tooltip = `Code Buddy - Connected to ${client.getBaseUrl()}`;
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = '$(warning) Code Buddy';
    statusBarItem.tooltip = `Code Buddy - Disconnected from ${client.getBaseUrl()}`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
}

export function deactivate(): void {
  // Cleanup handled by disposables in context.subscriptions
}
