/**
 * Browser Tool Definitions
 *
 * Enterprise-grade browser automation for AI agents via CDP.
 */

import { CodeBuddyTool } from './types.js';

/**
 * Browser Tool
 *
 * Full browser automation with Smart Snapshot element references.
 */
export const BROWSER_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'browser',
    description: `Control a web browser with full automation capabilities.

WORKFLOW:
1. 'launch' to start browser (or 'connect' to existing)
2. 'navigate' to a URL
3. 'observe' or 'snapshot' to detect page elements - elements get numeric refs [1], [2], etc.
4. Use refs in click/type/fill actions
5. Use 'extract' to capture URL/title/headings/actions/links/text evidence
6. Use 'assert_text' after navigation or UI expectations to make the flow testable
7. 'screenshot' or 'pdf' to capture content

ACTIONS:
Lifecycle:
- launch: Start new browser instance
- connect: Connect to existing browser via CDP URL
- close: Close browser

Tabs:
- tabs: List all open tabs
- new_tab: Open new tab (optionally with URL)
- focus_tab: Focus tab by ID
- close_tab: Close tab by ID

Snapshot:
- snapshot: Take snapshot of page, returns elements with refs [1], [2], etc.
- observe: Take a broader Stagehand-style observation snapshot before acting
- get_element: Get details of element by ref
- find_elements: Search elements by role/name

Navigation:
- navigate: Go to URL
- go_back: Navigate back
- go_forward: Navigate forward
- reload: Reload page

Interaction:
- click: Click element by ref
- double_click: Double-click element
- right_click: Right-click element
- type: Type text into element
- fill: Fill multiple form fields at once
- select: Select option in dropdown
- press: Press keyboard key
- hover: Hover over element
- scroll: Scroll page or to element

Media:
- screenshot: Capture screenshot (full page or element)
- pdf: Generate PDF of page

Network:
- get_cookies: List all cookies
- set_cookie: Set a cookie
- clear_cookies: Clear all cookies
- set_headers: Set extra HTTP headers
- set_offline: Enable/disable offline mode

Device:
- emulate_device: Emulate device (iPhone, iPad, etc.)
- set_geolocation: Set GPS location

JavaScript:
- evaluate: Execute JavaScript in page context
- get_content: Get page HTML content
- extract: Extract compact page state with URL/title/headings/actions/links/text
- assert_text: Assert expected text is present; failed assertion means failed test
- get_url: Get current URL
- get_title: Get page title

Drag & Drop:
- drag: Drag element to another element (sourceRef → targetRef)

File Upload:
- upload_files: Upload files to file input (ref + files array)

Wait:
- wait_for_navigation: Wait for page navigation to complete

Storage:
- get_local_storage: Get all localStorage entries
- set_local_storage: Set localStorage entries (storageData object)
- get_session_storage: Get all sessionStorage entries
- set_session_storage: Set sessionStorage entries (storageData object)

Route Interception:
- add_route_rule: Add network route rule (rulePattern, ruleAction: block/mock/redirect)
- remove_route_rule: Remove route rule by ID
- clear_route_rules: Clear all route rules

Timezone & Locale:
- set_timezone: Set browser timezone (timezone string)
- set_locale: Set browser locale (locale string)

Download:
- download: Download file by clicking element (ref) or waiting for download`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'launch', 'connect', 'close',
            'tabs', 'new_tab', 'focus_tab', 'close_tab',
            'snapshot', 'observe', 'get_element', 'find_elements',
            'navigate', 'go_back', 'go_forward', 'reload',
            'click', 'double_click', 'right_click', 'type', 'fill', 'select', 'press', 'hover', 'scroll',
            'screenshot', 'pdf',
            'get_cookies', 'set_cookie', 'clear_cookies', 'set_headers', 'set_offline',
            'emulate_device', 'set_geolocation',
            'evaluate', 'get_content', 'extract', 'assert_text', 'get_url', 'get_title',
            'drag', 'upload_files', 'wait_for_navigation',
            'get_local_storage', 'set_local_storage', 'get_session_storage', 'set_session_storage',
            'add_route_rule', 'remove_route_rule', 'clear_route_rules',
            'set_timezone', 'set_locale',
            'download',
          ],
          description: 'The browser action to perform',
        },
        // Connection
        cdpUrl: {
          type: 'string',
          description: 'CDP WebSocket URL for connecting to existing browser',
        },
        headless: {
          type: 'boolean',
          description: 'Run browser in headless mode (default: true)',
        },
        // Tab
        tabId: {
          type: 'string',
          description: 'Tab ID for focus_tab/close_tab',
        },
        // Navigation
        url: {
          type: 'string',
          description: 'URL to navigate to',
        },
        waitUntil: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle'],
          description: 'When to consider navigation complete',
        },
        // Snapshot
        interactiveOnly: {
          type: 'boolean',
          description: 'Only include interactive elements in snapshot',
        },
        maxElements: {
          type: 'number',
          description: 'Maximum elements to include in snapshot',
        },
        // Element
        ref: {
          type: 'number',
          description: 'Element reference number from snapshot',
        },
        role: {
          type: 'string',
          description: 'Element role to search for (button, link, textbox, etc.)',
        },
        name: {
          type: 'string',
          description: 'Element name/text to search for',
        },
        query: {
          type: 'string',
          description: 'Natural-language extraction focus or assertion query',
        },
        expectedText: {
          type: 'string',
          description: 'Text expected to appear on the page for assert_text',
        },
        proofGoal: {
          type: 'string',
          description: 'Optional proof-loop goal used when persistWhenProven returns memory/lesson suggestions',
        },
        persistWhenProven: {
          type: 'boolean',
          description: 'For extract/assert_text, return remember and lessons_add payload suggestions only after durable evidence is proven',
        },
        // Interaction
        text: {
          type: 'string',
          description: 'Text to type',
        },
        key: {
          type: 'string',
          description: 'Key to press (Enter, Tab, Escape, etc.)',
        },
        modifiers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Modifier keys (Control, Alt, Shift, Meta)',
        },
        button: {
          type: 'string',
          enum: ['left', 'right', 'middle'],
          description: 'Mouse button',
        },
        clear: {
          type: 'boolean',
          description: 'Clear field before typing',
        },
        // Fill
        fields: {
          type: 'object',
          description: 'Fields to fill: { "refNumber": "value", ... }',
        },
        submit: {
          type: 'boolean',
          description: 'Press Enter after filling fields',
        },
        // Select
        value: {
          type: 'string',
          description: 'Value to select in dropdown',
        },
        label: {
          type: 'string',
          description: 'Label to select in dropdown',
        },
        index: {
          type: 'number',
          description: 'Index to select in dropdown',
        },
        // Scroll
        direction: {
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Scroll direction',
        },
        amount: {
          type: 'number',
          description: 'Scroll amount in pixels',
        },
        toElement: {
          type: 'number',
          description: 'Element ref to scroll to',
        },
        // Screenshot
        fullPage: {
          type: 'boolean',
          description: 'Capture full page vs viewport only',
        },
        element: {
          type: 'number',
          description: 'Element ref to capture',
        },
        format: {
          type: 'string',
          enum: ['png', 'jpeg', 'webp'],
          description: 'Image format',
        },
        quality: {
          type: 'number',
          description: 'Image quality (0-100)',
        },
        // Cookies
        cookieName: {
          type: 'string',
          description: 'Cookie name',
        },
        cookieValue: {
          type: 'string',
          description: 'Cookie value',
        },
        cookieDomain: {
          type: 'string',
          description: 'Cookie domain',
        },
        // Headers
        headers: {
          type: 'object',
          description: 'HTTP headers to set',
        },
        offline: {
          type: 'boolean',
          description: 'Enable offline mode',
        },
        // Device
        device: {
          type: 'string',
          description: 'Device name to emulate (iPhone 14, iPad Pro, Pixel 5, etc.)',
        },
        viewport: {
          type: 'object',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' },
          },
          description: 'Custom viewport size',
        },
        // Geolocation
        latitude: {
          type: 'number',
          description: 'Latitude for geolocation',
        },
        longitude: {
          type: 'number',
          description: 'Longitude for geolocation',
        },
        // JavaScript
        expression: {
          type: 'string',
          description: 'JavaScript code to evaluate in page',
        },
        // Timeout
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds',
        },
        // Drag
        sourceRef: {
          type: 'number',
          description: 'Source element ref for drag operation',
        },
        targetRef: {
          type: 'number',
          description: 'Target element ref for drag operation',
        },
        // Upload
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths to upload',
        },
        // Storage
        storageData: {
          type: 'object',
          description: 'Key-value pairs for localStorage/sessionStorage',
        },
        // Route Rules
        ruleId: {
          type: 'string',
          description: 'Route rule ID',
        },
        rulePattern: {
          type: 'string',
          description: 'URL pattern to match for route rule',
        },
        ruleAction: {
          type: 'string',
          enum: ['block', 'mock', 'redirect'],
          description: 'Action for route rule',
        },
        ruleResponse: {
          type: 'object',
          description: 'Mock response for route rule (status, body, contentType)',
        },
        ruleRedirectUrl: {
          type: 'string',
          description: 'Redirect URL for route rule',
        },
        // Timezone/Locale
        timezone: {
          type: 'string',
          description: 'Timezone ID (e.g., America/New_York)',
        },
        locale: {
          type: 'string',
          description: 'Locale string (e.g., en-US)',
        },
      },
      required: ['action'],
    },
  },
};

