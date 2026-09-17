import { useState, useRef, useEffect } from 'react';

import { useAppStore } from '../store';
import {
  Plus,
  Settings,
  Monitor,
  Moon,
  Sun,
  Activity,
  GitBranch,
  Network,
  BrainCircuit,
  Search,
  MessageSquare,
  Keyboard,
} from 'lucide-react';
import { APP_NAME } from '../brand';

export function TopMenuBar() {

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const settings = useAppStore((s) => s.settings);
  
  const setShowActivityFeed = useAppStore((s) => s.setShowActivityFeed);
  const setShowWorkflowProPanel = useAppStore((s) => s.setShowWorkflowProPanel);
  const setShowFleetCommandCenter = useAppStore((s) => s.setShowFleetCommandCenter);
  const setShowMemoryEditor = useAppStore((s) => s.setShowMemoryEditor);
  const setShowShortcutsDialog = useAppStore((s) => s.setShowShortcutsDialog);
  const setShowResumeChooser = useAppStore((s) => s.setShowResumeChooser);
  const setShowGlobalSearch = useAppStore((s) => s.setShowGlobalSearch);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMenuClick = (menuName: string) => {
    setOpenMenu(openMenu === menuName ? null : menuName);
  };

  const handleAction = (action: () => void) => {
    action();
    setOpenMenu(null);
  };

  const toggleTheme = () => {
    const cycle = ['light', 'dark', 'ember', 'genspark', 'codex', 'anthropic', 'system'] as const;
    const idx = cycle.indexOf(settings.theme as (typeof cycle)[number]);
    const next = cycle[(idx + 1) % cycle.length];
    updateSettings({ theme: next });
  };

  const themeIcon =
    settings.theme === 'dark' ? (
      <Moon strokeWidth={1.5} className="w-4 h-4" />
    ) : settings.theme === 'ember' ? (
      <Sun strokeWidth={1.5} className="w-4 h-4 text-accent" />
    ) : settings.theme === 'light' ? (
      <Sun strokeWidth={1.5} className="w-4 h-4" />
    ) : (
      <Monitor strokeWidth={1.5} className="w-4 h-4" />
    );

  const renderDropdown = (menuName: string, items: Array<{ label: string, icon: React.ReactNode, onClick: () => void, divider?: boolean, testId?: string }>) => {
    if (openMenu !== menuName) return null;
    return (
      <div className="absolute top-full left-0 mt-1 w-56 bg-surface border border-border-subtle rounded-md shadow-lg z-50 py-1">
        {items.map((item, idx) => (
          <div key={idx}>
            {item.divider && <div className="h-px bg-border-subtle my-1" />}
            <button
              onClick={() => handleAction(item.onClick)}
              className="w-full text-left px-4 py-2 text-sm text-text-primary hover:bg-surface-hover flex items-center gap-2"
            >
              <div className="w-4 flex justify-center text-text-muted">{item.icon}</div>
              <span>{item.label}</span>
            </button>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div ref={menuRef} className="flex items-center bg-surface border-b border-border-subtle h-10 px-2 gap-1 shrink-0 z-30 relative">
      <div className="font-medium text-sm px-3 text-text-primary mr-2 flex items-center gap-2 cursor-default">
        <span className="text-accent">★</span> {APP_NAME}
      </div>

      {/* Fichier */}
      <div className="relative h-full flex items-center">
        <button
          onClick={() => handleMenuClick('Fichier')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${openMenu === 'Fichier' ? 'bg-surface-hover text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'}`}
        >
          Fichier
        </button>
        {renderDropdown('Fichier', [
          { label: 'Nouvelle session', icon: <Plus strokeWidth={1.5} />, onClick: () => setActiveSession(null) },
          { label: 'Sessions...', icon: <MessageSquare strokeWidth={1.5} />, onClick: () => setShowResumeChooser(true) },
          { label: 'Paramètres', icon: <Settings strokeWidth={1.5} />, onClick: () => setShowSettings(true), divider: true },
        ])}
      </div>

      {/* Édition */}
      <div className="relative h-full flex items-center">
        <button
          onClick={() => handleMenuClick('Édition')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${openMenu === 'Édition' ? 'bg-surface-hover text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'}`}
        >
          Édition
        </button>
        {renderDropdown('Édition', [
          { label: 'Rechercher', icon: <Search strokeWidth={1.5} />, onClick: () => setShowGlobalSearch(true) },
        ])}
      </div>

      {/* Vue */}
      <div className="relative h-full flex items-center">
        <button
          onClick={() => handleMenuClick('Vue')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${openMenu === 'Vue' ? 'bg-surface-hover text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'}`}
        >
          Vue
        </button>
        {renderDropdown('Vue', [
          { label: 'Changer le thème', icon: themeIcon, onClick: toggleTheme },
          { label: 'Activité', icon: <Activity strokeWidth={1.5} />, onClick: () => setShowActivityFeed(true), testId: 'activity-button' },
          { label: 'Focus', icon: <Activity strokeWidth={1.5} />, onClick: () => useAppStore.getState().setShowFocusView(true), testId: 'focus-view-button' },
          { label: 'Signets', icon: <Activity strokeWidth={1.5} />, onClick: () => useAppStore.getState().setShowBookmarksPanel(true), testId: 'bookmarks-button', divider: true },
        ])}
      </div>

      {/* Outils */}
      <div className="relative h-full flex items-center">
        <button
          onClick={() => handleMenuClick('Outils')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${openMenu === 'Outils' ? 'bg-surface-hover text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'}`}
        >
          Outils
        </button>
        {renderDropdown('Outils', [
          { label: 'Workflows', icon: <GitBranch strokeWidth={1.5} />, onClick: () => setShowWorkflowProPanel(true), testId: 'workflows-button' },
          { label: 'Fleet', icon: <Network strokeWidth={1.5} />, onClick: () => setShowFleetCommandCenter(true), testId: 'fleet-command-center-button' },
          { label: 'Mémoire', icon: <BrainCircuit strokeWidth={1.5} />, onClick: () => setShowMemoryEditor(true), testId: 'memory-panel-button' },
          { label: 'Companion', icon: <BrainCircuit strokeWidth={1.5} />, onClick: () => useAppStore.getState().setShowCompanionPanel(true), testId: 'companion-panel-button' },
          { label: 'Orchestrateur', icon: <BrainCircuit strokeWidth={1.5} />, onClick: () => useAppStore.getState().setShowOrchestratorLauncher(true), testId: 'orchestrator-button' },
          { label: 'Autonomie', icon: <BrainCircuit strokeWidth={1.5} />, onClick: () => useAppStore.getState().setShowAutonomyPanel(true), testId: 'autonomy-panel-button' },
          { label: 'Équipe', icon: <BrainCircuit strokeWidth={1.5} />, onClick: () => useAppStore.getState().setShowTeamPanel(true), testId: 'team-panel-button' },
          { label: 'Insights', icon: <BrainCircuit strokeWidth={1.5} />, onClick: () => useAppStore.getState().setShowSessionInsights(true), testId: 'session-insights-button' },
          { label: 'Leçons', icon: <BrainCircuit strokeWidth={1.5} />, onClick: () => useAppStore.getState().setShowLessonCandidatePanel(true), testId: 'lesson-candidate-button' },
          { label: 'Specs', icon: <BrainCircuit strokeWidth={1.5} />, onClick: () => useAppStore.getState().setShowSpecPanel(true), testId: 'spec-panel-button' },
          { label: 'Modèle Utilisateur', icon: <BrainCircuit strokeWidth={1.5} />, onClick: () => useAppStore.getState().setShowUserModelPanel(true), testId: 'user-model-button' },
          { label: 'Test Runner', icon: <Search strokeWidth={1.5} />, onClick: () => useAppStore.getState().setShowTestRunner(true), testId: 'test-runner-button', divider: true },
        ])}
      </div>

      {/* Aide */}
      <div className="relative h-full flex items-center">
        <button
          onClick={() => handleMenuClick('Aide')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors ${openMenu === 'Aide' ? 'bg-surface-hover text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'}`}
        >
          Aide
        </button>
        {renderDropdown('Aide', [
          { label: 'Raccourcis clavier', icon: <Keyboard strokeWidth={1.5} />, onClick: () => setShowShortcutsDialog(true) },
          { label: 'Documentation', icon: <Keyboard strokeWidth={1.5} />, onClick: () => useAppStore.getState().setShowHelpDocs(true, null) },
        ])}
      </div>
    </div>
  );
}
