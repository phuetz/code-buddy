/**
 * Curated stock/market widget — server-side rendered, theme-aware, tolerant of
 * string inputs, green/red on sign, missing fields → em-dash. Pure.
 */
import { renderStockWidget } from '../../src/widgets/curated/stock.js';
import { renderWidgetForData } from '../../src/widgets/widget-registry.js';

describe('renderStockWidget', () => {
  const up = {
    type: 'stock',
    name: 'Apple Inc.',
    symbol: 'AAPL',
    price: 226.34,
    change: 3.12,
    changePercent: 1.4,
    currency: 'USD',
    open: 223.5,
    high: 227.1,
    low: 222.8,
    previousClose: 223.22,
    volume: 48200000,
    market: 'NASDAQ',
  };

  it('renders name, symbol and a formatted price with the currency', () => {
    const h = renderStockWidget(up);
    expect(h).toContain('Apple Inc.');
    expect(h).toContain('AAPL');
    expect(h).toContain('226,34'); // fr-FR formatting
    expect(h).toContain('USD');
    expect(h).not.toMatch(/<script/i);
  });

  it('is GREEN (no neg class, + sign) on a positive move', () => {
    const h = renderStockWidget(up);
    expect(h).toContain('class="pill "'); // no "neg"
    expect(h).toContain('+1,40%');
  });

  it('is RED (neg class, no + sign) on a negative move', () => {
    const h = renderStockWidget({ ...up, change: -2.5, changePercent: -1.1 });
    expect(h).toContain('pill neg');
    expect(h).toContain('bar neg');
    expect(h).toContain('-1,10%');
    expect(h).not.toContain('+-'); // sign not doubled
  });

  it('parses string inputs (price "226,34", percent "1,4%")', () => {
    const h = renderStockWidget({ type: 'stock', symbol: 'X', price: '226,34', changePercent: '1,4%' });
    expect(h).toContain('226,34');
    expect(h).toContain('1,40%');
  });

  it('shows em-dash for missing OHLC fields (never "undefined"/"NaN")', () => {
    const h = renderStockWidget({ type: 'stock', symbol: 'X', price: 10 });
    expect(h).toContain('—');
    expect(h).not.toMatch(/undefined|NaN/);
  });

  it('quotes an index (type market/bourse) in points when no currency given', () => {
    const h = renderStockWidget({ type: 'market', name: 'CAC 40', value: 7654.2, changePercent: -0.5 });
    expect(h).toContain('pts');
    expect(h).toContain('654,20'); // value used when price absent (fr-FR thousands sep is U+202F)
  });

  it('carries a data-cbw-theme dark variant (host-driven theme)', () => {
    expect(renderStockWidget(up)).toContain(':root[data-cbw-theme="dark"] .cbw-stock');
  });

  it('is reachable through the registry with a self-contained doc + CSP', () => {
    const doc = renderWidgetForData(up)!;
    expect(doc).toContain('<!doctype html>');
    expect(doc).toContain('Apple Inc.');
    expect(doc).toContain("default-src 'none'"); // hardening CSP applies
    expect(doc).not.toMatch(/<script/i);
  });
});
