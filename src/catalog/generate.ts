import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type CatalogFamily = 'cli' | 'slash' | 'tool' | 'http' | 'websocket' | 'provider' | 'environment' | 'middleware' | 'channel' | 'cowork';

export interface CatalogSource {
  file: string;
  line: number;
  commit: string;
}

export interface CatalogEntry {
  id: string;
  family: CatalogFamily;
  name: string;
  sources: CatalogSource[];
  description?: string;
  evidence?: { status: string; source: string; line: number };
}

export interface Catalog {
  schemaVersion: 1;
  commit: string;
  entries: CatalogEntry[];
}

function filesUnder(root: string, relative: string): string[] {
  const absolute = path.join(root, relative);
  try {
    return readdirSync(absolute, { withFileTypes: true }).flatMap((item) => {
      const next = path.posix.join(relative, item.name);
      if (item.isDirectory()) return filesUnder(root, next);
      return item.isFile() && next.endsWith('.ts') && !next.endsWith('.d.ts') ? [next] : [];
    });
  } catch {
    return [];
  }
}

function literal(node: ts.Node | undefined): string | undefined {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return node.text;
  return undefined;
}

function property(node: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const member of node.properties) {
    if (ts.isPropertyAssignment(member) && (member.name.getText() === name || literal(member.name) === name)) {
      return member.initializer;
    }
  }
  return undefined;
}

function sourceText(root: string, file: string): string {
  return readFileSync(path.join(root, file), 'utf8');
}

