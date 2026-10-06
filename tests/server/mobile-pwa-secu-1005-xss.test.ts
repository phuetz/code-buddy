/**
 * CB-PWA-SECU-1005 — XSS rendu messages / légendes photos (happy-dom).
 */
// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(__dirname, '../../src/server/mobile/assets');
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

type MobileApi = {
  init: () => void;
  destroy: () => void;
  clearHistory: () => void;
  addMessage: (partial: Record<string, unknown>) => { id: string };
  renderMessages: () => void;
  handleFrame: (data: Record<string, unknown>) => void;
  searchConversation: (query: string) => string[];
  STORAGE: Record<string, string>;
};

function loadApp(): MobileApi {
  document.documentElement.innerHTML = readFileSync(path.join(assetsDir, 'index.html'), 'utf8')
    .replace(/^[\s\S]*?<body>/, '')
    .replace(/<\/body>[\s\S]*$/, '');
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(path.join(assetsDir, 'emoji-data.js'), 'utf8'))();
  // eslint-disable-next-line no-new-func
  new Function(readFileSync(path.join(assetsDir, 'app.js'), 'utf8'))();
  return (globalThis as unknown as { CodeBuddyMobile: MobileApi }).CodeBuddyMobile;
}

describe('CB-PWA-SECU-1005 — XSS messages / légendes photos', () => {
  let api: MobileApi;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    api = loadApp();
    api.init();
    api.clearHistory();
  });

  afterEach(() => {
    try {
      api.clearHistory();
      api.destroy();
    } catch {
      /* ignore */
    }
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = '';
    delete (window as unknown as { __pwa_xss?: number }).__pwa_xss;
    delete (window as unknown as { __pwa_ws_xss?: number }).__pwa_ws_xss;
  });

  it('refuse une data URL hostile dans le rendu d’image (pas de breakout d’attribut)', () => {
    const hostile = 'data:image/png;base64,abc" onerror="window.__pwa_xss=1" x="';
    api.addMessage({ role: 'assistant', text: 'caption <b>x</b>', image: hostile });
    api.renderMessages();
    const img = document.querySelector('img.bubble-img') as HTMLImageElement | null;
    expect(img).toBeNull();
    expect((window as unknown as { __pwa_xss?: number }).__pwa_xss).toBeUndefined();
    const html = document.getElementById('messages')!.innerHTML;
    expect(html).not.toContain('onerror=');
    expect(html).toContain('caption');
    expect(html).not.toContain('<b>x</b>');
  });

  it('accepte une vraie miniature PNG et échappe le texte de légende', () => {
    api.addMessage({
      role: 'assistant',
      text: 'légende <img src=x onerror=alert(1)>',
      image: TINY_PNG,
    });
    api.renderMessages();
    const img = document.querySelector('img.bubble-img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(TINY_PNG);
    expect(img.getAttribute('onerror')).toBeNull();
    const body = document.querySelector('.bubble-body')!.innerHTML;
    expect(body).toContain('&lt;img');
    expect(body).not.toContain('<img src=x');
  });

  it('ignore une trame WS dont le champ image.data casse l’attribut src', () => {
    api.handleFrame({
      type: 'chat_response',
      payload: {
        content: 'ok',
        image: { mimeType: 'image/png', data: 'AAAA" onerror="window.__pwa_ws_xss=1" x="' },
      },
    });
    api.renderMessages();
    expect(document.querySelector('img.bubble-img')).toBeNull();
    expect((window as unknown as { __pwa_ws_xss?: number }).__pwa_ws_xss).toBeUndefined();
  });

  it('la recherche ne réécrit pas l’intérieur des balises HTML', () => {
    api.addMessage({ role: 'assistant', text: 'bonjour classe' });
    api.renderMessages();
    api.searchConversation('class');
    api.renderMessages();
    const row = document.querySelector('.msg-row');
    expect(row).toBeTruthy();
    expect(row!.className).toMatch(/msg-row/);
    expect(row!.outerHTML).not.toMatch(/msg-row[^>]*<mark/);
  });
});
