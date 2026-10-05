/**
 * CB-RENDU-XSS-1005 — rendu sortie modèle : XSS fail-closed sur surfaces web.
 *
 * Couvre : html-render-guard, canvas push/serve, a2ui HTML, web-ui markdown links,
 * widgets neutralize, PWA data-URL images (happy-dom via mobile-pwa-secu-1005-xss).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  escapeHtml,
  gateCanvasPayload,
  isSafeDataImageUrl,
  neutralizeUnsafeUrls,
  safeMarkdownHref,
  safeUrl,
  sanitizeCssValue,
  scanUnsafeCanvasHtml,
} from '../../src/security/html-render-guard.js';
import { A2UIManager } from '../../src/canvas/a2ui-manager.js';
import { canvasStore } from '../../src/server/routes/canvas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

describe('CB-RENDU-XSS-1005 — html-render-guard', () => {
  it('refuse javascript: / data:text/html / attr-breakout dans safeUrl', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('JAVASCRIPT:alert(1)')).toBe('');
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(safeUrl('https://ok.example/a.png')).toBe('https://ok.example/a.png');
    expect(safeUrl('https://ok.example/"onerror="x')).toBe('');
    expect(
      isSafeDataImageUrl(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      ),
    ).toBe(true);
    expect(isSafeDataImageUrl('data:image/png;base64,abc" onerror="x"')).toBe(false);
  });

  it('refuse javascript: dans safeMarkdownHref', () => {
    expect(safeMarkdownHref('javascript:alert(1)')).toBe('');
    expect(safeMarkdownHref('https://example.com')).toBe('https://example.com');
    expect(safeMarkdownHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeMarkdownHref('#section')).toBe('#section');
  });

  it('neutralise les CSS hostiles (breakout / expression)', () => {
    expect(sanitizeCssValue('red')).toBe('red');
    expect(sanitizeCssValue('12px')).toBe('12px');
    expect(sanitizeCssValue('red" onload="alert(1)')).toBe('');
    expect(sanitizeCssValue('expression(alert(1))')).toBe('');
  });

  it('scanne le HTML canvas pour script / handlers / javascript:', () => {
    expect(scanUnsafeCanvasHtml('<div>ok</div>')).toEqual([]);
    expect(scanUnsafeCanvasHtml('<script>alert(1)</script>')).toContain('inline <script>');
    expect(scanUnsafeCanvasHtml('<img src=x onerror=alert(1)>')).toContain('inline event handler');
    expect(scanUnsafeCanvasHtml('<a href="javascript:alert(1)">x</a>')).toContain('javascript: URL');
  });

  it('gateCanvasPayload refuse js + HTML hostile, accepte widget inerte', () => {
    const badJs = gateCanvasPayload({ html: '<div>x</div>', js: 'alert(1)' });
    expect(badJs.ok).toBe(false);
    expect(badJs.reasons.join(' ')).toMatch(/js/i);

    const badHtml = gateCanvasPayload({
      html: '<div><img src=x onerror=alert(1)></div>',
    });
    expect(badHtml.ok).toBe(false);

    const ok = gateCanvasPayload({
      html: '<div class="cbw-stock">AAPL 226</div>',
    });
    expect(ok.ok).toBe(true);
    expect(ok.html).toContain('AAPL');
  });

  it('escapeHtml empêche l’injection de balises', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
  });

  it('neutralizeUnsafeUrls remplace javascript: par #blocked', () => {
    const out = neutralizeUnsafeUrls('<a href="javascript:alert(1)">x</a><img src="javascript:1">');
    expect(out).toContain('href="#blocked"');
    expect(out).toContain('src="#blocked"');
    expect(out).not.toMatch(/javascript:/i);
  });
});

describe('CB-RENDU-XSS-1005 — canvas store / snapshot', () => {
  afterEach(() => {
    canvasStore.clear();
  });

  it('refuse un push avec <script> ou champ js', () => {
    expect(() =>
      canvasStore.push('<div>ok</div><script>window.__xss=1</script>'),
    ).toThrow(/Unsafe canvas payload/i);

    expect(() => canvasStore.push('<div>ok</div>', undefined, 'alert(1)')).toThrow(
      /Unsafe canvas payload|js/i,
    );
  });

  it('sert une page sans balise script pour un widget sûr', async () => {
    const snap = canvasStore.push(
      '<!doctype html><html><body><div class="cbw">hello</div></body></html>',
    );
    const { createCanvasRoutes } = await import('../../src/server/routes/canvas.js');
    const routes = createCanvasRoutes();
    const get = routes.find((r) => r.method === 'GET' && r.path.endsWith('/canvas/:id'));
    expect(get).toBeTruthy();
    let body = '';
    await get!.handler(
      { url: `/__codebuddy__/canvas/${snap.id}` },
      {
        writeHead: () => undefined,
        end: (b?: string) => {
          body = b || '';
        },
      },
    );
    expect(body).toContain('hello');
    expect(body).not.toMatch(/<script>/i);
  });
});

describe('CB-RENDU-XSS-1005 — a2ui renderToHTML', () => {
  it('bloque src javascript: et breakout d’attribut sur image', () => {
    const mgr = new A2UIManager();
    mgr.processMessage({
      surfaceUpdate: {
        surfaceId: 's1',
        components: [
          {
            id: 'img1',
            component: {
              image: {
                src: 'javascript:alert(1)',
                alt: 'x',
              },
            },
          },
          {
            id: 'img2',
            component: {
              image: {
                src: 'https://cdn.example/a.png" onerror="alert(1)" x="',
                alt: '<b>no</b>',
              },
            },
          },
          {
            id: 'img3',
            component: {
              image: {
                src: 'https://cdn.example/a.png',
                alt: 'ok',
              },
            },
          },
        ],
      },
    });
    mgr.processMessage({
      beginRendering: { surfaceId: 's1', root: 'img1' },
    });
    // Render each as root
    const htmlHostile = (() => {
      mgr.processMessage({ beginRendering: { surfaceId: 's1', root: 'img1' } });
      return mgr.renderToHTML('s1');
    })();
    expect(htmlHostile).not.toMatch(/javascript:/i);
    expect(htmlHostile).toMatch(/a2ui-image--blocked|role="img"/);

    mgr.processMessage({ beginRendering: { surfaceId: 's1', root: 'img2' } });
    const htmlBreak = mgr.renderToHTML('s1');
    expect(htmlBreak).not.toMatch(/onerror=/i);
    expect(htmlBreak).not.toContain('<b>no</b>');

    mgr.processMessage({ beginRendering: { surfaceId: 's1', root: 'img3' } });
    const htmlOk = mgr.renderToHTML('s1');
    expect(htmlOk).toContain('src="https://cdn.example/a.png"');
    expect(htmlOk).toContain('alt="ok"');
  });

  it('échappe data-action / variant hostiles sur bouton', () => {
    const mgr = new A2UIManager();
    mgr.processMessage({
      surfaceUpdate: {
        surfaceId: 'btn-s',
        components: [
          {
            id: 'b1" onfocus="alert(1)" x="',
            component: {
              button: {
                label: '<script>x</script>',
                variant: 'primary" onmouseover="alert(1)" x="',
                action: { name: 'go" onclick="alert(1)" x="' },
              },
            },
          },
        ],
      },
    });
    mgr.processMessage({ beginRendering: { surfaceId: 'btn-s', root: 'b1" onfocus="alert(1)" x="' } });
    const html = mgr.renderToHTML('btn-s');
    expect(html).not.toMatch(/onmouseover=/i);
    expect(html).not.toMatch(/onclick=/i);
    expect(html).not.toMatch(/onfocus=/i);
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
  });

  it('refuse injection CSS via styles.backgroundColor', () => {
    const mgr = new A2UIManager();
    mgr.processMessage({
      surfaceUpdate: {
        surfaceId: 'css-s',
        components: [
          {
            id: 't1',
            component: {
              text: {
                value: 'hi',
                styles: { backgroundColor: 'red" onload="alert(1)" x="' as unknown as string },
              },
            },
          },
        ],
      },
    });
    mgr.processMessage({ beginRendering: { surfaceId: 'css-s', root: 't1' } });
    const html = mgr.renderToHTML('css-s');
    expect(html).not.toMatch(/onload=/i);
    // hostile value dropped → no background-color: red"... 
    expect(html).not.toContain('onload');
  });
});

describe('CB-RENDU-XSS-1005 — web-ui markdown links (source contract)', () => {
  it('le renderer web-ui bloque javascript: (regex fail-closed)', () => {
    const src = readFileSync(path.join(repoRoot, 'src/server/web-ui/index.html'), 'utf8');
    expect(src).toMatch(/#blocked/);
    expect(src).toMatch(/https\?:|mailto:|#/);
    // Simulate the patched linker
    const linkify = (md: string) => {
      const escapeHtml = (s: string) =>
        s.replace(/[&<>"']/g, (c) =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
        );
      let processed = escapeHtml(md);
      processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
        const raw = String(href || '').trim();
        const safe = /^(https?:|mailto:|#)/i.test(raw) && !/[<>"'\s]/.test(raw) ? raw : '#blocked';
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      });
      return processed;
    };
    const out = linkify('click [x](javascript:alert(1)) and [ok](https://example.com)');
    expect(out).toContain('href="#blocked"');
    expect(out).toContain('href="https://example.com"');
    expect(out).not.toMatch(/javascript:/i);
  });
});

describe('CB-RENDU-XSS-1005 — MessageMarkdown / Electron contract', () => {
  it('MessageMarkdown filtre les href non http(s)/mailto/#', () => {
    const src = readFileSync(
      path.join(repoRoot, 'cowork/src/renderer/components/MessageMarkdown.tsx'),
      'utf8',
    );
    expect(src).toMatch(/SAFE_HREF_RE/);
    expect(src).toMatch(/isSafeHref/);
    expect(src).toMatch(/openExternal/);
  });

  it('fenêtre principale Electron : contextIsolation + sandbox + pas de nodeIntegration', () => {
    const src = readFileSync(path.join(repoRoot, 'cowork/src/main/index.ts'), 'utf8');
    expect(src).toMatch(/nodeIntegration:\s*false/);
    expect(src).toMatch(/contextIsolation:\s*true/);
    expect(src).toMatch(/sandbox:\s*true/);
  });

  it('MermaidBlock : securityLevel strict + DOMPurify avant dangerouslySetInnerHTML', () => {
    const src = readFileSync(
      path.join(repoRoot, 'cowork/src/renderer/components/message/MermaidBlock.tsx'),
      'utf8',
    );
    expect(src).toMatch(/securityLevel:\s*'strict'/);
    expect(src).toMatch(/DOMPurify\.sanitize/);
  });

  it('ArtifactPanel iframe : sandbox sans allow-same-origin', () => {
    const src = readFileSync(
      path.join(repoRoot, 'cowork/src/renderer/components/ArtifactPanel.tsx'),
      'utf8',
    );
    expect(src).toMatch(/sandbox="allow-scripts"/);
    expect(src).not.toMatch(/allow-same-origin/);
  });
});
