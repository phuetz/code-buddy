/**
 * Opt-in answer → widget pipeline. The answer text is never modified; callers
 * may display the optional server-rendered HTML beside it using their existing
 * inline widget surface.
 *
 * @module widgets/auto-widget
 */
import { logger } from '../utils/logger.js';
import { type ResolveOrGenerateDeps } from './widget-engine.js';
import {
  listAuthoredWidgetRegistry,
  recordAuthoredWidgetUse,
  renderAuthoredWidgetForData,
  renderWidgetDocument,
  renderWidgetForData,
  resolveWidgetSource,
  type WidgetTheme,
} from './widget-registry.js';
import { detectWidgetable, matchAuthoredWidget, type WidgetCandidate } from './widget-matcher.js';
import type { AuthoredWidget } from './widget-types.js';

export interface AutoWidgetResult {
  /** Always byte-identical to the input answer. */
  answer: string;
  /** Full server-rendered CSP document for the inline renderer, or null. */
  widgetHtml: string | null;
  /** The single selected candidate, or null when disabled/not widgetable. */
  candidate: WidgetCandidate | null;
}

export interface AutoWidgetDeps {
  env?: NodeJS.ProcessEnv;
  theme?: WidgetTheme;
  registry?: readonly AuthoredWidget[];
  renderAuthored?: (widget: AuthoredWidget, data: unknown, theme?: WidgetTheme) => string | null;
  renderCurated?: (data: unknown, env: NodeJS.ProcessEnv, theme?: WidgetTheme) => string | null;
  generate?: (data: unknown, deps: ResolveOrGenerateDeps) => Promise<string | null>;
  propose?: ResolveOrGenerateDeps['propose'];
  now?: () => number;
}

function enabled(env: NodeJS.ProcessEnv): boolean {
  return env.CODEBUDDY_WIDGETS === 'true' && env.CODEBUDDY_WIDGETS_AUTO === 'true';
}

function safeResult(answer: string, candidate: WidgetCandidate | null = null): AutoWidgetResult {
  return { answer, widgetHtml: null, candidate };
}

function scriptFree(html: string | null): html is string {
  return typeof html === 'string' && html.trim().length > 0 && !/<\s*script\b/i.test(html);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function renderMarkdownTableWidget(
  candidate: Extract<WidgetCandidate, { kind: 'table' }>,
  theme?: WidgetTheme,
): string {
  const header = candidate.data.headers
    .map((cell) => `<th scope="col">${escapeHtml(cell.label)}</th>`)
    .join('');
  const rows = candidate.data.rows
    .map((row) => `<tr>${row.cells.map((cell) => `<td>${escapeHtml(cell.value)}</td>`).join('')}</tr>`)
    .join('');
  const fragment =
    '<style>table{border-collapse:collapse;width:100%;font:14px system-ui,sans-serif}' +
    'th,td{border:1px solid #cbd5e1;padding:7px 9px;text-align:left}' +
    'th{background:#e2e8f0;font-weight:700}td{background:#fff}' +
    'caption{text-align:left;font-weight:700;margin-bottom:8px}</style>' +
    `<table><caption>Réponse structurée</caption><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
  return renderWidgetDocument(fragment, theme);
}

function renderStructuredPayloadWidget(
  candidate: Extract<WidgetCandidate, { kind: 'payload' }>,
  theme?: WidgetTheme,
): string {
  const record = candidate.data && typeof candidate.data === 'object' && !Array.isArray(candidate.data)
    ? candidate.data as Record<string, unknown>
    : { value: candidate.data };
  const rows = Object.entries(record)
    .map(([key, value]) => `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(String(value))}</td></tr>`)
    .join('');
  const fragment =
    '<style>table{border-collapse:collapse;width:100%;font:14px system-ui,sans-serif}' +
    'th,td{border:1px solid #cbd5e1;padding:7px 9px;text-align:left}' +
    'th{background:#e2e8f0;font-weight:700}td{background:#fff}' +
    `caption{text-align:left;font-weight:700;margin-bottom:8px}</style>` +
    `<table><caption>${escapeHtml(candidate.dataType)}</caption><tbody>${rows}</tbody></table>`;
  return renderWidgetDocument(fragment, theme);
}
/**
 * Detect and render at most one automatic widget. All failures are fail-open:
 * callers always receive the exact original answer and no exception.
 */
export async function autoWidget(
  answer: string,
  payloads: readonly unknown[] = [],
  deps: AutoWidgetDeps = {}
): Promise<AutoWidgetResult> {
  const env = deps.env ?? process.env;
  if (!enabled(env)) return safeResult(answer);

  let candidate: WidgetCandidate | null = null;
  try {
    candidate = detectWidgetable(answer, payloads);
    if (!candidate) return safeResult(answer);

    const registry = deps.registry ?? listAuthoredWidgetRegistry(env);
    const authored = matchAuthoredWidget(candidate.dataType, registry);
    if (authored) {
      const render = deps.renderAuthored ?? renderAuthoredWidgetForData;
      const html = render(authored, candidate.data, deps.theme);
      if (!scriptFree(html)) {
        logger.debug('[auto-widget] authored render returned no safe HTML', {
          dataType: candidate.dataType,
          widget: authored.kind,
        });
        return safeResult(answer, candidate);
      }
      recordAuthoredWidgetUse(authored.kind, env, deps.now?.() ?? Date.now());
      return { answer, widgetHtml: html, candidate };
    }

    // Curated rendering remains authoritative for its built-in discriminator.
    if (resolveWidgetSource(candidate.dataType, env) === 'curated') {
      const render = deps.renderCurated ?? renderWidgetForData;
      const html = render(candidate.data, env, deps.theme);
      return scriptFree(html) ? { answer, widgetHtml: html, candidate } : safeResult(answer, candidate);
    }

    // A legacy same-kind file is renderable explicitly, but without dataTypes it
    // must never enter the automatic path (including through resolveOrGenerate).
    if (resolveWidgetSource(candidate.dataType, env) === 'authored') {
      return safeResult(answer, candidate);
    }

    // Structured kinds (tables and typed payloads) have deterministic renderers;
    // the automatic answer path never needs to invoke an LLM.
    if (candidate.kind === 'table') {
      return { answer, widgetHtml: renderMarkdownTableWidget(candidate, deps.theme), candidate };
    }
    return { answer, widgetHtml: renderStructuredPayloadWidget(candidate, deps.theme), candidate };
  } catch (error) {
    logger.debug('[auto-widget] pipeline failed; preserving text response', {
      dataType: candidate?.dataType,
      error: error instanceof Error ? error.message : String(error),
    });
    return safeResult(answer, candidate);
  }
}
