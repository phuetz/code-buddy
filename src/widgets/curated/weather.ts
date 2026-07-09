/**
 * Curated weather widget — SERVER-SIDE rendered (data interpolated into static
 * HTML + scoped CSS, NO client <script>). This is CSP-proof: an inline-script
 * approach fails because srcdoc iframes inherit the host CSP. `renderWeatherWidget`
 * returns a self-contained body fragment. Pure.
 * @module widgets/curated/weather
 */
import type { WeatherWidgetData } from '../widget-types.js';

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]!);
}

function emoji(cond: unknown): string {
  const c = String(cond ?? '').toLowerCase();
  if (/orage|thunder|storm/.test(c)) return '⛈️';
  if (/neige|snow/.test(c)) return '🌨️';
  if (/pluie|rain|averse|drizzle|bruine/.test(c)) return '🌧️';
  if (/brou|fog|mist|brume/.test(c)) return '🌫️';
  if (/nuag|cloud|couvert|overcast/.test(c)) return '☁️';
  if (/eclair|éclair|partiel|partly/.test(c)) return '⛅';
  if (/soleil|clear|ensole|sunny|degage|dégagé/.test(c)) return '☀️';
  return '🌡️';
}

const STYLE = `<style>
.cbw-weather{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;border-radius:16px;padding:18px 20px;color:#0b1220;background:linear-gradient(135deg,#eaf3ff 0%,#f7fbff 100%);border:1px solid rgba(0,0,0,.06);max-width:460px}
.cbw-weather .top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.cbw-weather .loc{font-size:14px;font-weight:600;opacity:.8}
.cbw-weather .temp{font-size:44px;font-weight:700;line-height:1}
.cbw-weather .emoji{font-size:44px}
.cbw-weather .cond{margin-top:2px;font-size:14px;opacity:.85;text-transform:capitalize}
.cbw-weather .meta{margin-top:8px;font-size:12px;opacity:.7;display:flex;gap:14px;flex-wrap:wrap}
.cbw-weather .fc{margin-top:14px;display:flex;gap:10px;overflow-x:auto}
.cbw-weather .day{flex:0 0 auto;text-align:center;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.6);min-width:62px}
.cbw-weather .day .d{font-size:11px;opacity:.7;text-transform:capitalize}
.cbw-weather .day .e{font-size:20px;margin:2px 0}
.cbw-weather .day .t{font-size:12px;font-weight:600}
@media (prefers-color-scheme:dark){.cbw-weather{color:#e8eefc;background:linear-gradient(135deg,#101a2e 0%,#0b1220 100%);border-color:rgba(255,255,255,.08)}.cbw-weather .day{background:rgba(255,255,255,.06)}}
</style>`;

/** Render a weather payload to a self-contained HTML fragment (no script). */
export function renderWeatherWidget(raw: unknown): string {
  const d = (raw ?? {}) as Partial<WeatherWidgetData>;
  const cur = d.current ?? ({} as NonNullable<WeatherWidgetData['current']>);
  const unit = d.units === 'imperial' ? '°F' : '°C';
  const meta: string[] = [];
  if (cur.feelsLike != null) meta.push(`Ressenti ${Math.round(cur.feelsLike)}${unit}`);
  if (cur.humidity != null) meta.push(`💧 ${cur.humidity}%`);
  if (cur.windSpeed != null) meta.push(`💨 ${cur.windSpeed} km/h`);
  const fc = Array.isArray(d.forecast) ? d.forecast.slice(0, 5) : [];
  const temp = cur.temperature != null ? Math.round(cur.temperature) : '—';
  return (
    STYLE +
    `<div class="cbw-weather"><div class="top"><div>` +
    `<div class="loc">${esc(d.location ?? 'Météo')}</div>` +
    `<div class="temp">${temp}${unit}</div>` +
    `<div class="cond">${esc(cur.condition ?? '')}</div>` +
    `</div><div class="emoji">${emoji(cur.condition)}</div></div>` +
    (meta.length ? `<div class="meta">${meta.map((m) => esc(m)).join('<span>·</span>')}</div>` : '') +
    (fc.length
      ? `<div class="fc">${fc
          .map(
            (f) =>
              `<div class="day"><div class="d">${esc(f.day)}</div><div class="e">${emoji(f.condition)}</div>` +
              `<div class="t">${f.max != null ? Math.round(f.max) : '—'}° / ${f.min != null ? Math.round(f.min) : '—'}°</div></div>`
          )
          .join('')}</div>`
      : '') +
    `</div>`
  );
}
