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

import ts from 'typescript';

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

function isImportStatement(node: ts.Node): boolean {
  return ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node);
}

function orderedStatements(statements: readonly ts.Statement[]): ts.Statement[] {
  const imports = statements.filter(isImportStatement);
  const rest = statements.filter((statement) => !isImportStatement(statement));
  imports.sort((a, b) => fingerprint(a).localeCompare(fingerprint(b)));
  let importIndex = 0;
  return statements.map((statement) => (isImportStatement(statement) ? imports[importIndex++]! : rest.shift()!));
}

function childNodes(node: ts.Node): ts.Node[] {
  if (ts.isSourceFile(node) || ts.isModuleBlock(node)) return orderedStatements(node.statements);
  const children: ts.Node[] = [];
  ts.forEachChild(node, (child) => {
    children.push(child);
  });
  return children;
}

function shape(node: ts.Node, sourceFile: ts.SourceFile): AstShape {
  const children = childNodes(node);
  return {
    kind: node.kind,
    // Leaf token text excludes trivia while preserving identifiers, literals, template chunks, and
    // JSX text. Non-leaf nodes carry their meaning through their kind and ordered descendants.
    text: children.length === 0 ? node.getText(sourceFile) : '',
    children: children.map((child) => shape(child, sourceFile)),
  };
}

function fingerprint(node: ts.Node): string {
  const sourceFile = node.getSourceFile();
  return JSON.stringify(shape(node, sourceFile));
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

function parse(code: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * Compare two TypeScript programs without considering comments, whitespace, or import ordering.
 * The default threshold is deliberately one node: every actual AST difference remains novel.
 */
export function checkAstNovelty(mutatedCode: string, parentCode: string, minNodeChanges = 1): AstNoveltyResult {
  const mutatedSource = parse(mutatedCode, 'mutated.ts');
  const parentSource = parse(parentCode, 'parent.ts');
  const mutated = shape(mutatedSource, mutatedSource);
  const parent = shape(parentSource, parentSource);
  const diffNodesCount = diffNodes(mutated, parent);
  if (diffNodesCount === 0) return { isNovel: false, diffNodesCount, reason: 'ast-identical' };

  const threshold = Math.max(1, Math.floor(minNodeChanges));
  if (diffNodesCount < threshold) return { isNovel: false, diffNodesCount, reason: 'ast-too-similar' };
  return { isNovel: true, diffNodesCount };
}
