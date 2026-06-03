/**
 * SubAgentDashboard — P2.6
 *
 * Hierarchical view of all sub-agents spawned in the active session. Shows
 * status, progress, parent/child relationships, and a preview of the most
 * recent output buffer for each agent.
 *
 * Trigger: Cmd/Ctrl+Shift+A or via the title-bar action.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Bot,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { useAppStore } from '../store';
import type { SubAgent } from '../types';

interface SubAgentDashboardProps {
  onClose: () => void;
}

const STATUS_ICONS = {
  running: <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />,
  waiting: <Clock className="w-3.5 h-3.5 text-warning" />,
  completed: <CheckCircle2 className="w-3.5 h-3.5 text-success" />,
  error: <XCircle className="w-3.5 h-3.5 text-error" />,
  closed: <X className="w-3.5 h-3.5 text-text-muted" />,
};

interface TreeNode {
  agent: SubAgent;
  children: TreeNode[];
}

const EMPTY_AGENTS: SubAgent[] = [];
const EMPTY_OUTPUTS: Record<string, string> = {};

function buildTree(agents: SubAgent[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const a of agents) byId.set(a.id, { agent: a, children: [] });
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.agent.parentId ? byId.get(node.agent.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function AgentNode({
  node,
  expanded,
  outputs,
  toggleExpanded,
  onSendInput,
  onClose: onCloseAgent,
}: {
  node: TreeNode;
  expanded: Set<string>;
  outputs: Record<string, string>;
  toggleExpanded: (id: string) => void;
  onSendInput: (agentId: string) => void;
  onClose: (agentId: string) => void;
}) {
  const { t } = useTranslation();
  const isExpanded = expanded.has(node.agent.id);
  const hasChildren = node.children.length > 0;
  const output = outputs[node.agent.id];

  return (
    <div className="space-y-1.5">
      <div
        className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-surface-hover transition-colors group"
        style={{ paddingLeft: `${node.agent.depth * 16 + 8}px` }}
      >
        <button
          type="button"
          onClick={() => toggleExpanded(node.agent.id)}
          className="mt-0.5 shrink-0"
        >
          {hasChildren || output ? (
            isExpanded ? (
              <ChevronDown className="w-3 h-3 text-text-muted" />
            ) : (
              <ChevronRight className="w-3 h-3 text-text-muted" />
            )
          ) : (
            <Bot className="w-3 h-3 text-text-muted" />
          )}
        </button>
        <div className="shrink-0 mt-0.5">{STATUS_ICONS[node.agent.status]}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium truncate">{node.agent.nickname}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-muted uppercase">
              {node.agent.role}
            </span>
            {typeof node.agent.progress === 'number' && (
              <span className="text-[10px] text-text-muted">
                {Math.round(node.agent.progress * 100)}%
              </span>
            )}
          </div>
          {node.agent.currentStep && (
            <p className="text-[10px] text-text-muted truncate mt-0.5">
              {node.agent.currentStep}
            </p>
          )}
          {typeof node.agent.progress === 'number' && node.agent.status === 'running' && (
            <div className="mt-1 h-0.5 bg-surface rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${node.agent.progress * 100}%` }}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {(node.agent.status === 'running' || node.agent.status === 'waiting') && (
            <button
              type="button"
              onClick={() => onSendInput(node.agent.id)}
              className="text-[10px] text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded hover:bg-surface-hover"
              data-testid={`subagent-input-${node.agent.id}`}
            >
              {t('subAgent.sendInput', 'Send')}
            </button>
          )}
          {node.agent.status !== 'closed' && node.agent.status !== 'completed' && (
            <button
              type="button"
              onClick={() => onCloseAgent(node.agent.id)}
              className="text-[10px] text-text-muted hover:text-error px-1.5 py-0.5 rounded hover:bg-surface-hover"
              data-testid={`subagent-close-${node.agent.id}`}
            >
              {t('subAgent.close', 'Close')}
            </button>
          )}
        </div>
      </div>
      {isExpanded && (output || node.agent.result) && (
        <div
          className="ml-6 bg-surface/40 border border-border-subtle rounded p-2 text-[11px] text-text-secondary font-mono max-h-40 overflow-y-auto whitespace-pre-wrap"
          style={{ marginLeft: `${node.agent.depth * 16 + 24}px` }}
        >
          {output ?? node.agent.result}
        </div>
      )}
      {isExpanded &&
        node.children.map((child) => (
          <AgentNode
            key={child.agent.id}
            node={child}
            expanded={expanded}
            outputs={outputs}
            toggleExpanded={toggleExpanded}
            onSendInput={onSendInput}
            onClose={onCloseAgent}
          />
        ))}
    </div>
  );
}

export function SubAgentDashboard({ onClose }: SubAgentDashboardProps) {
  const { t } = useTranslation();
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const subAgents = useAppStore((s) => s.subAgents);
  const subAgentOutputs = useAppStore((s) => s.subAgentOutputs);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const agents = activeSessionId ? subAgents[activeSessionId] ?? EMPTY_AGENTS : EMPTY_AGENTS;
  const outputs = activeSessionId ? subAgentOutputs[activeSessionId] ?? EMPTY_OUTPUTS : EMPTY_OUTPUTS;
  const tree = useMemo(() => buildTree(agents), [agents]);

  // Expand all by default the first time we see agents
  useEffect(() => {
    if (expanded.size === 0 && agents.length > 0) {
      setExpanded(new Set(agents.map((a) => a.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSendInput = async (agentId: string) => {
    const api = window.electronAPI?.subAgent?.sendInput;
    if (!api) return;
    const msg = window.prompt(t('subAgent.inputPrompt', 'Message to send to sub-agent:'));
    if (!msg) return;
    try {
      await api(agentId, msg, false);
    } catch {
      /* ignore */
    }
  };

  const handleCloseAgent = async (agentId: string) => {
    const api = window.electronAPI?.subAgent?.close;
    if (!api) return;
    try {
      await api(agentId);
    } catch {
      /* ignore */
    }
  };

  const counts = useMemo(() => {
    const out = { running: 0, completed: 0, error: 0, other: 0 };
    for (const a of agents) {
      if (a.status === 'running') out.running++;
      else if (a.status === 'completed') out.completed++;
      else if (a.status === 'error') out.error++;
      else out.other++;
    }
    return out;
  }, [agents]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4"
      data-testid="subagent-dashboard"
    >
      <div className="bg-background border border-border rounded-2xl shadow-2xl max-w-3xl w-full max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-muted">
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-accent" />
            <h2 className="text-sm font-semibold">
              {t('subAgentDashboard.title', 'Sub-agents')}
            </h2>
            <span className="text-[10px] text-text-muted">
              {agents.length} {t('subAgentDashboard.total', 'total')}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover"
          >
            <X size={14} />
          </button>
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-3 px-5 py-2 border-b border-border-muted bg-surface/30 text-[11px]">
          <span className="flex items-center gap-1.5 text-accent">
            <Loader2 className="w-3 h-3 animate-spin" />
            {counts.running} {t('subAgentDashboard.running', 'running')}
          </span>
          <span className="flex items-center gap-1.5 text-success">
            <CheckCircle2 className="w-3 h-3" />
            {counts.completed} {t('subAgentDashboard.completed', 'completed')}
          </span>
          {counts.error > 0 && (
            <span className="flex items-center gap-1.5 text-error">
              <XCircle className="w-3 h-3" />
              {counts.error} {t('subAgentDashboard.error', 'errored')}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {agents.length === 0 ? (
            <div className="text-center text-xs text-text-muted py-12">
              {t(
                'subAgentDashboard.empty',
                'No sub-agents in this session yet. They appear automatically when the agent spawns them.'
              )}
            </div>
          ) : (
            tree.map((node) => (
              <AgentNode
                key={node.agent.id}
                node={node}
                expanded={expanded}
                outputs={outputs}
                toggleExpanded={toggleExpanded}
                onSendInput={handleSendInput}
                onClose={handleCloseAgent}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
