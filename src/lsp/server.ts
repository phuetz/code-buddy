/**
 * Grok Language Server Protocol (LSP) Server
 *
 * Provides IDE integration for any LSP-compatible editor:
 * - VS Code, Neovim, Sublime Text, Emacs, etc.
 *
 * Features:
 * - Code completions
 * - Diagnostics
 * - Code actions
 * - Hover information
 * - Signature help
 */

import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  Hover,
  SignatureHelp,
  MarkupKind,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { GrokClient, GrokMessage } from '../grok/client.js';

// Create connection
const connection = createConnection(ProposedFeatures.all);

// Document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Grok client
let grokClient: GrokClient | null = null;

// Settings
interface GrokLSPSettings {
  apiKey: string;
  model: string;
  enableDiagnostics: boolean;
  enableCompletions: boolean;
  maxTokens: number;
}

const defaultSettings: GrokLSPSettings = {
  apiKey: '',
  model: 'grok-3-latest',
  enableDiagnostics: true,
  enableCompletions: true,
  maxTokens: 2048,
};

let globalSettings: GrokLSPSettings = defaultSettings;

// Cache for completions
const completionCache = new Map<string, CompletionItem[]>();

connection.onInitialize((params: InitializeParams): InitializeResult => {
  connection.console.log('Grok LSP server initializing...');

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ['.', ':', '(', '<', '"', "'", '/', '@'],
      },
      codeActionProvider: {
        codeActionKinds: [
          CodeActionKind.QuickFix,
          CodeActionKind.Refactor,
          CodeActionKind.Source,
        ],
      },
      hoverProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ['(', ','],
      },
      diagnosticProvider: {
        interFileDependencies: false,
        workspaceDiagnostics: false,
      },
    },
  };
});

connection.onInitialized(() => {
  connection.console.log('Grok LSP server initialized');

  // Initialize Grok client with API key
  const apiKey = process.env.GROK_API_KEY || globalSettings.apiKey;
  if (apiKey) {
    grokClient = new GrokClient(apiKey, globalSettings.model);
    connection.console.log('Grok client initialized');
  } else {
    connection.console.warn('No API key configured');
  }
});

// Configuration change
connection.onDidChangeConfiguration((change) => {
  globalSettings = {
    ...defaultSettings,
    ...(change.settings?.grok || {}),
  };

  // Reinitialize client
  const apiKey = process.env.GROK_API_KEY || globalSettings.apiKey;
  if (apiKey) {
    grokClient = new GrokClient(apiKey, globalSettings.model);
  }

  // Revalidate all documents
  documents.all().forEach(validateTextDocument);
});

// Document validation (diagnostics)
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  if (!grokClient || !globalSettings.enableDiagnostics) {
    return;
  }

  const text = textDocument.getText();
  const languageId = textDocument.languageId;

  // Skip very large documents
  if (text.length > 50000) {
    return;
  }

  try {
    const messages: GrokMessage[] = [
      {
        role: 'system',
        content: `You are a code reviewer. Analyze the ${languageId} code for issues. Return a JSON array of issues.`,
      },
      {
        role: 'user',
        content: `Review this code and return issues as JSON:
\`\`\`${languageId}
${text.slice(0, 10000)}
\`\`\`

Format: [{"line": <1-indexed>, "severity": "error|warning|info", "message": "<description>"}]
Return [] if no issues.`,
      },
    ];

    const response = await grokClient.chat(messages, []);
    const content = response.choices[0]?.message?.content || '[]';

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return;
    }

    const issues = JSON.parse(jsonMatch[0]);
    const diagnostics: Diagnostic[] = issues.map((issue: {
      line: number;
      severity: string;
      message: string;
    }) => {
      const line = Math.max(0, (issue.line || 1) - 1);
      const lineText = textDocument.getText({
        start: { line, character: 0 },
        end: { line, character: 1000 },
      });

      return {
        severity: mapSeverity(issue.severity),
        range: {
          start: { line, character: 0 },
          end: { line, character: lineText.length },
        },
        message: issue.message,
        source: 'Grok',
      };
    });

    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
  } catch (error) {
    connection.console.error(`Validation error: ${error}`);
  }
}

