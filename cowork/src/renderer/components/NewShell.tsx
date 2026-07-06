/**
 * NewShell — the opt-in redesigned Cowork shell (behind COWORK_NEW_SHELL). See cowork/REDESIGN.md.
 *
 * Slice 1: prove the calm information architecture without breaking anything. One thin rail drives a
 * single `primaryView` (replacing the ~44 `show*` overlay flags): Chat is the home (DockWorkspace
 * already shows the WelcomeView when no session is active), Activity/Workspace reuse the existing
 * overlays, and Advanced is a progressive-disclosure launcher into the current panels. Everything
 * dense stays one click away but out of sight until asked for.
 *
 * The old shell (ShellNavigation + DockWorkspace) is unchanged and still the default; App.tsx only
 * renders NewShell when `newShellEnabled` is set.
 */
import { useAppStore } from '../store';
import type { PrimaryView } from '../store';
import { DockWorkspace } from './DockWorkspace';
import { ActivityPane } from './ActivityPane';
import { PlanPanel } from './PlanPanel';
import { FileActivityPanel } from './FileActivityPanel';
import { HomeView } from './HomeView';
import { useCallback, useEffect, useMemo } from 'react';
import { AppStudioView } from './studio/AppStudioView';
import { useAppStudio } from './studio/use-app-studio';
import { sessionToStudioMessages } from './studio/studio-chat-adapter';
import { buildDevPlan, advancePlan, latestLlmPlan } from './studio/dev-plan';
import { changedFilesFromTrace } from './studio/trace-changes';
import { latestWebTestReport } from './studio/web-test-report-model';
import { createStudioApis } from './studio/studio-api-bridge';
import type { StudioScaffoldRequest } from './studio/StudioComposer';
import { buildAiGenerationPrompt } from './studio/studio-ai-generation';
import { useIPC } from '../hooks/useIPC';
import { getInitialSessionTitle } from '../../shared/session-title';
import { MissionControlView } from './os/MissionControlView';
import { LabsGallery } from './labs/LabsGallery';
import { CreationsView } from './deliverables/CreationsView';

interface RailItem {
  view: PrimaryView;
  label: string;
  glyph: string;
}

const RAIL: RailItem[] = [
  { view: 'chat', label: 'Chat', glyph: '💬' },
  { view: 'plan', label: 'Plan', glyph: '📋' },
  { view: 'activity', label: 'Activité', glyph: '📊' },
  { view: 'workspace', label: 'Fichiers', glyph: '📁' },
  { view: 'studio', label: 'App Studio', glyph: '🛠️' },
  { view: 'creations', label: 'Créations', glyph: '✨' },
  { view: 'os', label: 'Mission Control', glyph: '🛰️' },
  { view: 'labs', label: 'Labs', glyph: '🧪' },
  { view: 'advanced', label: 'Avancé', glyph: '⚙️' },
];

interface LauncherCard {
  label: string;
  hint: string;
  open: () => void;
}

function CardGrid({ cards }: { cards: LauncherCard[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {cards.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={c.open}
          className="text-left rounded-lg border border-border bg-background hover:bg-accent transition-colors p-3"
        >
          <div className="font-medium">{c.label}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{c.hint}</div>
        </button>
      ))}
    </div>
  );
}

/**
 * Progressive-disclosure launcher: the power-user surfaces, out of the default flow. Split into
 * "Avancé" (stable power-user tools) and "Labs" (dense / experimental / competitor-parity surfaces),
 * so a first-time user isn't confronted with the fleet mesh and parity strips next to Settings.
 */
