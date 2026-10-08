/**
 * Status Bar Manager
 * Enhanced status bar item showing current model, connection status,
 * and a quick pick to switch models.
 */

import * as vscode from 'vscode';
import { ANTHROPIC_MODELS } from './utils/config-validator';

type ConnectionStatus = 'connected' | 'disconnected' | 'loading';

const AVAILABLE_MODELS = [
  { label: '$(sparkle) grok-3-latest', description: 'Grok 3 (default)', model: 'grok-3-latest' },
  { label: '$(sparkle) grok-3-mini-latest', description: 'Grok 3 Mini', model: 'grok-3-mini-latest' },
  { label: '$(sparkle) grok-2-latest', description: 'Grok 2', model: 'grok-2-latest' },
  ...ANTHROPIC_MODELS.map(model => ({ label: `$(sparkle) ${model}`, description: `Claude (${model})`, model })),
  { label: '$(sparkle) gpt-4o', description: 'GPT-4o', model: 'gpt-4o' },
  { label: '$(sparkle) gpt-4o-mini', description: 'GPT-4o Mini', model: 'gpt-4o-mini' },
  { label: '$(sparkle) gemini-2.0-flash', description: 'Gemini 2.0 Flash', model: 'gemini-2.0-flash' },
];

export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private connectionStatus: ConnectionStatus = 'disconnected';
  private currentModel: string;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'codeBuddy.switchModel';

    const config = vscode.workspace.getConfiguration('codeBuddy');
    this.currentModel = config.get<string>('model') || 'grok-3-latest';

    // Listen for config changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('codeBuddy.model')) {
          this.currentModel = vscode.workspace.getConfiguration('codeBuddy').get<string>('model') || 'grok-3-latest';
          this.updateDisplay();
        }
        if (e.affectsConfiguration('codeBuddy.showInStatusBar')) {
          const show = vscode.workspace.getConfiguration('codeBuddy').get<boolean>('showInStatusBar');
          if (show) {
            this.statusBarItem.show();
          } else {
            this.statusBarItem.hide();
          }
        }
      })
    );

    this.updateDisplay();

    if (config.get<boolean>('showInStatusBar')) {
      this.statusBarItem.show();
    }
  }

  /**
   * Update the status bar display text and tooltip.
   */
  private updateDisplay(): void {
    const icon = this.getStatusIcon();
    const shortModel = this.getShortModelName(this.currentModel);
    this.statusBarItem.text = `${icon} ${shortModel}`;
    this.statusBarItem.tooltip = this.getTooltip();
    this.statusBarItem.color = this.connectionStatus === 'disconnected'
      ? new vscode.ThemeColor('statusBarItem.warningForeground')
      : undefined;
  }

  private getStatusIcon(): string {
    switch (this.connectionStatus) {
      case 'connected':
        return '$(hubot)';
      case 'loading':
        return '$(loading~spin)';
      case 'disconnected':
        return '$(debug-disconnect)';
    }
  }

  private getShortModelName(model: string): string {
    // Shorten well-known model names for status bar
    if (model.startsWith('grok-3-mini')) return 'Grok 3 Mini';
    if (model.startsWith('grok-3')) return 'Grok 3';
    if (model.startsWith('grok-2')) return 'Grok 2';
    if (model.startsWith('claude-')) return model.replace(/^claude-/, 'Claude ');
    if (model.includes('gpt-4o-mini')) return 'GPT-4o Mini';
    if (model.includes('gpt-4o')) return 'GPT-4o';
    if (model.includes('gemini')) return 'Gemini';
    return model;
  }

  private getTooltip(): string {
    const status = this.connectionStatus === 'connected' ? 'Connected'
      : this.connectionStatus === 'loading' ? 'Loading...'
      : 'Disconnected';
    return `Code Buddy\nModel: ${this.currentModel}\nStatus: ${status}\n\nClick to switch model`;
  }

  /**
   * Set the connection status.
   */
  setConnectionStatus(status: ConnectionStatus): void {
    this.connectionStatus = status;
    this.updateDisplay();
  }

  /**
   * Temporarily show a loading message.
   */
  setLoading(message: string): void {
    this.connectionStatus = 'loading';
    this.statusBarItem.text = `$(loading~spin) ${message}`;
  }

  /**
   * Restore from loading state.
   */
  clearLoading(): void {
    this.connectionStatus = 'connected';
    this.updateDisplay();
  }

  /**
   * Show a quick pick to switch models.
   * Returns the selected model name, or undefined if cancelled.
   */
  async showModelPicker(): Promise<string | undefined> {
    const items = AVAILABLE_MODELS.map(m => ({
      ...m,
      picked: m.model === this.currentModel,
    }));

    // Add custom model option
    items.push({
      label: '$(pencil) Enter custom model...',
      description: 'Type a model name manually',
      model: '__custom__',
      picked: false,
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Current model: ${this.currentModel}`,
      title: 'Code Buddy: Switch AI Model',
    });

    if (!selected) return undefined;

    let newModel = selected.model;

    if (newModel === '__custom__') {
      const custom = await vscode.window.showInputBox({
        prompt: 'Enter model name',
        value: this.currentModel,
        placeHolder: 'e.g. grok-3-latest',
      });
      if (!custom) return undefined;
      newModel = custom;
    }

    // Update config
    await vscode.workspace.getConfiguration('codeBuddy').update('model', newModel, true);
    this.currentModel = newModel;
    this.updateDisplay();
    vscode.window.showInformationMessage(`Code Buddy: Switched to ${newModel}`);
    return newModel;
  }

  /**
   * Get the status bar item for adding to subscriptions.
   */
  getStatusBarItem(): vscode.StatusBarItem {
    return this.statusBarItem;
  }

  /**
   * Get the current model name.
   */
  getModel(): string {
    return this.currentModel;
  }

  dispose(): void {
    this.statusBarItem.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
