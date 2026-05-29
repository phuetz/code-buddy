import {
  Activity,
  BarChart3,
  Bot,
  Brain,
  Clock3,
  Cpu,
  FileText,
  FlaskConical,
  Focus,
  GraduationCap,
  ListChecks,
  Smartphone,
  Fingerprint,
  MonitorSmartphone,
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
  Users,
  Webhook,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';

interface ShellNavAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active?: boolean;
  testId?: string;
}

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
  const setShowCompanionPanel = useAppStore((s) => s.setShowCompanionPanel);
  const setShowBookmarksPanel = useAppStore((s) => s.setShowBookmarksPanel);
  const setShowActivityFeed = useAppStore((s) => s.setShowActivityFeed);
  const setShowSessionInsights = useAppStore((s) => s.setShowSessionInsights);
  const setShowFocusView = useAppStore((s) => s.setShowFocusView);
  const setShowTestRunner = useAppStore((s) => s.setShowTestRunner);
  const setShowGlobalSearch = useAppStore((s) => s.setShowGlobalSearch);

  const openSettingsTab = (tab: string | null) => {
    setSettingsTab(tab);
    setShowSettings(true);
  };

  const groups: ShellNavGroup[] = [
    {
      id: 'work',
      label: t('shell.work', 'Work'),
      actions: [
        {
          id: 'work-home',
          label: t('shell.workHome', 'Work surface'),
          icon: MessageSquare,
          active: !showSettings,
          onClick: () => setShowSettings(false),
        },
        {
          id: 'new-task',
          label: t('sidebar.newTask', 'New task'),
          icon: Plus,
          onClick: () => {
            setShowSettings(false);
            setActiveSession(null);
          },
        },
        {
          id: 'global-search',
          label: t(
            'globalSearch.placeholder',
            'Search sessions, messages, memory, knowledge, files...'
          ),
          icon: Search,
          active: showGlobalSearch,
          onClick: () => setShowGlobalSearch(true),
        },
      ],
    },
    {
      id: 'agents',
      label: t('shell.agents', 'Agents'),
      actions: [
        {
          id: 'orchestrator',
          label: t('shell.orchestrator', 'Spawn multi-agent team'),
          icon: Sparkles,
          active: showOrchestratorLauncher,
          onClick: () => setShowOrchestratorLauncher(true),
          testId: 'orchestrator-button',
        },
        {
          id: 'fleet-command',
          label: t('fleet.title', 'Fleet Command Center'),
          icon: Cpu,
          active: showFleetCommandCenter,
          onClick: () => setShowFleetCommandCenter(true),
          testId: 'fleet-command-center-button',
        },
        {
          id: 'fleet-events',
          label: t('shell.fleetEvents', 'Fleet peer events'),
          icon: Network,
          active: showFleetPanel,
          onClick: () => setShowFleetPanel(true),
          testId: 'fleet-panel-button',
        },
        {
          id: 'team',
          label: t('shell.team', 'Agent Team'),
          icon: Users,
          active: showTeamPanel,
          onClick: () => setShowTeamPanel(true),
          testId: 'team-panel-button',
        },
      ],
    },
    {
      id: 'automation',
      label: t('shell.automation', 'Automation'),
      actions: [
        {
          id: 'workflows',
          label: t('settings.workflows', 'Workflows'),
          icon: Workflow,
          onClick: () => openSettingsTab('workflows'),
          testId: 'workflows-button',
        },
        {
          id: 'schedule',
          label: t('settings.schedule', 'Schedules'),
          icon: Clock3,
          onClick: () => openSettingsTab('schedule'),
        },
        {
          id: 'hooks',
          label: t('hooks.title', 'Hooks & triggers'),
          icon: Webhook,
          onClick: () => openSettingsTab('hooks'),
        },
        {
          id: 'commands',
          label: t('customCommands.title', 'Custom commands'),
          icon: SlashSquare,
          onClick: () => openSettingsTab('customCommands'),
        },
      ],
    },
    {
      id: 'knowledge',
      label: t('shell.knowledge', 'Knowledge'),
      actions: [
        {
          id: 'bookmarks',
          label: t('bookmarks.title', 'Bookmarks'),
          icon: Star,
          active: showBookmarksPanel,
          onClick: () => setShowBookmarksPanel(true),
          testId: 'bookmarks-button',
        },
        {
          id: 'activity',
          label: t('activity.title', 'Activity'),
          icon: Activity,
          active: showActivityFeed,
          onClick: () => setShowActivityFeed(true),
          testId: 'activity-button',
        },
        {
          id: 'session-insights',
          label: t('sessionInsights.title', 'Session insights'),
          icon: BarChart3,
          active: showSessionInsights,
          onClick: () => setShowSessionInsights(true),
          testId: 'session-insights-button',
        },
        {
          id: 'focus',
          label: t('focusView.title', 'Focus view'),
          icon: Focus,
          active: showFocusView,
          onClick: () => setShowFocusView(true),
          testId: 'focus-view-button',
        },
        {
          id: 'test-runner',
          label: t('testRunner.title', 'Test runner'),
          icon: FlaskConical,
          active: showTestRunner,
          onClick: () => setShowTestRunner(true),
          testId: 'test-runner-button',
        },
        {
          id: 'lessons',
          label: t('lessonCandidate.title', 'Lesson candidates'),
          icon: GraduationCap,
          active: showLessonCandidatePanel,
          onClick: () => setShowLessonCandidatePanel(true),
          testId: 'lesson-candidate-button',
        },
        {
          id: 'user-model',
          label: t('userModel.title', 'User model'),
          icon: Brain,
          active: showUserModelPanel,
          onClick: () => setShowUserModelPanel(true),
          testId: 'user-model-button',
        },
        {
          id: 'spec',
          label: t('spec.title', 'Spec backlog'),
          icon: ListChecks,
          active: showSpecPanel,
          onClick: () => setShowSpecPanel(true),
          testId: 'spec-panel-button',
        },
        {
          id: 'mobile-supervision',
          label: t('mobileSupervision.title', 'Mobile supervision'),
          icon: Smartphone,
          active: showMobileSupervisionPanel,
          onClick: () => setShowMobileSupervisionPanel(true),
          testId: 'mobile-supervision-button',
        },
        {
          id: 'identity',
          label: t('identity.title', 'Agent identity'),
          icon: Fingerprint,
          active: showIdentityPanel,
          onClick: () => setShowIdentityPanel(true),
          testId: 'identity-button',
        },
        {
          id: 'devices',
          label: t('devices.title', 'Paired devices'),
          icon: MonitorSmartphone,
          active: showDevicePanel,
          onClick: () => setShowDevicePanel(true),
          testId: 'devices-button',
        },
        {
          id: 'companion',
          label: t('shell.companion', 'Buddy companion'),
          icon: Bot,
          active: showCompanionPanel,
          onClick: () => setShowCompanionPanel(true),
          testId: 'companion-panel-button',
        },
      ],
    },
    {
      id: 'system',
      label: t('shell.system', 'System'),
      actions: [
        {
          id: 'settings',
          label: t('settings.title', 'Settings'),
          icon: Settings,
          active: showSettings,
          onClick: () => openSettingsTab(null),
          testId: 'shell-settings-button',
        },
        {
          id: 'api',
          label: t('settings.apiSettings', 'API Settings'),
          icon: FileText,
          onClick: () => openSettingsTab('api'),
        },
        {
          id: 'connectors',
          label: t('settings.connectors', 'MCP Connectors'),
          icon: Plug,
          onClick: () => openSettingsTab('connectors'),
        },
        {
          id: 'rules',
          label: t('settings.rules', 'Permission rules'),
          icon: Shield,
          onClick: () => openSettingsTab('rules'),
        },
        {
          id: 'plugins',
          label: t('plugins.title', 'Plugins'),
          icon: Package,
          onClick: () => openSettingsTab('plugins'),
        },
      ],
    },
  ];

  return (
    <nav
      aria-label={t('shell.navigation', 'Cowork navigation')}
      className="w-[4.5rem] shrink-0 border-r border-border-muted bg-background-secondary/92 flex flex-col overflow-y-auto overflow-x-hidden"
    >
      <div className="flex flex-col items-center gap-3 py-3">
        {groups.map((group) => (
          <div
            key={group.id}
            className="w-full px-2 pb-3 border-b border-border-muted/70 last:border-b-0 last:pb-0"
          >
            <div className="mb-1 text-center text-[8px] font-semibold uppercase tracking-[0.12em] text-text-muted/70">
              {group.label.slice(0, 3)}
            </div>
            <div className="flex flex-col items-center gap-1">
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
  const Icon = action.icon;
  return (
    <button
      type="button"
      onClick={action.onClick}
      title={action.label}
      aria-label={action.label}
      data-testid={action.testId}
      className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
        action.active
          ? 'bg-accent/10 text-accent'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
      }`}
    >
      <Icon className="h-4 w-4" />
      {action.active && (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
      )}
    </button>
  );
}