function AdvancedLauncher() {
  const s = useAppStore();
  const advanced: LauncherCard[] = [
    { label: 'Réglages', hint: 'Modèles, clés, MCP, workspace', open: () => s.setShowSettings(true) },
    { label: 'Mémoire', hint: 'Ce que Code Buddy retient', open: () => s.setShowMemoryEditor(true) },
    { label: 'Skills', hint: 'Docs Office, charts, recherche', open: () => s.setShowSkillsManager(true) },
    { label: 'Companion', hint: 'Voix, présence, canaux', open: () => s.setShowCompanionPanel(true) },
    { label: 'Autonomie', hint: 'Boucle autonome, YOLO', open: () => s.setShowAutonomyPanel(true) },
    { label: 'Recherche', hint: 'Recherche large + flow de planification', open: () => s.setShowLiveLauncher(true) },
    { label: 'Tests', hint: 'Lancer la suite de tests', open: () => s.setShowTestRunner(true) },
    { label: 'Insights', hint: 'Analyse de session', open: () => s.setShowSessionInsights(true) },
  ];
  const labs: LauncherCard[] = [
    {
      label: 'Deep Research',
      hint: 'Recherche multi-sources, cité — rapport avec références',
      open: () => {
        s.setLiveLauncherDeepIntent(true);
        s.setShowLiveLauncher(true);
      },
    },
    { label: 'Connaissances', hint: 'Mémoire collective (CKG) + sujets de recherche', open: () => s.setShowKnowledgePanel(true) },
    { label: 'Évolution', hint: 'Versions générées par l’auto-amélioration', open: () => s.setShowEvolutionPanel(true) },
    { label: 'AI-Scientist', hint: 'Expériences `buddy science` (lecture seule)', open: () => s.setShowSciencePanel(true) },
    { label: 'Fleet', hint: 'Multi-agents, pairs, routage', open: () => s.setShowFleetCommandCenter(true) },
    { label: 'Missions', hint: 'Tableau des tâches multi-agents', open: () => s.setShowMissionBoard(true) },
    { label: 'Workflows', hint: 'Éditeur de workflow visuel', open: () => s.setShowWorkflowProPanel(true) },
    { label: 'Migration Claw', hint: 'Import OpenClaw / parité', open: () => s.setShowClawMigration(true) },
  ];
  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      <section>
        <h2 className="text-lg font-semibold mb-1">Avancé</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Les surfaces puissantes de Code Buddy — hors du chemin par défaut, à un clic.
        </p>
        <CardGrid cards={advanced} />
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-1">
          Labs <span className="text-xs font-normal text-muted-foreground">· expérimental</span>
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Orchestration multi-agents et surfaces de parité — denses, pour quand tu en as besoin.
        </p>
        <CardGrid cards={labs} />
      </section>
    </div>
  );
}

/**
 * App Studio (bolt.diy-style: file tree + editor + terminal + live preview) as a
 * full-screen primaryView. The preload-backed APIs are built once from
 * window.electronAPI.studio; with no project selected the view renders its own
 * calm empty state ("Décris une app pour commencer").
 */
