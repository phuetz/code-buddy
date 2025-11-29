/**
 * Code Actions Provider
 *
 * Provides quick fix actions for code issues detected by Grok.
 */

import * as vscode from 'vscode';
import { GrokClient } from '../grok-client';

export class GrokCodeActionsProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.Refactor,
  ];

  constructor(private readonly grokClient: GrokClient) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
    const actions: vscode.CodeAction[] = [];

    // Add actions for Grok diagnostics
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source === 'Grok') {
        // Quick fix action
        const fixAction = new vscode.CodeAction(
          `🔧 Fix with Grok: ${diagnostic.message.slice(0, 40)}...`,
          vscode.CodeActionKind.QuickFix
        );
        fixAction.command = {
          command: 'grok.fixDiagnostic',
          title: 'Fix with Grok',
          arguments: [document, diagnostic],
        };
        fixAction.diagnostics = [diagnostic];
        fixAction.isPreferred = true;
        actions.push(fixAction);
      }
    }

    // Add general actions when text is selected
    if (!range.isEmpty) {
      // Explain action
      const explainAction = new vscode.CodeAction(
        '💡 Explain with Grok',
        vscode.CodeActionKind.Empty
      );
      explainAction.command = {
        command: 'grok.explain',
        title: 'Explain with Grok',
      };
      actions.push(explainAction);

      // Refactor action
      const refactorAction = new vscode.CodeAction(
        '🔄 Refactor with Grok',
        vscode.CodeActionKind.Refactor
      );
      refactorAction.command = {
        command: 'grok.refactor',
        title: 'Refactor with Grok',
      };
      actions.push(refactorAction);

      // Generate tests action
      const testAction = new vscode.CodeAction(
        '🧪 Generate Tests with Grok',
        vscode.CodeActionKind.Empty
      );
      testAction.command = {
        command: 'grok.generateTests',
        title: 'Generate Tests with Grok',
      };
      actions.push(testAction);

      // Optimize action
      const optimizeAction = new vscode.CodeAction(
        '⚡ Optimize with Grok',
        vscode.CodeActionKind.Refactor
      );
      optimizeAction.command = {
        command: 'grok.optimize',
        title: 'Optimize with Grok',
        arguments: [document, range],
      };
      actions.push(optimizeAction);

      // Add documentation action
      const docAction = new vscode.CodeAction(
        '📝 Add Documentation with Grok',
        vscode.CodeActionKind.Refactor
      );
      docAction.command = {
        command: 'grok.addDocs',
        title: 'Add Documentation with Grok',
        arguments: [document, range],
      };
      actions.push(docAction);
    }

    return actions;
  }
}
