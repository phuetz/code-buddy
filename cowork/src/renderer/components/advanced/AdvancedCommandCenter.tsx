/**
 * AdvancedCommandCenter — safe GUI launcher and run administration surface.
 *
 * The renderer only sends a typed launcher intent. The main process owns the
 * allowlisted argv construction and starts the child with `shell: false`; this
 * screen deliberately never exposes a generic terminal.
 */
import {
  Activity,
  Bot,
  Brain,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Copy,
  Database,
  ExternalLink,
  FlaskConical,
  FolderOpen,
  Gauge,
  History,
  LibraryBig,
  Loader2,
  MessageCircle,
  Network,
  Play,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Square,
  TestTube2,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LiveLauncherEventPayload,
  LiveLauncherRunStatusValue,
  LiveLauncherRunView,
  LiveLauncherStartInput,
} from '../../../shared/live-launcher-types';
import { useAppStore } from '../../store';
import { MessageMarkdown } from '../MessageMarkdown';

type CommandCenterTab = 'features' | 'runs';
type LauncherMode = 'research-direct' | 'research-wide' | 'research-deep' | 'flow';
type FeaturePanel =
  | 'settings'
  | 'backups'
  | 'memory'
  | 'skills'
  | 'companion'
  | 'channels'
  | 'autonomy'
  | 'tests'
  | 'insights'
  | 'knowledge'
  | 'evolution'
  | 'science'
  | 'fleet'
  | 'missions'
  | 'workflows'
  | 'devices'
  | 'migration';

interface LauncherPreset {
  id: LauncherMode;
  label: string;
  description: string;
  command: string;
}

interface FeatureDefinition {
  id: string;
  label: string;
  description: string;
  command: string;
  group: 'Pilotage' | 'Données et qualité' | 'Orchestration';
  icon: LucideIcon;
  panel?: FeaturePanel;
  launcherMode?: LauncherMode;
  badge?: string;
}

const DEFAULT_MODEL = 'qwen2.5:7b-instruct';
const MAX_RENDERED_LOG_LINES = 2_000;
const MAX_RENDERED_LOG_CHARS = 1_000_000;

const LAUNCHER_PRESETS: readonly LauncherPreset[] = [
  {
    id: 'research-direct',
    label: 'Recherche directe',
    description: 'Une réponse documentée rapide, exécutée par le moteur Research.',
    command: 'buddy research "<sujet>"',
  },
  {
    id: 'research-wide',
    label: 'Recherche large',
    description: 'Plusieurs travailleurs explorent le sujet en parallèle, avec une limite de 15 min.',
    command: 'buddy research "<sujet>" --wide --workers 5',
  },
  {
    id: 'research-deep',
    label: 'Deep Research',
    description: 'Pipeline cité avec perspectives et une limite adaptée de 30 min.',
    command: 'buddy research "<sujet>" --deep --iterations 2 --perspectives 4',
  },
  {
    id: 'flow',
    label: 'Flow de planification',
    description: 'Décompose l’objectif, traite chaque étape avec le modèle puis synthétise.',
    command: 'buddy flow "<objectif>"',
  },
] as const;

