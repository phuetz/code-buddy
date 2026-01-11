/**
 * UI Components Index
 *
 * Central export for all UI components.
 */

// Core components
export { default as ChatInterface } from "./ChatInterface.js";
export { ChatInput } from "./ChatInput.js";
export { ChatHistory } from "./ChatHistory.js";
export { default as ConfirmationDialog } from "./ConfirmationDialog.js";
export { LoadingSpinner } from "./LoadingSpinner.js";
export { DiffRenderer } from "./DiffRenderer.js";
export { default as ApiKeyInput } from "./ApiKeyInput.js";
export { ModelSelection } from "./ModelSelection.js";
export { CommandSuggestions } from "./CommandSuggestions.js";

// Enhanced components
export {
  MultiStepProgress,
  useStepProgress,
  type ProgressStep,
  type StepStatus,
} from "./MultiStepProgress.js";

export {
  FuzzyPicker,
  MultiSelectPicker,
  type PickerItem,
} from "./FuzzyPicker.js";

export {
  EnhancedConfirmationDialog,
  type OperationType,
} from "./EnhancedConfirmationDialog.js";

export {
  EnhancedChatInput,
  useInputHistory,
} from "./EnhancedChatInput.js";

export {
  HelpSystem,
  DEFAULT_HELP_CONFIG,
  type HelpConfig,
  type CommandCategory,
  type CommandHelp,
  type KeyboardShortcut,
} from "./HelpSystem.js";

// Accessibility components
export {
  SectionHeader,
  StatusWithText,
  AccessibleProgress,
  KeyboardShortcut as KeyboardShortcutDisplay,
  HelpPanel,
  AccessibleList,
  DefinitionList,
  Announcement,
  AccessibleError,
  AccessibleSuccess,
  AccessibleTable,
  AccessibleCodeBlock,
  Divider,
} from "./AccessibleOutput.js";

// Progress and spinners
export {
  EnhancedSpinner,
  ProgressBar,
  StepProgress,
  StatusIndicator,
  CountdownTimer,
  TaskList,
  InfoPanel,
  DataTable,
  Badge,
  Divider as DividerLine,
  type SpinnerStyle,
} from "./EnhancedSpinners.js";

// Error handling
export { ErrorBoundary, StreamingErrorBoundary } from "./ErrorBoundary.js";

// Markdown rendering
export { MarkdownRenderer } from "../utils/markdown-renderer.js";

// Status and metrics
export {
  StatusBar,
  MiniStatusBar,
} from "./StatusBar.js";

// Notifications
export {
  ToastNotifications,
  ToastProvider,
  useToast,
  useToastManager,
  type Toast,
  type ToastType,
} from "./ToastNotifications.js";

// Keyboard help
export {
  KeyboardHelp,
  useKeyboardHelp,
  KeyboardHelpButton,
} from "./KeyboardHelp.js";

// Enhanced tool results
export {
  EnhancedToolResult,
  ToolResultsList,
  ToolExecutionSummary,
  type ToolResultData,
} from "./EnhancedToolResults.js";