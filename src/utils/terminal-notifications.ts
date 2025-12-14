/**
 * Terminal Notifications
 *
 * Provides notifications when the AI needs attention:
 * - iTerm2 notifications (macOS)
 * - OSC 9 notifications (many terminals)
 * - Bell character fallback
 * - Desktop notifications via node-notifier (optional)
 *
 * Inspired by Claude Code's iTerm2 notification support.
 */

import { spawn } from 'child_process';
import * as os from 'os';

// ============================================================================
// Types
// ============================================================================

export interface NotificationOptions {
  title?: string;
  message: string;
  sound?: boolean;
  urgent?: boolean;
}

export type NotificationMethod = 'iterm2' | 'osc9' | 'osc777' | 'bell' | 'desktop' | 'none';

// ============================================================================
// Detection
// ============================================================================

/**
 * Detect the best notification method for current terminal
 */
export function detectNotificationMethod(): NotificationMethod {
  const term = process.env.TERM_PROGRAM?.toLowerCase() || '';
  const termEnv = process.env.TERM?.toLowerCase() || '';

  // iTerm2 on macOS
  if (term === 'iterm.app' || process.env.ITERM_SESSION_ID) {
    return 'iterm2';
  }

  // Kitty terminal
  if (term === 'kitty' || process.env.KITTY_WINDOW_ID) {
    return 'osc9';
  }

  // Windows Terminal
  if (process.env.WT_SESSION) {
    return 'osc9';
  }

  // Konsole, Gnome Terminal, and other OSC 777 compatible
  if (term.includes('konsole') || term.includes('gnome')) {
    return 'osc777';
  }

  // xterm and compatible
  if (termEnv.includes('xterm') || termEnv.includes('256color')) {
    return 'osc9';
  }

  // Fallback to bell
  return 'bell';
}

/**
 * Check if notifications are supported
 */
export function isNotificationSupported(): boolean {
  return detectNotificationMethod() !== 'none';
}

// ============================================================================
// Notification Methods
// ============================================================================

/**
 * Send iTerm2 notification (macOS)
 */
function sendIterm2Notification(options: NotificationOptions): void {
  const message = options.message.replace(/"/g, '\\"');
  const title = (options.title || 'Grok CLI').replace(/"/g, '\\"');

  // iTerm2 proprietary escape sequence
  // ESC ] 9 ; <message> BEL
  process.stdout.write(`\x1b]9;${title}: ${message}\x07`);

  // Also trigger attention badge
  if (options.urgent) {
    // Request attention
    process.stdout.write('\x1b]1337;RequestAttention=yes\x07');
  }
}

/**
 * Send OSC 9 notification (Windows Terminal, Kitty, etc.)
 */
function sendOsc9Notification(options: NotificationOptions): void {
  const message = options.message.replace(/[\x00-\x1f]/g, '');
  process.stdout.write(`\x1b]9;${message}\x07`);
}

/**
 * Send OSC 777 notification (Konsole, etc.)
 */
function sendOsc777Notification(options: NotificationOptions): void {
  const title = (options.title || 'Grok CLI').replace(/;/g, ' ');
  const message = options.message.replace(/;/g, ' ');
  process.stdout.write(`\x1b]777;notify;${title};${message}\x07`);
}

/**
 * Send bell notification (fallback)
 */
function sendBellNotification(_options: NotificationOptions): void {
  process.stdout.write('\x07');
}

/**
 * Send desktop notification (requires node-notifier)
 */
async function sendDesktopNotification(options: NotificationOptions): Promise<void> {
  const platform = os.platform();

  if (platform === 'darwin') {
    // macOS: use osascript
    const script = `display notification "${options.message}" with title "${options.title || 'Grok CLI'}"${options.sound ? ' sound name "default"' : ''}`;
    spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true });
  } else if (platform === 'linux') {
    // Linux: use notify-send
    const args = [options.title || 'Grok CLI', options.message];
    if (options.urgent) {
      args.unshift('-u', 'critical');
    }
    spawn('notify-send', args, { stdio: 'ignore', detached: true });
  } else if (platform === 'win32') {
    // Windows: use PowerShell toast
    const ps = `
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
      $text = $template.GetElementsByTagName("text")
      $text[0].AppendChild($template.CreateTextNode("${options.title || 'Grok CLI'}")) | Out-Null
      $text[1].AppendChild($template.CreateTextNode("${options.message}")) | Out-Null
      $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Grok CLI").Show($toast)
    `;
    spawn('powershell', ['-Command', ps], { stdio: 'ignore', detached: true, shell: true });
  }
}

