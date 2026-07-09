/**
 * Curated news widget — SERVER-SIDE rendered (static HTML, no client script;
 * CSP-proof for inline srcdoc iframes). Pure.
 * @module widgets/curated/news
 */
import type { NewsWidgetData } from '../widget-types.js';

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]!);
}

const STYLE = `<style>
.cbw-news{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;border-radius:16px;padding:16px 18px;color:#0b1220;background:#fff;border:1px solid rgba(0,0,0,.08);max-width:520px}
.cbw-news .h{font-size:14px;font-weight:700;margin-bottom:10px}
.cbw-news ul{list-style:none;margin:0;padding:0}
.cbw-news li{padding:9px 0;border-top:1px solid rgba(0,0,0,.06);font-size:14px;line-height:1.35}
.cbw-news li:first-child{border-top:none}
.cbw-news .src{display:block;font-size:11px;opacity:.55;margin-top:2px}
.cbw-news a{color:inherit;text-decoration:none}
.cbw-news a:hover{text-decoration:underline}
@media (prefers-color-scheme:dark){.cbw-news{color:#e8eefc;background:#0f1626;border-color:rgba(255,255,255,.08)}.cbw-news li{border-color:rgba(255,255,255,.08)}}
</style>`;

/** Render a news payload to a self-contained HTML fragment (no script). */
export function renderNewsWidget(raw: unknown): string {
  const d = (raw ?? {}) as Partial<NewsWidgetData>;
  const items = Array.isArray(d.items) ? d.items.slice(0, 8) : [];
  const body = items.length
    ? `<ul>${items
        .map((it) => {
          const title = esc(it.title ?? '');
          const inner = it.url
            ? `<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${title}</a>`
            : title;
          return `<li>${inner}${it.source ? `<span class="src">${esc(it.source)}</span>` : ''}</li>`;
        })
        .join('')}</ul>`
    : `<div style="opacity:.6;font-size:13px">Pas d'actualité disponible.</div>`;
  return `${STYLE}<div class="cbw-news"><div class="h">📰 ${esc(d.title ?? 'Actualités du jour')}</div>${body}</div>`;
}
