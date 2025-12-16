/**
 * Mentions Handler
 * GitHub Copilot-style @mentions for context injection
 */

import * as vscode from 'vscode';

export interface MentionResult {
  type: string;
  content: string;
  label: string;
}

export interface ResolvedMentions {
  mentions: MentionResult[];
  cleanedMessage: string;
}

export class MentionsHandler {
  private terminalBuffer: string[] = [];
  private maxTerminalLines = 100;

  constructor() {
    // Listen to terminal output
    this.setupTerminalListener();
  }

  private setupTerminalListener(): void {
    // Listen to terminal data
    vscode.window.onDidOpenTerminal(_terminal => {
      // Note: VSCode doesn't expose terminal output directly
      // We'll capture it when user explicitly references @terminal
    });
  }

  /**
   * Capture terminal selection or recent output
   */
  async captureTerminalContent(): Promise<string> {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      return 'No active terminal';
    }

    // Try to get selection from terminal (if supported)
    // Note: VSCode terminal API is limited, so we provide guidance
    return `Terminal: ${terminal.name}\n(Paste terminal content directly or use terminal selection)`;
  }

  /**
   * Parse and resolve all @mentions in a message
   */
  async resolveMentions(message: string): Promise<ResolvedMentions> {
    const mentions: MentionResult[] = [];
    let cleanedMessage = message;

    // @file:path - Include specific file
    const fileMatches = message.matchAll(/@file:([^\s]+)/g);
    for (const match of fileMatches) {
      const filePath = match[1];
      const content = await this.resolveFile(filePath);
      if (content) {
        mentions.push({
          type: 'file',
          content,
          label: `@file:${filePath}`,
        });
      }
      cleanedMessage = cleanedMessage.replace(match[0], '');
    }

    // @selection - Current editor selection
    if (message.includes('@selection')) {
      const selection = await this.resolveSelection();
      if (selection) {
        mentions.push({
          type: 'selection',
          content: selection,
          label: '@selection',
        });
      }
      cleanedMessage = cleanedMessage.replace(/@selection/g, '');
    }

    // @workspace:query - Search workspace
    const workspaceMatches = message.matchAll(/@workspace:([^\s]+)/g);
    for (const match of workspaceMatches) {
      const query = match[1];
      const results = await this.searchWorkspace(query);
      if (results) {
        mentions.push({
          type: 'workspace',
          content: results,
          label: `@workspace:${query}`,
        });
      }
      cleanedMessage = cleanedMessage.replace(match[0], '');
    }

    // @workspace (without query) - Include workspace context
    if (message.match(/@workspace(?![:])/)) {
      const context = await this.getWorkspaceContext();
      mentions.push({
        type: 'workspace',
        content: context,
        label: '@workspace',
      });
      cleanedMessage = cleanedMessage.replace(/@workspace(?![:])/g, '');
    }

    // @terminal - Recent terminal output
    if (message.includes('@terminal')) {
      const terminalContent = await this.captureTerminalContent();
      mentions.push({
        type: 'terminal',
        content: terminalContent,
        label: '@terminal',
      });
      cleanedMessage = cleanedMessage.replace(/@terminal/g, '');
    }

    // @git - Git status and diff
    if (message.includes('@git')) {
      const gitInfo = await this.resolveGit();
      if (gitInfo) {
        mentions.push({
          type: 'git',
          content: gitInfo,
          label: '@git',
        });
      }
      cleanedMessage = cleanedMessage.replace(/@git/g, '');
    }

    // @errors - Current problems/diagnostics
    if (message.includes('@errors')) {
      const errors = await this.resolveErrors();
      if (errors) {
        mentions.push({
          type: 'errors',
          content: errors,
          label: '@errors',
        });
      }
      cleanedMessage = cleanedMessage.replace(/@errors/g, '');
    }

    // @codebase - Search entire codebase for relevant context
    const codebaseMatches = message.matchAll(/@codebase:([^\s]+)/g);
    for (const match of codebaseMatches) {
      const query = match[1];
      const results = await this.searchCodebase(query);
      if (results) {
        mentions.push({
          type: 'codebase',
          content: results,
          label: `@codebase:${query}`,
        });
      }
      cleanedMessage = cleanedMessage.replace(match[0], '');
    }

    // @symbols - Symbols in current file
    if (message.includes('@symbols')) {
      const symbols = await this.resolveSymbols();
      if (symbols) {
        mentions.push({
          type: 'symbols',
          content: symbols,
          label: '@symbols',
        });
      }
      cleanedMessage = cleanedMessage.replace(/@symbols/g, '');
    }

    return {
      mentions,
      cleanedMessage: cleanedMessage.trim(),
    };
  }

  /**
   * Resolve a file path to its content
   */
  private async resolveFile(filePath: string): Promise<string | null> {
    try {
      // Try to find the file
      const files = await vscode.workspace.findFiles(`**/${filePath}`, '**/node_modules/**', 1);
      if (files.length === 0) {
        // Try as absolute or relative path
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
          const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
          try {
            const doc = await vscode.workspace.openTextDocument(uri);
            return `File: ${filePath}\n\`\`\`${doc.languageId}\n${doc.getText()}\n\`\`\``;
          } catch {
            return null;
          }
        }
        return null;
      }

      const doc = await vscode.workspace.openTextDocument(files[0]);
      const relativePath = vscode.workspace.asRelativePath(files[0]);
      return `File: ${relativePath}\n\`\`\`${doc.languageId}\n${doc.getText()}\n\`\`\``;
    } catch {
      return null;
    }
  }

  /**
   * Get current editor selection
   */
  private async resolveSelection(): Promise<string | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      return null;
    }

    const selection = editor.document.getText(editor.selection);
    const language = editor.document.languageId;
    const fileName = vscode.workspace.asRelativePath(editor.document.uri);

    return `Selection from ${fileName}:\n\`\`\`${language}\n${selection}\n\`\`\``;
  }

  /**
   * Search workspace for files matching query
   */
  private async searchWorkspace(query: string): Promise<string | null> {
    try {
      const files = await vscode.workspace.findFiles(`**/*${query}*`, '**/node_modules/**', 10);
      if (files.length === 0) {
        return `No files found matching: ${query}`;
      }

      const results: string[] = [`Files matching "${query}":`];
      for (const file of files.slice(0, 5)) {
        results.push(`- ${vscode.workspace.asRelativePath(file)}`);
      }

      return results.join('\n');
    } catch {
      return null;
    }
  }

  /**
   * Get general workspace context
   */
  private async getWorkspaceContext(): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) {
      return 'No workspace open';
    }

    const root = workspaceFolders[0];
    const context: string[] = [`Workspace: ${root.name}`];

    // Get file structure
    const files = await vscode.workspace.findFiles('**/*.{ts,js,py,go,rs,java,tsx,jsx,vue,svelte}', '**/node_modules/**', 50);

    // Group by directory
    const byDir = new Map<string, string[]>();
    for (const file of files) {
      const relativePath = vscode.workspace.asRelativePath(file);
      const dir = relativePath.split('/').slice(0, -1).join('/') || '.';
      if (!byDir.has(dir)) {
        byDir.set(dir, []);
      }
      byDir.get(dir)!.push(relativePath.split('/').pop()!);
    }

    context.push('\nProject structure:');
    for (const [dir, fileNames] of Array.from(byDir.entries()).slice(0, 10)) {
      context.push(`${dir}/`);
      for (const name of fileNames.slice(0, 5)) {
        context.push(`  - ${name}`);
      }
      if (fileNames.length > 5) {
        context.push(`  ... and ${fileNames.length - 5} more`);
      }
    }

    // Check for common config files
    const configFiles = ['package.json', 'tsconfig.json', 'pyproject.toml', 'go.mod', 'Cargo.toml'];
    for (const config of configFiles) {
      const found = await vscode.workspace.findFiles(config, null, 1);
      if (found.length > 0) {
        try {
          const doc = await vscode.workspace.openTextDocument(found[0]);
          const content = doc.getText();
          if (content.length < 2000) {
            context.push(`\n${config}:\n\`\`\`json\n${content}\n\`\`\``);
          }
        } catch {
          // Skip if can't read
        }
        break; // Only include one config file
      }
    }

    return context.join('\n');
  }

  /**
   * Get git status and diff
   */
  private async resolveGit(): Promise<string | null> {
    try {
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (!gitExtension) {
        return 'Git extension not available';
      }

      const git = gitExtension.exports.getAPI(1);
      if (!git.repositories.length) {
        return 'No git repository found';
      }

      const repo = git.repositories[0];
      const info: string[] = [];

      // Branch info
      const branch = repo.state.HEAD?.name;
      info.push(`Branch: ${branch || 'unknown'}`);

      // Status
      const changes = repo.state.workingTreeChanges;
      const staged = repo.state.indexChanges;

      if (staged.length > 0) {
        info.push(`\nStaged changes (${staged.length}):`);
        for (const change of staged.slice(0, 10)) {
          info.push(`  - ${vscode.workspace.asRelativePath(change.uri)}`);
        }
      }

      if (changes.length > 0) {
        info.push(`\nUnstaged changes (${changes.length}):`);
        for (const change of changes.slice(0, 10)) {
          info.push(`  - ${vscode.workspace.asRelativePath(change.uri)}`);
        }
      }

      return info.join('\n');
    } catch (_error) {
      return 'Error getting git info';
    }
  }

  /**
   * Get current errors/diagnostics
   */
  private async resolveErrors(): Promise<string | null> {
    const diagnostics = vscode.languages.getDiagnostics();
    const errors: string[] = [];

    for (const [uri, diags] of diagnostics) {
      const relevantDiags = diags.filter(d =>
        d.severity === vscode.DiagnosticSeverity.Error ||
        d.severity === vscode.DiagnosticSeverity.Warning
      );

      if (relevantDiags.length > 0) {
        const relativePath = vscode.workspace.asRelativePath(uri);
        for (const diag of relevantDiags.slice(0, 5)) {
          const severity = diag.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARNING';
          errors.push(`[${severity}] ${relativePath}:${diag.range.start.line + 1} - ${diag.message}`);
        }
      }
    }

    if (errors.length === 0) {
      return 'No errors or warnings found';
    }

    return `Current problems (${errors.length}):\n${errors.slice(0, 20).join('\n')}`;
  }

  /**
   * Search codebase for relevant code
   */
  private async searchCodebase(query: string): Promise<string | null> {
    try {
      // Search for files containing the query
      const files = await vscode.workspace.findFiles('**/*.{ts,js,py,go,rs,java,tsx,jsx}', '**/node_modules/**', 100);

      const results: string[] = [];
      for (const file of files) {
        try {
          const doc = await vscode.workspace.openTextDocument(file);
          const text = doc.getText();

          if (text.toLowerCase().includes(query.toLowerCase())) {
            const lines = text.split('\n');
            const matchingLines: string[] = [];

            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                // Get context (line before and after)
                const start = Math.max(0, i - 1);
                const end = Math.min(lines.length - 1, i + 1);
                matchingLines.push(`L${i + 1}: ${lines.slice(start, end + 1).join('\n')}`);

                if (matchingLines.length >= 3) break;
              }
            }

            if (matchingLines.length > 0) {
              const relativePath = vscode.workspace.asRelativePath(file);
              results.push(`\n${relativePath}:\n${matchingLines.join('\n---\n')}`);
            }
          }
        } catch {
          // Skip files that can't be read
        }

        if (results.length >= 5) break;
      }

      if (results.length === 0) {
        return `No code found matching: ${query}`;
      }

      return `Code search results for "${query}":${results.join('\n')}`;
    } catch {
      return null;
    }
  }

  /**
   * Get symbols in current file
   */
  private async resolveSymbols(): Promise<string | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return 'No active editor';
    }

    try {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        editor.document.uri
      );

      if (!symbols || symbols.length === 0) {
        return 'No symbols found';
      }

      const formatSymbols = (syms: vscode.DocumentSymbol[], indent = 0): string[] => {
        const result: string[] = [];
        for (const sym of syms) {
          const kindName = vscode.SymbolKind[sym.kind];
          result.push(`${'  '.repeat(indent)}${kindName}: ${sym.name}`);
          if (sym.children && sym.children.length > 0) {
            result.push(...formatSymbols(sym.children, indent + 1));
          }
        }
        return result;
      };

      const fileName = vscode.workspace.asRelativePath(editor.document.uri);
      return `Symbols in ${fileName}:\n${formatSymbols(symbols).join('\n')}`;
    } catch {
      return 'Error getting symbols';
    }
  }

  /**
   * Get mention suggestions for autocomplete
   */
  getMentionSuggestions(): Array<{ label: string; description: string; insertText: string }> {
    return [
      { label: '@file:', description: 'Include a specific file', insertText: '@file:' },
      { label: '@selection', description: 'Current editor selection', insertText: '@selection' },
      { label: '@workspace', description: 'Workspace context', insertText: '@workspace' },
      { label: '@workspace:', description: 'Search workspace files', insertText: '@workspace:' },
      { label: '@terminal', description: 'Recent terminal output', insertText: '@terminal' },
      { label: '@git', description: 'Git status and diff', insertText: '@git' },
      { label: '@errors', description: 'Current problems/diagnostics', insertText: '@errors' },
      { label: '@codebase:', description: 'Search code for pattern', insertText: '@codebase:' },
      { label: '@symbols', description: 'Symbols in current file', insertText: '@symbols' },
    ];
  }
}
