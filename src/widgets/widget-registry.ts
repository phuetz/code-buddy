/**
 * Widget registry — resolves the renderer for a data `kind` and produces a
 * self-contained HTML document, SERVER-SIDE (data interpolated into static
 * HTML+CSS, no client script). This is CSP-proof: srcdoc iframes inherit the
 * host CSP, so an inline-`<script>` widget renders blank in Cowork/Electron.
 *
 * Curated widgets are pure render functions in-repo (weather, news). Authored
 * widgets (generated on the fly, Phase 2) live under
 * ~/.codebuddy/widgets/<name>/widget.html as a static fragment — but curated
 * ALWAYS wins for a kind it covers. never-throws.
 *
 * @module widgets/widget-registry
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { renderWeatherWidget } from './curated/weather.js';
import { renderNewsWidget } from './curated/news.js';
import { renderStockWidget } from './curated/stock.js';
import { widgetKind, type AuthoredWidget } from './widget-types.js';
import { renderTemplate } from './template-engine.js';
import { scanWidgetFirewall } from './widget-gate.js';
import { readJsonAtomicSync, writeJsonAtomicSync } from '../utils/atomic-write.js';

/** Curated server-side renderers: data → self-contained HTML fragment (no script). */
const CURATED: Record<string, (data: unknown) => string> = {
  weather: renderWeatherWidget,
  news: renderNewsWidget,
  stock: renderStockWidget,
  market: renderStockWidget,
  bourse: renderStockWidget,
};

/** Root dir for authored widgets (env-overridable). */
export function authoredWidgetsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEBUDDY_WIDGETS_DIR?.trim() || join(homedir(), '.codebuddy', 'widgets');
}

function authoredWidgetDir(kind: string, env: NodeJS.ProcessEnv): string {
  return join(authoredWidgetsDir(env), `authored-${kind}`);
}

function normalizedStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  )];
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Load one authored widget and its auto-match metadata. Legacy metadata is accepted. */
export function readAuthoredWidget(
  kind: string,
  env: NodeJS.ProcessEnv = process.env
): AuthoredWidget | null {
  const normalizedKind = kind.trim().toLowerCase();
  if (!normalizedKind) return null;
  try {
    const dir = authoredWidgetDir(normalizedKind, env);
    const templatePath = join(dir, 'widget.html');
    if (!existsSync(templatePath)) return null;
    const template = readFileSync(templatePath, 'utf8');
    let metadata: Record<string, unknown> = {};
    const metadataPath = join(dir, 'meta.json');
    if (existsSync(metadataPath)) {
      const parsed = readJsonAtomicSync<unknown>(metadataPath, null);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    }
    return {
      kind: normalizedKind,
      template,
      dataTypes: normalizedStrings(metadata.dataTypes),
      usedCount: finiteNonNegative(metadata.usedCount),
      lastUsedAt: finiteTimestamp(metadata.lastUsedAt),
      createdAt: finiteTimestamp(metadata.createdAt),
      brief: typeof metadata.brief === 'string' ? metadata.brief : null,
    };
  } catch {
    return null;
  }
}

/** List the authored registry with declared data types and usage statistics. */
export function listAuthoredWidgetRegistry(
  env: NodeJS.ProcessEnv = process.env
): AuthoredWidget[] {
  try {
    return readdirSync(authoredWidgetsDir(env), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('authored-'))
      .map((entry) => readAuthoredWidget(entry.name.slice('authored-'.length), env))
      .filter((entry): entry is AuthoredWidget => entry !== null)
      .sort((a, b) => a.kind.localeCompare(b.kind));
  } catch {
    return [];
  }
}