const FEATURES: readonly FeatureDefinition[] = [
  {
    id: 'research',
    label: 'Recherche & Flow',
    description: 'Lancer une recherche ou une mission planifiée sans recopier une commande.',
    command: 'buddy research · buddy flow',
    group: 'Pilotage',
    icon: Search,
    launcherMode: 'research-direct',
    badge: 'Exécutable',
  },
  {
    id: 'settings',
    label: 'Réglages',
    description: 'Modèles, providers, clés, MCP et workspace.',
    command: 'buddy onboard · /config',
    group: 'Pilotage',
    icon: Settings,
    panel: 'settings',
  },
  {
    id: 'companion',
    label: 'Companion',
    description: 'Voix, présence, continuité et comportement de Lisa.',
    command: 'Interface Cowork',
    group: 'Pilotage',
    icon: MessageCircle,
    panel: 'companion',
  },
  {
    id: 'channels',
    label: 'Canaux',
    description: 'Telegram et autres canaux reliés à la même conversation.',
    command: 'Interface Cowork',
    group: 'Pilotage',
    icon: Network,
    panel: 'channels',
  },
  {
    id: 'autonomy',
    label: 'Autonomie',
    description: 'Boucles autonomes, garde-fous et politique YOLO.',
    command: '/yolo status',
    group: 'Pilotage',
    icon: Gauge,
    panel: 'autonomy',
  },
  {
    id: 'memory',
    label: 'Mémoire',
    description: 'Inspecter et administrer ce que Code Buddy retient.',
    command: '/memory show · /memory recent',
    group: 'Données et qualité',
    icon: Brain,
    panel: 'memory',
  },
  {
    id: 'backups',
    label: 'Sauvegardes',
    description: 'Créer, vérifier et restaurer les données .codebuddy.',
    command: 'buddy backup create · verify · list',
    group: 'Données et qualité',
    icon: ShieldCheck,
    panel: 'backups',
  },
  {
    id: 'skills',
    label: 'Skills',
    description: 'Capacités spécialisées, outils et extensions installées.',
    command: '/tools',
    group: 'Données et qualité',
    icon: LibraryBig,
    panel: 'skills',
  },
  {
    id: 'tests',
    label: 'Tests',
    description: 'Lancer et consulter les suites de validation du workspace.',
    command: 'npm test',
    group: 'Données et qualité',
    icon: TestTube2,
    panel: 'tests',
  },
  {
    id: 'insights',
    label: 'Insights',
    description: 'Analyser les décisions, coûts et résultats de la session.',
    command: 'Interface Cowork',
    group: 'Données et qualité',
    icon: Activity,
    panel: 'insights',
  },
  {
    id: 'knowledge',
    label: 'Connaissances',
    description: 'Mémoire collective et sujets de recherche structurés.',
    command: 'Interface Cowork',
    group: 'Données et qualité',
    icon: Database,
    panel: 'knowledge',
  },
  {
    id: 'fleet',
    label: 'Fleet',
    description: 'Pairs IA, capacités, routage et sessions distribuées.',
    command: '/fleet status --with-sessions',
    group: 'Orchestration',
    icon: Network,
    panel: 'fleet',
  },
  {
    id: 'missions',
    label: 'Missions',
    description: 'Suivre les tâches et leurs résultats multi-agents.',
    command: '/team status',
    group: 'Orchestration',
    icon: Bot,
    panel: 'missions',
  },
  {
    id: 'workflows',
    label: 'Workflows',
    description: 'Composer et superviser des workflows visuels.',
    command: 'Interface Cowork',
    group: 'Orchestration',
    icon: Workflow,
    panel: 'workflows',
  },
  {
    id: 'science',
    label: 'AI-Scientist',
    description: 'Consulter les expériences et administrer les pistes découvertes dans les vidéos.',
    command: 'buddy science',
    group: 'Orchestration',
    icon: FlaskConical,
    panel: 'science',
    badge: 'Supervisé',
  },
  {
    id: 'evolution',
    label: 'Évolution',
    description: 'Versions produites par les cycles d’auto-amélioration.',
    command: 'Interface Cowork',
    group: 'Orchestration',
    icon: RefreshCcw,
    panel: 'evolution',
  },
  {
    id: 'devices',
    label: 'Appareils',
    description: 'Voir les nœuds locaux, SSH et ADB déjà configurés.',
    command: 'Interface Cowork',
    group: 'Orchestration',
    icon: ShieldCheck,
    panel: 'devices',
  },
  {
    id: 'migration',
    label: 'Migration Claw',
    description: 'Inspecter et importer une configuration OpenClaw.',
    command: 'Interface Cowork',
    group: 'Orchestration',
    icon: ExternalLink,
    panel: 'migration',
  },
] as const;

const STATUS_LABELS: Record<LiveLauncherRunStatusValue, string> = {
  running: 'En cours',
  succeeded: 'Réussie',
  failed: 'Échouée',
  cancelled: 'Annulée',
};

function runMode(run: LiveLauncherRunView): LauncherMode {
  if (run.kind === 'flow') return 'flow';
  if (run.researchMode === 'deep') return 'research-deep';
  if (run.researchMode === 'wide') return 'research-wide';
  return 'research-direct';
}

function statusClasses(status: LiveLauncherRunStatusValue): string {
  if (status === 'running') return 'border-accent/40 bg-accent/10 text-accent';
  if (status === 'succeeded') return 'border-success/40 bg-success/10 text-success';
  if (status === 'failed') return 'border-error/40 bg-error/10 text-error';
  return 'border-border bg-surface text-text-muted';
}

