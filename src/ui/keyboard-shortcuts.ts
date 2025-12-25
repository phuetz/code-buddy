/**
 * Customizable Keyboard Shortcuts
 *
 * Provides keyboard shortcut management:
 * - Default shortcuts
 * - Custom key bindings
 * - Conflict detection
 * - Persistence
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export type ModifierKey = 'ctrl' | 'alt' | 'shift' | 'meta';
export type ActionCategory = 'navigation' | 'editing' | 'session' | 'tools' | 'ui';

export interface KeyBinding {
  key: string;
  modifiers: ModifierKey[];
}

export interface ShortcutAction {
  id: string;
  name: string;
  description: string;
  category: ActionCategory;
  defaultBinding: KeyBinding;
  currentBinding: KeyBinding;
  enabled: boolean;
}

export interface ShortcutConfig {
  actions: ShortcutAction[];
  customBindings: Map<string, KeyBinding>;
}

/**
 * Default keyboard shortcuts
 */
export const DEFAULT_SHORTCUTS: Omit<ShortcutAction, 'currentBinding'>[] = [
  // Navigation
  {
    id: 'history-prev',
    name: 'Previous History',
    description: 'Navigate to previous command in history',
    category: 'navigation',
    defaultBinding: { key: 'ArrowUp', modifiers: [] },
    enabled: true,
  },
  {
    id: 'history-next',
    name: 'Next History',
    description: 'Navigate to next command in history',
    category: 'navigation',
    defaultBinding: { key: 'ArrowDown', modifiers: [] },
    enabled: true,
  },
  {
    id: 'scroll-up',
    name: 'Scroll Up',
    description: 'Scroll output up',
    category: 'navigation',
    defaultBinding: { key: 'PageUp', modifiers: [] },
    enabled: true,
  },
  {
    id: 'scroll-down',
    name: 'Scroll Down',
    description: 'Scroll output down',
    category: 'navigation',
    defaultBinding: { key: 'PageDown', modifiers: [] },
    enabled: true,
  },
  {
    id: 'goto-top',
    name: 'Go to Top',
    description: 'Scroll to top of output',
    category: 'navigation',
    defaultBinding: { key: 'Home', modifiers: ['ctrl'] },
    enabled: true,
  },
  {
    id: 'goto-bottom',
    name: 'Go to Bottom',
    description: 'Scroll to bottom of output',
    category: 'navigation',
    defaultBinding: { key: 'End', modifiers: ['ctrl'] },
    enabled: true,
  },

  // Editing
  {
    id: 'clear-input',
    name: 'Clear Input',
    description: 'Clear the current input',
    category: 'editing',
    defaultBinding: { key: 'u', modifiers: ['ctrl'] },
    enabled: true,
  },
  {
    id: 'delete-word',
    name: 'Delete Word',
    description: 'Delete word before cursor',
    category: 'editing',
    defaultBinding: { key: 'w', modifiers: ['ctrl'] },
    enabled: true,
  },
  {
    id: 'delete-line',
    name: 'Delete Line',
    description: 'Delete entire line',
    category: 'editing',
    defaultBinding: { key: 'k', modifiers: ['ctrl'] },
    enabled: true,
  },
  {
    id: 'undo',
    name: 'Undo',
    description: 'Undo last edit',
    category: 'editing',
    defaultBinding: { key: 'z', modifiers: ['ctrl'] },
    enabled: true,
  },
  {
    id: 'autocomplete',
    name: 'Autocomplete',
    description: 'Trigger autocomplete',
    category: 'editing',
    defaultBinding: { key: 'Tab', modifiers: [] },
    enabled: true,
  },
  {
    id: 'newline',
    name: 'New Line',
    description: 'Insert new line without sending',
    category: 'editing',
    defaultBinding: { key: 'Enter', modifiers: ['shift'] },
    enabled: true,
  },

  // Session
  {
    id: 'send-message',
    name: 'Send Message',
    description: 'Send the current message',
    category: 'session',
    defaultBinding: { key: 'Enter', modifiers: [] },
    enabled: true,
  },
  {
    id: 'cancel',
    name: 'Cancel',
    description: 'Cancel current operation',
    category: 'session',
    defaultBinding: { key: 'c', modifiers: ['ctrl'] },
    enabled: true,
  },
  {
    id: 'new-session',
    name: 'New Session',
    description: 'Start a new session',
    category: 'session',
    defaultBinding: { key: 'n', modifiers: ['ctrl', 'shift'] },
    enabled: true,
  },
  {
    id: 'save-session',
    name: 'Save Session',
    description: 'Save current session',
    category: 'session',
    defaultBinding: { key: 's', modifiers: ['ctrl'] },
    enabled: true,
  },
  {
    id: 'load-session',
    name: 'Load Session',
    description: 'Load a saved session',
    category: 'session',
    defaultBinding: { key: 'o', modifiers: ['ctrl'] },
    enabled: true,
  },
  {
    id: 'checkpoint',
    name: 'Create Checkpoint',
    description: 'Create a checkpoint',
    category: 'session',
    defaultBinding: { key: 'p', modifiers: ['ctrl', 'shift'] },
    enabled: true,
  },

  // Tools
  {
    id: 'toggle-yolo',
    name: 'Toggle YOLO Mode',
    description: 'Toggle YOLO mode on/off',
    category: 'tools',
    defaultBinding: { key: 'y', modifiers: ['ctrl', 'shift'] },
    enabled: true,
  },
  {
    id: 'run-tests',
    name: 'Run Tests',
    description: 'Run project tests',
    category: 'tools',
    defaultBinding: { key: 't', modifiers: ['ctrl', 'shift'] },
    enabled: true,
  },
  {
    id: 'git-status',
    name: 'Git Status',
    description: 'Show git status',
    category: 'tools',
    defaultBinding: { key: 'g', modifiers: ['ctrl', 'shift'] },
    enabled: true,
  },
  {
    id: 'file-search',
    name: 'File Search',
    description: 'Search for files',
    category: 'tools',
    defaultBinding: { key: 'f', modifiers: ['ctrl', 'shift'] },
    enabled: true,
  },

  // UI
  {
    id: 'toggle-help',
    name: 'Toggle Help',
    description: 'Show/hide help panel',
    category: 'ui',
    defaultBinding: { key: '?', modifiers: ['shift'] },
    enabled: true,
  },
  {
    id: 'toggle-stats',
    name: 'Toggle Stats',
    description: 'Show/hide statistics',
    category: 'ui',
    defaultBinding: { key: 'i', modifiers: ['ctrl', 'shift'] },
    enabled: true,
  },
  {
    id: 'clear-screen',
    name: 'Clear Screen',
    description: 'Clear the terminal output',
    category: 'ui',
    defaultBinding: { key: 'l', modifiers: ['ctrl'] },
    enabled: true,
  },
  {
    id: 'toggle-theme',
    name: 'Toggle Theme',
    description: 'Switch between dark/light theme',
    category: 'ui',
    defaultBinding: { key: 't', modifiers: ['ctrl', 'alt'] },
    enabled: true,
  },
  {
    id: 'exit',
    name: 'Exit',
    description: 'Exit the application',
    category: 'ui',
    defaultBinding: { key: 'q', modifiers: ['ctrl'] },
    enabled: true,
  },
];

