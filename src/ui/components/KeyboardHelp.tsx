/**
 * Keyboard Shortcuts Help Overlay
 *
 * Displays categorized keyboard shortcuts:
 * - Toggle with ? or F1
 * - Categorized by function
 * - Visual key representations
 * - Context-sensitive help
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTheme } from '../context/theme-context.js';

/**
 * Keyboard shortcut definition
 */
interface KeyboardShortcut {
  keys: string;
  description: string;
  category: 'Navigation' | 'Editing' | 'Tools' | 'View' | 'Session';
}

/**
 * All available keyboard shortcuts
 */
const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  // Navigation
  { keys: '↑ ↓', description: 'Navigate command history', category: 'Navigation' },
  { keys: 'Tab', description: 'Autocomplete command', category: 'Navigation' },
  { keys: 'Shift+Tab', description: 'Toggle auto-edit mode', category: 'Navigation' },

  // Editing
  { keys: 'Ctrl+C', description: 'Clear current input / Interrupt', category: 'Editing' },
  { keys: 'Ctrl+U', description: 'Clear line', category: 'Editing' },
  { keys: 'Ctrl+W', description: 'Delete word', category: 'Editing' },
  { keys: 'Ctrl+K', description: 'Delete to end of line', category: 'Editing' },

  // Tools
  { keys: '/help', description: 'Show available commands', category: 'Tools' },
  { keys: '/model', description: 'Switch AI model', category: 'Tools' },
  { keys: '/mode', description: 'Change agent mode', category: 'Tools' },
  { keys: '/commit', description: 'Create git commit', category: 'Tools' },
  { keys: '/review', description: 'Code review', category: 'Tools' },
  { keys: '/test', description: 'Run tests', category: 'Tools' },

  // View
  { keys: '?', description: 'Toggle this help', category: 'View' },
  { keys: '/theme', description: 'Change theme', category: 'View' },
  { keys: '/avatar', description: 'Change avatars', category: 'View' },
  { keys: '/stats', description: 'Show statistics', category: 'View' },

  // Session
  { keys: 'exit', description: 'Quit application', category: 'Session' },
  { keys: 'Esc', description: 'Cancel current operation', category: 'Session' },
  { keys: 'Esc+Esc', description: 'Undo last file changes (checkpoint rewind)', category: 'Session' },
  { keys: '/clear', description: 'Clear chat history', category: 'Session' },
];

/**
 * Props for KeyboardHelp
 */
interface KeyboardHelpProps {
  /** Whether to show the help overlay */
  isVisible: boolean;
  /** Callback when help is closed */
  onClose: () => void;
  /** Show only specific categories */
  categories?: Array<'Navigation' | 'Editing' | 'Tools' | 'View' | 'Session'>;
}

/**
 * Render a keyboard key with styling
 */
function KeyboardKey({ keyName }: { keyName: string }) {
  const { colors } = useTheme();

  return (
    <Box
      borderStyle="round"
      borderColor={colors.border}
      paddingX={1}
      marginRight={1}
    >
      <Text bold color={colors.accent}>
        {keyName}
      </Text>
    </Box>
  );
}

/**
 * Render multiple keys (e.g., "Ctrl+C")
 */
function KeyboardKeys({ keys }: { keys: string }) {
  const keyParts = keys.split('+');

  return (
    <Box>
      {keyParts.map((key, index) => (
        <React.Fragment key={index}>
          <KeyboardKey keyName={key.trim()} />
          {index < keyParts.length - 1 && (
            <Text dimColor>+</Text>
          )}
        </React.Fragment>
      ))}
    </Box>
  );
}

/**
 * Keyboard Help Overlay Component
 */
export function KeyboardHelp({
  isVisible,
  onClose,
  categories,
}: KeyboardHelpProps) {
  const { colors } = useTheme();

  // Handle input to close help
  useInput((input, key) => {
    if (!isVisible) return;

    if (input === '?' || key.escape || key.return) {
      onClose();
    }
  });

  if (!isVisible) return null;

  // Filter shortcuts by category if specified
  const shortcuts = categories
    ? KEYBOARD_SHORTCUTS.filter((s) => categories.includes(s.category))
    : KEYBOARD_SHORTCUTS;

  // Group shortcuts by category
  const groupedShortcuts = shortcuts.reduce((acc, shortcut) => {
    if (!acc[shortcut.category]) {
      acc[shortcut.category] = [];
    }
    acc[shortcut.category].push(shortcut);
    return acc;
  }, {} as Record<string, KeyboardShortcut[]>);

  const categoryOrder: Array<'Navigation' | 'Editing' | 'Tools' | 'View' | 'Session'> = [
    'Navigation',
    'Editing',
    'Tools',
    'View',
    'Session',
  ];

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor={colors.primary}
      paddingX={2}
      paddingY={1}
    >
      {/* Header */}
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color={colors.primary}>
          ⌨️  Keyboard Shortcuts
        </Text>
      </Box>

      {/* Categories */}
      {categoryOrder.map((category) => {
        const categoryShortcuts = groupedShortcuts[category];
        if (!categoryShortcuts || categoryShortcuts.length === 0) return null;

        return (
          <Box key={category} flexDirection="column" marginBottom={1}>
            {/* Category header */}
            <Box marginBottom={1}>
              <Text bold color={colors.secondary}>
                {category}
              </Text>
            </Box>

            {/* Shortcuts in category */}
            {categoryShortcuts.map((shortcut, index) => (
              <Box key={index} marginBottom={0}>
                <Box width={30}>
                  {shortcut.keys.includes('+') ? (
                    <KeyboardKeys keys={shortcut.keys} />
                  ) : (
                    <KeyboardKey keyName={shortcut.keys} />
                  )}
                </Box>
                <Text color={colors.text}>{shortcut.description}</Text>
              </Box>
            ))}
          </Box>
        );
      })}

      {/* Footer */}
      <Box justifyContent="center" marginTop={1} borderStyle="single" borderColor={colors.border} paddingX={1}>
        <Text dimColor>
          Press <Text bold color={colors.accent}>?</Text>, <Text bold color={colors.accent}>Esc</Text>, or <Text bold color={colors.accent}>Enter</Text> to close
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Hook to manage keyboard help visibility
 */
export function useKeyboardHelp() {
  const [isVisible, setIsVisible] = useState(false);

  const toggle = () => setIsVisible((prev) => !prev);
  const show = () => setIsVisible(true);
  const hide = () => setIsVisible(false);

  return {
    isVisible,
    toggle,
    show,
    hide,
  };
}

/**
 * Keyboard Help Button
 *
 * Shows a button/hint to press ? for help
 */
export function KeyboardHelpButton() {
  const { colors } = useTheme();

  return (
    <Box>
      <Text dimColor>
        Press <Text bold color={colors.accent}>?</Text> for help
      </Text>
    </Box>
  );
}

export default KeyboardHelp;