function mapSeverity(severity: string): DiagnosticSeverity {
  switch (severity) {
    case 'error':
      return DiagnosticSeverity.Error;
    case 'warning':
      return DiagnosticSeverity.Warning;
    default:
      return DiagnosticSeverity.Information;
  }
}

// Completions
connection.onCompletion(
  async (params: TextDocumentPositionParams): Promise<CompletionItem[]> => {
    if (!grokClient || !globalSettings.enableCompletions) {
      return [];
    }

    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }

    const text = document.getText();
    const offset = document.offsetAt(params.position);
    const prefix = text.slice(Math.max(0, offset - 500), offset);
    const suffix = text.slice(offset, Math.min(text.length, offset + 200));
    const languageId = document.languageId;

    // Check cache
    const cacheKey = `${prefix.slice(-50)}|${params.position.line}`;
    if (completionCache.has(cacheKey)) {
      return completionCache.get(cacheKey)!;
    }

    try {
      const messages: GrokMessage[] = [
        {
          role: 'system',
          content: `You are a ${languageId} code completion engine. Suggest completions.`,
        },
        {
          role: 'user',
          content: `Complete this ${languageId} code. Provide 3-5 suggestions.
Prefix: ${prefix}
<CURSOR>
Suffix: ${suffix}

Return JSON: [{"label": "<completion>", "detail": "<description>", "kind": "function|variable|class|property|method"}]`,
        },
      ];

      const response = await grokClient.chat(messages, []);
      const content = response.choices[0]?.message?.content || '[]';

      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }

      const suggestions = JSON.parse(jsonMatch[0]);
      const completions: CompletionItem[] = suggestions.map((s: {
        label: string;
        detail?: string;
        kind?: string;
      }, i: number) => ({
        label: s.label,
        detail: s.detail,
        kind: mapCompletionKind(s.kind),
        sortText: String(i).padStart(3, '0'),
        data: i,
      }));

      // Cache results
      completionCache.set(cacheKey, completions);
      setTimeout(() => completionCache.delete(cacheKey), 30000);

      return completions;
    } catch (error) {
      connection.console.error(`Completion error: ${error}`);
      return [];
    }
  }
);

function mapCompletionKind(kind?: string): CompletionItemKind {
  switch (kind) {
    case 'function':
      return CompletionItemKind.Function;
    case 'variable':
      return CompletionItemKind.Variable;
    case 'class':
      return CompletionItemKind.Class;
    case 'property':
      return CompletionItemKind.Property;
    case 'method':
      return CompletionItemKind.Method;
    default:
      return CompletionItemKind.Text;
  }
}

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  return item;
});

// Code actions
connection.onCodeAction(
  async (params: CodeActionParams): Promise<CodeAction[]> => {
    const actions: CodeAction[] = [];
    const document = documents.get(params.textDocument.uri);

    if (!document) {
      return actions;
    }

    // Quick fixes for diagnostics
    for (const diagnostic of params.context.diagnostics) {
      if (diagnostic.source === 'Grok') {
        actions.push({
          title: `Fix: ${diagnostic.message.slice(0, 50)}...`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: true,
          command: {
            command: 'grok.fix',
            title: 'Fix with Grok',
            arguments: [params.textDocument.uri, diagnostic.range],
          },
        });
      }
    }

    // Refactor actions when text is selected
    if (params.range.start.line !== params.range.end.line ||
        params.range.start.character !== params.range.end.character) {
      actions.push({
        title: 'Refactor with Grok',
        kind: CodeActionKind.Refactor,
        command: {
          command: 'grok.refactor',
          title: 'Refactor',
          arguments: [params.textDocument.uri, params.range],
        },
      });

      actions.push({
        title: 'Explain with Grok',
        kind: CodeActionKind.Source,
        command: {
          command: 'grok.explain',
          title: 'Explain',
          arguments: [params.textDocument.uri, params.range],
        },
      });
    }

    return actions;
  }
);

