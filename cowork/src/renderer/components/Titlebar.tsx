import { Minus, Square, X, Copy, Bell, Activity, Star, BarChart3, Focus, Sparkles, Network, Users, HelpCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useUnreadNotificationCount } from '../store/selectors';
import { TabBar } from './TabBar';
import { PresenceIndicator } from './PresenceIndicator';

const isMac = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin';

export function Titlebar() {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  const unreadCount = useUnreadNotificationCount();
  const setShowNotificationCenter = useAppStore((s) => s.setShowNotificationCenter);
  const showNotificationCenter = useAppStore((s) => s.showNotificationCenter);

  const handleMinimize = () => {
    window.electronAPI?.window.minimize();
  };

  const handleMaximize = () => {
    window.electronAPI?.window.maximize();
    setIsMaximized(!isMaximized);
  };

  const handleClose = () => {
    window.electronAPI?.window.close();
  };

  return (
    <div
      className={`h-10 bg-background-secondary border-b border-border flex items-center titlebar-drag shrink-0 ${
        isMac ? 'justify-start pl-20' : 'justify-start'
      }`}
    >
      {/* macOS: Traffic lights are positioned by trafficLightPosition, we just need left padding */}

      {/* Tab bar (Phase 2 step 14) */}
      <div className="flex-1 min-w-0 flex items-center pl-2">
        <TabBar />
      </div>

      {/* Presence indicator (face memory) — opens EnrollmentDialog on click. */}
      <div className="titlebar-no-drag px-2 flex items-center ml-auto">
        <PresenceIndicator
          onEnrollClicked={() => useAppStore.getState().setShowEnrollmentDialog(true)}
        />
      </div>

      {/* Multi-agent orchestrator launcher (Ctrl+Shift+M). */}
      <button
        onClick={() => useAppStore.getState().setShowOrchestratorLauncher(true)}
        className="w-10 h-full flex items-center justify-center titlebar-no-drag hover:bg-surface transition-colors"
        title="Spawn multi-agent team (Ctrl+Shift+M)"
        aria-label="Spawn multi-agent team"
      >
        <Sparkles className="w-4 h-4 text-text-secondary" />
      </button>

      {/* Fleet panel — multi-host Code Buddy listener (GAP 3) */}
      <button
        onClick={() => useAppStore.getState().setShowFleetPanel(true)}
        className="w-10 h-full flex items-center justify-center titlebar-no-drag hover:bg-surface transition-colors"
        title="Fleet — multi-host Code Buddy"
        aria-label="Open fleet panel"
      >
        <Network className="w-4 h-4 text-text-secondary" />
      </button>

      {/* Team panel — Agent Teams (Phase 4 layer 9) */}
      <button
        onClick={() => useAppStore.getState().setShowTeamPanel(true)}
        className="w-10 h-full flex items-center justify-center titlebar-no-drag hover:bg-surface transition-colors"
        title="Agent Team"
        aria-label="Open team panel"
      >
        <Users className="w-4 h-4 text-text-secondary" />
      </button>

      {/* Bookmarks panel (Phase 3 step 4) */}
      <button
        onClick={() => useAppStore.getState().setShowBookmarksPanel(true)}
        className="w-10 h-full flex items-center justify-center titlebar-no-drag hover:bg-surface transition-colors"
        title={t('bookmarks.title')}
      >
        <Star className="w-4 h-4 text-text-secondary" />
      </button>

      {/* Activity feed (Phase 2 step 18) */}
      <button
        onClick={() => useAppStore.getState().setShowActivityFeed(true)}
        className="w-10 h-full flex items-center justify-center titlebar-no-drag hover:bg-surface transition-colors"
        title={t('activity.title')}
      >
        <Activity className="w-4 h-4 text-text-secondary" />
      </button>

      <button
        onClick={() => useAppStore.getState().setShowSessionInsights(true)}
        className="w-10 h-full flex items-center justify-center titlebar-no-drag hover:bg-surface transition-colors"
        title={t('sessionInsights.title')}
        data-testid="session-insights-button"
      >
        <BarChart3 className="w-4 h-4 text-text-secondary" />
      </button>

      <button
        onClick={() => useAppStore.getState().setShowFocusView(true)}
        className="w-10 h-full flex items-center justify-center titlebar-no-drag hover:bg-surface transition-colors"
        title={t('focusView.title')}
        data-testid="focus-view-button"
      >
        <Focus className="w-4 h-4 text-text-secondary" />
      </button>

      {/* Keyboard shortcuts help (Ctrl+/) */}
      <button
        onClick={() => useAppStore.getState().setShowShortcutsDialog(true)}
        className="w-10 h-full flex items-center justify-center titlebar-no-drag hover:bg-surface transition-colors"
        title={t('shortcutsDialog.title', 'Keyboard shortcuts (Ctrl+/)')}
        aria-label="Show keyboard shortcuts"
        data-testid="shortcuts-help-button"
      >
        <HelpCircle className="w-4 h-4 text-text-secondary" />
      </button>

      {/* Notification bell (Claude Cowork parity) */}
      <button
        onClick={() => setShowNotificationCenter(!showNotificationCenter)}
        className={`w-10 h-full flex items-center justify-center titlebar-no-drag hover:bg-surface transition-colors relative ${
          isMac ? 'mr-2' : ''
        }`}
        title={t('notifications.title')}
      >
        <Bell className="w-4 h-4 text-text-secondary" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Window Controls (for Windows/Linux - macOS uses native traffic lights) */}
      {!isMac && (
        <div className="flex items-center titlebar-no-drag h-full">
          <button
            onClick={handleMinimize}
            className="w-12 h-full flex items-center justify-center hover:bg-surface transition-colors"
            title={t('window.minimize')}
          >
            <Minus className="w-4 h-4 text-text-secondary" />
          </button>
          <button
            onClick={handleMaximize}
            className="w-12 h-full flex items-center justify-center hover:bg-surface transition-colors"
            title={isMaximized ? t('window.restore') : t('window.maximize')}
          >
            {isMaximized ? (
              <Copy className="w-3.5 h-3.5 text-text-secondary" />
            ) : (
              <Square className="w-3.5 h-3.5 text-text-secondary" />
            )}
          </button>
          <button
            onClick={handleClose}
            className="w-12 h-full flex items-center justify-center hover:bg-red-500 transition-colors group"
            title={t('window.close')}
          >
            <X className="w-4 h-4 text-text-secondary group-hover:text-white" />
          </button>
        </div>
      )}
    </div>
  );
}
