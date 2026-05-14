/**
 * Code Buddy Language Server Protocol (LSP) Server
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
import { CodeBuddyClient, CodeBuddyMessage } from '../codebuddy/client.js';
import { logger } from '../utils/logger.js';
import { CompletionCache } from './completion-cache.js';
import { gatherCompletionContext } from './context-gatherer.js';
import { AICompletionProvider } from './ai-completion-provider.js';
import type { AICompletionConfig } from './ai-completion-provider.js';
import { registerInlineCompletionHandler } from './inline-completion-handler.js';
import { detectProviderFromEnv, selectModelForDetectedProvider } from '../utils/provider-detector.js';

// Create connection
const connection = createConnection(ProposedFeatures.all);

// Document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Code Buddy client
let codebuddyClient: CodeBuddyClient | null = null;

// Settings
interface CodeBuddyLSPSettings {
  apiKey: string;
  model: string;
  enableDiagnostics: boolean;
  enableCompletions: boolean;
  maxTokens: number;
  /** AI inline completion settings */
  aiCompletion?: Partial<AICompletionConfig>;
}

const defaultSettings: CodeBuddyLSPSettings = {
  apiKey: '',
  model: 'grok-3-latest',
  enableDiagnostics: true,
  enableCompletions: true,
  maxTokens: 2048,
  aiCompletion: {
    enabled: true,
    debounceMs: 300,
    maxSuggestions: 3,
    maxTokens: 200,
  },
};

let globalSettings: CodeBuddyLSPSettings = defaultSettings;

// LRU cache for completions (100 entries, 5s TTL)
const completionCacheLRU = new CompletionCache({ maxEntries: 100, ttlMs: 5000 });

// AI completion provider (initialized after client is ready)
const aiCompletionProvider = new AICompletionProvider(
  null,
  completionCacheLRU,
  defaultSettings.aiCompletion,
);

function createConfiguredClient(): CodeBuddyClient | null {
  if (globalSettings.apiKey) {
    return new CodeBuddyClient(globalSettings.apiKey, globalSettings.model);
  }

  const provider = detectProviderFromEnv();
  if (!provider) {
    return null;
  }

  return new CodeBuddyClient(
    provider.apiKey,
    selectModelForDetectedProvider(provider, globalSettings.model),
    provider.baseURL,
  );
}

function initializeCodeBuddyClient(): void {
  codebuddyClient = createConfiguredClient();
  if (codebuddyClient) {
    aiCompletionProvider.setClient(codebuddyClient);
    logger.info('Code Buddy client initialized');
  } else {
    aiCompletionProvider.setClient(null);
    logger.warn('No AI provider configured');
  }
}

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  logger.info('Code Buddy LSP server initializing...');

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
  logger.info('Code Buddy LSP server initialized');

  initializeCodeBuddyClient();

  // Update AI completion config from settings
  if (globalSettings.aiCompletion) {
    aiCompletionProvider.updateConfig(globalSettings.aiCompletion);
  }

  // Register inline completion handler (textDocument/inlineCompletion)
  registerInlineCompletionHandler(connection, documents, aiCompletionProvider);
});

// Configuration change
connection.onDidChangeConfiguration((change) => {
  globalSettings = {
    ...defaultSettings,
    ...(change.settings?.grok || {}),
  };

  // Reinitialize client
  initializeCodeBuddyClient();

  // Update AI completion config
  if (globalSettings.aiCompletion) {
    aiCompletionProvider.updateConfig(globalSettings.aiCompletion);
  }

  // Revalidate all documents
  documents.all().forEach(validateTextDocument);
});