// ============================================================================
// Main API
// ============================================================================

let notificationMethod: NotificationMethod | null = null;
let notificationsEnabled = true;

/**
 * Initialize notifications
 */
export function initializeNotifications(method?: NotificationMethod): NotificationMethod {
  notificationMethod = method || detectNotificationMethod();
  return notificationMethod;
}

/**
 * Enable/disable notifications
 */
export function setNotificationsEnabled(enabled: boolean): void {
  notificationsEnabled = enabled;
}

/**
 * Check if notifications are enabled
 */
export function areNotificationsEnabled(): boolean {
  return notificationsEnabled;
}

/**
 * Send a notification
 */
export async function notify(options: NotificationOptions): Promise<void> {
  if (!notificationsEnabled) return;

  const method = notificationMethod || detectNotificationMethod();

  switch (method) {
    case 'iterm2':
      sendIterm2Notification(options);
      break;
    case 'osc9':
      sendOsc9Notification(options);
      break;
    case 'osc777':
      sendOsc777Notification(options);
      break;
    case 'bell':
      sendBellNotification(options);
      break;
    case 'desktop':
      await sendDesktopNotification(options);
      break;
    case 'none':
      // Do nothing
      break;
  }
}

/**
 * Notify when AI needs attention
 */
export async function notifyNeedsAttention(reason: string = 'Action required'): Promise<void> {
  await notify({
    title: 'Grok CLI',
    message: reason,
    urgent: true,
    sound: true,
  });
}

/**
 * Notify when task is complete
 */
export async function notifyTaskComplete(task: string = 'Task completed'): Promise<void> {
  await notify({
    title: 'Grok CLI',
    message: task,
    urgent: false,
    sound: false,
  });
}

/**
 * Notify on error
 */
export async function notifyError(error: string): Promise<void> {
  await notify({
    title: 'Grok CLI - Error',
    message: error,
    urgent: true,
    sound: true,
  });
}

// ============================================================================
// Terminal Title
// ============================================================================

/**
 * Set terminal title
 */
export function setTerminalTitle(title: string): void {
  // OSC 2 - Set window title
  process.stdout.write(`\x1b]2;${title}\x07`);
}

/**
 * Set terminal tab title (iTerm2)
 */
export function setTabTitle(title: string): void {
  // OSC 1 - Set tab title
  process.stdout.write(`\x1b]1;${title}\x07`);
}

/**
 * Reset terminal title
 */
export function resetTerminalTitle(): void {
  setTerminalTitle('Terminal');
}

// ============================================================================
// Progress Indicators
// ============================================================================

/**
 * Set iTerm2 progress indicator
 */
export function setProgress(percent: number): void {
  if (detectNotificationMethod() === 'iterm2') {
    // iTerm2 progress bar
    process.stdout.write(`\x1b]9;4;1;${Math.round(percent)}\x07`);
  }
}

/**
 * Clear progress indicator
 */
export function clearProgress(): void {
  if (detectNotificationMethod() === 'iterm2') {
    process.stdout.write('\x1b]9;4;0;0\x07');
  }
}

// ============================================================================
// Exports
// ============================================================================

export default {
  detectNotificationMethod,
  isNotificationSupported,
  initializeNotifications,
  setNotificationsEnabled,
  areNotificationsEnabled,
  notify,
  notifyNeedsAttention,
  notifyTaskComplete,
  notifyError,
  setTerminalTitle,
  setTabTitle,
  resetTerminalTitle,
  setProgress,
  clearProgress,
};
