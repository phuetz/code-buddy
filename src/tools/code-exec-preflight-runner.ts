/**
 * Standalone isolated TypeScript preflight compiler runner.
 *
 * Runs inside an isolated worker/child process with:
 * - 128MB max heap limit (--max-old-space-size=128)
 * - Virtual in-memory file system (zero disk I/O for guest files)
 * - Bounded diagnostics (max 20 diagnostics / 16KB formatted error size)
 * - Full rejection of global, compiler options, environment, and guest diagnostics
 * - Complete isolation from external module imports
 */

import ts from 'typescript';
import path from 'node:path';
import { createRequire } from 'node:module';

export interface PreflightWorkerPayload {
  code: string;
  declarations: string;
  strict?: boolean;
  target?: string;
}

export interface PreflightDiagnostic {
  line?: number;
  column?: number;
  message: string;
  code?: number;
  category: 'error' | 'warning' | 'suggestion' | 'message';
  file?: string;
}

export interface PreflightWorkerResult {
  success: boolean;
  diagnostics: PreflightDiagnostic[];
  error?: string;
  transpiledCode?: string;
  declarations?: string;
}

export const PREFLIGHT_LIMITS = Object.freeze({
  timeoutMs: 5_000,
  maxHeapMb: 128,
  maxDiagnostics: 20,
  maxErrorBytes: 16 * 1024,
});

const require = createRequire(import.meta.url);
const tsLibDir = path.dirname(require.resolve('typescript'));
const tsLibCache = new Map<string, ts.SourceFile>();

function getCachedLibSourceFile(
  fileName: string,
  languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions,
): ts.SourceFile | undefined {
  const baseName = path.basename(fileName);
  if (tsLibCache.has(baseName)) {
    return tsLibCache.get(baseName);
  }
  const fullPath = path.join(tsLibDir, baseName);
  if (ts.sys.fileExists(fullPath)) {
    const content = ts.sys.readFile(fullPath);
    if (content !== undefined) {
      const sf = ts.createSourceFile(fileName, content, languageVersionOrOptions, true);
      tsLibCache.set(baseName, sf);
      return sf;
    }
  }
  return undefined;
}

const defaultCompilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noImplicitAny: true,
  strictNullChecks: true,
  strictFunctionTypes: true,
  strictBindCallApply: true,
  strictPropertyInitialization: true,
  noImplicitThis: true,
  alwaysStrict: true,
  noUnusedLocals: false,
  noUnusedParameters: false,
  exactOptionalPropertyTypes: false,
  noEmit: true,
  skipLibCheck: true,
};

/**
 * Execute isolated in-memory TypeScript compilation and diagnostic collection.
 */
