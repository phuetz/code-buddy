/**
 * Grok CLI VS Code Extension
 *
 * Brings the power of Grok CLI to Visual Studio Code with:
 * - Chat interface in sidebar
 * - Inline code completions
 * - Code explanation and refactoring
 * - Automatic code review
 * - Test generation
 */

import * as vscode from 'vscode';
import { GrokChatViewProvider } from './providers/chat-view-provider';
import { GrokCodeActionsProvider } from './providers/code-actions-provider';
import { GrokCompletionProvider } from './providers/completion-provider';
import { GrokClient } from './grok-client';
import { ReviewDiagnosticsProvider } from './providers/review-diagnostics-provider';

let grokClient: GrokClient;
let chatViewProvider: GrokChatViewProvider;
let diagnosticsProvider: ReviewDiagnosticsProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log('Grok CLI extension is now active');

  // Initialize Grok client
  const config = vscode.workspace.getConfiguration('grok');
  const apiKey = config.get<string>('apiKey') || process.env.GROK_API_KEY || '';

  if (!apiKey) {
    vscode.window.showWarningMessage(
      'Grok API key not configured. Please set it in settings or GROK_API_KEY environment variable.',
      'Open Settings'
    ).then(selection => {
      if (selection === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'grok.apiKey');
      }
    });
  }

  grokClient = new GrokClient(apiKey, config.get<string>('model') || 'grok-3-latest');

  // Register chat view provider
  chatViewProvider = new GrokChatViewProvider(context.extensionUri, grokClient);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('grok.chatView', chatViewProvider)
  );

  // Register diagnostics provider for code review
  diagnosticsProvider = new ReviewDiagnosticsProvider(grokClient);
  context.subscriptions.push(diagnosticsProvider);

  // Register code actions provider
  const codeActionsProvider = new GrokCodeActionsProvider(grokClient);
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      codeActionsProvider,
      { providedCodeActionKinds: GrokCodeActionsProvider.providedCodeActionKinds }
    )
  );

  // Register completion provider (if enabled)
  if (config.get<boolean>('inlineCompletions')) {
    const completionProvider = new GrokCompletionProvider(grokClient);
    context.subscriptions.push(
      vscode.languages.registerInlineCompletionItemProvider(
        { scheme: 'file' },
        completionProvider
      )
    );
  }

  // Register commands
  registerCommands(context);

  // Auto-review on save (if enabled)
  if (config.get<boolean>('autoReview')) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(async (document) => {
        await diagnosticsProvider.reviewDocument(document);
      })
    );
  }

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('grok')) {
        const newConfig = vscode.workspace.getConfiguration('grok');
        grokClient.updateConfig({
          apiKey: newConfig.get<string>('apiKey') || process.env.GROK_API_KEY || '',
          model: newConfig.get<string>('model') || 'grok-3-latest',
        });
      }
    })
  );
}

