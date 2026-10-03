/** Additional restrictions for executable imports; the shared skill firewall still applies. */
import ts from 'typescript';

const SAFE_BUILTINS = new Set(['path', 'assert', 'assert/strict']);
const FORBIDDEN_GLOBALS = new Set([
  'globalThis', 'global', 'eval', 'Function', 'Reflect', 'Proxy', 'WebAssembly',
  'Object', 'Buffer', 'fetch', 'XMLHttpRequest', 'Worker', 'Deno', 'Bun', 'arguments', 'constructor',
  'WebSocket', 'EventSource', 'navigator', 'localStorage', 'sessionStorage',
]);
const PROCESS_PROPERTIES = new Set(['stdin', 'stdout', 'stderr', 'exit', 'on', 'once', 'pid', 'env']);
const ROOT_VARIABLES = new Set(['CLAUDE_PLUGIN_ROOT', 'CLAUDE_PROJECT_DIR']);

/**
 * Conservative syntax subset, not a JavaScript sandbox. Unknown capabilities
 * stay in quarantine. In particular, imports cannot read/write filesystem,
 * spawn processes, use the network, reflect on globals, or access ambient env.
 * File observation/modification belongs to Code Buddy's confirmed tools.
 */
export function hookScriptPolicy(text: string, file: string): string[] {
  if (/\.(?:sh|bash)$/.test(file)) return hookShellPolicy(text, file);
  if (file.endsWith('/package.json') || file === 'package.json') return hookPackagePolicy(text, file);
  if (file === 'command.txt' || file.endsWith('.json')) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const reasons = new Set<string>();
  const flag = (reason: string): void => { reasons.add(`${file}: hook-policy: ${reason}`); };
  const checkModule = (node: ts.Node | undefined): void => {
    if (!node || !ts.isStringLiteralLike(node)) { flag('dynamic module access'); return; }
    if (node.text.startsWith('.')) return; // Dependency closure is checked by the importer.
    if (!SAFE_BUILTINS.has(node.text.replace(/^node:/, ''))) {
      flag(`module capability outside the supported subset: ${node.text} (filesystem, secrets, network and process access are not admitted)`);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isElementAccessExpression(node) || ts.isComputedPropertyName(node)) flag('computed property access');
    if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword) flag('dynamic receiver');
    if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text)) flag(`dynamic or ambient capability: ${node.text}`);
    if (ts.isIdentifier(node) && node.text === 'process') {
      if (!ts.isPropertyAccessExpression(node.parent) || node.parent.expression !== node
        || !PROCESS_PROPERTIES.has(node.parent.name.text)) flag('indirect or unsupported process access');
      else if (node.parent.name.text === 'env') {
        const access = node.parent.parent;
        if (!ts.isPropertyAccessExpression(access) || access.expression !== node.parent
          || !ROOT_VARIABLES.has(access.name.text)) flag('ambient environment or secret access');
      }
    }
    if (ts.isIdentifier(node) && node.text === 'module'
      && (!ts.isPropertyAccessExpression(node.parent) || node.parent.name.text !== 'exports')) flag('indirect module access');
    if (ts.isPropertyAccessExpression(node) && (node.name.text.startsWith('_')
      || ['constructor', 'prototype', 'caller', 'callee', 'getPrototypeOf', 'setPrototypeOf', 'require', 'createRequire', 'getBuiltinModule', 'binding', 'dlopen', 'mainModule'].includes(node.name.text))) {
      flag(`reflective or runtime loader property: ${node.name.text}`);
    }
    if (ts.isBindingElement(node) && node.propertyName) flag('destructured capability access');
    if (ts.isTaggedTemplateExpression(node)) flag('dynamic tagged template');
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      if (/(?:\.ssh|\.aws|\.gnupg|\.env\b|credentials|id_rsa|id_ed25519|hooks\.json|codex-auth|api[_-]?key|secret|token)/i.test(node.text)) {
        flag('secret or executable configuration path/content');
      }
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || ts.isIdentifier(node.expression) && node.expression.text === 'require')) checkModule(node.arguments[0]);
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) checkModule(node.moduleSpecifier);
    ts.forEachChild(node, visit);
  };
  visit(source);
  // SourceFile exposes parser diagnostics at runtime; reject malformed programs too.
  if ((source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) flag('unparseable script');
  return [...reasons];
}

/** Raw copied shell text must not perform expansion or alter later command resolution. */
export function hookShellPolicy(text: string, file: string): string[] {
  const reasons: string[] = [];
  const flag = (why: string): void => { reasons.push(`${file}: hook-policy: ${why}`); };
  if (/[`~*?[\]\\]/.test(text)) flag('shell substitution, tilde, glob or escape is not proven literal');
  if (text.replace(/\$(?:\{CLAUDE_PLUGIN_ROOT\}|CLAUDE_PLUGIN_ROOT|\{CLAUDE_PROJECT_DIR\}|CLAUDE_PROJECT_DIR)(?![A-Za-z0-9_])/g, '').includes('$')) {
    flag('shell variable or substitution outside the supplied roots');
  }
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (!['\t', '\n', '\r'].includes(char) && (code < 0x20 || code > 0x7e)) {
      flag('unproven shell control or non-ASCII syntax');
      break;
    }
  }
  if (/\bprintf\s+-|%[^sd%]/.test(text)) flag('printf option or format may mutate shell state');
  return reasons;
}

/** Node resolution metadata is executable authority, not passive JSON data. */
export function hookPackagePolicy(text: string, file: string): string[] {
  try {
    const pkg: unknown = JSON.parse(text);
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('package must be an object');
    const record = pkg as Record<string, unknown>;
    const loaders = ['main', 'exports', 'imports', 'bin', 'scripts'];
    const found = loaders.filter((key) => Object.hasOwn(record, key));
    if (found.length) return [`${file}: hook-policy: package resolution/code fields are not supported: ${found.join(', ')}`];
    if (record.type !== undefined && !['commonjs', 'module'].includes(String(record.type))) throw new Error('unsupported package type');
    return [];
  } catch (error) { return [`${file}: hook-policy: unreadable package metadata: ${error}`]; }
}
