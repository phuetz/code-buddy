import { describe, expect, it } from 'vitest';
import { A2UIManager } from '../../src/canvas/a2ui-manager.js';

/** Reprise : tous les types de composants A2UI échappent leur id et leurs props numériques. */
const HOSTILE_ID = 'x" onmouseover="alert(1)';
const render = (type: string, props: Record<string, unknown>): string => {
  const mgr = new A2UIManager();
  mgr.processMessage({
    surfaceUpdate: { surfaceId: 's', components: [{ id: HOSTILE_ID, component: { [type]: props } }] },
  } as never);
  mgr.processMessage({ beginRendering: { surfaceId: 's', root: HOSTILE_ID } } as never);
  return mgr.renderToHTML('s');
};

describe('A2UI : id hostile sur chaque type de composant', () => {
  it.each([
    ['textArea', { label: 'l', rows: '4" onfocus="alert(2)' }],
    ['checkbox', { label: 'l' }],
    ['switch', { label: 'l' }],
    ['radio', { label: 'l', value: 'v' }],
    ['select', { label: 'l', value: 'a', options: [{ value: 'a', label: 'A' }] }],
    ['slider', { value: '0" onmouseover="alert(3)', min: 0, max: 10 }],
    ['spacer', { size: '9" onmouseover="alert(4)' }],
  ])('%s', (type, props) => {
    const html = render(type, props);
    // ÉCHOUE sur l'ancienne logique : l'attribut onmouseover/onfocus sort du guillemet.
    expect(html).not.toMatch(/\son(mouseover|focus)="/i);
    expect(html).not.toContain('alert(');
  });
});
