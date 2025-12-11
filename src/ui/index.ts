/**
 * UI module - Terminal UI components (React/Ink)
 */

// Main app
export * from "./app.js";

// Components
export * from "./components/accessible-output.js";
export * from "./components/api-key-input.js";
export * from "./components/chat-history.js";
export * from "./components/chat-input.js";
export * from "./components/chat-interface.js";
export * from "./components/command-suggestions.js";
export * from "./components/confirmation-dialog.js";
export * from "./components/diff-renderer.js";
export * from "./components/enhanced-chat-input.js";
export * from "./components/enhanced-confirmation-dialog.js";
// enhanced-spinners has overlapping Divider - export selectively
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
  type SpinnerStyle,
} from "./components/enhanced-spinners.js";
export * from "./components/error-boundary.js";
export * from "./components/fuzzy-picker.js";
// Note: help-system has some overlapping types - import directly if needed
export * from "./components/ink-table.js";
export * from "./components/loading-spinner.js";
export * from "./components/mcp-status.js";
export * from "./components/model-selection.js";
export * from "./components/multi-step-progress.js";
export * from "./components/structured-output.js";

// HTTP Server
export * from "./http-server/server.js";

// Utils
export * from "./utils/colors.js";
