import {
  Minus,
  Square,
  X,
  Copy,
  Bell,
  HelpCircle,
  Power,
  Loader2,
  ClipboardCopy,
  Headphones,
  Network,
  Book,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { useUnreadNotificationCount } from '../store/selectors';
import { TabBar } from './TabBar';
import { PresenceIndicator } from './PresenceIndicator';
import { ServerDashboard } from './ServerDashboard';
import { RunnerBadge } from './RunnerBadge';
import { ClipboardSummaryPanel } from './ClipboardSummaryPanel';
import { VoiceChatOverlay } from './VoiceChatOverlay';

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

      {/* Runner badge — shows engine vs pi status (Cowork-on-core migration P3) */}
      <RunnerBadge />

      {/* Clipboard summary (Lisa-derived) */}
      <ClipboardButton />

      {/* Voice chat overlay (Lisa-derived) */}
      <VoiceOverlayButton />

      {/* Remote backend indicator (Phase B3) — shows when chat/sessions run remotely */}
      <RemoteBackendIndicator />

      {/* Code Buddy HTTP server toggle — boots `src/server/index.ts` in-process */}
      <ServerToggle />

      {/* Documentation */}
      <button
        onClick={() => useAppStore.getState().setShowHelpDocs(true)}
        className="w-10 h-full flex items-center justify-center titlebar-no-drag hover:bg-surface transition-colors"
        title={t('helpDocs.title', 'Documentation')}
        aria-label="Show documentation"
        data-testid="documentation-button"
      >
        <Book className="w-4 h-4 text-text-secondary" />
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

interface ServerStatusShape {
  running: boolean;
  port: number | null;
  host: string | null;
  websocket: boolean;
  error?: string | null;
}

/**
 * Clipboard summariser button (Lisa-derived). Click opens the
 * ClipboardSummaryPanel overlay. Shows a small indicator dot when
 * auto-monitoring is on so Patrice knows the watcher is running.
 */
function ClipboardButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const monitoringEnabled = useAppStore((s) => s.clipboardMonitoringEnabled);
  const summarising = useAppStore((s) => s.clipboardSummarising);

  // "Send as prompt" routes the summary into the system clipboard so
  // the user just pastes it into the composer. Avoids tight coupling
  // with ChatView's local prompt state.
  const handleSendToChat = (prompt: string) => {
    try {
      void navigator.clipboard.writeText(prompt);
    } catch {
      /* clipboard might be locked — silent fail */
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative w-10 h-full flex items-center justify-center titlebar-no-drag hover:bg-surface transition-colors"
        title={t('clipboardSummary.button', 'Clipboard summariser')}
        aria-label="Clipboard summariser"
        data-testid="clipboard-summary-button"
      >
        {summarising ? (
          <Loader2 className="w-4 h-4 text-text-secondary animate-spin" />
        ) : (
          <ClipboardCopy className="w-4 h-4 text-text-secondary" />
        )}
        {monitoringEnabled && !summarising && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-success animate-pulse" />
        )}
      </button>
      <ClipboardSummaryPanel
        isOpen={open}
        onClose={() => setOpen(false)}
        onSendToChat={handleSendToChat}
      />
    </>
  );
}

/**
 * Voice chat overlay launcher (Lisa-derived). Bigger / dedicated
 * voice-first composer that complements the small MicButton inside
 * ChatView. Opens a modal with a 24×24 mic, editable transcript, and
 * Settings drawer for Piper TTS rate / auto-speak.
 */
function VoiceOverlayButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openVoiceChat = () => setOpen(true);
    window.addEventListener('cowork:open-voice-chat', openVoiceChat);
    return () => window.removeEventListener('cowork:open-voice-chat', openVoiceChat);
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-10 h-full flex items-center justify-center titlebar-no-drag hover:bg-surface transition-colors"
        title={t('voiceOverlay.button', 'Voice chat overlay')}
        aria-label="Voice chat overlay"
        data-testid="voice-overlay-button"
      >
        <Headphones className="w-4 h-4 text-text-secondary" />
      </button>
      <VoiceChatOverlay isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * Power button + dot indicator for the Code Buddy HTTP server. Click to
 * toggle (start uses default ports 3000/3001 + WS). Polls every 5s while
 * idle so the UI stays in sync if the server is stopped from elsewhere.
 */
