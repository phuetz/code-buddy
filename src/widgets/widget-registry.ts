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
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { renderWeatherWidget } from './curated/weather.js';
import { renderNewsWidget } from './curated/news.js';
import { widgetKind } from './widget-types.js';
import { renderTemplate } from './template-engine.js';

/** Curated server-side renderers: data → self-contained HTML fragment (no script). */
const CURATED: Record<string, (data: unknown) => string> = {
  weather: renderWeatherWidget,
  news: renderNewsWidget,
};

/** Root dir for authored widgets (env-overridable). */
export function authoredWidgetsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEBUDDY_WIDGETS_DIR?.trim() || join(homedir(), '.codebuddy', 'widgets');
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

/** Server-render the widget FRAGMENT for a data payload (curated fn, else authored static). */
export function renderWidgetFragment(data: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  const kind = widgetKind(data)?.toLowerCase();
  if (!kind) return null;
  const curated = CURATED[kind];
  if (curated) {
    try {
      const frag = curated(data);
      return frag && frag.trim() ? frag : null;
    } catch {
      return null;
    }
  }
  try {
    const p = join(authoredWidgetsDir(env), `authored-${kind}`, 'widget.html');
    if (existsSync(p)) {
      const tpl = readFileSync(p, 'utf8');
      // Authored widgets are SAFE Mustache-style templates, rendered server-side
      // with the data interpolated (always escaped). No client script, CSP-proof.
      const frag = renderTemplate(tpl, data);
      if (frag.trim()) return frag;
    }
  } catch {
    /* none */
  }
  return null;
}

const BASE_CSS = `*{box-sizing:border-box}html,body{margin:0;padding:0;background:transparent}`;

/** Wrap a rendered fragment into a complete, self-contained HTML document (no script). Pure. */
export function renderWidgetDocument(fragment: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<style>${BASE_CSS}</style></head><body>${fragment}</body></html>`
  );
}

/** Resolve + server-render for a tool's `data` payload → a full HTML doc, or null. */
export function renderWidgetForData(data: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  const fragment = renderWidgetFragment(data, env);
  return fragment ? renderWidgetDocument(fragment) : null;
}

/** True when SOME widget (curated or authored) can render this data. */
export function hasWidgetForData(data: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  const kind = widgetKind(data);
  return !!kind && resolveWidgetSource(kind, env) !== null;
}
