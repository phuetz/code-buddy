import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plug } from 'lucide-react';
import { useAppStore } from '../store';
import { useActiveSessionId, useCurrentSession, usePermissionMode } from '../store/selectors';
import { APP_NAME } from '../brand';
import type { ExecutionMode, PermissionMode } from '../types';

import { ContextWindowGauge } from './ContextWindowGauge';
import { LiveBudgetMeter } from './LiveBudgetMeter';
import { YoloModeToggle } from './YoloModeToggle';
import { SessionIntelligenceBar } from './SessionIntelligenceBar';
import { PermissionModeSelector } from './PermissionModeSelector';
import { TaskModeToggle } from './TaskModeToggle';
import { BranchSwitcher } from './BranchSwitcher';
import { VoiceOutputToggle } from './VoiceOutputToggle';
import { CompanionThreadToggle } from './CompanionThreadToggle';

import { useIPC } from '../hooks/useIPC';

export function ChatHeader() {
  const { t } = useTranslation();
  const { isElectron, updateSessionSettings } = useIPC();
  const activeSessionId = useActiveSessionId();
  const activeSession = useCurrentSession();
  const permissionMode = usePermissionMode();
  const sessionPermissionMode = activeSession?.permissionMode ?? permissionMode;

  const [activeConnectors, setActiveConnectors] = useState<
    { id: string; name: string; connected: boolean; toolCount: number }[]
  >([]);

  const headerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const connectorMeasureRef = useRef<HTMLDivElement>(null);
  const [showConnectorLabel, setShowConnectorLabel] = useState(true);

  useEffect(() => {
    const titleEl = titleRef.current;
    const headerEl = headerRef.current;
    const measureEl = connectorMeasureRef.current;
    if (!titleEl || !headerEl || !measureEl) {
      setShowConnectorLabel(true);
      return;
    }
    const updateLabelVisibility = () => {
      const isTruncated = titleEl.scrollWidth > titleEl.clientWidth;
      const headerStyle = window.getComputedStyle(headerEl);
      const paddingLeft = Number.parseFloat(headerStyle.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(headerStyle.paddingRight) || 0;
      const contentWidth = headerEl.clientWidth - paddingLeft - paddingRight;
      const titleWidth = titleEl.getBoundingClientRect().width;
      const rightColumnWidth = Math.max(0, (contentWidth - titleWidth) / 2);
      const connectorFullWidth = measureEl.getBoundingClientRect().width;
      setShowConnectorLabel(!isTruncated && rightColumnWidth >= connectorFullWidth);
    };
    updateLabelVisibility();
    const observer = new ResizeObserver(updateLabelVisibility);
    observer.observe(headerEl);
    observer.observe(titleEl);
    observer.observe(measureEl);
    return () => observer.disconnect();
  }, [activeSession?.title, activeConnectors.length]);

  useEffect(() => {
    if (!isElectron || typeof window === 'undefined' || !window.electronAPI) return;

    const loadConnectors = async () => {
      try {
        const statuses = await window.electronAPI.mcp.getServerStatus();
        const active =
          (
            statuses as Array<{ id: string; name: string; connected: boolean; toolCount: number }>
          )?.filter((s) => s.connected && s.toolCount > 0) || [];
        setActiveConnectors(active);
      } catch (err) {
        console.error('Failed to load MCP connectors:', err);
      }
    };
    loadConnectors();
    const interval = setInterval(loadConnectors, 5000);
    return () => clearInterval(interval);
  }, [isElectron]);

  if (!activeSession) return null;

  return (
    <div
      ref={headerRef}
      className="relative h-12 border-b border-border-muted grid grid-cols-[1fr_auto_1fr] items-center px-4 lg:px-8 bg-background/88 backdrop-blur-md"
    >
      <div className="text-[11px] font-medium tracking-[0.08em] uppercase text-text-muted">
        {APP_NAME}
      </div>
      <h2
        ref={titleRef}
        className="text-[15px] font-medium text-text-primary text-center truncate max-w-[40vw] lg:max-w-[32rem]"
      >
        {activeSession.title}
      </h2>
      {activeConnectors.length > 0 && (
        <>
          <div
            ref={connectorMeasureRef}
            aria-hidden="true"
            className="absolute left-0 top-0 -z-10 opacity-0 pointer-events-none"
          >
            <div className="flex items-center gap-2 px-2 py-1 rounded-lg border border-mcp/20">
              <Plug className="w-3.5 h-3.5" />
              <span className="text-xs font-medium whitespace-nowrap">
                {t('chat.connectorCount', { count: activeConnectors.length })}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-mcp/8 border border-mcp/15 justify-self-end">
            <Plug className="w-3.5 h-3.5 text-mcp" />
            <span className="text-xs text-mcp font-medium">
              {showConnectorLabel
                ? t('chat.connectorCount', { count: activeConnectors.length })
                : activeConnectors.length}
            </span>
          </div>
        </>
      )}

      {/* Model switcher and permission mode */}
      <div className="flex items-center gap-1.5 justify-self-end">
        <ContextWindowGauge />
        <LiveBudgetMeter />
        <SessionIntelligenceBar />
        <CompanionThreadToggle
          session={activeSession}
          updateTags={(tags) => updateSessionSettings(activeSession.id, { tags })}
        />
        <YoloModeToggle />
        <PermissionModeSelector
          currentMode={sessionPermissionMode}
          onModeChange={(mode) => {
            useAppStore.getState().updateSession(activeSession.id, { permissionMode: mode });
            useAppStore.getState().setPermissionMode(mode);
            void window.electronAPI?.session?.updateSettings?.(activeSession.id, {
              permissionMode: mode as PermissionMode,
            });
          }}
        />
        {activeSession && (
          <TaskModeToggle
            mode={(activeSession.executionMode as ExecutionMode) ?? 'chat'}
            onChange={(newMode) => {
              // Optimistic local update
              useAppStore.getState().updateSession(activeSession.id, { executionMode: newMode });
              // Persist to DB
              void window.electronAPI?.session?.updateSettings?.(activeSession.id, {
                executionMode: newMode as unknown as 'chat' | 'task',
              });
              // If switching to task mode, auto-enable dontAsk permission mode
              if (newMode === 'task') {
                useAppStore.getState().updateSession(activeSession.id, { permissionMode: 'dontAsk' });
                useAppStore.getState().setPermissionMode('dontAsk');
                void window.electronAPI?.session?.updateSettings?.(activeSession.id, {
                  permissionMode: 'dontAsk',
                });
              }
            }}
          />
        )}
        {activeSessionId && <BranchSwitcher sessionId={activeSessionId} />}
        <VoiceOutputToggle />
      </div>
    </div>
  );
}
