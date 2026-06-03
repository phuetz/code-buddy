/**
 * NotificationCenter — Panel with notification history
 * Claude Cowork parity: grouped by date, unread counts, mark-all-read.
 */
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, X, Check, Trash2, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAppStore } from '../store';
import { useNotifications, useShowNotificationCenter } from '../store/selectors';
import type { NotificationEntry, NotificationPriority } from '../types';
import { formatAppTime } from '../utils/i18n-format';

const PRIORITY_ICONS: Record<NotificationPriority, LucideIcon> = {
  low: Info,
  normal: Bell,
  high: AlertTriangle,
  urgent: AlertCircle,
};

const PRIORITY_COLORS: Record<NotificationPriority, string> = {
  low: 'text-text-muted',
  normal: 'text-accent',
  high: 'text-warning',
  urgent: 'text-error',
};

function formatTime(timestamp: number): string {
  return formatAppTime(timestamp);
}

interface NotificationRowProps {
  notification: NotificationEntry;
  onMarkRead: () => void;
  onRemove: () => void;
}

const NotificationRow: React.FC<NotificationRowProps> = ({
  notification,
  onMarkRead,
  onRemove,
}) => {
  const Icon = PRIORITY_ICONS[notification.priority];

  return (
    <div
      className={`group flex items-start gap-3 px-3 py-2.5 hover:bg-surface-hover transition-colors border-l-2 ${
        notification.read ? 'border-transparent' : 'border-accent'
      }`}
    >
      <Icon
        size={14}
        className={`${PRIORITY_COLORS[notification.priority]} shrink-0 mt-0.5`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4
            className={`text-xs font-medium truncate ${
              notification.read ? 'text-text-secondary' : 'text-text-primary'
            }`}
          >
            {notification.title}
          </h4>
          <span className="text-[10px] text-text-muted shrink-0">
            {formatTime(notification.timestamp)}
          </span>
        </div>
        <p
          className={`text-xs mt-0.5 line-clamp-2 ${
            notification.read ? 'text-text-muted' : 'text-text-secondary'
          }`}
        >
          {notification.body}
        </p>
      </div>
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 shrink-0 transition-opacity">
        {!notification.read && (
          <button
            onClick={onMarkRead}
            className="p-1 text-text-muted hover:text-success"
          >
            <Check size={12} />
          </button>
        )}
        <button
          onClick={onRemove}
          className="p-1 text-text-muted hover:text-error"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
};

export const NotificationCenter: React.FC = () => {
  const { t } = useTranslation();
  const show = useShowNotificationCenter();
  const notifications = useNotifications();
  const setShow = useAppStore((s) => s.setShowNotificationCenter);
  const markRead = useAppStore((s) => s.markNotificationRead);
  const markAllRead = useAppStore((s) => s.markAllNotificationsRead);
  const remove = useAppStore((s) => s.removeNotification);

  const formatDateGroup = useCallback((timestamp: number): string => {
    const now = new Date();
    const date = new Date(timestamp);
    const diffMs = now.getTime() - date.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 1) return t('time.justNow', 'Just now');
    if (diffHours < 24 && now.getDate() === date.getDate()) return t('time.today', 'Today');
    if (diffHours < 48) return t('time.yesterday', 'Yesterday');
    if (diffHours < 24 * 7) return t('time.thisWeek', 'This week');
    return t('time.older', 'Older');
  }, [t]);

  const grouped = useMemo(() => {
    const groups = new Map<string, NotificationEntry[]>();
    for (const n of notifications) {
      const key = formatDateGroup(n.timestamp);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(n);
    }
    return Array.from(groups.entries());
  }, [notifications, formatDateGroup]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-40"
      onClick={(e) => {
        if (e.target === e.currentTarget) setShow(false);
      }}
    >
      <div className="absolute top-14 right-4 w-96 max-h-[70vh] bg-background border border-border rounded-xl shadow-elevated flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-muted">
          <Bell size={14} className="text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">{t('notifications.title')}</h3>
          {unreadCount > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-muted text-accent">
              {t('notifications.unread', { count: unreadCount })}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-[11px] text-accent hover:text-accent-hover"
              >
                {t('notifications.markAllRead')}
              </button>
            )}
            <button
              onClick={() => setShow(false)}
              className="text-text-muted hover:text-text-primary"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-text-muted">
              <Bell size={24} className="mb-2 opacity-30" />
              <p className="text-sm">{t('notifications.empty')}</p>
            </div>
          ) : (
            grouped.map(([group, items]) => (
              <div key={group}>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted bg-background/80 sticky top-0 border-b border-border-muted">
                  {group}
                </div>
                {items.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    onMarkRead={() => markRead(notification.id)}
                    onRemove={() => remove(notification.id)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
