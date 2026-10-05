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

describe('A2UI : type inconnu et largeur de colonne hostiles', () => {
  it('node.type hostile ne sort pas de l\'attribut class', () => {
    const mgr = new A2UIManager();
    mgr.processMessage({
      surfaceUpdate: { surfaceId: 's', components: [{ id: 'root1', component: { ['evil" onmouseover="alert(1) x="']: {} } }] },
    } as never);
    mgr.processMessage({ beginRendering: { surfaceId: 's', root: 'root1' } } as never);
    const html = mgr.renderToHTML('s');
    // ÉCHOUE sur l'ancienne logique : <div class="a2ui-evil" onmouseover="alert(1) x="">.
    expect(html).not.toMatch(/\sonmouseover="/i);
    expect(html).not.toContain('alert(1)');
  });

  it('col.width hostile ne sort pas de l\'attribut style', () => {
    const html = render('table', {
      columns: [{ key: 'a', label: 'A', width: '100px" onmouseover="alert(2)' }, { key: 'b', label: 'B', width: 120 }],
      data: [],
    });
    // ÉCHOUE sur l'ancienne logique : <th style="width: 100px" onmouseover="alert(2)">.
    expect(html).not.toMatch(/\sonmouseover="/i);
    expect(html).toContain('width: 120px');
  });
});

describe('A2UI : surfaceId hostile (script inline, page, index du serveur)', () => {
  const HOSTILE = "s';alert(1);'";
  const mgrWith = (id: string) => {
    const mgr = new A2UIManager();
    mgr.processMessage({ surfaceUpdate: { surfaceId: id, components: [{ id: 'root', component: { text: { text: 't' } } }] } } as never);
    mgr.processMessage({ beginRendering: { surfaceId: id, root: 'root' } } as never);
    return mgr;
  };

  it('le script inline ne laisse pas sortir le surfaceId de sa chaîne', () => {
    const html = mgrWith(HOSTILE).renderToHTML(HOSTILE);
    // ÉCHOUE sur l'ancienne logique : « : 's';alert(1);'';  » dans le <script>.
    expect(html).not.toContain("';alert(1)");
  });

  it('le message « surface introuvable » échappe l\'identifiant', () => {
    const html = new A2UIManager().renderToHTML('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
  });

  it('l\'index du serveur échappe l\'id dans le lien et dans le texte', async () => {
    const { A2UIServer } = await import('../../src/canvas/a2ui-server.js');
    const id = '</a><img src=x onerror=alert(1)>';
    const server = new A2UIServer({}, mgrWith(id));
    let body = '';
    const res = { writeHead: () => res, setHeader: () => res, end: (b: string) => { body = String(b); } };
    (server as unknown as { handleIndex(req: unknown, res: unknown): void }).handleIndex({}, res);
    // ÉCHOUE sur l'ancienne logique : <a href="/surface/</a><img src=x onerror=alert(1)>">.
    expect(body).not.toContain('<img src=x');
    expect(body).toContain('/surface/' + encodeURIComponent(id));
  });
});

describe('neutralizeUnsafeUrls : valeurs non citées et attributs voisins', () => {
  it.each([
    ['<a href=javascript:alert(1)>x</a>', 'javascript:'],
    ['<button formaction="javascript:alert(1)">x</button>', 'javascript:'],
    ['<video poster=javascript:alert(1)></video>', 'javascript:'],
    ['<img srcset="https://ok/a.png 1x, javascript:alert(1) 2x">', 'javascript:'],
  ])('%s', async (html, forbidden) => {
    const { neutralizeUnsafeUrls } = await import('../../src/security/html-render-guard.js');
    // ÉCHOUE sur l'ancienne logique : seules les valeurs citées de href/src/action étaient filtrées.
    expect(neutralizeUnsafeUrls(html)).not.toContain(forbidden);
  });
  it('une URL sûre est conservée, un 0 légitime aussi (finiteNum)', async () => {
    const { neutralizeUnsafeUrls } = await import('../../src/security/html-render-guard.js');
    expect(neutralizeUnsafeUrls('<a href="https://ok/x">x</a>')).toContain('https://ok/x');
    expect(render('slider', { value: 0, min: 0, max: 0 })).toContain('max="0"');
  });
});
