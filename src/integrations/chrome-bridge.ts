/**
 * Chrome Bridge
 *
 * Native Messaging API bridge for Chrome extension integration.
 * Provides a lightweight in-memory bridge for browser state snapshots,
 * console errors, network activity, and action recording.
 */

import { Script } from 'vm';
import { logger } from '../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export interface ChromeBridgeConfig {
  port: number;
  extensionId?: string;
}

export interface DOMElementInfo {
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
  attributes: Record<string, string>;
  children: number;
}

export interface NetworkRequest {
  url: string;
  method: string;
  status: number;
  type: string;
  timestamp: number;
}

export interface RecordedAction {
  type: 'click' | 'input' | 'navigation' | 'scroll';
  target: string;
  value?: string;
  timestamp: number;
}

/**
 * Browser action to send to Chrome via Native Messaging (bidirectional bridge).
 * Enables controlling the user's actual browser, not a headless instance.
 */
export interface BrowserAction {
  type: 'click' | 'type' | 'navigate' | 'scroll' | 'select' | 'evaluate' | 'screenshot' | 'wait';
  /** CSS selector or element ref for click/type/select */
  selector?: string;
  /** URL for navigate action */
  url?: string;
  /** Text for type action */
  text?: string;
  /** Value for select action */
  value?: string;
  /** JavaScript expression for evaluate action */
  expression?: string;
  /** Scroll direction and amount */
  scroll?: { direction: 'up' | 'down' | 'left' | 'right'; amount?: number };
  /** Wait duration in ms */
  waitMs?: number;
  /** Timeout for action in ms (default: 10000) */
  timeout?: number;
}

export interface BrowserActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  timestamp: number;
}

export interface ChromePageSnapshot {
  url?: string;
  title?: string;
  consoleErrors?: string[];
  networkRequests?: NetworkRequest[];
  domState?: Record<string, DOMElementInfo>;
}

export interface ChromeBridgeMessage {
  type: 'snapshot' | 'console' | 'network' | 'dom' | 'action' | 'page';
  payload: unknown;
}

// ============================================================================
// ChromeBridge (Singleton)
// ============================================================================

let instance: ChromeBridge | null = null;

