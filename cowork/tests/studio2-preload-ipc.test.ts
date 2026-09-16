import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const preloadPath = path.resolve(process.cwd(), 'src/preload/index.ts');

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

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (!property.name) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text;
  }
  return null;
}

function invokedChannel(node: ts.Node): string | null {
  let channel: string | null = null;
  function visit(child: ts.Node): void {
    if (
      !channel &&
      ts.isCallExpression(child) &&
      ts.isPropertyAccessExpression(child.expression) &&
      ts.isIdentifier(child.expression.expression) &&
      child.expression.expression.text === 'ipcRenderer' &&
      child.expression.name.text === 'invoke' &&
      child.arguments[0] &&
      ts.isStringLiteral(child.arguments[0])
    ) {
      channel = child.arguments[0].text;
      return;
    }
    ts.forEachChild(child, visit);
  }
  visit(node);
  return channel;
}

function collectExposedInvokeRoutes(): Map<string, string> {
  const sourceFile = ts.createSourceFile(
    preloadPath,
    readFileSync(preloadPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const routes = new Map<string, string>();

  function collectObject(object: ts.ObjectLiteralExpression, prefix: string[]): void {
    for (const property of object.properties) {
      const name = propertyName(property);
      if (!name || !ts.isPropertyAssignment(property)) continue;
      const value = unwrapExpression(property.initializer);
      const nextPath = [...prefix, name];
      if (ts.isObjectLiteralExpression(value)) {
        collectObject(value, nextPath);
        continue;
      }
      const channel = invokedChannel(value);
      if (channel) routes.set(nextPath.join('.'), channel);
    }
  }

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'exposeInMainWorld' &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'electronAPI' &&
      node.arguments[1]
    ) {
      const api = unwrapExpression(node.arguments[1]);
      if (ts.isObjectLiteralExpression(api)) collectObject(api, []);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return routes;
}

describe('App Studio V2 preload IPC surface', () => {
  it('exposes all eight main-process handlers on window.electronAPI.studio2', () => {
    const routes = collectExposedInvokeRoutes();
    const expected = new Map<string, string>([
      ['studio2.deploy.run', 'studio2.deploy.run'],
      ['studio2.deploy.detect', 'studio2.deploy.detect'],
      ['studio2.export.project', 'studio2.export.project'],
      ['studio2.export.importFolder', 'studio2.import.folder'],
      ['studio2.git.init', 'studio2.git.init'],
      ['studio2.git.status', 'studio2.git.status'],
      ['studio2.git.commit', 'studio2.git.commit'],
      ['studio2.git.log', 'studio2.git.log'],
    ]);

    expect(
      [...expected].map(([apiPath, channel]) => [apiPath, routes.get(apiPath), channel]),
    ).toEqual([...expected].map(([apiPath, channel]) => [apiPath, channel, channel]));
  });
});
