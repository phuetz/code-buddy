/**
 * App Studio orchestration hook.
 *
 * The integrator should pass the real preload-backed implementation from
 * `window.electronAPI.studio.*`. This hook imports no preload/global/store API;
 * no-op defaults keep it testable and renderable in isolation.
 *
 * @module renderer/components/studio/use-app-studio
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppStudioViewProps } from './AppStudioView.js';
import type { BuildPhase } from './BuildStatusStrip.js';
import type { StudioScaffoldRequest } from './StudioComposer.js';
import { filterStudioTree, type TreeNode } from './utils/file-tree-model.js';
import type { AppStudioApis, CommandOutputEvent, StudioTemplateCard } from './studio-api.js';

export interface UseAppStudioOptions {
  apis?: Partial<AppStudioApis>;
  projectRoot?: string;
  devCommand?: string;
  devUrl?: string;
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
  }, [apis, appendTerminal, beginPhase, projectRoot, refreshTree]);

  const openFile = useCallback(async (path: string) => {
    if (!projectRoot) return;
    const result = await apis.files.read(projectRoot, path);
    if (result.ok) {
      setActiveFile(path);
      setFileContent(result.data.content);
    } else {
      appendTerminal(result.error);
    }
  }, [apis, appendTerminal, projectRoot]);

  const saveFile = useCallback(async () => {
    if (!projectRoot || !activeFile) return;
    const result = await apis.files.write(projectRoot, activeFile, fileContent);
    appendTerminal(result.ok ? `Sauvegardé: ${activeFile}` : result.error);
  }, [activeFile, apis, appendTerminal, fileContent, projectRoot]);

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
    const result = await apis.devServer.start({
      cwd,
      command: input?.command ?? options.devCommand ?? 'npm run dev',
      url: input?.url ?? options.devUrl ?? 'http://127.0.0.1:5173/',
    });
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
  }, [apis, appendTerminal, beginPhase, options.devCommand, options.devUrl, projectRoot]);

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
