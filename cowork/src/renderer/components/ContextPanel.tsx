import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store';
import { resolveArtifactPath } from '../utils/artifact-path';
import {
  extractFilePathFromToolInput,
  extractFilePathsFromToolOutput,
} from '../utils/tool-output-path';
import {
  getArtifactDisplayRole,
  getArtifactDisplayRoleLabel,
  getArtifactDisplayRolePriority,
  getArtifactLabel,
  getArtifactIconComponent,
  getArtifactSteps,
  getDocxValidationEvidence,
  getDocxValidationEvidenceDisplay,
  type ArtifactDisplayRole,
  type DocxValidationEvidence,
} from '../utils/artifact-steps';
import {
  buildDocumentWorkshopEvidenceChips,
  buildDocumentWorkshopMemoryContent,
  getDocumentWorkshopProgress,
  getDocumentWorkshopReadiness,
} from '../utils/document-workshop-progress';
import { useIPC } from '../hooks/useIPC';
import { useCheckpointTimeline } from '../store/selectors';
import { CheckpointPanel } from './CheckpointPanel';
import { DiffViewer } from './DiffViewer';
import { FileTree } from './FileTree';
import { SubAgentPanel } from './SubAgentPanel';
import { MemoryInspector } from './MemoryInspector';
import { KnowledgeBaseBrowser } from './KnowledgeBaseBrowser';
import { GitStatusPanel } from './GitStatusPanel';
import {
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  FileText,
  FileSpreadsheet,
  FilePieChart,
  FileCode2,
  FileArchive,
  FileAudio2,
  FileVideo,
  Image as ImageIcon,
  FolderOpen,
  FolderSync,
  File,
  Check,
  Loader2,
  Plug,
  Wrench,
  MessageSquare,
  Cpu,
  Copy,
  Layers,
  Brain,
} from 'lucide-react';
import type { TraceStep, MCPServerInfo, DiffEntry, CheckpointSnapshot } from '../types';

const EMPTY_STEPS: TraceStep[] = [];

interface CheckpointCompareState {
  from: CheckpointSnapshot;
  to: CheckpointSnapshot;
  diffs: DiffEntry[];
}

type MemoryApiBridge = {
  add?: (
    category: 'preference' | 'pattern' | 'context' | 'decision',
    content: string,
    projectId?: string,
  ) => Promise<{ success: boolean; error?: string }>;
};

