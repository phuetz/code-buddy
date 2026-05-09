import { Suspense, lazy, useEffect, useRef, useCallback } from 'react';
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
import { Sidebar } from './components/Sidebar';
import { WelcomeView } from './components/WelcomeView';
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
import { FilePreviewPane } from './components/FilePreviewPane';
import { ArtifactPanel } from './components/ArtifactPanel';
import { ComputerUseOverlay } from './components/ComputerUseOverlay';
import { ApprovalDialog } from './components/ApprovalDialog';
import { ActivityFeed } from './components/ActivityFeed';
import { SessionInsightsPanel } from './components/SessionInsightsPanel';
import { SessionResumeDialog } from './components/SessionResumeDialog';
import { BookmarksPanel } from './components/BookmarksPanel';
import { SnippetsLibrary } from './components/SnippetsLibrary';
import { PersonaSwitcherDialog } from './components/PersonaSwitcherDialog';
import { TestRunnerPanel } from './components/TestRunnerPanel';
import { ReasoningTraceViewer } from './components/ReasoningTraceViewer';
import { FocusView } from './components/FocusView';
import { SplitPaneLayout } from './components/SplitPaneLayout';
import { UpdateNotification } from './components/UpdateNotification';
import { NotificationToastContainer } from './components/NotificationToast';
import { NotificationCenter } from './components/NotificationCenter';
import { EnrollmentDialog } from './components/EnrollmentDialog';
import { ModelInstallDialog } from './components/ModelInstallDialog';
import { OrchestratorLauncher } from './components/OrchestratorLauncher';
import { FleetPanel } from './components/FleetPanel';
import { TeamPanel } from './components/TeamPanel';
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
  const initialized = useRef(false);
  const sidebarBeforeSettings = useRef(false);

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
            <WelcomeView />
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
      {pendingPermission && <PermissionDialog permission={pendingPermission} />}

      {/* Sudo Password Dialog */}
      {pendingSudoPassword && <SudoPasswordDialog request={pendingSudoPassword} />}

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
        />
      )}

      {/* Keyboard Shortcuts Dialog (Cmd+/) */}
      {showShortcutsDialog && (
        <KeyboardShortcutsDialog onClose={() => setShowShortcutsDialog(false)} />
      )}

      {/* Global Search Dialog (Cmd+P / Cmd+Shift+K) — Phase 2 step 8 */}
      <GlobalSearchDialog open={showGlobalSearch} onClose={() => setShowGlobalSearch(false)} />

      {/* File Preview Pane — Phase 2 step 9 (skipped when split-pane owns it) */}
      {!splitPaneEnabled && <FilePreviewPane />}

      {/* Artifact Panel — Phase 2 step 10 */}
      <ArtifactPanel />

      {/* Computer Use Overlay — Phase 2 step 13 */}
      <ComputerUseOverlay />

      {/* Workflow approval modal — driven by store.pendingApprovals */}
      <ApprovalDialog />

      {/* Activity Feed — Phase 2 step 18 */}
      <ActivityFeed open={showActivityFeed} onClose={() => setShowActivityFeed(false)} />
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
      <TestRunnerPanel isOpen={showTestRunner} onClose={() => setShowTestRunner(false)} />
      <ReasoningTraceViewer
        isOpen={showReasoningViewer}
        onClose={() => setShowReasoningViewer(false)}
      />

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

      {/* Team panel — Agent Teams (Phase 4 layer 9) */}
      <TeamPanel />
    </div>
  );
}

export default App;