/**
 * Keyboard Shortcuts Manager
 */
export class ShortcutManager {
  private actions: Map<string, ShortcutAction> = new Map();
  private bindingMap: Map<string, string> = new Map(); // binding string -> action id
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(os.homedir(), '.codebuddy', 'shortcuts.json');

    // Initialize with defaults
    for (const shortcut of DEFAULT_SHORTCUTS) {
      this.actions.set(shortcut.id, {
        ...shortcut,
        currentBinding: { ...shortcut.defaultBinding },
      });
    }

    // Build binding map
    this.rebuildBindingMap();

    // Load custom bindings
    this.loadConfig();
  }

  /**
   * Get action by ID
   */
  getAction(id: string): ShortcutAction | undefined {
    return this.actions.get(id);
  }

  /**
   * Get all actions
   */
  getAllActions(): ShortcutAction[] {
    return Array.from(this.actions.values());
  }

  /**
   * Get actions by category
   */
  getActionsByCategory(category: ActionCategory): ShortcutAction[] {
    return this.getAllActions().filter(a => a.category === category);
  }

  /**
   * Get action for a key event
   */
  getActionForKey(key: string, modifiers: ModifierKey[]): ShortcutAction | undefined {
    const bindingStr = this.serializeBinding({ key, modifiers });
    const actionId = this.bindingMap.get(bindingStr);
    if (actionId) {
      return this.actions.get(actionId);
    }
    return undefined;
  }

  /**
   * Set custom binding for action
   */
  setBinding(actionId: string, binding: KeyBinding): { success: boolean; conflict?: string } {
    const action = this.actions.get(actionId);
    if (!action) {
      return { success: false };
    }

    // Check for conflicts
    const bindingStr = this.serializeBinding(binding);
    const existing = this.bindingMap.get(bindingStr);
    if (existing && existing !== actionId) {
      return { success: false, conflict: existing };
    }

    // Remove old binding
    const oldBindingStr = this.serializeBinding(action.currentBinding);
    this.bindingMap.delete(oldBindingStr);

    // Set new binding
    action.currentBinding = binding;
    this.bindingMap.set(bindingStr, actionId);

    this.saveConfig();
    return { success: true };
  }

  /**
   * Reset action to default binding
   */
  resetBinding(actionId: string): boolean {
    const action = this.actions.get(actionId);
    if (!action) return false;

    // Remove current binding
    const currentStr = this.serializeBinding(action.currentBinding);
    this.bindingMap.delete(currentStr);

    // Restore default
    action.currentBinding = { ...action.defaultBinding };
    const defaultStr = this.serializeBinding(action.defaultBinding);
    this.bindingMap.set(defaultStr, actionId);

    this.saveConfig();
    return true;
  }

  /**
   * Reset all bindings to defaults
   */
  resetAllBindings(): void {
    for (const action of this.actions.values()) {
      action.currentBinding = { ...action.defaultBinding };
    }
    this.rebuildBindingMap();
    this.saveConfig();
  }

  /**
   * Enable/disable action
   */
  setEnabled(actionId: string, enabled: boolean): boolean {
    const action = this.actions.get(actionId);
    if (!action) return false;

    action.enabled = enabled;
    this.saveConfig();
    return true;
  }

  /**
   * Format binding for display
   */
  formatBinding(binding: KeyBinding): string {
    const parts: string[] = [];

    if (binding.modifiers.includes('ctrl')) parts.push('Ctrl');
    if (binding.modifiers.includes('alt')) parts.push('Alt');
    if (binding.modifiers.includes('shift')) parts.push('Shift');
    if (binding.modifiers.includes('meta')) parts.push('Cmd');

    // Format special keys
    let keyDisplay = binding.key;
    switch (binding.key) {
      case 'ArrowUp': keyDisplay = '↑'; break;
      case 'ArrowDown': keyDisplay = '↓'; break;
      case 'ArrowLeft': keyDisplay = '←'; break;
      case 'ArrowRight': keyDisplay = '→'; break;
      case 'Enter': keyDisplay = '↵'; break;
      case 'Tab': keyDisplay = 'Tab'; break;
      case 'Escape': keyDisplay = 'Esc'; break;
      case 'Backspace': keyDisplay = '⌫'; break;
      case 'Delete': keyDisplay = 'Del'; break;
      case 'PageUp': keyDisplay = 'PgUp'; break;
      case 'PageDown': keyDisplay = 'PgDn'; break;
      case ' ': keyDisplay = 'Space'; break;
      default:
        if (keyDisplay.length === 1) keyDisplay = keyDisplay.toUpperCase();
    }

    parts.push(keyDisplay);
    return parts.join('+');
  }

  /**
   * Format shortcuts list for display
   */
  formatShortcutsList(): string {
    const categories: ActionCategory[] = ['navigation', 'editing', 'session', 'tools', 'ui'];
    const lines: string[] = [
      '',
      '═══════════════════════════════════════════════════',
      '              KEYBOARD SHORTCUTS',
      '═══════════════════════════════════════════════════',
      '',
    ];

    for (const category of categories) {
      const actions = this.getActionsByCategory(category);
      if (actions.length === 0) continue;

      lines.push(`${category.toUpperCase()}`);
      lines.push('───────────────────────────────────────────────────');

      for (const action of actions) {
        const binding = this.formatBinding(action.currentBinding);
        const status = action.enabled ? '' : ' (disabled)';
        lines.push(`  ${binding.padEnd(15)} ${action.name}${status}`);
      }
      lines.push('');
    }

    lines.push('═══════════════════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Serialize binding for map key
   */
  private serializeBinding(binding: KeyBinding): string {
    const mods = [...binding.modifiers].sort().join('+');
    return mods ? `${mods}+${binding.key}` : binding.key;
  }

  /**
   * Rebuild binding map
   */
  private rebuildBindingMap(): void {
    this.bindingMap.clear();
    for (const [id, action] of this.actions) {
      if (action.enabled) {
        const bindingStr = this.serializeBinding(action.currentBinding);
        this.bindingMap.set(bindingStr, id);
      }
    }
  }

  /**
   * Load config from file
   */
  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readJsonSync(this.configPath);

        if (data.bindings) {
          for (const [actionId, binding] of Object.entries(data.bindings)) {
            const action = this.actions.get(actionId);
            if (action && binding) {
              action.currentBinding = binding as KeyBinding;
            }
          }
        }

        if (data.disabled) {
          for (const actionId of data.disabled) {
            const action = this.actions.get(actionId);
            if (action) action.enabled = false;
          }
        }

        this.rebuildBindingMap();
      }
    } catch {
      // Ignore load errors
    }
  }

  /**
   * Save config to file
   */
  private saveConfig(): void {
    try {
      fs.ensureDirSync(path.dirname(this.configPath));

      const bindings: Record<string, KeyBinding> = {};
      const disabled: string[] = [];

      for (const [id, action] of this.actions) {
        // Save if different from default
        if (this.serializeBinding(action.currentBinding) !==
            this.serializeBinding(action.defaultBinding)) {
          bindings[id] = action.currentBinding;
        }
        if (!action.enabled) {
          disabled.push(id);
        }
      }

      fs.writeJsonSync(this.configPath, { bindings, disabled }, { spaces: 2 });
    } catch {
      // Ignore save errors
    }
  }
}

// Singleton instance
let shortcutManager: ShortcutManager | null = null;

/**
 * Get or create shortcut manager
 */
export function getShortcutManager(): ShortcutManager {
  if (!shortcutManager) {
    shortcutManager = new ShortcutManager();
  }
  return shortcutManager;
}

export default ShortcutManager;
