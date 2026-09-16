/**
 * Cheap syntax-level novelty check for candidate mutations.
 *
 * TypeScript's AST contains no comments or whitespace trivia. Import declarations are sorted before
 * the comparison so a formatter or import organiser cannot consume an evaluation slot. Source text
 * is retained only for leaf tokens, where it carries semantic information such as an identifier or
 * literal value.
 *
 * @module agent/self-improvement/evolution/ast-novelty
 */

import { createRequire } from 'node:module';
import type * as ts from 'typescript';

type TypeScriptApi = typeof ts;

// `typescript` is a devDependency: the published package does not ship it, and this module is
// reached from the tool gate on every headless turn. Resolve it lazily so a fresh
// `npm i -g @phuetz/code-buddy` never fails at import time; only the AST comparison degrades.
let tsApi: TypeScriptApi | null | undefined;
function loadTypeScript(): TypeScriptApi | null {
  if (tsApi !== undefined) return tsApi;
  try {
    tsApi = createRequire(import.meta.url)('typescript') as TypeScriptApi;
  } catch {
    tsApi = null;
  }
  return tsApi;
}

/** Test seam: force the fallback path as if `typescript` were not installed. */
export function __setTypeScriptApiForTests(api: TypeScriptApi | null | undefined): void {
  tsApi = api;
}

export interface AstNoveltyResult {
  isNovel: boolean;
  diffNodesCount: number;
  reason?: string;
}

interface AstShape {
  kind: ts.SyntaxKind;
  text: string;
  children: AstShape[];
}

function isImportStatement(api: TypeScriptApi, node: ts.Node): boolean {
  return api.isImportDeclaration(node) || api.isImportEqualsDeclaration(node);
}

function orderedStatements(api: TypeScriptApi, statements: readonly ts.Statement[]): ts.Statement[] {
  const imports = statements.filter((statement) => isImportStatement(api, statement));
  const rest = statements.filter((statement) => !isImportStatement(api, statement));
  imports.sort((a, b) => fingerprint(api, a).localeCompare(fingerprint(api, b)));
  let importIndex = 0;
  return statements.map((statement) => (isImportStatement(api, statement) ? imports[importIndex++]! : rest.shift()!));
}

function childNodes(api: TypeScriptApi, node: ts.Node): ts.Node[] {
  if (api.isSourceFile(node) || api.isModuleBlock(node)) return orderedStatements(api, node.statements);
  const children: ts.Node[] = [];
  api.forEachChild(node, (child) => {
    children.push(child);
  });
  return children;
}

function shape(api: TypeScriptApi, node: ts.Node, sourceFile: ts.SourceFile): AstShape {
  const children = childNodes(api, node);
  return {
    kind: node.kind,
    // Leaf token text excludes trivia while preserving identifiers, literals, template chunks, and
    // JSX text. Non-leaf nodes carry their meaning through their kind and ordered descendants.
    text: children.length === 0 ? node.getText(sourceFile) : '',
    children: children.map((child) => shape(api, child, sourceFile)),
  };
}

function fingerprint(api: TypeScriptApi, node: ts.Node): string {
  const sourceFile = node.getSourceFile();
  return JSON.stringify(shape(api, node, sourceFile));
}

function nodeCount(node: AstShape | undefined): number {
  if (!node) return 0;
  return 1 + node.children.reduce((total, child) => total + nodeCount(child), 0);
}

function diffNodes(left: AstShape | undefined, right: AstShape | undefined): number {
  if (!left || !right) return nodeCount(left) + nodeCount(right);
  if (left.kind !== right.kind || left.text !== right.text) return 1;

  const length = Math.max(left.children.length, right.children.length);
  let diff = 0;
  for (let i = 0; i < length; i++) diff += diffNodes(left.children[i], right.children[i]);
  return diff;
}

function parse(api: TypeScriptApi, code: string, fileName: string): ts.SourceFile {
  return api.createSourceFile(fileName, code, api.ScriptTarget.Latest, true, api.ScriptKind.TS);
}

/** Without the TypeScript parser, compare source text with comments and whitespace removed. */
function normalizeText(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\s+/g, '');
}

/**
 * Compare two TypeScript programs without considering comments, whitespace, or import ordering.
 * The default threshold is deliberately one node: every actual AST difference remains novel.
 */
export function checkAstNovelty(mutatedCode: string, parentCode: string, minNodeChanges = 1): AstNoveltyResult {
  const api = loadTypeScript();
  if (!api) {
    // Degraded but honest: identical text (modulo comments/whitespace) is still rejected; anything
    // else is reported as novel with an explicit reason so callers can see the parser was absent.
    const identical = normalizeText(mutatedCode) === normalizeText(parentCode);
    return identical
      ? { isNovel: false, diffNodesCount: 0, reason: 'text-identical (typescript unavailable)' }
      : { isNovel: true, diffNodesCount: 1, reason: 'typescript unavailable, text differs' };
  }
  const mutatedSource = parse(api, mutatedCode, 'mutated.ts');
  const parentSource = parse(api, parentCode, 'parent.ts');
  const mutated = shape(api, mutatedSource, mutatedSource);
  const parent = shape(api, parentSource, parentSource);
  const diffNodesCount = diffNodes(mutated, parent);
  if (diffNodesCount === 0) return { isNovel: false, diffNodesCount, reason: 'ast-identical' };

  const threshold = Math.max(1, Math.floor(minNodeChanges));
  if (diffNodesCount < threshold) return { isNovel: false, diffNodesCount, reason: 'ast-too-similar' };
  return { isNovel: true, diffNodesCount };
}
