import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const preloadPath = path.resolve(root, 'src/preload/index.ts');
const useIpcPath = path.resolve(root, 'src/renderer/hooks/useIPC.ts');
const mainPath = path.resolve(root, 'src/main/index.ts');

function readSource(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

function parseSource(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    readSource(filePath),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function collectAllowedClientEvents(): Set<string> {
  const sourceFile = parseSource(preloadPath);
  const allowed = new Set<string>();

  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'ALLOWED_CLIENT_EVENTS' &&
      node.initializer
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (ts.isNewExpression(initializer) && initializer.arguments?.[0]) {
        const values = unwrapExpression(initializer.arguments[0]);
        if (ts.isArrayLiteralExpression(values)) {
          for (const element of values.elements) {
            const value = unwrapExpression(element as ts.Expression);
            if (ts.isStringLiteral(value)) allowed.add(value.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return allowed;
}

function collectUseIpcInvokeTypes(): Set<string> {
  const sourceFile = parseSource(useIpcPath);
  const invoked = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const isInvoke =
        (ts.isIdentifier(node.expression) && node.expression.text === 'invoke') ||
        (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'invoke');
      const firstArgument = node.arguments[0];
      if (isInvoke && firstArgument) {
        const payload = unwrapExpression(firstArgument);
        if (ts.isObjectLiteralExpression(payload)) {
          const typeProperty = payload.properties.find(
            (property): property is ts.PropertyAssignment =>
              ts.isPropertyAssignment(property) &&
              ((ts.isIdentifier(property.name) && property.name.text === 'type') ||
                (ts.isStringLiteral(property.name) && property.name.text === 'type')),
          );
          if (typeProperty) {
            const value = unwrapExpression(typeProperty.initializer);
            if (ts.isStringLiteral(value)) invoked.add(value.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return invoked;
}

function collectMainClientEventHandlers(): Set<string> {
  const sourceFile = parseSource(mainPath);
  const handled = new Set<string>();

  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleClientEvent') {
      function visitHandler(child: ts.Node): void {
        if (ts.isCaseClause(child) && ts.isStringLiteral(child.expression)) {
          handled.add(child.expression.text);
        }
        ts.forEachChild(child, visitHandler);
      }
      visitHandler(node);
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return handled;
}

describe('Cowork OAuth IPC contract', () => {
  const oauthChannels = [
    ['geminiOauthLogin', 'config.geminiOauthLogin'],
    ['geminiOauthClear', 'config.geminiOauthClear'],
    ['codexOauthLogin', 'config.codexOauthLogin'],
    ['codexOauthClear', 'config.codexOauthClear'],
    ['codexOauthStatus', 'config.codexOauthStatus'],
  ] as const;

  it('routes all five OAuth operations through direct config preload wrappers', () => {
    const preloadSource = readSource(preloadPath);
    const useIpcSource = readSource(useIpcPath);

    for (const [method, channel] of oauthChannels) {
      expect(preloadSource).toMatch(
        new RegExp(`${method}:\\s*\\([\\s\\S]*?ipcRenderer\\.invoke\\('${channel}'`, 'm'),
      );
      expect(useIpcSource).toMatch(
        new RegExp(
          `const ${method} = useCallback\\([\\s\\S]*?window\\.electronAPI\\.config\\.${method}\\(\\)`,
          'm',
        ),
      );
      expect(useIpcSource).not.toContain(`type: '${channel}'`);
    }
  });

  it('keeps generic invoke types allowlisted and every allowlisted type handled by main', () => {
    const invoked = collectUseIpcInvokeTypes();
    const allowed = collectAllowedClientEvents();
    const handled = collectMainClientEventHandlers();

    expect([...invoked].filter((type) => !allowed.has(type)).sort()).toEqual([]);
    expect([...allowed].filter((type) => !handled.has(type)).sort()).toEqual([]);
  });
});