function inventoryEvidence(root: string): Map<string, { status: string; source: string; line: number }> {
  const result = new Map<string, { status: string; source: string; line: number }>();
  const file = 'docs/INVENTAIRE-FONCTIONNALITES.md';
  let lines: string[];
  try { lines = sourceText(root, file).split('\n'); } catch { return result; }
  lines.forEach((line, index) => {
    if (!line.startsWith('|')) return;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3 || !/[✅🧪❓💤]/u.test(cells[2] ?? '')) return;
    for (const match of (cells[0] ?? '').matchAll(/`([^`]+)`/g)) {
      const key = match[1];
      if (key && !result.has(key)) result.set(key, { status: cells[2]!, source: file, line: index + 1 });
    }
  });
  return result;
}

/** Inspect declarations only. No application modules are imported or executed. */
export function generateCatalog(root: string): Catalog {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const entries = new Map<string, CatalogEntry>();
  const evidence = inventoryEvidence(root);
  const add = (family: CatalogFamily, name: string, file: string, node: ts.Node, sourceFile: ts.SourceFile, description?: string): void => {
    const normalized = name.trim();
    if (!normalized) return;
    const id = family === 'cli' || family === 'http'
      ? `${family}:${file}:${normalized}`
      : `${family}:${normalized}`;
    const provenance = { file, line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1, commit };
    const existing = entries.get(id);
    if (existing) {
      if (!existing.sources.some((item) => item.file === provenance.file && item.line === provenance.line)) existing.sources.push(provenance);
      return;
    }
    const entry: CatalogEntry = { id, family, name: normalized, sources: [provenance] };
    if (description) entry.description = description;
    const proof = evidence.get(normalized) ?? (family === 'cli' ? evidence.get(`buddy ${normalized}`) : undefined);
    if (proof) entry.evidence = proof;
    entries.set(id, entry);
  };

  const cliFiles = new Set(['src/index.ts', ...filesUnder(root, 'src/commands'), ...filesUnder(root, 'src/cli')]);
  const toolFiles = new Set(['src/tools/metadata.ts', ...filesUnder(root, 'src/codebuddy/tool-definitions'), ...filesUnder(root, 'src/tools/registry'),
    ...filesUnder(root, 'src/codebuddy').filter((file) => file.endsWith('-tool-defs.ts'))]);
  const routeFiles = new Set(['src/server/index.ts', ...filesUnder(root, 'src/server/routes')]);
  const providerFile = 'src/providers/provider-catalog.ts';
  const slashFiles = new Set(filesUnder(root, 'src/commands/slash'));
  const channelIndex = 'src/channels/index.ts';
  const coworkApp = 'cowork/src/renderer/App.tsx';
  const websocketFiles = new Set(['src/server/types.ts', ...filesUnder(root, 'src/server/websocket')]);
  const middlewareFiles = new Set(filesUnder(root, 'src/agent/middleware'));
  const allFiles = new Set([...cliFiles, ...toolFiles, ...routeFiles, ...websocketFiles, ...middlewareFiles, providerFile, channelIndex, coworkApp,
    ...filesUnder(root, 'src')]);

  for (const file of [...allFiles].sort()) {
    let content: string;
    try { content = sourceText(root, file); } catch { continue; }
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (cliFiles.has(file) && ts.isCallExpression(node)) {
        if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'command') {
          const name = literal(node.arguments[0]);
          if (name) add('cli', name, file, node.arguments[0]!, sourceFile);
        }
        if (ts.isIdentifier(node.expression) && /^addLazyCommand(Group)?$/.test(node.expression.text)) {
          const name = literal(node.arguments[1]);
          if (name) add('cli', name, file, node.arguments[1]!, sourceFile);
        }
      }
      if (cliFiles.has(file) && ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Command') {
        const name = literal(node.arguments?.[0]);
        if (name) add('cli', name, file, node.arguments![0]!, sourceFile);
      }
      if (toolFiles.has(file) && !file.includes('/registry/') && ts.isObjectLiteralExpression(node)) {
        const nameNode = property(node, 'name');
        const name = literal(nameNode);
        if (name && /^[a-z][a-z0-9_]*$/.test(name) &&
          (file.endsWith('/metadata.ts') || property(node, 'description') || property(node, 'parameters'))) {
          add('tool', name, file, nameNode!, sourceFile, literal(property(node, 'description')));
        }
      }
      if (slashFiles.has(file) && ts.isObjectLiteralExpression(node) &&
        property(node, 'isBuiltin')?.kind === ts.SyntaxKind.TrueKeyword) {
        const nameNode = property(node, 'name');
        const name = literal(nameNode);
        if (name) add('slash', name, file, nameNode!, sourceFile, literal(property(node, 'description')));
      }
      if (toolFiles.has(file) && ts.isPropertyDeclaration(node) && node.name.getText(sourceFile) === 'name') {
        const name = literal(node.initializer);
        if (name && /^[a-z][a-z0-9_]*$/.test(name)) add('tool', name, file, node.initializer!, sourceFile);
      }
      if (routeFiles.has(file) && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text.toUpperCase();
        const target = node.expression.expression.getText(sourceFile);
        if (/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(method) && /^(app|router)$/.test(target)) {
          const first = node.arguments[0];
          const paths = first && ts.isArrayLiteralExpression(first) ? first.elements.map(literal) : [literal(first)];
          for (const route of paths) if (route) add('http', `${method} ${route}`, file, first!, sourceFile);
        }
      }
      if (file === providerFile && ts.isTypeAliasDeclaration(node) && node.name.text === 'RuntimeProviderId' && ts.isUnionTypeNode(node.type)) {
        for (const type of node.type.types) {
          if (ts.isLiteralTypeNode(type)) {
            const name = literal(type.literal);
            if (name) add('provider', name, file, type, sourceFile);
          }
        }
      }
      if (file === channelIndex && ts.isExportDeclaration(node) && node.moduleSpecifier &&
        literal(node.moduleSpecifier)?.startsWith('./') && node.exportClause && ts.isNamedExports(node.exportClause)) {
        const segment = literal(node.moduleSpecifier)?.split('/')[1];
        if (segment && node.exportClause.elements.some((element) => element.name.text.endsWith('Channel'))) {
          add('channel', segment, file, node.moduleSpecifier, sourceFile);
        }
      }
      if (file === coworkApp && ts.isImportDeclaration(node) && literal(node.moduleSpecifier)?.startsWith('./components/') &&
        node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) {
          if (/(Panel|View|Screen|Page|Workspace)$/.test(element.name.text)) {
            add('cowork', element.name.text, file, element.name, sourceFile);
          }
        }
      }
      if (websocketFiles.has(file)) {
        if (ts.isTypeAliasDeclaration(node) && node.name.text === 'WebSocketMessageType' && ts.isUnionTypeNode(node.type)) {
          for (const type of node.type.types) {
            if (ts.isLiteralTypeNode(type)) {
              const name = literal(type.literal);
              if (name) add('websocket', name, file, type, sourceFile);
            }
          }
        }
        if (ts.isCaseClause(node)) {
          const name = literal(node.expression);
          if (name) add('websocket', name, file, node.expression, sourceFile);
        }
      }
      if (middlewareFiles.has(file) && ts.isClassDeclaration(node) && node.name &&
        node.heritageClauses?.some((clause) => clause.getText(sourceFile).includes('Middleware'))) {
        add('middleware', node.name.text, file, node.name, sourceFile);
      }
      if (ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(sourceFile) === 'process' && node.expression.name.text === 'env') {
        add('environment', node.name.text, file, node.name, sourceFile);
      }
      if (ts.isElementAccessExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(sourceFile) === 'process' && node.expression.name.text === 'env') {
        const name = literal(node.argumentExpression);
        if (name) add('environment', name, file, node.argumentExpression!, sourceFile);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  const ordered = [...entries.values()].sort((a, b) => a.id.localeCompare(b.id, 'en'));
  for (const entry of ordered) entry.sources.sort((a, b) => a.file.localeCompare(b.file, 'en') || a.line - b.line);
  return { schemaVersion: 1, commit, entries: ordered };
}

export function renderCatalogMarkdown(catalog: Catalog): string {
  const escape = (value: string): string => value.replaceAll('|', '\\|').replaceAll('\n', ' ');
  return [
    '# Catalogue généré depuis le code',
    '',
    `Commit source : \`${catalog.commit}\`. Une déclaration ne prouve pas son fonctionnement.`,
    '',
    '| ID | Famille | Nom | Source | Preuve inventaire |',
    '|---|---|---|---|---|',
    ...catalog.entries.map((entry) => `| \`${escape(entry.id)}\` | ${entry.family} | ${escape(entry.name)} | ${entry.sources.map((source) => `\`${source.file}:${source.line}\``).join(', ')} | ${entry.evidence ? escape(entry.evidence.status) : '—'} |`),
    '',
  ].join('\n');
}
