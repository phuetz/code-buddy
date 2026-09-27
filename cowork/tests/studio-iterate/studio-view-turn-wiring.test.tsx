/**
 * Câblage de bout en bout de StudioView (NewShell) pour les tours d'itération.
 *
 * Seuls le moteur d'agent (continueSession) et le serveur/sonde d'aperçu sont
 * simulés ; les fichiers sont un VRAI dossier temporaire et les versions/verrous
 * passent par le VRAI StudioVersionsService (vrai git). Un « tour d'agent »
 * simulé écrit réellement sur disque, puis le tour se termine : on vérifie ce
 * que l'utilisateur obtiendrait dans Cowork.
 *  - le message part enveloppé (édition ciblée + liste des verrous) ;
 *  - un fichier verrouillé modifié par l'agent est remis en l'état, le reste gardé ;
 *  - une version « Tour : … » est prise, visible et restaurable dans l'onglet Versions ;
 *  - l'aperçu est sondé après le tour (et pas seulement après la 1re génération) ;
 *  - en mode discussion, toute modification est annulée et aucune sonde ne part.
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { Suspense } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { StudioVersionsService } from '../../src/main/studio/studio-versions-service';

const ipc = {
  startSession: vi.fn(),
  continueSession: vi.fn(),
  stopSession: vi.fn(),
  getSessionMessages: vi.fn(async () => []),
  getSessionTraceSteps: vi.fn(async () => []),
};
vi.mock('../../src/renderer/hooks/useIPC', () => ({ useIPC: () => ipc }));
// L'éditeur CodeMirror n'est pas l'objet du test (et jsdom ne le mesure pas).
vi.mock('../../src/renderer/components/studio/CodeEditorPane', () => ({
  CodeEditorPane: ({ path: p }: { path: string }) => <div data-testid="editor">{p}</div>,
}));

// Le terminal xterm demande matchMedia/canvas, absents de jsdom.
vi.mock('../../src/renderer/components/studio/TerminalPane', () => ({
  TerminalPane: () => <div data-testid="terminal" />,
}));

import { useAppStore } from '../../src/renderer/store';
import { StudioView } from '../../src/renderer/components/NewShell';

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function listTree(root: string, rel = ''): unknown[] {
  return readdirSync(path.join(root, rel))
    .filter((name) => name !== '.codebuddy')
    .map((name) => {
      const p = rel ? `${rel}/${name}` : name;
      const isDir = statSync(path.join(root, p)).isDirectory();
      return isDir ? { name, path: p, type: 'directory', children: listTree(root, p) } : { name, path: p, type: 'file' };
    });
}

describe.skipIf(!hasGit())('StudioView — tours, verrous, versions, discussion (câblage réel)', () => {
  let root: string;
  let probe: ReturnType<typeof vi.fn>;
  const versions = new StudioVersionsService();

  beforeAll(() => {
    Element.prototype.scrollIntoView = () => {};
  });

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'studio-view-')));
    writeFileSync(path.join(root, 'index.html'), '<h1>Bonjour</h1><script src="app.js"></script>\n');
    writeFileSync(path.join(root, 'app.js'), 'console.log(1);\n');
    probe = vi.fn(async () => ({
      ok: true,
      data: { buildOutput: [], consoleErrors: [], pageErrors: [], overlay: false, placeholder: false, rootChildren: 2, textLength: 40 },
    }));
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      platform: 'linux',
      studio: {
        preview: { probe },
        devServer: {
          start: vi.fn(async (req: { url: string }) => ({ ok: true, data: { pid: 4242, url: req.url, command: 'x' } })),
          stop: vi.fn(async () => ({ ok: true, data: { pid: 4242, output: '' } })),
          status: vi.fn(async () => ({ ok: true, data: { instances: [] } })),
          logs: vi.fn(async () => ({ ok: true, data: { lines: [] } })),
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
        locks: {
          get: (r: string) => versions.getLocks(r),
          set: (r: string, p: string[]) => versions.setLocks(r, p),
        },
      },
    };
    const now = Date.now();
    useAppStore.setState({
      activeSessionId: 's1',
      sessions: [
        { id: 's1', title: 'demo', status: 'idle', cwd: root, mountedPaths: [], allowedTools: [], memoryEnabled: true, createdAt: now, updatedAt: now },
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
    // Tour d'agent simulé : actif, écritures réelles sur disque, puis fin du tour.
    ipc.continueSession.mockReset();
    let turnCount = 0;
    ipc.continueSession.mockImplementation(async () => {
      turnCount += 1;
      const setTurn = (on: boolean) =>
        useAppStore.setState((st: { sessionStates: Record<string, object> }) => ({
          sessionStates: { ...st.sessionStates, s1: { ...st.sessionStates.s1, activeTurn: on ? { stepId: 't', userMessageId: 'u' } : null } },
        }) as never);
      act(() => setTurn(true));
      await new Promise((r) => setTimeout(r, 30));
      writeFileSync(path.join(root, 'index.html'), '<h1>MODIFIÉ PAR L’AGENT</h1>\n');
      writeFileSync(path.join(root, 'app.js'), `console.log(${turnCount + 1});\n`);
      await new Promise((r) => setTimeout(r, 30));
      act(() => setTurn(false));
    });
  });

  afterEach(() => {
    cleanup();
    rmSync(root, { recursive: true, force: true });
  });

  it('verrou appliqué, version prise, aperçu re-sondé ; discussion annule tout', async () => {
    render(
      <Suspense fallback={<div>chargement</div>}>
        <StudioView />
      </Suspense>,
    );
    // 1. Verrouiller index.html depuis l'arbre (écrit .codebuddy/studio-locks.json).
    const lockBtn = await screen.findByTestId('studio-lock-toggle-index.html', {}, { timeout: 5000 });
    fireEvent.click(lockBtn);
    await waitFor(() => expect(existsSync(path.join(root, '.codebuddy', 'studio-locks.json'))).toBe(true));
    expect(JSON.parse(readFileSync(path.join(root, '.codebuddy', 'studio-locks.json'), 'utf8'))).toEqual({ locked: ['index.html'] });

    // 2. Envoyer une demande depuis le chat.
    fireEvent.change(screen.getByLabelText('Iteration message'), { target: { value: 'Change le titre' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(ipc.continueSession).toHaveBeenCalledTimes(1));
    const sent = String(ipc.continueSession.mock.calls[0]?.[1]);
    expect(sent).toContain('[App Studio — modification ciblée]');
    expect(sent).toContain('- index.html');
    expect(sent.endsWith('Change le titre')).toBe(true);

    // 3. Fin du tour : fichier verrouillé remis, le reste gardé, version prise, aperçu sondé.
    expect(await screen.findByText(/Fichier\(s\) verrouillé\(s\) remis en l'état : index.html/, {}, { timeout: 5000 })).toBeTruthy();
    expect(readFileSync(path.join(root, 'index.html'), 'utf8')).toBe('<h1>Bonjour</h1><script src="app.js"></script>\n');
    expect(readFileSync(path.join(root, 'app.js'), 'utf8')).toBe('console.log(2);\n');
    await waitFor(async () => {
      const list = await versions.list(root);
      expect(list.ok && list.data.map((v) => v.label)).toEqual(['Tour : Change le titre', 'Modifications manuelles']);
    }, { timeout: 5000 });
    await waitFor(() => expect(probe).toHaveBeenCalled(), { timeout: 5000 });

    // 4. Mode discussion : toute écriture de l'agent est annulée, pas de sonde, pas de version.
    const probesBefore = probe.mock.calls.length;
    fireEvent.click(screen.getByTestId('studio-mode-discuss'));
    fireEvent.change(screen.getByLabelText('Iteration message'), { target: { value: 'Et un mode sombre ?' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(ipc.continueSession).toHaveBeenCalledTimes(2));
    expect(String(ipc.continueSession.mock.calls[1]?.[1])).toContain('[App Studio — mode discussion]');
    expect(await screen.findByText(/Mode discussion : 2 modification\(s\) annulée\(s\)/, {}, { timeout: 5000 })).toBeTruthy();
    expect(readFileSync(path.join(root, 'app.js'), 'utf8')).toBe('console.log(2);\n');
    expect(readFileSync(path.join(root, 'index.html'), 'utf8')).toBe('<h1>Bonjour</h1><script src="app.js"></script>\n');
    expect(probe.mock.calls.length).toBe(probesBefore);

    // 4b. Retour en construction : un NOUVEAU tour re-sonde l'aperçu (pas seulement la 1re génération).
    fireEvent.click(screen.getByTestId('studio-mode-build'));
    fireEvent.change(screen.getByLabelText('Iteration message'), { target: { value: 'Ajoute un pied de page' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(ipc.continueSession).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(probe.mock.calls.length).toBe(probesBefore + 1), { timeout: 5000 });

    // 5. Onglet Versions : la version de départ se restaure depuis l'interface.
    fireEvent.click(screen.getByTestId('studio-tab-versions'));
    await screen.findByText('Tour : Ajoute un pied de page', {}, { timeout: 5000 });
    const restoreButtons = screen.getAllByText('Restore');
    fireEvent.click(restoreButtons[restoreButtons.length - 1]!); // la plus ancienne = « Modifications manuelles » (état de départ)
    await waitFor(() => expect(readFileSync(path.join(root, 'app.js'), 'utf8')).toBe('console.log(1);\n'), { timeout: 5000 });
    expect(await screen.findByTestId('studio-versions-note')).toBeTruthy();
  }, 30_000);

  it('aperçu toujours cassé : 3 corrections automatiques, puis « Corriger » à la demande, une seule tentative', async () => {
    probe.mockImplementation(async () => ({
      ok: true,
      data: {
        buildOutput: [],
        consoleErrors: ["Uncaught TypeError: Cannot read properties of undefined (reading 'map')"],
        pageErrors: [],
        overlay: false,
        placeholder: false,
        rootChildren: 0,
        textLength: 0,
      },
    }));
    render(
      <Suspense fallback={<div>chargement</div>}>
        <StudioView />
      </Suspense>,
    );
    fireEvent.change(await screen.findByLabelText('Iteration message', {}, { timeout: 5000 }), { target: { value: 'Ajoute une liste' } });
    fireEvent.click(screen.getByText('Send'));
    // 1 tour utilisateur + 3 corrections automatiques, puis la main revient.
    const fixBtn = await screen.findByTestId('build-fix', {}, { timeout: 15000 });
    expect(ipc.continueSession).toHaveBeenCalledTimes(4);
    expect(String(ipc.continueSession.mock.calls[1]?.[1])).toContain("reading 'map'");
    expect(screen.getByTestId('build-problem').textContent).toContain('Aperçu cassé');
    fireEvent.click(fixBtn);
    await waitFor(() => expect(ipc.continueSession).toHaveBeenCalledTimes(5));
    // Toujours cassé : le bouton revient, sans nouvelle tentative automatique.
    await screen.findByTestId('build-fix', {}, { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(ipc.continueSession).toHaveBeenCalledTimes(5);
  }, 30_000);
});

describe('AppStudioView — bouton « Site »', () => {
  it('appelle exportSite avec le dossier du projet, affiche le chemin et l’ouvre', async () => {
    const { AppStudioView } = await import('../../src/renderer/components/studio/AppStudioView');
    const exportSite = vi.fn(async () => ({ ok: true, data: { savedTo: '/tmp/exports/app-site', kind: 'build', files: 3 } }));
    const showItemInFolder = vi.fn(async () => true);
    (window as unknown as { electronAPI: unknown }).electronAPI = { studio: { exportSite }, showItemInFolder };
    render(
      <AppStudioView
        tree={[{ name: 'index.html', path: 'index.html', type: 'file' }]}
        activeFile={null}
        fileContent=""
        previewUrl={null}
        previewStatus="idle"
        terminalOutput={[]}
        buildPhase="idle"
        buildElapsedMs={0}
        templates={[]}
        workingDir="/tmp/projet"
        onScaffold={() => {}}
        onPrompt={() => {}}
        onOpenFile={() => {}}
        onChangeFileContent={() => {}}
        onSaveFile={() => {}}
        onStartPreview={() => {}}
        onReloadPreview={() => {}}
        onStopBuild={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('studio-export-site'));
    expect(await screen.findByText(/Site construit exporté \(3 fichiers\)/)).toBeTruthy();
    expect(exportSite).toHaveBeenCalledWith('/tmp/projet');
    fireEvent.click(screen.getByTestId('studio-site-open'));
    expect(showItemInFolder).toHaveBeenCalledWith('/tmp/exports/app-site');
  });
});