function registerCommands(context: vscode.ExtensionContext) {
  // Open chat command
  context.subscriptions.push(
    vscode.commands.registerCommand('grok.chat', async () => {
      await vscode.commands.executeCommand('grok.chatView.focus');
    })
  );

  // Explain selection command
  context.subscriptions.push(
    vscode.commands.registerCommand('grok.explain', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.selection;
      const text = editor.document.getText(selection);

      if (!text) {
        vscode.window.showInformationMessage('Please select some code to explain');
        return;
      }

      await chatViewProvider.sendMessage(`Explain this code:\n\`\`\`\n${text}\n\`\`\``);
      await vscode.commands.executeCommand('grok.chatView.focus');
    })
  );

  // Refactor selection command
  context.subscriptions.push(
    vscode.commands.registerCommand('grok.refactor', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.selection;
      const text = editor.document.getText(selection);

      if (!text) {
        vscode.window.showInformationMessage('Please select some code to refactor');
        return;
      }

      const instruction = await vscode.window.showInputBox({
        prompt: 'How would you like to refactor this code?',
        placeHolder: 'e.g., "make it more readable", "use async/await", "add error handling"',
      });

      if (instruction) {
        await chatViewProvider.sendMessage(
          `Refactor this code (${instruction}):\n\`\`\`\n${text}\n\`\`\`\n\nProvide the refactored code.`
        );
        await vscode.commands.executeCommand('grok.chatView.focus');
      }
    })
  );

  // Fix selection command
  context.subscriptions.push(
    vscode.commands.registerCommand('grok.fix', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.selection;
      const text = editor.document.getText(selection);
      const language = editor.document.languageId;

      if (!text) {
        vscode.window.showInformationMessage('Please select some code to fix');
        return;
      }

      const response = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Grok is fixing...' },
        async () => {
          return await grokClient.chat([
            {
              role: 'system',
              content: `You are an expert ${language} developer. Fix the code and return ONLY the fixed code, no explanations.`,
            },
            {
              role: 'user',
              content: `Fix this code:\n\`\`\`${language}\n${text}\n\`\`\``,
            },
          ]);
        }
      );

      // Extract code from response
      const codeMatch = response.match(/```[\w]*\n([\s\S]*?)```/);
      const fixedCode = codeMatch ? codeMatch[1].trim() : response.trim();

      // Apply the fix
      await editor.edit(editBuilder => {
        editBuilder.replace(selection, fixedCode);
      });

      vscode.window.showInformationMessage('Code fixed!');
    })
  );

  // Generate tests command
  context.subscriptions.push(
    vscode.commands.registerCommand('grok.generateTests', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.selection;
      const text = editor.document.getText(selection);
      const language = editor.document.languageId;
      const fileName = editor.document.fileName;

      if (!text) {
        vscode.window.showInformationMessage('Please select some code to generate tests for');
        return;
      }

      await chatViewProvider.sendMessage(
        `Generate comprehensive unit tests for this ${language} code from ${fileName}:\n\`\`\`${language}\n${text}\n\`\`\`\n\nUse appropriate testing framework (Jest for JS/TS, pytest for Python, etc.).`
      );
      await vscode.commands.executeCommand('grok.chatView.focus');
    })
  );

  // Review code command
  context.subscriptions.push(
    vscode.commands.registerCommand('grok.review', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Grok is reviewing...' },
        async () => {
          await diagnosticsProvider.reviewDocument(editor.document);
        }
      );

      vscode.window.showInformationMessage('Code review complete. Check the Problems panel.');
    })
  );

  // Open terminal command
  context.subscriptions.push(
    vscode.commands.registerCommand('grok.terminal', async () => {
      const terminal = vscode.window.createTerminal({
        name: 'Grok CLI',
        shellPath: 'grok',
      });
      terminal.show();
    })
  );

  // Inline edit command
  context.subscriptions.push(
    vscode.commands.registerCommand('grok.inlineEdit', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const selection = editor.selection;
      const text = editor.document.getText(selection);
      const language = editor.document.languageId;

      const instruction = await vscode.window.showInputBox({
        prompt: 'What would you like Grok to do?',
        placeHolder: text ? 'Describe the change...' : 'Describe what to write...',
      });

      if (!instruction) return;

      const response = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Grok is thinking...' },
        async () => {
          const prompt = text
            ? `Modify this ${language} code according to the instruction. Return ONLY the modified code.\n\nInstruction: ${instruction}\n\nCode:\n\`\`\`${language}\n${text}\n\`\`\``
            : `Write ${language} code according to this instruction. Return ONLY the code.\n\nInstruction: ${instruction}`;

          return await grokClient.chat([
            { role: 'system', content: `You are an expert ${language} developer. Return ONLY code, no explanations.` },
            { role: 'user', content: prompt },
          ]);
        }
      );

      // Extract code from response
      const codeMatch = response.match(/```[\w]*\n([\s\S]*?)```/);
      const newCode = codeMatch ? codeMatch[1].trim() : response.trim();

      // Apply the change
      await editor.edit(editBuilder => {
        if (text) {
          editBuilder.replace(selection, newCode);
        } else {
          editBuilder.insert(selection.active, newCode);
        }
      });
    })
  );
}

export function deactivate() {
  console.log('Grok CLI extension deactivated');
}
