import { Suspense, lazy, useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { useAppStore } from './store';
import {
  useActiveSessionId,
  useSettings,
  useSystemDarkMode,
  useSettingsState,
  useLayoutState,
  useConfigModalState,
  useGlobalNotice,
  useSandboxSetupState,
  useSandboxSyncStatus,
  usePendingDialogs,
  useShowCommandPalette,
  useShowShortcutsDialog,
  useUpdateInfo,
} from './store/selectors';
import { useIPC } from './hooks/useIPC';
import { useWindowSize } from './hooks/useWindowSize';
import { useTabPinPersistence } from './hooks/useTabPinPersistence';
import { useAutoBargeIn } from './hooks/useAutoBargeIn';
import { useBargeInTurnCancel } from './hooks/useBargeInTurnCancel';
import { TopMenuBar } from './components/TopMenuBar';
import { PermissionDialog } from './components/PermissionDialog';
import { SudoPasswordDialog } from './components/SudoPasswordDialog';
import { Titlebar } from './components/Titlebar';
import { SandboxSetupDialog } from './components/SandboxSetupDialog';
import { SandboxSyncToast } from './components/SandboxSyncToast';
import { GlobalNoticeToast } from './components/GlobalNoticeToast';
import { PanelErrorBoundary } from './components/PanelErrorBoundary';
import { CommandPalette } from './components/CommandPalette';
import { KeyboardShortcutsDialog } from './components/KeyboardShortcutsDialog';
import { GlobalSearchDialog } from './components/GlobalSearchDialog';
import { SessionPruneDialog } from './components/SessionPruneDialog';
import { FilePreviewPane } from './components/FilePreviewPane';
import { ArtifactPanel } from './components/ArtifactPanel';
import { ComputerUseOverlay } from './components/ComputerUseOverlay';
import { BrowserOperatorOverlay } from './components/BrowserOperatorOverlay';
import { ApprovalDialog } from './components/ApprovalDialog';
import { ActivityFeed } from './components/ActivityFeed';
import { FileActivityPanel } from './components/FileActivityPanel';
import { SessionInsightsPanel } from './components/SessionInsightsPanel';
import { SessionResumeDialog } from './components/SessionResumeDialog';
import { BookmarksPanel } from './components/BookmarksPanel';
import { SnippetsLibrary } from './components/SnippetsLibrary';
import { PersonaSwitcherDialog } from './components/PersonaSwitcherDialog';
import { MemoryPanel } from './components/MemoryPanel';
// AutonomyPanel is lazy loaded below
import { LiveLauncherPanel } from './components/LiveLauncherPanel';
import { FocusView } from './components/FocusView';
import { Group, Panel } from 'react-resizable-panels';
import { UpdateNotification } from './components/UpdateNotification';
import { NotificationToastContainer } from './components/NotificationToast';
import { NotificationCenter } from './components/NotificationCenter';
import { EnrollmentDialog } from './components/EnrollmentDialog';
import { ModelInstallDialog } from './components/ModelInstallDialog';
import { OrchestratorLauncher } from './components/OrchestratorLauncher';
import { FleetPanel } from './components/FleetPanel';
// FleetCommandCenter is lazy loaded below
import { SkillsManagerWrapper } from './components/skills-manager-page';
import { ClawMigrationDialog } from './components/ClawMigrationDialog';
import { KanbanPanel } from './components/KanbanPanel';
import { TeamPanel } from './components/TeamPanel';
import { LessonCandidatePanel } from './components/LessonCandidatePanel';
import { UserModelPanel } from './components/UserModelPanel';
import { SpecPanel } from './components/SpecPanel';
import { MobileSupervisionPanel } from './components/MobileSupervisionPanel';
import { IdentityPanel } from './components/IdentityPanel';
import { DevicePanel } from './components/DevicePanel';
import { ChannelsPanel } from './components/ChannelsPanel';
// CompanionPanel is lazy loaded below
import { MissionBoardPanel } from './components/MissionBoardPanel';
import { DesktopSnapshotPanel } from './components/DesktopSnapshotPanel';
import { OnboardingWizard } from './components/OnboardingWizard';
import { SubAgentDashboard } from './components/SubAgentDashboard';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { BtwQuickAsk } from './components/BtwQuickAsk';
import { PresenceService } from './services/presence/PresenceService';
import { DockWorkspace } from './components/DockWorkspace';
import { ShellNavigation } from './components/ShellNavigation';
import { NewShell } from './components/NewShell';
import { ExportDialogHost } from './components/ExportDialogHost';
import { EvolutionPanel } from './components/EvolutionPanel';
import { WorkflowProPanel } from './components/WorkflowProPanel';
import { KnowledgePanel } from './components/KnowledgePanel';
import { SciencePanel } from './components/SciencePanel';
import { HelpDocs } from './components/HelpDocs';
import type { AppConfig } from './types';
import type { GlobalNoticeAction } from './store';

const ConfigModal = lazy(() =>
  import('./components/ConfigModal').then((module) => ({ default: module.ConfigModal }))
);
const CompanionPanel = lazy(() =>
  import('./components/CompanionPanel').then((module) => ({ default: module.CompanionPanel }))
);
const TestRunnerPanel = lazy(() =>
  import('./components/TestRunnerPanel').then((module) => ({ default: module.TestRunnerPanel }))
);
const FleetCommandCenter = lazy(() =>
  import('./components/FleetCommandCenter').then((module) => ({ default: module.FleetCommandCenter }))
);

const SettingsPanel = lazy(() =>
  import('./components/SettingsPanel').then((module) => ({ default: module.SettingsPanel }))
);

function App() {
  // --- Store state via selectors (each subscription is minimally scoped) ---
  const activeSessionId = useActiveSessionId();
  const settings = useSettings();
  const systemDarkMode = useSystemDarkMode();
  const { showSettings } = useSettingsState();
  const { sidebarCollapsed } = useLayoutState();
  const { showConfigModal, isConfigured, appConfig } = useConfigModalState();
  const globalNotice = useGlobalNotice();
  const { progress: sandboxSetupProgress, isComplete: isSandboxSetupComplete } =
    useSandboxSetupState();
  const sandboxSyncStatus = useSandboxSyncStatus();
  const { pendingPermission, pendingSudoPassword } = usePendingDialogs();
  const showCommandPalette = useShowCommandPalette();
  const showShortcutsDialog = useShowShortcutsDialog();
  const newShellEnabled = useAppStore((s) => s.newShellEnabled);
  const showEvolutionPanel = useAppStore((s) => s.showEvolutionPanel);
  const showKnowledgePanel = useAppStore((s) => s.showKnowledgePanel);
  const showSciencePanel = useAppStore((s) => s.showSciencePanel);
  const showHelpDocs = useAppStore((s) => s.showHelpDocs);
  const showWorkflowProPanel = useAppStore((s) => s.showWorkflowProPanel);
  const showGlobalSearch = useAppStore((s) => s.showGlobalSearch);
  const showActivityFeed = useAppStore((s) => s.showActivityFeed);
  const showFileActivity = useAppStore((s) => s.showFileActivity);
  const showSessionInsights = useAppStore((s) => s.showSessionInsights);
  const showResumeChooser = useAppStore((s) => s.showResumeChooser);
  const showFocusView = useAppStore((s) => s.showFocusView);
  const setBookmarkedMessageIds = useAppStore((s) => s.setBookmarkedMessageIds);
  const setShowSnippetsLibrary = useAppStore((s) => s.setShowSnippetsLibrary);
  const showPersonaSwitcher = useAppStore((s) => s.showPersonaSwitcher);
  const setShowPersonaSwitcher = useAppStore((s) => s.setShowPersonaSwitcher);
  const showTestRunner = useAppStore((s) => s.showTestRunner);
  const setShowTestRunner = useAppStore((s) => s.setShowTestRunner);
  const setShowReasoningViewer = useAppStore((s) => s.setShowReasoningViewer);
  const showMemoryEditor = useAppStore((s) => s.showMemoryEditor);
  const setShowMemoryEditor = useAppStore((s) => s.setShowMemoryEditor);
  const showLiveLauncher = useAppStore((s) => s.showLiveLauncher);
  const setShowLiveLauncher = useAppStore((s) => s.setShowLiveLauncher);
  const showEnrollmentDialog = useAppStore((s) => s.showEnrollmentDialog);
  const setShowEnrollmentDialog = useAppStore((s) => s.setShowEnrollmentDialog);
  const presenceEnabled = useAppStore((s) => s.presenceEnabled);
  const setShowOrchestratorLauncher = useAppStore((s) => s.setShowOrchestratorLauncher);
  const setShowSkillsManager = useAppStore((s) => s.setShowSkillsManager);
  const splitPaneEnabled = useAppStore((s) => s.splitPaneEnabled);
  const toggleSplitPane = useAppStore((s) => s.toggleSplitPane);
  const updateInfo = useUpdateInfo();

  // Actions are still pulled directly from the store
  const setShowConfigModal = useAppStore((s) => s.setShowConfigModal);
  const setIsConfigured = useAppStore((s) => s.setIsConfigured);
  const setAppConfig = useAppStore((s) => s.setAppConfig);
  const clearGlobalNotice = useAppStore((s) => s.clearGlobalNotice);
  const setSandboxSetupComplete = useAppStore((s) => s.setSandboxSetupComplete);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const setShowCommandPalette = useAppStore((s) => s.setShowCommandPalette);
  const setShowShortcutsDialog = useAppStore((s) => s.setShowShortcutsDialog);
  const setShowGlobalSearch = useAppStore((s) => s.setShowGlobalSearch);
  const setShowActivityFeed = useAppStore((s) => s.setShowActivityFeed);
  const setShowFileActivity = useAppStore((s) => s.setShowFileActivity);
  const setShowSessionInsights = useAppStore((s) => s.setShowSessionInsights);
  const setShowResumeChooser = useAppStore((s) => s.setShowResumeChooser);
  const setShowFocusView = useAppStore((s) => s.setShowFocusView);
  const setUpdateInfo = useAppStore((s) => s.setUpdateInfo);
  const setSearchActive = useAppStore((s) => s.setSearchActive);
  const setContextPanelCollapsed = useAppStore((s) => s.setContextPanelCollapsed);

  const { listSessions, stopSession, isElectron } = useIPC();
  const initialSessionLoader = useMemo(
    () => ({ isElectron, listSessions }),
    [isElectron, listSessions]
  );
  const { width } = useWindowSize();
  // Pin state survives restarts via configStore.tabs.pinnedSessionIds.
  useTabPinPersistence();
  // Automatic (VAD) barge-in: listen to the mic while the agent's TTS plays and
  // interrupt hands-free when the user starts speaking. Opt-in, never-throws.
  useAutoBargeIn();
  // On any barge-in (VAD or push-to-talk), also cancel the running agent turn —
  // not just the TTS — so no ghost reply lands after the interruption.
  useBargeInTurnCancel(activeSessionId, stopSession);
  const initialized = useRef(false);
  const sidebarBeforeSettings = useRef(false);
  // P1.6 — first-run onboarding wizard. Shows when no provider key is set
  // and the user hasn't already completed (or skipped) onboarding.
  const [showOnboarding, setShowOnboarding] = useState(false);
  // P2.6 — Sub-agent dashboard (Cmd+Shift+A)
  const [showSubAgentDashboard, setShowSubAgentDashboard] = useState(false);
  // P3.4 — security diagnostics panel
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  // P3.9 — /btw quick ask popup (Cmd+Shift+/)
  const [showBtwQuickAsk, setShowBtwQuickAsk] = useState(false);
  useEffect(() => {
    if (!appConfig) return;
    const config = appConfig as unknown as { onboardingCompleted?: boolean; apiKey?: string };
    setShowOnboarding(!config.onboardingCompleted && !config.apiKey && !isConfigured);
  }, [appConfig, isConfigured]);

  useEffect(() => {
    // Only run once on mount
    if (initialized.current) return;
    initialized.current = true;

    if (initialSessionLoader.isElectron) {
      initialSessionLoader.listSessions();
    }
  }, [initialSessionLoader]);

  // Apply theme to document root
  useEffect(() => {
    const effectiveTheme =
      settings.theme === 'system' ? (systemDarkMode ? 'dark' : 'light') : settings.theme;

    // 'dark' is the class-less :root default; every other theme is a named class.
    const themeClasses = ['light', 'ember', 'genspark', 'codex', 'anthropic'];
    document.documentElement.classList.remove(...themeClasses);
    if (effectiveTheme !== 'dark') {
      document.documentElement.classList.add(effectiveTheme);
    }
  }, [settings.theme, systemDarkMode]);

  // Phase 3 step 4: sync bookmarked messages when active session changes.
  useEffect(() => {
    if (!activeSessionId || !window.electronAPI?.bookmarks?.forSession) {
      setBookmarkedMessageIds([]);
      return;
    }
    let cancelled = false;
    window.electronAPI.bookmarks.forSession(activeSessionId).then((ids) => {
      if (!cancelled) setBookmarkedMessageIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, setBookmarkedMessageIds]);

  // Auto-collapse panels based on window width
  useEffect(() => {
    setContextPanelCollapsed(width < 1100);
    setSidebarCollapsed(width < 800);
  }, [width, setContextPanelCollapsed, setSidebarCollapsed]);

  // Presence (face memory) — start the continuous detection loop only
  // when the user has opted in AND we're inside Electron. The service
  // self-aborts if no model or no enrollment, so we don't double-guard
  // here. Pause on tab hide so the camera light tracks user attention.
  useEffect(() => {
    if (!isElectron || !presenceEnabled) return;
    const svc = PresenceService.getInstance();

    void svc.start();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') svc.pause();
      else svc.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      svc.stop();
    };
  }, [isElectron, presenceEnabled]);

  // Auto-collapse sidebar when Settings is open, restore on close
  useEffect(() => {
    if (showSettings) {
      sidebarBeforeSettings.current = !sidebarCollapsed;
      setSidebarCollapsed(true);
    } else if (sidebarBeforeSettings.current) {
      setSidebarCollapsed(false);
      sidebarBeforeSettings.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSettings]);

  // Handle config save
  const handleConfigSave = useCallback(
    async (newConfig: Partial<AppConfig>) => {
      if (!isElectron) {
        console.log('[App] Browser mode - config save simulated');
        return;
      }

      const result = await window.electronAPI.config.save(newConfig);
      if (result.success) {
        setIsConfigured(Boolean(result.config?.isConfigured));
        setAppConfig(result.config);
        return result.config;
      }
    },
    [isElectron, setIsConfigured, setAppConfig]
  );

  // Handle config modal close
  const handleConfigClose = useCallback(() => {
    setShowConfigModal(false);
  }, [setShowConfigModal]);

  // Handle sandbox setup complete
  const handleSandboxSetupComplete = useCallback(() => {
    setSandboxSetupComplete(true);
  }, [setSandboxSetupComplete]);

  const handleGlobalNoticeAction = useCallback(
    (action: GlobalNoticeAction) => {
      if (action === 'open_api_settings') {
        setShowConfigModal(true);
      }
      clearGlobalNotice();
    },
    [clearGlobalNotice, setShowConfigModal]
  );

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // Cmd+Shift+K or Cmd+P opens global search (Cmd+K is the action launcher).
      if (mod && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setShowGlobalSearch(!showGlobalSearch);
      } else if (mod && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        // Phase 3 step 5: snippets library
        e.preventDefault();
        setShowSnippetsLibrary(true);
      } else if (mod && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        // Phase 3 step 11: persona switcher
        e.preventDefault();
        setShowPersonaSwitcher(true);
      } else if (mod && e.shiftKey && (e.key === 't' || e.key === 'T')) {
        // Phase 3 step 12: test runner panel
        e.preventDefault();
        setShowTestRunner(true);
      } else if (mod && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
        // Phase 3 step 17: reasoning trace viewer
        e.preventDefault();
        setShowReasoningViewer(true);
      } else if (mod && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        // Multi-agent orchestrator launcher
        e.preventDefault();
        setShowOrchestratorLauncher(true);
      } else if (mod && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
        // P2.6 — sub-agent dashboard
        e.preventDefault();
        setShowSubAgentDashboard((v) => !v);
      } else if (mod && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        // P3.4 — security diagnostics
        e.preventDefault();
        setShowDiagnostics((v) => !v);
      } else if (mod && e.shiftKey && e.key === '?') {
        // P3.9 — /btw quick ask
        e.preventDefault();
        setShowBtwQuickAsk((v) => !v);
      } else if (mod && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        setShowSessionInsights(true);
      } else if (mod && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        setShowResumeChooser(true);
      } else if (mod && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setShowFocusView(true);
      } else if (mod && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
        // Hermes skills parity — full-page Skills Manager
        e.preventDefault();
        setShowSkillsManager(true);
      } else if (mod && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
        // Phase A2 — file activity panel (agent file I/O timeline)
        e.preventDefault();
        setShowFileActivity(true);
      } else if (mod && e.key === '\\') {
        // Phase 3 step 8: toggle split-pane layout
        e.preventDefault();
        toggleSplitPane();
      } else if (mod && (e.key === 'p' || e.key === 'P') && !e.shiftKey) {
        e.preventDefault();
        setShowGlobalSearch(!showGlobalSearch);
      } else if (mod && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(!showCommandPalette);
      } else if (mod && e.key === '/') {
        e.preventDefault();
        setShowShortcutsDialog(!showShortcutsDialog);
      } else if (mod && e.key === ',') {
        e.preventDefault();
        setShowSettings(true);
      } else if (mod && e.key === 'f' && activeSessionId) {
        e.preventDefault();
        setSearchActive(true);
      } else if (mod && e.key === 'b') {
        e.preventDefault();
        if (newShellEnabled) {
          // The new shell has no collapsible sidebar; repurpose Cmd+B as the "power drawer" toggle
          // (chat ⇄ Advanced launcher) so the chord isn't dead.
          const cur = useAppStore.getState().primaryView;
          useAppStore.getState().setPrimaryView(cur === 'advanced' ? 'chat' : 'advanced');
        } else {
          setSidebarCollapsed(!sidebarCollapsed);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    showCommandPalette,
    showShortcutsDialog,
    showGlobalSearch,
    sidebarCollapsed,
    activeSessionId,
    newShellEnabled,
    setShowCommandPalette,
    setShowShortcutsDialog,
    setShowGlobalSearch,
    setShowSettings,
    setSearchActive,
    setSidebarCollapsed,
    setShowSnippetsLibrary,
    setShowPersonaSwitcher,
    setShowTestRunner,
    setShowReasoningViewer,
    setShowSessionInsights,
    setShowResumeChooser,
    setShowFocusView,
    setShowOrchestratorLauncher,
    setShowSkillsManager,
    setShowFileActivity,
    toggleSplitPane,
  ]);

  // Determine if we should show the sandbox setup dialog
  // Show if there's progress and setup is not complete
  const showSandboxSetup = sandboxSetupProgress && !isSandboxSetupComplete;

  // Theme helper
  const isDark = settings.theme === 'system' ? systemDarkMode : settings.theme === 'dark';

  return (
    <div
      className="h-full w-full min-h-0 flex flex-col overflow-hidden bg-background"
      data-testid="app-root"
    >
      {/* Titlebar - draggable region */}
      <Titlebar />
      {/* Menu bar duplicates the rail/Advanced launcher — the new shell drops it (one nav, not three). */}
      {!newShellEnabled && <TopMenuBar />}

      {/* Main Content */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left rail — panel/agent launchers (fleet, autonomy, memory, reasoning, …). Hidden in the
            opt-in new shell, which carries its own thin rail. */}
        {!newShellEnabled && <ShellNavigation />}
        <Group orientation="horizontal" id="cowork-layout" className="flex-1">
          {/* Main Content Area */}
          <Panel id="main" minSize={30}>
            <main className="h-full min-h-0 min-w-0 flex flex-col overflow-hidden bg-background relative">
              <div className={`absolute inset-0 z-0 ${showSettings ? 'hidden' : ''}`}>
                {newShellEnabled ? <NewShell /> : <DockWorkspace />}
              </div>
              {showSettings && (
                <div className="absolute inset-0 z-10 bg-background">
                  <PanelErrorBoundary name="SettingsPanel" resetKey="settings" fallback={null}>
                    <Suspense fallback={null}>
                      <SettingsPanel onClose={() => useAppStore.getState().setShowSettings(false)} />
                    </Suspense>
                  </PanelErrorBoundary>
                </div>
              )}
            </main>
          </Panel>
        </Group>
      </div>

      {/* Session export dialog host — gives /export and /save a live listener (both shells). */}
      <ExportDialogHost />

      {/* Evolution panel (new-shell Labs) — versions from recursive self-improvement. */}
      {showEvolutionPanel && (
        <PanelErrorBoundary name="EvolutionPanel" fallback={null}>
          <EvolutionPanel onClose={() => useAppStore.getState().setShowEvolutionPanel(false)} />
        </PanelErrorBoundary>
      )}

      {/* Knowledge panel (new-shell Labs) — the Collective Knowledge Graph + research-ingest topics. */}
      {showKnowledgePanel && (
        <PanelErrorBoundary name="KnowledgePanel" fallback={null}>
          <KnowledgePanel onClose={() => useAppStore.getState().setShowKnowledgePanel(false)} />
        </PanelErrorBoundary>
      )}

      {/* AI-Scientist panel (new-shell Labs) — READ-ONLY tracking of `buddy science` experiment variants. */}
      {showSciencePanel && (
        <PanelErrorBoundary name="SciencePanel" fallback={null}>
          <SciencePanel onClose={() => useAppStore.getState().setShowSciencePanel(false)} />
        </PanelErrorBoundary>
      )}

      {/* Documentation overlay — the flag had no mounted reader, so the Titlebar/TopMenuBar
          "Documentation" buttons (setShowHelpDocs(true)) were dead clicks. Mount it here. */}
      {showHelpDocs && <HelpDocs onClose={() => useAppStore.getState().setShowHelpDocs(false)} />}

      {/* WorkflowBuilder Pro — the flag had no mounted reader (dead from ⌘K and the Labs launcher).
          Host the full-bleed component in a closable overlay so the capability is actually reachable. */}
      {showWorkflowProPanel && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => useAppStore.getState().setShowWorkflowProPanel(false)}
        >
          <div
            className="bg-background border border-border rounded-lg shadow-xl w-[960px] max-w-[94vw] h-[82vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-end px-2 py-1 border-b border-border">
              <button
                type="button"
                onClick={() => useAppStore.getState().setShowWorkflowProPanel(false)}
                className="text-xs px-2 py-1 rounded-md border border-border hover:bg-accent"
              >
                Fermer
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <WorkflowProPanel />
            </div>
          </div>
        </div>
      )}

      {/* Permission Dialog */}
      {pendingPermission && <PermissionDialog permission={pendingPermission} />}

      {/* Sudo Password Dialog */}
      {pendingSudoPassword && <SudoPasswordDialog request={pendingSudoPassword} />}

      {/* Onboarding Wizard (P1.6) — first-run only */}
      {showOnboarding && (
        <OnboardingWizard
          onClose={() => setShowOnboarding(false)}
          apiSettingsOpen={showConfigModal}
          onOpenApiSettings={() => {
            // Keep the wizard mounted underneath so the user returns to it
            // (and sees the now-connected status / can verify) after saving.
            setShowConfigModal(true);
          }}
        />
      )}

      {/* Sub-agent dashboard (P2.6) — Cmd+Shift+A */}
      {showSubAgentDashboard && (
        <SubAgentDashboard onClose={() => setShowSubAgentDashboard(false)} />
      )}

      {/* Security diagnostics panel (P3.4) — Cmd+Shift+D */}
      {showDiagnostics && (
        <PanelErrorBoundary name="DiagnosticsPanel" fallback={null}>
          <DiagnosticsPanel onClose={() => setShowDiagnostics(false)} />
        </PanelErrorBoundary>
      )}

      {/* /btw quick-ask popup (P3.9) — Cmd+Shift+/ */}
      {showBtwQuickAsk && (
        <PanelErrorBoundary name="BtwQuickAsk" fallback={null}>
          <BtwQuickAsk onClose={() => setShowBtwQuickAsk(false)} />
        </PanelErrorBoundary>
      )}

      {/* Config Modal */}
      <PanelErrorBoundary name="ConfigModal" fallback={null}>
        <Suspense fallback={null}>
          <ConfigModal
            isOpen={showConfigModal}
            onClose={handleConfigClose}
            onSave={handleConfigSave}
            initialConfig={appConfig}
            isFirstRun={!isConfigured}
          />
        </Suspense>
      </PanelErrorBoundary>

      {/* Sandbox Setup Dialog */}
      {showSandboxSetup && (
        <SandboxSetupDialog
          progress={sandboxSetupProgress}
          onComplete={handleSandboxSetupComplete}
        />
      )}

      {/* Sandbox Sync Toast */}
      <SandboxSyncToast status={sandboxSyncStatus} />

      <GlobalNoticeToast
        notice={globalNotice}
        onDismiss={clearGlobalNotice}
        onAction={handleGlobalNoticeAction}
      />

      {/* Update notification banner */}
      {updateInfo && updateInfo.available && (
        <UpdateNotification
          updateInfo={updateInfo}
          onDownload={() => window.electronAPI?.update?.download()}
          onInstall={() => window.electronAPI?.update?.install()}
          onDismiss={() => setUpdateInfo(null)}
        />
      )}

      {/* Command Palette (Cmd+K) */}
      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          onNewSession={() => {
            setShowSettings(false);
            useAppStore.getState().setActiveSession(null);
          }}
          onResumeSession={() => setShowResumeChooser(true)}
          onOpenSettings={() => setShowSettings(true)}
          onToggleTheme={() => {
            const newTheme = isDark ? 'light' : 'dark';
            useAppStore.getState().updateSettings({ theme: newTheme });
          }}
          onShowShortcuts={() => setShowShortcutsDialog(true)}
          isDark={isDark}
          onShowDiagnostics={() => {
            setShowCommandPalette(false);
            setShowDiagnostics(true);
          }}
          onShowSubAgents={() => {
            setShowCommandPalette(false);
            setShowSubAgentDashboard(true);
          }}
          onShowBtw={() => {
            setShowCommandPalette(false);
            setShowBtwQuickAsk(true);
          }}
          onShowPlugins={() => {
            setShowCommandPalette(false);
            useAppStore.getState().setSettingsTab('plugins');
            setShowSettings(true);
          }}
          onShowSkillsManager={() => {
            setShowCommandPalette(false);
            setShowSkillsManager(true);
          }}
          onShowClawMigration={() => {
            setShowCommandPalette(false);
            useAppStore.getState().setShowClawMigration(true);
          }}
          onShowKanban={() => {
            setShowCommandPalette(false);
            useAppStore.getState().setShowKanban(true);
          }}
        />
      )}

      {/* Keyboard Shortcuts Dialog (Cmd+/) */}
      {showShortcutsDialog && (
        <KeyboardShortcutsDialog onClose={() => setShowShortcutsDialog(false)} />
      )}

      {/* Global Search Dialog (Cmd+P / Cmd+Shift+K) — Phase 2 step 8 */}
      <GlobalSearchDialog open={showGlobalSearch} onClose={() => setShowGlobalSearch(false)} />
      <SessionPruneDialog />

      {/* File Preview Pane — Phase 2 step 9 (skipped when split-pane owns it) */}
      {!splitPaneEnabled && <FilePreviewPane />}

      {/* Artifact Panel — Phase 2 step 10 */}
      <ArtifactPanel />

      {/* Computer Use Overlay — Phase 2 step 13 */}
      <ComputerUseOverlay />

      {/* Browser Operator Overlay — S2 */}
      <BrowserOperatorOverlay />

      {/* Workflow approval modal — driven by store.pendingApprovals */}
      <ApprovalDialog />

      {/* Activity Feed — Phase 2 step 18 */}
      <ActivityFeed open={showActivityFeed} onClose={() => setShowActivityFeed(false)} />
      <FileActivityPanel open={showFileActivity} onClose={() => setShowFileActivity(false)} />
      <SessionInsightsPanel
        open={showSessionInsights}
        onClose={() => setShowSessionInsights(false)}
      />
      <SessionResumeDialog open={showResumeChooser} onClose={() => setShowResumeChooser(false)} />
      {showFocusView && (
        <FocusView
          open={showFocusView}
          onClose={() => setShowFocusView(false)}
          onStopSession={stopSession}
        />
      )}

      {/* Bookmarks Panel — Phase 3 step 4 */}
      <BookmarksPanel />

      {/* Snippets Library — Phase 3 step 5 */}
      <SnippetsLibrary />
      <PersonaSwitcherDialog
        isOpen={showPersonaSwitcher}
        onClose={() => setShowPersonaSwitcher(false)}
      />
      <TestRunnerWrapper showTestRunner={showTestRunner} onClose={() => setShowTestRunner(false)} />
      <MemoryPanel isOpen={showMemoryEditor} onClose={() => setShowMemoryEditor(false)} />
      <LiveLauncherPanel isOpen={showLiveLauncher} onClose={() => setShowLiveLauncher(false)} />

      {/* Notification toasts + center (Claude Cowork parity) */}
      <NotificationToastContainer />
      <NotificationCenter />

      {/* Presence — face memory enrollment + model install. */}
      <EnrollmentDialog
        isOpen={showEnrollmentDialog}
        onClose={() => setShowEnrollmentDialog(false)}
        onEnrolled={() => setShowEnrollmentDialog(false)}
      />
      <ModelInstallDialog />

      {/* Multi-agent orchestrator launcher — opens via Sparkles button
          in Titlebar or Cmd/Ctrl+Shift+M. */}
      <OrchestratorLauncher />

      {/* Fleet panel — multi-host Code Buddy listener (GAP 3) */}
      <FleetPanel />

      {/* Fleet Command Center — multi-AI dispatch (Fleet P5) */}
      <FleetCommandCenterWrapper />

      {/* Skills Manager — full-page Hermes skills parity (Cmd/Ctrl+Shift+L) */}
      <SkillsManagerWrapper />
      <TeamWrapper />

      {/* Team panel — Agent Teams (Phase 4 layer 9) */}
      

      {/* Hermes review-gated surfaces (CLI parity → Cowork) */}
      <LessonCandidatePanel />
      <UserModelPanel />
      <SpecPanel />
      <MobileSupervisionPanel />
      <IdentityPanel />
      <DevicePanel />
      <ChannelsPanel />
      <CompanionWrapper />

      {/* OpenClaw migration dialog — Hermes claw parity (dry-run by default) */}
      <ClawMigrationWrapper />

      {/* Kanban board — Hermes kanban parity (workspace board CRUD) */}
      <KanbanWrapper />

      {/* Mission board - autonomous mission backlog tracking */}
      <MissionBoardWrapper />

      {/* Desktop snapshot - passive GUI inspection */}
      <DesktopSnapshotWrapper />
    </div>
  );
}

