/**
 * IDE Extensions Types
 *
 * Type definitions for IDE integration system.
 */

import * as net from 'net';

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

export const DEFAULT_IDE_CONFIG: IDEExtensionsConfig = {
  port: 9742,
  host: '127.0.0.1',
  vscodeEnabled: true,
  jetbrainsEnabled: true,
  neovimEnabled: true,
  sublimeEnabled: true,
  autoStart: false,
};