function RemoteBackendIndicator() {
  const { t } = useTranslation();
  const remoteBackend = useAppStore((s) => s.remoteBackend);
  const setRemoteBackend = useAppStore((s) => s.setRemoteBackend);

  // Keep the store in sync with the main-process connection state, even when
  // the user is not on the settings page (the badge lives in the titlebar).
  useEffect(() => {
    const api = window.electronAPI?.remoteBackend;
    if (!api) return;
    let cancelled = false;

    void (async () => {
      try {
        const s = await api.status();
        if (cancelled) return;
        setRemoteBackend({
          connected: s.status === 'connected',
          host: s.status === 'connected' ? (s.host ?? null) : null,
        });
      } catch {
        /* ignore */
      }
    })();

    const unsubscribe = api.onStatus((s) => {
      if (cancelled) return;
      setRemoteBackend({
        connected: s.status === 'connected',
        host: s.status === 'connected' ? (s.host ?? null) : null,
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [setRemoteBackend]);

  if (!remoteBackend.connected) return null;

  return (
    <div
      className="titlebar-no-drag flex items-center gap-1 px-2 h-full text-success"
      title={t('remoteBackend.indicatorTooltip', 'Chat/sessions run on a remote backend')}
      data-testid="remote-backend-indicator"
    >
      <Network className="w-3.5 h-3.5" />
      <span className="text-[11px] font-medium max-w-[140px] truncate">
        {t('remoteBackend.indicator', 'Remote: {{host}}', {
          host: remoteBackend.host ?? '',
        })}
      </span>
    </div>
  );
}

function ServerToggle() {
  const [status, setStatus] = useState<ServerStatusShape>({
    running: false,
    port: null,
    host: null,
    websocket: false,
  });
  const [busy, setBusy] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);

  // Initial fetch + light polling.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await window.electronAPI?.server?.status();
        if (!cancelled && s) setStatus(s);
      } catch {
        /* ignore */
      }
    };
    void refresh();
    const id = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const toggle = async () => {
    if (busy || !window.electronAPI?.server) return;
    setBusy(true);
    try {
      const s = status.running
        ? await window.electronAPI.server.stop()
        : await window.electronAPI.server.start({});
      setStatus(s);
    } finally {
      setBusy(false);
    }
  };

  const tooltip = status.running
    ? `Stop Code Buddy server (running on ${status.host}:${status.port}${
        status.websocket ? ' +WS' : ''
      }) — right-click for activity dashboard`
    : status.error
      ? `Start Code Buddy server — last error: ${status.error}`
      : 'Start Code Buddy server (port 3000 + WS gateway 3001) — right-click for dashboard';

  return (
    <>
      <button
        onClick={() => void toggle()}
        onContextMenu={(e) => {
          e.preventDefault();
          setDashboardOpen(true);
        }}
        disabled={busy}
        className="relative w-10 h-full flex items-center justify-center titlebar-no-drag hover:bg-surface transition-colors disabled:opacity-50"
        title={tooltip}
        aria-label={status.running ? 'Stop Code Buddy server' : 'Start Code Buddy server'}
        data-testid="server-toggle-button"
      >
        {busy ? (
          <Loader2 className="w-4 h-4 text-text-secondary animate-spin" />
        ) : (
          <Power
            className={`w-4 h-4 ${
              status.running ? 'text-success' : status.error ? 'text-error' : 'text-text-secondary'
            }`}
          />
        )}
        {status.running && !busy && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-success animate-pulse" />
        )}
      </button>
      <ServerDashboard isOpen={dashboardOpen} onClose={() => setDashboardOpen(false)} />
    </>
  );
}
