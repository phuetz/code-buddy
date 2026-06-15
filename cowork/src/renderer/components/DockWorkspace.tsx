import { useEffect, useRef, Suspense } from 'react';
import DockLayout, { LayoutData } from 'rc-dock';
import 'rc-dock/dist/rc-dock.css';
import { useAppStore } from '../store';
import { useActiveSessionId, useSettingsState } from '../store/selectors';
import { PanelErrorBoundary } from './PanelErrorBoundary';
import { SplitPaneLayout } from './SplitPaneLayout';
import { WelcomeView } from './WelcomeView';
import { FilePreviewPane } from './FilePreviewPane';

// Lazy load the components used in tabs
import React from 'react';
const ChatView = React.lazy(() => import('./ChatView').then(m => ({ default: m.ChatView })));
const ContextPanel = React.lazy(() => import('./ContextPanel').then(m => ({ default: m.ContextPanel })));
const SettingsPanel = React.lazy(() => import('./SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const AutonomyPanel = React.lazy(() => import('./AutonomyPanel').then(m => ({ default: m.AutonomyPanel })));
const ReasoningTraceViewer = React.lazy(() => import('./ReasoningTraceViewer').then(m => ({ default: m.ReasoningTraceViewer })));

function MainPanelFallback() {
  return (
    <div className="flex-1 min-h-0 bg-background px-6 py-6 h-full w-full">
      <div className="h-full rounded-[1.75rem] border border-border-subtle bg-background/70" />
    </div>
  );
}

function ContextPanelFallback() {
  return (
    <div className="w-full h-full border-l border-border-subtle bg-background/60" aria-hidden="true" />
  );
}

export function DockWorkspace() {
  const dockRef = useRef<DockLayout>(null);
  const activeSessionId = useActiveSessionId();
  const { showSettings } = useSettingsState();
  const contextPanelCollapsed = useAppStore((s) => s.contextPanelCollapsed);
  const splitPaneEnabled = useAppStore((s) => s.splitPaneEnabled);
  const showReasoningViewer = useAppStore((s) => s.showReasoningViewer);
  const showAutonomyPanel = useAppStore((s) => s.showAutonomyPanel);

  const setShowReasoningViewer = useAppStore((s) => s.setShowReasoningViewer);
  const setShowAutonomyPanel = useAppStore((s) => s.setShowAutonomyPanel);
  const setShowSettings = useAppStore((s) => s.setShowSettings);

  // Initial Layout
  const defaultLayout: LayoutData = {
    dockbox: {
      mode: 'horizontal',
      children: [
        {
          id: 'mainPanel',
          tabs: [
            {
              id: 'chat',
              title: 'Chat',
              closable: false,
              content: activeSessionId ? (
                <PanelErrorBoundary name="ChatView" resetKey={activeSessionId} fallback={<MainPanelFallback />}>
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
              ),
            }
          ]
        },
        ...(!contextPanelCollapsed && activeSessionId ? [{
          id: 'contextPanel',
          size: 300,
          tabs: [
            {
              id: 'context',
              title: 'Context',
              closable: false,
              content: (
                <PanelErrorBoundary name="ContextPanel" resetKey={activeSessionId} fallback={<ContextPanelFallback />}>
                  <Suspense fallback={<ContextPanelFallback />}>
                    <ContextPanel />
                  </Suspense>
                </PanelErrorBoundary>
              )
            }
          ]
        }] : [])
      ]
    }
  };

  // Watch for external triggers to open panels
  useEffect(() => {
    if (showReasoningViewer && dockRef.current) {
      if (!dockRef.current.find('reasoning')) {
        dockRef.current.dockMove({
          id: 'reasoning',
          title: 'Reasoning Trace',
          closable: true,
          content: (
            <Suspense fallback={<MainPanelFallback />}>
              <ReasoningTraceViewer isOpen={true} onClose={() => setShowReasoningViewer(false)} />
            </Suspense>
          )
        }, 'mainPanel', 'middle');
      }
    } else if (!showReasoningViewer && dockRef.current) {
      const tab = dockRef.current.find('reasoning');
      if (tab) {
        // user might have closed it, but if it's still there and state says false, we might want to remove it
        // Or we let the dock drive the state. 
      }
    }
  }, [showReasoningViewer, setShowReasoningViewer]);

  useEffect(() => {
    if (showAutonomyPanel && dockRef.current) {
      if (!dockRef.current.find('autonomy')) {
        dockRef.current.dockMove({
          id: 'autonomy',
          title: 'Autonomy',
          closable: true,
          content: (
            <Suspense fallback={<MainPanelFallback />}>
              <AutonomyPanel isOpen={true} onClose={() => setShowAutonomyPanel(false)} />
            </Suspense>
          )
        }, 'mainPanel', 'middle');
      }
    }
  }, [showAutonomyPanel, setShowAutonomyPanel]);

  useEffect(() => {
    if (showSettings && dockRef.current) {
      if (!dockRef.current.find('settings')) {
        dockRef.current.dockMove({
          id: 'settings',
          title: 'Settings',
          closable: true,
          content: (
            <Suspense fallback={<MainPanelFallback />}>
              <SettingsPanel onClose={() => setShowSettings(false)} />
            </Suspense>
          )
        }, 'mainPanel', 'middle');
      }
    } else if (!showSettings && dockRef.current) {
      // If closed externally
    }
  }, [showSettings, setShowSettings]);


  return (
    <div className="w-full h-full rc-dock-theme-dark bg-background [&_.dock-panel]:bg-background [&_.dock-bar]:bg-surface [&_.dock-tab]:bg-surface [&_.dock-tab-active]:bg-surface-hover [&_.dock-ink-bar]:bg-accent text-text-primary">
      <DockLayout 
        ref={dockRef} 
        defaultLayout={defaultLayout} 
        style={{ position: 'absolute', inset: 0 }}
      />
    </div>
  );
}
