/**
 * Read-only LSP navigation tools.
 *
 * These tools expose the existing outbound LSP client to the agent. They do
 * not implement language intelligence themselves: symbol, definition,
 * reference, hover, outline, and diagnostic data all come from the configured
 * language server. Target files are confined to the active workspace
 * (`context.cwd`, symlinks resolved), mirroring `view_file`.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  LSPDiagnostic,
  LSPHoverInfo,
  LSPLanguage,
  LSPLocation,
  LSPServerConfig,
  LSPSymbol,
} from '../lsp/lsp-client.js';
import { getLSPClient } from '../lsp/lsp-client.js';
import type { ToolResult } from '../types/index.js';
import { commandExists } from '../utils/command-exists.js';
import type {
  ITool,
  IToolExecutionContext,
  IToolMetadata,
  IValidationResult,
  JsonSchemaProperty,
  ToolSchema,
} from './registry/types.js';

const MAX_RENDERED_LOCATIONS = 200;
const MAX_RENDERED_SYMBOLS = 300;

export interface LspReadClient {
  detectLanguage(filePath: string): LSPLanguage | null;
  getServerConfig(language: LSPLanguage): LSPServerConfig | null;
  ensureServerForFile(filePath: string): Promise<boolean>;
  goToDefinition(file: string, line: number, column: number): Promise<LSPLocation[]>;
  findReferences(file: string, line: number, column: number): Promise<LSPLocation[]>;
  hover(file: string, line: number, column: number): Promise<LSPHoverInfo | null>;
  getDocumentSymbols(file: string): Promise<LSPSymbol[]>;
  getDiagnostics(file: string): Promise<LSPDiagnostic[]>;
}

export interface LspToolDependencies {
  client?: LspReadClient;
  commandExists?: (command: string) => Promise<boolean>;
}

interface LspPosition {
  line: number;
  column: number;
}

interface LspExecutionContext {
  file: string;
  language: LSPLanguage;
  symbol?: string;
  position?: LspPosition;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function getColumn(input: Record<string, unknown>): unknown {
  return input.column ?? input.col;
}

function formatLocation(location: LSPLocation): string {
  const start = `${location.file}:${location.line}:${location.column}`;
  if (location.endLine === undefined || location.endColumn === undefined) return start;
  if (location.endLine === location.line && location.endColumn === location.column) return start;
  return `${start}-${location.endLine}:${location.endColumn}`;
}

function describeSelector(context: LspExecutionContext): string {
  if (context.symbol) return `symbol "${context.symbol}"`;
  const position = context.position;
  return position ? `${context.file}:${position.line}:${position.column}` : context.file;
}

function findSymbol(symbols: LSPSymbol[], name: string): LSPSymbol | null {
  for (const symbol of symbols) {
    if (symbol.name === name) return symbol;
    if (symbol.children) {
      const child = findSymbol(symbol.children, name);
      if (child) return child;
    }
  }
  return null;
}

function isIdentifierCharacter(value: string | undefined): boolean {
  return value !== undefined && /[A-Za-z0-9_$]/.test(value);
}

function findTextPosition(text: string, symbol: string): LspPosition | null {
  let offset = text.indexOf(symbol);
  const requiresBoundary =
    isIdentifierCharacter(symbol[0]) && isIdentifierCharacter(symbol[symbol.length - 1]);

  while (offset >= 0) {
    const before = offset > 0 ? text[offset - 1] : undefined;
    const after = text[offset + symbol.length];
    if (!requiresBoundary || (!isIdentifierCharacter(before) && !isIdentifierCharacter(after))) {
      const prefix = text.slice(0, offset);
      const lastNewline = prefix.lastIndexOf('\n');
      return {
        line: prefix.split('\n').length,
        column: offset - lastNewline,
      };
    }
    offset = text.indexOf(symbol, offset + symbol.length);
  }

  return null;
}

function renderSymbols(symbols: LSPSymbol[], depth = 0, lines: string[] = []): string[] {
  for (const symbol of symbols) {
    if (lines.length >= MAX_RENDERED_SYMBOLS) return lines;
    lines.push(
      `${'  '.repeat(depth)}- [${symbol.kind}] ${symbol.name} — ${formatLocation(symbol.location)}`
    );
    if (symbol.children) renderSymbols(symbol.children, depth + 1, lines);
  }
  return lines;
}

abstract class LspReadOnlyTool implements ITool {
  abstract readonly name: string;
  abstract readonly description: string;
  protected abstract readonly needsPosition: boolean;
  protected abstract readonly metadataKeywords: string[];

  protected readonly client: LspReadClient;
  private readonly commandIsAvailable: (command: string) => Promise<boolean>;

  constructor(dependencies: LspToolDependencies = {}) {
    this.client = dependencies.client ?? getLSPClient();
    this.commandIsAvailable = dependencies.commandExists ?? commandExists;
  }

  async execute(
    input: Record<string, unknown>,
    context?: IToolExecutionContext
  ): Promise<ToolResult> {
    const validation = this.validate(input);
    if (!validation.valid) {
      return { success: false, error: `Validation failed: ${validation.errors?.join(', ')}` };
    }

    const requestedFile = input.file as string;
    const workspaceRoot = path.resolve(context?.cwd ?? process.cwd());
    const resolvedFile = path.resolve(workspaceRoot, requestedFile);
    if (!isPathInside(workspaceRoot, resolvedFile)) {
      return { success: false, error: `LSP target is outside the active workspace: ${requestedFile}` };
    }

    try {
      const stat = await fs.stat(resolvedFile);
      if (!stat.isFile()) {
        return { success: false, error: `LSP target is not a regular file: ${resolvedFile}` };
      }
      // Symlinks inside the workspace must not point at files outside it.
      const [realFile, realRoot] = await Promise.all([
        fs.realpath(resolvedFile),
        fs.realpath(workspaceRoot),
      ]);
      if (!isPathInside(realRoot, realFile)) {
        return {
          success: false,
          error: `LSP target resolves outside the active workspace: ${requestedFile}`,
        };
      }
    } catch {
      return {
        success: false,
        error: `LSP target file was not found or is unreadable: ${resolvedFile}`,
      };
    }

    const language = this.client.detectLanguage(resolvedFile);
    if (!language) {
      return { success: false, error: `No LSP language is configured for file: ${resolvedFile}` };
    }

    const serverConfig = this.client.getServerConfig(language);
    if (!serverConfig) {
      return { success: false, error: `No LSP server is configured for language "${language}".` };
    }

    try {
      if (!(await this.commandIsAvailable(serverConfig.command))) {
        return {
          success: false,
          error:
            `No LSP server is available for ${language}: command "${serverConfig.command}" was not found in PATH. ` +
            'Install or configure the language server (see `buddy lsp status`).',
        };
      }

      if (!(await this.client.ensureServerForFile(resolvedFile))) {
        return {
          success: false,
          error:
            `The ${language} LSP server "${serverConfig.command}" could not be started or initialized. ` +
            'Check the server installation and configuration.',
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error:
          `The ${language} LSP server "${serverConfig.command}" could not be checked or initialized: ` +
          message,
      };
    }

    try {
      const executionContext: LspExecutionContext = {
        file: resolvedFile,
        language,
      };

      if (this.needsPosition) {
        const coordinatesProvided =
          isPositiveInteger(input.line) && isPositiveInteger(getColumn(input));
        executionContext.position = await this.resolvePosition(input, resolvedFile);
        if (!coordinatesProvided && typeof input.symbol === 'string' && input.symbol.trim()) {
          executionContext.symbol = input.symbol.trim();
        }
      }

      return await this.run(executionContext);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `${this.name} failed: ${message}` };
    }
  }

  validate(input: unknown): IValidationResult {
    if (!isRecord(input)) return { valid: false, errors: ['Input must be an object'] };

    const errors: string[] = [];
    if (typeof input.file !== 'string' || input.file.trim() === '') {
      errors.push('file must be a non-empty string');
    }

    if (this.needsPosition) {
      const symbolProvided = input.symbol !== undefined;
      const lineProvided = input.line !== undefined;
      const columnProvided = input.column !== undefined || input.col !== undefined;

      if (symbolProvided && (typeof input.symbol !== 'string' || input.symbol.trim() === '')) {
        errors.push('symbol must be a non-empty string when provided');
      }
      if (input.column !== undefined && input.col !== undefined && input.column !== input.col) {
        errors.push('column and col must not disagree');
      }
      if (lineProvided !== columnProvided) {
        errors.push('line and column (or col) must be provided together');
      }
      if (lineProvided && !isPositiveInteger(input.line)) {
        errors.push('line must be a positive integer (1-based)');
      }
      if (columnProvided && !isPositiveInteger(getColumn(input))) {
        errors.push('column must be a positive integer (1-based)');
      }
      if (!symbolProvided && !(lineProvided && columnProvided)) {
        errors.push('provide either symbol or both line and column (1-based)');
      }
    }

    return errors.length > 0 ? { valid: false, errors } : { valid: true };
  }

  getSchema(): ToolSchema {
    const properties: Record<string, JsonSchemaProperty> = {
      file: {
        type: 'string',
        description:
          'Path to the source file, relative to the active workspace (or absolute, inside it)',
      },
    };

    if (this.needsPosition) {
      properties.symbol = {
        type: 'string',
        description:
          'Symbol name to locate in the file; use line and column for ambiguous occurrences',
      };
      properties.line = {
        type: 'number',
        description: '1-based line number; must be paired with column',
      };
      properties.column = {
        type: 'number',
        description: '1-based column number; must be paired with line',
      };
      properties.col = {
        type: 'number',
        description: 'Alias for column (1-based)',
      };
    }

    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties,
        required: ['file'],
        additionalProperties: false,
      },
    };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'codebase',
      keywords: this.metadataKeywords,
      priority: 9,
      modifiesFiles: false,
      makesNetworkRequests: false,
      fleetSafe: true,
    };
  }

  protected abstract run(context: LspExecutionContext): Promise<ToolResult>;

  private async resolvePosition(
    input: Record<string, unknown>,
    file: string
  ): Promise<LspPosition> {
    if (isPositiveInteger(input.line) && isPositiveInteger(getColumn(input))) {
      const line = input.line;
      const column = getColumn(input) as number;
      const text = await fs.readFile(file, 'utf8');
      const lines = text.split('\n');
      const lineText = lines[line - 1]?.replace(/\r$/, '');
      if (lineText === undefined || column > lineText.length + 1) {
        throw new Error(`Position ${line}:${column} is outside ${file}.`);
      }
      return { line, column };
    }

    const symbol = (input.symbol as string).trim();
    const semanticSymbol = findSymbol(await this.client.getDocumentSymbols(file), symbol);
    if (semanticSymbol) {
      return {
        line: semanticSymbol.location.line,
        column: semanticSymbol.location.column,
      };
    }

    const text = await fs.readFile(file, 'utf8');
    const textPosition = findTextPosition(text, symbol);
    if (!textPosition) {
      throw new Error(`Symbol "${symbol}" was not found in ${file}.`);
    }
    return textPosition;
  }
}

export class LspDefinitionTool extends LspReadOnlyTool {
  readonly name = 'lsp_definition';
  readonly description =
    'Resolve the semantic definition of a symbol using the configured language server. Read-only; accepts either a symbol name or a 1-based line and column.';
  protected readonly needsPosition = true;
  protected readonly metadataKeywords = [
    'lsp',
    'definition',
    'declaration',
    'go to definition',
    'semantic navigation',
    'symbol',
  ];

  protected async run(context: LspExecutionContext): Promise<ToolResult> {
    const position = context.position;
    if (!position) throw new Error('Internal error: definition position was not resolved.');
    const locations = await this.client.goToDefinition(
      context.file,
      position.line,
      position.column
    );
    const visible = locations.slice(0, MAX_RENDERED_LOCATIONS);
    const output =
      locations.length === 0
        ? `No definition was returned by the ${context.language} LSP server for ${describeSelector(context)}.`
        : [
            `Definition${locations.length === 1 ? '' : 's'} for ${describeSelector(context)} (${locations.length}):`,
            ...visible.map((location) => `- ${formatLocation(location)}`),
            ...(locations.length > visible.length
              ? [`- ... ${locations.length - visible.length} more location(s) omitted`]
              : []),
          ].join('\n');
    return {
      success: true,
      output,
      data: {
        file: context.file,
        language: context.language,
        position,
        locations: visible,
        total: locations.length,
      },
    };
  }
}

export class LspReferencesTool extends LspReadOnlyTool {
  readonly name = 'lsp_references';
  readonly description =
    'Find semantic references to a symbol using the configured language server. Read-only; accepts either a symbol name or a 1-based line and column.';
  protected readonly needsPosition = true;
  protected readonly metadataKeywords = [
    'lsp',
    'references',
    'usages',
    'callers',
    'where used',
    'semantic navigation',
    'symbol',
  ];

  protected async run(context: LspExecutionContext): Promise<ToolResult> {
    const position = context.position;
    if (!position) throw new Error('Internal error: reference position was not resolved.');
    const locations = await this.client.findReferences(
      context.file,
      position.line,
      position.column
    );
    const visible = locations.slice(0, MAX_RENDERED_LOCATIONS);
    const output =
      locations.length === 0
        ? `No references were returned by the ${context.language} LSP server for ${describeSelector(context)}.`
        : [
            `References for ${describeSelector(context)} (${locations.length}):`,
            ...visible.map((location) => `- ${formatLocation(location)}`),
            ...(locations.length > visible.length
              ? [`- ... ${locations.length - visible.length} more reference(s) omitted`]
              : []),
          ].join('\n');
    return {
      success: true,
      output,
      data: {
        file: context.file,
        language: context.language,
        position,
        locations: visible,
        total: locations.length,
      },
    };
  }
}

export class LspHoverTool extends LspReadOnlyTool {
  readonly name = 'lsp_hover';
  readonly description =
    'Return semantic hover/type information from the configured language server. Read-only; accepts either a symbol name or a 1-based line and column.';
  protected readonly needsPosition = true;
  protected readonly metadataKeywords = [
    'lsp',
    'hover',
    'type',
    'signature',
    'documentation',
    'semantic information',
    'symbol',
  ];

  protected async run(context: LspExecutionContext): Promise<ToolResult> {
    const position = context.position;
    if (!position) throw new Error('Internal error: hover position was not resolved.');
    const hover = await this.client.hover(context.file, position.line, position.column);
    if (!hover) {
      return {
        success: true,
        output: `No hover information was returned by the ${context.language} LSP server for ${describeSelector(context)}.`,
        data: { file: context.file, language: context.language, position, hover: null },
      };
    }

    const range = hover.range ? `\n\nRange: ${formatLocation(hover.range)}` : '';
    return {
      success: true,
      output: `Hover for ${describeSelector(context)}:\n\n${hover.content}${range}`,
      data: { file: context.file, language: context.language, position, hover },
    };
  }
}

export class LspSymbolsTool extends LspReadOnlyTool {
  readonly name = 'lsp_symbols';
  readonly description =
    'Return the semantic document outline (classes, functions, methods, variables, and nested symbols) from the configured language server. Read-only.';
  protected readonly needsPosition = false;
  protected readonly metadataKeywords = [
    'lsp',
    'symbols',
    'outline',
    'classes',
    'functions',
    'methods',
    'document structure',
    'semantic navigation',
  ];

  protected async run(context: LspExecutionContext): Promise<ToolResult> {
    const symbols = await this.client.getDocumentSymbols(context.file);
    if (symbols.length === 0) {
      return {
        success: true,
        output: `No document symbols were returned by the ${context.language} LSP server for ${context.file}.`,
        data: { file: context.file, language: context.language, symbols: [] },
      };
    }

    const lines = renderSymbols(symbols);
    const truncated = lines.length >= MAX_RENDERED_SYMBOLS;
    return {
      success: true,
      output: [
        `Document symbols for ${context.file}:`,
        ...lines,
        ...(truncated ? [`- ... outline truncated after ${MAX_RENDERED_SYMBOLS} symbols`] : []),
      ].join('\n'),
      data: { file: context.file, language: context.language, symbols },
    };
  }
}

export class LspDiagnosticsTool extends LspReadOnlyTool {
  readonly name = 'lsp_diagnostics';
  readonly description =
    'Return diagnostics published by the configured language server for a source file. Read-only; distinguishes a clean file from an unavailable server.';
  protected readonly needsPosition = false;
  protected readonly metadataKeywords = [
    'lsp',
    'diagnostics',
    'errors',
    'warnings',
    'typecheck',
    'lint',
    'semantic analysis',
  ];

  protected async run(context: LspExecutionContext): Promise<ToolResult> {
    const diagnostics = await this.client.getDiagnostics(context.file);
    if (diagnostics.length === 0) {
      return {
        success: true,
        output: `No diagnostics were published by the ${context.language} LSP server for ${context.file}.`,
        data: { file: context.file, language: context.language, diagnostics: [] },
      };
    }

    return {
      success: true,
      output: [
        `Diagnostics for ${context.file} (${diagnostics.length}):`,
        ...diagnostics.map(
          (diagnostic) =>
            `- ${diagnostic.severity.toUpperCase()} ${diagnostic.file}:${diagnostic.line}:${diagnostic.column}` +
            `${diagnostic.source ? ` [${diagnostic.source}]` : ''} — ${diagnostic.message}`
        ),
      ].join('\n'),
      data: { file: context.file, language: context.language, diagnostics },
    };
  }
}
