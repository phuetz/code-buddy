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
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
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
import { ConversationHistoryDrawer } from './ConversationHistoryDrawer';
import { OnboardingTour } from './onboarding/OnboardingTour';
import { GuidedTooltip } from './Tooltip';
import { CapabilitiesView } from './capabilities/CapabilitiesView';
import { resolveLazyNamedExport } from '../utils/vite-preload-recovery';

const AppStudioView = lazy(() =>
  import('./studio/AppStudioView').then((module) =>
    resolveLazyNamedExport(module, (loaded) => loaded.AppStudioView)
  )
);
const MissionControlView = lazy(() =>
  import('./os/MissionControlView').then((module) =>
    resolveLazyNamedExport(module, (loaded) => loaded.MissionControlView)
  )
);
const LabsGallery = lazy(() =>
  import('./labs/LabsGallery').then((module) =>
    resolveLazyNamedExport(module, (loaded) => loaded.LabsGallery)
  )
);
const CreationsView = lazy(() =>
  import('./deliverables/CreationsView').then((module) =>
    resolveLazyNamedExport(module, (loaded) => loaded.CreationsView)
  )
);
const MediaLibraryView = lazy(() =>
  import('./deliverables/MediaLibraryView').then((module) =>
    resolveLazyNamedExport(module, (loaded) => loaded.MediaLibraryView)
  )
);
const VideoStudioView = lazy(() =>
  import('./videostudio/VideoStudioView').then((module) =>
    resolveLazyNamedExport(module, (loaded) => loaded.VideoStudioView)
  )
);
const AssistantView = lazy(() =>
  import('./assistant/AssistantView').then((module) =>
    resolveLazyNamedExport(module, (loaded) => loaded.AssistantView)
  )
);
const MeetingLiveView = lazy(() =>
  import('./MeetingLiveView').then((module) =>
    resolveLazyNamedExport(module, (loaded) => loaded.MeetingLiveView)
  )
);
const AdvancedCommandCenter = lazy(() =>
  import('./advanced/AdvancedCommandCenter').then((module) =>
    resolveLazyNamedExport(module, (loaded) => loaded.AdvancedCommandCenter)
  )
);

interface RailItem {
  view: PrimaryView;
  label: string;
  glyph: string;
  help: string;
}

const RAIL: RailItem[] = [
  {
    view: 'chat',
    label: 'Chat',
    glyph: '💬',
    help: 'Discute avec Code Buddy, joins des fichiers et transforme une demande en action.',
  },
  {
    view: 'plan',
    label: 'Plan',
    glyph: '📋',
    help: 'Décompose une mission en étapes lisibles avant de laisser l’agent exécuter.',
  },
  {
    view: 'activity',
    label: 'Activité',
    glyph: '📊',
    help: 'Observe les outils, fichiers, modèles et décisions produits pendant la session.',
  },
  {
    view: 'workspace',
    label: 'Fichiers',
    glyph: '📁',
    help: 'Explore les fichiers du projet et ouvre les artefacts générés par les agents.',
  },
  {
    view: 'studio',
    label: 'App Studio',
    glyph: '🛠️',
    help: 'Construis une application avec une boucle de génération, test et amélioration.',
  },
  {
    view: 'creations',
    label: 'Créations',
    glyph: '✨',
    help: 'Retrouve tes livrables : documents, feuilles, présentations et exports.',
  },
  {
    view: 'videostudio',
    label: 'Video Studio',
    glyph: '🎬',
    help: 'Prépare un storyboard, génère des scènes et assemble une vidéo vérifiable.',
  },
  {
    view: 'assistant',
    label: 'Assistant',
    glyph: '🎙️',
    help: 'Configure le mode vocal temps réel, Pocket TTS, le volume et les interruptions.',
  },
  {
    view: 'meeting',
    label: 'Réunion',
    glyph: '📝',
    help: 'Enregistre une réunion locale avec consentement, checkpoints récupérables et notes automatiques.',
  },
  {
    view: 'library',
    label: 'Bibliothèque',
    glyph: '🖼️',
    help: 'Consulte les médias et ressources réutilisables du workspace.',
  },
  {
    view: 'capabilities',
    label: 'Capacités',
    glyph: '🧰',
    help: 'Active les skills, outils, serveurs MCP et providers disponibles pour l’agent.',
  },
  {
    view: 'os',
    label: 'Mission Control',
    glyph: '🛰️',
    help: 'Pilote le loop 2.0 : Constitution, Exchange multi-LLM, Shadow Twin et preuves.',
  },
  {
    view: 'labs',
    label: 'Labs',
    glyph: '🧪',
    help: 'Découvre les fonctionnalités expérimentales et les nouveaux modes d’orchestration.',
  },
  {
    view: 'advanced',
    label: 'Avancé',
    glyph: '⚙️',
    help: 'Accède aux réglages experts, à la supervision et aux intégrations avancées.',
  },
];

