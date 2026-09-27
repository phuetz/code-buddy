// @vitest-environment jsdom
/**
 * Pont de l'aperçu : le VRAI script de sélection est exécuté dans un document
 * (jsdom) muni d'une fibre React de développement ; le clic doit produire la
 * description de l'élément (source `_debugSource`, composant) postée au parent.
 * La console n'est relayée que pour la frame de l'aperçu, et masquée.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONSOLE_MAX_PER_WINDOW, CONSOLE_SUSPEND_MS, INSPECTOR_MESSAGE_SOURCE, inspectorScript, PreviewBridge, PREVIEW_BRIDGE_CHANNELS } from '../src/main/studio/preview-bridge';

function TodoForm() {
  return null;
}

describe('script de sélection injecté dans l’aperçu', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    delete (window as unknown as Record<string, unknown>).__codebuddyStudioInspector;
  });

  it('décrit l’élément cliqué (source React, composant) et se désactive', () => {
    document.body.innerHTML = '<div><button id="add" type="button" class="btn btn-primary">Ajouter</button></div>';
    const button = document.getElementById('add') as HTMLButtonElement;
    const hostFiber = {
      type: 'button',
      _debugSource: { fileName: '/projet/src/components/TodoForm.tsx', lineNumber: 8, columnNumber: 7 },
      return: { type: TodoForm, return: null },
    };
    (button as unknown as Record<string, unknown>)['__reactFiber$abc123'] = hostFiber;
    const posted: unknown[] = [];
    vi.spyOn(window.parent, 'postMessage').mockImplementation((msg: unknown) => {
      posted.push(msg);
    });
    const appClick = vi.fn();
    button.addEventListener('click', appClick);

    // eslint-disable-next-line no-eval
    expect(window.eval(inspectorScript(true))).toBe(true);
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(appClick).not.toHaveBeenCalled(); // le clic de sélection n'agit pas dans l'app
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      source: INSPECTOR_MESSAGE_SOURCE,
      kind: 'select',
      element: {
        tag: 'button',
        id: 'add',
        classes: ['btn', 'btn-primary'],
        text: 'Ajouter',
        component: 'TodoForm',
        source: { fileName: '/projet/src/components/TodoForm.tsx', lineNumber: 8, columnNumber: 7 },
      },
    });
    // Mode quitté : le clic suivant revient à l'app.
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(appClick).toHaveBeenCalledTimes(1);
    expect(posted).toHaveLength(1);
  });

  it('Échap annule la sélection', () => {
    const posted: unknown[] = [];
    vi.spyOn(window.parent, 'postMessage').mockImplementation((msg: unknown) => {
      posted.push(msg);
    });
    window.eval(inspectorScript(true));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(posted).toEqual([{ source: INSPECTOR_MESSAGE_SOURCE, kind: 'cancel' }]);
  });
});

describe('PreviewBridge', () => {
  function makeSender(frames: { url: string; executeJavaScript: ReturnType<typeof vi.fn> }[] = []) {
    let listener: ((d: unknown) => void) | null = null;
    return {
      id: 7,
      send: vi.fn(),
      on: vi.fn((_e: string, l: (d: unknown) => void) => {
        listener = l;
      }),
      off: vi.fn((_e: string, l: (d: unknown) => void) => {
        if (listener === l) listener = null;
      }),
      subscribed: () => listener !== null,
      once: vi.fn(),
      isDestroyed: () => false,
      mainFrame: { framesInSubtree: frames },
      emit: (d: unknown) => listener?.(d),
    };
  }

  it('relaie la console de la seule frame de l’aperçu, masquée', async () => {
    const bridge = new PreviewBridge({ redact: async (_root, text) => text.replace('sk-secret-1234', '[secret masqué]') });
    const sender = makeSender();
    expect(bridge.watch(sender, { url: 'http://127.0.0.1:5173/', root: '/projet' })).toEqual({ ok: true });
    expect(bridge.watch(sender, { url: 'https://exemple.test/', root: '/projet' }).ok).toBe(false);
    bridge.watch(sender, { url: 'http://127.0.0.1:5173/', root: '/projet' });
    sender.emit({ message: 'Uncaught TypeError: x is undefined sk-secret-1234', level: 'error', lineNumber: 12, sourceId: 'http://127.0.0.1:5173/src/App.tsx', frame: { url: 'http://127.0.0.1:5173/' } });
    sender.emit({ message: 'message de Cowork lui-même', level: 'info', lineNumber: 1, sourceId: 'file:///app/index.js', frame: { url: 'file:///app/index.html' } });
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(1));
    expect(sender.send).toHaveBeenCalledWith(PREVIEW_BRIDGE_CHANNELS.console, expect.objectContaining({
      level: 'error',
      message: 'Uncaught TypeError: x is undefined [secret masqué]',
      source: '/src/App.tsx',
      line: 12,
    }));
  });

  it('borne le débit du relais console (flux en boucle) et signale les messages ignorés', async () => {
    let clock = 1_000;
    const redact = vi.fn(async (_root: string, text: string) => text);
    const bridge = new PreviewBridge({ redact, now: () => clock });
    const sender = makeSender();
    bridge.watch(sender, { url: 'http://127.0.0.1:5173/', root: '/projet' });
    const msg = { message: 'tick', level: 'info', lineNumber: 1, sourceId: 'http://127.0.0.1:5173/src/main.ts', frame: { url: 'http://127.0.0.1:5173/' } };
    for (let i = 0; i < 300; i += 1) sender.emit(msg);
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(CONSOLE_MAX_PER_WINDOW));
    expect(redact).toHaveBeenCalledTimes(CONSOLE_MAX_PER_WINDOW); // pas de masquage (coûteux) pour les messages ignorés
    clock += 1_000;
    sender.emit(msg);
    await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(CONSOLE_MAX_PER_WINDOW + 2));
    expect(sender.send.mock.calls[CONSOLE_MAX_PER_WINDOW]?.[1]).toMatchObject({ level: 'warning', message: expect.stringContaining('250 message(s)') });
    expect(sender.subscribed()).toBe(true);
  });

  it('flux extrême : le relais se désabonne quelques secondes (le processus principal ne compte plus chaque message), puis revient', async () => {
    vi.useFakeTimers();
    try {
      const bridge = new PreviewBridge({ redact: async (_r, t) => t });
      const sender = makeSender();
      bridge.watch(sender, { url: 'http://127.0.0.1:5173/', root: '/projet' });
      const msg = { message: 'tick', level: 'info', lineNumber: 1, sourceId: 'http://127.0.0.1:5173/src/main.ts', frame: { url: 'http://127.0.0.1:5173/' } };
      for (let i = 0; i < 5000; i += 1) sender.emit(msg); // après la suspension, emit n'atteint plus le pont
      expect(sender.off).toHaveBeenCalledTimes(1);
      expect(sender.subscribed()).toBe(false);
      expect(sender.send.mock.calls.some(([, e]) => String((e as { message: string }).message).includes('suspendue'))).toBe(true);
      vi.advanceTimersByTime(CONSOLE_SUSPEND_MS);
      expect(sender.subscribed()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('échec fermé : masquage prévu mais projet inconnu → aucun message relayé', async () => {
    const bridge = new PreviewBridge({ redact: async (_r, t) => t });
    const sender = makeSender();
    bridge.watch(sender, { url: 'http://127.0.0.1:5173/', root: '' });
    sender.emit({ message: 'secret', level: 'error', lineNumber: 1, sourceId: 'http://127.0.0.1:5173/a.js', frame: { url: 'http://127.0.0.1:5173/' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("n'injecte le script que dans une frame loopback de même origine que l'aperçu", async () => {
    const other = { url: 'https://ailleurs.test/', executeJavaScript: vi.fn(async () => true) };
    const preview = { url: 'http://127.0.0.1:5173/', executeJavaScript: vi.fn(async () => true) };
    const bridge = new PreviewBridge();
    const sender = makeSender([other, preview]);
    expect(await bridge.inspect(sender, { url: 'http://127.0.0.1:5173/', enable: true })).toEqual({ ok: true });
    expect(other.executeJavaScript).not.toHaveBeenCalled();
    expect(preview.executeJavaScript.mock.calls[0]?.[0]).toContain('})(true)');
    expect((await bridge.inspect(sender, { url: 'https://ailleurs.test/', enable: true })).ok).toBe(false);
    expect((await bridge.inspect(makeSender([]), { url: 'http://127.0.0.1:5173/', enable: true })).ok).toBe(false);
  });
});