function StudioView() {
  const apis = useMemo(() => createStudioApis(), []);
  const activeSessionId = useAppStore((st) => st.activeSessionId);
  const sessions = useAppStore((st) => st.sessions);
  const sessionStates = useAppStore((st) => st.sessionStates);
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const sessionCwd = activeSession?.cwd ?? '';
  // Point the workbench at the active project session's dir so files/preview
  // populate as the app is generated (bolt.new-style unified workspace).
  // platform picks the static-serve python binary (win32 → python).
  const { viewProps, actions } = useAppStudio({
    apis,
    projectRoot: sessionCwd,
    platform: window.electronAPI?.platform ?? 'linux',
  });
  const { startSession, continueSession, getSessionMessages, getSessionTraceSteps } = useIPC();
  const setActiveSession = useAppStore((st) => st.setActiveSession);
  const setMessages = useAppStore((st) => st.setMessages);
  const setTraceSteps = useAppStore((st) => st.setTraceSteps);
  const workingDir = useAppStore((st) => st.workingDir);

  // Hydrate a COLD session from the DB (after an app reload, sessionStates
  // starts empty — only live events fill it). Without this the bolt split
  // loses the LLM plan (```plan block in a persisted assistant message), the
  // verify card (web_test in persisted trace steps) and the changed files.
  useEffect(() => {
    if (!activeSessionId || !sessionCwd) return;
    const state = useAppStore.getState().sessionStates[activeSessionId];
    if (state?.messages?.length || state?.activeTurn) return; // live or already hydrated
    void Promise.all([
      getSessionMessages(activeSessionId),
      getSessionTraceSteps(activeSessionId),
    ]).then(([messages, steps]) => {
      const current = useAppStore.getState().sessionStates[activeSessionId];
      if (current?.activeTurn) return; // a live turn started meanwhile — don't clobber
      if (messages?.length && !current?.messages?.length) setMessages(activeSessionId, messages);
      if (steps?.length && !current?.traceSteps?.length) setTraceSteps(activeSessionId, steps);
    });
  }, [activeSessionId, sessionCwd, getSessionMessages, getSessionTraceSteps, setMessages, setTraceSteps]);

  // Refresh the file tree as the agent writes files: the initial load happens
  // before generation, so without this the workbench stays on "les fichiers
  // apparaîtront ici" even once index.html exists (seen live on e2e-meteo5).
  // `actions.refreshTree` is the hook's stable useCallback (the `actions`
  // object itself is re-created per render — don't depend on it).
  const refreshTree = actions.refreshTree;
  const st = activeSessionId ? sessionStates[activeSessionId] : undefined;
  const turnActive = Boolean(st?.activeTurn);
  const traceCount = st?.traceSteps?.length ?? 0;
  useEffect(() => {
    if (!sessionCwd) return;
    // New tool steps / turn end = files may have changed on disk.
    void refreshTree(sessionCwd);
  }, [sessionCwd, traceCount, turnActive, refreshTree]);

  // AI generation: start a project-scoped agent session and STAY in App Studio —
  // the bolt.new split shows the chat (left) driving the workbench (right) live.
  // memoryEnabled=true so the build taps Code Buddy's cross-session memory
  // (remembered stack/design preferences) — App Studio isn't a silo.
  const onGenerateWithAI = useCallback(
    async (request: StudioScaffoldRequest) => {
      const prompt = buildAiGenerationPrompt(request);
      const cwd = request.targetDir?.trim() || workingDir || undefined;
      const session = await startSession(getInitialSessionTitle(request.prompt), prompt, cwd, null, true);
      if (session?.id) setActiveSession(session.id);
    },
    [startSession, setActiveSession, workingDir],
  );

  // "Vérifier" taps Code Buddy's web_test through the agent session (which owns
  // the tool + the browser; the preview origin is already a registered dev
  // origin via app_server). The verify report lands in the chat.
  const onVerifyPreview = useCallback(() => {
    const url = viewProps.previewUrl;
    if (!activeSessionId || !url) return;
    void continueSession(
      activeSessionId,
      `Vérifie l'application web sur ${url} avec l'outil \`web_test\` : lance web_test avec cette URL, ` +
        `confirme qu'il n'y a aucune erreur console ni erreur de page et que l'interface principale s'affiche, ` +
        `puis résume le rapport (PASSED/FAILED + points clés). Corrige si tu détectes une erreur. ` +
        `Si \`web_test\` n'apparaît pas dans tes outils, appelle d'abord \`tool_search\` avec "web_test" pour le charger — ` +
        `n'écris PAS ton propre script navigateur (le rapport web_test alimente la carte de vérification de l'interface).`,
    );
  }, [activeSessionId, viewProps.previewUrl, continueSession]);

  // The bolt.new iterate chat, driven by the active project session (a session
  // with a cwd). Absent → App Studio shows its composer entry screen.
  const chat = useMemo(() => {
    if (!activeSessionId || !sessionCwd) return undefined;
    const st = sessionStates[activeSessionId];
    // bolt.new's "plan" step: prefer the plan the AGENT emitted (the ```plan
    // block asked by buildAiGenerationPrompt — specific to this app), fall back
    // to the deterministic plan derived from the prompt; then advance its steps
    // from the real project state (files present, preview running, building).
    const busy = Boolean(st?.activeTurn);
    const changes = changedFilesFromTrace(st?.traceSteps ?? []);
    // Latest web_test verification (the "Vérifier" button / the agent's own
    // check) rendered as a PASSED/FAILED card under the chat.
    const verifyReport = latestWebTestReport(st?.traceSteps ?? []);
    const llmPlan = latestLlmPlan(st?.messages ?? [], st?.partialMessage);
    const plan = advancePlan(llmPlan ?? buildDevPlan(activeSession?.title ?? ''), {
      hasFiles: viewProps.tree.length > 0,
      previewRunning: viewProps.previewStatus === 'running',
      busy,
      changedPaths: changes.map((c) => c.path),
    });
    return {
      messages: sessionToStudioMessages(st?.messages ?? [], {
        running: busy,
        ...(st?.partialMessage ? { partial: st.partialMessage } : {}),
      }),
      busy,
      suggestions: ['Change le thème', 'Ajoute un mode sombre', 'Rends-le responsive'],
      plan,
      changes,
      verifyReport,
      onSend: (text: string) => {
        void continueSession(activeSessionId, text);
      },
    };
  }, [
    activeSessionId,
    sessionCwd,
    sessionStates,
    continueSession,
    activeSession?.title,
    viewProps.tree.length,
    viewProps.previewStatus,
  ]);

  return (
    <AppStudioView
      {...viewProps}
      onGenerateWithAI={onGenerateWithAI}
      onVerifyPreview={onVerifyPreview}
      onNewApp={() => setActiveSession(null)}
      {...(chat ? { chat } : {})}
    />
  );
}

