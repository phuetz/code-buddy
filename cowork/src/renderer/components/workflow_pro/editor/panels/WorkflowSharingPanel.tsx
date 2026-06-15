/**
 * Workflow Sharing Panel
 * Manage collaborator access and share workflows via link or email
 */

import React, { useState, useCallback } from 'react';
import { Share2, Users, Copy, X, Check } from 'lucide-react';
import { useWorkflowStore } from '../../store';

type PermissionLevel = 'viewer' | 'editor' | 'admin';

interface SharedUser {
  email: string;
  permission: PermissionLevel;
}

interface WorkflowSharingPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const WorkflowSharingPanel: React.FC<WorkflowSharingPanelProps> = ({ isOpen, onClose }) => {
  const workflowName = useWorkflowStore((state) => state.workflowName);
  const currentWorkflowId = useWorkflowStore((state) => state.currentWorkflowId);
  const [sharedUsers, setSharedUsers] = useState<SharedUser[]>([]);
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<PermissionLevel>('viewer');
  const [copied, setCopied] = useState(false);

  const handleAdd = useCallback(() => {
    const trimmed = email.trim();
    if (!trimmed || sharedUsers.some((u) => u.email === trimmed)) return;
    setSharedUsers((prev) => [...prev, { email: trimmed, permission }]);
    setEmail('');
  }, [email, permission, sharedUsers]);

  const handleRemove = useCallback((target: string) => {
    setSharedUsers((prev) => prev.filter((u) => u.email !== target));
  }, []);

  const handleCopyLink = useCallback(() => {
    const link = `${window.location.origin}/workflow/${currentWorkflowId || 'draft'}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [currentWorkflowId]);

  if (!isOpen) return null;

  return (
    <div className="p-4 rounded-lg border" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Share2 size={18} />
          <h3 className="text-sm font-semibold">Share Workflow</h3>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:opacity-70"><X size={16} /></button>
      </div>

      <p className="text-xs mb-3 opacity-70">Sharing: {workflowName}</p>

      {/* Add user */}
      <div className="flex gap-2 mb-4">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className="flex-1 px-2 py-1.5 text-xs rounded border bg-transparent"
          style={{ borderColor: 'var(--border)' }}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <select
          value={permission}
          onChange={(e) => setPermission(e.target.value as PermissionLevel)}
          className="px-2 py-1.5 text-xs rounded border bg-transparent"
          style={{ borderColor: 'var(--border)' }}
        >
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
        <button onClick={handleAdd} className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700">Add</button>
      </div>

      {/* Shared users list */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium mb-1">
          <Users size={14} />
          <span>Collaborators ({sharedUsers.length})</span>
        </div>
        {sharedUsers.length === 0 && <p className="text-xs opacity-50">No collaborators added yet.</p>}
        {sharedUsers.map((user) => (
          <div key={user.email} className="flex items-center justify-between px-2 py-1.5 rounded text-xs" style={{ background: 'var(--bg-secondary, rgba(0,0,0,0.05))' }}>
            <span className="truncate mr-2">{user.email}</span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="capitalize opacity-70">{user.permission}</span>
              <button onClick={() => handleRemove(user.email)} className="p-0.5 rounded hover:opacity-70"><X size={12} /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Copy link */}
      <button onClick={handleCopyLink} className="flex items-center gap-1.5 w-full justify-center px-3 py-2 text-xs rounded border hover:opacity-80" style={{ borderColor: 'var(--border)' }}>
        {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
        {copied ? 'Link Copied!' : 'Copy Link'}
      </button>
    </div>
  );
};

export default WorkflowSharingPanel;
