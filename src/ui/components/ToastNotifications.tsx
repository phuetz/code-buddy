/**
 * Toast Notifications System
 *
 * Provides non-intrusive feedback for user actions:
 * - Success, error, warning, info toasts
 * - Auto-dismiss with configurable timeout
 * - Stack multiple notifications
 * - Animations and visual feedback
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../context/theme-context.js';

/**
 * Toast types
 */
export type ToastType = 'success' | 'error' | 'warning' | 'info';

/**
 * Toast data structure
 */
export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // in ms, 0 = no auto-dismiss
  createdAt: number;
}

/**
 * Toast configuration
 */
interface ToastConfig {
  icon: string;
  color: string;
  borderColor: string;
}

/**
 * Props for ToastNotifications
 */
interface ToastNotificationsProps {
  /** Maximum number of toasts to show at once */
  maxToasts?: number;
  /** Default duration in ms (0 = no auto-dismiss) */
  defaultDuration?: number;
  /** Position of toast stack */
  position?: 'top' | 'bottom';
}

/**
 * Props for single Toast
 */
interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
  config: ToastConfig;
}

/**
 * Single Toast Component
 */
function ToastItem({ toast, onDismiss, config }: ToastItemProps) {
  const [remainingTime, setRemainingTime] = useState(toast.duration || 0);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (!toast.duration || toast.duration === 0) return;

    // Update remaining time every 100ms
    const interval = setInterval(() => {
      setRemainingTime((prev) => {
        const newTime = Math.max(0, prev - 100);
        if (newTime === 0) {
          // Start exit animation
          setIsExiting(true);
          // Dismiss after animation (200ms)
          setTimeout(() => onDismiss(toast.id), 200);
        }
        return newTime;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [toast.duration, toast.id, onDismiss]);

  // Calculate progress bar for remaining time
  const progress = toast.duration && toast.duration > 0
    ? (remainingTime / toast.duration) * 100
    : 100;

  const progressBarWidth = 30;
  const filledWidth = Math.round((progress / 100) * progressBarWidth);
  const progressBar = '─'.repeat(Math.max(0, filledWidth));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={config.borderColor}
      paddingX={1}
      marginBottom={1}
    >
      {/* Toast content */}
      <Box>
        <Text color={config.color}>{config.icon} </Text>
        <Text>{toast.message}</Text>
      </Box>

      {/* Progress bar for timed toasts */}
      {toast.duration && toast.duration > 0 && !isExiting && (
        <Box marginTop={0}>
          <Text color={config.color} dimColor>
            {progressBar}
          </Text>
          <Text dimColor>
            {' '.repeat(Math.max(0, progressBarWidth - filledWidth))}
          </Text>
          <Text dimColor> {(remainingTime / 1000).toFixed(1)}s</Text>
        </Box>
      )}

      {/* Exit animation indicator */}
      {isExiting && (
        <Box>
          <Text dimColor>Dismissing...</Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Toast Notifications Manager Component
 */
export function ToastNotifications({
  maxToasts = 3,
  defaultDuration: _defaultDuration = 3000,
  position = 'bottom',
}: ToastNotificationsProps) {
  const { colors } = useTheme();
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Toast configurations by type
  const toastConfigs: Record<ToastType, ToastConfig> = {
    success: {
      icon: '✓',
      color: colors.success,
      borderColor: colors.success,
    },
    error: {
      icon: '✗',
      color: colors.error,
      borderColor: colors.error,
    },
    warning: {
      icon: '⚠',
      color: colors.warning,
      borderColor: colors.warning,
    },
    info: {
      icon: 'ℹ',
      color: colors.info,
      borderColor: colors.info,
    },
  };

  // Dismiss toast
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Limit number of visible toasts
  const visibleToasts = toasts.slice(0, maxToasts);

  if (visibleToasts.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      marginTop={position === 'top' ? 0 : 1}
      marginBottom={position === 'bottom' ? 0 : 1}
    >
      {visibleToasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={dismissToast}
          config={toastConfigs[toast.type]}
        />
      ))}

      {/* Overflow indicator */}
      {toasts.length > maxToasts && (
        <Box>
          <Text dimColor>
            +{toasts.length - maxToasts} more notification{toasts.length - maxToasts !== 1 ? 's' : ''}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * Toast Manager Hook
 *
 * Provides imperative API to show toasts
 */
export function useToastManager() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((
    type: ToastType,
    message: string,
    duration?: number
  ) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const toast: Toast = {
      id,
      type,
      message,
      duration: duration ?? 3000,
      createdAt: Date.now(),
    };

    setToasts((prev) => [...prev, toast]);

    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearAllToasts = useCallback(() => {
    setToasts([]);
  }, []);

  // Convenience methods
  const success = useCallback((message: string, duration?: number) => {
    return showToast('success', message, duration);
  }, [showToast]);

  const error = useCallback((message: string, duration?: number) => {
    return showToast('error', message, duration);
  }, [showToast]);

  const warning = useCallback((message: string, duration?: number) => {
    return showToast('warning', message, duration);
  }, [showToast]);

  const info = useCallback((message: string, duration?: number) => {
    return showToast('info', message, duration);
  }, [showToast]);

  return {
    toasts,
    showToast,
    dismissToast,
    clearAllToasts,
    success,
    error,
    warning,
    info,
  };
}

/**
 * Toast Manager Context
 *
 * Provides toast functionality throughout the app
 */
import { createContext, useContext } from 'react';

interface ToastContextValue {
  showToast: (type: ToastType, message: string, duration?: number) => string;
  dismissToast: (id: string) => void;
  clearAllToasts: () => void;
  success: (message: string, duration?: number) => string;
  error: (message: string, duration?: number) => string;
  warning: (message: string, duration?: number) => string;
  info: (message: string, duration?: number) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Toast Provider Component
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const toastManager = useToastManager();

  return (
    <ToastContext.Provider
      value={{
        showToast: toastManager.showToast,
        dismissToast: toastManager.dismissToast,
        clearAllToasts: toastManager.clearAllToasts,
        success: toastManager.success,
        error: toastManager.error,
        warning: toastManager.warning,
        info: toastManager.info,
      }}
    >
      {children}
      <ToastNotifications />
    </ToastContext.Provider>
  );
}

/**
 * Hook to access toast functionality
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

export default ToastNotifications;
