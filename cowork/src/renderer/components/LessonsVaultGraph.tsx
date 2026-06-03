/**
 * LessonsVaultGraph — P5.7
 *
 * Hierarchical text-based view of the lessons vault. No D3 — just nested
 * sections, grouping lessons by tag, and a search box. Calls the existing
 * lessons-vault preview bridge.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, BookOpen, Search } from 'lucide-react';

interface LessonsVaultGraphProps {
  onClose: () => void;
}

interface LessonEntry {
  id: string;
  title: string;
  tags?: string[];
  summary?: string;
  createdAt?: number;
}

interface LessonsVaultPreview {
  concepts: Array<{
    id: string;
    label: string;
  }>;
  lessons: Array<{
    category: string;
    conceptIds: string[];
    id: string;
    path: string;
  }>;
}

interface ConceptDetails {
  concept: { id: string; label: string; weight: number };
  lessons: Array<{
    id: string;
    category: string;
    content: string;
    context?: string;
    createdBy?: { runId?: string; outcomeId?: string; sagaId?: string; note?: string; at: number };
    usedBy?: Array<{ runId: string; at: number }>;
  }>;
  backlinks: string[];
}

interface LessonsVaultApi {
  preview?: () => Promise<LessonsVaultPreview | LessonEntry[] | null>;
  getConceptDetails?: (options: {
    conceptName: string;
    cwd?: string;
  }) => Promise<ConceptDetails | null>;
}

function lessonsVaultApi(): LessonsVaultApi | undefined {
  return (
    window.electronAPI as unknown as {
      tools?: { lessonsVault?: LessonsVaultApi };
    }
  )?.tools?.lessonsVault;
}

function toLessonEntries(preview: LessonsVaultPreview | LessonEntry[] | null): LessonEntry[] {
  if (!preview) return [];
  if (Array.isArray(preview)) return preview;
  const conceptLabels = new Map(
    (preview.concepts ?? []).map((concept) => [concept.id, concept.label])
  );
  return (preview.lessons ?? []).map((lesson) => {
    const tags = lesson.conceptIds
      .map((conceptId) => conceptLabels.get(conceptId) ?? conceptId)
      .filter(Boolean);
    return {
      id: lesson.id,
      title: lesson.id,
      tags: tags.length > 0 ? tags : [lesson.category.toLowerCase()],
      summary: lesson.path,
    };
  });
}

export function LessonsVaultGraph({ onClose }: LessonsVaultGraphProps) {
  const { t } = useTranslation();
  const [lessons, setLessons] = useState<LessonEntry[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeConceptName, setActiveConceptName] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const api = lessonsVaultApi()?.preview;
    if (!api) {
      setLoading(false);
      return;
    }
    api()
      .then((preview) => setLessons(toLessonEntries(preview)))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? lessons.filter(
          (l) =>
            l.title.toLowerCase().includes(q) ||
            l.summary?.toLowerCase().includes(q) ||
            l.tags?.some((tg) => tg.toLowerCase().includes(q))
        )
      : lessons;
    const map = new Map<string, LessonEntry[]>();
    for (const lesson of filtered) {
      const tags = lesson.tags?.length ? lesson.tags : ['untagged'];
      for (const tag of tags) {
        if (!map.has(tag)) map.set(tag, []);
        map.get(tag)!.push(lesson);
      }
    }
    return Array.from(map.entries())
      .map(([tag, items]) => ({ tag, items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [lessons, query]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/35 backdrop-blur-sm flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      data-testid="lessons-vault-graph"
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">{t('lessonsVault.title', 'Lessons vault')}</h2>
            <span className="text-[11px] text-text-muted">
              {lessons.length} {t('lessonsVault.entries', 'entries')}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover"
          >
            <X size={14} />
          </button>
        </div>

        {activeConceptName ? (
          <div className="flex-1 overflow-y-auto p-5">
            <ConceptDetailsView
              conceptName={activeConceptName}
              onClose={() => setActiveConceptName(null)}
              onSelectConcept={setActiveConceptName}
            />
          </div>
        ) : (
          <>
            <div className="px-5 py-2 border-b border-border-muted">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t(
                    'lessonsVault.searchPlaceholder',
                    'Search lessons by title, tag, summary...'
                  )}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-surface border border-border-subtle focus:outline-none focus:border-accent"
                  data-testid="lessons-vault-search"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {loading && (
                <p className="text-xs text-text-muted">{t('common.loading', 'Loading...')}</p>
              )}
              {!loading && grouped.length === 0 && (
                <p className="text-xs italic text-text-muted text-center py-8">
                  {t(
                    'lessonsVault.empty',
                    'No lessons yet. They accumulate as the agent reflects on tool outputs and errors.'
                  )}
                </p>
              )}
              {grouped.map((group) => (
                <details key={group.tag} open className="border border-border-subtle rounded-lg">
                  <summary className="px-3 py-2 text-xs font-medium cursor-pointer hover:bg-surface-hover flex items-center justify-between">
                    <span
                      className="capitalize hover:text-accent hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveConceptName(group.tag);
                      }}
                    >
                      {group.tag}
                    </span>
                    <span className="text-[10px] text-text-muted">{group.items.length}</span>
                  </summary>
                  <ul className="px-3 pb-3 space-y-2">
                    {group.items.map((item) => (
                      <li key={item.id} className="border-l-2 border-accent/30 pl-2.5 py-1">
                        <div className="text-xs font-medium">{item.title}</div>
                        {item.summary && (
                          <p className="text-[11px] text-text-muted mt-0.5">{item.summary}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ConceptDetailsView({
  conceptName,
  onClose,
  onSelectConcept,
}: {
  conceptName: string;
  onClose: () => void;
  onSelectConcept: (name: string) => void;
}) {
  const [details, setDetails] = useState<ConceptDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const api = lessonsVaultApi()?.getConceptDetails;
    if (!api) {
      setLoading(false);
      return;
    }
    api({ conceptName })
      .then((data) => setDetails(data))
      .finally(() => setLoading(false));
  }, [conceptName]);

  if (loading) {
    return (
      <div className="py-8 text-center text-xs text-text-muted">
        Loading details for {conceptName}...
      </div>
    );
  }

  if (!details) {
    return (
      <div className="py-8 text-center text-xs text-text-muted">
        Could not load details for {conceptName}.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <h3 className="text-sm font-semibold capitalize text-accent flex items-center gap-2">
          <span>Concept: {details.concept.label}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-mono">
            weight {details.concept.weight}
          </span>
        </h3>
        <button onClick={onClose} className="text-xs text-text-muted hover:text-text-primary">
          Back to list
        </button>
      </div>

      {details.backlinks.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted block">
            Related Concepts
          </span>
          <div className="flex flex-wrap gap-1.5">
            {details.backlinks.map((link) => (
              <button
                key={link}
                onClick={() => onSelectConcept(link)}
                className="text-[10px] px-2 py-0.5 rounded bg-surface hover:bg-surface-hover border border-border-subtle text-text-primary capitalize transition-colors"
              >
                {link}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <span className="text-[10px] uppercase font-bold tracking-wider text-text-muted block">
          Lessons ({details.lessons.length})
        </span>
        <div className="space-y-3 max-h-[48vh] overflow-y-auto pr-1">
          {details.lessons.map((lesson) => (
            <div
              key={lesson.id}
              className="p-3 bg-surface/50 border border-border-subtle rounded-lg space-y-2 text-xs"
            >
              <div className="flex justify-between items-center text-[10px] font-bold text-accent/80 uppercase font-mono">
                <span>{lesson.category}</span>
                <span className="text-[9px] text-text-muted">{lesson.id}</span>
              </div>
              <div className="font-medium whitespace-pre-wrap text-text-primary">
                {lesson.content}
              </div>
              {lesson.context && (
                <div className="text-[10px] bg-background/50 p-2 rounded border border-border-muted text-text-muted italic">
                  Context: {lesson.context}
                </div>
              )}

              {/* Provenance */}
              <div className="border-t border-border-muted pt-2 mt-2 space-y-1.5 text-[10px] text-text-muted">
                {lesson.createdBy && (
                  <div>
                    <span className="font-semibold text-text-primary">Created by:</span>{' '}
                    {lesson.createdBy.runId && (
                      <span className="bg-background px-1 py-0.5 rounded border border-border-subtle font-mono text-[9px] mr-1">
                        run: {lesson.createdBy.runId.slice(0, 8)}
                      </span>
                    )}
                    {lesson.createdBy.outcomeId && (
                      <span className="bg-background px-1 py-0.5 rounded border border-border-subtle font-mono text-[9px] mr-1">
                        outcome: {lesson.createdBy.outcomeId.slice(0, 8)}
                      </span>
                    )}
                    {lesson.createdBy.note && (
                      <span className="italic">({lesson.createdBy.note})</span>
                    )}
                  </div>
                )}
                {lesson.usedBy && lesson.usedBy.length > 0 ? (
                  <div>
                    <span className="font-semibold text-text-primary">Used in runs:</span>{' '}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {lesson.usedBy.map((usage) => (
                        <span
                          key={usage.runId}
                          className="bg-background px-1 py-0.5 rounded border border-border-subtle font-mono text-[9px]"
                        >
                          {usage.runId.slice(0, 8)}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <span className="italic">Never loaded in a run yet.</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
