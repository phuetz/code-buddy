/**
 * WorkflowEditor — Claude Cowork parity Phase 2 step 15
 *
 * Native SVG DAG canvas for building workflows visually. No external
 * DAG library — draws its own nodes and edges. Supports:
 *   - Drag nodes around the canvas
 *   - Click-to-connect edges (source → target)
 *   - Palette of node types (tool, condition, parallel, approval)
 *   - Save / Run buttons
 *
 * @module renderer/components/WorkflowEditor
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Wrench,
  GitBranch,
  Layers,
  ShieldCheck,
  Play,
  Save,
  Trash2,
  Plus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAppStore } from '../store';

type NodeType = 'tool' | 'condition' | 'parallel' | 'approval' | 'start' | 'end';

interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  position: { x: number; y: number };
  config?: Record<string, unknown>;
}

interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

interface WorkflowDefinition {
  id?: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

interface WorkflowEditorProps {
  initial?: WorkflowDefinition;
  onSave?: (definition: WorkflowDefinition) => Promise<void>;
  onRun?: (definitionId: string) => Promise<void>;
  onClose?: () => void;
}

const NODE_WIDTH = 140;
const NODE_HEIGHT = 48;

const NODE_COLORS: Record<NodeType, string> = {
  start: '#10b981',
  end: '#64748b',
  tool: '#3b82f6',
  condition: '#f59e0b',
  parallel: '#8b5cf6',
  approval: '#ec4899',
};

const NODE_ICONS: Record<NodeType, LucideIcon> = {
  start: Play,
  end: X,
  tool: Wrench,
  condition: GitBranch,
  parallel: Layers,
  approval: ShieldCheck,
};

function makeNodeId(): string {
  return `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function makeEdgeId(): string {
  return `edge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export const WorkflowEditor: React.FC<WorkflowEditorProps> = ({
  initial,
  onSave,
  onRun,
  onClose,
}) => {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? t('workflow.untitled'));
  const [description] = useState(initial?.description ?? '');
  const [nodes, setNodes] = useState<WorkflowNode[]>(
    initial?.nodes ?? [
      {
        id: 'start',
        type: 'start',
        name: 'Start',
        position: { x: 40, y: 60 },
      },
      {
        id: 'end',
        type: 'end',
        name: 'End',
        position: { x: 300, y: 60 },
      },
    ]
  );
  const [edges, setEdges] = useState<WorkflowEdge[]>(initial?.edges ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Live execution state — pick the most recently-started run for this
  // workflow id so the canvas reflects what the bridge is doing now.
  const workflowExecutions = useAppStore((s) => s.workflowExecutions);
  const liveExecution = useMemo(() => {
    if (!initial?.id) return null;
    const matching = Object.values(workflowExecutions).filter(
      (e) => e.workflowId === initial.id
    );
    if (matching.length === 0) return null;
    return matching.reduce((latest, cur) =>
      cur.startedAt > latest.startedAt ? cur : latest
    );
  }, [workflowExecutions, initial?.id]);
  const nodeStatus = (nodeId: string): string | null =>
    liveExecution?.nodeStatuses[nodeId] ?? null;
  const dragOffsetRef = useRef<{ nodeId: string; dx: number; dy: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const addNode = useCallback((type: NodeType) => {
    const newNode: WorkflowNode = {
      id: makeNodeId(),
      type,
      name: type.charAt(0).toUpperCase() + type.slice(1),
      position: {
        x: 160 + Math.random() * 240,
        y: 120 + Math.random() * 120,
      },
    };
    setNodes((prev) => [...prev, newNode]);
    setSelectedId(newNode.id);
  }, []);

  const deleteNode = useCallback((nodeId: string) => {
    if (nodeId === 'start' || nodeId === 'end') return;
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedId(null);
  }, []);

  const handleNodeMouseDown = (node: WorkflowNode) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (connectingFrom) {
      // Complete the connection
      if (connectingFrom !== node.id) {
        const newEdge: WorkflowEdge = {
          id: makeEdgeId(),
          source: connectingFrom,
          target: node.id,
        };
        setEdges((prev) => [...prev, newEdge]);
      }
      setConnectingFrom(null);
      return;
    }
    setSelectedId(node.id);
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    dragOffsetRef.current = {
      nodeId: node.id,
      dx: e.clientX - rect.left - node.position.x,
      dy: e.clientY - rect.top - node.position.y,
    };
  };

  const handleSvgMouseMove = (e: React.MouseEvent) => {
    const drag = dragOffsetRef.current;
    if (!drag) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left - drag.dx);
    const y = Math.max(0, e.clientY - rect.top - drag.dy);
    setNodes((prev) =>
      prev.map((n) => (n.id === drag.nodeId ? { ...n, position: { x, y } } : n))
    );
  };

  const handleSvgMouseUp = () => {
    dragOffsetRef.current = null;
  };

  const handleSvgClick = () => {
    setSelectedId(null);
    setConnectingFrom(null);
  };

  const handleSave = useCallback(async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave({
        id: initial?.id,
        name,
        description,
        nodes,
        edges,
      });
    } finally {
      setSaving(false);
    }
  }, [onSave, initial?.id, name, description, nodes, edges]);

  const handleRun = useCallback(async () => {
    if (!onRun || !initial?.id) return;
    setRunning(true);
    try {
      await onRun(initial.id);
    } finally {
      setRunning(false);
    }
  }, [onRun, initial?.id]);

  const selectedNode = nodes.find((n) => n.id === selectedId);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border-muted shrink-0">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 bg-transparent border-none outline-none text-sm font-semibold text-text-primary placeholder:text-text-muted"
          placeholder={t('workflow.namePlaceholder')}
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded transition-colors"
          title={t('workflow.save')}
        >
          <Save size={12} />
          {saving ? t('workflow.saving') : t('workflow.save')}
        </button>
        {initial?.id && (
          <button
            onClick={handleRun}
            disabled={running}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-success hover:bg-success/80 disabled:opacity-50 text-white rounded transition-colors"
            title={t('workflow.run')}
          >
            <Play size={12} />
            {running ? t('workflow.running') : t('workflow.run')}
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary"
            title={t('common.close')}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Body: palette + canvas + inspector */}
      <div className="flex-1 min-h-0 flex">
        {/* Palette */}
        <div className="w-40 border-r border-border-muted p-3 space-y-2 shrink-0">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-text-muted mb-2">
            {t('workflow.palette')}
          </div>
          {(['tool', 'condition', 'parallel', 'approval'] as NodeType[]).map((type) => {
            const Icon = NODE_ICONS[type];
            return (
              <button
                key={type}
                onClick={() => addNode(type)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs bg-surface hover:bg-surface-hover border border-border rounded transition-colors"
              >
                <Icon size={12} />
                {t(`workflow.nodeType.${type}`)}
                <Plus size={10} className="ml-auto text-text-muted" />
              </button>
            );
          })}
        </div>

        {/* Canvas */}
        <div className="flex-1 min-h-0 overflow-hidden bg-surface/20">
          <svg
            ref={svgRef}
            className="w-full h-full"
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
            onMouseLeave={handleSvgMouseUp}
            onClick={handleSvgClick}
          >
            {/* Grid pattern */}
            <defs>
              <pattern
                id="grid"
                width={20}
                height={20}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d="M 20 0 L 0 0 0 20"
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity={0.08}
                />
              </pattern>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX={10}
                refY={5}
                markerWidth={6}
                markerHeight={6}
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" className="text-text-muted" />

            {/* Edges */}
            <g className="text-accent">
              {edges.map((edge) => {
                const source = nodes.find((n) => n.id === edge.source);
                const target = nodes.find((n) => n.id === edge.target);
                if (!source || !target) return null;
                const x1 = source.position.x + NODE_WIDTH;
                const y1 = source.position.y + NODE_HEIGHT / 2;
                const x2 = target.position.x;
                const y2 = target.position.y + NODE_HEIGHT / 2;
                const mx = (x1 + x2) / 2;
                return (
                  <path
                    key={edge.id}
                    d={`M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    markerEnd="url(#arrow)"
                  />
                );
              })}
            </g>

            {/* Nodes */}
            {nodes.map((node) => {
              const isSelected = node.id === selectedId;
              const isConnectSource = node.id === connectingFrom;
              const color = NODE_COLORS[node.type];
              const status = nodeStatus(node.id);
              const statusStroke =
                status === 'running'
                  ? '#3b82f6'
                  : status === 'completed'
                    ? '#10b981'
                    : status === 'failed'
                      ? '#ef4444'
                      : null;
              const finalStroke =
                statusStroke ?? (isSelected || isConnectSource ? color : '#60676f');
              const finalStrokeWidth = statusStroke ? 2.5 : isSelected ? 2 : 1;
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.position.x}, ${node.position.y})`}
                  onMouseDown={handleNodeMouseDown(node)}
                  style={{ cursor: 'move' }}
                >
                  <rect
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={8}
                    fill="var(--color-background)"
                    stroke={finalStroke}
                    strokeWidth={finalStrokeWidth}
                  >
                    {status === 'running' && (
                      <animate
                        attributeName="stroke-opacity"
                        values="0.4;1;0.4"
                        dur="1.4s"
                        repeatCount="indefinite"
                      />
                    )}
                  </rect>
                  <rect
                    width={4}
                    height={NODE_HEIGHT}
                    rx={2}
                    fill={color}
                  />
                  <text
                    x={16}
                    y={20}
                    fill="var(--color-text-primary)"
                    fontSize={11}
                    fontWeight={600}
                  >
                    {node.name.slice(0, 18)}
                  </text>
                  <text
                    x={16}
                    y={36}
                    fill="var(--color-text-muted)"
                    fontSize={9}
                  >
                    {status ? `${node.type} · ${status}` : node.type}
                  </text>
                  {/* Connection anchor */}
                  <circle
                    cx={NODE_WIDTH}
                    cy={NODE_HEIGHT / 2}
                    r={4}
                    fill={color}
                    style={{ cursor: 'crosshair' }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setConnectingFrom(node.id);
                    }}
                  />
                </g>
              );
            })}
          </svg>
        </div>

        {/* Inspector */}
        {selectedNode && (
          <div className="w-64 border-l border-border-muted p-3 space-y-3 shrink-0 bg-surface/20">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wide font-semibold text-text-muted">
                {t('workflow.nodeProps')}
              </div>
              {selectedNode.id !== 'start' && selectedNode.id !== 'end' && (
                <button
                  onClick={() => deleteNode(selectedNode.id)}
                  className="p-1 text-text-muted hover:text-error"
                  title={t('common.delete')}
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
            <div>
              <label className="block text-[10px] text-text-muted mb-1">
                {t('workflow.nodeName')}
              </label>
              <input
                type="text"
                value={selectedNode.name}
                onChange={(e) => {
                  const newName = e.target.value;
                  setNodes((prev) =>
                    prev.map((n) => (n.id === selectedNode.id ? { ...n, name: newName } : n))
                  );
                }}
                className="w-full px-2 py-1 text-xs bg-background border border-border rounded text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-[10px] text-text-muted mb-1">
                {t('workflow.nodeType.label')}
              </label>
              <div className="text-xs text-text-primary px-2 py-1 bg-background border border-border rounded">
                {selectedNode.type}
              </div>
            </div>

            {/* Per-type configuration */}
            {selectedNode.type === 'tool' && (
              <NodeConfigTool node={selectedNode} setNodes={setNodes} />
            )}
            {selectedNode.type === 'condition' && (
              <NodeConfigCondition node={selectedNode} setNodes={setNodes} />
            )}
            {selectedNode.type === 'approval' && (
              <NodeConfigApproval node={selectedNode} setNodes={setNodes} />
            )}
            {selectedNode.type === 'parallel' && (
              <div className="text-[10px] text-text-muted bg-surface/40 border border-border-muted rounded p-2">
                Parallel runs every outgoing branch concurrently. Connect ≥2 branches and let them flow to <code>end</code>.
              </div>
            )}

            <div className="text-[10px] text-text-muted">
              <div>id: {selectedNode.id}</div>
              <div>
                pos: {Math.round(selectedNode.position.x)},{' '}
                {Math.round(selectedNode.position.y)}
              </div>
              {nodeStatus(selectedNode.id) && (
                <div>status: <strong>{nodeStatus(selectedNode.id)}</strong></div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ──────── Per-type config sub-components ────────

interface NodeConfigProps {
  node: WorkflowNode;
  setNodes: React.Dispatch<React.SetStateAction<WorkflowNode[]>>;
}

const NodeConfigTool: React.FC<NodeConfigProps> = ({ node, setNodes }) => {
  const cfg = (node.config ?? {}) as { toolName?: string; toolInput?: Record<string, unknown> };
  const [jsonText, setJsonText] = useState(() => JSON.stringify(cfg.toolInput ?? {}, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const updateConfig = (patch: Record<string, unknown>) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === node.id ? { ...n, config: { ...(n.config ?? {}), ...patch } } : n
      )
    );
  };

  return (
    <>
      <div>
        <label className="block text-[10px] text-text-muted mb-1">Tool name</label>
        <input
          type="text"
          value={cfg.toolName ?? ''}
          onChange={(e) => updateConfig({ toolName: e.target.value })}
          placeholder="e.g. bash_run, str_replace_editor"
          className="w-full px-2 py-1 text-xs font-mono bg-background border border-border rounded text-text-primary focus:outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="block text-[10px] text-text-muted mb-1">
          Tool input (JSON)
        </label>
        <textarea
          rows={4}
          value={jsonText}
          onChange={(e) => {
            const v = e.target.value;
            setJsonText(v);
            try {
              const parsed = v.trim() === '' ? {} : JSON.parse(v);
              setJsonError(null);
              updateConfig({ toolInput: parsed });
            } catch (err) {
              setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
            }
          }}
          className="w-full px-2 py-1 text-xs font-mono bg-background border border-border rounded text-text-primary focus:outline-none focus:border-accent"
          placeholder='{"command": "echo hello"}'
        />
        {jsonError && <div className="text-[10px] text-error mt-1">{jsonError}</div>}
      </div>
    </>
  );
};

const NodeConfigCondition: React.FC<NodeConfigProps> = ({ node, setNodes }) => {
  const cfg = (node.config ?? {}) as { expression?: string };
  const updateConfig = (patch: Record<string, unknown>) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === node.id ? { ...n, config: { ...(n.config ?? {}), ...patch } } : n
      )
    );
  };
  return (
    <div>
      <label className="block text-[10px] text-text-muted mb-1">Condition expression</label>
      <input
        type="text"
        value={cfg.expression ?? ''}
        onChange={(e) => updateConfig({ expression: e.target.value })}
        placeholder='e.g. $task_xxx.success === true'
        className="w-full px-2 py-1 text-xs font-mono bg-background border border-border rounded text-text-primary focus:outline-none focus:border-accent"
      />
      <div className="text-[10px] text-text-muted mt-1">
        Reference upstream task outputs as <code>$task_&lt;nodeId&gt;</code>. Outgoing
        edges must be labelled <code>true</code> / <code>false</code>.
      </div>
    </div>
  );
};

const NodeConfigApproval: React.FC<NodeConfigProps> = ({ node, setNodes }) => {
  const cfg = (node.config ?? {}) as { message?: string; timeoutMs?: number };
  const updateConfig = (patch: Record<string, unknown>) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === node.id ? { ...n, config: { ...(n.config ?? {}), ...patch } } : n
      )
    );
  };
  return (
    <>
      <div>
        <label className="block text-[10px] text-text-muted mb-1">Message</label>
        <input
          type="text"
          value={cfg.message ?? ''}
          onChange={(e) => updateConfig({ message: e.target.value })}
          placeholder="What to ask the user before continuing"
          className="w-full px-2 py-1 text-xs bg-background border border-border rounded text-text-primary focus:outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="block text-[10px] text-text-muted mb-1">Timeout (ms)</label>
        <input
          type="number"
          min={1000}
          step={1000}
          value={cfg.timeoutMs ?? 60000}
          onChange={(e) => updateConfig({ timeoutMs: Number(e.target.value) || 60000 })}
          className="w-full px-2 py-1 text-xs bg-background border border-border rounded text-text-primary focus:outline-none focus:border-accent"
        />
      </div>
    </>
  );
};
