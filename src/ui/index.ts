/**
 * UI module - Terminal UI components (React/Ink)
 */

// Main app (only has default export, not re-exported by barrel)
// To use: import App from './ui/app.js'

// Components
export {
  SectionHeader,
  StatusWithText,
  AccessibleProgress,
  KeyboardShortcut,
  HelpPanel,
  AccessibleList,
  DefinitionList,
  Announcement,
  AccessibleError,
  AccessibleSuccess,
  AccessibleTable,
  AccessibleCodeBlock,
  Divider,
} from "./components/AccessibleOutput.js";

// ApiKeyInput (only has default export, not re-exported by barrel)
// To use: import ApiKeyInput from './ui/components/ApiKeyInput.js'

export { ChatHistory } from "./components/ChatHistory.js";

export { ChatInput } from "./components/ChatInput.js";

// ChatInterface (only has default export, not re-exported by barrel)
// To use: import ChatInterface from './ui/components/ChatInterface.js'

export {
  VISIBLE_SUGGESTIONS,
  filterCommandSuggestions,
  CommandSuggestions,
} from "./components/CommandSuggestions.js";

// ConfirmationDialog (only has default export, not re-exported by barrel)
// To use: import ConfirmationDialog from './ui/components/ConfirmationDialog.js'

export {
  parseDiffWithLineNumbers,
  DiffRenderer,
} from "./components/DiffRenderer.js";

export {
  EnhancedChatInput,
  useInputHistory,
} from "./components/EnhancedChatInput.js";

export {
  EnhancedConfirmationDialog,
  type OperationType,
} from "./components/EnhancedConfirmationDialog.js";

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
} from "./components/EnhancedSpinners.js";

export {
  ErrorBoundary,
  withErrorBoundary,
  StreamingErrorBoundary,
} from "./components/ErrorBoundary.js";

export {
  FuzzyPicker,
  MultiSelectPicker,
  type PickerItem,
} from "./components/FuzzyPicker.js";

// Note: help-system has some overlapping types - import directly if needed
export {
  InkTable,
  MarkdownTable,
  type ScalarValue,
  type ScalarDict,
  type TableProps,
  type MarkdownTableData,
} from "./components/InkTable.js";

export { LoadingSpinner } from "./components/LoadingSpinner.js";

export { MCPStatus } from "./components/McpStatus.js";

export { ModelSelection } from "./components/ModelSelection.js";

export {
  MultiStepProgress,
  useStepProgress,
  type StepStatus,
  type ProgressStep,
} from "./components/MultiStepProgress.js";

export {
  StructuredOutput,
  useRenderManager,
  TestResults,
  Weather,
  CodeStructure,
} from "./components/StructuredOutput.js";

// HTTP Server
export {
  HttpServer,
  type HttpServerOptions,
} from "./http-server/server.js";

// Utils
export { Colors } from "./utils/colors.js";
