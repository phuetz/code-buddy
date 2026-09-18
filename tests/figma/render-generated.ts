import { createRequire } from 'node:module';
import type { ReactElement, ReactNode } from 'react';
import ts from 'typescript';

const requireFromHere = createRequire(import.meta.url);

export function compileTsx(source: string, fileName = 'generated.tsx'): string {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      strict: true,
    },
    fileName,
    reportDiagnostics: true,
  });
  const diagnostics = result.diagnostics ?? [];
  const problems = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (problems.length > 0) {
    const text = problems
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('\n');
    throw new Error(`Generated TSX failed to compile: ${text}`);
  }
  return result.outputText;
}

export function loadGeneratedModule(
  source: string,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  const js = compileTsx(source, 'generated.tsx');
  const module = { exports: {} as Record<string, unknown> };
  const react = requireFromHere('react');
  const fn = new Function('module', 'exports', 'require', js);
  fn(module, module.exports, (id: string) => {
    if (id === 'react') return react;
    const extra = extras[id];
    if (extra !== undefined) return extra;
    throw new Error(`Generated code tried to require ${id} (tests allow react plus injected modules)`);
  });
  return module.exports;
}

export function loadGeneratedComponent(
  source: string,
  exportName: string,
  extras: Record<string, unknown> = {},
): (props?: Record<string, unknown>) => ReactElement {
  const exported = loadGeneratedModule(source, extras)[exportName];
  if (typeof exported !== 'function') {
    throw new Error(`Missing export ${exportName}`);
  }
  return exported as (props?: Record<string, unknown>) => ReactElement;
}

export function renderReactToHtml(node: ReactNode): string {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(String(node));
  if (Array.isArray(node)) return node.map(renderReactToHtml).join('');
  if (typeof node === 'object' && node !== null && '$$typeof' in node) {
    const el = node as ReactElement<{ className?: string; children?: ReactNode; [key: string]: unknown }>;
    if (typeof el.type === 'function') {
      const rendered = (el.type as (props: unknown) => ReactNode)(el.props);
      return renderReactToHtml(rendered);
    }
    const tag = String(el.type);
    const props = el.props ?? {};
    const attrs: string[] = [];
    for (const [key, value] of Object.entries(props)) {
      if (key === 'children' || value === undefined || value === false || typeof value === 'function') continue;
      if (key === 'className') {
        attrs.push(`class="${escapeHtml(String(value))}"`);
        continue;
      }
      if (key === 'style' && value && typeof value === 'object') {
        const css = Object.entries(value as Record<string, unknown>)
          .map(([k, v]) => `${k.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}:${v}`)
          .join(';');
        attrs.push(`style="${escapeHtml(css)}"`);
        continue;
      }
      const attr = key === 'data-figma-id' || key.startsWith('data-') ? key : key.toLowerCase();
      attrs.push(`${attr}="${escapeHtml(String(value))}"`);
    }
    const inner = renderReactToHtml(props.children as ReactNode);
    if (inner === '' && ['img', 'input', 'br', 'hr'].includes(tag)) {
      return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''} />`;
    }
    return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${inner}</${tag}>`;
  }
  return '';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