function CheckpointSection({ cwd }: { cwd: string | null }) {
  const { t } = useTranslation();
  const timeline = useCheckpointTimeline();
  const setCheckpointTimeline = useAppStore((s) => s.setCheckpointTimeline);
  const [compareState, setCompareState] = useState<CheckpointCompareState | null>(null);

  const handleUndo = async () => {
    const result = await window.electronAPI?.checkpoint?.undo();
    if (result) {
      const tl = await window.electronAPI?.checkpoint?.list();
      if (tl) setCheckpointTimeline(tl as import('../types').CheckpointTimeline);
    }
  };

  const handleRedo = async () => {
    const result = await window.electronAPI?.checkpoint?.redo();
    if (result) {
      const tl = await window.electronAPI?.checkpoint?.list();
      if (tl) setCheckpointTimeline(tl as import('../types').CheckpointTimeline);
    }
  };

  const handleRestore = async (snapshotId: string) => {
    await window.electronAPI?.checkpoint?.restore(snapshotId);
    const tl = await window.electronAPI?.checkpoint?.list();
    if (tl) setCheckpointTimeline(tl as import('../types').CheckpointTimeline);
  };

  const handleCompare = async (a: string, b: string) => {
    if (!timeline || !cwd || !window.electronAPI?.checkpoint?.compare) return;
    const from = timeline.snapshots.find((snapshot) => snapshot.id === a);
    const to = timeline.snapshots.find((snapshot) => snapshot.id === b);
    if (!from || !to) return;
    const diffs = (await window.electronAPI.checkpoint.compare(
      cwd,
      from.commitHash,
      to.commitHash
    )) as DiffEntry[];
    setCompareState({ from, to, diffs });
  };

  if (!timeline || timeline.snapshots.length === 0) return null;

  return (
    <div className="border-b border-border-muted">
      <div className="px-4 py-2.5">
        <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-1">
          Checkpoints
        </p>
      </div>
      <CheckpointPanel
        timeline={timeline}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onRestore={handleRestore}
        onCompare={handleCompare}
      />
      {compareState && (
        <div className="px-4 py-3 border-t border-border-muted bg-surface/20 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-text-muted uppercase tracking-wider">
                {t('checkpoints.compareResult', 'Checkpoint comparison')}
              </p>
              <p className="text-xs text-text-primary mt-1">
                {t('checkpoints.from', 'From')}: {compareState.from.description}
              </p>
              <p className="text-xs text-text-primary">
                {t('checkpoints.to', 'To')}: {compareState.to.description}
              </p>
            </div>
            <button
              onClick={() => setCompareState(null)}
              className="text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              {t('checkpoints.clearCompare', 'Clear')}
            </button>
          </div>
          {compareState.diffs.length === 0 ? (
            <div className="text-xs text-text-muted">
              {t('checkpoints.compareEmpty', 'No file changes between selected checkpoints.')}
            </div>
          ) : (
            <div>
              <p className="text-[11px] text-text-muted">
                {t('checkpoints.filesChanged', {
                  count: compareState.diffs.length,
                  defaultValue: '{{count}} file(s) changed',
                })}
              </p>
              {compareState.diffs.map((diff) => (
                <DiffViewer
                  key={`${compareState.from.id}-${compareState.to.id}-${diff.path}`}
                  diff={diff}
                  readOnly
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ContextPanel() {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const sessions = useAppStore((s) => s.sessions);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const appConfig = useAppStore((s) => s.appConfig);
  const setPreviewFilePath = useAppStore((s) => s.setPreviewFilePath);
  const contextPanelCollapsed = useAppStore((s) => s.contextPanelCollapsed);
  const toggleContextPanel = useAppStore((s) => s.toggleContextPanel);
  const workingDir = useAppStore((s) => s.workingDir);
  const setGlobalNotice = useAppStore((s) => s.setGlobalNotice);
  const { getMCPServers, changeWorkingDir } = useIPC();
  const [artifactsOpen, setArtifactsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<
    'files' | 'git' | 'memory' | 'knowledge' | 'agents' | 'mcp'
  >('files');
  const [expandedConnector, setExpandedConnector] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<MCPServerInfo[]>([]);
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedArtifactPath, setCopiedArtifactPath] = useState<string | null>(null);
  const [workshopMemoryStatus, setWorkshopMemoryStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [workshopMemoryError, setWorkshopMemoryError] = useState<string | null>(null);
  const [isChangingDir, setIsChangingDir] = useState(false);
  const [recentWorkspaceFiles, setRecentWorkspaceFiles] = useState<
    Array<{
      path: string;
      modifiedAt: number;
      size: number;
    }>
  >([]);

  const handleCopyPath = async (path: string) => {
    try {
      // Escape spaces for shell usage so the path can be pasted into terminal
      let shellPath = path;
      if (path.includes(' ')) {
        const isWindows = window.electronAPI?.platform === 'win32';
        shellPath = isWindows ? `"${path}"` : path.replace(/ /g, '\\ ');
      }
      await navigator.clipboard.writeText(shellPath);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    } catch (err) {
      console.error('Failed to copy path:', err);
    }
  };

  const revealArtifact = async (artifactPath: string) => {
    if (!artifactPath || !window.electronAPI?.showItemInFolder) {
      return;
    }

    const revealed = await window.electronAPI.showItemInFolder(
      artifactPath,
      currentWorkingDir ?? undefined
    );
    if (!revealed) {
      setGlobalNotice({
        id: `artifact-reveal-failed-${Date.now()}`,
        type: 'warning',
        message: t('context.revealFailed'),
      });
    }
  };

  const handleCopyArtifactPath = async (artifactPath: string) => {
    try {
      await navigator.clipboard.writeText(artifactPath);
      setCopiedArtifactPath(artifactPath);
      setTimeout(() => setCopiedArtifactPath(null), 2000);
    } catch (err) {
      console.error('Failed to copy artifact path:', err);
    }
  };

  const openArtifact = async (artifactPath: string) => {
    if (!artifactPath) {
      return;
    }

    if (canPreviewArtifact) {
      setPreviewFilePath(artifactPath);
      return;
    }

    await revealArtifact(artifactPath);
  };

  const handleSaveWorkshopMemory = async () => {
    const addMemory = getMemoryApi()?.add;
    if (!addMemory || workshopMemoryStatus === 'saving') {
      return;
    }

    setWorkshopMemoryStatus('saving');
    setWorkshopMemoryError(null);

    try {
      const result = await addMemory('context', documentWorkshopMemoryContent);
      if (result.success) {
        setWorkshopMemoryStatus('saved');
        return;
      }
      setWorkshopMemoryStatus('error');
      setWorkshopMemoryError(
        result.error ?? t('context.documentWorkshop.saveMemoryFailed')
      );
    } catch (err) {
      setWorkshopMemoryStatus('error');
      setWorkshopMemoryError(err instanceof Error ? err.message : String(err));
    }
  };

  const ss = activeSessionId ? sessionStates[activeSessionId] : undefined;
  const steps = ss?.traceSteps ?? EMPTY_STEPS;
  const activeSession = activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null;
  const currentWorkingDir = activeSession?.cwd || workingDir;
  const { displayArtifactSteps } = getArtifactSteps(steps);
  const canShowItemInFolder =
    typeof window !== 'undefined' && !!window.electronAPI?.showItemInFolder;
  const canPreviewArtifact =
    typeof window !== 'undefined' && !!window.electronAPI?.preview?.get;

  // Session info computations
  const messages = useMemo(
    () => (activeSessionId ? sessionStates[activeSessionId]?.messages || [] : []),
    [activeSessionId, sessionStates]
  );
  const messageCount = messages.length;
  const toolCallCount = steps.filter((s) => s.type === 'tool_call').length;
  const modelName = activeSession?.model || appConfig?.model || '—';

  // Token usage aggregation
  const tokenUsage = useMemo(() => {
    let input = 0;
    let output = 0;
    for (const msg of messages) {
      if (msg.tokenUsage) {
        input += msg.tokenUsage.input || 0;
        output += msg.tokenUsage.output || 0;
      }
    }
    return { input, output, total: input + output };
  }, [messages]);

  // Context usage: last message's input tokens ≈ current context occupation
  const contextUsage = useMemo(() => {
    const contextWindow = activeSessionId
      ? sessionStates[activeSessionId]?.contextWindow
      : undefined;
    if (!contextWindow) return null;

    let lastInput = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].tokenUsage?.input) {
        lastInput = messages[i].tokenUsage!.input;
        break;
      }
    }
    if (lastInput === 0) return null;

    const percentage = Math.min((lastInput / contextWindow) * 100, 100);
    return { used: lastInput, total: contextWindow, percentage };
  }, [activeSessionId, sessionStates, messages]);

  const completedStepCount = useMemo(
    () => steps.reduce((n, s) => n + (s.status === 'completed' ? 1 : 0), 0),
    [steps]
  );

  useEffect(() => {
    if (contextPanelCollapsed) {
      return;
    }
    if (
      typeof window === 'undefined' ||
      !window.electronAPI?.artifacts?.listRecentFiles ||
      !currentWorkingDir ||
      !activeSession?.createdAt
    ) {
      setRecentWorkspaceFiles([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const files = await window.electronAPI.artifacts.listRecentFiles(
          currentWorkingDir,
          activeSession.createdAt,
          50
        );
        if (!cancelled) {
          setRecentWorkspaceFiles(files || []);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load recent workspace files:', error);
          setRecentWorkspaceFiles([]);
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    activeSession?.createdAt,
    activeSessionId,
    steps.length,
    completedStepCount,
    contextPanelCollapsed,
    currentWorkingDir,
  ]);

  const displayArtifacts = useMemo(() => {
    const seenPaths = new Set<string>();
    const items: Array<{
      label: string;
      path: string;
      role: ArtifactDisplayRole;
      evidence?: DocxValidationEvidence | null;
    }> = [];

    for (const step of displayArtifactSteps) {
      const outputPaths = extractFilePathsFromToolOutput(step.toolOutput);
      const inputPath = extractFilePathFromToolInput(step.toolInput);
      const candidatePaths = outputPaths.length > 0
        ? outputPaths
        : inputPath
          ? [inputPath]
          : [];
      if (candidatePaths.length === 0) {
        continue;
      }

      for (const fallbackPath of candidatePaths) {
        const resolvedPath = resolveArtifactPath(fallbackPath, currentWorkingDir);
        const key = resolvedPath.trim();
        if (!key || seenPaths.has(key)) {
          continue;
        }

        seenPaths.add(key);
        items.push({
          label: getArtifactLabel(fallbackPath),
          path: resolvedPath,
          role: getArtifactDisplayRole(step, fallbackPath),
          evidence: getDocxValidationEvidence(step, fallbackPath),
        });
      }
    }

    for (const file of recentWorkspaceFiles) {
      const resolvedPath = resolveArtifactPath(file.path, currentWorkingDir);
      const key = resolvedPath.trim();
      if (!key || seenPaths.has(key)) {
        continue;
      }

      seenPaths.add(key);
      items.push({
        label: getArtifactLabel(file.path),
        path: resolvedPath,
        role: getArtifactDisplayRole(null),
      });
    }

    return items.sort(
      (a, b) => getArtifactDisplayRolePriority(a.role) - getArtifactDisplayRolePriority(b.role)
    );
  }, [currentWorkingDir, displayArtifactSteps, recentWorkspaceFiles]);
  const documentWorkshopProgress = useMemo(
    () => getDocumentWorkshopProgress(messages, steps, displayArtifacts.length),
    [displayArtifacts.length, messages, steps]
  );
  const documentWorkshopMemoryContent = useMemo(
    () => buildDocumentWorkshopMemoryContent(documentWorkshopProgress, displayArtifacts),
    [displayArtifacts, documentWorkshopProgress]
  );
  const documentWorkshopEvidenceChips = useMemo(
    () => buildDocumentWorkshopEvidenceChips(documentWorkshopProgress),
    [documentWorkshopProgress]
  );
  const documentWorkshopReadiness = useMemo(
    () => getDocumentWorkshopReadiness(documentWorkshopProgress, displayArtifacts),
    [displayArtifacts, documentWorkshopProgress]
  );
  const canSaveDocumentWorkshopMemory = Boolean(
    documentWorkshopProgress.visible &&
    documentWorkshopProgress.completedCount > 0 &&
    getMemoryApi()?.add
  );

  useEffect(() => {
    setWorkshopMemoryStatus('idle');
    setWorkshopMemoryError(null);
  }, [activeSessionId]);

  useEffect(() => {
    if (contextPanelCollapsed) {
      return;
    }
    const loadMCPServers = async () => {
      try {
        const servers = await getMCPServers();
        setMcpServers(servers || []);
      } catch (error) {
        console.error('Failed to load MCP servers:', error);
      }
    };
    loadMCPServers();
    const interval = setInterval(loadMCPServers, 30000);
    return () => clearInterval(interval);
  }, [contextPanelCollapsed, getMCPServers]);

  if (contextPanelCollapsed) {
    return (
      <div className="w-10 h-full bg-background border-l border-border-muted flex items-start justify-center pt-3">
        <button
          onClick={toggleContextPanel}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          title={t('context.expandPanel')}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-background border-l border-border-muted flex flex-col overflow-hidden text-sm">
      {/* Header */}
      <div className="px-3 h-10 flex items-center gap-2 border-b border-border-muted shrink-0">
        <button
          onClick={toggleContextPanel}
          className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          title={t('context.collapsePanel')}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {t('context.context')}
        </span>
      </div>

      {/* Session Stats */}
      {activeSession && (
        <div className="px-4 py-3 border-b border-border-muted space-y-1.5">
          <div className="flex items-center gap-1.5 text-text-primary font-medium">
            <Cpu className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <span className="truncate">{modelName}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-text-muted pl-5">
            <span className="flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              {messageCount}
            </span>
            <span className="flex items-center gap-1">
              <Wrench className="w-3 h-3" />
              {toolCallCount}
            </span>
            {tokenUsage.total > 0 && (
              <span className="ml-auto text-text-muted/70">
                {t('context.inputTokens')} {formatTokenCount(tokenUsage.input)} ·{' '}
                {t('context.outputTokens')} {formatTokenCount(tokenUsage.output)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Context Usage */}
      {activeSession && contextUsage && (
        <div className="px-4 py-2.5 border-b border-border-muted space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
              {t('context.contextUsage')}
            </span>
            <span
              className={`text-xs font-medium ${
                contextUsage.percentage > 95
                  ? 'text-error'
                  : contextUsage.percentage > 80
                    ? 'text-warning'
                    : 'text-text-primary'
              }`}
            >
              {Math.round(contextUsage.percentage)}%
            </span>
          </div>
          <div className="h-1.5 bg-surface-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                contextUsage.percentage > 95
                  ? 'bg-error'
                  : contextUsage.percentage > 80
                    ? 'bg-warning'
                    : 'bg-gradient-to-r from-accent to-accent-hover'
              }`}
              style={{ width: `${contextUsage.percentage}%` }}
            />
          </div>
          <p className="text-xs text-text-muted">
            {t('context.contextUsageLabel', {
              used: formatTokenCount(contextUsage.used),
              total: formatTokenCount(contextUsage.total),
            })}
          </p>
        </div>
      )}

      {/* Document Workshop */}
      {documentWorkshopProgress.visible && (
        <div
          data-testid="context-document-workshop"
          className="px-4 py-3 border-b border-border-muted space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <FileText className="w-3.5 h-3.5 text-accent shrink-0" />
              <span className="text-xs font-medium text-text-muted uppercase tracking-wider truncate">
                {t('context.documentWorkshop.title')}
              </span>
            </div>
            <span
              data-testid="context-document-workshop-progress"
              className="text-[10px] text-text-muted shrink-0"
            >
              {t('context.documentWorkshop.progress', {
                done: documentWorkshopProgress.completedCount,
                total: documentWorkshopProgress.totalCount,
              })}
            </span>
          </div>
          <div className="space-y-1.5">
            {documentWorkshopProgress.steps.map((step) => {
              const isDone = step.status === 'done';
              const isActive = step.status === 'active';

              return (
                <div
                  key={step.id}
                  data-testid={`context-document-workshop-step-${step.id}`}
                  className="flex items-center gap-2 text-xs text-text-secondary"
                >
                  <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                    {isDone ? (
                      <Check className="w-3 h-3 text-success" />
                    ) : isActive ? (
                      <Loader2 className="w-3 h-3 text-accent animate-spin" />
                    ) : (
                      <span className="w-2 h-2 rounded-full border border-border-muted" />
                    )}
                  </span>
                  <span className={isDone ? 'text-text-primary' : isActive ? 'text-accent' : ''}>
                    {t(`context.documentWorkshop.step.${step.id}`)}
                  </span>
                </div>
              );
            })}
          </div>
          {documentWorkshopProgress.todos.length > 0 && (
            <div
              data-testid="context-document-workshop-todos"
              className="rounded-md border border-border-muted bg-surface/30 px-2.5 py-2"
            >
              <div className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                {t('context.documentWorkshop.todoTitle')}
              </div>
              <div className="mt-1.5 space-y-1">
                {documentWorkshopProgress.todos.map((todo) => (
                  <div
                    key={todo.id}
                    data-testid={`context-document-workshop-todo-${todo.id}`}
                    className="flex items-center gap-1.5 text-xs text-text-secondary"
                  >
                    {todo.status === 'active' ? (
                      <Loader2 className="w-3 h-3 text-accent animate-spin shrink-0" />
                    ) : (
                      <span className="w-2 h-2 rounded-full border border-border-muted shrink-0" />
                    )}
                    <span className={todo.status === 'active' ? 'text-accent' : ''}>
                      {t(`context.documentWorkshop.step.${todo.id}`)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div
            data-testid="context-document-workshop-traceability"
            className="rounded-md border border-border-muted bg-surface/30 px-2.5 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                {t('context.documentWorkshop.traceTitle')}
              </div>
              <div
                data-testid="context-document-workshop-traceability-progress"
                className="text-[10px] text-text-muted"
              >
                {t('context.documentWorkshop.progress', {
                  done: documentWorkshopProgress.traceCompletedCount,
                  total: documentWorkshopProgress.traceTotalCount,
                })}
              </div>
            </div>
            <div className="mt-1.5 space-y-1">
              {documentWorkshopProgress.traceLinks.map((link) => {
                const isDone = link.status === 'done';
                const isActive = link.status === 'active';

                return (
                  <div
                    key={link.id}
                    data-testid={`context-document-workshop-trace-${link.id}`}
                    className="flex items-center gap-1.5 text-xs text-text-secondary"
                  >
                    {isDone ? (
                      <Check className="w-3 h-3 text-success shrink-0" />
                    ) : isActive ? (
                      <Loader2 className="w-3 h-3 text-accent animate-spin shrink-0" />
                    ) : (
                      <span className="w-2 h-2 rounded-full border border-border-muted shrink-0" />
                    )}
                    <span className={isDone ? 'text-text-primary' : isActive ? 'text-accent' : ''}>
                      {t(`context.documentWorkshop.trace.${link.id}`)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div
              data-testid="context-document-workshop-trace-evidence"
              className="mt-2 flex flex-wrap gap-1"
            >
              {documentWorkshopEvidenceChips.map((chip) => (
                <span
                  key={chip.id}
                  data-testid={`context-document-workshop-trace-evidence-${chip.id}`}
                  data-observed={chip.observed ? 'true' : 'false'}
                  className={`rounded border px-1.5 py-0.5 text-[10px] ${
                    chip.observed
                      ? 'border-success/30 bg-success/10 text-success'
                      : 'border-border-muted bg-background/50 text-text-muted'
                  }`}
                >
                  {t(`context.documentWorkshop.evidence.${chip.id}`, { count: chip.count })}
                </span>
              ))}
            </div>
            <div
              data-testid="context-document-workshop-readiness"
              data-status={documentWorkshopReadiness.status}
              className={`mt-2 rounded border px-2 py-1 text-[10px] ${
                documentWorkshopReadiness.status === 'ready'
                  ? 'border-success/30 bg-success/10 text-success'
                  : documentWorkshopReadiness.status === 'inProgress'
                    ? 'border-accent/30 bg-accent/10 text-accent'
                    : 'border-border-muted bg-background/50 text-text-muted'
              }`}
            >
              {t(`context.documentWorkshop.readiness.${documentWorkshopReadiness.status}`)}
            </div>
          </div>
          {canSaveDocumentWorkshopMemory && (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                data-testid="context-document-workshop-save-memory"
                onClick={() => void handleSaveWorkshopMemory()}
                disabled={workshopMemoryStatus === 'saving'}
                className="inline-flex w-fit items-center gap-1 rounded-md border border-success/50 px-2 py-1 text-[10px] text-success transition-colors hover:bg-success/10 disabled:opacity-60"
              >
                {workshopMemoryStatus === 'saving' ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Brain className="w-3 h-3" />
                )}
                {workshopMemoryStatus === 'saving'
                  ? t('context.documentWorkshop.savingMemory')
                  : workshopMemoryStatus === 'saved'
                    ? t('context.documentWorkshop.savedMemory')
                    : t('context.documentWorkshop.saveMemory')}
              </button>
              {workshopMemoryStatus === 'error' && workshopMemoryError && (
                <div
                  data-testid="context-document-workshop-save-memory-error"
                  className="rounded border border-error/30 bg-error/10 px-2 py-1 text-[10px] text-error"
                >
                  {t('context.documentWorkshop.saveMemoryFailed')}: {workshopMemoryError}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Artifacts Section */}
      <div className="border-b border-border-muted">
        <button
          onClick={() => setArtifactsOpen(!artifactsOpen)}
          className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-surface-hover transition-colors"
        >
          <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
            {t('context.artifacts')}
          </span>
          {artifactsOpen ? (
            <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
          )}
        </button>

        {artifactsOpen && (
          <div className="pb-2 max-h-64 overflow-y-auto">
            {displayArtifacts.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-2 text-xs text-text-muted">
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span>{t('context.noArtifactsYet')}</span>
              </div>
            ) : (
              <div>
                {displayArtifacts.map((artifact, index) => {
                  const label = artifact.label || t('context.fileCreated');
                  const artifactPath = artifact.path;
                  const roleLabel = t(
                    `context.artifactRole.${artifact.role}`,
                    getArtifactDisplayRoleLabel(artifact.role)
                  );
                  const evidenceDisplay = getDocxValidationEvidenceDisplay(artifact.evidence);
                  const evidenceLabel = evidenceDisplay
                    ? t(evidenceDisplay.labelKey, evidenceDisplay.labelValues)
                    : null;
                  const evidenceTitle = evidenceDisplay
                    ? t(evidenceDisplay.titleKey, evidenceDisplay.titleValues)
                    : undefined;
                  const canClick = Boolean(
                    artifactPath && (canPreviewArtifact || canShowItemInFolder)
                  );
                  const iconComponent = getArtifactIconComponent(label);
                  const IconComponent =
                    iconComponent === 'presentation'
                      ? FilePieChart
                      : iconComponent === 'table'
                        ? FileSpreadsheet
                        : iconComponent === 'document'
                          ? FileText
                          : iconComponent === 'code'
                            ? FileCode2
                            : iconComponent === 'image'
                              ? ImageIcon
                              : iconComponent === 'audio'
                                ? FileAudio2
                                : iconComponent === 'video'
                                  ? FileVideo
                                  : iconComponent === 'archive'
                                    ? FileArchive
                                    : iconComponent === 'text'
                                      ? File
                                      : File;

                  return (
                    <div
                      key={artifact.path || artifact.label || `artifact-${index}`}
                      data-testid={`context-artifact-row-${index}`}
                      className={`flex items-center gap-2 px-4 py-1.5 transition-colors ${canClick ? 'cursor-pointer hover:bg-surface-hover' : ''}`}
                      onClick={async () => {
                        if (!canClick) return;
                        await openArtifact(artifactPath);
                      }}
                      title={artifactPath || undefined}
                    >
                      <IconComponent className="w-3.5 h-3.5 text-text-muted shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-text-primary truncate">{label}</div>
                        {evidenceLabel && (
                          <div className="text-[10px] text-success truncate" title={evidenceTitle}>
                            {evidenceLabel}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-text-muted uppercase tracking-wide">
                          {roleLabel}
                        </span>
                        {artifactPath && (
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleCopyArtifactPath(artifactPath);
                            }}
                            className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                            title={t('context.copyPath')}
                            aria-label={`${t('context.copyPath')}: ${label}`}
                          >
                            {copiedArtifactPath === artifactPath ? (
                              <Check className="w-3 h-3 text-success" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        )}
                        {artifactPath && canShowItemInFolder && (
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              void revealArtifact(artifactPath);
                            }}
                            className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
                            title={t('context.openInFileManager')}
                            aria-label={`${t('context.openInFileManager')}: ${label}`}
                          >
                            <FolderOpen className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Working Directory */}
      <div className="border-b border-border-muted">
        <div className="px-4 py-2.5">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
            {t('context.workingDirectory')}
          </p>
          <div className="flex items-center gap-1.5 min-w-0">
            <FolderOpen className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <span
              className={`text-xs truncate flex-1 ${currentWorkingDir ? 'text-text-primary cursor-pointer hover:text-accent-primary transition-colors' : 'text-text-muted'}`}
              title={currentWorkingDir ? t('context.openInFileManager') : ''}
              onClick={() =>
                currentWorkingDir && window.electronAPI?.showItemInFolder(currentWorkingDir)
              }
            >
              {currentWorkingDir ? formatPath(currentWorkingDir) : t('context.noFolderSelected')}
            </span>
            {currentWorkingDir && (
              <button
                onClick={() => handleCopyPath(currentWorkingDir)}
                className="text-text-muted hover:text-text-primary transition-colors shrink-0 ml-1"
                title={t('context.copyPath')}
              >
                {copiedPath ? (
                  <Check className="w-3 h-3 text-success" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            )}
            <button
              onClick={async () => {
                setIsChangingDir(true);
                try {
                  const result = await changeWorkingDir(
                    activeSessionId || undefined,
                    currentWorkingDir || undefined
                  );
                  if (!result.success && result.error && result.error !== 'User cancelled') {
                    setGlobalNotice({
                      id: `change-dir-failed-${Date.now()}`,
                      type: 'warning',
                      message: `${t('context.changeDirFailed')}: ${result.error}`,
                    });
                  }
                } catch (error) {
                  setGlobalNotice({
                    id: `change-dir-failed-${Date.now()}`,
                    type: 'error',
                    message:
                      error instanceof Error && error.message
                        ? `${t('context.changeDirFailed')}: ${error.message}`
                        : t('context.changeDirFailed'),
                  });
                } finally {
                  setIsChangingDir(false);
                }
              }}
              disabled={isChangingDir}
              className="text-text-muted hover:text-text-primary disabled:opacity-50 transition-colors shrink-0"
              title={t('context.changeDir')}
            >
              {isChangingDir ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <FolderSync className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Checkpoints */}
      <CheckpointSection cwd={currentWorkingDir} />

      {/* Tab navigation (Claude Cowork parity — unified tabs) */}
      <div className="flex border-b border-border-muted bg-background/40">
        {(
          [
            { id: 'files', label: 'Files' },
            { id: 'git', label: 'Git' },
            { id: 'memory', label: 'Memory' },
            { id: 'knowledge', label: 'Knowledge' },
            { id: 'agents', label: 'Agents' },
            { id: 'mcp', label: 'MCP' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-2 py-2 text-[11px] font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-accent border-b-2 border-accent -mb-px'
                : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'files' && currentWorkingDir && <FileTree rootPath={currentWorkingDir} />}
        {activeTab === 'files' && !currentWorkingDir && (
          <div className="px-4 py-4 text-xs text-text-muted">{t('git.noWorkingDir')}</div>
        )}

        {activeTab === 'git' && <GitStatusPanel />}

        {activeTab === 'memory' && <MemoryInspector />}

        {activeTab === 'knowledge' && <KnowledgeBaseBrowser />}

        {activeTab === 'agents' && <SubAgentPanel />}

        {activeTab === 'mcp' && (
          <div className="px-4 py-2.5">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
              {t('context.mcpConnectors')}
            </p>
            {mcpServers.length === 0 ? (
              <div className="flex items-center gap-2 text-xs text-text-muted py-1">
                <Plug className="w-3.5 h-3.5 shrink-0" />
                <span>{t('mcp.noConnectors')}</span>
              </div>
            ) : (
              <div className="space-y-0.5">
                {mcpServers.map((server) => (
                  <ConnectorItem
                    key={server.id}
                    server={server}
                    steps={steps}
                    expanded={expandedConnector === server.id}
                    onToggle={() =>
                      setExpandedConnector(expandedConnector === server.id ? null : server.id)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectorItem({
  server,
  steps,
  expanded,
  onToggle,
}: {
  server: MCPServerInfo;
  steps: TraceStep[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  // Get MCP tools used from this server
  // Tool names are in format: mcp__ServerName__toolname (with double underscores)
  // Server name preserves original case and spaces are replaced with underscores
  const serverNamePattern = server.name.replace(/\s+/g, '_');

  const mcpToolsUsed = steps
    .filter((s) => s.toolName?.startsWith('mcp__'))
    .map((s) => s.toolName!)
    .filter((name, index, self) => self.indexOf(name) === index)
    .filter((name) => {
      // Check if this tool belongs to this server
      // Format: mcp__ServerName__toolname
      const match = name.match(/^mcp__(.+?)__(.+)$/);
      if (match) {
        const toolServerName = match[1];
        return toolServerName === serverNamePattern;
      }
      return false;
    });

  const usageCount = steps.filter(
    (s) => s.toolName?.startsWith('mcp__') && mcpToolsUsed.includes(s.toolName)
  ).length;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        onClick={onToggle}
        className={`w-full px-3 py-2 flex items-center gap-2 transition-colors ${
          server.connected ? 'bg-mcp/10 hover:bg-mcp/20' : 'bg-surface-muted hover:bg-surface-hover'
        }`}
      >
        <div
          className={`w-6 h-6 rounded flex items-center justify-center ${
            server.connected ? 'bg-mcp/20' : 'bg-surface-muted'
          }`}
        >
          <Plug className={`w-3.5 h-3.5 ${server.connected ? 'text-mcp' : 'text-text-muted'}`} />
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">{server.name}</span>
            {!server.connected && (
              <span className="text-xs text-text-muted">({t('mcp.notConnected')})</span>
            )}
          </div>
          {server.connected && (
            <p className="text-xs text-text-muted">
              {t('mcp.toolCount', { count: server.toolCount })}
              {usageCount > 0 && ` • ${t('mcp.callCount', { count: usageCount })}`}
            </p>
          )}
        </div>
        {server.connected &&
          (expanded ? (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-muted" />
          ))}
      </button>

      {expanded && server.connected && (
        <div className="px-3 pb-2 space-y-1 bg-surface">
          {mcpToolsUsed.length > 0 ? (
            <>
              <p className="text-xs text-text-muted px-2 py-1">{t('context.toolsUsedLabel')}</p>
              {mcpToolsUsed.map((toolName, index) => {
                const count = steps.filter((s) => s.toolName === toolName).length;
                // Extract readable tool name - remove mcp__ServerName__ prefix
                const match = toolName.match(/^mcp__(.+?)__(.+)$/);
                const readableName = match ? match[2] : toolName;

                return (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-mcp/5 hover:bg-mcp/10 transition-colors"
                  >
                    <Wrench className="w-3.5 h-3.5 text-mcp" />
                    <span className="text-xs text-text-primary flex-1">{readableName}</span>
                    <span className="text-xs text-text-muted">{count}x</span>
                  </div>
                );
              })}
            </>
          ) : (
            <p className="text-xs text-text-muted px-2 py-1">{t('context.noToolsUsedYet')}</p>
          )}
        </div>
      )}
    </div>
  );
}

// Format long paths to show abbreviated version
function formatPath(path: string): string {
  if (!path) return '';

  // Windows: Replace C:\Users\username with ~
  const winHome = /^[A-Z]:\\Users\\[^\\]+/i;
  const winMatch = path.match(winHome);
  if (winMatch) {
    return '~' + path.slice(winMatch[0].length).replace(/\\/g, '/');
  }

  // macOS/Linux: Replace /Users/username or /home/username with ~
  const unixHome = /^\/(?:Users|home)\/[^/]+/;
  const unixMatch = path.match(unixHome);
  if (unixMatch) {
    return '~' + path.slice(unixMatch[0].length);
  }

  return path;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function getMemoryApi(): MemoryApiBridge | undefined {
  return (
    window as unknown as {
      electronAPI?: { memory?: MemoryApiBridge };
    }
  ).electronAPI?.memory;
}
