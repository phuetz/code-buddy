/**
 * Widget gate — fail-closed validation of an authored widget template.
 */
import { gateWidget, scanWidgetFirewall } from '../../src/widgets/widget-gate.js';
import type { WidgetProposal } from '../../src/widgets/widget-types.js';

const sample = { type: 'stock', symbol: 'ACME', price: 42, items: [{ t: 'a' }] };
function prop(template: string): WidgetProposal {
  return { kind: 'stock', template, sample };
}

const CLEAN = `<style>.cbw-stock{padding:8px}</style><div class="cbw-stock">{{ symbol }}: {{ price }}</div>`;

describe('scanWidgetFirewall', () => {
  it('flags scripts, external loads, handlers, javascript: and @import', () => {
    expect(scanWidgetFirewall('<script>x</script>')).not.toHaveLength(0);
    expect(scanWidgetFirewall('<img src="https://evil/x.png">')).not.toHaveLength(0);
    expect(scanWidgetFirewall('<div onclick="x">')).not.toHaveLength(0);
    expect(scanWidgetFirewall('<a href="javascript:alert(1)">')).not.toHaveLength(0);
    expect(scanWidgetFirewall('<style>@import "http://evil";</style>')).not.toHaveLength(0);
    expect(scanWidgetFirewall('<style>.x{background:url(http://evil/a.png)}</style>')).not.toHaveLength(0);
    expect(scanWidgetFirewall('<iframe src="x">')).not.toHaveLength(0);
  });

  it('allows a clean self-contained template and outbound <a href>', () => {
    expect(scanWidgetFirewall(CLEAN)).toHaveLength(0);
    expect(scanWidgetFirewall('<a href="https://example.com/article">read</a>')).toHaveLength(0);
  });
});

describe('gateWidget', () => {
  it('accepts a clean template and returns the rendered fragment', () => {
    const v = gateWidget(prop(CLEAN));
    expect(v.accepted).toBe(true);
    expect(v.fragment).toContain('ACME: 42');
  });

  it('rejects an empty template', () => {
    expect(gateWidget(prop('   ')).reason).toBe('render-empty');
  });

  it('rejects a template with a <script> (static scan)', () => {
    const v = gateWidget(prop(`${CLEAN}<script>fetch("//evil")</script>`));
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe('static-scan');
  });

  it('rejects a template that loads an external resource', () => {
    const v = gateWidget(prop(`<div class="cbw-stock"><img src="https://evil/pixel.png">{{ symbol }}</div>`));
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe('static-scan');
  });

  it('rejects a template that renders to empty output', () => {
    const v = gateWidget(prop('<div class="cbw-stock">{{ missing.path }}</div>'));
    // renders to "<div class=...></div>" which is non-empty; use a template that yields only whitespace
    expect(v.accepted).toBe(true); // structural HTML remains → non-empty & safe
    const v2 = gateWidget({ kind: 'stock', template: '{{ missing.path }}', sample });
    expect(v2.accepted).toBe(false);
    expect(v2.reason).toBe('render-empty');
  });

  it('escaped data cannot smuggle a script past the gate', () => {
    const evil = { type: 'stock', symbol: '<script>alert(1)</script>', price: 1 };
    const v = gateWidget({ kind: 'stock', template: CLEAN, sample: evil });
    expect(v.accepted).toBe(true); // the script is escaped in the rendered fragment
    expect(v.fragment).not.toContain('<script>');
    expect(v.fragment).toContain('&lt;script&gt;');
  });
});
