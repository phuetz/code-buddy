// @ts-nocheck
/**
 * Workflow Tags Component
 * Tag workflows for organization (like n8n)
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Tag, X, Plus, Check, ChevronDown, Hash } from 'lucide-react';

interface WorkflowTag {
  id: string;
  name: string;
  color: string;
}

const TAG_COLORS = [
  { name: 'Gray', value: '#6b7280', bg: '#f3f4f6' },
  { name: 'Red', value: '#ef4444', bg: '#fee2e2' },
  { name: 'Orange', value: '#f59e0b', bg: '#ffedd5' },
  { name: 'Yellow', value: '#eab308', bg: '#fef3c7' },
  { name: 'Green', value: '#22c55e', bg: '#dcfce7' },
  { name: 'Teal', value: '#14b8a6', bg: '#ccfbf1' },
  { name: 'Blue', value: '#3b82f6', bg: '#dbeafe' },
  { name: 'Purple', value: '#8b5cf6', bg: '#ede9fe' },
  { name: 'Pink', value: '#ec4899', bg: '#fce7f3' },
];

interface WorkflowTagsProps {
  workflowId: string;
  tags: WorkflowTag[];
  availableTags: WorkflowTag[];
  onAddTag: (tag: WorkflowTag) => void;
  onRemoveTag: (tagId: string) => void;
  onCreateTag: (name: string, color: string) => void;
  compact?: boolean;
}

const WorkflowTags: React.FC<WorkflowTagsProps> = ({
  _workflowId,
  tags,
  availableTags,
  onAddTag,
  onRemoveTag,
  onCreateTag,
  compact = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState(TAG_COLORS[6]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsCreating(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when creating
  useEffect(() => {
    if (isCreating && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCreating]);

  // Filter available tags
  const filteredTags = availableTags.filter(
    tag =>
      !tags.find(t => t.id === tag.id) &&
      tag.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreateTag = useCallback(() => {
    if (newTagName.trim()) {
      onCreateTag(newTagName.trim(), selectedColor.value);
      setNewTagName('');
      setIsCreating(false);
    }
  }, [newTagName, selectedColor, onCreateTag]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreateTag();
    } else if (e.key === 'Escape') {
      setIsCreating(false);
      setNewTagName('');
    }
  }, [handleCreateTag]);

  if (compact) {
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {tags.map(tag => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ backgroundColor: TAG_COLORS.find(c => c.value === tag.color)?.bg || '#f3f4f6', color: tag.color }}
          >
            <Hash size={10} />
            {tag.name}
          </span>
        ))}
        {tags.length === 0 && (
          <span className="text-xs text-gray-400">No tags</span>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Tags display */}
      <div className="flex items-center gap-2 flex-wrap">
        {tags.map(tag => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium group"
            style={{ backgroundColor: TAG_COLORS.find(c => c.value === tag.color)?.bg || '#f3f4f6', color: tag.color }}
          >
            <Hash size={12} />
            {tag.name}
            <button
              onClick={() => onRemoveTag(tag.id)}
              className="opacity-0 group-hover:opacity-100 hover:bg-black/10 rounded-full p-0.5 transition-opacity"
            >
              <X size={12} />
            </button>
          </span>
        ))}

        {/* Add tag button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm text-gray-500 border border-dashed border-gray-300 hover:border-gray-400 hover:text-gray-700 transition-colors"
        >
          <Plus size={14} />
          Add tag
          <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
          {/* Search */}
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search or create tag..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Available tags */}
          <div className="max-h-48 overflow-y-auto">
            {filteredTags.length > 0 ? (
              filteredTags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => {
                    onAddTag(tag);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors"
                >
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="text-sm text-gray-700">{tag.name}</span>
                </button>
              ))
            ) : search && !isCreating ? (
              <button
                onClick={() => setIsCreating(true)}
                className="w-full flex items-center gap-2 px-3 py-2 text-blue-600 hover:bg-blue-50 transition-colors"
              >
                <Plus size={14} />
                <span className="text-sm">Create "{search}"</span>
              </button>
            ) : (
              <div className="px-3 py-4 text-center text-sm text-gray-400">
                No tags available
              </div>
            )}
          </div>

          {/* Create new tag */}
          {isCreating && (
            <div className="p-3 border-t border-gray-100 bg-gray-50">
              <p className="text-xs font-medium text-gray-700 mb-2">Create new tag</p>
              <input
                ref={inputRef}
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tag name"
                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex items-center gap-1 mb-2">
                {TAG_COLORS.map(color => (
                  <button
                    key={color.name}
                    onClick={() => setSelectedColor(color)}
                    className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${
                      selectedColor.value === color.value ? 'ring-2 ring-offset-1 ring-blue-500' : ''
                    }`}
                    style={{ backgroundColor: color.value }}
                    title={color.name}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setIsCreating(false);
                    setNewTagName('');
                  }}
                  className="flex-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateTag}
                  disabled={!newTagName.trim()}
                  className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                >
                  <Check size={14} />
                  Create
                </button>
              </div>
            </div>
          )}

          {/* Footer */}
          {!isCreating && (
            <div className="p-2 border-t border-gray-100 bg-gray-50">
              <button
                onClick={() => setIsCreating(true)}
                className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              >
                <Plus size={14} />
                Create new tag
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkflowTags;
