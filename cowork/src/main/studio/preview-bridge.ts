/**
 * Pont entre l'aperçu d'App Studio (iframe loopback dans la fenêtre Cowork)
 * et le processus principal :
 *
 * - **console du navigateur** : les messages console de la frame de l'aperçu
 *   (et elle seule : origine enregistrée par le renderer, loopback uniquement)
 *   sont recueillis sur `webContents` (`console-message`), MASQUÉS (secrets du
 *   projet) puis poussés au renderer sur `studio.preview.console` ;
 * - **sélection d'un élément** : un script fixe est injecté dans la frame de
 *   l'aperçu (`WebFrameMain.executeJavaScript`, frame d'origine loopback
 *   identique à l'URL de l'aperçu) ; au clic il décrit l'élément (balise,
 *   texte, classes, composant React/Vue, source `_debugSource`) et le poste
 *   au parent par `postMessage`. Le renderer vérifie l'origine.
 *
 * Le code injecté est une constante : rien de ce que le renderer envoie n'est
 * interprété comme du code.
 *
 * @module main/studio/preview-bridge
 */

import { isLoopbackHttpUrl } from './preview-probe-service.js';

export interface PreviewConsoleEntry {
  level: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  source: string;
  line: number;
  at: number;
}

export const PREVIEW_BRIDGE_CHANNELS = {
  watch: 'studio.preview.watch',
  inspect: 'studio.preview.inspect',
  console: 'studio.preview.console',
} as const;

/** Message posté par le script injecté (vérifié côté renderer). */
export const INSPECTOR_MESSAGE_SOURCE = 'codebuddy-studio-inspector';

/**
 * Script injecté dans la page de l'aperçu. `__ENABLE__` est remplacé par
 * `true`/`false` (seule substitution, jamais une donnée du renderer).
 */
export const INSPECTOR_SCRIPT = String.raw`(function (enable) {
  var KEY = '__codebuddyStudioInspector';
  var SOURCE = '${INSPECTOR_MESSAGE_SOURCE}';
  var st = window[KEY];
  function cssPath(el) {
    var parts = [];
    for (var n = el, depth = 0; n && n.nodeType === 1 && depth < 5; n = n.parentElement, depth++) {
      var part = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(part + '#' + n.id); break; }
      var parent = n.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === n.tagName; });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
      }
      parts.unshift(part);
    }
    return parts.join(' > ');
  }
  function reactInfo(el) {
    var key = Object.keys(el).find(function (k) { return k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0; });
    if (!key) return {};
    var fiber = el[key];
    var out = {};
    for (var f = fiber; f && !out.source; f = f.return) {
      if (f._debugSource && f._debugSource.fileName) {
        out.source = { fileName: String(f._debugSource.fileName), lineNumber: Number(f._debugSource.lineNumber) || undefined, columnNumber: Number(f._debugSource.columnNumber) || undefined };
      }
    }
    for (var g = fiber; g; g = g.return) {
      var t = g.type;
      if (typeof t === 'function' && (t.displayName || t.name)) { out.component = String(t.displayName || t.name); break; }
    }
    return out;
  }
  function vueInfo(el) {
    for (var n = el; n; n = n.parentElement) {
      var c = n.__vueParentComponent;
      if (c && c.type) {
        var out = { component: c.type.name || c.type.__name };
        if (c.type.__file) out.source = { fileName: String(c.type.__file) };
        return out;
      }
    }
    return {};
  }
  function describe(el) {
    var info = reactInfo(el);
    if (!info.component && !info.source) info = vueInfo(el);
    var text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: Array.prototype.slice.call(el.classList || [], 0, 12),
      text: text || undefined,
      selector: cssPath(el),
      html: (el.outerHTML || '').slice(0, 300),
      component: info.component,
      source: info.source,
    };
  }
  if (!st) {
    st = window[KEY] = { on: false };
    var box = document.createElement('div');
    box.setAttribute('data-codebuddy-inspector', '');
    box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #6366f1;background:rgba(99,102,241,0.12);border-radius:3px;display:none;transition:all 40ms';
    st.box = box;
    st.set = function (v) {
      st.on = !!v;
      if (!box.isConnected && document.body) document.body.appendChild(box);
      box.style.display = 'none';
      document.documentElement.style.cursor = st.on ? 'crosshair' : '';
    };
    document.addEventListener('mousemove', function (e) {
      if (!st.on) return;
      var el = e.target;
      if (!el || el === box || !el.getBoundingClientRect) return;
      var r = el.getBoundingClientRect();
      box.style.display = 'block';
      box.style.left = r.left + 'px'; box.style.top = r.top + 'px';
      box.style.width = r.width + 'px'; box.style.height = r.height + 'px';
    }, true);
    var swallow = function (e) { if (st.on) { e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); } };
    document.addEventListener('mousedown', swallow, true);
    document.addEventListener('mouseup', swallow, true);
    document.addEventListener('click', function (e) {
      if (!st.on) return;
      swallow(e);
      var el = e.target;
      if (!el || el.nodeType !== 1) return;
      window.parent.postMessage({ source: SOURCE, kind: 'select', element: describe(el) }, '*');
      st.set(false);
    }, true);
    document.addEventListener('keydown', function (e) {
      if (st.on && e.key === 'Escape') { st.set(false); window.parent.postMessage({ source: SOURCE, kind: 'cancel' }, '*'); }
    }, true);
  }
  st.set(enable);
  return true;
})(__ENABLE__)`;

