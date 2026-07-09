/**
 * Widget registry — curated resolution, authored fallback (curated wins), and
 * SERVER-SIDE rendering (data interpolated into static HTML, no client script —
 * CSP-proof for inline srcdoc iframes). Pure/isolated (temp authored dir).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveWidgetSource,
  renderWidgetFragment,
  renderWidgetDocument,
  renderWidgetForData,
  hasWidgetForData,
} from '../../src/widgets/widget-registry.js';
import { widgetKind, type WeatherWidgetData } from '../../src/widgets/widget-types.js';

const sampleWeather: WeatherWidgetData = {
  type: 'weather',
  location: 'Paris',
  current: { temperature: 22, feelsLike: 24, condition: 'ensoleillé', humidity: 66, windSpeed: 6 },
  forecast: [{ day: 'jeu', min: 15, max: 24, condition: 'ensoleillé' }],
  units: 'metric',
};

describe('resolveWidgetSource', () => {
  it('returns curated for weather and news (case-insensitive)', () => {
    expect(resolveWidgetSource('weather')).toBe('curated');
    expect(resolveWidgetSource('news')).toBe('curated');
    expect(resolveWidgetSource('WEATHER')).toBe('curated');
  });

  it('returns null for an unknown kind with no authored widget', () => {
    expect(resolveWidgetSource('stock', {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('falls back to an authored widget for a NEW kind, but curated wins', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wdg-'));
    const env = { CODEBUDDY_WIDGETS_DIR: dir } as NodeJS.ProcessEnv;
    // Authored widget for a novel kind 'stock'.
    mkdirSync(join(dir, 'authored-stock'), { recursive: true });
    writeFileSync(join(dir, 'authored-stock', 'widget.html'), '<div>stock</div>');
    expect(resolveWidgetSource('stock', env)).toBe('authored');
    // An authored 'weather' must NOT shadow the curated one.
    mkdirSync(join(dir, 'authored-weather'), { recursive: true });
    writeFileSync(join(dir, 'authored-weather', 'widget.html'), '<div>evil</div>');
    expect(resolveWidgetSource('weather', env)).toBe('curated');
  });
});

describe('server-side rendering (no client script)', () => {
  it('renderWidgetForData interpolates the real data, wraps a full doc, and injects NO script', () => {
    const doc = renderWidgetForData(sampleWeather)!;
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('Paris'); // location interpolated directly into the HTML
    expect(doc).toContain('22°C'); // temperature rendered server-side
    expect(doc).not.toContain('window.__WIDGET_DATA__'); // no client-side data script
    expect(doc).not.toMatch(/<script/i); // CSP-proof: zero <script>
  });

  it('escapes injected values so they cannot break out of the markup', () => {
    const doc = renderWidgetForData({ type: 'weather', location: '</div><b>x', current: {} })!;
    expect(doc).not.toContain('</div><b>x'); // '<' and '>' are HTML-escaped
    expect(doc).toContain('&lt;'); // proof of escaping
  });

  it('renderWidgetFragment returns null for an unrecognized payload', () => {
    expect(renderWidgetFragment({ nope: true })).toBeNull();
    expect(renderWidgetFragment('not an object')).toBeNull();
  });

  it('renderWidgetForData returns null for an unrecognized payload', () => {
    expect(renderWidgetForData({ nope: true })).toBeNull();
  });

  it('renders a news payload server-side with the item titles inline', () => {
    const doc = renderWidgetForData({
      type: 'news',
      title: 'À la une',
      items: [{ title: 'Titre A', source: 'Le Monde' }],
    })!;
    expect(doc).toContain('À la une');
    expect(doc).toContain('Titre A');
    expect(doc).not.toMatch(/<script/i);
  });

  it('renderWidgetDocument wraps a fragment into a self-contained doc', () => {
    const doc = renderWidgetDocument('<div>hi</div>');
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('<div>hi</div>');
  });
});

describe('helpers', () => {
  it('widgetKind extracts the type', () => {
    expect(widgetKind({ type: 'weather' })).toBe('weather');
    expect(widgetKind({})).toBeNull();
  });
  it('hasWidgetForData', () => {
    expect(hasWidgetForData(sampleWeather)).toBe(true);
    expect(hasWidgetForData({ type: 'stock' }, {} as NodeJS.ProcessEnv)).toBe(false);
  });
});