export function NewShell() {
  const primaryView = useAppStore((st) => st.primaryView);
  const setPrimaryView = useAppStore((st) => st.setPrimaryView);
  const setShowCommandPalette = useAppStore((st) => st.setShowCommandPalette);
  const setShowShortcutsDialog = useAppStore((st) => st.setShowShortcutsDialog);
  const activeSessionId = useAppStore((st) => st.activeSessionId);
  const { getSessionMessages, getSessionTraceSteps } = useIPC();
  const setMessages = useAppStore((st) => st.setMessages);
  const setTraceSteps = useAppStore((st) => st.setTraceSteps);
  const backToChat = () => setPrimaryView('chat');

  // Hydrate ANY cold session from the DB — resuming from Home after a reload
  // showed « Démarrez la conversation » on a session full of persisted
  // messages (StudioView had this; the chat view did not). Same guards: never
  // clobber a live turn or an already-hydrated state.
  useEffect(() => {
    if (!activeSessionId) return;
    const state = useAppStore.getState().sessionStates[activeSessionId];
    if (state?.messages?.length || state?.activeTurn) return;
    void Promise.all([
      getSessionMessages(activeSessionId),
      getSessionTraceSteps(activeSessionId),
    ]).then(([messages, steps]) => {
      const current = useAppStore.getState().sessionStates[activeSessionId];
      if (current?.activeTurn) return;
      if (messages?.length && !current?.messages?.length) setMessages(activeSessionId, messages);
      if (steps?.length && !current?.traceSteps?.length) setTraceSteps(activeSessionId, steps);
    });
  }, [activeSessionId, getSessionMessages, getSessionTraceSteps, setMessages, setTraceSteps]);
  // Chat with no active session → the calm Home center-of-gravity, not the
  // dense workspace (REDESIGN.md § Home).
  const showHome = primaryView === 'chat' && !activeSessionId;

  return (
    <div className="h-full min-h-0 flex overflow-hidden bg-background" data-testid="new-shell">
      {/* Thin rail — one calm nav, not three. */}
      <nav className="w-16 shrink-0 border-r border-border flex flex-col items-stretch py-2 gap-1">
        {RAIL.map((item) => {
          const active = primaryView === item.view;
          return (
            <button
              key={item.view}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => setPrimaryView(item.view)}
              title={item.label}
              className={`flex flex-col items-center gap-0.5 py-2 mx-1 rounded-md text-[10px] transition-colors ${
                active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
              }`}
            >
              <span className="text-lg leading-none">{item.glyph}</span>
              <span>{item.label}</span>
            </button>
          );
        })}

        {/* Footer: the discoverability net. ⌘K reaches every capability; "?" lists all shortcuts. */}
        <div className="mt-auto flex flex-col items-stretch gap-1">
          <button
            type="button"
            onClick={() => setShowCommandPalette(true)}
            title="Palette de commandes (⌘K) — atteindre n'importe quelle fonctionnalité"
            className="flex flex-col items-center gap-0.5 py-2 mx-1 rounded-md text-[10px] text-muted-foreground hover:bg-accent/60 transition-colors"
          >
            <span className="text-sm leading-none font-mono">⌘K</span>
            <span>Palette</span>
          </button>
          <button
            type="button"
            onClick={() => setShowShortcutsDialog(true)}
            title="Raccourcis clavier (⌘/)"
            aria-label="Raccourcis clavier"
            className="flex flex-col items-center gap-0.5 py-2 mx-1 rounded-md text-[10px] text-muted-foreground hover:bg-accent/60 transition-colors"
          >
            <span className="text-lg leading-none">?</span>
            <span>Aide</span>
          </button>
        </div>
      </nav>

      {/* Primary area */}
      <div className="flex-1 min-w-0 min-h-0 relative">
        {/* Home greets when Chat has no session; DockWorkspace stays mounted
            (but hidden) so an active session isn't torn down when peeking. */}
        {showHome && (
          <div className="absolute inset-0">
            <HomeView />
          </div>
        )}
        <div className={`absolute inset-0 ${primaryView === 'chat' && !showHome ? '' : 'hidden'}`}>
          <DockWorkspace />
        </div>
        {primaryView === 'plan' && <PlanPanel />}
        {primaryView === 'activity' && <ActivityPane />}
        {primaryView === 'workspace' && <FileActivityPanel open onClose={backToChat} />}
        {primaryView === 'studio' && <StudioView />}
        {primaryView === 'creations' && <CreationsView />}
        {primaryView === 'os' && <MissionControlView />}
        {primaryView === 'labs' && <LabsGallery />}
        {primaryView === 'advanced' && <AdvancedLauncher />}
      </div>
    </div>
  );
}
