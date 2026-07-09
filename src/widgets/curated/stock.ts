/** Curated stock-market widget — server-side rendered static HTML. */
import type { StockWidgetData } from '../widget-types.js';

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]!);
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const normalized = v.trim().replace(/\s/g, '').replace('%', '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function fmt(v: number | null, digits = 2): string {
  return v == null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
}

function fmtCompact(v: number | null): string {
  return v == null ? '—' : new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}

function trendLabel(pct: number | null, change: number | null): string {
  const v = pct ?? change;
  if (v == null || v === 0) return 'Stable';
  return v > 0 ? 'Hausse' : 'Baisse';
}

const STYLE = `<style>
.cbw-stock{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;border-radius:18px;padding:16px 18px;color:#0b1220;background:radial-gradient(circle at top right,rgba(16,185,129,.18),transparent 34%),linear-gradient(135deg,#fff7ed 0%,#fff 100%);border:1px solid rgba(0,0,0,.07);box-shadow:0 12px 32px rgba(15,23,42,.08);max-width:460px;min-width:300px}
.cbw-stock .top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.cbw-stock .status{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;opacity:.5;margin-bottom:8px}
.cbw-stock .label{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;opacity:.52}
.cbw-stock .name{margin-top:4px;font-size:17px;font-weight:800;line-height:1.15}
.cbw-stock .symbol{font-size:12px;opacity:.6;margin-top:3px}
.cbw-stock .price{margin-top:14px;font-size:40px;font-weight:850;line-height:1;letter-spacing:-.04em}
.cbw-stock .currency{font-size:15px;font-weight:700;opacity:.62;margin-left:5px}
.cbw-stock .move{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap}
.cbw-stock .pill{border-radius:999px;padding:7px 10px;font-size:13px;font-weight:800;white-space:nowrap;background:rgba(16,185,129,.14);color:#047857}
.cbw-stock .pill.neg{background:rgba(239,68,68,.13);color:#b91c1c}
.cbw-stock .abs{font-size:13px;font-weight:700;opacity:.68}
.cbw-stock .bar{height:6px;border-radius:999px;background:rgba(15,23,42,.1);overflow:hidden;margin-top:14px}
.cbw-stock .bar span{display:block;height:100%;width:var(--w);background:linear-gradient(90deg,#10b981,#34d399);border-radius:inherit}
.cbw-stock .bar.neg span{background:linear-gradient(90deg,#ef4444,#fb7185)}
.cbw-stock .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:8px;margin-top:14px}
.cbw-stock .cell{border-radius:12px;background:rgba(255,255,255,.58);padding:8px 9px;border:1px solid rgba(15,23,42,.06)}
.cbw-stock .k{display:block;font-size:10px;font-weight:750;letter-spacing:.06em;text-transform:uppercase;opacity:.5}
.cbw-stock .v{display:block;margin-top:2px;font-size:13px;font-weight:800}
.cbw-stock .meta{margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;font-size:12px;opacity:.62}
:root[data-cbw-theme="dark"] .cbw-stock{color:#e8eefc;background:radial-gradient(circle at top right,rgba(16,185,129,.16),transparent 34%),linear-gradient(135deg,#221609 0%,#0f1626 100%);border-color:rgba(255,255,255,.08);box-shadow:none}
:root[data-cbw-theme="dark"] .cbw-stock .cell{background:rgba(255,255,255,.055);border-color:rgba(255,255,255,.07)}
:root[data-cbw-theme="dark"] .cbw-stock .bar{background:rgba(255,255,255,.1)}
:root[data-cbw-theme="dark"] .cbw-stock .pill{background:rgba(16,185,129,.18);color:#6ee7b7}
:root[data-cbw-theme="dark"] .cbw-stock .pill.neg{background:rgba(239,68,68,.18);color:#fca5a5}
</style>`;

export function renderStockWidget(raw: unknown): string {
  const d = (raw ?? {}) as Partial<StockWidgetData>;
  const price = num(d.price) ?? num(d.value);
  const change = num(d.change);
  const pct = num(d.changePercent);
  const open = num(d.open);
  const high = num(d.high);
  const low = num(d.low);
  const volume = num(d.volume);
  const previousClose = num(d.previousClose);
  const neg = (pct ?? change ?? 0) < 0;
  const sign = neg ? '' : '+';
  // An index (market/bourse kind, or a recognized index) is quoted in points
  // unless an explicit currency is given.
  const isIndex = d.type === 'market' || d.type === 'bourse' || d.symbol === 'PX1' || d.name === 'CAC 40';
  const currency = d.currency ?? (isIndex ? 'pts' : '');
  const title = d.name ?? d.symbol ?? 'Cours de bourse';
  const pill = pct != null ? `${sign}${fmt(pct)}%` : change != null ? `${sign}${fmt(change)}` : '—';
  const abs = change != null ? `${sign}${fmt(change)}${currency ? ` ${currency}` : ''}` : '';
  const width = `${Math.min(100, Math.max(8, Math.abs(pct ?? 0) * 14))}%`;
  const status = trendLabel(pct, change);

  return (
    STYLE +
    `<div class="cbw-stock"><div class="status">${esc(status)}</div><div class="top"><div>` +
    `<div class="label">Bourse</div><div class="name">${esc(title)}</div>` +
    (d.symbol ? `<div class="symbol">${esc(d.symbol)}</div>` : '') +
    `</div><div class="pill ${neg ? 'neg' : ''}">${esc(pill)}</div></div>` +
    `<div class="price">${esc(fmt(price))}${currency ? `<span class="currency">${esc(currency)}</span>` : ''}</div>` +
    `<div class="move">${abs ? `<span class="abs">${esc(abs)}</span>` : ''}</div>` +
    `<div class="bar ${neg ? 'neg' : ''}"><span style="--w:${esc(width)}"></span></div>` +
    `<div class="grid"><div class="cell"><span class="k">Ouverture</span><span class="v">${esc(fmt(open))}</span></div><div class="cell"><span class="k">+ Haut</span><span class="v">${esc(fmt(high))}</span></div><div class="cell"><span class="k">+ Bas</span><span class="v">${esc(fmt(low))}</span></div>${previousClose != null ? `<div class="cell"><span class="k">Clôture veille</span><span class="v">${esc(fmt(previousClose))}</span></div>` : ''}</div>` +
    `<div class="meta">${d.market ? `<span>${esc(d.market)}</span>` : ''}${volume != null ? `<span>· Vol. ${esc(fmtCompact(volume))}</span>` : ''}${d.time ? `<span>· ${esc(d.time)}</span>` : ''}</div>` +
    `</div>`
  );
}
