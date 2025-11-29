/**
 * Review Diagnostics Provider
 *
 * Provides diagnostics from AI code review in the Problems panel.
 */

import * as vscode from 'vscode';
import { GrokClient } from '../grok-client';

export class ReviewDiagnosticsProvider implements vscode.Disposable {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly grokClient: GrokClient) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('Grok');
    this.disposables.push(this.diagnosticCollection);

    // Register fix command
    this.disposables.push(
      vscode.commands.registerCommand('grok.fixDiagnostic', this.fixDiagnostic.bind(this))
    );
  }

  /**
   * Review a document and add diagnostics
   */
  async reviewDocument(document: vscode.TextDocument): Promise<void> {
    const code = document.getText();
    const language = document.languageId;

    try {
      const issues = await this.grokClient.reviewCode(code, language);

      const diagnostics: vscode.Diagnostic[] = issues.map(issue => {
        const line = Math.max(0, (issue.line || 1) - 1);
        const lineText = document.lineAt(line).text;

        const range = new vscode.Range(
          line,
          0,
          line,
          lineText.length
        );

        const severity = this.mapSeverity(issue.severity);

        const diagnostic = new vscode.Diagnostic(range, issue.message, severity);
        diagnostic.source = 'Grok';
        diagnostic.code = issue.suggestion ? 'fixable' : undefined;

        // Store suggestion for quick fix
        if (issue.suggestion) {
          (diagnostic as any).suggestion = issue.suggestion;
        }

        return diagnostic;
      });

      this.diagnosticCollection.set(document.uri, diagnostics);
    } catch (error) {
      console.error('Grok review error:', error);
    }
  }

  /**
   * Fix a diagnostic issue
   */
  private async fixDiagnostic(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): Promise<void> {
    const suggestion = (diagnostic as any).suggestion;

    if (!suggestion) {
      // No direct suggestion, ask Grok to fix
      const line = document.lineAt(diagnostic.range.start.line);
      const code = line.text;
      const language = document.languageId;

      const response = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Grok is fixing...' },
        async () => {
          return await this.grokClient.chat([
            {
              role: 'system',
              content: `You are an expert ${language} developer. Fix the issue and return ONLY the fixed line of code.`,
            },
            {
              role: 'user',
              content: `Fix this issue in the code: "${diagnostic.message}"\n\nCode:\n${code}\n\nReturn ONLY the fixed line.`,
            },
          ]);
        }
      );

      const fixedCode = response.trim().replace(/^`+|`+$/g, '');

      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document === document) {
        await editor.edit(editBuilder => {
          editBuilder.replace(diagnostic.range, fixedCode);
        });
      }
    } else {
      // Apply the suggestion directly
      vscode.window.showInformationMessage(`Suggestion: ${suggestion}`);
    }

    // Re-review after fix
    await this.reviewDocument(document);
  }

  /**
   * Map severity string to VS Code severity
   */
  private mapSeverity(severity: string): vscode.DiagnosticSeverity {
    switch (severity) {
      case 'error':
        return vscode.DiagnosticSeverity.Error;
      case 'warning':
        return vscode.DiagnosticSeverity.Warning;
      case 'info':
      default:
        return vscode.DiagnosticSeverity.Information;
    }
  }

  /**
   * Clear diagnostics for a document
   */
  clearDiagnostics(document: vscode.TextDocument): void {
    this.diagnosticCollection.delete(document.uri);
  }

  /**
   * Clear all diagnostics
   */
  clearAll(): void {
    this.diagnosticCollection.clear();
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }
}
