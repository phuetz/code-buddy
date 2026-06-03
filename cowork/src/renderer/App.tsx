import { Suspense, lazy, useEffect, useRef, useCallback, useState } from 'react';
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
import { Sidebar } from './components/Sidebar';
import { ShellNavigation } from './components/ShellNavigation';
import { Titlebar } from './components/Titlebar';
import { SandboxSyncToast } from './components/SandboxSyncToast';
import { GlobalNoticeToast } from './components/GlobalNoticeToast';
import { PanelErrorBoundary } from './components/PanelErrorBoundary';
import { FilePreviewPane } from './components/FilePreviewPane';
import { ArtifactPanel } from './components/ArtifactPanel';
import { ComputerUseOverlay } from './components/ComputerUseOverlay';
import { BrowserOperatorOverlay } from './components/BrowserOperatorOverlay';
import { ApprovalDialog } from './components/ApprovalDialog';
import { SplitPaneLayout } from './components/SplitPaneLayout';
import { NotificationToastContainer } from './components/NotificationToast';
import { ModelInstallDialog } from './components/ModelInstallDialog';
import { PresenceService } from './services/presence/PresenceService';
import type { AppConfig } from './types';
import type { GlobalNoticeAction } from './store';

const ChatView = lazy(() =>
  import('./components/ChatView').then((module) => ({ default: module.ChatView }))
);
const ContextPanel = lazy(() =>
  import('./components/ContextPanel').then((module) => ({ default: module.ContextPanel }))
);
const ConfigModal = lazy(() =>
  import('./components/ConfigModal').then((module) => ({ default: module.ConfigModal }))
);
const SettingsPanel = lazy(() =>
  import('./components/SettingsPanel').then((module) => ({ default: module.SettingsPanel }))
);
const WelcomeView = lazy(() =>
  import('./components/WelcomeView').then((module) => ({ default: module.WelcomeView }))
);
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then((module) => ({ default: module.CommandPalette }))
);
const KeyboardShortcutsDialog = lazy(() =>
  import('./components/KeyboardShortcutsDialog').then((module) => ({
    default: module.KeyboardShortcutsDialog,
  }))
);
const GlobalSearchDialog = lazy(() =>
  import('./components/GlobalSearchDialog').then((module) => ({
    default: module.GlobalSearchDialog,
  }))
);
const PermissionDialog = lazy(() =>
  import('./components/PermissionDialog').then((module) => ({
    default: module.PermissionDialog,
  }))
);
const SudoPasswordDialog = lazy(() =>
  import('./components/SudoPasswordDialog').then((module) => ({
    default: module.SudoPasswordDialog,
  }))
);
const SandboxSetupDialog = lazy(() =>
  import('./components/SandboxSetupDialog').then((module) => ({
    default: module.SandboxSetupDialog,
  }))
);
const UpdateNotification = lazy(() =>
  import('./components/UpdateNotification').then((module) => ({
    default: module.UpdateNotification,
  }))
);
const ActivityFeed = lazy(() =>
  import('./components/ActivityFeed').then((module) => ({ default: module.ActivityFeed }))
);
const SessionInsightsPanel = lazy(() =>
  import('./components/SessionInsightsPanel').then((module) => ({
    default: module.SessionInsightsPanel,
  }))
);
const SessionResumeDialog = lazy(() =>
  import('./components/SessionResumeDialog').then((module) => ({
    default: module.SessionResumeDialog,
  }))
);
const BookmarksPanel = lazy(() =>
  import('./components/BookmarksPanel').then((module) => ({ default: module.BookmarksPanel }))
);
const SnippetsLibrary = lazy(() =>
  import('./components/SnippetsLibrary').then((module) => ({ default: module.SnippetsLibrary }))
);
const PersonaSwitcherDialog = lazy(() =>
  import('./components/PersonaSwitcherDialog').then((module) => ({
    default: module.PersonaSwitcherDialog,
  }))
);
const TestRunnerPanel = lazy(() =>
  import('./components/TestRunnerPanel').then((module) => ({ default: module.TestRunnerPanel }))
);
const ReasoningTraceViewer = lazy(() =>
  import('./components/ReasoningTraceViewer').then((module) => ({
    default: module.ReasoningTraceViewer,
  }))
);
const FocusView = lazy(() =>
  import('./components/FocusView').then((module) => ({ default: module.FocusView }))
);
const NotificationCenter = lazy(() =>
  import('./components/NotificationCenter').then((module) => ({
    default: module.NotificationCenter,
  }))
);
const EnrollmentDialog = lazy(() =>
  import('./components/EnrollmentDialog').then((module) => ({ default: module.EnrollmentDialog }))
);
const OrchestratorLauncher = lazy(() =>
  import('./components/OrchestratorLauncher').then((module) => ({
    default: module.OrchestratorLauncher,
  }))
);
const FleetPanel = lazy(() =>
  import('./components/FleetPanel').then((module) => ({ default: module.FleetPanel }))
);
const FleetCommandCenter = lazy(() =>
  import('./components/FleetCommandCenter').then((module) => ({
    default: module.FleetCommandCenter,
  }))
);
const TeamPanel = lazy(() =>
  import('./components/TeamPanel').then((module) => ({ default: module.TeamPanel }))
);
const LessonCandidatePanel = lazy(() =>
  import('./components/LessonCandidatePanel').then((module) => ({
    default: module.LessonCandidatePanel,
  }))
);
const UserModelPanel = lazy(() =>
  import('./components/UserModelPanel').then((module) => ({ default: module.UserModelPanel }))
);
const SpecPanel = lazy(() =>
  import('./components/SpecPanel').then((module) => ({ default: module.SpecPanel }))
);
const MobileSupervisionPanel = lazy(() =>
  import('./components/MobileSupervisionPanel').then((module) => ({
    default: module.MobileSupervisionPanel,
  }))
);
const IdentityPanel = lazy(() =>
  import('./components/IdentityPanel').then((module) => ({ default: module.IdentityPanel }))
);
const DevicePanel = lazy(() =>
  import('./components/DevicePanel').then((module) => ({ default: module.DevicePanel }))
);
const ChannelsPanel = lazy(() =>
  import('./components/ChannelsPanel').then((module) => ({ default: module.ChannelsPanel }))
);
const CompanionPanel = lazy(() =>
  import('./components/CompanionPanel').then((module) => ({ default: module.CompanionPanel }))
);
const OnboardingWizard = lazy(() =>
  import('./components/OnboardingWizard').then((module) => ({ default: module.OnboardingWizard }))
);
const SubAgentDashboard = lazy(() =>
  import('./components/SubAgentDashboard').then((module) => ({
    default: module.SubAgentDashboard,
  }))
);
const DiagnosticsPanel = lazy(() =>
  import('./components/DiagnosticsPanel').then((module) => ({ default: module.DiagnosticsPanel }))
);
const BtwQuickAsk = lazy(() =>
  import('./components/BtwQuickAsk').then((module) => ({ default: module.BtwQuickAsk }))
);

