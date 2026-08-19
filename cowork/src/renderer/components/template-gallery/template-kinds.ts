export type TemplateKind =
  | 'web-app'
  | 'landing'
  | 'dashboard'
  | 'slide-deck'
  | 'sheet'
  | 'doc'
  | 'report'
  | 'api'
  | 'mobile'
  | 'image';

export interface TemplateGalleryItem {
  id: string;
  kind: TemplateKind;
  name: string;
  tagline: string;
  accent?: string;
}

export const DEFAULT_TEMPLATES: TemplateGalleryItem[] = [
  { id: 'web-app', kind: 'web-app', name: 'Web app', tagline: 'A complete interface with navigation, panels and workspaces.', accent: '#6366f1' },
  { id: 'landing', kind: 'landing', name: 'Landing page', tagline: 'A marketing page with hero, proof points and calls to action.', accent: '#14b8a6' },
  { id: 'dashboard', kind: 'dashboard', name: 'Dashboard', tagline: 'Metrics, charts and cards to steer an activity.', accent: '#f59e0b' },
  { id: 'slide-deck', kind: 'slide-deck', name: 'Presentation', tagline: 'A structured deck with titles, bullets and narrative pacing.', accent: '#8b5cf6' },
  { id: 'sheet', kind: 'sheet', name: 'Spreadsheet', tagline: 'A grid ready to organize numbers, lists and calculations.', accent: '#22c55e' },
  { id: 'doc', kind: 'doc', name: 'Document', tagline: 'Clear text with titles, paragraphs and editorial structure.', accent: '#0ea5e9' },
  { id: 'report', kind: 'report', name: 'Report', tagline: 'A visual, magazine-style summary, readable at a glance.', accent: '#ef4444' },
  { id: 'api', kind: 'api', name: 'API', tagline: 'A technical contract with endpoints, statuses and methods.', accent: '#06b6d4' },
  { id: 'mobile', kind: 'mobile', name: 'Mobile', tagline: 'A compact screen designed for touch and quick flows.', accent: '#ec4899' },
  { id: 'image', kind: 'image', name: 'Image', tagline: 'A visual composition with frame, subject and mood.', accent: '#84cc16' },
];

export function filterTemplates<T extends TemplateGalleryItem>(items: readonly T[], query: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase('fr-FR');

  if (!normalizedQuery) {
    return [...items];
  }

  return items.filter((item) => {
    const searchable = `${item.name} ${item.tagline} ${item.kind}`.toLocaleLowerCase('fr-FR');
    return searchable.includes(normalizedQuery);
  });
}
