/**
 * TestRunnerPanel - QA and execution monitor.
 *
 * Shows a catalog of runnable checks plus recent app/harness executions.
 * The main process owns command execution; this panel only renders state and
 * dispatches catalog item IDs through the preload bridge.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FlaskConical,
  Loader2,
  MinusCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  TerminalSquare,
  X,
  XCircle,
} from 'lucide-react';

interface TestCase {
  name: string;
  suite: string;
  file?: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending';
  duration: number;
  error?: string;
  stack?: string;
}

interface TestResult {
  success: boolean;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
  framework: string;
  tests: TestCase[];
}

type TestCatalogKind = 'quality' | 'unit' | 'integration' | 'e2e' | 'real-provider' | 'script';

interface TestCatalogItem {
  id: string;
  label: string;
  group: string;
  description: string;
  command: string;
  args: string[];
  cwd: string;
  kind: TestCatalogKind;
  safeToRun: boolean;
  requiresEnv?: string;
}

type CatalogStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
type RunnerTab = 'tests' | 'executions' | 'coverage';
type CoverageLevel = 'opened' | 'used' | 'real';
type CoverageStatus = 'passed' | 'partial' | 'blocked';
type CatalogModeFilter = 'all' | 'safe' | 'manual' | 'real';
type CatalogKindFilter = 'all' | TestCatalogKind;

interface CatalogRunState {
  status: CatalogStatus;
  result?: TestResult;
  updatedAt?: number;
}

interface AuditRunSummary {
  runId: string;
  objective: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  eventCount: number;
  artifactCount: number;
  channel?: string;
  sessionId?: string;
  source?: string;
  platform?: string;
  origin?: string;
  tags?: string[];
  totalCost?: number;
  totalTokens?: number;
  toolCallCount?: number;
}

interface TestRunnerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FunctionalCoverageItem {
  id: string;
  feature: string;
  surface: string;
  level: CoverageLevel;
  status: CoverageStatus;
  proof: string;
  evidence: string;
  screenshot?: string;
}

const functionalCoverage: FunctionalCoverageItem[] = [
  {
    id: 'home-work-surface',
    feature: 'Accueil et surface de travail',
    surface: 'Welcome view',
    level: 'used',
    status: 'passed',
    proof: 'Prompt rapide + lancement de chat preview',
    evidence: '27-quick-prompts.png, 28-chat-ui-mock.png',
  },
  {
    id: 'shortcuts',
    feature: 'Raccourcis clavier',
    surface: 'Titlebar shortcuts dialog',
    level: 'used',
    status: 'passed',
    proof: 'Ctrl+/ ouvre puis Escape ferme le dialogue',
    evidence: 'recent-features-smoke.spec.ts',
  },
  {
    id: 'clipboard-summary',
    feature: 'Resume du presse-papiers',
    surface: 'Clipboard summary panel',
    level: 'used',
    status: 'passed',
    proof: 'Resume immediat du presse-papiers + toggle monitoring + envoi chat',
    evidence: 'feature-completion-depth.spec.ts, 36-clipboard-orchestrator-fleet-used.png',
  },
  {
    id: 'voice-overlay',
    feature: 'Overlay voix',
    surface: 'Voice overlay',
    level: 'used',
    status: 'passed',
    proof: 'Overlay ouvert + diagnostics voix utilises dans le compagnon',
    evidence: '04-voice-overlay.png, companion-panel.spec.ts',
  },
  {
    id: 'global-search',
    feature: 'Recherche globale',
    surface: 'Global search dialog',
    level: 'used',
    status: 'passed',
    proof: 'Ouverture clavier + saisie de requete verifiee',
    evidence: 'recent-features-smoke.spec.ts',
  },
  {
    id: 'orchestrator',
    feature: 'Orchestrateur multi-agent',
    surface: 'Multi-agent launcher',
    level: 'used',
    status: 'passed',
    proof: 'Objectif, strategie peer_review et nombre de rounds saisis puis lancement declenche',
    evidence: 'feature-completion-depth.spec.ts, 36-clipboard-orchestrator-fleet-used.png',
  },
  {
    id: 'fleet-command-center',
    feature: 'Centre de commande Fleet',
    surface: 'Fleet command center',
    level: 'used',
    status: 'passed',
    proof: 'Peer routable mocke, objectif rempli, privacy/profile modifies et dispatch saga valide',
    evidence: 'feature-completion-depth.spec.ts, 36-clipboard-orchestrator-fleet-used.png',
  },
  {
    id: 'fleet-events',
    feature: 'Flux evenements Fleet',
    surface: 'Fleet peer events',
    level: 'used',
    status: 'passed',
    proof: 'Formulaire add-peer utilise, validation URL et champs peer verifies',
    evidence: 'panel-usage-depth.spec.ts, 34-fleet-team-used.png',
  },
  {
    id: 'agent-team',
    feature: 'Agent Team',
    surface: 'Team panel',
    level: 'used',
    status: 'passed',
    proof: 'Modal de lancement ouverte et objectif equipe saisi sans demarrer de service externe',
    evidence: 'panel-usage-depth.spec.ts, 34-fleet-team-used.png',
  },
  {
    id: 'workflows',
    feature: 'Workflows',
    surface: 'Settings workflows',
    level: 'used',
    status: 'passed',
    proof: 'Workflow cree, noeud tool ajoute, sauvegarde et execution validee',
    evidence: 'feature-completion-depth.spec.ts, 38-review-backlog-used.png',
  },
  {
    id: 'schedules',
    feature: 'Planifications',
    surface: 'Settings schedules',
    level: 'used',
    status: 'passed',
    proof: 'Tache planifiee creee dans le profil Electron isole',
    evidence: 'panel-usage-depth.spec.ts, 35-automation-panels-used.png',
  },
  {
    id: 'hooks-triggers',
    feature: 'Hooks et triggers',
    surface: 'Settings hooks',
    level: 'used',
    status: 'passed',
    proof: 'Hook shell teste en dry-run avec sortie HOOK_PANEL_OK',
    evidence: 'panel-usage-depth.spec.ts, 35-automation-panels-used.png',
  },
  {
    id: 'custom-commands',
    feature: 'Commandes personnalisees',
    surface: 'Settings custom commands',
    level: 'used',
    status: 'passed',
    proof: 'Commande /qa-panel-proof creee et visible dans la liste',
    evidence: 'panel-usage-depth.spec.ts, 35-automation-panels-used.png',
  },
  {
    id: 'bookmarks',
    feature: 'Favoris',
    surface: 'Bookmarks panel',
    level: 'used',
    status: 'passed',
    proof: 'Recherche et bascule scope projet/global appliquees sur favori peuple',
    evidence: 'feature-completion-depth.spec.ts, 37-knowledge-panels-used.png',
  },
  {
    id: 'activity',
    feature: 'Activite',
    surface: 'Activity panel',
    level: 'used',
    status: 'passed',
    proof: 'Filtres all, fleet et scheduled utilises avec evenements peuplees',
    evidence: 'feature-completion-depth.spec.ts, 37-knowledge-panels-used.png',
  },
  {
    id: 'session-insights',
    feature: 'Session insights',
    surface: 'Session insights panel',
    level: 'used',
    status: 'passed',
    proof: 'Recherche session peuplee + audit transcript propre',
    evidence: 'feature-completion-depth.spec.ts, 37-knowledge-panels-used.png',
  },
  {
    id: 'focus-view',
    feature: 'Vue ciblee',
    surface: 'Focus view',
    level: 'used',
    status: 'passed',
    proof: 'Session active affichee avec prompt/reponse puis ouverture insights',
    evidence: 'feature-completion-depth.spec.ts, 37-knowledge-panels-used.png',
  },
  {
    id: 'lesson-candidates',
    feature: 'Lecons candidates',
    surface: 'Lesson review queue',
    level: 'used',
    status: 'passed',
    proof: 'Lecon candidate approuvee avec reviewer et onglet all verifie',
    evidence: 'feature-completion-depth.spec.ts, 38-review-backlog-used.png',
  },
  {
    id: 'user-model',
    feature: 'Modele utilisateur',
    surface: 'User model panel',
    level: 'used',
    status: 'passed',
    proof: 'Observation acceptee avec reviewer, resume actif et onglet all verifies',
    evidence: 'feature-completion-depth.spec.ts, 38-review-backlog-used.png',
  },
  {
    id: 'spec-backlog',
    feature: 'Backlog spec',
    surface: 'Spec backlog',
    level: 'used',
    status: 'passed',
    proof: 'Projet spec cree, story ajoutee puis approuvee',
    evidence: 'feature-completion-depth.spec.ts, 38-review-backlog-used.png',
  },
  {
    id: 'buddy-companion',
    feature: 'Buddy companion',
    surface: 'Companion cockpit',
    level: 'real',
    status: 'passed',
    proof: 'Setup projet, self-state, camera, voix, pulse, improvement loop',
    evidence: 'companion-panel.spec.ts, companion-live.spec.ts',
  },
  {
    id: 'settings-general',
    feature: 'Parametres generaux',
    surface: 'Settings panel',
    level: 'used',
    status: 'passed',
    proof: 'Creation projet et activation depuis les reglages',
    evidence: 'companion-panel.spec.ts',
  },
  {
    id: 'api-settings',
    feature: 'Parametres API',
    surface: 'CodeBuddy API settings',
    level: 'real',
    status: 'passed',
    proof: 'Profil chatgpt gpt-5.5 sauvegarde et applique au runner embarque',
    evidence: 'config-store-profiles.test.ts, chat-real-gpt55.spec.ts',
  },
  {
    id: 'mcp-connectors',
    feature: 'Connecteurs MCP',
    surface: 'MCP settings',
    level: 'used',
    status: 'passed',
    proof: 'Marketplace consultee, serveur deploye ouvert et outil invoque via playground',
    evidence: 'feature-completion-depth.spec.ts, 39-connectors-plugins-used.png',
  },
  {
    id: 'permission-rules',
    feature: 'Permission rules',
    surface: 'Permission rules editor',
    level: 'used',
    status: 'passed',
    proof: 'Regles pre-remplies depuis demande permission + champs de test disponibles',
    evidence: 'cowork-smoke.spec.ts, 25-permission-rules.png',
  },
  {
    id: 'plugins',
    feature: 'Plugins',
    surface: 'Plugin manager',
    level: 'used',
    status: 'passed',
    proof: 'Plugin installe explore, composant skills active/desactive et catalogue filtre',
    evidence: 'feature-completion-depth.spec.ts, 39-connectors-plugins-used.png',
  },
  {
    id: 'quick-prompts',
    feature: 'Prompts rapides',
    surface: 'Welcome quick prompts',
    level: 'used',
    status: 'passed',
    proof: 'Bouton remplit la zone de prompt',
    evidence: '27-quick-prompts.png',
  },
  {
    id: 'chat-ui',
    feature: 'Chat UI',
    surface: 'Chat view',
    level: 'real',
    status: 'passed',
    proof: 'Chat IPC mock + appel reel ChatGPT gpt-5.5 via Electron',
    evidence: 'chat-flow.spec.ts, chat-real-gpt55.spec.ts',
  },
  {
    id: 'test-runner',
    feature: 'Fenetre Tests & executions',
    surface: 'QA window',
    level: 'used',
    status: 'passed',
    proof: 'Catalogue, execution tracking, lancement de check depuis le panneau',
    evidence: 'test-runner-panel.spec.ts',
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTestCatalogItem(value: unknown): value is TestCatalogItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.group === 'string' &&
    typeof value.description === 'string' &&
    typeof value.command === 'string' &&
    Array.isArray(value.args) &&
    typeof value.cwd === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.safeToRun === 'boolean'
  );
}

function formatDuration(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms)) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

function formatTime(ts?: number): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusClass(status: CatalogStatus | AuditRunSummary['status']): string {
  switch (status) {
    case 'passed':
    case 'completed':
      return 'text-success bg-success/10 border-success/30';
    case 'failed':
      return 'text-error bg-error/10 border-error/30';
    case 'running':
      return 'text-accent bg-accent/10 border-accent/30';
    case 'skipped':
    case 'cancelled':
      return 'text-warning bg-warning/10 border-warning/30';
    default:
      return 'text-text-muted bg-surface border-border-muted';
  }
}

function statusIcon(status: CatalogStatus | AuditRunSummary['status']) {
  switch (status) {
    case 'passed':
    case 'completed':
      return <CheckCircle2 size={13} />;
    case 'failed':
      return <XCircle size={13} />;
    case 'running':
      return <Loader2 size={13} className="animate-spin" />;
    case 'skipped':
    case 'cancelled':
      return <MinusCircle size={13} />;
    default:
      return <Clock3 size={13} />;
  }
}

function coverageStatusClass(status: CoverageStatus): string {
  switch (status) {
    case 'passed':
      return 'text-success bg-success/10 border-success/30';
    case 'blocked':
      return 'text-warning bg-warning/10 border-warning/30';
    default:
      return 'text-text-muted bg-surface border-border-muted';
  }
}

function coverageLevelClass(level: CoverageLevel): string {
  switch (level) {
    case 'real':
      return 'text-accent border-accent/30 bg-accent/10';
    case 'used':
      return 'text-success border-success/30 bg-success/10';
    default:
      return 'text-text-muted border-border-muted bg-surface';
  }
}

function commandPreview(item: TestCatalogItem): string {
  return [item.command, ...item.args].join(' ');
}

function stripAnsi(text: string): string {
  const esc = String.fromCharCode(27);
  const csi = String.fromCharCode(155);
  const ansiPattern = new RegExp(
    `[${esc}${csi}][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqty=><]`,
    'g'
  );
  return text.replace(ansiPattern, '');
}

export function TestRunnerPanel({ isOpen, onClose }: TestRunnerPanelProps) {
  const { t } = useTranslation();
  const [framework, setFramework] = useState<string | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [catalog, setCatalog] = useState<TestCatalogItem[]>([]);
  const [itemStates, setItemStates] = useState<Record<string, CatalogRunState>>({});
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<RunnerTab>('tests');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogMode, setCatalogMode] = useState<CatalogModeFilter>('all');
  const [catalogKind, setCatalogKind] = useState<CatalogKindFilter>('all');
  const [isRunning, setIsRunning] = useState(false);
  const [output, setOutput] = useState<string>('');
  const [runs, setRuns] = useState<AuditRunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  const refreshCatalog = useCallback(async () => {
    const api = window.electronAPI?.test;
    if (!api?.catalog) return;
    const loaded = await api.catalog();
    setCatalog((Array.isArray(loaded) ? loaded : []).filter(isTestCatalogItem));
  }, []);

  const refreshExecutions = useCallback(async () => {
    const api = window.electronAPI?.audit;
    if (!api?.listRuns) return;
    try {
      const latest = (await api.listRuns({ limit: 25 })) as AuditRunSummary[];
      setRuns(Array.isArray(latest) ? latest : []);
    } catch {
      setRuns([]);
    }
  }, []);

  const refreshState = useCallback(async () => {
    const api = window.electronAPI?.test;
    if (!api?.getState) return;
    try {
      const state = await api.getState();
      if (state) {
        setFramework(state.framework);
        setResult((state.lastResult as TestResult) ?? null);
        setIsRunning(state.isRunning);
        if (Array.isArray(state.catalog)) {
          setCatalog(state.catalog.filter(isTestCatalogItem));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void refreshState();
    void refreshCatalog();
    void refreshExecutions();
    if (!framework && window.electronAPI?.test?.detect) {
      void window.electronAPI.test.detect().then((f) => {
        if (f) setFramework(f);
      });
    }
  }, [isOpen, refreshCatalog, refreshExecutions, refreshState, framework]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const interval = window.setInterval(() => {
      void refreshExecutions();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [isOpen, refreshExecutions]);

  useEffect(() => {
    const api = window.electronAPI as unknown as {
      onEvent?: (cb: (event: { type: string; payload?: unknown }) => void) => () => void;
    };
    if (!api?.onEvent) return undefined;
    const unsubscribe = api.onEvent((event) => {
      switch (event.type) {
        case 'test.framework':
          setFramework((event.payload as { framework: string }).framework);
          break;
        case 'test.start':
          setIsRunning(true);
          setOutput('');
          setResult(null);
          setError(null);
          break;
        case 'test.output': {
          const payload = event.payload as { stream: string; text: string };
          setOutput((prev) => prev + stripAnsi(payload.text));
          break;
        }
        case 'test.complete':
          setIsRunning(false);
          setResult(event.payload as TestResult);
          break;
        case 'test.cancelled':
          setIsRunning(false);
          setError(t('testRunner.cancelled', 'Test run cancelled'));
          break;
      }
    });
    return unsubscribe;
  }, [t]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const catalogSummary = useMemo(() => {
    const states = Object.values(itemStates);
    return {
      total: catalog.length,
      passed: states.filter((entry) => entry.status === 'passed').length,
      failed: states.filter((entry) => entry.status === 'failed').length,
      running: states.filter((entry) => entry.status === 'running').length,
      pending: Math.max(0, catalog.length - states.length),
    };
  }, [catalog.length, itemStates]);

  const catalogModeOptions = useMemo(
    () => [
      { value: 'all' as CatalogModeFilter, label: t('testRunner.filterAll', 'All') },
      { value: 'safe' as CatalogModeFilter, label: t('testRunner.filterSafe', 'Safe') },
      { value: 'manual' as CatalogModeFilter, label: t('testRunner.filterManual', 'Manual') },
      { value: 'real' as CatalogModeFilter, label: t('testRunner.filterReal', 'Real') },
    ],
    [t]
  );

  const catalogKindOptions = useMemo(
    () => [
      { value: 'all' as CatalogKindFilter, label: t('testRunner.kindAll', 'All types') },
      { value: 'quality' as CatalogKindFilter, label: t('testRunner.kind.quality', 'Quality') },
      { value: 'unit' as CatalogKindFilter, label: t('testRunner.kind.unit', 'Unit') },
      {
        value: 'integration' as CatalogKindFilter,
        label: t('testRunner.kind.integration', 'Integration'),
      },
      { value: 'e2e' as CatalogKindFilter, label: t('testRunner.kind.e2e', 'E2E') },
      {
        value: 'real-provider' as CatalogKindFilter,
        label: t('testRunner.kind.realProvider', 'Real provider'),
      },
      { value: 'script' as CatalogKindFilter, label: t('testRunner.kind.script', 'Script') },
    ],
    [t]
  );

  const filteredCatalog = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    return catalog.filter((item) => {
      const matchesMode =
        catalogMode === 'all' ||
        (catalogMode === 'safe' && item.safeToRun) ||
        (catalogMode === 'manual' && !item.safeToRun) ||
        (catalogMode === 'real' && item.kind === 'real-provider');
      const matchesKind = catalogKind === 'all' || item.kind === catalogKind;
      const matchesQuery =
        !query ||
        [item.label, item.group, item.description, item.command, item.args.join(' '), item.requiresEnv]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      return matchesMode && matchesKind && matchesQuery;
    });
  }, [catalog, catalogKind, catalogMode, catalogQuery]);

  const coverageSummary = useMemo(
    () => ({
      total: functionalCoverage.length,
      real: functionalCoverage.filter((item) => item.level === 'real').length,
      used: functionalCoverage.filter((item) => item.level === 'used').length,
      partial: functionalCoverage.filter((item) => item.status === 'partial').length,
      blocked: functionalCoverage.filter((item) => item.status === 'blocked').length,
    }),
    []
  );

  const groupedCatalog = useMemo(() => {
    const groups = new Map<string, TestCatalogItem[]>();
    for (const item of filteredCatalog) {
      const current = groups.get(item.group) ?? [];
      current.push(item);
      groups.set(item.group, current);
    }
    return Array.from(groups.entries());
  }, [filteredCatalog]);

  const markItem = useCallback((id: string, state: CatalogRunState) => {
    setItemStates((prev) => ({ ...prev, [id]: state }));
  }, []);

  const handleRunCatalogItem = useCallback(
    async (item: TestCatalogItem) => {
      const api = window.electronAPI?.test;
      if (!api?.runCatalogItem) return null;
      setActiveTab('tests');
      setActiveItemId(item.id);
      setError(null);
      setOutput('');
      setIsRunning(true);
      markItem(item.id, { status: 'running', updatedAt: Date.now() });
      try {
        const runResult = (await api.runCatalogItem(item.id)) as TestResult | null;
        if (runResult) {
          const status: CatalogStatus = runResult.tests?.[0]?.status === 'skipped'
            ? 'skipped'
            : runResult.success ? 'passed' : 'failed';
          markItem(item.id, { status, result: runResult, updatedAt: Date.now() });
          setResult(runResult);
          return runResult;
        }
        markItem(item.id, { status: 'failed', updatedAt: Date.now() });
        return null;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        markItem(item.id, { status: 'failed', updatedAt: Date.now() });
        return null;
      } finally {
        setActiveItemId(null);
        setIsRunning(false);
        void refreshExecutions();
      }
    },
    [markItem, refreshExecutions]
  );

  const handleRunCatalogBatch = useCallback(
    async (includeAll: boolean) => {
      const selected = includeAll ? filteredCatalog : filteredCatalog.filter((item) => item.safeToRun);
      for (const item of selected) {
        const runResult = await handleRunCatalogItem(item);
        if (runResult && !runResult.success && !includeAll) break;
      }
    },
    [filteredCatalog, handleRunCatalogItem]
  );

  const handleRunFramework = useCallback(async () => {
    if (!window.electronAPI?.test?.run) return;
    setError(null);
    setOutput('');
    setIsRunning(true);
    try {
      const r = await window.electronAPI.test.run();
      if (r) setResult(r as TestResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
      void refreshCatalog();
      void refreshExecutions();
    }
  }, [refreshCatalog, refreshExecutions]);

  const handleRunFailing = useCallback(async () => {
    if (!window.electronAPI?.test?.runFailing) return;
    setError(null);
    setOutput('');
    setIsRunning(true);
    try {
      const r = await window.electronAPI.test.runFailing();
      if (r) setResult(r as TestResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
      void refreshExecutions();
    }
  }, [refreshExecutions]);

  const handleCancel = useCallback(async () => {
    if (!window.electronAPI?.test?.cancel) return;
    await window.electronAPI.test.cancel();
    if (activeItemId) {
      markItem(activeItemId, { status: 'skipped', updatedAt: Date.now() });
    }
    setActiveItemId(null);
    setIsRunning(false);
  }, [activeItemId, markItem]);

  if (!isOpen) return null;

  const hasFailing = result ? result.failed > 0 : false;

  return (
    <div
      className="fixed right-0 top-0 z-40 flex h-full w-[760px] max-w-[96vw] flex-col border-l border-border bg-background shadow-2xl"
      data-testid="test-runner-panel"
    >
      <div className="flex items-center justify-between border-b border-border-muted px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FlaskConical size={16} className="text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">
              {t('testRunner.title', 'Test runner')}
            </h2>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-text-muted">
            {framework
              ? t('testRunner.framework', { framework })
              : t('testRunner.noFramework', 'No framework detected')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              void refreshCatalog();
              void refreshExecutions();
            }}
            className="rounded p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
            aria-label={t('common.refresh', 'Refresh')}
          >
            <RefreshCw size={15} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
            aria-label={t('common.close', 'Close')}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="border-b border-border-muted px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {isRunning ? (
            <button
              type="button"
              onClick={() => void handleCancel()}
              data-testid="test-runner-cancel"
              className="inline-flex items-center gap-1.5 rounded-md bg-error px-3 py-1.5 text-xs text-white transition-colors hover:bg-error/90"
            >
              <Square size={12} />
              {t('testRunner.cancel', 'Cancel')}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleRunCatalogBatch(false)}
                disabled={catalog.length === 0}
                data-testid="test-runner-run-safe"
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                <Play size={12} />
                {t('testRunner.runSafe', 'Run safe checks')}
              </button>
              <button
                type="button"
                onClick={() => void handleRunCatalogBatch(true)}
                disabled={catalog.length === 0}
                data-testid="test-runner-run-catalog"
                className="inline-flex items-center gap-1.5 rounded-md border border-border-muted px-3 py-1.5 text-xs text-text-primary transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                <TerminalSquare size={12} />
                {t('testRunner.runCatalog', 'Run catalog')}
              </button>
              <button
                type="button"
                onClick={() => void handleRunFramework()}
                disabled={!framework}
                data-testid="test-runner-run-all"
                className="inline-flex items-center gap-1.5 rounded-md border border-border-muted px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                <Play size={12} />
                {t('testRunner.runAll', 'Run all')}
              </button>
              <button
                type="button"
                onClick={() => void handleRunFailing()}
                disabled={!framework || !hasFailing}
                data-testid="test-runner-run-failing"
                className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 px-3 py-1.5 text-xs text-warning transition-colors hover:bg-warning/10 disabled:opacity-50"
              >
                <RotateCcw size={12} />
                {t('testRunner.runFailing', 'Re-run failing')}
              </button>
            </>
          )}
          <div className="ml-auto flex items-center gap-2 text-[11px] text-text-muted">
            <span className="tabular-nums" data-testid="test-runner-visible-count">
              {t('testRunner.visibleCount', '{{visible}}/{{total}} visible', {
                visible: filteredCatalog.length,
                total: catalog.length,
              })}
            </span>
            <span className="tabular-nums text-success">{catalogSummary.passed} ok</span>
            <span className="tabular-nums text-error">{catalogSummary.failed} ko</span>
            <span className="tabular-nums">{catalogSummary.pending} pending</span>
          </div>
        </div>

        <div className="mt-3 space-y-2" data-testid="test-runner-catalog-filters">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={catalogQuery}
              onChange={(event) => setCatalogQuery(event.target.value)}
              placeholder={t(
                'testRunner.catalogSearchPlaceholder',
                'Search catalog by bundle, group, command, or environment...'
              )}
              className="w-full rounded-md border border-border-subtle bg-background py-1.5 pl-8 pr-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
              data-testid="test-runner-catalog-search"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {catalogModeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setCatalogMode(option.value)}
                data-testid={`test-runner-filter-${option.value}`}
                className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                  catalogMode === option.value
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border-muted text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }`}
              >
                {option.label}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-[11px] text-text-muted">
              {t('testRunner.kindFilterLabel', 'Type')}
              <select
                value={catalogKind}
                onChange={(event) => setCatalogKind(event.target.value as CatalogKindFilter)}
                className="rounded-md border border-border-subtle bg-background px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
                data-testid="test-runner-kind-filter"
              >
                {catalogKindOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 border-t border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="flex border-b border-border-muted px-4 pt-2">
        <button
          type="button"
          onClick={() => setActiveTab('tests')}
          data-testid="test-runner-tests-tab"
          className={`border-b-2 px-3 py-2 text-xs transition-colors ${
            activeTab === 'tests'
              ? 'border-accent text-text-primary'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          {t('testRunner.testsTab', 'Tests')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('executions')}
          data-testid="test-runner-executions-tab"
          className={`border-b-2 px-3 py-2 text-xs transition-colors ${
            activeTab === 'executions'
              ? 'border-accent text-text-primary'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          {t('testRunner.executionsTab', 'Executions')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('coverage')}
          data-testid="test-runner-coverage-tab"
          className={`border-b-2 px-3 py-2 text-xs transition-colors ${
            activeTab === 'coverage'
              ? 'border-accent text-text-primary'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          {t('testRunner.coverageTab', 'Coverage')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'tests' ? (
          <div className="grid h-full min-h-0 grid-cols-[1fr_300px]">
            <div className="min-h-0 overflow-y-auto border-r border-border-muted">
              {groupedCatalog.length === 0 ? (
                <div className="px-4 py-6 text-sm text-text-muted">
                  {t('testRunner.noCatalog', 'No runnable checks found for this workspace.')}
                </div>
              ) : (
                groupedCatalog.map(([group, items]) => (
                  <section key={group} className="border-b border-border-muted">
                    <div className="flex items-center justify-between bg-background-secondary/70 px-4 py-2">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                        {group}
                      </h3>
                      <span className="text-[10px] text-text-muted tabular-nums">
                        {items.length}
                      </span>
                    </div>
                    {items.map((item) => {
                      const state = itemStates[item.id];
                      const status = state?.status ?? 'pending';
                      const isActive = activeItemId === item.id;
                      return (
                        <div
                          key={item.id}
                          data-testid={`test-catalog-row-${item.id}`}
                          className={`border-t border-border-muted px-4 py-3 transition-colors ${
                            isActive ? 'bg-accent/5' : 'hover:bg-surface-hover/50'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <span
                              data-testid={`test-catalog-status-${item.id}`}
                              aria-label={status}
                              className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${statusClass(
                                status
                              )}`}
                            >
                              {statusIcon(status)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="truncate text-sm font-medium text-text-primary">
                                  {item.label}
                                </div>
                                {!item.safeToRun && (
                                  <span className="shrink-0 rounded border border-warning/30 px-1.5 py-0.5 text-[10px] text-warning">
                                    manual
                                  </span>
                                )}
                                {item.kind === 'real-provider' && (
                                  <span className="shrink-0 rounded border border-accent/30 px-1.5 py-0.5 text-[10px] text-accent">
                                    real
                                  </span>
                                )}
                                {item.requiresEnv && (
                                  <span
                                    className="shrink-0 rounded border border-border-muted px-1.5 py-0.5 font-mono text-[10px] text-text-muted"
                                    title={t(
                                      'testRunner.requiresEnv',
                                      'Runs with required environment flag'
                                    )}
                                  >
                                    {item.requiresEnv}
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 truncate text-[11px] text-text-muted">
                                {item.description}
                              </div>
                              <div className="mt-1 truncate font-mono text-[10px] text-text-muted">
                                {commandPreview(item)}
                              </div>
                              {state?.result?.tests?.[0]?.error && (
                                <pre className="mt-2 max-h-20 overflow-y-auto whitespace-pre-wrap rounded border border-error/20 bg-error/5 p-2 font-mono text-[10px] text-error">
                                  {state.result.tests[0].error}
                                </pre>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {state?.result && (
                                <span
                                  data-testid={`test-catalog-result-${item.id}`}
                                  className="text-[10px] text-text-muted tabular-nums"
                                >
                                  {state.result.passed} ok / {state.result.failed} ko
                                </span>
                              )}
                              <span className="text-[10px] text-text-muted tabular-nums">
                                {formatDuration(state?.result?.duration)}
                              </span>
                              <button
                                type="button"
                                onClick={() => void handleRunCatalogItem(item)}
                                disabled={isRunning}
                                data-testid={`test-catalog-run-${item.id}`}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                                aria-label={t('testRunner.runItem', 'Run check')}
                                title={t('testRunner.runItem', 'Run check')}
                              >
                                <Play size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </section>
                ))
              )}
            </div>

            <div className="flex min-h-0 flex-col">
              {result && (
                <div className="border-b border-border-muted px-4 py-3">
                  <div className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1 text-success">
                      <CheckCircle2 size={12} />{' '}
                      <span data-testid="test-runner-result-passed">{result.passed}</span>
                    </span>
                    <span className="flex items-center gap-1 text-error">
                      <XCircle size={12} />{' '}
                      <span data-testid="test-runner-result-failed">{result.failed}</span>
                    </span>
                    <span className="flex items-center gap-1 text-text-muted">
                      <MinusCircle size={12} />{' '}
                      <span data-testid="test-runner-result-skipped">{result.skipped}</span>
                    </span>
                    <span className="ml-auto text-text-muted tabular-nums">
                      {formatDuration(result.duration)}
                    </span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface">
                    {result.total > 0 && (
                      <div className="flex h-full">
                        <div
                          className="bg-success"
                          style={{ width: `${(result.passed / result.total) * 100}%` }}
                        />
                        <div
                          className="bg-error"
                          style={{ width: `${(result.failed / result.total) * 100}%` }}
                        />
                        <div
                          className="bg-text-muted"
                          style={{ width: `${(result.skipped / result.total) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="border-b border-border-muted px-4 py-1 text-[11px] uppercase tracking-wide text-text-muted">
                {t('testRunner.output', 'Output')}
              </div>
              <pre
                ref={outputRef}
                data-testid="test-runner-output"
                className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap"
              >
                {output || t('testRunner.noOutput', 'No output yet. Run a check to start.')}
                {isRunning && (
                  <span className="mt-2 inline-flex items-center gap-1 text-accent">
                    <Loader2 size={10} className="animate-spin" />
                    {t('testRunner.running', 'Running...')}
                  </span>
                )}
              </pre>
            </div>
          </div>
        ) : activeTab === 'executions' ? (
          <div className="h-full overflow-y-auto" data-testid="test-runner-executions-list">
            {runs.length === 0 ? (
              <div className="px-4 py-6 text-sm text-text-muted">
                {t('testRunner.noExecutions', 'No recent executions found.')}
              </div>
            ) : (
              runs.map((run) => (
                <div key={run.runId} className="border-b border-border-muted px-4 py-3">
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${statusClass(
                        run.status
                      )}`}
                    >
                      {statusIcon(run.status)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-text-primary">
                        {run.objective || run.runId}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted">
                        <span className="font-mono">{run.runId}</span>
                        <span>{formatTime(run.startedAt)}</span>
                        <span>{formatDuration(run.durationMs)}</span>
                        <span>{run.eventCount} events</span>
                        <span>{run.toolCallCount ?? 0} tools</span>
                        {run.source && <span>{run.source}</span>}
                        {run.channel && <span>{run.channel}</span>}
                      </div>
                      {run.tags && run.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {run.tags.slice(0, 6).map((tag) => (
                            <span
                              key={tag}
                              className="rounded border border-border-muted px-1.5 py-0.5 text-[10px] text-text-muted"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${statusClass(
                        run.status
                      )}`}
                    >
                      {run.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="h-full overflow-y-auto" data-testid="test-runner-coverage-list">
            <div className="border-b border-border-muted bg-background-secondary/60 px-4 py-3">
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-text-muted">
                    {t('testRunner.coverageTotal', 'Features')}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
                    {coverageSummary.total}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-text-muted">
                    {t('testRunner.coverageReal', 'Real')}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-accent tabular-nums">
                    {coverageSummary.real}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-text-muted">
                    {t('testRunner.coverageUsed', 'Used')}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-success tabular-nums">
                    {coverageSummary.used}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-text-muted">
                    {t('testRunner.coveragePartial', 'Partial')}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-warning tabular-nums">
                    {coverageSummary.partial}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-text-muted">
                {t(
                  'testRunner.coverageHint',
                  'A feature is marked used only when a test manipulates it and checks an output, state, or external result.'
                )}
              </p>
            </div>

            {functionalCoverage.map((item) => (
              <div
                key={item.id}
                data-testid={`test-coverage-row-${item.id}`}
                className="border-b border-border-muted px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-label={item.status}
                    className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${coverageStatusClass(
                      item.status
                    )}`}
                  >
                    {item.status === 'passed' ? (
                      <CheckCircle2 size={13} />
                    ) : item.status === 'blocked' ? (
                      <AlertCircle size={13} />
                    ) : (
                      <MinusCircle size={13} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-sm font-medium text-text-primary">
                        {item.feature}
                      </div>
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${coverageLevelClass(
                          item.level
                        )}`}
                      >
                        {t(`testRunner.coverageLevel.${item.level}`, item.level)}
                      </span>
                      <span
                        className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${coverageStatusClass(
                          item.status
                        )}`}
                      >
                        {t(`testRunner.coverageStatus.${item.status}`, item.status)}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-text-secondary">{item.proof}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-muted">
                      <span>{item.surface}</span>
                      <span className="font-mono">{item.evidence}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
