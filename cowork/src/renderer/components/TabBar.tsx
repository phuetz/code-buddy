/**
 * TabBar — Claude Cowork parity Phase 2 step 14
 *
 * Tab strip rendered inside the Titlebar between the logo area and the
 * window controls. Supports drag-to-reorder, middle-click to close,
 * Cmd+1..9 keyboard shortcuts, and a "+" button for new sessions.
 *
 * @module renderer/components/TabBar
 */

import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Pin, PinOff, type LucideIcon } from 'lucide-react';
import { useAppStore } from '../store';

interface ContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

export const TabBar: React.FC = () => {
  const { t } = useTranslation();
  const openTabs = useAppStore((s) => s.openTabs);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const switchTab = useAppStore((s) => s.switchTab);
  const closeTab = useAppStore((s) => s.closeTab);
  const closeOtherTabs = useAppStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useAppStore((s) => s.closeTabsToRight);
  const togglePinnedTab = useAppStore((s) => s.togglePinnedTab);
  const reorderTabs = useAppStore((s) => s.reorderTabs);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const sessions = useAppStore((s) => s.sessions);
  const updateTabTitle = useAppStore((s) => s.updateTabTitle);

  const dragIndexRef = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  // Sync tab titles with their session titles when sessions update.
  useEffect(() => {
    for (const tab of openTabs) {
      const session = sessions.find((s) => s.id === tab.sessionId);
      if (session && session.title && session.title !== tab.title) {
        updateTabTitle(tab.sessionId, session.title);
      }
    }
  }, [sessions, openTabs, updateTabTitle]);

  // Cmd+1..9 to switch tabs
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      const num = parseInt(e.key, 10);
      if (Number.isNaN(num) || num < 1 || num > 9) return;
      const tab = openTabs[num - 1];
      if (tab) {
        e.preventDefault();
        switchTab(tab.id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openTabs, switchTab]);

  const handleNewTab = () => {
    setActiveSession(null);
  };

  const handleCloseTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  const handleMiddleClick = (tabId: string, e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      closeTab(tabId);
    }
  };

  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(index);
  };

  const handleDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const source = dragIndexRef.current;
    if (source !== null && source !== index) {
      reorderTabs(source, index);
    }
    dragIndexRef.current = null;
    setDragOver(null);
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
    setDragOver(null);
  };

  // Close the context menu on outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const onClick = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const handleContextMenu = (tabId: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ tabId, x: e.clientX, y: e.clientY });
  };

  if (openTabs.length === 0) {
    return (
      <button
        onClick={handleNewTab}
        className="titlebar-no-drag flex max-w-full items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-xs text-text-muted transition-colors hover:bg-surface hover:text-text-primary"
        title={t('tabs.newTab')}
      >
        <Plus size={11} />
        {t('tabs.newSession')}
      </button>
    );
  }

  return (
    <div className="titlebar-no-drag flex items-center gap-0.5 max-w-full overflow-x-auto">
      {openTabs.map((tab, index) => {
        const isActive = tab.sessionId === activeSessionId;
        const isDragOver = dragOver === index;
        const isPinned = !!tab.pinned;
        const unread = tab.unread ?? 0;
        return (
          <div
            key={tab.id}
            draggable
            onDragStart={handleDragStart(index)}
            onDragOver={handleDragOver(index)}
            onDrop={handleDrop(index)}
            onDragEnd={handleDragEnd}
            onMouseDown={(e) => handleMiddleClick(tab.id, e)}
            onClick={() => switchTab(tab.id)}
            onContextMenu={handleContextMenu(tab.id)}
            className={`group relative flex items-center gap-1 px-3 py-1.5 max-w-[180px] cursor-pointer border-r border-border-muted transition-colors ${
              isActive
                ? 'bg-background text-text-primary border-t-2 border-t-accent'
                : 'text-text-muted hover:bg-surface hover:text-text-primary border-t-2 border-t-transparent'
            } ${isDragOver ? 'bg-surface-hover' : ''}`}
            title={
              isPinned
                ? `${tab.title} (pinned — right-click for options)`
                : `${tab.title} (right-click for options)`
            }
          >
            {isPinned && (
              <Pin
                size={9}
                className="shrink-0 text-accent"
                aria-label={t('tabs.pinned', 'Pinned')}
              />
            )}
            <span className="text-xs truncate flex-1 min-w-0">{tab.title}</span>
            {unread > 0 && !isActive && (
              <span
                className="shrink-0 min-w-[14px] h-[14px] px-1 rounded-full bg-accent text-[9px] font-bold text-white flex items-center justify-center"
                aria-label={`${unread} unread`}
              >
                {unread > 9 ? '9+' : unread}
              </span>
            )}
            {!isPinned && (
              <button
                onClick={(e) => handleCloseTab(tab.id, e)}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-text-muted hover:text-text-primary transition-opacity shrink-0"
                title={t('tabs.close')}
              >
                <X size={10} />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={handleNewTab}
        className="flex items-center justify-center w-7 h-7 text-text-muted hover:text-text-primary hover:bg-surface rounded transition-colors shrink-0 mx-1"
        title={t('tabs.newTab')}
      >
        <Plus size={12} />
      </button>
      {menu &&
        (() => {
          const tab = openTabs.find((tt) => tt.id === menu.tabId);
          if (!tab) return null;
          return (
            <div
              className="fixed z-[60] min-w-[180px] py-1 rounded-md bg-background border border-border shadow-elevated text-xs"
              style={{ top: menu.y, left: menu.x }}
              onMouseDown={(e) => e.stopPropagation()}
              role="menu"
            >
              <ContextMenuItem
                icon={tab.pinned ? PinOff : Pin}
                label={tab.pinned ? t('tabs.unpin', 'Unpin') : t('tabs.pin', 'Pin')}
                onClick={() => {
                  togglePinnedTab(menu.tabId);
                  setMenu(null);
                }}
              />
              <div className="my-1 border-t border-border-muted" />
              <ContextMenuItem
                icon={X}
                label={t('tabs.close', 'Close')}
                disabled={tab.pinned}
                onClick={() => {
                  closeTab(menu.tabId);
                  setMenu(null);
                }}
              />
              <ContextMenuItem
                icon={X}
                label={t('tabs.closeOthers', 'Close others')}
                onClick={() => {
                  closeOtherTabs(menu.tabId);
                  setMenu(null);
                }}
              />
              <ContextMenuItem
                icon={X}
                label={t('tabs.closeRight', 'Close to the right')}
                onClick={() => {
                  closeTabsToRight(menu.tabId);
                  setMenu(null);
                }}
              />
            </div>
          );
        })()}
    </div>
  );
};

const ContextMenuItem: React.FC<{
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}> = ({ icon: Icon, label, onClick, disabled }) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    disabled={disabled}
    className="w-full flex items-center gap-2 px-3 py-1.5 text-text-primary hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed text-left"
  >
    <Icon size={11} className="text-text-muted" />
    {label}
  </button>
);
