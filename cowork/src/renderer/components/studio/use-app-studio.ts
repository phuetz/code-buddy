/**
 * App Studio orchestration hook.
 *
 * The integrator should pass the real preload-backed implementation from
 * `window.electronAPI.studio.*`. This hook imports no preload/global/store API;
 * no-op defaults keep it testable and renderable in isolation.
 *
 * @module renderer/components/studio/use-app-studio
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppStudioViewProps } from './AppStudioView.js';
import type { BuildPhase } from './BuildStatusStrip.js';
import type { StudioScaffoldRequest } from './StudioComposer.js';
import { filterStudioTree, pickDefaultFile, type TreeNode } from './utils/file-tree-model.js';
import { detectDevCommand } from '../studio-iterate/studio-preview-model.js';
import { isStaticProject, staticServePlan } from './static-project-model.js';
import { openTab, closeTab as closeTabModel, nextActiveAfterClose, type EditorTab } from './editor-tabs-model.js';
import type { AppStudioApis, CommandOutputEvent, StudioTemplateCard } from './studio-api.js';

export interface UseAppStudioOptions {
  apis?: Partial<AppStudioApis>;
  projectRoot?: string;
  devCommand?: string;
  devUrl?: string;
  /** Host platform (process.platform) — picks the static-serve python binary. */
  platform?: string;
  commandIdFactory?: () => string;
}

export interface AppStudioState {
  projectRoot: string;
  tree: TreeNode[];
  activeFile: string | null;
  fileContent: string;
  previewUrl: string | null;
  previewStatus: AppStudioViewProps['previewStatus'];
  terminalOutput: string[];
  buildPhase: BuildPhase;
  buildElapsedMs: number;
  buildError: string | null;
  templates: StudioTemplateCard[];
  busy: boolean;
  devPid: number | null;
}

const DEFAULT_TEMPLATES: StudioTemplateCard[] = [
  { id: 'react-ts', label: 'React + TypeScript', description: 'Application web Vite avec React et TypeScript.' },
  { id: 'express-api', label: 'Express API', description: 'API Node/Express avec structure TypeScript.' },
  { id: 'node-cli', label: 'Node CLI', description: 'CLI Node.js TypeScript prête à compiler.' },
];

const noopResult = async (error = 'App Studio API not connected'): Promise<{ ok: false; error: string }> => ({ ok: false, error });

const NOOP_APIS: AppStudioApis = {
  devServer: {
    start: () => noopResult(),
    stop: () => noopResult(),
    status: () => noopResult(),
    logs: () => noopResult(),
  },
  files: {
    list: () => noopResult(),
    read: () => noopResult(),
    write: () => noopResult(),
    create: () => noopResult(),
    rename: () => noopResult(),
    delete: () => noopResult(),
  },
  commands: {
    run: () => noopResult(),
    kill: () => noopResult(),
  },
  scaffold: {
    list: async () => DEFAULT_TEMPLATES,
    generate: () => noopResult(),
  },
};

function mergeApis(apis?: Partial<AppStudioApis>): AppStudioApis {
  return {
    devServer: { ...NOOP_APIS.devServer, ...apis?.devServer },
    files: { ...NOOP_APIS.files, ...apis?.files },
    commands: { ...NOOP_APIS.commands, ...apis?.commands },
    scaffold: { ...NOOP_APIS.scaffold, ...apis?.scaffold },
  };
}

function defaultCommandId(): string {
  return `studio-${Date.now().toString(36)}`;
}

function terminalLine(event: CommandOutputEvent): string {
  if (event.stream === 'system') return event.line;
  return `[${event.stream}] ${event.line}`;
}