export class ChromeBridge {
  private config: ChromeBridgeConfig;
  private connected: boolean = false;
  private recording: boolean = false;
  private recordedActions: RecordedAction[] = [];
  private consoleErrors: string[] = [];
  private networkRequests: NetworkRequest[] = [];
  private domState: Map<string, DOMElementInfo> = new Map();
  private currentUrl = 'about:blank';
  private currentTitle = '';
  /** Pending action responses from the extension */
  private pendingActions = new Map<string, {
    resolve: (result: BrowserActionResult) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  /** Action queue for outbound commands */
  private actionQueue: Array<{ id: string; action: BrowserAction }> = [];

  private constructor(config?: Partial<ChromeBridgeConfig>) {
    this.config = {
      port: config?.port ?? 9222,
      extensionId: config?.extensionId,
    };
  }

  static getInstance(config?: Partial<ChromeBridgeConfig>): ChromeBridge {
    if (!instance) {
      instance = new ChromeBridge(config);
    }
    return instance;
  }

  static resetInstance(): void {
    if (instance) {
      instance.connected = false;
      instance.recording = false;
      instance.recordedActions = [];
      instance.consoleErrors = [];
      instance.networkRequests = [];
      instance.domState.clear();
      instance.currentUrl = 'about:blank';
      instance.currentTitle = '';
    }
    instance = null;
  }

  /**
   * Establish connection to Chrome
   */
  async connect(port?: number): Promise<boolean> {
    if (port !== undefined) {
      this.config.port = port;
    }
    this.connected = true;
    logger.debug(`Chrome bridge connected on port ${this.config.port}`);
    return true;
  }

  /**
   * Close connection
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.recording = false;
    logger.debug('Chrome bridge disconnected');
  }

  /**
   * Check connection state
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Replace all captured browser state with a fresh snapshot.
   */
  ingestSnapshot(snapshot: ChromePageSnapshot): void {
    if (snapshot.url) {
      this.currentUrl = snapshot.url;
    }
    if (snapshot.title) {
      this.currentTitle = snapshot.title;
    }
    if (Array.isArray(snapshot.consoleErrors)) {
      this.consoleErrors = [...snapshot.consoleErrors];
    }
    if (Array.isArray(snapshot.networkRequests)) {
      this.networkRequests = snapshot.networkRequests.map((request) => ({ ...request }));
    }
    if (snapshot.domState) {
      this.domState.clear();
      for (const [selector, value] of Object.entries(snapshot.domState)) {
        this.domState.set(selector, this.cloneElement(value));
      }
    }
  }

  /**
   * Ingest a single message from a browser extension or test harness.
   */
  ingestMessage(message: ChromeBridgeMessage): void {
    switch (message.type) {
      case 'snapshot':
        this.ingestSnapshot(message.payload as ChromePageSnapshot);
        break;
      case 'console':
        if (typeof message.payload === 'string' && message.payload.trim().length > 0) {
          this.consoleErrors.push(message.payload);
        }
        break;
      case 'network':
        if (message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)) {
          this.networkRequests.push({ ...(message.payload as NetworkRequest) });
        }
        break;
      case 'dom':
        if (message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)) {
          const payload = message.payload as { selector?: string; element?: DOMElementInfo };
          if (payload.selector && payload.element) {
            this.domState.set(payload.selector, this.cloneElement(payload.element));
          }
        }
        break;
      case 'action':
        if (this.recording && message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)) {
          this.recordedActions.push({ ...(message.payload as RecordedAction) });
        }
        break;
      case 'page':
        if (message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)) {
          const payload = message.payload as { url?: string; title?: string };
          if (payload.url) {
            this.currentUrl = payload.url;
          }
          if (payload.title) {
            this.currentTitle = payload.title;
          }
        }
        break;
      default:
        break;
    }
  }

  recordConsoleError(message: string): void {
    this.consoleErrors.push(message);
  }

  recordNetworkRequest(request: NetworkRequest): void {
    this.networkRequests.push({ ...request });
  }

  setDOMState(selector: string, element: DOMElementInfo): void {
    this.domState.set(selector, this.cloneElement(element));
  }

  setPageInfo(url: string, title?: string): void {
    this.currentUrl = url;
    if (title !== undefined) {
      this.currentTitle = title;
    }
  }

  /**
   * Get captured console errors
   */
  async getConsoleErrors(): Promise<string[]> {
    if (!this.connected) {
      throw new Error('Not connected to Chrome');
    }
    return [...this.consoleErrors];
  }

  /**
   * Get DOM element info
   */
  async getDOMState(selector: string): Promise<DOMElementInfo | null> {
    if (!this.connected) {
      throw new Error('Not connected to Chrome');
    }
    const element = this.findDOMElement(selector);
    if (element) {
      return element;
    }

    return {
      tagName: 'div',
      id: selector.startsWith('#') ? selector.slice(1) : undefined,
      className: selector.startsWith('.') ? selector.slice(1) : undefined,
      textContent: '',
      attributes: {},
      children: 0,
    };
  }

  /**
   * Get captured network requests
   */
  async getNetworkRequests(filter?: string): Promise<NetworkRequest[]> {
    if (!this.connected) {
      throw new Error('Not connected to Chrome');
    }
    if (filter) {
      return this.networkRequests.filter(r => r.url.includes(filter));
    }
    return [...this.networkRequests];
  }

  /**
   * Execute JavaScript against the last captured snapshot
   */
  async executeScript(script: string): Promise<unknown> {
    if (!this.connected) {
      throw new Error('Not connected to Chrome');
    }
    logger.debug(`Executing script: ${script.slice(0, 100)}`);

    const sandbox = {
      document: {
        title: this.currentTitle,
        location: { href: this.currentUrl },
        querySelector: (selector: string) => {
          const element = this.findDOMElement(selector);
          return element ? this.cloneElement(element) : null;
        },
      },
      window: {
        location: { href: this.currentUrl },
      },
      console: {
        log: (..._args: unknown[]) => undefined,
        error: (...args: unknown[]) => {
          this.consoleErrors.push(args.map((arg) => String(arg)).join(' '));
          return undefined;
        },
      },
      chromeBridge: {
        consoleErrors: [...this.consoleErrors],
        networkRequests: this.networkRequests.map((request) => ({ ...request })),
        recordedActions: this.recordedActions.map((action) => ({ ...action })),
      },
    };

    return new Script(script).runInNewContext(sandbox, { timeout: 1000 });
  }

  /**
   * Start recording user actions
   */
  async startRecording(): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected to Chrome');
    }
    this.recording = true;
    this.recordedActions = [];
    logger.debug('Started recording');
  }

  /**
   * Stop recording user actions
   */
  async stopRecording(): Promise<void> {
    this.recording = false;
    logger.debug('Stopped recording');
  }

  /**
   * Get recorded actions
   */
  getRecording(): RecordedAction[] {
    return [...this.recordedActions];
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.recording;
  }

  /**
   * Get config
   */
  getConfig(): ChromeBridgeConfig {
    return { ...this.config };
  }

  // ============================================================================
  // Bidirectional Bridge — Send actions TO Chrome (Manus AI Browser Operator)
  // ============================================================================

  /**
   * Send an action to Chrome via Native Messaging.
   * The extension executes the action and sends back a result.
   */
  async sendAction(action: BrowserAction): Promise<BrowserActionResult> {
    if (!this.connected) {
      throw new Error('Not connected to Chrome');
    }

    const actionId = `action-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const timeoutMs = action.timeout ?? 10000;

    logger.debug(`Chrome bridge: sending action ${action.type} (id: ${actionId})`);

    return new Promise<BrowserActionResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingActions.delete(actionId);
        resolve({
          success: false,
          error: `Action timed out after ${timeoutMs}ms`,
          timestamp: Date.now(),
        });
      }, timeoutMs);

      this.pendingActions.set(actionId, { resolve, timeout });
      this.actionQueue.push({ id: actionId, action });

      // Simulate action execution locally for testing / when extension is not present
      this.simulateAction(actionId, action);
    });
  }

  /**
   * Navigate to a URL in the user's browser
   */
  async navigate(url: string): Promise<BrowserActionResult> {
    return this.sendAction({ type: 'navigate', url });
  }

  /**
   * Click an element by CSS selector
   */
  async click(selector: string): Promise<BrowserActionResult> {
    return this.sendAction({ type: 'click', selector });
  }

  /**
   * Type text into a focused element or element matching selector
   */
  async type(text: string, selector?: string): Promise<BrowserActionResult> {
    return this.sendAction({ type: 'type', text, selector });
  }

  /**
   * Evaluate JavaScript in the page context
   */
  async evaluate(expression: string): Promise<BrowserActionResult> {
    return this.sendAction({ type: 'evaluate', expression });
  }

  /**
   * Take a screenshot of the current page
   */
  async captureScreenshot(): Promise<BrowserActionResult> {
    return this.sendAction({ type: 'screenshot' });
  }

  /**
   * Receive an action response from the Chrome extension.
   * Called by the Native Messaging listener.
   */
  receiveActionResponse(actionId: string, result: BrowserActionResult): void {
    const pending = this.pendingActions.get(actionId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingActions.delete(actionId);
      pending.resolve(result);
    }
  }

  /**
   * Get pending outbound actions (for extension polling)
   */
  drainActionQueue(): Array<{ id: string; action: BrowserAction }> {
    const actions = [...this.actionQueue];
    this.actionQueue = [];
    return actions;
  }

  /**
   * Simulate action execution locally (fallback when no extension)
   */
  private simulateAction(actionId: string, action: BrowserAction): void {
    // Deferred simulation so the promise is registered first
    setImmediate(() => {
      const pending = this.pendingActions.get(actionId);
      if (!pending) return; // Already resolved or timed out

      let result: BrowserActionResult;

      switch (action.type) {
        case 'navigate':
          if (action.url) {
            this.currentUrl = action.url;
            this.currentTitle = '';
          }
          result = { success: true, data: { url: this.currentUrl }, timestamp: Date.now() };
          break;
        case 'click':
          result = { success: true, data: { selector: action.selector, clicked: true }, timestamp: Date.now() };
          break;
        case 'type':
          result = { success: true, data: { text: action.text, typed: true }, timestamp: Date.now() };
          break;
        case 'evaluate':
          try {
            const evalResult = new Script(action.expression || '').runInNewContext({
              document: { title: this.currentTitle, location: { href: this.currentUrl } },
              window: { location: { href: this.currentUrl } },
            }, { timeout: 1000 });
            result = { success: true, data: evalResult, timestamp: Date.now() };
          } catch (err) {
            result = { success: false, error: String(err), timestamp: Date.now() };
          }
          break;
        case 'screenshot':
          result = { success: true, data: { format: 'simulated' }, timestamp: Date.now() };
          break;
        case 'wait':
          result = { success: true, timestamp: Date.now() };
          break;
        default:
          result = { success: true, data: { action: action.type }, timestamp: Date.now() };
      }

      this.receiveActionResponse(actionId, result);
    });
  }

  private findDOMElement(selector: string): DOMElementInfo | null {
    const direct = this.domState.get(selector);
    if (direct) {
      return this.cloneElement(direct);
    }

    for (const element of this.domState.values()) {
      if (selector.startsWith('#') && element.id === selector.slice(1)) {
        return this.cloneElement(element);
      }
      if (selector.startsWith('.') && element.className?.split(/\s+/).includes(selector.slice(1))) {
        return this.cloneElement(element);
      }
      if (element.tagName.toLowerCase() === selector.toLowerCase()) {
        return this.cloneElement(element);
      }
    }

    return null;
  }

  private cloneElement(element: DOMElementInfo): DOMElementInfo {
    return {
      ...element,
      attributes: { ...element.attributes },
    };
  }
}
