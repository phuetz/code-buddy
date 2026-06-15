/**
 * ReasoningTraceViewer — Claude Cowork parity Phase 3 step 17
 *
 * Slide-out panel that renders captured reasoning traces (Tree-of-Thought
 * + MCTS) from the main-process bridge. Shows a list of recent traces
 * on the left, a node tree on the right with scores + highlighted
 * selected path, and a timeline scrubber for playback.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Brain, Zap, RefreshCw, Trash2, Play, Pause, SkipBack, SkipForward, ChevronDown } from 'lucide-react';
import { buildReasoningPlaybackState } from '../utils/reasoning-playback';
import { formatAppNumber, formatAppTime } from '../utils/i18n-format';

interface ReasoningNode {
  id: string;
  parentId: string | null;
  depth: number;
  label: string;
  score?: number;
  selected?: boolean;
  tokensUsed?: number;
  ts: number;
}

interface ReasoningTrace {
  toolUseId: string;
  sessionId: string;
  problem: string;
  mode: string;
  startedAt: number;
  endedAt?: number;
  nodes: ReasoningNode[];
  finalAnswer?: string;
  iterations?: number;
}

interface TraceSummary {
  toolUseId: string;
  sessionId: string;
  problem: string;
  mode: string;
  startedAt: number;
  endedAt?: number;
  iterations?: number;
}

interface ReasoningTraceViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ReasoningTraceViewer({ isOpen, onClose }: ReasoningTraceViewerProps) {
  const { t } = useTranslation();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReasoningTrace | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());

  const toggleNode = useCallback((nodeId: string) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    if (!window.electronAPI?.reasoning?.listTraces) return;
    setIsLoading(true);
    setError(null);
    try {
      const list = (await window.electronAPI.reasoning.listTraces()) as TraceSummary[];
      setTraces(list);
      if (list.length > 0 && !selectedId) {
        setSelectedId(list[0].toolUseId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  useEffect(() => {
    if (!selectedId || !isOpen) {
      setDetail(null);
      setPlaybackIndex(0);
      setIsPlaying(false);
      setCollapsedNodes(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      if (!window.electronAPI?.reasoning?.getTrace) return;
      try {
        const nextDetail = (await window.electronAPI.reasoning.getTrace(
          selectedId
        )) as ReasoningTrace | null;
        if (!cancelled) {
          setDetail(nextDetail);
          setPlaybackIndex(nextDetail?.nodes?.length ? nextDetail.nodes.length - 1 : 0);
          setIsPlaying(false);
          setCollapsedNodes(new Set());
        }
      } catch {
        if (!cancelled) {
          setDetail(null);
          setPlaybackIndex(0);
          setIsPlaying(false);
          setCollapsedNodes(new Set());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, isOpen]);

  const handleClear = useCallback(async () => {
    if (!window.electronAPI?.reasoning?.clear) return;
    if (!window.confirm(t('reasoning.clearConfirm', 'Clear all reasoning traces?'))) return;
    await window.electronAPI.reasoning.clear();
    setTraces([]);
    setSelectedId(null);
    setDetail(null);
    setPlaybackIndex(0);
    setIsPlaying(false);
    setCollapsedNodes(new Set());
  }, [t]);

  const playback = useMemo(
    () => buildReasoningPlaybackState(detail?.nodes ?? [], playbackIndex),
    [detail?.nodes, playbackIndex]
  );

  useEffect(() => {
    if (!isPlaying || !playback.hasPlayback) {
      return;
    }
    if (playback.clampedIndex >= playback.maxIndex) {
      setIsPlaying(false);
      return;
    }
    const timer = window.setInterval(() => {
      setPlaybackIndex((current) => {
        const next = Math.min(current + 1, playback.maxIndex);
        if (next >= playback.maxIndex) {
          setIsPlaying(false);
        }
        return next;
      });
    }, 650);
    return () => window.clearInterval(timer);
  }, [isPlaying, playback.clampedIndex, playback.hasPlayback, playback.maxIndex]);

  const tree = useMemo(() => {
    if (!detail) return null;
    const byId = new Map<string, { node: ReasoningNode; children: ReasoningNode[] }>();
    for (const node of playback.visibleNodes) {
      byId.set(node.id, { node, children: [] });
    }
    const roots: ReasoningNode[] = [];
    for (const { node } of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) {
        byId.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return { byId, roots };
  }, [detail, playback.visibleNodes]);

  const renderNode = (node: ReasoningNode, depth: number): React.ReactNode => {
    const children = tree?.byId.get(node.id)?.children ?? [];
    const hasScore = typeof node.score === 'number';
    const isCollapsed = collapsedNodes.has(node.id);
    const hasChildren = children.length > 0;

    return (
      <div key={node.id} className={depth > 0 ? 'ml-2 border-l border-border-muted pl-2 mt-1' : 'mt-1'}>
        <div className="flex items-start gap-1 group">
          {hasChildren ? (
            <button
              onClick={() => toggleNode(node.id)}
              className="mt-0.5 p-0.5 rounded hover:bg-surface-hover text-text-muted transition-colors flex-shrink-0"
              title={isCollapsed ? t('common.expand', 'Expand') : t('common.collapse', 'Collapse')}
            >
              <ChevronDown
                size={12}
                className={`transform transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
              />
            </button>
          ) : (
            <div className="w-4 flex-shrink-0" />
          )}
          <div
            className={`flex-1 flex items-start gap-2 px-2 py-1 rounded text-xs transition-colors ${
              node.selected ? 'bg-accent/10 border-l-2 border-accent' : 'border-l-2 border-transparent hover:bg-surface-hover/50'
            }`}
          >
            <Zap
              size={10}
              className={node.selected ? 'text-accent mt-0.5 flex-shrink-0' : 'text-text-muted mt-0.5 flex-shrink-0'}
            />
            <div className="flex-1 min-w-0">
              <div className="text-text-primary whitespace-pre-wrap">{node.label}</div>
              {hasScore && (
                <div className="text-[10px] text-text-muted mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>{t('reasoning.score', 'Score')}: {(node.score ?? 0).toFixed(3)}</span>
                  {node.tokensUsed ? (
                    <span>· {formatAppNumber(node.tokensUsed)} {t('reasoning.tokens', 'tokens')}</span>
                  ) : null}
                  {hasChildren && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface border border-border-muted">
                      {children.length} {t('reasoning.branches', 'branches')}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {!isCollapsed && hasChildren && (
          <div className="space-y-0.5">
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  const atLatestNode = playback.clampedIndex >= playback.maxIndex;
  const playbackLabel = playback.activeNode
    ? formatAppTime(playback.activeNode.ts, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : t('reasoning.playback', 'Playback');

  return (
    <div
      className="h-full w-full bg-background flex flex-col"
      data-testid="reasoning-trace-viewer"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-accent" />
          <h2 className="text-sm font-semibold text-text-primary">
            {t('reasoning.title', 'Reasoning trace')}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={isLoading}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
            title={t('common.refresh', 'Refresh')}
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => void handleClear()}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-error"
            title={t('reasoning.clear', 'Clear')}
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
            aria-label={t('common.close', 'Close')}
            data-testid="reasoning-trace-viewer-close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-error bg-error/10 border-b border-error/30">
          {error}
        </div>
      )}

      <div className="flex-1 grid grid-cols-[240px_1fr] overflow-hidden">
        <div className="border-r border-border-muted overflow-y-auto">
          {traces.length === 0 && !isLoading && (
            <div
              className="px-4 py-8 text-center text-xs text-text-muted"
              data-testid="reasoning-empty-state"
            >
              {t(
                'reasoning.empty',
                'No reasoning traces captured yet. Traces appear here when the agent uses the reason tool.'
              )}
            </div>
          )}
          {traces.map((trace) => (
            <button
              key={trace.toolUseId}
              onClick={() => setSelectedId(trace.toolUseId)}
              className={`w-full text-left px-3 py-2 border-b border-border-muted transition-colors ${
                selectedId === trace.toolUseId ? 'bg-accent/10' : 'hover:bg-surface-hover'
              }`}
            >
              <div className="text-xs font-medium text-text-primary line-clamp-2">
                {trace.problem || trace.toolUseId}
              </div>
              <div className="text-[10px] text-text-muted mt-0.5">
                {trace.mode} · {formatAppTime(trace.startedAt)}
                {trace.iterations
                  ? ` · ${trace.iterations} ${t('reasoning.iterations', 'iterations')}`
                  : ''}
              </div>
            </button>
          ))}
        </div>

        <div className="flex flex-col overflow-hidden">
          {detail ? (
            <>
              <div className="px-4 py-3 border-b border-border-muted">
                <div className="text-xs text-text-muted">
                  {t('reasoning.mode', 'Mode')}:{' '}
                  <span className="text-text-primary">{detail.mode}</span> ·{' '}
                  {playback.visibleNodes.length}/{detail.nodes.length}{' '}
                  {t('reasoning.nodes', 'nodes')}
                </div>
                {detail.problem && (
                  <div className="text-sm text-text-primary mt-1">{detail.problem}</div>
                )}
              </div>

              <div className="px-4 py-3 border-b border-border-muted bg-surface/30 space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setIsPlaying(false);
                      setPlaybackIndex(0);
                    }}
                    disabled={playback.orderedNodes.length === 0}
                    className="p-1.5 rounded bg-surface hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed text-text-secondary"
                    title={t('reasoning.jumpStart', 'Jump to start')}
                  >
                    <SkipBack size={12} />
                  </button>
                  <button
                    onClick={() => {
                      if (!playback.hasPlayback) return;
                      if (playback.clampedIndex >= playback.maxIndex) {
                        setPlaybackIndex(0);
                      }
                      setIsPlaying((current) => !current);
                    }}
                    disabled={!playback.hasPlayback}
                    className="p-1.5 rounded bg-surface hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed text-text-secondary"
                    title={isPlaying ? t('reasoning.pause', 'Pause') : t('reasoning.play', 'Play')}
                    data-testid="reasoning-playback-toggle"
                  >
                    {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                  </button>
                  <button
                    onClick={() => {
                      setIsPlaying(false);
                      setPlaybackIndex(playback.maxIndex);
                    }}
                    disabled={playback.orderedNodes.length === 0}
                    className="p-1.5 rounded bg-surface hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed text-text-secondary"
                    title={t('reasoning.jumpEnd', 'Jump to end')}
                  >
                    <SkipForward size={12} />
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(playback.maxIndex, 0)}
                    step={1}
                    value={playback.clampedIndex}
                    disabled={!playback.hasPlayback}
                    onChange={(event) => {
                      setIsPlaying(false);
                      setPlaybackIndex(Number(event.target.value));
                    }}
                    className="flex-1 accent-[var(--color-accent)]"
                    data-testid="reasoning-playback-slider"
                  />
                  <span className="text-[10px] text-text-muted min-w-[56px] text-right">
                    {playback.orderedNodes.length === 0
                      ? '0/0'
                      : `${playback.clampedIndex + 1}/${playback.maxIndex + 1}`}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-text-muted">
                  <span>
                    {t('reasoning.playback', 'Playback')} {Math.round(playback.progress)}%
                  </span>
                  <span>{playbackLabel}</span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5">
                {tree && tree.roots.length > 0 ? (
                  tree.roots.map((root) => renderNode(root, 0))
                ) : (
                  <div className="text-xs text-text-muted">
                    {t('reasoning.noNodes', 'Trace contains no nodes')}
                  </div>
                )}
              </div>

              {detail.finalAnswer && atLatestNode && (
                <div className="border-t border-border-muted px-4 py-3 bg-success/5">
                  <div className="text-[10px] uppercase tracking-wide text-text-muted">
                    {t('reasoning.finalAnswer', 'Final answer')}
                  </div>
                  <div className="text-xs text-text-primary mt-1 whitespace-pre-wrap">
                    {detail.finalAnswer}
                  </div>
                </div>
              )}

              {detail.finalAnswer && !atLatestNode && (
                <div className="border-t border-border-muted px-4 py-3 bg-surface/30 text-[10px] text-text-muted">
                  {t('reasoning.finalAnswerHidden', 'Continue playback to reveal the final answer')}
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
              {t('reasoning.selectHint', 'Select a trace to inspect')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
