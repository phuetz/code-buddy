import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import type { ToolResult } from '../types/index.js';
import { logger } from '../utils/logger.js';

/** Report local grammar errors after a write, without executing project code. */
export async function appendEditSyntaxDiagnostics(result: ToolResult, files: string[]): Promise<ToolResult> {
  if (!result.success) return result;
  const errors: string[] = [];
  for (const file of new Set(files)) {
    const extension = extname(file).toLowerCase();
    if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json'].includes(extension)) continue;
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > 2 * 1024 * 1024) continue;
      const content = await readFile(file, 'utf8');
      if (extension === '.json') {
        try { JSON.parse(content); }
        catch (error) { errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`); }
        continue;
      }
      const ts = await import('typescript');
      const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
      // Deliberately no config, imports, libraries, emit or filesystem callbacks:
      // this is a grammar check, not a substitute for project typechecking.
      const host: import('typescript').CompilerHost = {
        getSourceFile: name => name === file ? source : undefined,
        getDefaultLibFileName: () => '', writeFile: () => {},
        getCurrentDirectory: () => '', getDirectories: () => [],
        fileExists: name => name === file, readFile: name => name === file ? content : undefined,
        getCanonicalFileName: name => name, useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
      };
      const program = ts.createProgram([file], {
        noLib: true, noResolve: true, allowJs: true,
        target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve,
      }, host);
      // TS1162 (optional object member) is reported in the semantic phase.
      // Do not include other semantic errors: they may depend on project config.
      const diagnostics = [...program.getSyntacticDiagnostics(source),
        ...program.getSemanticDiagnostics(source).filter(d => d.code === 1162)];
      for (const diagnostic of diagnostics.slice(0, 8)) {
        const position = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        errors.push(`${file}:${position.line + 1}:${position.character + 1} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
      }
    } catch (error) {
      // Deleted files and unavailable parsers are not successful validations.
      logger.debug('Post-edit grammar check unavailable', { file, error: String(error) });
    }
  }
  if (!errors.length) return result;
  return { ...result, output: `${result.output ?? ''}\n\nEdit applied, but syntax checking failed. Fix these diagnostics, then run the project checks:\n${errors.join('\n')}`,
    metadata: { ...result.metadata, syntaxDiagnostics: errors } };
}
