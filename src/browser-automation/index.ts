/**
 * Browser Automation Module
 *
 * Enterprise-grade browser control via CDP (Chrome DevTools Protocol).
 * Uses Playwright for robust cross-browser automation.
 *
 * Features:
 * - Smart Snapshot: Element detection with numeric references
 * - Tab Management: Create, focus, close tabs
 * - Navigation: URL, back, forward, reload
 * - Interaction: Click, type, fill, select, scroll
 * - Media Capture: Screenshots, PDFs
 * - Network: Headers, cookies, offline mode
 * - Device Emulation: Viewports, geolocation, user agents
 * - JavaScript: Evaluate code in page context
 */

// Types
export type {
  BrowserTab,
  BrowserProfile,
  WebElement,
  WebSnapshot,
  SnapshotOptions,
  ClickOptions,
  TypeOptions,
  FillOptions,
  ScrollOptions,
  SelectOptions,
  NavigateOptions,
  WaitOptions,
  ScreenshotOptions,
  PDFOptions,
  Cookie,
  HeadersConfig,
  DeviceConfig,
  GeolocationConfig,
  NetworkRequest,
  NetworkResponse,
  EvaluateOptions,
  EvaluateResult,
  DialogType,
  DialogInfo,
  DialogAction,
  FileUploadOptions,
  BrowserConfig,
  BrowserEvents,
} from './types.js';

export { DEFAULT_BROWSER_CONFIG } from './types.js';

// Browser Manager
export {
  BrowserManager,
  getBrowserManager,
  resetBrowserManager,
} from './browser-manager.js';

// Browser Tool
export type {
  BrowserAction,
  BrowserToolInput,
} from './browser-tool.js';

export {
  BrowserTool,
  getBrowserTool,
  resetBrowserTool,
} from './browser-tool.js';

export type {
  InternetProofPlan,
  InternetProofPlanOptions,
  InternetProofEvidence,
  InternetProofPersistenceOptions,
  InternetProofPersistenceSuggestion,
  InternetProofStep,
  InternetProofStepTool,
} from './internet-proof-plan.js';

export {
  buildInternetProofPlan,
  buildInternetProofPersistenceSuggestions,
} from './internet-proof-plan.js';

export type {
  InternetScoutEvidenceKind,
  InternetScoutIntent,
  InternetScoutPlan,
  InternetScoutPlanOptions,
  InternetScoutStep,
  InternetScoutStepStage,
  InternetScoutStepTool,
} from './internet-scout-plan.js';

export {
  INTERNET_SCOUT_INTENTS,
  buildInternetScoutPlan,
  renderInternetScoutPlan,
} from './internet-scout-plan.js';

export type {
  BrowserOperatorActionLogEntry,
  BrowserOperatorActionStatus,
  BrowserOperatorConsentScope,
  BrowserOperatorConsentState,
  BrowserOperatorMode,
  BrowserOperatorSessionDraft,
  BrowserOperatorSessionOptions,
} from './browser-operator-session.js';

export {
  buildBrowserOperatorSessionDraft,
  renderBrowserOperatorSessionDraft,
} from './browser-operator-session.js';

export type {
  InternetScoutExecutableTool,
  InternetScoutEvidence,
  InternetScoutRunOptions,
  InternetScoutRunResult,
  InternetScoutToolExecutor,
  InternetScoutTrace,
  InternetScoutTraceStatus,
  InternetScoutWaitUntil,
} from './internet-scout-runner.js';

export {
  renderInternetScoutRunResult,
  runInternetScout,
} from './internet-scout-runner.js';