/** Increment authored auto-render statistics. Best effort and never-throws. */
export function recordAuthoredWidgetUse(
  kind: string,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now()
): boolean {
  const widget = readAuthoredWidget(kind, env);
  if (!widget) return false;
  try {
    const path = join(authoredWidgetDir(widget.kind, env), 'meta.json');
    let metadata: Record<string, unknown> = {};
    const parsed = readJsonAtomicSync<unknown>(path, null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
    writeJsonAtomicSync(path, {
      ...metadata,
      kind: widget.kind,
      source: 'authored',
      dataTypes: widget.dataTypes,
      usedCount: widget.usedCount + 1,
      lastUsedAt: now,
    }, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Which source (if any) can render this kind: curated wins over authored. */
export function resolveWidgetSource(
  kind: string,
  env: NodeJS.ProcessEnv = process.env
): 'curated' | 'authored' | null {
  const k = (kind ?? '').trim().toLowerCase();
  if (!k) return null;
  if (CURATED[k]) return 'curated';
  try {
    if (existsSync(join(authoredWidgetsDir(env), `authored-${k}`, 'widget.html'))) return 'authored';
  } catch {
    /* none */
  }
  return null;
}

const URL_ATTR_RE = /\b(href|src|action|xlink:href)(\s*=\s*)(["'])([^"']*)\3/gi;
const DANGEROUS_SCHEME_RE = /^\s*(javascript|vbscript|data)\s*:/i;

function isUnsafeUrlValue(v: string): boolean {
  const m = DANGEROUS_SCHEME_RE.exec(v);
  if (!m) return false;
  // data:image/* (inline images) is allowed; every other data:/javascript:/vbscript: is not.
  if (m[1]!.toLowerCase() === 'data') return !/^\s*data:\s*image\//i.test(v);
  return true;
}

/**
 * Defence-in-depth: neutralize URL-bearing attributes (href/src/action) whose
 * value carries a dangerous scheme (javascript:/vbscript:/non-image data:). This
 * runs at RENDER time, so it also covers runtime data the gate never re-checks
 * (e.g. an authored `{{url}}` fed a malicious news link). Pure.
 */
export function neutralizeUnsafeUrls(html: string): string {
  return html.replace(URL_ATTR_RE, (full, name, eq, q, val) =>
    isUnsafeUrlValue(val) ? `${name}${eq}${q}#blocked${q}` : full
  );
}

/** Server-render the widget FRAGMENT for a data payload (curated fn, else authored static). */
export function renderWidgetFragment(data: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  const kind = widgetKind(data)?.toLowerCase();
  if (!kind) return null;
  const curated = CURATED[kind];
  if (curated) {
    try {
      const frag = curated(data);
      return frag && frag.trim() ? neutralizeUnsafeUrls(frag) : null;
    } catch {
      return null;
    }
  }
  try {
    const widget = readAuthoredWidget(kind, env);
    return widget ? renderAuthoredWidgetFragment(widget, data) : null;
  } catch {
    /* none */
  }
  return null;
}

/** Render an authored registry entry against data, independently of data.type. */
export function renderAuthoredWidgetFragment(widget: AuthoredWidget, data: unknown): string | null {
  try {
    if (!widget.template.trim() || scanWidgetFirewall(widget.template).length > 0) return null;
    const fragment = renderTemplate(widget.template, data);
    if (!fragment.trim() || scanWidgetFirewall(fragment).length > 0) return null;
    return neutralizeUnsafeUrls(fragment);
  } catch {
    return null;
  }
}

const BASE_CSS = `*{box-sizing:border-box}html,body{margin:0;padding:0;background:transparent}`;

export type WidgetTheme = 'dark' | 'light';

/**
 * Wrap a rendered fragment into a complete, self-contained HTML document (no
 * script). Pure. `theme` is stamped on <html> as `data-cbw-theme` so widgets can
 * match the HOST's theme (Cowork dark/light) instead of the OS preference — the
 * caller knows the host theme, the OS `prefers-color-scheme` does not.
 */
export function renderWidgetDocument(fragment: string, theme?: WidgetTheme): string {
  const attr = theme === 'dark' || theme === 'light' ? ` data-cbw-theme="${theme}"` : '';
  // Self-defending CSP: even opened OUTSIDE Cowork (e.g. `buddy widgets preview`
  // writes the doc to disk), the doc can never run a script or hit the network.
  const csp =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
  return (
    `<!doctype html><html${attr}><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<style>${BASE_CSS}</style></head><body>${fragment}</body></html>`
  );
}

/** Resolve + server-render for a tool's `data` payload → a full HTML doc, or null. */
export function renderWidgetForData(
  data: unknown,
  env: NodeJS.ProcessEnv = process.env,
  theme?: WidgetTheme
): string | null {
  const fragment = renderWidgetFragment(data, env);
  return fragment ? renderWidgetDocument(fragment, theme) : null;
}

/** Server-render a specifically matched authored widget as a full CSP document. */
export function renderAuthoredWidgetForData(
  widget: AuthoredWidget,
  data: unknown,
  theme?: WidgetTheme
): string | null {
  const fragment = renderAuthoredWidgetFragment(widget, data);
  return fragment ? renderWidgetDocument(fragment, theme) : null;
}

/** True when SOME widget (curated or authored) can render this data. */
export function hasWidgetForData(data: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const kind = widgetKind(data);
  return !!kind && resolveWidgetSource(kind, env) !== null;
}
