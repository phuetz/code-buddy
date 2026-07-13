export type ShortcutAction =
  | 'commandPalette' | 'globalSearch' | 'shortcuts' | 'settings' | 'sessionSearch'
  | 'toggleSidebar' | 'toggleSplitPane' | 'snippets' | 'persona' | 'tests'
  | 'reasoning' | 'orchestrator' | 'subagents' | 'diagnostics' | 'quickAsk'
  | 'insights' | 'resume' | 'focus' | 'skills' | 'fileActivity';

export interface ShortcutDefinition {
  action: ShortcutAction;
  label: string;
  section: 'Général' | 'Navigation' | 'Panneaux' | 'Multi-agent';
  defaultBinding: string;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { action: 'commandPalette', label: 'Ouvrir la palette de commandes', section: 'Général', defaultBinding: 'Mod+K' },
  { action: 'globalSearch', label: 'Recherche globale', section: 'Général', defaultBinding: 'Mod+P' },
  { action: 'shortcuts', label: 'Configurer les raccourcis', section: 'Général', defaultBinding: 'Mod+/' },
  { action: 'settings', label: 'Ouvrir les paramètres', section: 'Général', defaultBinding: 'Mod+,' },
  { action: 'sessionSearch', label: 'Rechercher dans la session', section: 'Général', defaultBinding: 'Mod+F' },
  { action: 'toggleSidebar', label: 'Basculer la barre latérale', section: 'Navigation', defaultBinding: 'Mod+B' },
  { action: 'toggleSplitPane', label: 'Basculer la vue divisée', section: 'Navigation', defaultBinding: 'Mod+\\' },
  { action: 'snippets', label: 'Bibliothèque de snippets', section: 'Panneaux', defaultBinding: 'Mod+Shift+S' },
  { action: 'persona', label: 'Changer de persona', section: 'Panneaux', defaultBinding: 'Mod+Shift+P' },
  { action: 'tests', label: 'Tests et exécutions', section: 'Panneaux', defaultBinding: 'Mod+Shift+T' },
  { action: 'reasoning', label: 'Trace de raisonnement', section: 'Panneaux', defaultBinding: 'Mod+Shift+R' },
  { action: 'insights', label: 'Insights de session', section: 'Panneaux', defaultBinding: 'Mod+Shift+I' },
  { action: 'resume', label: 'Reprendre une session', section: 'Panneaux', defaultBinding: 'Mod+Shift+O' },
  { action: 'focus', label: 'Mode focus', section: 'Panneaux', defaultBinding: 'Mod+Shift+F' },
  { action: 'skills', label: 'Gestionnaire de skills', section: 'Panneaux', defaultBinding: 'Mod+Shift+L' },
  { action: 'fileActivity', label: 'Activité fichiers', section: 'Panneaux', defaultBinding: 'Mod+Shift+E' },
  { action: 'orchestrator', label: 'Orchestrateur multi-agent', section: 'Multi-agent', defaultBinding: 'Mod+Shift+M' },
  { action: 'subagents', label: 'Tableau des sous-agents', section: 'Multi-agent', defaultBinding: 'Mod+Shift+A' },
  { action: 'diagnostics', label: 'Diagnostics sécurité', section: 'Multi-agent', defaultBinding: 'Mod+Shift+D' },
  { action: 'quickAsk', label: 'Question rapide BTW', section: 'Multi-agent', defaultBinding: 'Mod+Shift+?' },
];

const STORAGE_KEY = 'cowork.shortcuts.v1';
export const SHORTCUTS_CHANGED_EVENT = 'cowork:shortcuts-changed';
let cachedOverrides: Partial<Record<ShortcutAction, string>> | null = null;

export function readShortcutOverrides(): Partial<Record<ShortcutAction, string>> {
  if (cachedOverrides) return cachedOverrides;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    cachedOverrides = Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string')) as Partial<Record<ShortcutAction, string>>;
    return cachedOverrides;
  } catch {
    cachedOverrides = {};
    return cachedOverrides;
  }
}

export function getShortcutBinding(action: ShortcutAction): string {
  const definition = SHORTCUT_DEFINITIONS.find((item) => item.action === action);
  return readShortcutOverrides()[action] || definition?.defaultBinding || '';
}

export function saveShortcutBinding(action: ShortcutAction, binding: string): void {
  const next = { ...readShortcutOverrides(), [action]: binding };
  cachedOverrides = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(SHORTCUTS_CHANGED_EVENT));
}

export function resetShortcuts(): void {
  localStorage.removeItem(STORAGE_KEY);
  cachedOverrides = {};
  window.dispatchEvent(new CustomEvent(SHORTCUTS_CHANGED_EVENT));
}

export function importShortcuts(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Format de raccourcis invalide');
  const allowed = new Set(SHORTCUT_DEFINITIONS.map((item) => item.action));
  const next: Partial<Record<ShortcutAction, string>> = {};
  for (const [key, binding] of Object.entries(value)) {
    if (allowed.has(key as ShortcutAction) && typeof binding === 'string' && binding.trim()) next[key as ShortcutAction] = binding.trim();
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  cachedOverrides = next;
  window.dispatchEvent(new CustomEvent(SHORTCUTS_CHANGED_EVENT));
}

export function eventToBinding(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): string | null {
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(key)) return null;
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key === ' ' ? 'Space' : key);
  return parts.join('+');
}

export function matchesShortcut(action: ShortcutAction, event: KeyboardEvent): boolean {
  const expected = getShortcutBinding(action).toLowerCase().split('+').filter(Boolean);
  const key = event.key.toLowerCase();
  const wantsMod = expected.includes('mod');
  const wantsShift = expected.includes('shift');
  const wantsAlt = expected.includes('alt');
  const expectedKey = expected.find((part) => !['mod', 'shift', 'alt'].includes(part));
  return Boolean(expectedKey)
    && (event.metaKey || event.ctrlKey) === wantsMod
    && event.shiftKey === wantsShift
    && event.altKey === wantsAlt
    && key === expectedKey;
}