function formatDuration(run: LiveLauncherRunView, now: number): string {
  const elapsedMs = Math.max(0, (run.endedAt ?? now) - run.startedAt);
  const seconds = Math.floor(elapsedMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder.toString().padStart(2, '0')}s`;
}

function commandPreview(
  mode: LauncherMode,
  prompt: string,
  workers: number,
  iterations: number,
  perspectives: number
): string {
  const value = prompt.trim() || (mode === 'flow' ? '<objectif>' : '<sujet>');
  const quoted = `"${value.replaceAll('"', '\\"')}"`;
  if (mode === 'flow') return `buddy flow ${quoted}`;
  if (mode === 'research-wide') return `buddy research ${quoted} --wide --workers ${workers}`;
  if (mode === 'research-deep') {
    return `buddy research ${quoted} --deep --iterations ${iterations} --perspectives ${perspectives}`;
  }
  return `buddy research ${quoted}`;
}

function openPanel(panel: FeaturePanel): void {
  const store = useAppStore.getState();
  switch (panel) {
    case 'settings':
      store.setShowSettings(true);
      return;
    case 'backups':
      store.setSettingsTab('general');
      store.setShowSettings(true);
      return;
    case 'memory':
      store.setShowMemoryEditor(true);
      return;
    case 'skills':
      store.setShowSkillsManager(true);
      return;
    case 'companion':
      store.setShowCompanionPanel(true);
      return;
    case 'channels':
      store.setShowChannelsPanel(true);
      return;
    case 'autonomy':
      store.setShowAutonomyPanel(true);
      return;
    case 'tests':
      store.setShowTestRunner(true);
      return;
    case 'insights':
      store.setShowSessionInsights(true);
      return;
    case 'knowledge':
      store.setShowKnowledgePanel(true);
      return;
    case 'evolution':
      store.setShowEvolutionPanel(true);
      return;
    case 'science':
      store.setShowSciencePanel(true);
      return;
    case 'fleet':
      store.setShowFleetCommandCenter(true);
      return;
    case 'missions':
      store.setShowMissionBoard(true);
      return;
    case 'workflows':
      store.setShowWorkflowProPanel(true);
      return;
    case 'devices':
      store.setShowDevicePanel(true);
      return;
    case 'migration':
      store.setShowClawMigration(true);
  }
}

function upsertRun(runs: LiveLauncherRunView[], next: LiveLauncherRunView): LiveLauncherRunView[] {
  const remaining = runs.filter((run) => run.runId !== next.runId);
  return [next, ...remaining].sort((a, b) => b.startedAt - a.startedAt).slice(0, 20);
}

function appendRenderedLog(current: string[], incoming: string[]): string[] {
  const next = [...current, ...incoming].slice(-MAX_RENDERED_LOG_LINES);
  let totalChars = next.reduce((total, line) => total + line.length, 0);
  while (totalChars > MAX_RENDERED_LOG_CHARS) {
    totalChars -= next.shift()?.length ?? 0;
  }
  return next;
}

/** Keep a newer live event from being overwritten by an older polling reply. */
function mergeRunSnapshots(
  current: LiveLauncherRunView[],
  incoming: LiveLauncherRunView[],
): LiveLauncherRunView[] {
  const currentById = new Map(current.map((run) => [run.runId, run]));
  const merged = incoming.map((next) => {
    const existing = currentById.get(next.runId);
    currentById.delete(next.runId);
    if (!existing) return next;
    if (existing.status !== 'running' && next.status === 'running') return existing;
    return {
      ...next,
      logTail: existing.logTail.length > next.logTail.length ? existing.logTail : next.logTail,
      ...(existing.result && !next.result ? { result: existing.result } : {}),
    };
  });
  return [...merged, ...currentById.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 20);
}

export function AdvancedCommandCenter() {
  const [tab, setTab] = useState<CommandCenterTab>('features');
  const [launcherMode, setLauncherMode] = useState<LauncherMode>('research-direct');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [useLocalOllama, setUseLocalOllama] = useState(true);
  const [workers, setWorkers] = useState(5);
  const [iterations, setIterations] = useState(2);
  const [perspectives, setPerspectives] = useState(4);
  const [featureSearch, setFeatureSearch] = useState('');
  const [runs, setRuns] = useState<LiveLauncherRunView[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedRunIdRef = useRef<string | null>(null);
  selectedRunIdRef.current = selectedRunId;

  const preset =
    LAUNCHER_PRESETS.find((candidate) => candidate.id === launcherMode) ?? LAUNCHER_PRESETS[0];
  const selectedRun = runs.find((run) => run.runId === selectedRunId) ?? null;
  const runningCount = runs.filter((run) => run.status === 'running').length;
  const runningRunIds = runs
    .filter((run) => run.status === 'running')
    .map((run) => run.runId)
    .sort()
    .join(',');

  const filteredFeatures = useMemo(() => {
    const query = featureSearch.trim().toLocaleLowerCase('fr');
    if (!query) return FEATURES;
    return FEATURES.filter((feature) =>
      `${feature.label} ${feature.description} ${feature.command}`
        .toLocaleLowerCase('fr')
        .includes(query)
    );
  }, [featureSearch]);

  const refreshRuns = useCallback(async (silent = false) => {
    const api = window.electronAPI?.liveLauncher;
    if (!api) {
      setError('Le lanceur Cowork n’est pas disponible dans cette version.');
      return;
    }
    if (!silent) setLoadingRuns(true);
    try {
      const next = await api.list();
      setRuns((current) => mergeRunSnapshots(current, next));
      setSelectedRunId((current) => {
        if (current) return current;
        return next[0]?.runId ?? null;
      });
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!silent) setLoadingRuns(false);
    }
  }, []);

  const refreshRun = useCallback(async (runId: string, silent = true) => {
    try {
      const next = await window.electronAPI?.liveLauncher?.status(runId);
      if (next) setRuns((current) => upsertRun(current, next));
    } catch (cause) {
      if (!silent) setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await refreshRuns();
    const selected = selectedRunIdRef.current;
    if (selected) await refreshRun(selected, false);
  }, [refreshRun, refreshRuns]);

  useEffect(() => {
    void refreshRuns();
    const unsubscribe = window.electronAPI?.onEvent?.((event) => {
      if (event.type !== 'liveLauncher.event') return;
      const payload = event.payload as LiveLauncherEventPayload;
      if (payload.kind === 'status') {
        setRuns((current) => upsertRun(current, payload.run));
        setSelectedRunId((current) => current ?? payload.runId);
        if (payload.run.status === 'succeeded') {
          setNotice('Exécution terminée. Le résultat est prêt à être consulté.');
          setError(null);
        } else if (payload.run.status === 'cancelled') {
          setNotice('Exécution annulée. Les journaux déjà produits restent consultables.');
        } else if (payload.run.status === 'failed') {
          setError(payload.run.error ?? 'L’exécution a échoué. Consulte le journal pour le diagnostic.');
        }
        return;
      }
      setRuns((current) =>
        current.map((run) =>
          run.runId === payload.runId
            ? {
                ...run,
                logTail: appendRenderedLog(run.logTail, payload.lines),
              }
            : run
        )
      );
    });
    return unsubscribe;
  }, [refreshRuns]);

  useEffect(() => {
    if (!selectedRunId) return;
    void refreshRun(selectedRunId);
  }, [refreshRun, selectedRunId]);

  useEffect(() => {
    if (!runningRunIds) return undefined;
    const runIds = runningRunIds.split(',');
    const timer = window.setInterval(() => {
      setNow(Date.now());
      for (const runId of runIds) void refreshRun(runId);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [refreshRun, runningRunIds]);

  useEffect(() => {
    const api = window.electronAPI?.autonomy;
    if (!api?.modelTier) return;
    void api
      .modelTier()
      .then((tier) => {
        if (tier?.ok && tier.currentChoice?.model && !tier.currentChoice.paid) {
          setModel((current) => (current === DEFAULT_MODEL ? tier.currentChoice!.model : current));
          if (tier.currentChoice.baseUrl) {
            setOllamaUrl((current) => current.trim() || tier.currentChoice!.baseUrl!);
          }
        }
      })
      .catch(() => undefined);
  }, []);

  const selectLauncher = useCallback((mode: LauncherMode) => {
    setLauncherMode(mode);
    setTab('features');
    setNotice(null);
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }, []);

  const start = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || starting || runningCount > 0) return;
    if (
      !useLocalOllama &&
      !window.confirm(
        `Ce lancement utilisera le provider configuré avec le modèle « ${model.trim() || DEFAULT_MODEL} ». ` +
          'Il peut consommer des crédits API, particulièrement en mode Deep Research. Continuer ?',
      )
    ) {
      return;
    }
    const api = window.electronAPI?.liveLauncher;
    if (!api) {
      setError('Le lanceur Cowork n’est pas disponible dans cette version.');
      return;
    }

    const input: LiveLauncherStartInput = {
      kind: launcherMode === 'flow' ? 'flow' : 'research',
      prompt: trimmedPrompt,
      provider: useLocalOllama ? 'ollama' : 'inherit',
      ...(!useLocalOllama ? { confirmInheritedProvider: true } : {}),
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(useLocalOllama && ollamaUrl.trim() ? { ollamaUrl: ollamaUrl.trim() } : {}),
      ...(launcherMode === 'research-wide' ? { wide: true, workers } : {}),
      ...(launcherMode === 'research-deep' ? { deep: true, iterations, perspectives } : {}),
      ...(launcherMode === 'flow' ? { maxRetries: 1 } : {}),
    };

    setStarting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await api.start(input);
      if (!response.ok || !response.runId) {
        setError(response.error ?? 'Le lancement a échoué.');
        return;
      }
      setSelectedRunId(response.runId);
      setTab('runs');
      setNotice('Exécution lancée. Les journaux apparaissent en direct.');
      const created = await api.status(response.runId);
      if (created) setRuns((current) => upsertRun(current, created));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  }, [
    iterations,
    launcherMode,
    model,
    ollamaUrl,
    perspectives,
    prompt,
    runningCount,
    starting,
    useLocalOllama,
    workers,
  ]);

  const cancel = useCallback(async (runId: string) => {
    setError(null);
    try {
      const response = await window.electronAPI.liveLauncher.cancel(runId);
      if (!response.ok) setError(response.error ?? 'Impossible d’annuler cette exécution.');
      else setNotice('Demande d’annulation envoyée.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const copyResult = useCallback(async (run: LiveLauncherRunView) => {
    const content = run.result ?? run.logTail.join('\n');
    if (!content || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(content);
      setNotice('Résultat copié dans le presse-papiers.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const revealReport = useCallback(async (reportPath: string) => {
    const shown = await window.electronAPI.showItemInFolder(reportPath);
    if (!shown) setError('Le rapport n’a pas pu être affiché dans le dossier.');
  }, []);

  const prepareRerun = useCallback(
    (run: LiveLauncherRunView) => {
      setPrompt(run.prompt);
      setModel(run.model ?? DEFAULT_MODEL);
      setOllamaUrl(run.ollamaUrl ?? '');
      setUseLocalOllama(run.provider === 'ollama');
      setWorkers(run.workers ?? 5);
      setIterations(run.iterations ?? 2);
      setPerspectives(run.perspectives ?? 4);
      selectLauncher(runMode(run));
      setNotice('Paramètres restaurés. Vérifie-les avant de relancer.');
    },
    [selectLauncher]
  );

  const preview = commandPreview(launcherMode, prompt, workers, iterations, perspectives);

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-text-primary"
      data-testid="advanced-command-center"
    >
      <header className="shrink-0 border-b border-border px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-accent">
              <ShieldCheck size={14} /> Centre de commande sécurisé
            </div>
            <h1 className="text-xl font-semibold">Fonctionnalités avancées</h1>
            <p className="mt-1 max-w-3xl text-sm text-text-secondary">
              Lance les fonctions de Code Buddy depuis Cowork, puis supervise leurs journaux et
              leurs résultats.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface/50 px-3 py-2 text-xs text-text-secondary">
            <Activity size={14} className={runningCount > 0 ? 'text-accent' : 'text-text-muted'} />
            {runningCount > 0 ? `${runningCount} exécution en cours` : 'Aucune exécution active'}
          </div>
        </div>

        <div className="mt-5 flex gap-1" role="tablist" aria-label="Centre de commande avancé">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'features'}
            onClick={() => setTab('features')}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              tab === 'features'
                ? 'bg-accent text-background'
                : 'text-text-secondary hover:bg-accent/10 hover:text-text-primary'
            }`}
            data-testid="advanced-tab-features"
          >
            Fonctionnalités
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'runs'}
            onClick={() => setTab('runs')}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
              tab === 'runs'
                ? 'bg-accent text-background'
                : 'text-text-secondary hover:bg-accent/10 hover:text-text-primary'
            }`}
            data-testid="advanced-tab-runs"
          >
            Exécutions
            {runs.length > 0 && (
              <span className="rounded-full bg-background/20 px-1.5 text-[10px]">
                {runs.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {(error || notice) && (
        <div className="shrink-0 px-6 pt-4">
          <div
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
              error
                ? 'border-error/40 bg-error/10 text-error'
                : 'border-success/40 bg-success/10 text-success'
            }`}
            data-testid={error ? 'advanced-command-error' : 'advanced-command-notice'}
          >
            {error ? (
              <CircleAlert size={14} className="mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            )}
            <span>{error ?? notice}</span>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setNotice(null);
              }}
              className="ml-auto opacity-70 hover:opacity-100"
              aria-label="Fermer le message"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {tab === 'features' ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
            <div className="rounded-xl border border-border bg-surface/35 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <Play size={15} className="text-accent" /> Lancer une fonction
                  </h2>
                  <p className="mt-1 text-xs text-text-muted">
                    Le processus principal construit une commande autorisée, sans shell générique.
                  </p>
                </div>
                <span
                  className={`rounded border px-2 py-0.5 text-[10px] font-medium ${
                    useLocalOllama
                      ? 'border-success/35 bg-success/10 text-success'
                      : 'border-warning/40 bg-warning/10 text-warning'
                  }`}
                >
                  {useLocalOllama ? 'Ollama local/réseau · $0' : 'provider configuré · coût possible'}
                </span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {LAUNCHER_PRESETS.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => setLauncherMode(candidate.id)}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      launcherMode === candidate.id
                        ? 'border-accent/60 bg-accent/10'
                        : 'border-border bg-background hover:border-accent/35 hover:bg-accent/5'
                    }`}
                    data-testid={`advanced-mode-${candidate.id}`}
                  >
                    <span className="block text-xs font-medium">{candidate.label}</span>
                    <span className="mt-1 block text-[10px] leading-relaxed text-text-muted">
                      {candidate.description}
                    </span>
                  </button>
                ))}
              </div>

              <div className="mt-4 space-y-3">
                <textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={4}
                  disabled={runningCount > 0}
                  placeholder={
                    launcherMode === 'flow'
                      ? 'Décris l’objectif à planifier et traiter…'
                      : 'Quel sujet Code Buddy doit-il étudier ?'
                  }
                  className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-text-muted focus:border-accent/60 disabled:opacity-50"
                  data-testid="advanced-launcher-prompt"
                />
                <div className="grid gap-3 md:grid-cols-[minmax(180px,1fr)_auto_auto]">
                  <label className="space-y-1 text-[10px] text-text-muted">
                    Modèle
                    <input
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                      disabled={runningCount > 0}
                      className="block w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-text-primary disabled:opacity-50"
                      data-testid="advanced-launcher-model"
                    />
                  </label>
                  {launcherMode === 'research-wide' && (
                    <label className="space-y-1 text-[10px] text-text-muted">
                      Workers
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={workers}
                        onChange={(event) =>
                          setWorkers(Math.max(1, Math.min(20, Number(event.target.value) || 1)))
                        }
                        className="block w-20 rounded border border-border bg-background px-2 py-1.5 text-xs text-text-primary"
                        data-testid="advanced-launcher-workers"
                      />
                    </label>
                  )}
                  {launcherMode === 'research-deep' && (
                    <div className="flex gap-2">
                      <label className="space-y-1 text-[10px] text-text-muted">
                        Itérations
                        <input
                          type="number"
                          min={1}
                          max={3}
                          value={iterations}
                          onChange={(event) =>
                            setIterations(Math.max(1, Math.min(3, Number(event.target.value) || 1)))
                          }
                          className="block w-20 rounded border border-border bg-background px-2 py-1.5 text-xs text-text-primary"
                          data-testid="advanced-launcher-iterations"
                        />
                      </label>
                      <label className="space-y-1 text-[10px] text-text-muted">
                        Perspectives
                        <input
                          type="number"
                          min={2}
                          max={6}
                          value={perspectives}
                          onChange={(event) =>
                            setPerspectives(
                              Math.max(2, Math.min(6, Number(event.target.value) || 2))
                            )
                          }
                          className="block w-20 rounded border border-border bg-background px-2 py-1.5 text-xs text-text-primary"
                          data-testid="advanced-launcher-perspectives"
                        />
                      </label>
                    </div>
                  )}
                  <label className="flex items-end gap-2 pb-1.5 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={useLocalOllama}
                      onChange={(event) => setUseLocalOllama(event.target.checked)}
                      disabled={runningCount > 0}
                      className="h-3.5 w-3.5 accent-accent"
                      data-testid="advanced-launcher-local"
                    />
                    Ollama local/réseau
                  </label>
                </div>

                {useLocalOllama && (
                  <label className="block space-y-1 text-[10px] text-text-muted">
                    Endpoint Ollama
                    <input
                      value={ollamaUrl}
                      onChange={(event) => setOllamaUrl(event.target.value)}
                      disabled={runningCount > 0}
                      placeholder="Configuration Cowork (ex. http://darkstar:11434)"
                      className="block w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-muted disabled:opacity-50"
                      data-testid="advanced-launcher-ollama-url"
                    />
                  </label>
                )}

                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-muted bg-background/70 px-3 py-2">
                  <code
                    className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-text-muted"
                    title={preview}
                  >
                    {preview}
                  </code>
                  <button
                    type="button"
                    onClick={() => void start()}
                    disabled={!prompt.trim() || starting || runningCount > 0}
                    className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                    data-testid="advanced-launcher-start"
                  >
                    {starting ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                    {runningCount > 0 ? 'Une exécution est déjà active' : `Lancer ${preset.label}`}
                  </button>
                </div>
              </div>
            </div>

            <aside className="rounded-xl border border-border bg-surface/25 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck size={15} className="text-success" /> Garde-fous
              </h2>
              <ul className="mt-3 space-y-3 text-xs text-text-secondary">
                <li className="flex gap-2">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" /> Catalogue de
                  commandes autorisées côté processus principal.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" /> Une seule
                  exécution active pour garder le contrôle des ressources.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" /> Délai maximal,
                  annulation et journal plafonné.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" /> Les rapports
                  sont conservés comme artefacts ouvrables.
                </li>
              </ul>
            </aside>
          </section>

          <section className="mt-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Tous les modules</h2>
                <p className="mt-0.5 text-xs text-text-muted">
                  Ouvre les panneaux natifs pour configurer et administrer les fonctions existantes.
                </p>
              </div>
              <label className="relative block">
                <Search
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  value={featureSearch}
                  onChange={(event) => setFeatureSearch(event.target.value)}
                  placeholder="Filtrer les modules…"
                  className="w-64 rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs outline-none focus:border-accent/60"
                  data-testid="advanced-feature-search"
                />
              </label>
            </div>

            {(['Pilotage', 'Données et qualité', 'Orchestration'] as const).map((group) => {
              const groupFeatures = filteredFeatures.filter((feature) => feature.group === group);
              if (groupFeatures.length === 0) return null;
              return (
                <div key={group} className="mt-5">
                  <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-text-muted">
                    {group}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {groupFeatures.map((feature) => {
                      const Icon = feature.icon;
                      return (
                        <article
                          key={feature.id}
                          className="flex min-h-36 flex-col rounded-xl border border-border bg-surface/25 p-4 transition-colors hover:border-accent/30"
                        >
                          <div className="flex items-start gap-3">
                            <span className="rounded-lg border border-border bg-background p-2 text-accent">
                              <Icon size={16} />
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-sm font-medium">{feature.label}</h4>
                                {feature.badge && (
                                  <span className="rounded border border-border px-1.5 py-0.5 text-[9px] text-text-muted">
                                    {feature.badge}
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                                {feature.description}
                              </p>
                            </div>
                          </div>
                          <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                            <code
                              className="min-w-0 truncate text-[9px] text-text-muted"
                              title={feature.command}
                            >
                              {feature.command}
                            </code>
                            <button
                              type="button"
                              onClick={() => {
                                if (feature.launcherMode) selectLauncher(feature.launcherMode);
                                else if (feature.panel) openPanel(feature.panel);
                              }}
                              className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[10px] text-text-secondary hover:border-accent/40 hover:text-text-primary"
                              data-testid={`advanced-feature-${feature.id}`}
                            >
                              {feature.launcherMode ? 'Préparer' : 'Ouvrir'}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-r border-border bg-surface/20 p-3">
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="flex items-center gap-2 text-xs font-semibold">
                <History size={14} /> Historique de la session
              </h2>
              <button
                type="button"
                onClick={() => void refreshAll()}
                disabled={loadingRuns}
                className="rounded p-1 text-text-muted hover:bg-accent/10 hover:text-text-primary disabled:opacity-50"
                aria-label="Actualiser les exécutions"
                data-testid="advanced-runs-refresh"
              >
                <RefreshCcw size={13} className={loadingRuns ? 'animate-spin' : ''} />
              </button>
            </div>
            {runs.length === 0 ? (
              <div
                className="rounded-lg border border-dashed border-border p-5 text-center text-xs text-text-muted"
                data-testid="advanced-runs-empty"
              >
                Aucune exécution. Prépare une recherche ou un Flow dans l’onglet Fonctionnalités.
              </div>
            ) : (
              <div className="space-y-2">
                {runs.map((run) => (
                  <button
                    key={run.runId}
                    type="button"
                    onClick={() => setSelectedRunId(run.runId)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      selectedRunId === run.runId
                        ? 'border-accent/50 bg-accent/10'
                        : 'border-border bg-background hover:bg-accent/5'
                    }`}
                    data-testid={`advanced-run-${run.runId}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
                        {runMode(run).replace('-', ' ')}
                      </span>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[9px] ${statusClasses(run.status)}`}
                      >
                        {STATUS_LABELS[run.status]}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs font-medium leading-relaxed">
                      {run.prompt}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-[9px] text-text-muted">
                      <Clock3 size={10} /> {formatDuration(run, now)}
                      <span>·</span>
                      <span className="truncate font-mono">{run.model ?? 'modèle par défaut'}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <main className="min-h-0 overflow-y-auto p-5">
            {!selectedRun ? (
              <div className="flex h-full min-h-64 items-center justify-center rounded-xl border border-dashed border-border text-sm text-text-muted">
                Sélectionne une exécution pour consulter son résultat.
              </div>
            ) : (
              <div className="mx-auto max-w-5xl space-y-5" data-testid="advanced-run-detail">
                <section className="rounded-xl border border-border bg-surface/25 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded border px-2 py-0.5 text-[10px] ${statusClasses(selectedRun.status)}`}
                        >
                          {STATUS_LABELS[selectedRun.status]}
                        </span>
                        <span className="text-[10px] uppercase tracking-[0.13em] text-text-muted">
                          {runMode(selectedRun).replace('-', ' ')}
                        </span>
                      </div>
                      <h2 className="mt-3 text-lg font-semibold leading-snug">
                        {selectedRun.prompt}
                      </h2>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-text-muted">
                        <span>
                          ID <code>{selectedRun.runId}</code>
                        </span>
                        <span>
                          Modèle <code>{selectedRun.model ?? 'défaut'}</code>
                        </span>
                        <span>
                          Provider <code>{selectedRun.provider}</code>
                        </span>
                        <span>Durée {formatDuration(selectedRun, now)}</span>
                        {selectedRun.timeoutMs !== undefined && (
                          <span>Limite {Math.round(selectedRun.timeoutMs / 60_000)} min</span>
                        )}
                        {selectedRun.exitCode !== undefined && (
                          <span>Exit {selectedRun.exitCode}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedRun.status === 'running' && (
                        <button
                          type="button"
                          onClick={() => void cancel(selectedRun.runId)}
                          className="flex items-center gap-1.5 rounded-md border border-error/40 px-3 py-1.5 text-xs text-error hover:bg-error/10"
                          data-testid="advanced-run-cancel"
                        >
                          <Square size={12} /> Annuler
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => prepareRerun(selectedRun)}
                        disabled={runningCount > 0}
                        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:border-accent/40 hover:text-text-primary disabled:opacity-45"
                        data-testid="advanced-run-rerun"
                      >
                        <RefreshCcw size={12} /> Préparer à nouveau
                      </button>
                      {(selectedRun.result || selectedRun.logTail.length > 0) && (
                        <button
                          type="button"
                          onClick={() => void copyResult(selectedRun)}
                          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:border-accent/40 hover:text-text-primary"
                          data-testid="advanced-run-copy"
                        >
                          <Copy size={12} /> Copier
                        </button>
                      )}
                      {selectedRun.reportPath && (
                        <button
                          type="button"
                          onClick={() => void revealReport(selectedRun.reportPath!)}
                          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:border-accent/40 hover:text-text-primary"
                          data-testid="advanced-run-reveal"
                        >
                          <FolderOpen size={12} /> Ouvrir le rapport
                        </button>
                      )}
                    </div>
                  </div>
                  {selectedRun.error && (
                    <p
                      className="mt-4 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
                      data-testid="advanced-run-error"
                    >
                      {selectedRun.error}
                    </p>
                  )}
                </section>

                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-text-muted">
                      {selectedRun.status === 'running' && (
                        <Loader2 size={12} className="animate-spin text-accent" />
                      )}{' '}
                      Journal
                    </h3>
                    <span className="text-[9px] text-text-muted">
                      {selectedRun.logTail.length} lignes conservées
                    </span>
                  </div>
                  <pre
                    className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-4 font-mono text-[10px] leading-relaxed text-text-secondary"
                    data-testid="advanced-run-log"
                  >
                    {selectedRun.logTail.length > 0
                      ? selectedRun.logTail.join('\n')
                      : 'En attente de sortie…'}
                  </pre>
                </section>

                {selectedRun.result && (
                  <section data-testid="advanced-run-result">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.13em] text-text-muted">
                      Résultat
                    </h3>
                    {selectedRun.reportPath && (
                      <p
                        className="mb-2 truncate font-mono text-[9px] text-text-muted"
                        title={selectedRun.reportPath}
                      >
                        {selectedRun.reportPath}
                      </p>
                    )}
                    <div className="rounded-xl border border-border bg-surface/30 p-5 text-sm">
                      <MessageMarkdown normalizedText={selectedRun.result} />
                    </div>
                  </section>
                )}
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
