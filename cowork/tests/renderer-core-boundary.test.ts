import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const coreRoot = path.resolve(process.cwd(), '..', 'src');
const rendererRoot = path.resolve(process.cwd(), 'src/renderer');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(filename) : /\.tsx?$/.test(filename) ? [filename] : [];
  });
}

describe('renderer → core browser boundary', () => {
  it('bundles every runtime core import without Node builtins, shims or the Node logger', async () => {
    const entries = new Set<string>();
    for (const filename of sourceFiles(rendererRoot)) {
      const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const clause = statement.importClause;
        if (clause?.isTypeOnly) continue;
        const bindings = clause?.namedBindings;
        if (!clause?.name && bindings && ts.isNamedImports(bindings)
          && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly)) continue;
        const specifier = statement.moduleSpecifier.text;
        const resolved = specifier.startsWith('@codebuddy/')
          ? path.join(coreRoot, specifier.slice('@codebuddy/'.length))
          : specifier.startsWith('.') ? path.resolve(path.dirname(filename), specifier) : '';
        if (resolved.startsWith(`${coreRoot}${path.sep}`)) entries.add(resolved.replace(/\.js$/, '.ts'));
      }
    }
    expect(entries.size).toBeGreaterThan(0);
    const result = await build({
      entryPoints: [...entries],
      outdir: 'browser-boundary-check',
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
      metafile: true,
      logLevel: 'silent',
    });
    expect(Object.keys(result.metafile!.inputs).some((file) => file.endsWith('/utils/logger.ts'))).toBe(false);
    expect(Object.values(result.metafile!.outputs).flatMap((output) => output.imports)).toEqual([]);
  });
});
