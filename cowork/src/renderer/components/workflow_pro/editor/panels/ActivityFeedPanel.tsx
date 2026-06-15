// @ts-nocheck
/**
 * Activity Feed Panel
 * Vertical timeline showing workflow activity entries with filtering
 */

import React, { useState, useMemo } from 'react';
import { Activity, Plus, Trash2, Edit3, Play, Save, Settings, X } from 'lucide-react';
import { useWorkflowStore } from '../../store';

const ACTION_META: Record<string, { icon: React.ReactNode; label: string }> = {
  node_added:        { icon: <Plus size={12} />,     label: 'Node added' },
  node_deleted:      { icon: <Trash2 size={12} />,   label: 'Node deleted' },
  node_updated:      { icon: <Edit3 size={12} />,    label: 'Node updated' },
  workflow_executed: { icon: <Play size={12} />,      label: 'Workflow executed' },
  workflow_saved:    { icon: <Save size={12} />,      label: 'Workflow saved' },
  config_changed:    { icon: <Settings size={12} />,  label: 'Config changed' },
};

function relativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface ActivityFeedPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const ActivityFeedPanel: React.FC<ActivityFeedPanelProps> = ({ isOpen, onClose }) => {
  const activityLog = useWorkflowStore((state) => state.activityLog);
  const [filter, setFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return activityLog;
    return activityLog.filter((e) => e.action === filter);
  }, [activityLog, filter]);

  if (!isOpen) return null;

  return (
    <div className="p-4 rounded-lg border" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity size={18} />
          <h3 className="text-sm font-semibold">Activity</h3>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:opacity-70"><X size={16} /></button>
      </div>

      <select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-full mb-3 px-2 py-1.5 text-xs rounded border bg-transparent" style={{ borderColor: 'var(--border)' }}>
        <option value="all">All actions</option>
        {Object.entries(ACTION_META).map(([key, meta]) => (
          <option key={key} value={key}>{meta.label}</option>
        ))}
      </select>

      <div className="space-y-1 max-h-80 overflow-y-auto">
        {filtered.length === 0 && <p className="text-xs opacity-50 py-2 text-center">No activity yet.</p>}
        {filtered.map((entry) => {
          const meta = ACTION_META[entry.action] || { icon: <Activity size={12} />, label: entry.action };
          return (
            <div key={entry.id} className="flex items-start gap-2 px-2 py-1.5 rounded text-xs" style={{ background: 'var(--bg-secondary, rgba(0,0,0,0.05))' }}>
              <span className="mt-0.5 shrink-0 opacity-70">{meta.icon}</span>
              <div className="flex-1 min-w-0">
                <span className="font-medium">{meta.label}</span>
                {entry.details && <span className="opacity-70"> &mdash; {entry.details}</span>}
                <div className="opacity-50 mt-0.5">{entry.userId} &middot; {relativeTime(entry.timestamp)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ActivityFeedPanel;
