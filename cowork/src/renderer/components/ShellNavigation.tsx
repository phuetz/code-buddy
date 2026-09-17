import {
  Activity,
  BarChart3,
  Blocks,
  Bot,
  Brain,
  Clock3,
  ClipboardList,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  Focus,
  GraduationCap,
  Lightbulb,
  ListChecks,
  Smartphone,
  Fingerprint,
  MonitorSmartphone,
  Radio,
  MessageSquare,
  Network,
  Package,
  Plug,
  Plus,
  Search,
  Settings,
  Shield,
  SlashSquare,
  Sparkles,
  Star,
  Telescope,
  Users,
  Webhook,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { SHELL_NAV_TREE, helpCopyKey } from '../help/shell-nav-catalog';
import { GuidedTooltip } from './Tooltip';

interface ShellNavAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
  testId?: string;
}

type ShellNavActionDef = Omit<ShellNavAction, 'id' | 'label'> & {
  label?: string;
  labelKey?: string;
  labelFallback?: string;
};

interface ShellNavGroup {
  id: string;
  label: string;
  actions: ShellNavAction[];
}

export function ShellNavigation() {
  const { t } = useTranslation();
  const showSettings = useAppStore((s) => s.showSettings);
  const showFleetPanel = useAppStore((s) => s.showFleetPanel);
  const showFleetCommandCenter = useAppStore((s) => s.showFleetCommandCenter);
  const showTeamPanel = useAppStore((s) => s.showTeamPanel);
  const showLessonCandidatePanel = useAppStore((s) => s.showLessonCandidatePanel);
  const showUserModelPanel = useAppStore((s) => s.showUserModelPanel);
  const showSpecPanel = useAppStore((s) => s.showSpecPanel);
  const showCompanionPanel = useAppStore((s) => s.showCompanionPanel);
  const showBookmarksPanel = useAppStore((s) => s.showBookmarksPanel);
  const showActivityFeed = useAppStore((s) => s.showActivityFeed);
  const showSessionInsights = useAppStore((s) => s.showSessionInsights);
  const showFocusView = useAppStore((s) => s.showFocusView);
  const showTestRunner = useAppStore((s) => s.showTestRunner);
  const showOrchestratorLauncher = useAppStore((s) => s.showOrchestratorLauncher);
  const showGlobalSearch = useAppStore((s) => s.showGlobalSearch);
  const showMissionBoard = useAppStore((s) => s.showMissionBoard);
  const showDesktopSnapshot = useAppStore((s) => s.showDesktopSnapshot);
  const showSkillsManager = useAppStore((s) => s.showSkillsManager);
  const setShowSkillsManager = useAppStore((s) => s.setShowSkillsManager);
  const showReasoningViewer = useAppStore((s) => s.showReasoningViewer);
  const setShowReasoningViewer = useAppStore((s) => s.setShowReasoningViewer);
  const showMemoryEditor = useAppStore((s) => s.showMemoryEditor);
  const setShowMemoryEditor = useAppStore((s) => s.setShowMemoryEditor);
  const showAutonomyPanel = useAppStore((s) => s.showAutonomyPanel);
  const setShowAutonomyPanel = useAppStore((s) => s.setShowAutonomyPanel);
  const showLiveLauncher = useAppStore((s) => s.showLiveLauncher);
  const setShowLiveLauncher = useAppStore((s) => s.setShowLiveLauncher);

  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setSettingsTab = useAppStore((s) => s.setSettingsTab);
  const setShowOrchestratorLauncher = useAppStore((s) => s.setShowOrchestratorLauncher);
  const setShowFleetPanel = useAppStore((s) => s.setShowFleetPanel);
  const setShowFleetCommandCenter = useAppStore((s) => s.setShowFleetCommandCenter);
  const setShowTeamPanel = useAppStore((s) => s.setShowTeamPanel);
  const setShowLessonCandidatePanel = useAppStore((s) => s.setShowLessonCandidatePanel);
  const setShowUserModelPanel = useAppStore((s) => s.setShowUserModelPanel);
  const setShowSpecPanel = useAppStore((s) => s.setShowSpecPanel);
  const showMobileSupervisionPanel = useAppStore((s) => s.showMobileSupervisionPanel);
  const setShowMobileSupervisionPanel = useAppStore((s) => s.setShowMobileSupervisionPanel);
  const showIdentityPanel = useAppStore((s) => s.showIdentityPanel);
  const setShowIdentityPanel = useAppStore((s) => s.setShowIdentityPanel);
  const showDevicePanel = useAppStore((s) => s.showDevicePanel);
  const setShowDevicePanel = useAppStore((s) => s.setShowDevicePanel);
  const showChannelsPanel = useAppStore((s) => s.showChannelsPanel);
  const setShowChannelsPanel = useAppStore((s) => s.setShowChannelsPanel);
  const setShowCompanionPanel = useAppStore((s) => s.setShowCompanionPanel);
  const setShowBookmarksPanel = useAppStore((s) => s.setShowBookmarksPanel);
  const setShowActivityFeed = useAppStore((s) => s.setShowActivityFeed);
  const setShowSessionInsights = useAppStore((s) => s.setShowSessionInsights);
  const setShowFocusView = useAppStore((s) => s.setShowFocusView);
  const setShowTestRunner = useAppStore((s) => s.setShowTestRunner);
  const setShowGlobalSearch = useAppStore((s) => s.setShowGlobalSearch);
  const setShowMissionBoard = useAppStore((s) => s.setShowMissionBoard);
  const setShowDesktopSnapshot = useAppStore((s) => s.setShowDesktopSnapshot);

  const openSettingsTab = (tab: string | null) => {
    setSettingsTab(tab);
    setShowSettings(true);
  };

  const actionById: Record<string, ShellNavActionDef> = {
    'work-home': {
      labelKey: 'shell.workHome',
      labelFallback: 'Work surface',
      icon: MessageSquare,
      active: !showSettings,
      onClick: () => setShowSettings(false),
    },
    'new-task': {
      labelKey: 'sidebar.newTask',
      labelFallback: 'New task',
      icon: Plus,
      onClick: () => {
        setShowSettings(false);
        setActiveSession(null);
      },
    },
    'global-search': {
      labelKey: 'globalSearch.placeholder',
      labelFallback: 'Search sessions, messages, memory, knowledge, files...',
      icon: Search,
      active: showGlobalSearch,
      onClick: () => setShowGlobalSearch(true),
    },
    focus: {
      labelKey: 'focusView.title',
      labelFallback: 'Focus view',
      icon: Focus,
      active: showFocusView,
      onClick: () => setShowFocusView(true),
      testId: 'focus-view-button',
    },
    bookmarks: {
      labelKey: 'bookmarks.title',
      labelFallback: 'Bookmarks',
      icon: Star,
      active: showBookmarksPanel,
      onClick: () => setShowBookmarksPanel(true),
      testId: 'bookmarks-button',
    },
    orchestrator: {
      labelKey: 'shell.orchestrator',
      labelFallback: 'Spawn multi-agent team',
      icon: Sparkles,
      active: showOrchestratorLauncher,
      onClick: () => setShowOrchestratorLauncher(true),
      testId: 'orchestrator-button',
    },
    team: {
      labelKey: 'shell.team',
      labelFallback: 'Agent Team',
      icon: Users,
      active: showTeamPanel,
      onClick: () => setShowTeamPanel(true),
      testId: 'team-panel-button',
    },
    'fleet-command': {
      labelKey: 'fleet.title',
      labelFallback: 'Fleet Command Center',
      icon: Cpu,
      active: showFleetCommandCenter,
      onClick: () => setShowFleetCommandCenter(true),
      testId: 'fleet-command-center-button',
    },
    'fleet-events': {
      labelKey: 'shell.fleetEvents',
      labelFallback: 'Fleet peer events',
      icon: Network,
      active: showFleetPanel,
      onClick: () => setShowFleetPanel(true),
      testId: 'fleet-panel-button',
    },
    autonomy: {
      labelKey: 'autonomy.title',
      labelFallback: 'Autonomy',
      icon: Zap,
      active: showAutonomyPanel,
      onClick: () => setShowAutonomyPanel(true),
      testId: 'autonomy-panel-button',
    },
    devices: {
      labelKey: 'devices.title',
      labelFallback: 'Paired devices',
      icon: MonitorSmartphone,
      active: showDevicePanel,
      onClick: () => setShowDevicePanel(true),
      testId: 'devices-button',
    },
    workflows: {
      labelKey: 'settings.workflows',
      labelFallback: 'Workflows',
      icon: Workflow,
      onClick: () => openSettingsTab('workflows'),
      testId: 'workflows-button',
    },
    'live-launcher': {
      labelKey: 'liveLauncher.title',
      labelFallback: 'Research / Flow launcher',
      icon: Telescope,
      active: showLiveLauncher,
      onClick: () => setShowLiveLauncher(true),
      testId: 'live-launcher-button',
    },
    'mission-board': {
      label: t('missionBoard.title', 'Mission Board'),
      icon: ClipboardList,
      active: showMissionBoard,
      onClick: () => setShowMissionBoard(true),
      testId: 'mission-board-button',
    },
    'desktop-snapshot': {
      label: t('desktopSnapshot.title', 'Desktop Snapshot'),
      icon: MonitorSmartphone,
      active: showDesktopSnapshot,
      onClick: () => setShowDesktopSnapshot(true),
      testId: 'desktop-snapshot-button',
    },
    schedule: {
      labelKey: 'settings.schedule',
      labelFallback: 'Schedules',
      icon: Clock3,
      onClick: () => openSettingsTab('schedule'),
    },
    hooks: {
      labelKey: 'hooks.title',
      labelFallback: 'Hooks & triggers',
      icon: Webhook,
      onClick: () => openSettingsTab('hooks'),
    },
    commands: {
      labelKey: 'customCommands.title',
      labelFallback: 'Custom commands',
      icon: SlashSquare,
      onClick: () => openSettingsTab('customCommands'),
    },
    companion: {
      labelKey: 'shell.companion',
      labelFallback: 'Buddy companion',
      icon: Bot,
      active: showCompanionPanel,
      onClick: () => setShowCompanionPanel(true),
      testId: 'companion-panel-button',
    },
    channels: {
      labelKey: 'channels.title',
      labelFallback: 'Delivery channels',
      icon: Radio,
      active: showChannelsPanel,
      onClick: () => setShowChannelsPanel(true),
      testId: 'channels-button',
    },
    'mobile-supervision': {
      labelKey: 'mobileSupervision.title',
      labelFallback: 'Mobile supervision',
      icon: Smartphone,
      active: showMobileSupervisionPanel,
      onClick: () => setShowMobileSupervisionPanel(true),
      testId: 'mobile-supervision-button',
    },
    activity: {
      labelKey: 'activity.title',
      labelFallback: 'Activity',
      icon: Activity,
      active: showActivityFeed,
      onClick: () => setShowActivityFeed(true),
      testId: 'activity-button',
    },
    'session-insights': {
      labelKey: 'sessionInsights.title',
      labelFallback: 'Session insights',
      icon: BarChart3,
      active: showSessionInsights,
      onClick: () => setShowSessionInsights(true),
      testId: 'session-insights-button',
    },
    'test-runner': {
      labelKey: 'testRunner.title',
      labelFallback: 'Test runner',
      icon: FlaskConical,
      active: showTestRunner,
      onClick: () => setShowTestRunner(true),
      testId: 'test-runner-button',
    },
    lessons: {
      labelKey: 'lessonCandidate.title',
      labelFallback: 'Lesson candidates',
      icon: GraduationCap,
      active: showLessonCandidatePanel,
      onClick: () => setShowLessonCandidatePanel(true),
      testId: 'lesson-candidate-button',
    },
    'user-model': {
      labelKey: 'userModel.title',
      labelFallback: 'User model',
      icon: Brain,
      active: showUserModelPanel,
      onClick: () => setShowUserModelPanel(true),
      testId: 'user-model-button',
    },
    spec: {
      labelKey: 'spec.title',
      labelFallback: 'Spec backlog',
      icon: ListChecks,
      active: showSpecPanel,
      onClick: () => setShowSpecPanel(true),
      testId: 'spec-panel-button',
    },
    reasoning: {
      labelKey: 'reasoningViewer.title',
      labelFallback: 'Reasoning traces',
      icon: Lightbulb,
      active: showReasoningViewer,
      onClick: () => setShowReasoningViewer(true),
      testId: 'reasoning-viewer-button',
    },
    memory: {
      labelKey: 'memoryBrowser.title',
      labelFallback: 'Memory',
      icon: Database,
      active: showMemoryEditor,
      onClick: () => setShowMemoryEditor(true),
      testId: 'memory-panel-button',
    },
    identity: {
      labelKey: 'identity.title',
      labelFallback: 'Agent identity',
      icon: Fingerprint,
      active: showIdentityPanel,
      onClick: () => setShowIdentityPanel(true),
      testId: 'identity-button',
    },
    settings: {
      labelKey: 'settings.title',
      labelFallback: 'Settings',
      icon: Settings,
      active: showSettings,
      onClick: () => openSettingsTab(null),
      testId: 'shell-settings-button',
    },
    api: {
      labelKey: 'settings.apiSettings',
      labelFallback: 'API Settings',
      icon: FileText,
      onClick: () => openSettingsTab('api'),
    },
    connectors: {
      labelKey: 'settings.connectors',
      labelFallback: 'MCP Connectors',
      icon: Plug,
      onClick: () => openSettingsTab('connectors'),
    },
    rules: {
      labelKey: 'settings.rules',
      labelFallback: 'Permission rules',
      icon: Shield,
      onClick: () => openSettingsTab('rules'),
    },
    skills: {
      labelKey: 'skills.title',
      labelFallback: 'Skills',
      icon: Blocks,
      active: showSkillsManager,
      onClick: () => setShowSkillsManager(true),
      testId: 'skills-manager-button',
    },
    plugins: {
      labelKey: 'plugins.title',
      labelFallback: 'Plugins',
      icon: Package,
      onClick: () => openSettingsTab('plugins'),
    },
  };

  const groupLabels: Record<string, { key: string; fallback: string }> = {
    work: { key: 'shell.work', fallback: 'Work' },
    agents: { key: 'shell.agentsFleet', fallback: 'Agents & Fleet' },
    automation: { key: 'shell.automation', fallback: 'Automation' },
    companion: { key: 'shell.companionGroup', fallback: 'Companion' },
    insights: { key: 'shell.insights', fallback: 'Insights & Learning' },
    system: { key: 'shell.system', fallback: 'System' },
  };

  const groups: ShellNavGroup[] = SHELL_NAV_TREE.map((group) => ({
    id: group.id,
    label: t(groupLabels[group.id]?.key ?? group.id, groupLabels[group.id]?.fallback ?? group.id),
    actions: group.actions.map((id) => {
      const def = actionById[id];
      if (!def) {
        throw new Error(`Shell navigation is missing action "${id}"`);
      }
      const { label, labelKey, labelFallback, ...rest } = def;
      return {
        id,
        label: label ?? t(labelKey ?? id, labelFallback ?? id),
        ...rest,
      };
    }),
  }));

  return (
    // Always-expanded sidebar: labels + group headers visible by default.
    <nav
      aria-label={t('shell.navigation', 'Cowork navigation')}
      className="flex w-60 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-border-muted bg-background-secondary/95"
    >
      <div className="flex flex-col gap-3 px-2 py-3">
        {groups.map((group) => (
          <div
            key={group.id}
            className="border-b border-border-muted/60 pb-3 last:border-b-0 last:pb-0"
          >
            <div className="mb-1 px-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted/70">
              {group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.actions.map((action) => (
                <ShellNavButton key={action.id} action={action} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

function ShellNavButton({ action }: { action: ShellNavAction }) {
  const { t } = useTranslation();
  const Icon = action.icon;
  const description = t(
    helpCopyKey(action.id, 'purpose'),
    `Ouvre ${action.label} et affiche ses outils disponibles.`
  );
  return (
    <GuidedTooltip title={action.label} description={description} kicker="Cowork" side="right">
      <button
        type="button"
        onClick={action.onClick}
        aria-label={action.label}
        data-testid={action.testId}
        data-help-screen={action.id}
        className={`relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors ${
          action.active
            ? 'bg-accent/10 text-accent'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate text-[13px] font-medium">{action.label}</span>
        {action.active && (
          <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
        )}
      </button>
    </GuidedTooltip>
  );
}