export function executePreflightCompilation(payload: PreflightWorkerPayload): PreflightWorkerResult {
  const { code, declarations, strict, target } = payload;
  const syntax = ts.createSourceFile('/input.ts', code, ts.ScriptTarget.ES2022, true);
  let forbidden: string | undefined;
  const inspect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isImportTypeNode(node)
      || (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
      forbidden = 'Module imports are not allowed in code_exec scripts';
    }
    if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) forbidden = 'Ambient module declarations are not allowed in code_exec scripts';
    ts.forEachChild(node, inspect);
  };
  inspect(syntax);
  if (syntax.referencedFiles.length || syntax.typeReferenceDirectives.length || syntax.libReferenceDirectives.length) forbidden = 'TypeScript triple-slash reference directives are not allowed in code_exec scripts';
  if (forbidden) return { success: false, diagnostics: [{ message: forbidden, category: 'error' }], error: forbidden };
  const wrappedGuestCode = `async function __codeBuddyMain() {\n${code}\n}`;

  const virtualFiles = new Map<string, string>([
    ['/code_exec_env.d.ts', declarations],
    ['/guest_code.ts', wrappedGuestCode],
  ]);

  let scriptTarget = ts.ScriptTarget.ES2022;
  if (target) {
    const targetUpper = target.toUpperCase();
    if (targetUpper === 'ES2020') scriptTarget = ts.ScriptTarget.ES2020;
    else if (targetUpper === 'ES2021') scriptTarget = ts.ScriptTarget.ES2021;
    else if (targetUpper === 'ES2022') scriptTarget = ts.ScriptTarget.ES2022;
    else if (targetUpper === 'ESNEXT') scriptTarget = ts.ScriptTarget.ESNext;
  }

  const compilerOptions: ts.CompilerOptions = {
    ...defaultCompilerOptions,
    target: scriptTarget,
    ...(strict !== undefined ? { strict } : {}),
  };

  const host: ts.CompilerHost = {
    getSourceFile: (fileName, languageVersion) => {
      if (virtualFiles.has(fileName)) {
        return ts.createSourceFile(
          fileName,
          virtualFiles.get(fileName)!,
          languageVersion,
          true,
          ts.ScriptKind.TS,
        );
      }
      if (fileName.includes('lib.') && fileName.endsWith('.d.ts')) {
        return getCachedLibSourceFile(fileName, languageVersion);
      }
      return undefined;
    },
    getDefaultLibFileName: (opts) => ts.getDefaultLibFileName(opts),
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getDirectories: () => [],
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) =>
      virtualFiles.has(fileName) ||
      (fileName.includes('lib.') &&
        ts.sys.fileExists(path.join(tsLibDir, path.basename(fileName)))),
    readFile: (fileName) =>
      virtualFiles.get(fileName) ||
      (fileName.includes('lib.')
        ? ts.sys.readFile(path.join(tsLibDir, path.basename(fileName)))
        : undefined),
    resolveModuleNameLiterals: () => [],
    resolveModuleNames: () => [],
  };

  const program = ts.createProgram(
    ['/code_exec_env.d.ts', '/guest_code.ts'],
    compilerOptions,
    host,
  );

  // Collect all diagnostics: syntactic, global, options, semantic, declaration
  const syntacticDiagnostics = program.getSyntacticDiagnostics();
  const globalDiagnostics = program.getGlobalDiagnostics();
  const optionsDiagnostics = program.getOptionsDiagnostics();
  const semanticDiagnostics = program.getSemanticDiagnostics();
  const declarationDiagnostics = program.getDeclarationDiagnostics();

  const allDiagnostics: readonly ts.Diagnostic[] = [
    ...syntacticDiagnostics,
    ...globalDiagnostics,
    ...optionsDiagnostics,
    ...semanticDiagnostics,
    ...declarationDiagnostics,
  ];

  const errorDiagnostics = allDiagnostics.filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );

  if (errorDiagnostics.length === 0) {
    let transpiledCode: string | undefined;
    try {
      const transpiled = ts.transpileModule(code, {
        compilerOptions: {
          target: compilerOptions.target ?? ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      });
      transpiledCode = transpiled.outputText;
    } catch {
      // Retain original code if transpilation throws
    }

    return {
      success: true,
      diagnostics: [],
      transpiledCode,
      declarations,
    };
  }

  const formattedDiagnostics: PreflightDiagnostic[] = [];
  const errorMessages: string[] = [];

  for (const d of errorDiagnostics) {
    let line: number | undefined;
    let column: number | undefined;
    const fileName = d.file?.fileName;

    if (d.file && d.start !== undefined) {
      const pos = d.file.getLineAndCharacterOfPosition(d.start);
      if (fileName === '/guest_code.ts') {
        // Adjust line number for the async wrapper
        line = Math.max(1, pos.line);
      } else {
        line = pos.line + 1;
      }
      column = pos.character + 1;
    }

    const msgText = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    const category: PreflightDiagnostic['category'] =
      d.category === ts.DiagnosticCategory.Error
        ? 'error'
        : d.category === ts.DiagnosticCategory.Warning
        ? 'warning'
        : d.category === ts.DiagnosticCategory.Suggestion
        ? 'suggestion'
        : 'message';

    formattedDiagnostics.push({
      line,
      column,
      message: msgText,
      code: d.code,
      category,
      file: fileName,
    });

    let loc = '';
    if (fileName === '/guest_code.ts') {
      loc = line !== undefined ? `Line ${line}${column !== undefined ? `:${column}` : ''}: ` : '';
    } else if (fileName === '/code_exec_env.d.ts') {
      loc = `[Environment${line !== undefined ? ` Line ${line}` : ''}]: `;
    } else if (fileName) {
      loc = `[${fileName}${line !== undefined ? ` Line ${line}` : ''}]: `;
    } else {
      loc = '[Global/Compiler]: ';
    }
    errorMessages.push(`${loc}${msgText}`);
  }

  const boundedDiagnostics = formattedDiagnostics.slice(0, PREFLIGHT_LIMITS.maxDiagnostics);
  const totalErrors = errorDiagnostics.length;
  const header =
    totalErrors > PREFLIGHT_LIMITS.maxDiagnostics
      ? `TypeScript preflight validation failed (${PREFLIGHT_LIMITS.maxDiagnostics} of ${totalErrors} errors shown):\n`
      : 'TypeScript preflight validation failed:\n';

  let summary = header + errorMessages.slice(0, PREFLIGHT_LIMITS.maxDiagnostics).map((m) => `• ${m}`).join('\n');
  if (totalErrors > PREFLIGHT_LIMITS.maxDiagnostics) {
    summary += `\n…[truncated ${totalErrors - PREFLIGHT_LIMITS.maxDiagnostics} diagnostic(s)]`;
  }

  if (summary.length > PREFLIGHT_LIMITS.maxErrorBytes) {
    const marker = '\n…[truncated diagnostics exceeding 16KB limit]';
    summary = summary.slice(0, Math.max(0, PREFLIGHT_LIMITS.maxErrorBytes - marker.length)) + marker;
  }

  return {
    success: false,
    diagnostics: boundedDiagnostics,
    error: summary,
    declarations,
  };
}

// Standalone child process IPC listener
if (typeof process.send === 'function') {
  process.on('message', (rawMessage: unknown) => {
    if (!rawMessage || typeof rawMessage !== 'object') return;
    const msg = rawMessage as { type: string; payload?: PreflightWorkerPayload };
    if (msg.type === 'compile' && msg.payload) {
      try {
        const result = executePreflightCompilation(msg.payload);
        process.send!({ type: 'result', result });
      } catch (error) {
        process.send!({
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setImmediate(() => process.exit(0));
      }
    }
  });
}