/**
 * Internet Scout Run Tool
 *
 * Executes a bounded, evidence-first web navigation run.
 */
export const INTERNET_SCOUT_RUN_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'internet_scout_run',
    description: `Execute a bounded Internet Scout workflow.

This runs the safe sequence from internet_scout_plan using web_search/web_fetch and Playwright-backed browser actions: launch, navigate, observe, scroll, extract, and assert_text. It stops on captcha, login walls, paywalls, 403/429, rate limits, or access-control bypass signals. It does not invent clicks or bypass site protections.`,
    parameters: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'What to learn, verify, or collect from public/user-authorized web sources.',
        },
        query: {
          type: 'string',
          description: 'Optional search query. Defaults to goal.',
        },
        sourceUrl: {
          type: 'string',
          description: 'Known starting URL. If omitted, the run starts with web_search.',
        },
        intent: {
          type: 'string',
          enum: ['research', 'prospecting', 'profile_enrichment', 'page_verification', 'lead_discovery'],
          description: 'Navigation intent. Prospecting/profile intents add safe relationship_context handling.',
        },
        requiresInteraction: {
          type: 'boolean',
          description: 'Whether the page likely needs observation before extraction. The runner does not invent clicks.',
        },
        expectedText: {
          type: 'string',
          description: 'Text that must be proven with browser.assert_text for success.',
        },
        persistWhenProven: {
          type: 'boolean',
          description: 'Ask browser extract/assert to return persistence suggestions after proof.',
        },
        executePersistence: {
          type: 'boolean',
          description: 'Actually execute remember/lessons_add suggestions. Default false.',
        },
        maxPages: {
          type: 'number',
          description: 'Maximum public source candidates. Defaults to 5.',
        },
        useBrowser: {
          type: 'boolean',
          description: 'Use Playwright/browser for navigate, observe, extract, and assert. Default true.',
        },
        headless: {
          type: 'boolean',
          description: 'Run browser headless. Default true.',
        },
        browserPageLimit: {
          type: 'number',
          description: 'Maximum candidate pages to open in the browser. Defaults to 1.',
        },
        scrollCount: {
          type: 'number',
          description: 'Optional number of down-scrolls before browser.extract. Defaults to 0.',
        },
        waitUntil: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle'],
          description: 'Navigation completion condition. Defaults to domcontentloaded.',
        },
        allowLoginPages: {
          type: 'boolean',
          description: 'Allow user-authorized login pages to open, without credential/captcha bypass.',
        },
      },
      required: ['goal'],
    },
  },
};

