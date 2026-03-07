# Code Buddy Modernization Action Plan

## Overview
This plan outlines the steps required to address the gaps identified in the recent codebase audit. While the system architecture is largely solid and robust, several key capabilities currently rely on stub implementations or lack full integration. This modernization effort focuses on completing these implementations to unlock the full potential described in the architecture.

## 🔴 Priority 1: Browser Automation (Replacing Stubs)

The current `BrowserStubTool` only simulates browser actions. Real automation is needed for tools to interact with web applications effectively.

### 1.1 Implement Playwright Integration
*   [ ] **Action:** Install Playwright dependencies (`npm install playwright playwright-core`).
*   [ ] **Action:** Create `src/tools/browser/playwright-tool.ts` implementing the same interface as `BrowserStubTool`.
*   [ ] **Action:** Implement `launch`, `navigate`, `click`, `type`, `screenshot`, etc., using the Playwright API.
*   [ ] **Action:** Update the tool registry to conditionally load the Playwright tool if available or fallback to the stub for environments where browsers cannot be installed.
*   [ ] **Action:** Add configuration options for headless mode, proxies, and custom browser paths.

### 1.2 Enhanced Interaction Capabilities
*   [ ] **Action:** Implement advanced element selection (beyond simple CSS selectors, e.g., text-based, semantic).
*   [ ] **Action:** Add support for handling complex interactions like drag-and-drop, file uploads, and iframes.
*   [ ] **Action:** Ensure proper state management for cookies, local storage, and session data.

## 🟡 Priority 2: Image Processing & Vision Capabilities

The `ImageStubTool` provides static responses. We need real processing for image analysis, OCR, and manipulation.

### 2.1 Integrate Optical Character Recognition (OCR)
*   [ ] **Action:** Install `tesseract.js` (`npm install tesseract.js`).
*   [ ] **Action:** Create `src/tools/vision/ocr-tool.ts` utilizing `tesseract.js` for local text extraction from images.
*   [ ] **Action:** Handle language packs and caching for Tesseract workers.

### 2.2 Implement Basic Image Manipulation
*   [ ] **Action:** Install `sharp` (`npm install sharp`).
*   [ ] **Action:** Create `src/tools/vision/image-processor.ts` to replace stubbed resize, crop, and comparison functions using `sharp`.

### 2.3 Cloud Vision API Integration (Optional/Advanced)
*   [ ] **Action:** Add support for external vision APIs (e.g., OpenAI Vision, Google Cloud Vision) for complex scene understanding and object detection, configured via environment variables.

## 🟢 Priority 3: Full Observability Integration

While internal observability exists, true integration with Sentry and OpenTelemetry for production monitoring needs to be finalized.

### 3.1 Sentry Integration
*   [ ] **Action:** Install Sentry SDK (`npm install @sentry/node`).
*   [ ] **Action:** Update `src/observability/index.ts` to initialize Sentry based on an environment variable (`SENTRY_DSN`).
*   [ ] **Action:** Hook into the internal error handling (`CodeBuddyError`, `self-healing`) to report unhandled exceptions and context to Sentry.

### 3.2 OpenTelemetry Implementation
*   [ ] **Action:** Install OpenTelemetry SDK (`npm install @opentelemetry/sdk-node @opentelemetry/api`).
*   [ ] **Action:** Create an OpenTelemetry tracing provider in `src/observability/tracing.ts`.
*   [ ] **Action:** Instrument core paths: LLM API calls, tool executions, and file system operations to generate distributed traces.
*   [ ] **Action:** Configure exporters (e.g., Jaeger, Zipkin, or OTLP) based on environment configuration.

## 🔵 Priority 4: Architectural Alignment

Address minor divergences between documentation and implementation.

### 4.1 Documentation Updates
*   [ ] **Action:** Update `ARCHITECTURE.md` and `GEMINI.md` to reflect the transition from `SupervisorAgent` to `OrchestratorAgent` & `TeamManager`.
*   [ ] **Action:** Clarify the location and mechanism of `PromptCacheBreakpoints` (now in the optimization module) in the documentation.

### 4.2 Cleanup
*   [ ] **Action:** Review and potentially deprecate older stubs once the robust implementations are fully tested and stable.