export default App;

/**
 * Reactive wrapper so the FleetCommandCenter re-renders on store
 * mutation. Putting the hook here (instead of inline in `App`) keeps
 * the existing component tree intact and avoids extra subscriptions
 * on App's main render path.
 */
// If the Fleet panel throws (e.g. a peer with incomplete capability data), close
// it cleanly so the user is never trapped behind the full-app crash screen.
function FleetCrashFallback({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    onClose();
  }, [onClose]);
  return null;
}

function FleetCommandCenterWrapper() {
  const open = useAppStore((s) => s.showFleetCommandCenter);
  const close = useAppStore((s) => s.setShowFleetCommandCenter);
  if (!open) return null;
  return (
    <PanelErrorBoundary
      name="FleetCommandCenter"
      resetKey={String(open)}
      fallback={<FleetCrashFallback onClose={() => close(false)} />}
    >
      <Suspense fallback={null}>
        <FleetCommandCenter isOpen={open} onClose={() => close(false)} />
      </Suspense>
    </PanelErrorBoundary>
  );
}

/**
 * Wrapper for the Agent Teams panel (Phase 4 layer 9). Gates on the
 * `showTeamPanel` store flag — TeamPanel renders a full-height
 * (`h-full w-full`) sibling, so rendering it unconditionally collapses
 * the main content column (chat/settings) to zero height. Only mount it
 * when explicitly opened (TeamPanel closes itself via setShowTeamPanel).
 */