export function useAppStudio(options: UseAppStudioOptions = {}) {
  const apis = useMemo(() => mergeApis(options.apis), [options.apis]);
  const [projectRoot, setProjectRoot] = useState(options.projectRoot ?? '');
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([]);
  const [fileContent, setFileContent] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<AppStudioViewProps['previewStatus']>('idle');
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [buildPhase, setBuildPhase] = useState<BuildPhase>('idle');
  const [buildStartedAt, setBuildStartedAt] = useState<number | null>(null);
  const [buildElapsedMs, setBuildElapsedMs] = useState(0);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<StudioTemplateCard[]>(DEFAULT_TEMPLATES);
  const [busy, setBusy] = useState(false);
  const [devPid, setDevPid] = useState<number | null>(null);
  const [, setLastPrompt] = useState('');

  const appendTerminal = useCallback((line: string) => {
    setTerminalOutput((current) => [...current.slice(-499), line]);
  }, []);

  const beginPhase = useCallback((phase: BuildPhase) => {
    setBuildPhase(phase);
    setBuildError(null);
    setBuildStartedAt(Date.now());
    setBuildElapsedMs(0);
  }, []);

  useEffect(() => {
    setProjectRoot(options.projectRoot ?? '');
  }, [options.projectRoot]);

  useEffect(() => {
    let cancelled = false;
    void apis.scaffold.list().then((nextTemplates) => {
      if (!cancelled && nextTemplates.length > 0) setTemplates(nextTemplates);
    });
    return () => {
      cancelled = true;
    };
  }, [apis]);

  useEffect(() => {
    const unsubscribe = apis.commands.onOutput?.((event) => appendTerminal(terminalLine(event)));
    return unsubscribe;
  }, [apis, appendTerminal]);

  useEffect(() => {
    if (buildStartedAt === null) return undefined;
    const update = () => setBuildElapsedMs(Date.now() - buildStartedAt);
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [buildStartedAt]);

  const refreshTree = useCallback(async (root = projectRoot) => {
    if (!root) return;
    const result = await apis.files.list(root);
    if (result.ok) {
      setTree(filterStudioTree(result.data));
    } else {
      setBuildError(result.error);
      appendTerminal(result.error);
    }
  }, [apis, appendTerminal, projectRoot]);

  // Load the file tree whenever the project root changes (AI-generated project,
  // opened folder) so the bolt.new-style workbench reflects the current project.
  useEffect(() => {
    if (projectRoot) void refreshTree(projectRoot);
  }, [projectRoot, refreshTree]);

  const scaffold = useCallback(async (request: StudioScaffoldRequest) => {
    if (!request.targetDir) {
      const error = 'Aucun répertoire cible pour le scaffold.';
      setBuildError(error);
      appendTerminal(error);
      return;
    }
    setBusy(true);
    beginPhase('scaffolding');
    const result = await apis.scaffold.generate({
      template: request.template,
      targetDir: request.targetDir,
      vars: request.vars,
      ...(request.designSystem ? { designSystem: request.designSystem } : {}),
    });
    if (result.ok) {
      const nextProjectRoot = result.data.projectDir;
      if (request.assetIds?.length) {
        const materialized = await window.electronAPI?.creativeAssets?.materialize({
          ids: request.assetIds,
          targetRoot: nextProjectRoot,
          stack: request.stack,
        });
        if (!materialized?.ok) appendTerminal(`Assets créatifs: ${materialized?.error ?? 'matérialisation indisponible'}`);
      }
      setProjectRoot(nextProjectRoot);
      setActiveFile(null);
      setFileContent('');
      setPreviewUrl(null);
      setPreviewStatus('idle');
      appendTerminal(`Projet créé: ${nextProjectRoot}`);
      beginPhase('installing');
      await refreshTree(nextProjectRoot);
      setBuildPhase('idle');
      setBuildStartedAt(null);
    } else {
      setBuildError(result.error);
      appendTerminal(result.error);
      setBuildPhase('error');
    }
    setBusy(false);
  }, [apis, appendTerminal, beginPhase, refreshTree]);

  const openFile = useCallback(async (path: string) => {
    if (!projectRoot) return;
    const result = await apis.files.read(projectRoot, path);
    if (result.ok) {
      setActiveFile(path);
      setOpenTabs((tabs) => openTab(tabs, path));
      setFileContent(result.data.content);
    } else {
      appendTerminal(result.error);
    }
  }, [apis, appendTerminal, projectRoot]);

  // Close an editor tab; if it was active, focus a neighbour (bolt.new tabs).
  const closeFileTab = useCallback((path: string) => {
    setOpenTabs((tabs) => {
      const nextActive = nextActiveAfterClose(tabs, path, activeFile);
      if (nextActive !== activeFile) {
        if (nextActive) void openFile(nextActive);
        else {
          setActiveFile(null);
          setFileContent('');
        }
      }
      return closeTabModel(tabs, path);
    });
  }, [activeFile, openFile]);

  const saveFile = useCallback(async () => {
    if (!projectRoot || !activeFile) return;
    const result = await apis.files.write(projectRoot, activeFile, fileContent);
    appendTerminal(result.ok ? `Sauvegardé: ${activeFile}` : result.error);
  }, [activeFile, apis, appendTerminal, fileContent, projectRoot]);

  // bolt.new opens a file immediately — auto-select a sensible default once the
  // tree loads and nothing is open yet.
  useEffect(() => {
    if (!activeFile && tree.length > 0) {
      const def = pickDefaultFile(tree);
      if (def) void openFile(def);
    }
  }, [tree, activeFile, openFile]);

  const startDev = useCallback(async (input?: { cwd?: string; command?: string; url?: string }) => {
    const cwd = input?.cwd ?? projectRoot;
    if (!cwd) {
      const error = 'Aucun répertoire projet pour lancer le serveur.';
      setBuildError(error);
      appendTerminal(error);
      return;
    }
    beginPhase('starting');
    setPreviewStatus('starting');
    // Detect the dev command/URL from the project's package.json (Vite/Next/
    // Astro/CRA) so "Lancer" works beyond Vite; explicit input/options win.
    let command = input?.command ?? options.devCommand;
    let url = input?.url ?? options.devUrl;
    // Static project (index.html, no package.json — the AI generation's usual
    // output): serve it with a loopback http.server instead of npm run dev.
    if (!command && isStaticProject(tree)) {
      const plan = staticServePlan(cwd, options.platform ?? 'linux');
      command = plan.command;
      url = url ?? plan.url;
    }
    if (!command || !url) {
      try {
        const pkg = await apis.files.read(cwd, 'package.json');
        if (pkg.ok) {
          const detected = detectDevCommand(JSON.parse(pkg.data.content) as { scripts?: Record<string, string> });
          command = command ?? detected.command;
          url = url ?? detected.url;
        }
      } catch {
        /* fall back to Vite defaults below */
      }
    }
    const startInput = {
      cwd,
      command: command ?? 'npm run dev',
      url: url ?? 'http://127.0.0.1:5173/',
    };
    let result = await apis.devServer.start(startInput);
    // Port occupé par NOTRE propre serveur d'une session précédente (le main
    // garde le process quand le renderer se recharge et perd le pid) : le
    // retrouver via status(), l'arrêter, retenter UNE fois. Un service
    // inconnu sur le port reste une erreur (app_server n'adopte jamais).
    if (!result.ok && /already in use/i.test(result.error)) {
      const status = await apis.devServer.status();
      // Plusieurs instances peuvent exister pour ce projet (les mortes des
      // lancements précédents restent listées) — ne stopper que la VIVANTE
      // la plus récente, sinon on stoppe un cadavre et le port reste pris.
      const ours = status.ok
        ? status.data.instances
            .filter((inst) => (inst.cwd === cwd || inst.url === startInput.url) && inst.state === 'running')
            .pop()
        : undefined;
      if (ours) {
        appendTerminal(`Ancien serveur ${ours.pid} arrêté (reprise après rechargement).`);
        await apis.devServer.stop(ours.pid);
        // Le socket met un instant à se libérer après SIGTERM — retente avec
        // un court backoff plutôt qu'échouer sur le premier essai.
        for (let attempt = 0; attempt < 4; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 700));
          result = await apis.devServer.start(startInput);
          if (result.ok || !/already in use/i.test(result.error)) break;
        }
      }
    }
    if (result.ok) {
      setDevPid(result.data.pid);
      setPreviewUrl(result.data.url);
      setPreviewStatus('running');
      setBuildPhase('running');
      appendTerminal(`Serveur prêt: ${result.data.url}`);
    } else {
      setPreviewStatus('dead');
      setBuildError(result.error);
      setBuildPhase('error');
      appendTerminal(result.error);
    }
  }, [apis, appendTerminal, beginPhase, options.devCommand, options.devUrl, options.platform, projectRoot, tree]);

  // bolt.new restores the preview when you reopen a project. For STATIC
  // projects the serve is a loopback python http.server — cheap and safe to
  // auto-start once the tree confirms the shape. npm projects keep the manual
  // « Démarrer la preview » button (a dev server is heavier than a file
  // server, don't spawn it unasked).
  const autoServedRootRef = useRef<string | null>(null);
  useEffect(() => {
    if (!projectRoot || previewUrl || previewStatus !== 'idle') return;
    if (autoServedRootRef.current === projectRoot) return;
    if (tree.length === 0 || !isStaticProject(tree)) return;
    autoServedRootRef.current = projectRoot;
    void startDev();
  }, [projectRoot, previewUrl, previewStatus, tree, startDev]);

  const stopDev = useCallback(async () => {
    if (devPid === null) return;
    const result = await apis.devServer.stop(devPid);
    appendTerminal(result.ok ? `Serveur arrêté: ${devPid}` : result.error);
    if (!result.ok) setBuildError(result.error);
    setPreviewStatus('dead');
    setBuildPhase('idle');
    setDevPid(null);
  }, [apis, appendTerminal, devPid]);

  const runCommand = useCallback(async (command: string) => {
    if (!projectRoot || !command.trim()) return;
    const id = (options.commandIdFactory ?? defaultCommandId)();
    appendTerminal(`$ ${command}`);
    const result = await apis.commands.run({ cwd: projectRoot, command, id });
    if (!result.ok) { setBuildError(result.error); appendTerminal(result.error); }
  }, [apis, appendTerminal, options.commandIdFactory, projectRoot]);

  const reloadPreview = useCallback(() => {
    if (previewStatus === 'dead') void startDev();
  }, [previewStatus, startDev]);

  const clearTerminal = useCallback(() => setTerminalOutput([]), []);

  const state: AppStudioState = {
    projectRoot,
    tree,
    activeFile,
    fileContent,
    previewUrl,
    previewStatus,
    terminalOutput,
    buildPhase,
    buildElapsedMs,
    buildError,
    templates,
    busy,
    devPid,
  };

  const viewProps: AppStudioViewProps = {
    tree,
    activeFile,
    openTabs,
    onCloseTab: closeFileTab,
    fileContent,
    previewUrl,
    previewStatus,
    terminalOutput,
    buildPhase,
    buildElapsedMs,
    buildError,
    templates,
    busy,
    workingDir: options.projectRoot ?? '',
    onScaffold: scaffold,
    onPrompt: setLastPrompt,
    onOpenFile: openFile,
    onChangeFileContent: setFileContent,
    onSaveFile: saveFile,
    onStartPreview: startDev,
    onReloadPreview: reloadPreview,
    onTerminalInput: runCommand,
    onClearTerminal: clearTerminal,
    onStopBuild: stopDev,
  };

  return {
    state,
    viewProps,
    actions: {
      scaffold,
      openFile,
      saveFile,
      startDev,
      stopDev,
      runCommand,
      refreshTree,
      clearTerminal,
      setPrompt: setLastPrompt,
      setFileContent,
    },
  };
}
