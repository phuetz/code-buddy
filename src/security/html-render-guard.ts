/**
 * CB-RENDU-XSS-1005 — garde fail-closed pour le rendu HTML de sorties modèle.
 *
 * Pure & synchrone. Tout ce qui n'est pas prouvé sûr est rejeté / neutralisé.
 * Couvre : URLs (javascript:/data:text/html/…), attributs, fragments CSS,
 * payloads canvas (script / handlers / framing), href markdown.
 *
 * @module security/html-render-guard
 */

/** Escape for HTML text nodes and double-quoted attribute values. */
export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Alias — same escaping is correct inside double-quoted attributes. */
export const escapeAttr = escapeHtml;

const SAFE_DATA_IMAGE_RE =
  /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+=*$/i;

const SAFE_HTTP_RE = /^https?:\/\//i;
const SAFE_RELATIVE_RE = /^\/(?!\/)[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*$/;
const SAFE_TOKEN_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const SAFE_CSS_VALUE_RE = /^[a-zA-Z0-9#%.,()\s_+\-*/]+$/;

const DANGEROUS_SCHEME_RE = /^\s*(javascript|vbscript|data)\s*:/i;

/** True when a data:image/...;base64,... URL has a safe charset (no attr breakout). */
export function isSafeDataImageUrl(url: string): boolean {
  return typeof url === 'string' && SAFE_DATA_IMAGE_RE.test(url.trim());
}

/**
 * Fail-closed URL for href/src/action.
 * Allows: http(s), root-relative paths, data:image/*;base64.
 * Returns '' when unsafe (caller must omit the attribute or skip the element).
 */
export function safeUrl(
  raw: unknown,
  opts: { allowDataImage?: boolean; allowRelative?: boolean } = {},
): string {
  if (typeof raw !== 'string') return '';
  const url = raw.trim();
  if (!url || url.length > 8192) return '';

  if (DANGEROUS_SCHEME_RE.test(url)) {
    if (opts.allowDataImage !== false && isSafeDataImageUrl(url)) return url;
    return '';
  }

  if (SAFE_HTTP_RE.test(url)) {
    // Reject embedded quotes / angle brackets that break out of attributes.
    if (/[<>"'\s]/.test(url)) return '';
    return url;
  }

  if (opts.allowRelative !== false && SAFE_RELATIVE_RE.test(url)) {
    return url;
  }

  return '';
}

/** Markdown / anchor href: http(s), mailto, #fragment — never javascript:. */
export function safeMarkdownHref(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const url = raw.trim();
  if (!url || url.length > 4096) return '';
  if (/^(https?:|mailto:|#)/i.test(url) && !/[<>"'\s]/.test(url) && !/^\s*javascript:/i.test(url)) {
    return url;
  }
  return '';
}

/** Token for class suffixes / data-action / language / input type — alphanumeric. */
export function safeToken(raw: unknown, fallback = ''): string {
  if (typeof raw !== 'string') return fallback;
  const t = raw.trim();
  return SAFE_TOKEN_RE.test(t) ? t : fallback;
}

/**
 * CSS value for inline style="" — reject breakout / expression / javascript urls.
 * Numbers are emitted as-is (caller adds units when needed).
 */
export function sanitizeCssValue(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value !== 'string') return '';
  const s = value.trim();
  if (!s || s.length > 256) return '';
  if (!SAFE_CSS_VALUE_RE.test(s)) return '';
  if (/expression\s*\(|url\s*\(\s*['"]?\s*(javascript|data)\s*:/i.test(s)) return '';
  return s;
}

/** Patterns that make canvas / model HTML unsafe to serve as a document. */
const CANVAS_UNSAFE_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /<\s*script\b/i, why: 'inline <script>' },
  { re: /<\s*(iframe|object|embed|frame|frameset)\b/i, why: 'nested framing/embedding' },
  { re: /\son[a-z]+\s*=/i, why: 'inline event handler' },
  { re: /javascript\s*:/i, why: 'javascript: URL' },
  { re: /\bdata\s*:\s*text\/html/i, why: 'data:text/html payload' },
  { re: /<\s*base\b/i, why: '<base> (resource redirect)' },
  { re: /<\s*svg\b[^>]*\bon/i, why: 'SVG with event handler' },
];

const CSS_UNSAFE_RE = /expression\s*\(|@import\b|behavior\s*:|javascript\s*:|<\/style/i;

/** Scan HTML for canvas-unsafe constructs. Empty = safe. */
export function scanUnsafeCanvasHtml(html: string): string[] {
  const reasons: string[] = [];
  if (typeof html !== 'string' || !html) return ['empty html'];
  for (const { re, why } of CANVAS_UNSAFE_PATTERNS) {
    if (re.test(html)) reasons.push(why);
  }
  return reasons;
}

/** Scan CSS blob for unsafe constructs. Empty = safe. */
export function scanUnsafeCanvasCss(css: string): string[] {
  if (typeof css !== 'string' || !css.trim()) return [];
  return CSS_UNSAFE_RE.test(css) ? ['unsafe css'] : [];
}

export interface CanvasPayloadCheck {
  ok: boolean;
  reasons: string[];
  /** Sanitized payload when ok (js always stripped). */
  html?: string;
  css?: string;
}

/**
 * Fail-closed gate for canvas push payloads.
 * - `js` is ALWAYS rejected (never served).
 * - html/css must pass scanners.
 */
export function gateCanvasPayload(input: {
  html?: unknown;
  css?: unknown;
  js?: unknown;
}): CanvasPayloadCheck {
  const reasons: string[] = [];
  if (typeof input.js === 'string' && input.js.trim().length > 0) {
    reasons.push('js field forbidden');
  }
  if (typeof input.html !== 'string' || input.html.trim().length === 0) {
    reasons.push('HTML required');
    return { ok: false, reasons };
  }
  reasons.push(...scanUnsafeCanvasHtml(input.html));
  if (typeof input.css === 'string' && input.css.trim()) {
    reasons.push(...scanUnsafeCanvasCss(input.css));
  }
  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    reasons: [],
    html: input.html,
    ...(typeof input.css === 'string' && input.css.trim() ? { css: input.css } : {}),
  };
}

/**
 * Neutralize dangerous URL attributes in a fragment (defence in depth at render).
 * Mirrors widgets/neutralizeUnsafeUrls but also drops attr-breakout values.
 */
export function neutralizeUnsafeUrls(html: string): string {
  // Quoted AND unquoted values; also formaction / poster / srcset / data / ping.
  return html.replace(
    /\b(href|src|action|formaction|poster|srcset|data|ping|xlink:href)(\s*=\s*)(?:(["'])([^"']*)\3|([^\s"'>]+))/gi,
    (_full, name, eq, q, quotedVal, bareVal) => {
      const val = (quotedVal ?? bareVal ?? '') as string;
      const quote = (q as string | undefined) ?? '"';
      // srcset holds several candidates: every URL must be safe, otherwise drop all.
      const urls = String(name).toLowerCase() === 'srcset'
        ? val.split(',').map((part) => part.trim().split(/\s+/)[0] ?? '')
        : [val];
      const allSafe = urls.every((u) => u === '' || Boolean(safeUrl(u, { allowDataImage: true, allowRelative: true })));
      if (!allSafe) return `${name}${eq}${quote}#blocked${quote}`;
      const safe = urls.length === 1 ? safeUrl(val, { allowDataImage: true, allowRelative: true }) : val;
      return `${name}${eq}${quote}${safe}${quote}`;
    },
  );
}
