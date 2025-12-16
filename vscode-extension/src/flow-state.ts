/**
 * Flow State Detection
 * Windsurf-inspired feature that detects what the user is working on
 * and provides contextual suggestions
 */

import * as vscode from 'vscode';
import { AIClient } from './ai-client';

export interface FlowContext {
  currentTask: string;
  relevantFiles: string[];
  recentEdits: EditInfo[];
  suggestedActions: FlowAction[];
  confidence: number;
}

export interface EditInfo {
  file: string;
  timestamp: number;
  changeType: 'add' | 'modify' | 'delete';
  summary: string;
}

export interface FlowAction {
  id: string;
  label: string;
  description: string;
  command: string;
  args?: unknown[];
  priority: number;
}

export class FlowStateDetector implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private recentEdits: EditInfo[] = [];
  private currentFlow: FlowContext | null = null;
  private flowUpdateTimer: NodeJS.Timeout | null = null;
  private readonly maxRecentEdits = 20;
  private readonly flowUpdateDebounce = 3000;

  private _onFlowChange = new vscode.EventEmitter<FlowContext>();
  readonly onFlowChange = this._onFlowChange.event;

  constructor(private readonly aiClient: AIClient) {
    this.setupListeners();
  }

  private setupListeners(): void {
    // Track document changes
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.uri.scheme === 'file') {
          this.trackEdit(e);
        }
      })
    );

    // Track file opens
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
          this.trackFileOpen(editor.document);
        }
      })
    );

    // Track file saves
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(doc => {
        this.trackFileSave(doc);
      })
    );

    // Track terminal activity
    this.disposables.push(
      vscode.window.onDidOpenTerminal(() => {
        this.scheduleFlowUpdate();
      })
    );
  }

  private trackEdit(event: vscode.TextDocumentChangeEvent): void {
    const relativePath = vscode.workspace.asRelativePath(event.document.uri);

    // Summarize the change
    let changeType: 'add' | 'modify' | 'delete' = 'modify';
    let summary = '';

    for (const change of event.contentChanges) {
      if (change.text.length > 0 && change.rangeLength === 0) {
        changeType = 'add';
        summary = `Added ${change.text.split('\n').length} lines`;
      } else if (change.text.length === 0 && change.rangeLength > 0) {
        changeType = 'delete';
        summary = `Deleted ${change.rangeLength} characters`;
      } else {
        summary = `Modified ${change.rangeLength} characters`;
      }
    }

    this.recentEdits.push({
      file: relativePath,
      timestamp: Date.now(),
      changeType,
      summary,
    });

    // Keep only recent edits
    if (this.recentEdits.length > this.maxRecentEdits) {
      this.recentEdits.shift();
    }

    this.scheduleFlowUpdate();
  }

  private trackFileOpen(_document: vscode.TextDocument): void {
    this.scheduleFlowUpdate();
  }

  private trackFileSave(_document: vscode.TextDocument): void {
    this.scheduleFlowUpdate();
  }

  private scheduleFlowUpdate(): void {
    if (this.flowUpdateTimer) {
      clearTimeout(this.flowUpdateTimer);
    }

    this.flowUpdateTimer = setTimeout(() => {
      this.updateFlow();
    }, this.flowUpdateDebounce);
  }

  /**
   * Update the current flow state using AI
   */
  private async updateFlow(): Promise<void> {
    if (this.recentEdits.length === 0) {
      return;
    }

    try {
      // Get current editor context
      const editor = vscode.window.activeTextEditor;
      const currentFile = editor
        ? vscode.workspace.asRelativePath(editor.document.uri)
        : null;

      // Build context for AI
      const editSummary = this.recentEdits
        .slice(-10)
        .map(e => `${e.file}: ${e.summary}`)
        .join('\n');

      // Get file list
      const recentFiles = [...new Set(this.recentEdits.map(e => e.file))].slice(0, 10);

      const response = await this.aiClient.chat([
        {
          role: 'system',
          content: `You are analyzing a developer's coding session to understand what they're working on.
Based on their recent edits, determine:
1. What task they're likely working on (be specific)
2. What files are most relevant
3. What actions might help them next

Return JSON:
{
  "task": "description of what they're doing",
  "relevantFiles": ["file1", "file2"],
  "suggestedActions": [
    {"label": "action name", "description": "why helpful", "command": "vscode command", "priority": 1-10}
  ],
  "confidence": 0.0-1.0
}`,
        },
        {
          role: 'user',
          content: `Current file: ${currentFile || 'none'}

Recent edits:
${editSummary}

Recent files touched: ${recentFiles.join(', ')}

What is this developer working on?`,
        },
      ]);

      // Parse response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const flowData = JSON.parse(jsonMatch[0]);

        this.currentFlow = {
          currentTask: flowData.task || 'Unknown task',
          relevantFiles: flowData.relevantFiles || recentFiles,
          recentEdits: this.recentEdits.slice(-10),
          suggestedActions: (flowData.suggestedActions || []).map((a: any, i: number) => ({
            id: `flow-action-${i}`,
            label: a.label,
            description: a.description,
            command: a.command || 'codebuddy.chat',
            priority: a.priority || 5,
          })),
          confidence: flowData.confidence || 0.5,
        };

        this._onFlowChange.fire(this.currentFlow);
      }
    } catch (error) {
      // Silently fail - flow detection is optional
      console.error('Flow detection error:', error);
    }
  }

  /**
   * Get the current flow context
   */
  getFlow(): FlowContext | null {
    return this.currentFlow;
  }

  /**
   * Get suggested actions based on current flow
   */
  getSuggestedActions(): FlowAction[] {
    if (!this.currentFlow) {
      return this.getDefaultActions();
    }

    return [
      ...this.currentFlow.suggestedActions,
      ...this.getContextualActions(),
    ].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get default actions when no flow is detected
   */
  private getDefaultActions(): FlowAction[] {
    return [
      {
        id: 'explain',
        label: 'Explain Code',
        description: 'Explain the selected code',
        command: 'codebuddy.explain',
        priority: 8,
      },
      {
        id: 'review',
        label: 'Review Code',
        description: 'Review current file for issues',
        command: 'codebuddy.review',
        priority: 7,
      },
      {
        id: 'tests',
        label: 'Generate Tests',
        description: 'Generate tests for selected code',
        command: 'codebuddy.generateTests',
        priority: 6,
      },
      {
        id: 'cascade',
        label: 'Start Cascade',
        description: 'Start autonomous task',
        command: 'codebuddy.cascade',
        priority: 5,
      },
    ];
  }

  /**
   * Get contextual actions based on current state
   */
  private getContextualActions(): FlowAction[] {
    const actions: FlowAction[] = [];
    const editor = vscode.window.activeTextEditor;

    if (editor) {
      const language = editor.document.languageId;

      // Language-specific actions
      if (['typescript', 'javascript', 'typescriptreact', 'javascriptreact'].includes(language)) {
        actions.push({
          id: 'npm-install',
          label: 'Install Dependencies',
          description: 'Run npm install',
          command: 'codebuddy.runCommand',
          args: ['npm install'],
          priority: 3,
        });
      }

      if (language === 'python') {
        actions.push({
          id: 'pip-install',
          label: 'Install Dependencies',
          description: 'Run pip install',
          command: 'codebuddy.runCommand',
          args: ['pip install -r requirements.txt'],
          priority: 3,
        });
      }

      // If there's a selection, add inline edit
      if (!editor.selection.isEmpty) {
        actions.push({
          id: 'inline-edit',
          label: 'Edit Selection',
          description: 'Edit selected code with AI',
          command: 'codebuddy.inlineEdit',
          priority: 9,
        });
      }
    }

    // Git actions if changes detected
    actions.push({
      id: 'commit',
      label: 'Generate Commit',
      description: 'Generate commit message',
      command: 'codebuddy.generateCommit',
      priority: 4,
    });

    return actions;
  }

  /**
   * Clear flow state
   */
  clearFlow(): void {
    this.currentFlow = null;
    this.recentEdits = [];
    this._onFlowChange.fire({
      currentTask: '',
      relevantFiles: [],
      recentEdits: [],
      suggestedActions: [],
      confidence: 0,
    });
  }

  dispose(): void {
    if (this.flowUpdateTimer) {
      clearTimeout(this.flowUpdateTimer);
    }
    this._onFlowChange.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
