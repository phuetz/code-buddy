/**
 * SlashCommandPalette — Claude Cowork parity Phase 2
 *
 * Floating dropdown shown when the user types `/` at the start of the chat
 * input. Mirrors MentionAutocomplete in structure and keyboard behavior.
 *
 * @module renderer/components/SlashCommandPalette
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Terminal,
  Wand2,
  Hash,
  Settings as SettingsIcon,
  Database,
  Shield,
  GitBranch,
  Eye,
  Loader2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { nextEnabledIndex, paletteItemState, type PaletteAvailability } from '../commands/slash-availability';

export interface SlashCommandItem {
  name: string;
  description: string;
  prompt: string;
  category?: string;
  isBuiltin: boolean;
  arguments?: Array<{
    name: string;
    description: string;
    required: boolean;
    default?: string;
  }>;
  /** Computed by the main process (P4); unavailable entries are shown disabled. */
  availability?: PaletteAvailability;
}

interface SlashCommandPaletteProps {
  prefix: string;
  anchorPosition: { top: number; left: number } | null;
  onSelect: (item: SlashCommandItem) => void;
  onClose: () => void;
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  core: Terminal,
  mode: Wand2,
  checkpoint: Database,
  git: GitBranch,
  dev: Hash,
  docs: Hash,
  security: Shield,
  context: Hash,
  session: Database,
  memory: Database,
  persona: Wand2,
  autonomy: Shield,
  tools: SettingsIcon,
  stats: Hash,
  voice: Hash,
  theme: Wand2,
  search: Hash,
  workflow: Hash,
  agentControl: Wand2,
  prompt: Hash,
  newFeatures: Wand2,
  goldenPath: Hash,
  default: Terminal,
};

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  core: 'slashCommand.catCore',
  mode: 'slashCommand.catMode',
  checkpoint: 'slashCommand.catCheckpoint',
  git: 'slashCommand.catGit',
  dev: 'slashCommand.catDev',
  docs: 'slashCommand.catDocs',
  security: 'slashCommand.catSecurity',
  context: 'slashCommand.catContext',
  session: 'slashCommand.catSession',
  memory: 'slashCommand.catMemory',
  persona: 'slashCommand.catPersona',
  autonomy: 'slashCommand.catAutonomy',
  tools: 'slashCommand.catTools',
  stats: 'slashCommand.catStats',
  voice: 'slashCommand.catVoice',
  theme: 'slashCommand.catTheme',
  search: 'slashCommand.catSearch',
  workflow: 'slashCommand.catWorkflow',
  agentControl: 'slashCommand.catAgentControl',
  prompt: 'slashCommand.catPrompt',
  newFeatures: 'slashCommand.catNewFeatures',
  goldenPath: 'slashCommand.catGoldenPath',
};

function getCategoryIcon(category?: string): LucideIcon {
  if (!category) return Eye;
  return CATEGORY_ICONS[category] ?? CATEGORY_ICONS.default;
}

export const SlashCommandPalette: React.FC<SlashCommandPaletteProps> = ({
  prefix,
  anchorPosition,
  onSelect,
  onClose,
}) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<SlashCommandItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Debounced fetch
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const api = window.electronAPI;
      if (!api?.command) {
        setItems([]);
        return;
      }
      setLoading(true);
      try {
        const results = await api.command.autocomplete(prefix, 40);
        if (cancelled) return;
        const next = results as SlashCommandItem[];
        setItems(next);
        const firstEnabled = next.findIndex((item) => !paletteItemState(item).disabled);
        setHighlightedIdx(firstEnabled >= 0 ? firstEnabled : 0);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 60);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [prefix]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIdx((idx) => nextEnabledIndex(items, idx, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIdx((idx) => nextEnabledIndex(items, idx, -1));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const current = items[highlightedIdx];
        if (current && !paletteItemState(current).disabled) onSelect(current);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [items, highlightedIdx, onSelect, onClose]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return;
    const highlighted = listRef.current.querySelector(`[data-idx="${highlightedIdx}"]`);
    if (highlighted) {
      (highlighted as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIdx]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Group items by category
  const groupedItems = useMemo(() => {
    const groups: Record<string, SlashCommandItem[]> = {};
    for (const item of items) {
      const category = item.category ?? 'default';
      if (!groups[category]) groups[category] = [];
      groups[category].push(item);
    }
    return groups;
  }, [items]);

  const handleClickItem = useCallback(
    (item: SlashCommandItem) => {
      if (paletteItemState(item).disabled) return;
      onSelect(item);
    },
    [onSelect]
  );

  if (!anchorPosition) return null;

  return (
    <div
      ref={containerRef}
      className="fixed z-50 w-96 max-h-80 overflow-hidden bg-background border border-border rounded-lg shadow-elevated"
      style={{
        top: anchorPosition.top,
        left: anchorPosition.left,
      }}
    >
      {loading && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-text-muted">
          <Loader2 size={12} className="animate-spin" />
          {t('common.loading')}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="px-3 py-3 text-xs text-text-muted text-center">
          {t('slashCommand.noMatches')}
        </div>
      )}

      {!loading && items.length > 0 && (
        <div ref={listRef} className="overflow-y-auto max-h-80">
          {Object.entries(groupedItems).map(([category, catItems]) => {
            const Icon = getCategoryIcon(category);
            const labelKey = CATEGORY_LABEL_KEYS[category];
            const label = labelKey ? t(labelKey) : category;
            return (
              <div key={category}>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted bg-surface/40 flex items-center gap-1.5 sticky top-0">
                  <Icon size={10} />
                  {label}
                </div>
                {catItems.map((item) => {
                  const globalIdx = items.indexOf(item);
                  const { disabled, reason } = paletteItemState(item);
                  const isHighlighted = !disabled && globalIdx === highlightedIdx;
                  return (
                    <button
                      key={`${category}-${item.name}`}
                      data-idx={globalIdx}
                      disabled={disabled}
                      aria-disabled={disabled}
                      title={reason}
                      onClick={() => handleClickItem(item)}
                      onMouseEnter={() => { if (!disabled) setHighlightedIdx(globalIdx); }}
                      className={`w-full flex items-start gap-2 px-3 py-1.5 text-left transition-colors ${
                        disabled ? 'opacity-50 cursor-not-allowed' : isHighlighted ? 'bg-accent-muted' : 'hover:bg-surface-hover'
                      }`}
                    >
                      <Icon size={12} className="text-text-muted shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-text-primary truncate">
                          /{item.name}
                        </div>
                        <div className="text-[10px] text-text-muted truncate">
                          {disabled && reason ? reason : item.description}
                        </div>
                      </div>
                      {item.arguments && item.arguments.length > 0 && (
                        <span className="text-[9px] text-text-muted shrink-0 mt-0.5">
                          {item.arguments
                            .map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
                            .join(' ')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
