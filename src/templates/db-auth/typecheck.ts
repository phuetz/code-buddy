import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

const REACT_MODULE = `export function useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void] {
  const value = typeof initial === 'function' ? (initial as () => T)() : initial;
  const set = (next: T | ((prev: T) => T)): void => { void next; };
  return [value, set];
}
export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
  void effect;
  void deps;
}
const React = {
  createElement: (...args: unknown[]) => { void args; return null as unknown; },
  StrictMode: function StrictMode(props: { children?: unknown }) { void props; return null as unknown; },
};
export default React;
`;

const JSX_RUNTIME = `export const Fragment = {};
export function jsx(type: unknown, props: unknown, key?: unknown): unknown {
  void type; void props; void key;
  return null;
}
export function jsxs(type: unknown, props: unknown, key?: unknown): unknown {
  void type; void props; void key;
  return null;
}
export function jsxDEV(type: unknown, props: unknown, key?: unknown): unknown {
  void type; void props; void key;
  return null;
}
`;

const REACT_DOM = `export function createRoot(el: { id?: string } | null): { render: (node: unknown) => void } {
  void el;
  return { render: (node: unknown) => { void node; } };
}
const ReactDOM = { createRoot };
export default ReactDOM;
`;

const GLOBALS = `export {};
declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: Record<string, unknown>;
    }
    type Element = unknown;
  }
  interface ImportMeta {
    env?: Record<string, string | undefined>;
  }
}
`;

function collectSources(root: string, relativeDir: string, acc: string[]): void {
  const abs = path.join(root, relativeDir);
  if (!fs.existsSync(abs)) {
    return;
  }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.posix.join(relativeDir.split(path.sep).join('/'), entry.name);
    if (entry.isDirectory()) {
      collectSources(root, rel, acc);
      continue;
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      acc.push(path.join(root, rel));
    }
  }
}

/**
 * Typecheck the overlay without npm install or network.
 * Shims are written next to the project (tmp dirs in tests) so the default
 * TypeScript host can still load lib.es2022 / lib.dom.
 */
export function typecheckProvisionedProject(projectRoot: string): { ok: boolean; diagnostics: string[] } {
  const root = path.resolve(projectRoot);
  const sources: string[] = [];
  collectSources(root, 'src/lib', sources);
  collectSources(root, 'src/auth', sources);
  const main = path.join(root, 'src/main.tsx');
  if (fs.existsSync(main)) {
    sources.push(main);
  }
  if (sources.length === 0) {
    return { ok: false, diagnostics: ['no TypeScript sources under src/lib or src/auth'] };
  }

  const shimDir = path.join(root, '__cb_typecheck_shims');
  fs.mkdirSync(shimDir, { recursive: true });
  const reactFile = path.join(shimDir, 'react.ts');
  const jsxFile = path.join(shimDir, 'jsx-runtime.ts');
  const domFile = path.join(shimDir, 'react-dom-client.ts');
  const globalsFile = path.join(shimDir, 'globals.d.ts');
  fs.writeFileSync(reactFile, REACT_MODULE);
  fs.writeFileSync(jsxFile, JSX_RUNTIME);
  fs.writeFileSync(domFile, REACT_DOM);
  fs.writeFileSync(globalsFile, GLOBALS);

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: [],
    noUnusedLocals: true,
    noUnusedParameters: true,
    isolatedModules: true,
    noUncheckedIndexedAccess: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    baseUrl: root,
    paths: {
      'react': [reactFile],
      'react/jsx-runtime': [jsxFile],
      'react/jsx-dev-runtime': [jsxFile],
      'react-dom/client': [domFile],
    },
  };

  const program = ts.createProgram({
    rootNames: [...sources, reactFile, jsxFile, domFile, globalsFile],
    options,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const formatted = diagnostics.map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (diagnostic.file && diagnostic.start !== undefined) {
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${path.relative(root, diagnostic.file.fileName)}:${line + 1}:${character + 1} ${message}`;
    }
    return message;
  });
  return { ok: formatted.length === 0, diagnostics: formatted };
}