// Hover
connection.onHover(
  async (params: TextDocumentPositionParams): Promise<Hover | null> => {
    if (!grokClient) {
      return null;
    }

    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return null;
    }

    // Get word at position
    const text = document.getText();
    const offset = document.offsetAt(params.position);
    const lineStart = text.lastIndexOf('\n', offset) + 1;
    const lineEnd = text.indexOf('\n', offset);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);

    // Find word boundaries
    const charPos = offset - lineStart;
    let wordStart = charPos;
    let wordEnd = charPos;

    while (wordStart > 0 && /\w/.test(line[wordStart - 1])) wordStart--;
    while (wordEnd < line.length && /\w/.test(line[wordEnd])) wordEnd++;

    const word = line.slice(wordStart, wordEnd);

    if (word.length < 2) {
      return null;
    }

    // Get context
    const context = text.slice(Math.max(0, offset - 200), Math.min(text.length, offset + 200));

    try {
      const messages: GrokMessage[] = [
        {
          role: 'system',
          content: 'You are a helpful coding assistant. Provide brief, accurate hover information.',
        },
        {
          role: 'user',
          content: `What is "${word}" in this context? Be brief (1-2 sentences).

Context:
${context}`,
        },
      ];

      const response = await grokClient.chat(messages, []);
      const content = response.choices[0]?.message?.content || '';

      if (content) {
        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: `**${word}**\n\n${content}`,
          },
        };
      }
    } catch (error) {
      connection.console.error(`Hover error: ${error}`);
    }

    return null;
  }
);

// Signature help
connection.onSignatureHelp(
  async (params: TextDocumentPositionParams): Promise<SignatureHelp | null> => {
    if (!grokClient) {
      return null;
    }

    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return null;
    }

    const text = document.getText();
    const offset = document.offsetAt(params.position);

    // Find function call context
    let depth = 0;
    let funcStart = offset - 1;

    while (funcStart >= 0) {
      if (text[funcStart] === ')') depth++;
      if (text[funcStart] === '(') {
        if (depth === 0) break;
        depth--;
      }
      funcStart--;
    }

    if (funcStart < 0) {
      return null;
    }

    // Get function name
    let nameEnd = funcStart;
    let nameStart = funcStart - 1;

    while (nameStart >= 0 && /\w/.test(text[nameStart])) {
      nameStart--;
    }

    const funcName = text.slice(nameStart + 1, nameEnd);

    if (funcName.length < 2) {
      return null;
    }

    const context = text.slice(Math.max(0, nameStart - 200), Math.min(text.length, offset + 50));

    try {
      const messages: GrokMessage[] = [
        {
          role: 'system',
          content: 'You are a helpful coding assistant. Provide function signature information.',
        },
        {
          role: 'user',
          content: `What are the parameters for "${funcName}"? Format: function(param1: type, param2: type): returnType

Context:
${context}`,
        },
      ];

      const response = await grokClient.chat(messages, []);
      const content = response.choices[0]?.message?.content || '';

      if (content) {
        return {
          signatures: [
            {
              label: content.split('\n')[0],
              documentation: content,
            },
          ],
          activeSignature: 0,
          activeParameter: 0,
        };
      }
    } catch (error) {
      connection.console.error(`Signature help error: ${error}`);
    }

    return null;
  }
);

// Document change handling
documents.onDidChangeContent((change) => {
  // Debounce validation
  setTimeout(() => {
    validateTextDocument(change.document);
  }, 1000);
});

// Listen
documents.listen(connection);
connection.listen();

connection.console.log('Grok LSP server started');
