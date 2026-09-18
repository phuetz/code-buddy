import {
  BookOpenText,
  Bot,
  Clock3,
  Cpu,
  DollarSign,
  FlaskConical,
  GitBranch,
  Layers,
  Lock,
  Network,
  Plug,
  ScrollText,
  ServerCog,
  Settings,
  Shield,
  SlidersHorizontal,
  TerminalSquare,
  Users,
  Webhook,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { APP_NAME } from '../../brand';
import { SettingsContentSection } from './shared';

export type ControlCenterSettingsTab =
  | 'api'
  | 'codebuddy'
  | 'coreEngine'
  | 'profiles'
  | 'remoteBackend'
  | 'server'
  | 'sandbox'
  | 'rules'
  | 'connectors'
  | 'workflows'
  | 'schedule'
  | 'hooks'
  | 'customCommands'
  | 'logs'
  | 'cost'
  | 'telemetry'
  | 'projects'
  | 'instructions';

interface SettingsControlCenterProps {
  onNavigate: (tab: ControlCenterSettingsTab) => void;
  onOpenTestRunner: () => void;
  onOpenOrchestrator: () => void;
  onOpenFleet: () => void;
  onOpenTeam: () => void;
  onOpenCompanion: () => void;
}

interface ControlCenterAction {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  actionLabel: string;
  onClick: () => void;
}

function ControlCard({ item }: { item: ControlCenterAction }) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={item.onClick}
      data-testid={`control-center-${item.id}`}
      className="rounded-lg border border-border-muted bg-background px-4 py-4 text-left transition-colors hover:border-border hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-accent/40"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="rounded-md bg-accent/10 p-2 text-accent">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text-primary">{item.title}</div>
          <div className="mt-1 text-xs leading-5 text-text-muted">{item.description}</div>
          <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-accent">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {item.actionLabel}
          </div>
        </div>
      </div>
    </button>
  );
}

