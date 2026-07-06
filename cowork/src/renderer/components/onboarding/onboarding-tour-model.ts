export type TourStep = {
  id: string;
  title: string;
  body: string;
  railGlyph?: string;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'chat-home',
    title: 'Chat et accueil',
    body: 'Démarrez une conversation, reprenez votre session et gardez le fil de votre travail.',
    railGlyph: '💬',
  },
  {
    id: 'app-studio',
    title: 'App Studio',
    body: 'Transformez une idée en prototype, page ou mini-application avec l’aide des agents.',
    railGlyph: '✦',
  },
  {
    id: 'creations',
    title: 'Créations',
    body: 'Retrouvez vos livrables générés : documents, visuels, workflows et exports prêts à partager.',
    railGlyph: '◼',
  },
  {
    id: 'capabilities',
    title: 'Capacités',
    body: 'Explorez les outils disponibles, activez des compétences et composez votre espace de travail.',
    railGlyph: '⚙',
  },
  {
    id: 'mission-control',
    title: 'Mission Control',
    body: 'Pilotez les missions longues, suivez l’avancement et coordonnez les agents spécialisés.',
    railGlyph: '◆',
  },
  {
    id: 'history',
    title: 'Historique',
    body: 'Revenez à vos conversations, décisions et résultats récents sans perdre le contexte.',
    railGlyph: '🕘',
  },
  {
    id: 'command-palette',
    title: 'Palette ⌘K',
    body: 'Ouvrez vite une action, une vue ou une commande : ⌘K sur Mac, Ctrl+K ailleurs.',
    railGlyph: '⌘K',
  },
];

export function nextStep(index: number, total: number, direction: 'next' | 'prev'): number {
  if (total <= 0) return 0;
  const delta = direction === 'next' ? 1 : -1;
  return Math.min(Math.max(index + delta, 0), total - 1);
}
