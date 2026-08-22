export type TourStep = {
  id: string;
  title: string;
  body: string;
  railGlyph?: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'chat-home',
    title: 'Chat & Home',
    body: 'Start a conversation, resume your session, and keep the thread of your work.',
    railGlyph: '💬',
  },
  {
    id: 'app-studio',
    title: 'App Studio',
    body: 'Turn an idea into a prototype, page, or mini-application with the help of agents.',
    railGlyph: '✦',
  },
  {
    id: 'creations',
    title: 'Creations',
    body: 'Find your generated deliverables: documents, visuals, workflows, and exports ready to share.',
    railGlyph: '◼',
  },
  {
    id: 'capabilities',
    title: 'Capabilities',
    body: 'Explore the available tools, enable skills, and compose your workspace.',
    railGlyph: '⚙',
  },
  {
    id: 'mission-control',
    title: 'Mission Control',
    body: 'Drive long-running missions, track progress, and coordinate specialized agents.',
    railGlyph: '◆',
  },
  {
    id: 'history',
    title: 'History',
    body: 'Jump back to your recent conversations, decisions, and results without losing context.',
    railGlyph: '🕘',
  },
  {
    id: 'command-palette',
    title: 'Palette ⌘K',
    body: 'Quickly open an action, a view, or a command: ⌘K on Mac, Ctrl+K elsewhere.',
    railGlyph: '⌘K',
  },
];

export function nextStep(index: number, total: number, direction: 'next' | 'prev'): number {
  if (total <= 0) return 0;
  const delta = direction === 'next' ? 1 : -1;
  return Math.min(Math.max(index + delta, 0), total - 1);
}
