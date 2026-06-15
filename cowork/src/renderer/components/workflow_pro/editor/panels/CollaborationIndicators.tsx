/**
 * Collaboration Indicators
 * Shows real-time collaboration status and active users
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useWorkflowStore } from '../../store';
import {
  Users,
  Circle,
  MousePointer2,
  Edit3,
  Eye,
  MessageSquare,
  X,
  ChevronDown,
  ChevronUp,
  Lock,
  Send,
} from 'lucide-react';

interface CollaboratorPresence {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  color: string;
  status: 'active' | 'idle' | 'away';
  cursor?: { x: number; y: number };
  selectedNodeId?: string;
  lastActivity: number;
  role: 'editor' | 'viewer' | 'owner';
}

interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  message: string;
  timestamp: number;
}

interface CollaborationIndicatorsProps {
  isOpen: boolean;
  onClose: () => void;
}

// Mock collaborators for demo
const MOCK_COLLABORATORS: CollaboratorPresence[] = [
  {
    id: 'user_1',
    name: 'John Doe',
    email: 'john@example.com',
    color: '#3b82f6',
    status: 'active',
    cursor: { x: 400, y: 200 },
    selectedNodeId: 'node_1',
    lastActivity: Date.now() - 30000,
    role: 'owner',
  },
  {
    id: 'user_2',
    name: 'Jane Smith',
    email: 'jane@example.com',
    color: '#8b5cf6',
    status: 'active',
    cursor: { x: 600, y: 350 },
    lastActivity: Date.now() - 60000,
    role: 'editor',
  },
  {
    id: 'user_3',
    name: 'Bob Wilson',
    email: 'bob@example.com',
    color: '#22c55e',
    status: 'idle',
    lastActivity: Date.now() - 300000,
    role: 'viewer',
  },
];

const CollaborationIndicatorsComponent: React.FC<CollaborationIndicatorsProps> = ({
  isOpen,
  onClose,
}) => {
  const darkMode = useWorkflowStore((state) => state.darkMode);

  const [collaborators, setCollaborators] = useState<CollaboratorPresence[]>(MOCK_COLLABORATORS);
  const [expanded, setExpanded] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'msg_1',
      userId: 'user_1',
      userName: 'John Doe',
      message: 'I\'m working on the API integration node',
      timestamp: Date.now() - 120000,
    },
    {
      id: 'msg_2',
      userId: 'user_2',
      userName: 'Jane Smith',
      message: 'Sounds good! I\'ll handle the error handling',
      timestamp: Date.now() - 60000,
    },
  ]);
  const [newMessage, setNewMessage] = useState('');

  // Simulate real-time updates
  useEffect(() => {
    const interval = setInterval(() => {
      setCollaborators((prev) =>
        prev.map((c) => ({
          ...c,
          cursor: c.status === 'active' && c.cursor
            ? {
                x: c.cursor.x + (Math.random() - 0.5) * 50,
                y: c.cursor.y + (Math.random() - 0.5) * 50,
              }
            : c.cursor,
          status:
            Date.now() - c.lastActivity > 600000
              ? 'away'
              : Date.now() - c.lastActivity > 120000
              ? 'idle'
              : c.status,
        }))
      );
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Get status color
  const getStatusColor = useCallback((status: CollaboratorPresence['status']) => {
    switch (status) {
      case 'active':
        return 'bg-green-500';
      case 'idle':
        return 'bg-yellow-500';
      case 'away':
        return 'bg-gray-400';
      default:
        return 'bg-gray-400';
    }
  }, []);

  // Get role icon
  const getRoleIcon = useCallback((role: CollaboratorPresence['role']) => {
    switch (role) {
      case 'owner':
        return <Lock className="w-3 h-3" />;
      case 'editor':
        return <Edit3 className="w-3 h-3" />;
      case 'viewer':
        return <Eye className="w-3 h-3" />;
      default:
        return null;
    }
  }, []);

  // Format time ago
  const formatTimeAgo = useCallback((timestamp: number) => {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }, []);

  // Send chat message
  const sendMessage = useCallback(() => {
    if (!newMessage.trim()) return;

    const message: ChatMessage = {
      id: `msg_${Date.now()}`,
      userId: 'current_user',
      userName: 'You',
      message: newMessage,
      timestamp: Date.now(),
    };

    setChatMessages((prev) => [...prev, message]);
    setNewMessage('');
  }, [newMessage]);

  // Active users count
  const activeCount = useMemo(
    () => collaborators.filter((c) => c.status === 'active').length,
    [collaborators]
  );

  // Current user (mock)
  const currentUser = {
    id: 'current_user',
    name: 'You',
    role: 'editor' as const,
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Cursor overlays (would be rendered on canvas in real implementation) */}
      {collaborators
        .filter((c) => c.cursor && c.status === 'active')
        .map((collaborator) => (
          <div
            key={collaborator.id}
            className="fixed pointer-events-none z-50"
            style={{
              left: collaborator.cursor!.x,
              top: collaborator.cursor!.y,
              transform: 'translate(-2px, -2px)',
            }}
          >
            <MousePointer2
              className="w-5 h-5 drop-shadow-lg"
              style={{ color: collaborator.color }}
              fill={collaborator.color}
            />
            <span
              className="ml-4 px-2 py-0.5 rounded text-xs text-white whitespace-nowrap"
              style={{ backgroundColor: collaborator.color }}
            >
              {collaborator.name}
            </span>
          </div>
        ))}

      {/* Main panel */}
      <div
        className={`fixed left-4 bottom-4 w-72 overflow-hidden rounded-xl shadow-2xl border z-50 flex flex-col ${
          darkMode
            ? 'bg-gray-900 border-gray-700 text-white'
            : 'bg-white border-gray-200 text-gray-900'
        }`}
      >
        {/* Header */}
        <div
          className={`p-3 border-b flex items-center justify-between ${
            darkMode ? 'border-gray-700' : 'border-gray-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-500" />
            <span className="font-medium text-sm">Collaborators</span>
            <span
              className={`px-1.5 py-0.5 text-xs rounded-full ${
                darkMode ? 'bg-gray-800' : 'bg-gray-100'
              }`}
            >
              {activeCount} active
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowChat(!showChat)}
              className={`p-1 rounded transition-colors relative ${
                showChat
                  ? 'text-blue-500'
                  : darkMode
                  ? 'text-gray-400 hover:text-white'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              {chatMessages.length > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
              )}
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              className={`p-1 rounded transition-colors ${
                darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
              }`}
            >
              {expanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronUp className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={onClose}
              className={`p-1 rounded transition-colors ${
                darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'
              }`}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {expanded && (
          <>
            {/* Collaborators list */}
            {!showChat && (
              <div className="max-h-48 overflow-y-auto">
                {/* Current user */}
                <div
                  className={`px-3 py-2 flex items-center justify-between ${
                    darkMode ? 'bg-blue-500/10' : 'bg-blue-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
                        style={{ backgroundColor: '#3b82f6' }}
                      >
                        Y
                      </div>
                      <div
                        className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 ${
                          darkMode ? 'border-gray-900' : 'border-white'
                        } bg-green-500`}
                      />
                    </div>
                    <div>
                      <div className="text-sm font-medium">You</div>
                      <div className="text-xs text-gray-500 flex items-center gap-1">
                        {getRoleIcon(currentUser.role)}
                        <span className="capitalize">{currentUser.role}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Other collaborators */}
                {collaborators.map((collaborator) => (
                  <div
                    key={collaborator.id}
                    className={`px-3 py-2 flex items-center justify-between transition-colors ${
                      darkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        {collaborator.avatar ? (
                          <img
                            src={collaborator.avatar}
                            alt={collaborator.name}
                            className="w-8 h-8 rounded-full"
                          />
                        ) : (
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
                            style={{ backgroundColor: collaborator.color }}
                          >
                            {collaborator.name.charAt(0)}
                          </div>
                        )}
                        <div
                          className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 ${
                            darkMode ? 'border-gray-900' : 'border-white'
                          } ${getStatusColor(collaborator.status)}`}
                        />
                      </div>
                      <div>
                        <div className="text-sm font-medium">{collaborator.name}</div>
                        <div className="text-xs text-gray-500 flex items-center gap-1">
                          {getRoleIcon(collaborator.role)}
                          <span className="capitalize">{collaborator.role}</span>
                          <span>·</span>
                          <span>{formatTimeAgo(collaborator.lastActivity)}</span>
                        </div>
                      </div>
                    </div>
                    {collaborator.selectedNodeId && (
                      <span
                        className="px-1.5 py-0.5 text-[10px] rounded text-white"
                        style={{ backgroundColor: collaborator.color }}
                      >
                        Editing
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Chat panel */}
            {showChat && (
              <div className="flex flex-col h-64">
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${
                        msg.userId === 'current_user' ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div className="flex items-center gap-1 text-xs text-gray-500 mb-1">
                        <span>{msg.userName}</span>
                        <span>·</span>
                        <span>{formatTimeAgo(msg.timestamp)}</span>
                      </div>
                      <div
                        className={`px-3 py-2 rounded-lg text-sm max-w-[85%] ${
                          msg.userId === 'current_user'
                            ? 'bg-blue-500 text-white'
                            : darkMode
                            ? 'bg-gray-800'
                            : 'bg-gray-100'
                        }`}
                      >
                        {msg.message}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Input */}
                <div
                  className={`p-2 border-t ${
                    darkMode ? 'border-gray-700' : 'border-gray-200'
                  }`}
                >
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                      placeholder="Type a message..."
                      className={`flex-1 px-3 py-1.5 rounded-lg text-sm ${
                        darkMode
                          ? 'bg-gray-800 border-gray-700'
                          : 'bg-gray-50 border-gray-200'
                      } border outline-none`}
                    />
                    <button
                      onClick={sendMessage}
                      disabled={!newMessage.trim()}
                      className="p-1.5 rounded-lg bg-blue-500 text-white disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Status bar */}
        <div
          className={`px-3 py-2 border-t text-xs flex items-center justify-between ${
            darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'
          }`}
        >
          <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
              {collaborators.slice(0, 3).map((c) => (
                <div
                  key={c.id}
                  className="w-5 h-5 rounded-full border-2 flex items-center justify-center text-[8px] text-white"
                  style={{
                    backgroundColor: c.color,
                    borderColor: darkMode ? '#1f2937' : 'white',
                  }}
                >
                  {c.name.charAt(0)}
                </div>
              ))}
              {collaborators.length > 3 && (
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[8px] ${
                    darkMode
                      ? 'bg-gray-700 border-gray-900'
                      : 'bg-gray-200 border-white'
                  }`}
                >
                  +{collaborators.length - 3}
                </div>
              )}
            </div>
            <span className="text-gray-500">
              {collaborators.length} collaborator{collaborators.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-1 text-green-500">
            <Circle className="w-2 h-2 fill-current" />
            <span>Connected</span>
          </div>
        </div>
      </div>
    </>
  );
};

const CollaborationIndicators = React.memo(CollaborationIndicatorsComponent, (prev, next) => {
  return prev.isOpen === next.isOpen;
});

export default CollaborationIndicators;