// Document validation (diagnostics)
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  if (!codebuddyClient || !globalSettings.enableDiagnostics) {
    return;
  }

  const text = textDocument.getText();
  const languageId = textDocument.languageId;

  // Skip very large documents
  if (text.length > 50000) {
    return;
  }

  try {
    const messages: CodeBuddyMessage[] = [
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

    const response = await codebuddyClient.chat(messages, []);
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
        source: 'Code Buddy',
      };
    });

    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
  } catch (error) {
    logger.error(`Validation error: ${error}`);
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
    if (!globalSettings.enableCompletions) {
      return [];
    }

    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return [];
    }

    const text = document.getText();
    const filePath = params.textDocument.uri;
    const { line, character } = params.position;

    // Gather structured context
    const ctx = gatherCompletionContext(text, filePath, line, character);

    // Check LRU cache (key = filePath:line:prefix)
    const cacheKey = `${filePath}:${line}:${ctx.prefix}`;
    const cached = completionCacheLRU.get(cacheKey);
    if (cached) {
      return cached as CompletionItem[];
    }

    // If no LLM client, return empty (don't block the editor)
    if (!codebuddyClient) {
      return [];
    }

    try {
      const contextLines = [
        ...ctx.linesBefore.slice(-10),
        ctx.prefix + '<CURSOR>' + ctx.suffix,
        ...ctx.linesAfter.slice(0, 3),
      ].join('\n');

      const messages: CodeBuddyMessage[] = [
        {
          role: 'system',
          content: `You are a ${ctx.language} code completion engine. Suggest completions. Context: ${ctx.triggerKind}.`,
        },
        {
          role: 'user',
          content: `Complete this ${ctx.language} code. Provide 3-5 suggestions.

${contextLines}

Return JSON: [{"label": "<completion>", "detail": "<description>", "kind": "function|variable|class|property|method"}]`,
        },
      ];

      const response = await codebuddyClient.chat(messages, []);
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
        detail: s.detail ? `${s.detail} \u2728 Code Buddy` : '\u2728 Code Buddy',
        kind: mapCompletionKind(s.kind),
        sortText: String(i).padStart(3, '0'),
        data: i,
      }));

      // Cache results in LRU cache (auto-expires via TTL)
      completionCacheLRU.set(cacheKey, completions);

      // Add AI-powered completions alongside static completions
      if (aiCompletionProvider.getConfig().enabled) {
        try {
          const aiItems = await aiCompletionProvider.provideCompletions(
            filePath,
            { line, character },
            {
              prefix: ctx.prefix,
              suffix: ctx.suffix,
              language: ctx.language,
              filePath: ctx.filePath,
              linesBefore: ctx.linesBefore,
              linesAfter: ctx.linesAfter,
            },
          );
          completions.push(...aiItems);
        } catch (aiError) {
          logger.error(`AI completion error: ${aiError}`);
        }
      }

      return completions;
    } catch (error) {
      logger.error(`Completion error: ${error}`);
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
      if (diagnostic.source === 'Code Buddy') {
        actions.push({
          title: `Fix: ${diagnostic.message.slice(0, 50)}...`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: true,
          command: {
            command: 'codebuddy.fix',
            title: 'Fix with Code Buddy',
            arguments: [params.textDocument.uri, diagnostic.range],
          },
        });
      }
    }

    // Refactor actions when text is selected
    if (params.range.start.line !== params.range.end.line ||
        params.range.start.character !== params.range.end.character) {
      actions.push({
        title: 'Refactor with Code Buddy',
        kind: CodeActionKind.Refactor,
        command: {
          command: 'codebuddy.refactor',
          title: 'Refactor',
          arguments: [params.textDocument.uri, params.range],
        },
      });

      actions.push({
        title: 'Explain with Code Buddy',
        kind: CodeActionKind.Source,
        command: {
          command: 'codebuddy.explain',
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
    if (!codebuddyClient) {
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
      const messages: CodeBuddyMessage[] = [
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

      const response = await codebuddyClient.chat(messages, []);
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
      logger.error(`Hover error: ${error}`);
    }

    return null;
  }
);

// Signature help
connection.onSignatureHelp(
  async (params: TextDocumentPositionParams): Promise<SignatureHelp | null> => {
    if (!codebuddyClient) {
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
      const messages: CodeBuddyMessage[] = [
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

      const response = await codebuddyClient.chat(messages, []);
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
      logger.error(`Signature help error: ${error}`);
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

logger.info('Code Buddy LSP server started');
