/**
 * Câblage de bout en bout de StudioView pour la vague 2 bolt.new : ce que
 * l'utilisateur joint à sa demande arrive réellement dans le message envoyé à
 * l'agent (continueSession), et un secret n'y arrive jamais.
 *
 * Réels : le dossier du projet, StudioContextService (candidats, lecture,
 * localisation de l'élément), ProjectSecretsService (stockage hors projet,
 * masquage), StudioVersionsService (vrai git). Simulés : l'agent, le serveur
 * d'aperçu, la frame de l'aperçu (message postMessage), le relais console.
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { Suspense } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectSecretsService } from '../../src/main/studio/project-secrets-service';
import { StudioContextService } from '../../src/main/studio/studio-context-service';
import { StudioVersionsService } from '../../src/main/studio/studio-versions-service';

const ipc = {
  startSession: vi.fn(),
  continueSession: vi.fn(),
  stopSession: vi.fn(),
  getSessionMessages: vi.fn(async () => []),
  getSessionTraceSteps: vi.fn(async () => []),
};
vi.mock('../../src/renderer/hooks/useIPC', () => ({ useIPC: () => ipc }));
vi.mock('../../src/renderer/components/studio/CodeEditorPane', () => ({
  CodeEditorPane: ({ path: p }: { path: string }) => <div data-testid="editor">{p}</div>,
}));
vi.mock('../../src/renderer/components/studio/TerminalPane', () => ({
  TerminalPane: () => <div data-testid="terminal" />,
}));

import { useAppStore } from '../../src/renderer/store';
import { StudioView } from '../../src/renderer/components/NewShell';

const SECRET = 'sk-projet-VALEUR-0123456789';
const BUTTON_TSX = `export function AddButton() {
  return (
    <button className="btn btn-primary">
      Ajouter
    </button>
  );
}
`;

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function listTree(root: string, rel = ''): unknown[] {
  if (!existsSync(path.join(root, rel))) return []; // dossier supprimé à la fin d'un test
  return readdirSync(path.join(root, rel))
    .filter((name) => name !== '.codebuddy')
    .map((name) => {
      const p = rel ? `${rel}/${name}` : name;
      const isDir = statSync(path.join(root, p)).isDirectory();
      return isDir ? { name, path: p, type: 'directory', children: listTree(root, p) } : { name, path: p, type: 'file' };
    });
}

function sentText(call: number): string {
  const arg = ipc.continueSession.mock.calls[call]?.[1] as unknown;
  if (typeof arg === 'string') return arg;
  return (arg as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

describe.skipIf(!hasGit())('StudioView — élément ciblé, journaux, image, contexte, secrets (câblage réel)', () => {
  let base: string;
  let root: string;
  let consoleListener: ((entry: unknown) => void) | null;
  let inspect: ReturnType<typeof vi.fn>;
  let capabilities: ReturnType<typeof vi.fn>;
  let redactSpy: ReturnType<typeof vi.fn>;
  let secrets: ProjectSecretsService;

  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  beforeEach(async () => {
    base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'studio-v2-')));
    root = path.join(base, 'app');
    mkdirSync(path.join(root, 'src'), { recursive: true });
    writeFileSync(path.join(root, 'index.html'), '<div id="root"></div><script type="module" src="/src/main.js"></script>\n');
    writeFileSync(path.join(root, 'src', 'main.js'), 'console.log(1);\n');
    writeFileSync(path.join(root, 'src', 'AddButton.tsx'), BUTTON_TSX);
    writeFileSync(path.join(root, '.env.local'), `VITE_OLD=${SECRET}-env\n`);
    const versions = new StudioVersionsService();
    const context = new StudioContextService({ trustedRoots: () => [base] });
    secrets = new ProjectSecretsService({ storeDir: path.join(base, 'cowork-data'), trustedRoots: () => [base] });
    await secrets.set(root, 'VITE_API_KEY', SECRET);
    consoleListener = null;
    inspect = vi.fn(async () => ({ ok: true }));
    capabilities = vi.fn(async () => ({ supportsVision: false }));
    redactSpy = vi.fn((r: string, t: string) => secrets.redact(r, t));
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      platform: 'linux',
      model: { capabilities },
      studio: {
        preview: {
          probe: vi.fn(async () => ({ ok: true, data: { buildOutput: [], consoleErrors: [], pageErrors: [], overlay: false, placeholder: false, rootChildren: 2, textLength: 40 } })),
          watch: vi.fn(async () => ({ ok: true })),
          inspect,
          locate: (r: string, el: unknown) => context.locate(r, el),
          onConsole: (l: (entry: unknown) => void) => {
            consoleListener = l;
            return () => {
              consoleListener = null;
            };
          },
        },
        context: {
          candidates: (r: string) => context.candidates(r),
          read: (r: string, p: string[]) => context.read(r, p),
        },
        secrets: {
          list: (r: string) => secrets.list(r),
          set: (r: string, k: string, v: string) => secrets.set(r, k, v),
          remove: (r: string, k: string) => secrets.remove(r, k),
          redact: redactSpy,
        },
        devServer: {
          start: vi.fn(async (req: { url: string }) => ({ ok: true, data: { pid: 4242, url: req.url, command: 'x' } })),
          stop: vi.fn(async () => ({ ok: true, data: { pid: 4242, output: '' } })),
          status: vi.fn(async () => ({ ok: true, data: { instances: [] } })),
          logs: vi.fn(async () => ({ ok: true, data: { lines: ['VITE v5.4 ready in 300 ms', '[vite] Internal server error: Failed to resolve import "./Nope"'] } })),
          onLog: () => () => {},
        },
        files: {
          list: async (r: string) => ({ ok: true, data: listTree(r) }),
          read: async (r: string, p: string) =>
            existsSync(path.join(r, p)) ? { ok: true, data: readFileSync(path.join(r, p), 'utf8') } : { ok: false, error: 'ENOENT' },
          write: async (r: string, p: string, c: string) => {
            writeFileSync(path.join(r, p), c);
            return { ok: true, data: { path: p } };
          },
          create: async () => ({ ok: true, data: { path: '' } }),
          rename: async () => ({ ok: true, data: { from: '', to: '' } }),
          delete: async () => ({ ok: true, data: { path: '' } }),
        },
        commands: {
          run: async () => ({ ok: true, data: { id: 'x', pid: 1 } }),
          runToEnd: async () => ({ ok: true, data: { id: 'x', code: 0 } }),
          kill: async () => ({ ok: true, data: undefined }),
          onOutput: () => () => {},
        },
        scaffold: { list: async () => ({ ok: true, data: [] }), generate: async () => ({ ok: false, error: 'n/a' }) },
        versions: {
          snapshot: (r: string, l: string) => versions.snapshot(r, l),
          list: (r: string) => versions.list(r),
          restore: (r: string, id: string) => versions.restore(r, id),
          revertPaths: (r: string, id: string, p: string[]) => versions.revertPaths(r, id, p),
          changedSince: (r: string, id: string) => versions.changedSince(r, id),
        },
        locks: { get: (r: string) => versions.getLocks(r), set: (r: string, p: string[]) => versions.setLocks(r, p) },
      },
    };
    const now = Date.now();
    useAppStore.setState({
      activeSessionId: 's1',
      appConfig: { model: 'modele-texte' },
      sessions: [
        { id: 's1', title: 'demo', status: 'idle', cwd: root, model: 'modele-texte', mountedPaths: [], allowedTools: [], memoryEnabled: true, createdAt: now, updatedAt: now },
      ],
      sessionStates: {
        s1: {
          messages: [],
          partialMessage: '',
          partialThinking: '',
          pendingTurns: [],
          queuedIntents: [],
          activeTurn: null,
          executionClock: { startAt: null, endAt: null },
          traceSteps: [],
          contextWindow: 0,
        },
      },
    } as never);
    ipc.continueSession.mockReset();
    ipc.continueSession.mockImplementation(async () => {
      const setTurn = (on: boolean) =>
        useAppStore.setState((st: { sessionStates: Record<string, object> }) => ({
          sessionStates: { ...st.sessionStates, s1: { ...st.sessionStates.s1, activeTurn: on ? { stepId: 't', userMessageId: 'u' } : null } },
        }) as never);
      act(() => setTurn(true));
      await new Promise((r) => setTimeout(r, 20));
      act(() => setTurn(false));
    });
  });

  afterEach(() => {
    cleanup();
    rmSync(base, { recursive: true, force: true });
  });

  async function openPreview(): Promise<string> {
    render(
      <Suspense fallback={<div>chargement</div>}>
        <StudioView />
      </Suspense>,
    );
    await screen.findByLabelText('Iteration message', {}, { timeout: 5000 });
    fireEvent.click(await screen.findByText('Preview', {}, { timeout: 5000 }));
    const frame = (await screen.findByTestId('studio-preview-frame', {}, { timeout: 5000 })) as HTMLIFrameElement;
    return new URL(frame.src).origin;
  }

  it("élément cliqué dans l'aperçu → fichier et lignes → la demande suivante cible cet élément", async () => {
    const origin = await openPreview();
    fireEvent.click(screen.getByTestId('preview-select'));
    await waitFor(() => expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ enable: true })));
    expect(screen.getByTestId('preview-select').getAttribute('aria-pressed')).toBe('true');

    // Un message d'une AUTRE origine est ignoré.
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { origin: 'https://ailleurs.test', data: { source: 'codebuddy-studio-inspector', kind: 'select', element: { tag: 'h1', text: 'pirate' } } }));
    });
    expect(screen.queryByTestId('studio-attachment-cible')).toBeNull();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin,
          data: { source: 'codebuddy-studio-inspector', kind: 'select', element: { tag: 'button', text: 'Ajouter', classes: ['btn', 'btn-primary'], component: 'AddButton', source: { fileName: path.join(root, 'src', 'AddButton.tsx'), lineNumber: 3 } } },
        }),
      );
    });
    const chip = await screen.findByTestId('studio-attachment-cible', {}, { timeout: 5000 });
    await waitFor(() => expect(chip.textContent).toContain('src/AddButton.tsx:3-5'));
    expect(screen.getByTestId('preview-select').getAttribute('aria-pressed')).toBe('false');

    fireEvent.change(screen.getByLabelText('Iteration message'), { target: { value: 'Rends ce bouton rouge' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(ipc.continueSession).toHaveBeenCalledTimes(1));
    const sent = sentText(0);
    expect(sent).toContain("Élément ciblé dans l'aperçu");
    expect(sent).toContain('- source : src/AddButton.tsx, lignes 3 à 5 (localisé par : source React exacte)');
    expect(sent).toContain('3|     <button className="btn btn-primary">');
    expect(sent).toContain('- composant : AddButton');
    expect(sent.endsWith('Rends ce bouton rouge')).toBe(true);
    // Usage unique : la pastille disparaît après l'envoi.
    expect(screen.queryByTestId('studio-attachment-cible')).toBeNull();
  }, 30_000);

  it('console du navigateur et serveur de dev visibles, joints ou envoyés en correction', async () => {
    await openPreview();
    await waitFor(() => expect(consoleListener).not.toBeNull());
    act(() => {
      consoleListener?.({ level: 'error', message: "Uncaught TypeError: Cannot read properties of undefined (reading 'map')", source: '/src/main.js', line: 4, at: 1 });
      consoleListener?.({ level: 'info', message: 'rendu ok', source: '/src/main.js', line: 1, at: 2 });
    });
    fireEvent.click(screen.getByTestId('studio-bottom-console'));
    expect(await screen.findByText(/reading 'map'/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('studio-console-attach'));
    expect((await screen.findByTestId('studio-attachment-journaux')).textContent).toContain('1 ligne(s) — console du navigateur');

    fireEvent.click(screen.getByTestId('studio-console-tab-serveur'));
    expect(await screen.findByText(/Failed to resolve import/, {}, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(screen.getByTestId('studio-console-fix'));
    await waitFor(() => expect(ipc.continueSession).toHaveBeenCalledTimes(1));
    const sent = sentText(0);
    expect(sent).toContain('Journaux joints — console du navigateur (aperçu) (1 ligne(s))');
    expect(sent).toContain("[error] Uncaught TypeError: Cannot read properties of undefined (reading 'map') (/src/main.js:4)");
    expect(sent).not.toContain('rendu ok');
    expect(sent).toContain('Journaux joints — serveur de dev');
    expect(sent).toContain('Failed to resolve import "./Nope"');
    expect(sent).toContain('Corrige les erreurs du serveur de dev');
  }, 30_000);

  it('image : refusée avec un message clair sans modèle multimodal, jointe sinon', async () => {
    render(
      <Suspense fallback={<div>chargement</div>}>
        <StudioView />
      </Suspense>,
    );
    await screen.findByLabelText('Iteration message', {}, { timeout: 5000 });
    const png = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], 'maquette.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('studio-attach-image-input'), { target: { files: [png] } });
    expect((await screen.findByTestId('studio-chat-notice')).textContent).toContain('ne lit pas les images');
    expect(capabilities).toHaveBeenCalledWith('modele-texte');
    expect(screen.queryByTestId('studio-attachment-image')).toBeNull();

    capabilities.mockResolvedValue({ supportsVision: true });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [png] } });
    act(() => {
      screen.getByTestId('studio-chat').dispatchEvent(drop);
    });
    expect((await screen.findByTestId('studio-attachment-image')).textContent).toContain('maquette.png');
    fireEvent.change(screen.getByLabelText('Iteration message'), { target: { value: 'Reproduis cette maquette' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(ipc.continueSession).toHaveBeenCalledTimes(1));
    const content = ipc.continueSession.mock.calls[0]?.[1] as { type: string; source?: { media_type: string; data: string } }[];
    expect(Array.isArray(content)).toBe(true);
    expect(content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64') } });
    expect(sentText(0)).toContain('Une image de référence (maquette ou capture) est jointe');
  }, 30_000);

  it('contexte : fichiers inclus/exclus avec estimation en jetons ; .env jamais proposé', async () => {
    render(
      <Suspense fallback={<div>chargement</div>}>
        <StudioView />
      </Suspense>,
    );
    await screen.findByLabelText('Iteration message', {}, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('studio-context-toggle'));
    await waitFor(() => expect(screen.getAllByTestId('studio-context-file').length).toBe(3));
    const files = screen.getAllByTestId('studio-context-file').map((b) => b.textContent ?? '');
    expect(files.some((f) => f.includes('.env'))).toBe(false);
    const before = Number((screen.getByTestId('studio-token-estimate').textContent ?? '').replace(/\D/g, ''));
    const buttonFile = screen.getAllByTestId('studio-context-file').find((b) => b.textContent?.includes('AddButton.tsx'))!;
    fireEvent.click(buttonFile); // inclus
    const mainFile = screen.getAllByTestId('studio-context-file').find((b) => b.textContent?.includes('main.js'))!;
    fireEvent.click(mainFile);
    fireEvent.click(mainFile); // exclu
    await waitFor(() => {
      const after = Number((screen.getByTestId('studio-token-estimate').textContent ?? '').replace(/\D/g, ''));
      expect(after).toBeGreaterThanOrEqual(before + Math.ceil(Buffer.byteLength(BUTTON_TSX) / 4));
    });
    fireEvent.change(screen.getByLabelText('Iteration message'), { target: { value: 'Ajoute une icône' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(ipc.continueSession).toHaveBeenCalledTimes(1));
    const sent = sentText(0);
    expect(sent).toContain(`<fichier chemin="src/AddButton.tsx">\n${BUTTON_TSX}\n</fichier>`);
    expect(sent).toContain('Hors contexte — ne lis pas et ne modifie pas : src/main.js');
    expect(sent).toContain("Variables d'environnement du projet");
    expect(sent).toContain('VITE_API_KEY');
  }, 30_000);

  it("réserve des relectures : « Ouvrir dans le navigateur » et le Stop du chat, de bout en bout", async () => {
    const openExternal = vi.fn(async () => true);
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI.openExternal = openExternal;
    const origin = await openPreview();
    fireEvent.click(screen.getByLabelText('Open in browser'));
    expect(openExternal).toHaveBeenCalledWith(`${origin}/`);
    // Un tour qui ne finit pas : le Stop du chat appelle stopSession de la session active.
    ipc.continueSession.mockImplementationOnce(async () => {
      act(() =>
        useAppStore.setState((st: { sessionStates: Record<string, object> }) => ({
          sessionStates: { ...st.sessionStates, s1: { ...st.sessionStates.s1, activeTurn: { stepId: 't', userMessageId: 'u' } } },
        }) as never),
      );
    });
    fireEvent.change(screen.getByLabelText('Iteration message'), { target: { value: 'Long travail' } });
    fireEvent.click(screen.getByText('Send'));
    fireEvent.click(await screen.findByText('Stop', { selector: 'form button' }, { timeout: 5000 }));
    expect(ipc.stopSession).toHaveBeenCalledWith('s1');
  }, 30_000);

  it('secrets : jamais dans le prompt (masqués au point de passage unique) ; masquage impossible = rien ne part', async () => {
    render(
      <Suspense fallback={<div>chargement</div>}>
        <StudioView />
      </Suspense>,
    );
    await screen.findByLabelText('Iteration message', {}, { timeout: 5000 });
    fireEvent.change(screen.getByLabelText('Iteration message'), { target: { value: `Utilise la clé ${SECRET} et ${SECRET}-env` } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(ipc.continueSession).toHaveBeenCalledTimes(1));
    const sent = sentText(0);
    expect(sent).not.toContain(SECRET);
    expect(sent).toContain('Utilise la clé [secret masqué] et [secret masqué]');
    expect(redactSpy).toHaveBeenCalled();

    redactSpy.mockResolvedValue({ ok: false, error: 'boom' });
    fireEvent.change(screen.getByLabelText('Iteration message'), { target: { value: 'Autre demande' } });
    await waitFor(() => expect((screen.getByLabelText('Iteration message') as HTMLTextAreaElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Send'));
    expect((await screen.findByTestId('studio-chat-notice')).textContent).toContain('Envoi annulé');
    expect(ipc.continueSession).toHaveBeenCalledTimes(1);

    // Onglet Secrets : noms seulement, jamais la valeur dans le DOM.
    fireEvent.click(screen.getByTestId('studio-tab-secrets'));
    expect(await screen.findByText('VITE_API_KEY')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain(SECRET);
  }, 30_000);
});
