/**
 * Exhaustive Cowork sidebar tree. Source of truth for screen help coverage:
 * every `id` here must have help copy in `en` and `fr`.
 *
 * Keep this list in lockstep with `ShellNavigation` — the sidebar builds from it.
 */
export const SHELL_NAV_TREE = [
  {
    id: 'work',
    actions: ['work-home', 'new-task', 'global-search', 'focus', 'bookmarks'],
  },
  {
    id: 'agents',
    actions: ['orchestrator', 'team', 'fleet-command', 'fleet-events', 'autonomy', 'devices'],
  },
  {
    id: 'automation',
    actions: [
      'workflows',
      'live-launcher',
      'mission-board',
      'desktop-snapshot',
      'schedule',
      'hooks',
      'commands',
    ],
  },
  {
    id: 'companion',
    actions: ['companion', 'channels', 'mobile-supervision'],
  },
  {
    id: 'insights',
    actions: [
      'activity',
      'session-insights',
      'test-runner',
      'lessons',
      'user-model',
      'spec',
      'reasoning',
      'memory',
    ],
  },
  {
    id: 'system',
    actions: ['identity', 'settings', 'api', 'connectors', 'rules', 'skills', 'plugins'],
  },
] as const;

export type ShellNavGroupId = (typeof SHELL_NAV_TREE)[number]['id'];
export type ShellNavScreenId = (typeof SHELL_NAV_TREE)[number]['actions'][number];

export const HELP_COPY_FIELDS = ['title', 'purpose', 'when', 'prerequisites'] as const;
export type HelpCopyField = (typeof HELP_COPY_FIELDS)[number];

/** Settings tabs that correspond to a sidebar screen. */
export const SETTINGS_TAB_TO_SCREEN: Record<string, ShellNavScreenId> = {
  workflows: 'workflows',
  schedule: 'schedule',
  hooks: 'hooks',
  customCommands: 'commands',
  api: 'api',
  connectors: 'connectors',
  rules: 'rules',
  plugins: 'plugins',
};

export function listShellNavScreenIds(): ShellNavScreenId[] {
  return SHELL_NAV_TREE.flatMap((group) => [...group.actions]);
}

export function helpCopyKey(screenId: string, field: HelpCopyField): string {
  return `helpDocs.screens.${screenId}.${field}`;
}

export function helpGroupKey(groupId: string): string {
  return `helpDocs.groups.${groupId}`;
}

export function settingsTabToScreenId(tab: string | null | undefined): ShellNavScreenId {
  if (tab && tab in SETTINGS_TAB_TO_SCREEN) {
    return SETTINGS_TAB_TO_SCREEN[tab]!;
  }
  return 'settings';
}
