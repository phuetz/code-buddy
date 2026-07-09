/**
 * Safe Mustache-style template engine — interpolation is always escaped, control
 * blocks work, no code is executed. Pure.
 */
import { renderTemplate, escapeHtml } from '../../src/widgets/template-engine.js';

describe('escapeHtml', () => {
  it('escapes the dangerous HTML characters', () => {
    expect(escapeHtml('<b>"x"&\'y\'')).toBe('&lt;b&gt;&quot;x&quot;&amp;&#39;y&#39;');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('renderTemplate', () => {
  it('interpolates dot-paths and escapes the value', () => {
    const out = renderTemplate('Hi {{ user.name }}!', { user: { name: '<b>x</b>' } });
    expect(out).toBe('Hi &lt;b&gt;x&lt;/b&gt;!');
  });

  it('renders empty for missing paths (never "undefined")', () => {
    expect(renderTemplate('[{{ nope.deep }}]', {})).toBe('[]');
  });

  it('iterates arrays with {{#each}} and {{this}} / fields', () => {
    const out = renderTemplate('{{#each items}}<li>{{this.t}}</li>{{/each}}', {
      items: [{ t: 'a' }, { t: 'b' }],
    });
    expect(out).toBe('<li>a</li><li>b</li>');
  });

  it('supports {{#each}} over scalars via {{this}}', () => {
    expect(renderTemplate('{{#each xs}}[{{this}}]{{/each}}', { xs: ['a', 'b'] })).toBe('[a][b]');
  });

  it('handles {{#if}} / {{else}} truthiness (empty array is falsy)', () => {
    const tpl = '{{#if items}}has{{else}}none{{/if}}';
    expect(renderTemplate(tpl, { items: [1] })).toBe('has');
    expect(renderTemplate(tpl, { items: [] })).toBe('none');
    expect(renderTemplate(tpl, {})).toBe('none');
  });

  it('resolves parent context from inside an each block', () => {
    const out = renderTemplate('{{#each items}}{{ this }}@{{ city }} {{/each}}', {
      city: 'Paris',
      items: ['a', 'b'],
    });
    expect(out).toBe('a@Paris b@Paris ');
  });

  it('handles nested each', () => {
    const out = renderTemplate('{{#each rows}}<r>{{#each cells}}{{this}}{{/each}}</r>{{/each}}', {
      rows: [{ cells: ['1', '2'] }, { cells: ['3'] }],
    });
    expect(out).toBe('<r>12</r><r>3</r>');
  });

  it('never executes interpolated markup (XSS-safe)', () => {
    const out = renderTemplate('<div>{{ x }}</div>', { x: '<img src=x onerror=alert(1)>' });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });
});