function TeamWrapper() {
  const open = useAppStore((s) => s.showTeamPanel);
  if (!open) return null;
  return <TeamPanel />;
}

/** Reactive wrapper for the OpenClaw migration dialog (Hermes claw parity). */
function ClawMigrationWrapper() {
  const open = useAppStore((s) => s.showClawMigration);
  const close = useAppStore((s) => s.setShowClawMigration);
  if (!open) return null;
  return <ClawMigrationDialog onClose={() => close(false)} />;
}

/** Reactive wrapper for the Hermes Kanban board panel. */
function KanbanWrapper() {
  const open = useAppStore((s) => s.showKanban);
  const close = useAppStore((s) => s.setShowKanban);
  if (!open) return null;
  return <KanbanPanel onClose={() => close(false)} />;
}

/** Reactive wrapper for the autonomous mission board panel. */
function MissionBoardWrapper() {
  const open = useAppStore((s) => s.showMissionBoard);
  const close = useAppStore((s) => s.setShowMissionBoard);
  if (!open) return null;
  return <MissionBoardPanel onClose={() => close(false)} />;
}

/** Reactive wrapper for the passive desktop snapshot panel. */
function DesktopSnapshotWrapper() {
  const open = useAppStore((s) => s.showDesktopSnapshot);
  const close = useAppStore((s) => s.setShowDesktopSnapshot);
  if (!open) return null;
  return <DesktopSnapshotPanel onClose={() => close(false)} />;
}

/** Reactive wrapper for CompanionPanel to allow lazy loading. */
function CompanionWrapper() {
  const show = useAppStore((s) => s.showCompanionPanel);
  if (!show) return null;
  return (
    <Suspense fallback={null}>
      <CompanionPanel />
    </Suspense>
  );
}

function TestRunnerWrapper({ showTestRunner, onClose }: { showTestRunner: boolean; onClose: () => void }) {
  if (!showTestRunner) return null;
  return (
    <Suspense fallback={null}>
      <TestRunnerPanel isOpen={showTestRunner} onClose={onClose} />
    </Suspense>
  );
}