export function SettingsControlCenter({
  onNavigate,
  onOpenTestRunner,
  onOpenOrchestrator,
  onOpenFleet,
  onOpenTeam,
  onOpenCompanion,
}: SettingsControlCenterProps) {
  const { t } = useTranslation();
  const configureLabel = t('controlCenter.actionConfigure', 'Configure');
  const openLabel = t('controlCenter.actionOpen', 'Open');

  const sections: Array<{
    id: string;
    title: string;
    description: string;
    items: ControlCenterAction[];
  }> = [
    {
      id: 'runtime',
      title: t('controlCenter.runtimeTitle', 'Runtime and models'),
      description: t(
        'controlCenter.runtimeDesc',
        'Pick the provider, embedded backend, core engine, and local server contract.'
      ),
      items: [
        {
          id: 'api',
          title: t('settings.apiSettings', 'API Settings'),
          description: t('settings.apiSettingsDesc', 'Configure API provider and key'),
          icon: Settings,
          actionLabel: configureLabel,
          onClick: () => onNavigate('api'),
        },
        {
          id: 'codebuddy',
          title: 'Code Buddy',
          description: t('settings.codebuddyDesc', 'Local agentic backend with 110+ tools'),
          icon: TerminalSquare,
          actionLabel: configureLabel,
          onClick: () => onNavigate('codebuddy'),
        },
        {
          id: 'core-engine',
          title: t('settingsCoreEngine.tabLabel', 'Core engine'),
          description: t('settingsCoreEngine.tabHint', 'Pick the agentic loop'),
          icon: Cpu,
          actionLabel: configureLabel,
          onClick: () => onNavigate('coreEngine'),
        },
        {
          id: 'profiles',
          title: t('profiles.title', 'Config profiles'),
          description: t('profiles.tabHint', 'Isolated config profiles ([profiles.<name>])'),
          icon: Layers,
          actionLabel: configureLabel,
          onClick: () => onNavigate('profiles'),
        },
        {
          id: 'server',
          title: t('settingsServer.title', 'Embedded server'),
          description: t('settingsServer.hintShort', 'Configure port, JWT, websocket'),
          icon: ServerCog,
          actionLabel: configureLabel,
          onClick: () => onNavigate('server'),
        },
        {
          id: 'remote-backend',
          title: t('remoteBackend.title', 'Remote backend'),
          description: t('remoteBackend.tabHint', 'Run chat/sessions on a remote Code Buddy backend'),
          icon: Network,
          actionLabel: configureLabel,
          onClick: () => onNavigate('remoteBackend'),
        },
      ],
    },
    {
      id: 'guardrails',
      title: t('controlCenter.guardrailsTitle', 'Guardrails and access'),
      description: t(
        'controlCenter.guardrailsDesc',
        'Control the sandbox, permission rules, and external tool surfaces before agents act.'
      ),
      items: [
        {
          id: 'sandbox',
          title: t('settings.sandbox', 'Sandbox'),
          description: t('settings.sandboxDesc', 'Isolated execution environment'),
          icon: Shield,
          actionLabel: configureLabel,
          onClick: () => onNavigate('sandbox'),
        },
        {
          id: 'rules',
          title: t('settings.rules', 'Permission rules'),
          description: t('settings.rulesDesc', 'Allow/deny rules for tools and file paths'),
          icon: Lock,
          actionLabel: configureLabel,
          onClick: () => onNavigate('rules'),
        },
        {
          id: 'connectors',
          title: t('settings.connectors', 'MCP Connectors'),
          description: t('settings.connectorsDesc', 'Browser & tool integrations'),
          icon: Plug,
          actionLabel: configureLabel,
          onClick: () => onNavigate('connectors'),
        },
        {
          id: 'instructions',
          title: t('folderInstructions.title', 'Folder instructions'),
          description: t(
            'folderInstructions.tabHint',
            'Applied AGENTS.md files for the current folder, with origin and priority',
          ),
          icon: BookOpenText,
          actionLabel: configureLabel,
          onClick: () => onNavigate('instructions'),
        },
      ],
    },
    {
      id: 'automation',
      title: t('controlCenter.automationTitle', 'Automation and harness'),
      description: t(
        'controlCenter.automationDesc',
        'Build repeatable workflows, scheduled runs, hooks, slash commands, and QA harness runs.'
      ),
      items: [
        {
          id: 'workflows',
          title: t('settings.workflows', 'Workflows'),
          description: t('settings.workflowsDesc', 'Visual DAG editor for repeatable workflows'),
          icon: Workflow,
          actionLabel: configureLabel,
          onClick: () => onNavigate('workflows'),
        },
        {
          id: 'schedule',
          title: t('settings.schedule', 'Schedules'),
          description: t('settings.scheduleDesc', 'Alarm-style prompt automation'),
          icon: Clock3,
          actionLabel: configureLabel,
          onClick: () => onNavigate('schedule'),
        },
        {
          id: 'hooks',
          title: t('hooks.title', 'Hooks & triggers'),
          description: t('hooks.hint', 'Run shell or HTTP hooks on agent events'),
          icon: Webhook,
          actionLabel: configureLabel,
          onClick: () => onNavigate('hooks'),
        },
        {
          id: 'test-runner',
          title: t('testRunner.title', 'Test runner'),
          description: t(
            'controlCenter.testRunnerDesc',
            'Run quality bundles, real-provider checks, e2e smoke tests, and harness evidence.'
          ),
          icon: FlaskConical,
          actionLabel: openLabel,
          onClick: onOpenTestRunner,
        },
      ],
    },
    {
      id: 'agents',
      title: t('controlCenter.agentsTitle', 'Agents and fleet'),
      description: t(
        'controlCenter.agentsDesc',
        'Launch multi-agent work, route through peers, inspect team state, and open the companion.'
      ),
      items: [
        {
          id: 'orchestrator',
          title: t('shell.orchestrator', 'Spawn multi-agent team'),
          description: t(
            'controlCenter.orchestratorDesc',
            'Choose a strategy, max rounds, and start a supervised multi-agent run.'
          ),
          icon: GitBranch,
          actionLabel: openLabel,
          onClick: onOpenOrchestrator,
        },
        {
          id: 'fleet',
          title: t('fleet.title', 'Fleet Command Center'),
          description: t(
            'controlCenter.fleetDesc',
            'Dispatch goals across peers with privacy and routing controls.'
          ),
          icon: Network,
          actionLabel: openLabel,
          onClick: onOpenFleet,
        },
        {
          id: 'team',
          title: t('shell.team', 'Agent Team'),
          description: t(
            'controlCenter.teamDesc',
            'Inspect coordinated team members, tasks, mailbox, and progress.'
          ),
          icon: Users,
          actionLabel: openLabel,
          onClick: onOpenTeam,
        },
        {
          id: 'companion',
          title: t('shell.companion', 'Buddy companion'),
          description: t(
            'controlCenter.companionDesc',
            'Open the companion for voice, vision, missions, and readiness checks.'
          ),
          icon: Bot,
          actionLabel: openLabel,
          onClick: onOpenCompanion,
        },
      ],
    },
    {
      id: 'observability',
      title: t('controlCenter.observabilityTitle', 'Observability and cost'),
      description: t(
        'controlCenter.observabilityDesc',
        'Review logs, budgets, telemetry, and project memory boundaries.'
      ),
      items: [
        {
          id: 'logs',
          title: t('settings.logs', 'Logs'),
          description: t('settings.logsDesc', 'View and export application logs'),
          icon: ScrollText,
          actionLabel: configureLabel,
          onClick: () => onNavigate('logs'),
        },
        {
          id: 'cost',
          title: t('settings.cost', 'Cost'),
          description: t('settings.costDesc', 'Token usage, cost tracking, and budget limits'),
          icon: DollarSign,
          actionLabel: configureLabel,
          onClick: () => onNavigate('cost'),
        },
        {
          id: 'telemetry',
          title: t('telemetry.title', 'Telemetry & diagnostics'),
          description: t('telemetry.tabHint', 'Opt-in crash reporting, OTel traces, usage stats'),
          icon: ScrollText,
          actionLabel: configureLabel,
          onClick: () => onNavigate('telemetry'),
        },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      <SettingsContentSection
        title={t('controlCenter.title', '{{appName}} control center', { appName: APP_NAME })}
        description={t(
          'controlCenter.description',
          'A single launchpad for the settings and harness surfaces that control how Code Buddy runs, acts, routes, and proves work.'
        )}
      >
        <div className="grid gap-3 md:grid-cols-3" data-testid="control-center-quick-actions">
          <button
            type="button"
            onClick={() => onNavigate('api')}
            className="rounded-lg border border-border-muted bg-background px-4 py-3 text-left transition-colors hover:border-border hover:bg-surface-hover"
            data-testid="control-center-quick-api"
          >
            <div className="text-sm font-medium text-text-primary">
              {t('controlCenter.quickModel', 'Model')}
            </div>
            <div className="mt-1 text-xs text-text-muted">
              {t('controlCenter.quickModelDesc', 'Provider, key, and diagnostics')}
            </div>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('sandbox')}
            className="rounded-lg border border-border-muted bg-background px-4 py-3 text-left transition-colors hover:border-border hover:bg-surface-hover"
            data-testid="control-center-quick-sandbox"
          >
            <div className="text-sm font-medium text-text-primary">
              {t('controlCenter.quickSafety', 'Safety')}
            </div>
            <div className="mt-1 text-xs text-text-muted">
              {t('controlCenter.quickSafetyDesc', 'Sandbox and permissions')}
            </div>
          </button>
          <button
            type="button"
            onClick={onOpenTestRunner}
            className="rounded-lg border border-border-muted bg-background px-4 py-3 text-left transition-colors hover:border-border hover:bg-surface-hover"
            data-testid="control-center-quick-harness"
          >
            <div className="text-sm font-medium text-text-primary">
              {t('controlCenter.quickHarness', 'Harness')}
            </div>
            <div className="mt-1 text-xs text-text-muted">
              {t('controlCenter.quickHarnessDesc', 'Tests and evidence')}
            </div>
          </button>
        </div>
      </SettingsContentSection>

      {sections.map((section) => (
        <SettingsContentSection
          key={section.id}
          title={section.title}
          description={section.description}
        >
          <div className="grid gap-3 md:grid-cols-2">
            {section.items.map((item) => (
              <ControlCard key={item.id} item={item} />
            ))}
          </div>
        </SettingsContentSection>
      ))}
    </div>
  );
}