export function inspectorScript(enable: boolean): string {
  return INSPECTOR_SCRIPT.replace('__ENABLE__', enable ? 'true' : 'false');
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

type ConsoleLevel = PreviewConsoleEntry['level'];

interface FrameLike {
  url: string;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}

interface WebContentsLike {
  id: number;
  send(channel: string, payload: unknown): void;
  on(event: 'console-message', listener: (details: { message?: string; level?: unknown; lineNumber?: number; sourceId?: string; frame?: { url?: string } | null }) => void): unknown;
  once?(event: 'destroyed', listener: () => void): unknown;
  isDestroyed?(): boolean;
  mainFrame?: { framesInSubtree: FrameLike[] };
}

export interface PreviewBridgeOptions {
  /** Masque les secrets du projet dans un texte (valeurs `.env` + secrets rangés). */
  redact?: (root: string, text: string) => Promise<string>;
}

interface Watch {
  origin: string;
  root: string;
}

const LEVELS: Record<string, ConsoleLevel> = { '0': 'debug', '1': 'info', '2': 'warning', '3': 'error', debug: 'debug', info: 'info', warning: 'warning', error: 'error' };

export class PreviewBridge {
  private readonly watches = new Map<number, Watch>();
  private readonly attached = new WeakSet<object>();

  constructor(private readonly options: PreviewBridgeOptions = {}) {}

  /** Le renderer annonce l'aperçu affiché (URL loopback + dossier du projet). */
  watch(sender: WebContentsLike, input: unknown): { ok: boolean; error?: string } {
    const req = input as { url?: unknown; root?: unknown } | null;
    if (!req || typeof req.url !== 'string' || !isLoopbackHttpUrl(req.url)) {
      this.watches.delete(sender.id);
      return { ok: false, error: 'aperçu non loopback' };
    }
    const origin = originOf(req.url);
    if (!origin) return { ok: false, error: 'URL invalide' };
    this.watches.set(sender.id, { origin, root: typeof req.root === 'string' ? req.root : '' });
    if (!this.attached.has(sender)) {
      this.attached.add(sender);
      sender.on('console-message', (details) => this.onConsole(sender, details));
      sender.once?.('destroyed', () => this.watches.delete(sender.id));
    }
    return { ok: true };
  }

  private onConsole(
    sender: WebContentsLike,
    details: { message?: string; level?: unknown; lineNumber?: number; sourceId?: string; frame?: { url?: string } | null },
  ): void {
    const watch = this.watches.get(sender.id);
    if (!watch) return;
    const frameOrigin = details.frame?.url ? originOf(details.frame.url) : null;
    const sourceOrigin = details.sourceId ? originOf(details.sourceId) : null;
    if (frameOrigin !== watch.origin && sourceOrigin !== watch.origin) return;
    const level = LEVELS[String(details.level)] ?? 'info';
    const raw = String(details.message ?? '').slice(0, 4000);
    void (async () => {
      const message = this.options.redact && watch.root ? await this.options.redact(watch.root, raw).catch(() => '') : raw;
      const source = (details.sourceId ?? '').replace(watch.origin, '');
      if (sender.isDestroyed?.()) return;
      const entry: PreviewConsoleEntry = { level, message, source, line: details.lineNumber ?? 0, at: Date.now() };
      sender.send(PREVIEW_BRIDGE_CHANNELS.console, entry);
    })();
  }

  /** Active/désactive le mode sélection dans la frame de l'aperçu (et elle seule). */
  async inspect(sender: WebContentsLike, input: unknown): Promise<{ ok: boolean; error?: string }> {
    const req = input as { url?: unknown; enable?: unknown } | null;
    if (!req || typeof req.url !== 'string' || !isLoopbackHttpUrl(req.url)) return { ok: false, error: 'aperçu non loopback' };
    const origin = originOf(req.url);
    const frames = sender.mainFrame?.framesInSubtree ?? [];
    const frame = frames.find((f) => originOf(f.url) === origin && isLoopbackHttpUrl(f.url));
    if (!frame) return { ok: false, error: "frame de l'aperçu introuvable" };
    try {
      await frame.executeJavaScript(inspectorScript(req.enable === true));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export function registerPreviewBridgeIpc(
  ipcMain: { handle: (channel: string, listener: (event: { sender: WebContentsLike }, ...args: unknown[]) => unknown) => void },
  bridge: PreviewBridge,
): void {
  ipcMain.handle(PREVIEW_BRIDGE_CHANNELS.watch, (event, input) => bridge.watch(event.sender, input));
  ipcMain.handle(PREVIEW_BRIDGE_CHANNELS.inspect, (event, input) => bridge.inspect(event.sender, input));
}