function MainPanelFallback() {
  return (
    <div className="flex-1 min-h-0 bg-background px-6 py-6">
      <div className="h-full rounded-[1.75rem] border border-border-subtle bg-background/70" />
    </div>
  );
}

function ContextPanelFallback() {
  return (
    <div
      className="hidden xl:block w-[340px] shrink-0 border-l border-border-subtle bg-background/60"
      aria-hidden="true"
    />
  );
}

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
  const showGlobalSearch = useAppStore((s) => s.showGlobalSearch);
  const showActivityFeed = useAppStore((s) => s.showActivityFeed);
  const showSessionInsights = useAppStore((s) => s.showSessionInsights);
  const showResumeChooser = useAppStore((s) => s.showResumeChooser);
  const showFocusView = useAppStore((s) => s.showFocusView);
  const showBookmarksPanel = useAppStore((s) => s.showBookmarksPanel);
  const showSnippetsLibrary = useAppStore((s) => s.showSnippetsLibrary);
  const setBookmarkedMessageIds = useAppStore((s) => s.setBookmarkedMessageIds);
  const setShowSnippetsLibrary = useAppStore((s) => s.setShowSnippetsLibrary);
  const showPersonaSwitcher = useAppStore((s) => s.showPersonaSwitcher);
  const setShowPersonaSwitcher = useAppStore((s) => s.setShowPersonaSwitcher);
  const showTestRunner = useAppStore((s) => s.showTestRunner);
  const setShowTestRunner = useAppStore((s) => s.setShowTestRunner);
  const showReasoningViewer = useAppStore((s) => s.showReasoningViewer);
  const setShowReasoningViewer = useAppStore((s) => s.setShowReasoningViewer);
  const showEnrollmentDialog = useAppStore((s) => s.showEnrollmentDialog);
  const setShowEnrollmentDialog = useAppStore((s) => s.setShowEnrollmentDialog);
  const showOrchestratorLauncher = useAppStore((s) => s.showOrchestratorLauncher);
  const showFleetPanel = useAppStore((s) => s.showFleetPanel);
  const showTeamPanel = useAppStore((s) => s.showTeamPanel);
  const showLessonCandidatePanel = useAppStore((s) => s.showLessonCandidatePanel);
  const showUserModelPanel = useAppStore((s) => s.showUserModelPanel);
  const showSpecPanel = useAppStore((s) => s.showSpecPanel);
  const showMobileSupervisionPanel = useAppStore((s) => s.showMobileSupervisionPanel);
  const showIdentityPanel = useAppStore((s) => s.showIdentityPanel);
  const showDevicePanel = useAppStore((s) => s.showDevicePanel);
  const showChannelsPanel = useAppStore((s) => s.showChannelsPanel);
  const showCompanionPanel = useAppStore((s) => s.showCompanionPanel);
  const showNotificationCenter = useAppStore((s) => s.showNotificationCenter);
  const presenceEnabled = useAppStore((s) => s.presenceEnabled);
  const setShowOrchestratorLauncher = useAppStore((s) => s.setShowOrchestratorLauncher);
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
  const setShowSessionInsights = useAppStore((s) => s.setShowSessionInsights);
  const setShowResumeChooser = useAppStore((s) => s.setShowResumeChooser);
  const setShowFocusView = useAppStore((s) => s.setShowFocusView);
  const setUpdateInfo = useAppStore((s) => s.setUpdateInfo);
  const setSearchActive = useAppStore((s) => s.setSearchActive);
  const setContextPanelCollapsed = useAppStore((s) => s.setContextPanelCollapsed);

  const { listSessions, stopSession, isElectron } = useIPC();
  const { width } = useWindowSize();
  // Pin state survives restarts via configStore.tabs.pinnedSessionIds.
  useTabPinPersistence();
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

    if (isElectron) {
      listSessions();
    }
  }, []); // Empty deps - run once

  // Apply theme to document root
  useEffect(() => {
    const effectiveTheme =
      settings.theme === 'system' ? (systemDarkMode ? 'dark' : 'light') : settings.theme;

    if (effectiveTheme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
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
      }
    },
    [setIsConfigured, setAppConfig]
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
        setSidebarCollapsed(!sidebarCollapsed);
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

      {/* Main Content */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <PanelErrorBoundary name="ShellNavigation" fallback={<div className="w-0" />}>
          <ShellNavigation />
        </PanelErrorBoundary>

        {/* Sidebar */}
        <PanelErrorBoundary name="Sidebar" fallback={<div className="w-0" />}>
          <Sidebar />
        </PanelErrorBoundary>

        {/* Main Content Area */}
        <main className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-background">
          {showSettings ? (
            <PanelErrorBoundary
              name="SettingsPanel"
              resetKey="settings"
              fallback={<MainPanelFallback />}
            >
              <Suspense fallback={<MainPanelFallback />}>
                <SettingsPanel onClose={() => setShowSettings(false)} />
              </Suspense>
            </PanelErrorBoundary>
          ) : activeSessionId ? (
            <PanelErrorBoundary
              name="ChatView"
              resetKey={activeSessionId}
              fallback={<MainPanelFallback />}
            >
              <Suspense fallback={<MainPanelFallback />}>
                {splitPaneEnabled ? (
                  <SplitPaneLayout left={<ChatView />} right={<FilePreviewPane inline />} />
                ) : (
                  <ChatView />
                )}
              </Suspense>
            </PanelErrorBoundary>
          ) : (
            <Suspense fallback={<MainPanelFallback />}>
              <WelcomeView />
            </Suspense>
          )}
        </main>

        {/* Context Panel - only show when in session and not in settings */}
        {activeSessionId && !showSettings && (
          <PanelErrorBoundary
            name="ContextPanel"
            resetKey={activeSessionId}
            fallback={<ContextPanelFallback />}
          >
            <Suspense fallback={<ContextPanelFallback />}>
              <ContextPanel />
            </Suspense>
          </PanelErrorBoundary>
        )}
      </div>

      {/* Permission Dialog */}
      {pendingPermission && (
        <Suspense fallback={null}>
          <PermissionDialog permission={pendingPermission} />
        </Suspense>
      )}

      {/* Sudo Password Dialog */}
      {pendingSudoPassword && (
        <Suspense fallback={null}>
          <SudoPasswordDialog request={pendingSudoPassword} />
        </Suspense>
      )}

      {/* Onboarding Wizard (P1.6) — first-run only */}
      {showOnboarding && (
        <Suspense fallback={null}>
          <OnboardingWizard
            onClose={() => setShowOnboarding(false)}
            onOpenApiSettings={() => {
              setShowOnboarding(false);
              setShowConfigModal(true);
            }}
          />
        </Suspense>
      )}

      {/* Sub-agent dashboard (P2.6) — Cmd+Shift+A */}
      {showSubAgentDashboard && (
        <Suspense fallback={null}>
          <SubAgentDashboard onClose={() => setShowSubAgentDashboard(false)} />
        </Suspense>
      )}

      {/* Security diagnostics panel (P3.4) — Cmd+Shift+D */}
      {showDiagnostics && (
        <Suspense fallback={null}>
          <DiagnosticsPanel onClose={() => setShowDiagnostics(false)} />
        </Suspense>
      )}

      {/* /btw quick-ask popup (P3.9) — Cmd+Shift+/ */}
      {showBtwQuickAsk && (
        <Suspense fallback={null}>
          <BtwQuickAsk onClose={() => setShowBtwQuickAsk(false)} />
        </Suspense>
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
        <Suspense fallback={null}>
          <SandboxSetupDialog
            progress={sandboxSetupProgress}
            onComplete={handleSandboxSetupComplete}
          />
        </Suspense>
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
        <Suspense fallback={null}>
          <UpdateNotification
            updateInfo={updateInfo}
            onDownload={() => window.electronAPI?.update?.download()}
            onInstall={() => window.electronAPI?.update?.install()}
            onDismiss={() => setUpdateInfo(null)}
          />
        </Suspense>
      )}

      {/* Command Palette (Cmd+K) */}
      {showCommandPalette && (
        <Suspense fallback={null}>
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
          />
        </Suspense>
      )}

      {/* Keyboard Shortcuts Dialog (Cmd+/) */}
      {showShortcutsDialog && (
        <Suspense fallback={null}>
          <KeyboardShortcutsDialog onClose={() => setShowShortcutsDialog(false)} />
        </Suspense>
      )}

      {/* Global Search Dialog (Cmd+P / Cmd+Shift+K) — Phase 2 step 8 */}
      {showGlobalSearch && (
        <Suspense fallback={null}>
          <GlobalSearchDialog open={showGlobalSearch} onClose={() => setShowGlobalSearch(false)} />
        </Suspense>
      )}

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
      {showActivityFeed && (
        <Suspense fallback={null}>
          <ActivityFeed open={showActivityFeed} onClose={() => setShowActivityFeed(false)} />
        </Suspense>
      )}
      {showSessionInsights && (
        <Suspense fallback={null}>
          <SessionInsightsPanel
            open={showSessionInsights}
            onClose={() => setShowSessionInsights(false)}
          />
        </Suspense>
      )}
      {showResumeChooser && (
        <Suspense fallback={null}>
          <SessionResumeDialog
            open={showResumeChooser}
            onClose={() => setShowResumeChooser(false)}
          />
        </Suspense>
      )}
      {showFocusView && (
        <Suspense fallback={null}>
          <FocusView
            open={showFocusView}
            onClose={() => setShowFocusView(false)}
            onStopSession={stopSession}
          />
        </Suspense>
      )}

      {/* Bookmarks Panel — Phase 3 step 4 */}
      {showBookmarksPanel && (
        <Suspense fallback={null}>
          <BookmarksPanel />
        </Suspense>
      )}

      {/* Snippets Library — Phase 3 step 5 */}
      {showSnippetsLibrary && (
        <Suspense fallback={null}>
          <SnippetsLibrary />
        </Suspense>
      )}
      {showPersonaSwitcher && (
        <Suspense fallback={null}>
          <PersonaSwitcherDialog
            isOpen={showPersonaSwitcher}
            onClose={() => setShowPersonaSwitcher(false)}
          />
        </Suspense>
      )}
      {showTestRunner && (
        <Suspense fallback={null}>
          <TestRunnerPanel isOpen={showTestRunner} onClose={() => setShowTestRunner(false)} />
        </Suspense>
      )}
      {showReasoningViewer && (
        <Suspense fallback={null}>
          <ReasoningTraceViewer
            isOpen={showReasoningViewer}
            onClose={() => setShowReasoningViewer(false)}
          />
        </Suspense>
      )}

      {/* Notification toasts + center (Claude Cowork parity) */}
      <NotificationToastContainer />
      {showNotificationCenter && (
        <Suspense fallback={null}>
          <NotificationCenter />
        </Suspense>
      )}

      {/* Presence — face memory enrollment + model install. */}
      {showEnrollmentDialog && (
        <Suspense fallback={null}>
          <EnrollmentDialog
            isOpen={showEnrollmentDialog}
            onClose={() => setShowEnrollmentDialog(false)}
            onEnrolled={() => setShowEnrollmentDialog(false)}
          />
        </Suspense>
      )}
      <ModelInstallDialog />

      {/* Multi-agent orchestrator launcher — opens via Sparkles button
          in Titlebar or Cmd/Ctrl+Shift+M. */}
      {showOrchestratorLauncher && (
        <Suspense fallback={null}>
          <OrchestratorLauncher />
        </Suspense>
      )}

      {/* Fleet panel — multi-host Code Buddy listener (GAP 3) */}
      {showFleetPanel && (
        <Suspense fallback={null}>
          <FleetPanel />
        </Suspense>
      )}

      {/* Fleet Command Center — multi-AI dispatch (Fleet P5) */}
      <FleetCommandCenterWrapper />

      {/* Team panel — Agent Teams (Phase 4 layer 9) */}
      {showTeamPanel && (
        <Suspense fallback={null}>
          <TeamPanel />
        </Suspense>
      )}

      {/* Hermes review-gated surfaces (CLI parity → Cowork) */}
      {showLessonCandidatePanel && (
        <Suspense fallback={null}>
          <LessonCandidatePanel />
        </Suspense>
      )}
      {showUserModelPanel && (
        <Suspense fallback={null}>
          <UserModelPanel />
        </Suspense>
      )}
      {showSpecPanel && (
        <Suspense fallback={null}>
          <SpecPanel />
        </Suspense>
      )}
      {showMobileSupervisionPanel && (
        <Suspense fallback={null}>
          <MobileSupervisionPanel />
        </Suspense>
      )}
      {showIdentityPanel && (
        <Suspense fallback={null}>
          <IdentityPanel />
        </Suspense>
      )}
      {showDevicePanel && (
        <Suspense fallback={null}>
          <DevicePanel />
        </Suspense>
      )}
      {showChannelsPanel && (
        <Suspense fallback={null}>
          <ChannelsPanel />
        </Suspense>
      )}
      {showCompanionPanel && (
        <Suspense fallback={null}>
          <CompanionPanel />
        </Suspense>
      )}
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
function FleetCommandCenterWrapper() {
  const open = useAppStore((s) => s.showFleetCommandCenter);
  const close = useAppStore((s) => s.setShowFleetCommandCenter);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <FleetCommandCenter isOpen={open} onClose={() => close(false)} />
    </Suspense>
  );
}