const THEME_OPTIONS = [
  { value: 'light', label: 'Clair', glyph: '☀️' },
  { value: 'dark', label: 'Sombre', glyph: '🌙' },
  { value: 'system', label: 'Système', glyph: '🖥️' },
  { value: 'ember', label: 'Ember', glyph: '🔥' },
  { value: 'genspark', label: 'Genspark', glyph: '✨' },
  { value: 'codex', label: 'Codex', glyph: '◼️' },
  { value: 'anthropic', label: 'Anthropic', glyph: '🟠' },
] as const;

function themeGlyph(theme: string): string {
  return THEME_OPTIONS.find((option) => option.value === theme)?.glyph ?? '🎨';
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
  }, [
    activeSessionId,
    sessionCwd,
    getSessionMessages,
    getSessionTraceSteps,
    setMessages,
    setTraceSteps,
  ]);

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
      const cwd = request.targetDir?.trim() || workingDir || undefined;
      const materialized = request.assetIds?.length && cwd
        ? await window.electronAPI?.creativeAssets?.materialize({ ids: request.assetIds, targetRoot: cwd, stack: request.stack })
        : undefined;
      const enrichedRequest = materialized?.ok && materialized.assets
        ? { ...request, materializedAssets: materialized.assets }
        : request;
      const prompt = buildAiGenerationPrompt(enrichedRequest);
      const session = await startSession(
        getInitialSessionTitle(request.prompt),
        prompt,
        cwd,
        null,
        true
      );
      if (session?.id) setActiveSession(session.id);
    },
    [startSession, setActiveSession, workingDir]
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
        `n'écris PAS ton propre script navigateur (le rapport web_test alimente la carte de vérification de l'interface).`
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
  const theme = useAppStore((st) => st.settings.theme);
  const updateSettings = useAppStore((st) => st.updateSettings);
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const backToChat = () => setPrimaryView('chat');

  useEffect(() => {
    if (!themePickerOpen) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setThemePickerOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [themePickerOpen]);

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
      <nav className="flex w-16 shrink-0 flex-col items-stretch border-r border-border py-2">
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain">
          {RAIL.map((item) => {
            const active = primaryView === item.view;
            return (
              <GuidedTooltip
                key={item.view}
                title={item.label}
                description={item.help}
                kicker="Espace Cowork"
                side="right"
              >
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setPrimaryView(item.view)}
                  title={item.label}
                  className={`mx-1 flex flex-col items-center gap-0.5 rounded-md py-2 text-[10px] transition-colors ${
                    active
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/60'
                  }`}
                >
                  <span className="text-lg leading-none">{item.glyph}</span>
                  <span>{item.label}</span>
                </button>
              </GuidedTooltip>
            );
          })}
        </div>

        {/* Footer: the discoverability net. ⌘K reaches every capability; "?" lists all shortcuts. */}
        <div className="shrink-0 border-t border-border/70 pt-1">
          <GuidedTooltip
            title="Historique"
            description="Retrouve une session précédente, ses messages et ses preuves sans quitter ton workspace."
            kicker="Navigation"
            side="right"
          >
            <button
              type="button"
              onClick={() => useAppStore.getState().setShowConversationHistory(true)}
              title="Historique des conversations"
              className="mx-1 flex flex-col items-center gap-0.5 rounded-md py-1 text-[10px] text-muted-foreground transition-colors hover:bg-accent/60"
              data-testid="rail-history"
            >
              <span className="text-base leading-none">🕘</span>
              <span>Historique</span>
            </button>
          </GuidedTooltip>
          <div className="grid grid-cols-3 gap-0.5 px-1 pt-1">
          <div className="relative">
            <button
              type="button"
              onClick={() => setThemePickerOpen((open) => !open)}
              title="Choisir le thème de l’application"
              aria-label="Choisir le thème"
              aria-haspopup="menu"
              aria-expanded={themePickerOpen}
              className="flex h-9 w-full items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60"
              data-testid="rail-theme"
            >
              <span className="text-base leading-none" aria-hidden="true">
                {themeGlyph(theme)}
              </span>
            </button>
            {themePickerOpen && (
              <div
                role="menu"
                aria-label="Choisir le thème"
                className="absolute bottom-0 left-full z-50 ml-2 w-52 overflow-hidden rounded-xl border border-border bg-surface p-2 shadow-xl"
                data-testid="theme-picker"
              >
                <div className="px-2 pb-2 pt-1 text-xs font-semibold text-foreground">
                  Apparence
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {THEME_OPTIONS.map((option) => {
                    const selected = theme === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        onClick={() => {
                          updateSettings({ theme: option.value });
                          setThemePickerOpen(false);
                        }}
                        className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                          selected
                            ? 'border-accent bg-accent/10 text-foreground'
                            : 'border-transparent text-muted-foreground hover:border-border hover:bg-accent/50 hover:text-foreground'
                        }`}
                        data-testid={`theme-option-${option.value}`}
                      >
                        <span aria-hidden="true">{option.glyph}</span>
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowCommandPalette(true)}
            title="Palette de commandes (⌘K) — atteindre n'importe quelle fonctionnalité"
            aria-label="Palette de commandes"
            className="flex h-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60"
          >
            <span className="text-xs leading-none font-mono" aria-hidden="true">
              ⌘K
            </span>
          </button>
          <button
            type="button"
            onClick={() => setShowShortcutsDialog(true)}
            title="Raccourcis clavier (⌘/)"
            aria-label="Raccourcis clavier"
            className="flex h-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60"
          >
            <span className="text-base leading-none" aria-hidden="true">
              ?
            </span>
          </button>
          </div>
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
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Chargement…
            </div>
          }
        >
          {primaryView === 'studio' && <StudioView />}
          {primaryView === 'creations' && <CreationsView />}
          {primaryView === 'videostudio' && <VideoStudioView />}
          {primaryView === 'assistant' && <AssistantView />}
          {primaryView === 'meeting' && <MeetingLiveView />}
          {primaryView === 'library' && <MediaLibraryView />}
          {primaryView === 'capabilities' && <CapabilitiesView />}
          {primaryView === 'os' && <MissionControlView />}
          {primaryView === 'labs' && <LabsGallery />}
          {primaryView === 'advanced' && <AdvancedCommandCenter />}
        </Suspense>
      </div>
      <ConversationHistoryDrawer />
      <OnboardingTourHost />
    </div>
  );
}

/**
 * OnboardingTourHost — shows the tour on FIRST launch (localStorage latch)
 * and whenever ⌘K « Visite guidée » flips the store flag.
 */
function OnboardingTourHost() {
  const show = useAppStore((st) => st.showOnboardingTour);
  const setShow = useAppStore((st) => st.setShowOnboardingTour);
  useEffect(() => {
    if (!localStorage.getItem('cowork.tourSeen')) {
      setShow(true);
    }
  }, [setShow]);
  return (
    <OnboardingTour
      open={show}
      onClose={() => {
        localStorage.setItem('cowork.tourSeen', '1');
        setShow(false);
      }}
    />
  );
}
