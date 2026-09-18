/**
 * GlobalSearchDialog — Claude Cowork parity Phase 2 step 8
 *
 * Cmd+K / Ctrl+K modal palette that searches across sessions, messages,
 * memories, knowledge entries, and workspace files. Click a result to
 * navigate (switches active session/project as needed).
 *
 * @module renderer/components/GlobalSearchDialog
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  X,
  MessageSquare,
  Brain,
  BookOpen,
  FileText,
  Hash,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { useAppStore } from '../store';
import { ScreenHelpButton } from './ScreenHelpButton';
import {
  SOURCE_ORDER,
  buildGlobalSearchFocusedMessageTarget,
  groupGlobalSearchHits,
  type GlobalSearchHit,
  type GlobalSearchResults,
  type SearchSource,
} from './global-search-helpers';

const SOURCE_ICONS: Record<SearchSource, LucideIcon> = {
  session: Hash,
  message: MessageSquare,
  memory: Brain,
  knowledge: BookOpen,
  file: FileText,
};

interface GlobalSearchDialogProps {
  open: boolean;
  onClose: () => void;
}

export const GlobalSearchDialog: React.FC<GlobalSearchDialogProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveProjectId = useAppStore((s) => s.setActiveProjectId);
  const setPreviewFilePath = useAppStore((s) => s.setPreviewFilePath);
  const setFocusedMessageTarget = useAppStore((s) => s.setFocusedMessageTarget);

  // Reset state on open and focus the input
  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(null);
      setSelectedIndex(0);
      // Defer focus to next tick so the dialog has rendered
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (!query.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceTimerRef.current = setTimeout(async () => {
      try {
        const api = window.electronAPI;
        if (!api?.search?.global) {
          setResults(null);
          return;
        }
        const result = await api.search.global(query.trim(), 40);
        setResults(result);
        setSelectedIndex(0);
      } catch (err) {
        console.error('[GlobalSearchDialog] search failed:', err);
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [query]);

  const flatHits = useMemo(() => results?.hits ?? [], [results]);

  const groupedHits = useMemo(() => {
    return groupGlobalSearchHits(flatHits);
  }, [flatHits]);

  const navigateToHit = useCallback(
    (hit: GlobalSearchHit) => {
      if (hit.context.projectId) {
        setActiveProjectId(hit.context.projectId);
      }
      if (hit.context.sessionId) {
        setActiveSession(hit.context.sessionId);
      }
      const focusedTarget = buildGlobalSearchFocusedMessageTarget(hit);
      if (focusedTarget) {
        setFocusedMessageTarget(focusedTarget);
      }
      if (hit.source === 'file' && hit.context.path) {
        // Phase 2 step 9: open the file preview pane on file hits.
        setPreviewFilePath(hit.context.path);
      }
      onClose();
    },
    [setActiveProjectId, setActiveSession, setFocusedMessageTarget, setPreviewFilePath, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (flatHits.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % flatHits.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + flatHits.length) % flatHits.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const hit = flatHits[selectedIndex];
        if (hit) navigateToHit(hit);
      }
    },
    [flatHits, selectedIndex, navigateToHit, onClose]
  );

  if (!open) return null;

  let runningIndex = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm"
      data-testid="global-search-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border rounded-xl shadow-elevated w-full max-w-2xl mx-4 overflow-hidden flex flex-col max-h-[70vh]">
        {/* Header / input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-muted">
          <Search size={16} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('globalSearch.placeholder')}
            data-testid="global-search-input"
            className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-muted"
          />
          {loading && <Loader2 size={14} className="animate-spin text-text-muted" />}
          <ScreenHelpButton screenId="global-search" />
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary transition-colors"
            title={t('common.close')}
          >
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {!query.trim() && (
            <div
              className="px-6 py-10 text-center text-xs text-text-muted"
              data-testid="global-search-empty-state"
            >
              <Search size={28} className="mx-auto mb-2 opacity-30" />
              <p>{t('globalSearch.empty')}</p>
              <p className="mt-2 text-[11px] opacity-70">{t('globalSearch.tip')}</p>
            </div>
          )}

          {query.trim() && !loading && flatHits.length === 0 && (
            <div className="px-6 py-10 text-center text-xs text-text-muted">
              {t('globalSearch.noResults', { query })}
            </div>
          )}

          {SOURCE_ORDER.map((source) => {
            const hits = groupedHits[source];
            if (hits.length === 0) return null;
            const Icon = SOURCE_ICONS[source];
            return (
              <div key={source} className="border-b border-border-muted last:border-b-0">
                <div className="flex items-center gap-2 px-4 py-1.5 bg-surface/50 sticky top-0">
                  <Icon size={11} className="text-text-muted" />
                  <span className="text-[10px] uppercase tracking-wide font-semibold text-text-muted">
                    {t(`globalSearch.source.${source}`)}
                  </span>
                  <span className="text-[10px] text-text-muted opacity-60">{hits.length}</span>
                </div>
                {hits.map((hit) => {
                  const idx = runningIndex++;
                  const isSelected = idx === selectedIndex;
                  return (
                    <div
                      key={`${source}-${hit.id}-${idx}`}
                      className={`flex items-start gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-accent/15 border-l-2 border-accent'
                          : 'hover:bg-surface-hover border-l-2 border-transparent'
                      }`}
                      onClick={() => navigateToHit(hit)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <Icon
                        size={12}
                        className={`mt-0.5 shrink-0 ${
                          isSelected ? 'text-accent' : 'text-text-muted'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-text-primary truncate">
                          {hit.title || t('globalSearch.untitled')}
                        </div>
                        {hit.snippet && (
                          <div className="text-[11px] text-text-muted truncate mt-0.5">
                            {renderHighlightedText(hit.snippet)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-border-muted bg-surface/30 flex items-center justify-between text-[10px] text-text-muted">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[9px]">
                ↑↓
              </kbd>{' '}
              {t('globalSearch.hint.navigate')}
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[9px]">
                ↵
              </kbd>{' '}
              {t('globalSearch.hint.select')}
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[9px]">
                esc
              </kbd>{' '}
              {t('globalSearch.hint.close')}
            </span>
          </div>
          {results && <span>{t('globalSearch.totalHits', { count: flatHits.length })}</span>}
        </div>
      </div>
    </div>
  );
};

function renderHighlightedText(text: string): React.ReactNode {
  if (!text) return null;
  const parts = text.split(/(<mark>.*?<\/mark>)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('<mark>') && part.endsWith('</mark>')) {
          const content = part.substring(6, part.length - 7);
          return (
            <mark key={index} className="bg-accent/20 text-accent font-medium rounded px-0.5 border-b border-accent/30">
              {content}
            </mark>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}
