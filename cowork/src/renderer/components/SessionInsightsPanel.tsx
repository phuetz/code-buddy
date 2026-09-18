import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  X,
  Search,
  Loader2,
  MessageSquare,
  Wrench,
  Clock3,
  FolderOpen,
  ArrowRight,
  ListTree,
} from 'lucide-react';
import { useAppStore } from '../store';
import type { Message, TraceStep } from '../types';
import { formatAppDateTime } from '../utils/i18n-format';
import { ScreenHelpButton } from './ScreenHelpButton';

interface SessionInsightSummary {
  sessionId: string;
  title: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  model?: string;
  cwd?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  tokenInput: number;
  tokenOutput: number;
  totalTokens: number;
  totalExecutionTimeMs: number;
  transcriptPreview: string;
  matchSnippet?: string;
  matchCount?: number;
  matchMessageId?: string;
}

interface SessionInsightDetail {
  summary: SessionInsightSummary;
  messages: Message[];
  traceSteps: TraceStep[];
  turnJournal?: TurnJournalReadResult;
  memoryPreview?: SessionMemoryPreview | null;
}

type TurnJournalEventType =
  | 'intent_queued'
  | 'turn_started'
  | 'message_saved'
  | 'trace_step'
  | 'trace_update'
  | 'steer_delivered'
  | 'steer_fallback_queued'
  | 'turn_completed'
  | 'turn_failed'
  | 'cancel_requested';

interface TurnJournalEvent {
  schemaVersion: 1;
  type: TurnJournalEventType;
  sessionId: string;
  ts: number;
  eventId?: string;
  runId?: string;
  seq?: number;
  turnId?: string;
  data?: Record<string, unknown>;
}

interface TurnJournalReplayAnchor {
  eventId: string;
  runId: string;
  seq: number;
  type: TurnJournalEventType;
  ts: number;
  turnId?: string;
}

interface TurnJournalReplayRun {
  runId: string;
  turnId?: string;
  startedAt: number;
  updatedAt: number;
  latestType: TurnJournalEventType;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  eventCount: number;
  anchorCount: number;
  terminalEvent?: TurnJournalEvent;
  anchors: TurnJournalReplayAnchor[];
  events: TurnJournalEvent[];
}

interface TurnJournalReplayResult {
  sessionId: string;
  path: string;
  exists: boolean;
  totalEventCount: number;
  malformedLineCount: number;
  pendingTurnCount: number;
  runCount: number;
  runs: TurnJournalReplayRun[];
}

interface TurnJournalTurnSummary {
  turnId: string;
  startedAt: number;
  updatedAt: number;
  latestType: TurnJournalEventType;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  eventCount: number;
  messageCount: number;
  traceStepCount: number;
}

interface TurnJournalReadResult {
  sessionId: string;
  path: string;
  exists: boolean;
  totalEventCount: number;
  malformedLineCount: number;
  pendingTurnCount: number;
  events: TurnJournalEvent[];
  turns: TurnJournalTurnSummary[];
  replay: TurnJournalReplayResult;
}

interface SessionMemoryPreview {
  sessionId: string;
  projectId?: string | null;
  memoryStrategy: 'auto' | 'manual' | 'rolling';
  automatedMemoryEnabled: boolean;
  projectMemoryAvailable: boolean;
  projectMemoryPath?: string;
  projectContextAvailable: boolean;
  icmAvailable: boolean;
  recallEnabled: boolean;
  candidateCount: number;
  candidates: Array<{
    category: 'preference' | 'pattern' | 'context' | 'decision';
    content: string;
    sourceSessionId?: string;
    sourceKind: 'user' | 'assistant';
    evidence: string;
  }>;
}

interface SessionTranscriptAudit {
  sessionId: string;
  issueCount: number;
  orphanToolResults: number;
  missingToolResults: number;
  emptyMessages: number;
  pendingJournalTurns: number;
  missingJournalUserMessages: number;
  unrecoverableJournalSubmissions: number;
  malformedJournalEvents: number;
  issues: Array<{
    kind:
      | 'orphan_tool_result'
      | 'missing_tool_result'
      | 'empty_message'
      | 'turn_journal_pending_turn'
      | 'turn_journal_missing_user_message'
      | 'turn_journal_unrecoverable_submission'
      | 'turn_journal_malformed_event';
    messageId?: string;
    toolUseId?: string;
    turnId?: string;
    detail: string;
  }>;
}

