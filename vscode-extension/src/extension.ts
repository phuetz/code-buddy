import * as vscode from 'vscode';
import OpenAI from 'openai';

let client: OpenAI | null = null;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Code Buddy');
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(hubot) Code Buddy';
  statusBarItem.command = 'codeBuddy.start';
  
  const config = vscode.workspace.getConfiguration('codeBuddy');
  if (config.get('showInStatusBar')) statusBarItem.show();
  initializeClient();

  context.subscriptions.push(
    vscode.commands.registerCommand('codeBuddy.start', startCodeBuddy),
    vscode.commands.registerCommand('codeBuddy.askQuestion', askQuestion),
    vscode.commands.registerCommand('codeBuddy.explainCode', explainCode),
    vscode.commands.registerCommand('codeBuddy.refactorCode', refactorCode),
    vscode.commands.registerCommand('codeBuddy.generateTests', generateTests),
    vscode.commands.registerCommand('codeBuddy.fixError', fixError),
    vscode.commands.registerCommand('codeBuddy.commitChanges', generateCommitMessage),
    statusBarItem
  );
}

function initializeClient() {
  const apiKey = vscode.workspace.getConfiguration('codeBuddy').get<string>('apiKey');
  if (apiKey) {
    client = new OpenAI({ apiKey, baseURL: 'https://api.x.ai/v1' });
  }
}

async function ensureClient(): Promise<OpenAI> {
  if (!client) {
    const apiKey = await vscode.window.showInputBox({ prompt: 'Enter Grok API key', password: true });
    if (!apiKey) throw new Error('API key required');
    await vscode.workspace.getConfiguration('codeBuddy').update('apiKey', apiKey, true);
    initializeClient();
  }
  return client!;
}

async function startCodeBuddy() {
  const terminal = vscode.window.createTerminal({ name: 'Code Buddy', shellPath: 'npx', shellArgs: ['@phuetz/code-buddy'] });
  terminal.show();
}

async function askQuestion() {
  const openai = await ensureClient();
  const question = await vscode.window.showInputBox({ prompt: 'Ask Code Buddy' });
  if (!question) return;
  
  statusBarItem.text = '$(loading~spin) Thinking...';
  const response = await openai.chat.completions.create({
    model: 'grok-3-latest',
    messages: [{ role: 'user', content: question }],
  });
  statusBarItem.text = '$(hubot) Code Buddy';
  const answer = response.choices[0]?.message?.content || 'No response';
  outputChannel.appendLine('Q: ' + question + '\nA: ' + answer + '\n');
  outputChannel.show();
}

async function explainCode() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const code = editor.document.getText(editor.selection);
  if (!code) return;

  const openai = await ensureClient();
  statusBarItem.text = '$(loading~spin) Explaining...';
  const response = await openai.chat.completions.create({
    model: 'grok-3-latest',
    messages: [{ role: 'system', content: 'Explain this code clearly.' }, { role: 'user', content: code }],
  });
  statusBarItem.text = '$(hubot) Code Buddy';
  outputChannel.appendLine('Explanation:\n' + (response.choices[0]?.message?.content || '') + '\n');
  outputChannel.show();
}

async function refactorCode() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const selection = editor.selection;
  const code = editor.document.getText(selection);
  if (!code) return;

  const instruction = await vscode.window.showInputBox({ prompt: 'How to refactor?' });
  if (!instruction) return;

  const openai = await ensureClient();
  statusBarItem.text = '$(loading~spin) Refactoring...';
  const response = await openai.chat.completions.create({
    model: 'grok-3-latest',
    messages: [{ role: 'system', content: 'Refactor code. Return only code.' }, { role: 'user', content: instruction + '\n' + code }],
  });
  statusBarItem.text = '$(hubot) Code Buddy';
  
  const refactored = response.choices[0]?.message?.content || code;
  await editor.edit(b => b.replace(selection, refactored));
}

async function generateTests() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const code = editor.document.getText(editor.selection);
  if (!code) return;

  const openai = await ensureClient();
  statusBarItem.text = '$(loading~spin) Generating tests...';
  const response = await openai.chat.completions.create({
    model: 'grok-3-latest',
    messages: [{ role: 'system', content: 'Generate unit tests using Jest.' }, { role: 'user', content: code }],
  });
  statusBarItem.text = '$(hubot) Code Buddy';
  
  const content = response.choices[0]?.message?.content || '';
  const doc = await vscode.workspace.openTextDocument({ content, language: 'typescript' });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}

async function fixError() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  
  const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
  const cursorPos = editor.selection.active;
  const errors = diagnostics.filter(d => d.range.contains(cursorPos));
  if (!errors.length) { vscode.window.showInformationMessage('No errors at cursor'); return; }

  const errorMsgs = errors.map(e => e.message).join('; ');
  const context = editor.document.getText();
  const openai = await ensureClient();
  statusBarItem.text = '$(loading~spin) Fixing...';
  const response = await openai.chat.completions.create({
    model: 'grok-3-latest',
    messages: [{ role: 'system', content: 'Fix the error. Return only fixed code.' }, 
               { role: 'user', content: 'Errors: ' + errorMsgs + '\nCode:\n' + context }],
  });
  statusBarItem.text = '$(hubot) Code Buddy';
  outputChannel.appendLine('Fix suggestion:\n' + (response.choices[0]?.message?.content || '') + '\n');
  outputChannel.show();
}

async function generateCommitMessage() {
  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (!gitExt) { vscode.window.showErrorMessage('Git extension not found'); return; }
  const api = gitExt.exports.getAPI(1);
  const repo = api.repositories[0];
  if (!repo) { vscode.window.showErrorMessage('No git repo found'); return; }

  const diff = await repo.diff(true);
  if (!diff) { vscode.window.showInformationMessage('No staged changes'); return; }

  const openai = await ensureClient();
  statusBarItem.text = '$(loading~spin) Generating...';
  const response = await openai.chat.completions.create({
    model: 'grok-3-latest',
    messages: [{ role: 'system', content: 'Generate conventional commit message.' }, { role: 'user', content: diff }],
    max_tokens: 200,
  });
  statusBarItem.text = '$(hubot) Code Buddy';
  repo.inputBox.value = response.choices[0]?.message?.content || '';
  vscode.window.showInformationMessage('Commit message generated');
}

export function deactivate() { outputChannel?.dispose(); }