/**
 * Internet Scout Plan Tool
 *
 * Produces a safe web navigation plan before using search/fetch/browser tools.
 */
export const INTERNET_SCOUT_PLAN_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'internet_scout_plan',
    description: `Plan an evidence-first web navigation workflow before browsing.

Use this when a task involves advanced internet research, OSINT-style public source review, prospecting, profile enrichment, page verification, or multi-step web surfing.

The plan sequences web_search, web_fetch, browser.observe, browser.extract, browser.assert_text, relationship_context, remember, and lessons_add where appropriate. It also returns stop conditions for captcha, login walls, paywalls, 403/429, rate limits, and access-control bypass requests.`,
    parameters: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'What to learn, verify, or collect from public/user-authorized web sources.',
        },
        query: {
          type: 'string',
          description: 'Optional search query. Defaults to goal.',
        },
        sourceUrl: {
          type: 'string',
          description: 'Known starting URL. If omitted, the plan starts with web_search.',
        },
        intent: {
          type: 'string',
          enum: ['research', 'prospecting', 'profile_enrichment', 'page_verification', 'lead_discovery'],
          description: 'Navigation intent. Prospecting/profile intents add safe relationship_context handling.',
        },
        requiresInteraction: {
          type: 'boolean',
          description: 'Whether clicks, forms, tabs, or scrolling are likely needed before extraction.',
        },
        expectedText: {
          type: 'string',
          description: 'Text expected on the page; adds browser.assert_text to the plan.',
        },
        persistWhenProven: {
          type: 'boolean',
          description: 'Add remember/lessons_add only after durable evidence is proven.',
        },
        maxPages: {
          type: 'number',
          description: 'Maximum public pages to inspect. Defaults to 5.',
        },
        allowLoginPages: {
          type: 'boolean',
          description: 'Allow user-authorized login pages to be opened, without credential/captcha bypass.',
        },
      },
      required: ['goal'],
    },
  },
};

/**
 * All browser tools
 */
export const BROWSER_TOOLS: CodeBuddyTool[] = [
  INTERNET_SCOUT_RUN_TOOL,
  INTERNET_SCOUT_PLAN_TOOL,
  BROWSER_TOOL,
];

export default BROWSER_TOOLS;
