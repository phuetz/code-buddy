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
import { GuidedTooltip } from './Tooltip';

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

const SHELL_HELP: Record<string, string> = {
  'work-home': 'Reviens à ton espace de travail principal et à la conversation active.',
  'new-task': 'Démarre une session propre pour une nouvelle demande.',
  'global-search': 'Retrouve sessions, messages, mémoire, fichiers et connaissances depuis un seul endroit.',
  orchestrator: 'Lance une équipe de plusieurs agents pour comparer les approches et paralléliser le travail.',
  team: 'Coordonne les agents, leurs rôles, leurs décisions et leur contexte partagé.',
  'fleet-command': 'Supervise les pairs Fleet et les échanges multi-LLM en temps réel.',
  autonomy: 'Observe et règle le niveau d’autonomie, les limites et les validations humaines.',
  workflows: 'Compose des workflows réutilisables avec étapes, conditions, boucles et approbations.',
  'live-launcher': 'Lance une recherche ou une mission structurée avec mesure des résultats.',
  'mission-board': 'Organise les missions, leur avancement et les prochaines actions.',
  assistant: 'Configure l’assistant vocal, le TTS local, le volume et les interruptions.',
  skills: 'Installe, inspecte et autorise les skills qui étendent les capacités de l’agent.',
  plugins: 'Gère les extensions et les intégrations qui ajoutent de nouveaux outils.',
};

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
        {
          id: 'focus',
          label: t('focusView.title', 'Focus view'),
          icon: Focus,
          active: showFocusView,
          onClick: () => setShowFocusView(true),
          testId: 'focus-view-button',
        },
        {
          id: 'bookmarks',
          label: t('bookmarks.title', 'Bookmarks'),
          icon: Star,
          active: showBookmarksPanel,
          onClick: () => setShowBookmarksPanel(true),
          testId: 'bookmarks-button',
        },
      ],
    },
    {
      id: 'agents',
      label: t('shell.agentsFleet', 'Agents & Fleet'),
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
          id: 'team',
          label: t('shell.team', 'Agent Team'),
          icon: Users,
          active: showTeamPanel,
          onClick: () => setShowTeamPanel(true),
          testId: 'team-panel-button',
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
          id: 'autonomy',
          label: t('autonomy.title', 'Autonomy'),
          icon: Zap,
          active: showAutonomyPanel,
          onClick: () => setShowAutonomyPanel(true),
          testId: 'autonomy-panel-button',
        },
        {
          id: 'devices',
          label: t('devices.title', 'Paired devices'),
          icon: MonitorSmartphone,
          active: showDevicePanel,
          onClick: () => setShowDevicePanel(true),
          testId: 'devices-button',
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
          id: 'live-launcher',
          label: t('liveLauncher.title', 'Research / Flow launcher'),
          icon: Telescope,
          active: showLiveLauncher,
          onClick: () => setShowLiveLauncher(true),
          testId: 'live-launcher-button',
        },
        {
          id: 'mission-board',
          label: t('missionBoard.title', 'Mission Board'),
          icon: ClipboardList,
          active: showMissionBoard,
          onClick: () => setShowMissionBoard(true),
          testId: 'mission-board-button',
        },
        {
          id: 'desktop-snapshot',
          label: t('desktopSnapshot.title', 'Desktop Snapshot'),
          icon: MonitorSmartphone,
          active: showDesktopSnapshot,
          onClick: () => setShowDesktopSnapshot(true),
          testId: 'desktop-snapshot-button',
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
      id: 'companion',
      label: t('shell.companionGroup', 'Companion'),
      actions: [
        {
          id: 'companion',
          label: t('shell.companion', 'Buddy companion'),
          icon: Bot,
          active: showCompanionPanel,
          onClick: () => setShowCompanionPanel(true),
          testId: 'companion-panel-button',
        },
        {
          id: 'channels',
          label: t('channels.title', 'Delivery channels'),
          icon: Radio,
          active: showChannelsPanel,
          onClick: () => setShowChannelsPanel(true),
          testId: 'channels-button',
        },
        {
          id: 'mobile-supervision',
          label: t('mobileSupervision.title', 'Mobile supervision'),
          icon: Smartphone,
          active: showMobileSupervisionPanel,
          onClick: () => setShowMobileSupervisionPanel(true),
          testId: 'mobile-supervision-button',
        },
      ],
    },
    {
      id: 'insights',
      label: t('shell.insights', 'Insights & Learning'),
      actions: [
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
          id: 'reasoning',
          label: t('reasoningViewer.title', 'Reasoning traces'),
          icon: Lightbulb,
          active: showReasoningViewer,
          onClick: () => setShowReasoningViewer(true),
          testId: 'reasoning-viewer-button',
        },
        {
          id: 'memory',
          label: t('memoryBrowser.title', 'Memory'),
          icon: Database,
          active: showMemoryEditor,
          onClick: () => setShowMemoryEditor(true),
          testId: 'memory-panel-button',
        },
      ],
    },
    {
      id: 'system',
      label: t('shell.system', 'System'),
      actions: [
        {
          id: 'identity',
          label: t('identity.title', 'Agent identity'),
          icon: Fingerprint,
          active: showIdentityPanel,
          onClick: () => setShowIdentityPanel(true),
          testId: 'identity-button',
        },
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
          id: 'skills',
          label: t('skills.title', 'Skills'),
          icon: Blocks,
          active: showSkillsManager,
          onClick: () => setShowSkillsManager(true),
          testId: 'skills-manager-button',
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
  const Icon = action.icon;
  const description = SHELL_HELP[action.id] ?? `Ouvre ${action.label} et affiche ses outils disponibles.`;
  return (
    <GuidedTooltip title={action.label} description={description} kicker="Cowork" side="right">
      <button
        type="button"
        onClick={action.onClick}
        aria-label={action.label}
        data-testid={action.testId}
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
