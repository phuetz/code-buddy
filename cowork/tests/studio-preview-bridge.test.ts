// @vitest-environment jsdom
/**
 * Pont de l'aperçu : le VRAI script de sélection est exécuté dans un document
 * (jsdom) muni d'une fibre React de développement ; le clic doit produire la
 * description de l'élément (source `_debugSource`, composant) postée au parent.
 * La console n'est relayée que pour la frame de l'aperçu, et masquée.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { INSPECTOR_MESSAGE_SOURCE, inspectorScript, PreviewBridge, PREVIEW_BRIDGE_CHANNELS } from '../src/main/studio/preview-bridge';

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