interface SessionInsightsPanelProps {
  open: boolean;
  onClose: () => void;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function flattenMessageText(message: Message): string {
  return message.content
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'thinking') return block.thinking;
      if (block.type === 'tool_result') return block.content;
      if (block.type === 'tool_use') return `[${block.name}]`;
      if (block.type === 'file_attachment') return `[file] ${block.filename}`;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function formatJournalData(data?: Record<string, unknown>): string {
  if (!data || Object.keys(data).length === 0) return '';
  const json = JSON.stringify(data);
  return json.length > 180 ? `${json.slice(0, 177)}...` : json;
}

function formatJournalAnchor(anchor: TurnJournalReplayAnchor): string {
  const seq = anchor.seq > 0 ? `#${anchor.seq}` : '#0';
  const turn = anchor.turnId ? ` · ${anchor.turnId}` : '';
  return `${seq} ${anchor.type}${turn}`;
}

function formatMemoryCandidate(candidate: SessionMemoryPreview['candidates'][number]): string {
  return `[${candidate.category}] ${candidate.content}`;
}

export const SessionInsightsPanel: React.FC<SessionInsightsPanelProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setMessages = useAppStore((s) => s.setMessages);
  const setTraceSteps = useAppStore((s) => s.setTraceSteps);
  const setFocusedMessageTarget = useAppStore((s) => s.setFocusedMessageTarget);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SessionInsightSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionInsightDetail | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [repairingAudit, setRepairingAudit] = useState(false);
  const [audit, setAudit] = useState<SessionTranscriptAudit | null>(null);
  const [dismissedCandidates, setDismissedCandidates] = useState<Record<string, boolean>>({});
  const [writingMemory, setWritingMemory] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    if (!window.electronAPI?.sessionInsights) return;
    setLoadingList(true);
    try {
      const result = query.trim()
        ? await window.electronAPI.sessionInsights.search(query.trim(), 100)
        : await window.electronAPI.sessionInsights.list(100);
      setItems(result as SessionInsightSummary[]);
      setSelectedId((current) => current ?? result[0]?.sessionId ?? null);
    } finally {
      setLoadingList(false);
    }
  }, [query]);

  useEffect(() => {
    if (open) void loadList();
  }, [open, loadList]);

  useEffect(() => {
    if (!open || !selectedId || !window.electronAPI?.sessionInsights?.detail) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    void window.electronAPI.sessionInsights.detail(selectedId).then((result) => {
      if (!cancelled) {
        setDetail(result as SessionInsightDetail | null);
        setLoadingDetail(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, selectedId]);

  const selectedSummary = useMemo(
    () => items.find((item) => item.sessionId === selectedId) ?? null,
    [items, selectedId]
  );

  const openSession = useCallback(() => {
    if (!detail) return;
    setMessages(detail.summary.sessionId, detail.messages);
    setTraceSteps(detail.summary.sessionId, detail.traceSteps);
    setActiveSession(detail.summary.sessionId);
    onClose();
  }, [detail, onClose, setActiveSession, setMessages, setTraceSteps]);

  const openSessionAtMessage = useCallback(
    (messageId: string) => {
      if (!detail) return;
      setMessages(detail.summary.sessionId, detail.messages);
      setTraceSteps(detail.summary.sessionId, detail.traceSteps);
      setFocusedMessageTarget({
        sessionId: detail.summary.sessionId,
        messageId,
      });
      setActiveSession(detail.summary.sessionId);
      onClose();
    },
    [detail, onClose, setActiveSession, setFocusedMessageTarget, setMessages, setTraceSteps]
  );

  const loadAudit = useCallback(async () => {
    if (!selectedId || !window.electronAPI?.sessionInsights?.audit) {
      return;
    }
    setLoadingAudit(true);
    try {
      const result = await window.electronAPI.sessionInsights.audit(selectedId);
      setAudit(result as SessionTranscriptAudit | null);
    } finally {
      setLoadingAudit(false);
    }
  }, [selectedId]);

  const repairAudit = useCallback(async () => {
    if (!selectedId || !window.electronAPI?.sessionInsights?.repair) {
      return;
    }
    setRepairingAudit(true);
    try {
      const result = await window.electronAPI.sessionInsights.repair(selectedId);
      if (result) {
        setAudit(result.audit as SessionTranscriptAudit);
        setMessages(selectedId, result.messages);
        setDetail((current) =>
          current && current.summary.sessionId === selectedId
            ? { ...current, messages: result.messages }
            : current
        );
        if (activeSessionId === selectedId) {
          setActiveSession(selectedId);
        }
      }
    } finally {
      setRepairingAudit(false);
    }
  }, [activeSessionId, selectedId, setActiveSession, setMessages]);

  useEffect(() => {
    setAudit(null);
    setDismissedCandidates({});
    setWritingMemory(null);
  }, [selectedId]);

  const visibleMemoryCandidates = useMemo(() => {
    if (!detail?.memoryPreview?.candidates) return [];
    return detail.memoryPreview.candidates.filter(
      (candidate) => !dismissedCandidates[`${candidate.category}:${candidate.evidence}`]
    );
  }, [detail?.memoryPreview?.candidates, dismissedCandidates]);

  const acceptMemoryCandidate = useCallback(
    async (candidate: SessionMemoryPreview['candidates'][number]) => {
      if (!detail?.memoryPreview?.projectId || !window.electronAPI?.memory?.add) return;
      setWritingMemory(`${candidate.category}:${candidate.evidence}`);
      try {
        const result = await window.electronAPI.memory.add(
          candidate.category,
          candidate.content,
          detail.memoryPreview.projectId
        );
        if (result.success) {
          setDismissedCandidates((current) => ({
            ...current,
            [`${candidate.category}:${candidate.evidence}`]: true,
          }));
        }
      } finally {
        setWritingMemory(null);
      }
    },
    [detail?.memoryPreview?.projectId]
  );

  const rejectMemoryCandidate = useCallback((candidate: SessionMemoryPreview['candidates'][number]) => {
    setDismissedCandidates((current) => ({
      ...current,
      [`${candidate.category}:${candidate.evidence}`]: true,
    }));
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed right-0 top-0 bottom-0 w-[760px] max-w-[96vw] bg-background border-l border-border shadow-elevated z-40 flex flex-col"
      data-testid="session-insights-panel"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-accent" />
          <span className="text-xs font-semibold text-text-primary">
            {t('sessionInsights.title', 'Session insights')}
          </span>
          <span className="text-[10px] text-text-muted">
            {t('sessionInsights.count', { count: items.length })}
          </span>
        </div>
        <div className="flex items-center gap-1">
        <ScreenHelpButton screenId="session-insights" />
        <button
          onClick={onClose}
          className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
          title={t('common.close')}
        >
          <X size={14} />
        </button>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-border-muted shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('sessionInsights.searchPlaceholder', 'Search sessions and transcripts…')}
            className="w-full rounded-xl border border-transparent bg-surface pl-9 pr-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border"
            data-testid="session-insights-search"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[280px_1fr]">
        <div className="border-r border-border-muted overflow-y-auto">
          {loadingList && (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-text-muted">
              <Loader2 size={14} className="animate-spin" />
              {t('common.loading')}
            </div>
          )}

          {!loadingList && items.length === 0 && (
            <div
              className="px-4 py-12 text-center text-xs text-text-muted"
              data-testid="session-insights-empty"
            >
              {t('sessionInsights.empty', 'No sessions found')}
            </div>
          )}

          {!loadingList &&
            items.map((item) => (
              <button
                key={item.sessionId}
                onClick={() => setSelectedId(item.sessionId)}
                data-testid={`session-insights-row-${item.sessionId}`}
                className={`w-full px-4 py-3 text-left border-b border-border-muted transition-colors ${
                  selectedId === item.sessionId ? 'bg-accent/10' : 'hover:bg-surface-hover'
                }`}
              >
                <div className="text-xs font-medium text-text-primary truncate">{item.title}</div>
                <div className="text-[11px] text-text-muted mt-0.5 truncate">
                  {item.model || t('sessionInsights.unknownModel', 'Unknown model')}
                </div>
                {query.trim() && item.matchSnippet && (
                  <div className="mt-1 text-[11px] text-text-secondary line-clamp-2">
                    {item.matchSnippet}
                  </div>
                )}
                <div className="mt-1 flex items-center gap-2 text-[10px] text-text-muted">
                  <span className="inline-flex items-center gap-1">
                    <MessageSquare size={10} /> {item.messageCount}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Wrench size={10} /> {item.toolCallCount}
                  </span>
                  {query.trim() && typeof item.matchCount === 'number' && item.matchCount > 0 && (
                    <span>{t('sessionInsights.matches', { count: item.matchCount })}</span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Clock3 size={10} /> {formatDuration(item.totalExecutionTimeMs)}
                  </span>
                </div>
              </button>
            ))}
        </div>

        <div className="flex flex-col min-h-0">
          {!selectedSummary && (
            <div className="flex-1 flex items-center justify-center text-xs text-text-muted">
              {t('sessionInsights.selectHint', 'Select a session to inspect')}
            </div>
          )}

          {selectedSummary && (
            <>
              <div className="px-4 py-3 border-b border-border-muted shrink-0 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-text-primary">
                      {selectedSummary.title}
                    </div>
                    <div className="text-xs text-text-muted mt-1">
                      {selectedSummary.model || t('sessionInsights.unknownModel', 'Unknown model')}
                    </div>
                  </div>
                  <button
                    onClick={openSession}
                    disabled={!detail}
                    className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
                  >
                    <ArrowRight size={12} />
                    {t('sessionInsights.openSession', 'Open session')}
                  </button>
                  <button
                    onClick={() => void loadAudit()}
                    disabled={loadingAudit}
                    data-testid="session-insights-audit-button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover disabled:opacity-50 transition-colors"
                  >
                    {loadingAudit ? <Loader2 size={12} className="animate-spin" /> : null}
                    {t('sessionInsights.auditTranscript', 'Audit transcript')}
                  </button>
                  <button
                    onClick={() => void repairAudit()}
                    disabled={repairingAudit}
                    data-testid="session-insights-repair-button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-hover disabled:opacity-50 transition-colors"
                  >
                    {repairingAudit ? <Loader2 size={12} className="animate-spin" /> : null}
                    {t('sessionInsights.repairTranscript', 'Repair transcript')}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-text-muted">
                  <div>
                    {t('sessionInsights.messages', 'Messages')}: {selectedSummary.messageCount}
                  </div>
                  <div>
                    {t('sessionInsights.tools', 'Tool calls')}: {selectedSummary.toolCallCount}
                  </div>
                  <div>
                    {t('sessionInsights.tokens', 'Tokens')}:{' '}
                    {formatTokenCount(selectedSummary.totalTokens)}
                  </div>
                  <div>
                    {t('sessionInsights.duration', 'Runtime')}:{' '}
                    {formatDuration(selectedSummary.totalExecutionTimeMs)}
                  </div>
                </div>

                {selectedSummary.cwd && (
                  <div className="inline-flex items-center gap-1 text-[11px] text-text-muted break-all">
                    <FolderOpen size={11} />
                    {selectedSummary.cwd}
                  </div>
                )}

                {audit && (
                  <div
                    className="rounded-lg border border-border-muted bg-surface px-3 py-3 space-y-2"
                    data-testid="session-insights-audit-result"
                  >
                    <div className="text-xs font-medium text-text-primary">
                      {t('sessionInsights.auditTitle', 'Transcript audit')}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-text-muted">
                      <div>{t('sessionInsights.auditIssues', { count: audit.issueCount })}</div>
                      <div>{t('sessionInsights.auditMissingResults', { count: audit.missingToolResults })}</div>
                      <div>{t('sessionInsights.auditOrphans', { count: audit.orphanToolResults })}</div>
                      <div>{t('sessionInsights.auditEmptyMessages', { count: audit.emptyMessages })}</div>
                      <div>
                        {t('sessionInsights.auditPendingJournalTurns', {
                          count: audit.pendingJournalTurns,
                        })}
                      </div>
                      <div>
                        {t('sessionInsights.auditMissingJournalUserMessages', {
                          count: audit.missingJournalUserMessages,
                        })}
                      </div>
                      <div>
                        {t('sessionInsights.auditUnrecoverableJournalSubmissions', {
                          count: audit.unrecoverableJournalSubmissions,
                        })}
                      </div>
                      <div>
                        {t('sessionInsights.auditMalformedJournalEvents', {
                          count: audit.malformedJournalEvents,
                        })}
                      </div>
                    </div>
                    {audit.issueCount === 0 ? (
                      <div className="text-[11px] text-success">
                        {t('sessionInsights.auditClean', 'No transcript issues detected')}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {audit.issues.map((issue, index) => (
                          <div
                            key={`${issue.kind}-${
                              issue.messageId || issue.toolUseId || issue.turnId || index
                            }`}
                            className="rounded-md border border-border bg-background px-2.5 py-2 text-[11px]"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-medium text-text-primary">{issue.kind}</div>
                                <div className="mt-1 text-text-muted break-words">{issue.detail}</div>
                              </div>
                              {issue.messageId && (
                                <button
                                  type="button"
                                  onClick={() => openSessionAtMessage(issue.messageId!)}
                                  className="shrink-0 text-accent hover:text-accent-hover"
                                  title={t('sessionInsights.jumpToMessage', 'Open this message in Chat')}
                                >
                                  <ArrowRight size={12} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
                {loadingDetail && (
                  <div className="flex items-center justify-center gap-2 py-12 text-xs text-text-muted">
                    <Loader2 size={14} className="animate-spin" />
                    {t('common.loading')}
                  </div>
                )}

                {!loadingDetail && detail?.turnJournal && (
                  <div
                    className="rounded-lg border border-border-muted overflow-hidden"
                    data-testid="session-insights-turn-journal"
                  >
                    <div className="px-3 py-2 bg-surface flex items-center justify-between text-[11px]">
                      <span className="inline-flex items-center gap-1.5 font-medium text-text-primary">
                        <ListTree size={12} />
                        {t('sessionInsights.turnJournal', 'Turn journal')}
                      </span>
                      <span className="text-text-muted">
                        {t('sessionInsights.turnJournalEvents', {
                          count: detail.turnJournal.totalEventCount,
                        })}
                      </span>
                    </div>
                    <div className="px-3 py-2 space-y-3">
                      <div className="grid grid-cols-3 gap-2 text-[11px] text-text-muted">
                        <div>
                          {t('sessionInsights.turnJournalTurns', {
                            count: detail.turnJournal.turns.length,
                          })}
                        </div>
                        <div>
                          {t('sessionInsights.turnJournalPending', {
                            count: detail.turnJournal.pendingTurnCount,
                          })}
                        </div>
                        <div>
                          {t('sessionInsights.turnJournalMalformed', {
                            count: detail.turnJournal.malformedLineCount,
                          })}
                        </div>
                      </div>

                      {detail.turnJournal.replay.runs.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-[11px] font-medium text-text-secondary">
                            {t('sessionInsights.turnJournalReplay', 'Replay anchors')} -{' '}
                            {t('sessionInsights.turnJournalRunCount', {
                              count: detail.turnJournal.replay.runCount,
                            })}
                          </div>
                          {detail.turnJournal.replay.runs.slice(0, 3).map((run) => (
                            <div
                              key={run.runId}
                              className="rounded-md border border-border bg-background px-2.5 py-2 text-[11px]"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-mono text-text-primary truncate">
                                  {run.runId}
                                </span>
                                <span className="shrink-0 text-text-muted">{run.status}</span>
                              </div>
                              <div className="mt-1 text-text-muted">
                                {run.eventCount}{' '}
                                {t('sessionInsights.turnJournalEventUnit', 'events')} -{' '}
                                {run.anchorCount}{' '}
                                {t('sessionInsights.turnJournalAnchorUnit', 'anchors')}
                              </div>
                              {run.terminalEvent && (
                                <div className="mt-1 text-text-secondary truncate">
                                  {t('sessionInsights.turnJournalTerminalEvent', 'terminal')}: {' '}
                                  {run.terminalEvent.type}
                                </div>
                              )}
                              <div className="mt-1.5 space-y-1">
                                {run.anchors.slice(0, 4).map((anchor) => (
                                  <div
                                    key={anchor.eventId}
                                    className="font-mono text-[10px] text-text-secondary truncate"
                                  >
                                    {formatJournalAnchor(anchor)} · {formatAppDateTime(anchor.ts)}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {detail.turnJournal.turns.length > 0 && (
                        <div className="space-y-1.5">
                          {detail.turnJournal.turns.slice(0, 4).map((turn) => (
                            <div
                              key={turn.turnId}
                              className="rounded-md border border-border bg-background px-2.5 py-2 text-[11px]"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-mono text-text-primary truncate">
                                  {turn.turnId}
                                </span>
                                <span className="shrink-0 text-text-muted">{turn.status}</span>
                              </div>
                              <div className="mt-1 text-text-muted">
                                {turn.latestType} - {turn.eventCount}{' '}
                                {t('sessionInsights.turnJournalEventUnit', 'events')} -{' '}
                                {formatAppDateTime(turn.updatedAt)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        {detail.turnJournal.events.slice(-8).reverse().map((event, index) => {
                          const dataPreview = formatJournalData(event.data);
                          return (
                            <div
                              key={`${event.ts}-${event.type}-${event.turnId || index}`}
                              className="rounded-md border border-border bg-background px-2.5 py-2 text-[11px]"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium text-text-primary">{event.type}</span>
                                <span className="shrink-0 text-text-muted">
                                  {formatAppDateTime(event.ts)}
                                </span>
                              </div>
                              {event.turnId && (
                                <div className="mt-1 font-mono text-text-muted truncate">
                                  {event.turnId}
                                </div>
                              )}
                              {dataPreview && (
                                <div className="mt-1 text-text-secondary break-words">
                                  {dataPreview}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {!loadingDetail && detail?.memoryPreview && (
                  <div className="rounded-lg border border-border-muted overflow-hidden">
                    <div className="px-3 py-2 bg-surface flex items-center justify-between text-[11px]">
                      <span className="inline-flex items-center gap-1.5 font-medium text-text-primary">
                        <MessageSquare size={12} />
                        {t('sessionInsights.memoryPreview', 'Memory preview')}
                      </span>
                      <span className="text-text-muted">
                        {detail.memoryPreview.memoryStrategy} ·{' '}
                        {t('sessionInsights.memoryCandidates', {
                          count: detail.memoryPreview.candidateCount,
                        })}
                      </span>
                    </div>
                    <div className="px-3 py-2 space-y-2 text-[11px] text-text-muted">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          {t('sessionInsights.automatedMemory', 'Automated memory')}: {' '}
                          {detail.memoryPreview.automatedMemoryEnabled ? 'on' : 'off'}
                        </div>
                        <div>
                          {t('sessionInsights.recallEnabled', 'Recall')}: {' '}
                          {detail.memoryPreview.recallEnabled ? 'on' : 'off'}
                        </div>
                        <div>
                          {t('sessionInsights.projectMemory', 'Project memory')}: {' '}
                          {detail.memoryPreview.projectMemoryAvailable ? 'available' : 'missing'}
                        </div>
                        <div>
                          {t('sessionInsights.icmMemory', 'ICM memory')}: {' '}
                          {detail.memoryPreview.icmAvailable ? 'available' : 'missing'}
                        </div>
                      </div>
                      {detail.memoryPreview.projectMemoryPath && (
                        <div className="font-mono text-[10px] truncate">
                          {detail.memoryPreview.projectMemoryPath}
                        </div>
                      )}
                      {visibleMemoryCandidates.length > 0 && (
                        <div className="space-y-1.5">
                          {visibleMemoryCandidates.slice(0, 4).map((candidate, index) => (
                            <div
                              key={`${candidate.category}-${index}`}
                              className="rounded-md border border-border bg-background px-2.5 py-2 text-[11px]"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium text-text-primary">
                                  {formatMemoryCandidate(candidate)}
                                </span>
                                <span className="shrink-0 text-text-muted">
                                  {candidate.sourceKind}
                                </span>
                              </div>
                              <div className="mt-1 text-text-secondary break-words">
                                {candidate.evidence}
                              </div>
                              <div className="mt-2 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void acceptMemoryCandidate(candidate)}
                                  disabled={writingMemory === `${candidate.category}:${candidate.evidence}`}
                                  className="rounded-md border border-border px-2 py-1 text-[10px] text-text-primary hover:bg-surface-hover disabled:opacity-50"
                                >
                                  {writingMemory === `${candidate.category}:${candidate.evidence}`
                                    ? t('common.saving', 'Saving')
                                    : t('common.accept', 'Accept')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => rejectMemoryCandidate(candidate)}
                                  className="rounded-md border border-border px-2 py-1 text-[10px] text-text-muted hover:bg-surface-hover"
                                >
                                  {t('common.reject', 'Reject')}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {!loadingDetail &&
                  detail?.messages.map((message) => {
                    const text = flattenMessageText(message);
                    return (
                      <div
                        key={message.id}
                        className="rounded-lg border border-border-muted overflow-hidden"
                      >
                        <div className="px-3 py-2 bg-surface flex items-center justify-between text-[11px]">
                          <span className="font-medium text-text-primary">{message.role}</span>
                          <button
                            type="button"
                            onClick={() => openSessionAtMessage(message.id)}
                            className="text-text-muted hover:text-text-primary transition-colors"
                            title={t('sessionInsights.jumpToMessage', 'Open this message in Chat')}
                          >
                            {formatAppDateTime(message.timestamp)}
                          </button>
                        </div>
                        <div className="px-3 py-2 text-xs text-text-secondary whitespace-pre-wrap break-words">
                          {text ||
                            t('sessionInsights.noRenderableContent', 'No renderable text content')}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
