/**
 * Computer Control Tool
 *
 * OpenClaw-inspired unified interface for AI agents to control the computer.
 * Integrates:
 * - Smart Snapshot for element detection
 * - Mouse/keyboard automation
 * - System control (volume, brightness)
 * - Screen recording
 * - Permission management
 */

import { ToolResult } from '../types/index.js';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import {
  getDesktopAutomation,
  getPermissionManager,
  getSystemControl,
  getSmartSnapshotManager,
  getScreenRecorder,
  type UIElement,
  type Snapshot,
  type RecordingInfo,
  type ElementRole,
  type ModifierKey,
  type KeyCode,
  type PermissionType,
  type WindowInfo,
} from '../desktop-automation/index.js';

// ============================================================================
// Types
// ============================================================================

export type ComputerAction =
  // Snapshot actions
  | 'snapshot'
  | 'snapshot_with_screenshot'
  | 'get_element'
  | 'find_elements'
  // Mouse actions
  | 'click'
  | 'left_click'
  | 'middle_click'
  | 'double_click'
  | 'right_click'
  | 'move_mouse'
  | 'drag'
  | 'scroll'
  | 'cursor_position'
  | 'wait'
  // Keyboard actions
  | 'type'
  | 'key'
  | 'key_down'
  | 'key_up'
  | 'hotkey'
  // Window actions
  | 'get_windows'
  | 'get_window'
  | 'list_window_matches'
  | 'wait_for_window'
  | 'focus_window'
  | 'close_window'
  | 'get_active_window'
  | 'minimize_window'
  | 'maximize_window'
  | 'restore_window'
  | 'move_window'
  | 'resize_window'
  | 'set_window'
  | 'act_on_best_window'
  | 'get_audit_log'
  | 'clear_audit_log'
  | 'export_audit_log'
  | 'set_pilot_mode'
  | 'get_pilot_mode'
  // System actions
  | 'get_volume'
  | 'set_volume'
  | 'get_brightness'
  | 'set_brightness'
  | 'notify'
  | 'lock'
  | 'sleep'
  // Recording actions
  | 'start_recording'
  | 'stop_recording'
  | 'recording_status'
  // Info actions
  | 'system_info'
  | 'battery_info'
  | 'network_info'
  | 'check_permission';

export interface ComputerControlInput {
  action: ComputerAction;
  pilotMode?: 'cautious' | 'normal' | 'fast';
  safetyProfile?: 'balanced' | 'strict';
  confirmDangerous?: boolean;
  auditLimit?: number;
  simulateOnly?: boolean;
  exportAuditPath?: string;
  policyOverrides?: Record<string, 'allow' | 'block' | 'confirm'>;
  // Snapshot params
  interactiveOnly?: boolean;
  // Element params
  ref?: number;
  role?: string;
  name?: string;
  // Mouse params
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  button?: 'left' | 'right' | 'middle';
  duration?: number;
  seconds?: number;
  // Keyboard params
  text?: string;
  key?: string;
  modifiers?: string[];
  // Scroll params
  deltaX?: number;
  deltaY?: number;
  // Window params
  windowTitle?: string;
  windowTitleRegex?: string;
  windowTitleMatch?: 'contains' | 'equals';
  processName?: string;
  processNameMatch?: 'equals' | 'contains';
  windowHandle?: string;
  windowMatchStrategy?: 'first' | 'focused' | 'largest' | 'newest';
  requireUniqueWindowMatch?: boolean;
  focus?: boolean;
  windowState?: 'normal' | 'minimized' | 'maximized';
  bestWindowAction?: 'focus' | 'close' | 'minimize' | 'maximize' | 'restore' | 'move' | 'resize' | 'set';
  timeoutMs?: number;
  pollIntervalMs?: number;
  // System params
  level?: number;
  muted?: boolean;
  // Notification params
  title?: string;
  body?: string;
  // Recording params
  format?: 'mp4' | 'webm' | 'gif';
  fps?: number;
  audio?: boolean;
  // Permission params
  permission?: string;
}

// ============================================================================
// Computer Control Tool
// ============================================================================

export class ComputerControlTool {
  private automation = getDesktopAutomation();
  private automationInitialized = false;
  private lastWindowMatchError: string | null = null;
  private pilotMode: 'cautious' | 'normal' | 'fast' = 'normal';
  private actionAuditLog: Array<{
    id: string;
    timestamp: string;
    action: ComputerAction;
    success: boolean;
    durationMs: number;
    safetyProfile: 'balanced' | 'strict';
    dangerous: boolean;
    simulated: boolean;
    error?: string;
  }> = [];
  private permissions = getPermissionManager();
  private systemControl = getSystemControl();
  private snapshotManager = getSmartSnapshotManager();
  private screenRecorder = getScreenRecorder();

  /**
   * Execute a computer control action
   */
  async execute(input: ComputerControlInput): Promise<ToolResult> {
    const enrichedInput = this.applyPilotDefaults(input);
    const { action } = enrichedInput;
    this.lastWindowMatchError = null;
    const startedAt = Date.now();

    logger.debug('Computer control action', { action, input: enrichedInput });

    try {
      const safetyError = this.enforceSafetyPolicy(enrichedInput);
      if (safetyError) {
        return this.finalizeActionResult(action, enrichedInput, {
          success: false,
          error: safetyError,
        }, startedAt, false);
      }

      if (this.requiresAutomation(action)) {
        await this.ensureAutomationInitialized();
      }

      const run = async (fn: () => Promise<ToolResult>): Promise<ToolResult> => {
        const simulated = Boolean(enrichedInput.simulateOnly && this.isMutatingAction(action, enrichedInput));
        if (simulated) {
          return this.finalizeActionResult(action, enrichedInput, {
            success: true,
            output: `[SIMULATED] ${action} skipped (no system changes applied).`,
            data: { simulated: true },
          }, startedAt, true);
        }
        const result = await fn();
        return this.finalizeActionResult(action, enrichedInput, result, startedAt, false);
      };

      switch (action) {
        // Snapshot actions
        case 'snapshot':
          return run(() => this.takeSnapshot(enrichedInput));
        case 'snapshot_with_screenshot':
          return run(() => this.snapshotWithScreenshot(enrichedInput));
        case 'get_element':
          return run(() => this.getElement(enrichedInput));
        case 'find_elements':
          return run(() => this.findElements(enrichedInput));

        // Mouse actions
        case 'click':
          return run(() => this.click(enrichedInput));
        case 'left_click':
          return run(() => this.click({ ...enrichedInput, button: 'left' }));
        case 'middle_click':
          return run(() => this.click({ ...enrichedInput, button: 'middle' }));
        case 'double_click':
          return run(() => this.doubleClick(enrichedInput));
        case 'right_click':
          return run(() => this.rightClick(enrichedInput));
        case 'move_mouse':
          return run(() => this.moveMouse(enrichedInput));
        case 'drag':
          return run(() => this.drag(enrichedInput));
        case 'scroll':
          return run(() => this.scroll(enrichedInput));
        case 'cursor_position':
          return run(() => this.getCursorPosition());
        case 'wait':
          return run(() => this.wait(enrichedInput));

        // Keyboard actions
        case 'type':
          return run(() => this.typeText(enrichedInput));
        case 'key':
          return run(() => this.pressKey(enrichedInput));
        case 'key_down':
          return run(() => this.keyDown(enrichedInput));
        case 'key_up':
          return run(() => this.keyUp(enrichedInput));
        case 'hotkey':
          return run(() => this.hotkey(enrichedInput));

        // Window actions
        case 'get_windows':
          return run(() => this.getWindows());
        case 'get_window':
          return run(() => this.getWindow(enrichedInput));
        case 'list_window_matches':
          return run(() => this.listWindowMatches(enrichedInput));
        case 'wait_for_window':
          return run(() => this.waitForWindow(enrichedInput));
        case 'focus_window':
          return run(() => this.focusWindow(enrichedInput));
        case 'close_window':
          return run(() => this.closeWindow(enrichedInput));
        case 'get_active_window':
          return run(() => this.getActiveWindow());
        case 'minimize_window':
          return run(() => this.minimizeWindow(enrichedInput));
        case 'maximize_window':
          return run(() => this.maximizeWindow(enrichedInput));
        case 'restore_window':
          return run(() => this.restoreWindow(enrichedInput));
        case 'move_window':
          return run(() => this.moveWindow(enrichedInput));
        case 'resize_window':
          return run(() => this.resizeWindow(enrichedInput));
        case 'set_window':
          return run(() => this.setWindow(enrichedInput));
        case 'act_on_best_window':
          return run(() => this.actOnBestWindow(enrichedInput));
        case 'get_audit_log':
          return run(() => this.getAuditLog(enrichedInput));
        case 'clear_audit_log':
          return run(() => this.clearAuditLog());
        case 'export_audit_log':
          return run(() => this.exportAuditLog(enrichedInput));
        case 'set_pilot_mode':
          return run(() => this.setPilotMode(enrichedInput));
        case 'get_pilot_mode':
          return run(() => this.getPilotMode());

        // System actions
        case 'get_volume':
          return run(() => this.getVolume());
        case 'set_volume':
          return run(() => this.setVolume(enrichedInput));
        case 'get_brightness':
          return run(() => this.getBrightness());
        case 'set_brightness':
          return run(() => this.setBrightness(enrichedInput));
        case 'notify':
          return run(() => this.sendNotification(enrichedInput));
        case 'lock':
          return run(() => this.lockScreen());
        case 'sleep':
          return run(() => this.sleepSystem());

        // Recording actions
        case 'start_recording':
          return run(() => this.startRecording(enrichedInput));
        case 'stop_recording':
          return run(() => this.stopRecording());
        case 'recording_status':
          return run(() => this.getRecordingStatus());

        // Info actions
        case 'system_info':
          return run(() => this.getSystemInfo());
        case 'battery_info':
          return run(() => this.getBatteryInfo());
        case 'network_info':
          return run(() => this.getNetworkInfo());
        case 'check_permission':
          return run(() => this.checkPermission(enrichedInput));

        default:
          return this.finalizeActionResult(action, enrichedInput, {
            success: false,
            error: `Unknown action: ${action}`,
          }, startedAt, false);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Computer control error', { action, error: errorMessage });
      return this.finalizeActionResult(action, enrichedInput, {
        success: false,
        error: this.toAIFriendlyError(errorMessage, action),
      }, startedAt, false);
    }
  }

  /**
   * Whether the action requires desktop automation provider access.
   */
  private requiresAutomation(action: ComputerAction): boolean {
    return [
      'snapshot',
      'snapshot_with_screenshot',
      'click',
      'left_click',
      'middle_click',
      'double_click',
      'right_click',
      'move_mouse',
      'drag',
      'scroll',
      'cursor_position',
      'type',
      'key',
      'key_down',
      'key_up',
      'hotkey',
      'get_windows',
      'get_window',
      'list_window_matches',
      'wait_for_window',
      'focus_window',
      'close_window',
      'get_active_window',
      'minimize_window',
      'maximize_window',
      'restore_window',
      'move_window',
      'resize_window',
      'set_window',
      'act_on_best_window',
    ].includes(action);
  }

  /**
   * Initialize desktop automation lazily once.
   */
  private async ensureAutomationInitialized(): Promise<void> {
    if (this.automationInitialized) {
      return;
    }

    const maybeInitialize = (this.automation as { initialize?: () => Promise<void> }).initialize;
    if (typeof maybeInitialize === 'function') {
      await maybeInitialize.call(this.automation);
    }

    this.automationInitialized = true;
  }

  // ============================================================================
  // Snapshot Actions
  // ============================================================================

  private async takeSnapshot(input: ComputerControlInput): Promise<ToolResult> {
    const snapshot = await this.snapshotManager.takeSnapshot({
      interactiveOnly: input.interactiveOnly ?? true,
    });

    const textRepresentation = this.snapshotManager.toTextRepresentation(snapshot);

    return {
      success: true,
      output: textRepresentation,
      data: {
        snapshotId: snapshot.id,
        elementCount: snapshot.elements.length,
        validUntil: new Date(snapshot.timestamp.getTime() + snapshot.ttl).toISOString(),
      },
    };
  }

  private async snapshotWithScreenshot(input: ComputerControlInput): Promise<ToolResult> {
    // Take snapshot first
    const snapshot = await this.snapshotManager.takeSnapshot({
      interactiveOnly: input.interactiveOnly ?? true,
    });

    const textRepresentation = this.snapshotManager.toTextRepresentation(snapshot);

    // Capture and normalize screenshot for LLM
    let screenshotData: { base64?: string; contentType?: string; width?: number; height?: number } = {};
    try {
      const { ScreenshotTool } = await import('./screenshot-tool.js');
      const screenshotTool = new ScreenshotTool();
      const captureResult = await screenshotTool.capture({ fullscreen: true, format: 'png' });

      const captureData = captureResult.data as Record<string, unknown> | undefined;
      if (captureResult.success && captureData?.path) {
        const filePath = captureData.path as string;
        try {
          const normalized = await screenshotTool.normalizeForLLM(filePath);
          screenshotData = normalized;
        } catch {
          // Fall back to raw base64
          const result = await screenshotTool.toBase64(filePath);
          const resultData = result.data as Record<string, unknown> | undefined;
          if (result.success && resultData) {
            screenshotData = {
              base64: resultData.base64 as string,
              contentType: resultData.mediaType as string,
            };
          }
        }
      }
    } catch (err) {
      logger.debug('Screenshot capture failed in snapshot_with_screenshot', { error: err });
    }

    return {
      success: true,
      output: textRepresentation,
      data: {
        snapshotId: snapshot.id,
        elementCount: snapshot.elements.length,
        validUntil: new Date(snapshot.timestamp.getTime() + snapshot.ttl).toISOString(),
        screenshot: screenshotData.base64 || null,
        screenshotContentType: screenshotData.contentType || null,
        screenshotWidth: screenshotData.width || null,
        screenshotHeight: screenshotData.height || null,
      },
    };
  }

  private async getElement(input: ComputerControlInput): Promise<ToolResult> {
    if (input.ref === undefined) {
      return { success: false, error: 'Element ref is required' };
    }

    const element = this.snapshotManager.getElement(input.ref);
    if (!element) {
      return {
        success: false,
        error: `Element [${input.ref}] not found. Take a new snapshot first.`,
      };
    }

    return {
      success: true,
      output: `Element [${element.ref}]: ${element.role} - "${element.name}" at (${element.center.x}, ${element.center.y})`,
      data: element,
    };
  }

  private async findElements(input: ComputerControlInput): Promise<ToolResult> {
    const elements = this.snapshotManager.findElements({
      role: input.role as ElementRole | undefined,
      name: input.name,
      interactive: input.interactiveOnly,
    });

    if (elements.length === 0) {
      return {
        success: true,
        output: 'No elements found matching criteria',
        data: { elements: [] },
      };
    }

    const output = elements
      .map(e => `[${e.ref}] ${e.role}: "${e.name}"`)
      .join('\n');

    return {
      success: true,
      output: `Found ${elements.length} elements:\n${output}`,
      data: { elements },
    };
  }

  // ============================================================================
  // Mouse Actions
  // ============================================================================

  private async click(input: ComputerControlInput): Promise<ToolResult> {
    const point = await this.resolvePoint(input);
    if (!point) {
      return { success: false, error: 'Position required (x,y or element ref)' };
    }
    if (point.browserError) {
      return { success: false, error: point.browserError };
    }

    await this.automation.click(point.x, point.y, { button: input.button || 'left' });

    return {
      success: true,
      output: `Clicked at (${point.x}, ${point.y})`,
    };
  }

  private async doubleClick(input: ComputerControlInput): Promise<ToolResult> {
    const point = await this.resolvePoint(input);
    if (!point) {
      return { success: false, error: 'Position required (x,y or element ref)' };
    }
    if (point.browserError) {
      return { success: false, error: point.browserError };
    }

    await this.automation.doubleClick(point.x, point.y, 'left');

    return {
      success: true,
      output: `Double-clicked at (${point.x}, ${point.y})`,
    };
  }

  private async rightClick(input: ComputerControlInput): Promise<ToolResult> {
    const point = await this.resolvePoint(input);
    if (!point) {
      return { success: false, error: 'Position required (x,y or element ref)' };
    }
    if (point.browserError) {
      return { success: false, error: point.browserError };
    }

    await this.automation.rightClick(point.x, point.y);

    return {
      success: true,
      output: `Right-clicked at (${point.x}, ${point.y})`,
    };
  }

  private async moveMouse(input: ComputerControlInput): Promise<ToolResult> {
    const point = await this.resolvePoint(input);
    if (!point) {
      return { success: false, error: 'Position required (x,y or element ref)' };
    }
    if (point.browserError) {
      return { success: false, error: point.browserError };
    }

    await this.automation.moveMouse(point.x, point.y, {
      duration: input.duration,
      smooth: true,
    });

    return {
      success: true,
      output: `Moved mouse to (${point.x}, ${point.y})`,
    };
  }

  private async drag(input: ComputerControlInput): Promise<ToolResult> {
    if (input.x === undefined || input.y === undefined) {
      return { success: false, error: 'Target position (x, y) required' };
    }

    const currentPos = await this.automation.getMousePosition();
    await this.automation.drag(
      currentPos.x, currentPos.y,
      input.x, input.y,
      { duration: input.duration }
    );

    return {
      success: true,
      output: `Dragged from (${currentPos.x}, ${currentPos.y}) to (${input.x}, ${input.y})`,
    };
  }

  private async scroll(input: ComputerControlInput): Promise<ToolResult> {
    const deltaX = this.toFiniteNumber(input.deltaX, 0);
    const deltaY = this.toFiniteNumber(input.deltaY, -3);
    await this.automation.scroll({
      deltaX,
      deltaY, // Default scroll down
    });

    return {
      success: true,
      output: `Scrolled (${deltaX}, ${deltaY})`,
    };
  }

  private async getCursorPosition(): Promise<ToolResult> {
    const pos = await this.automation.getMousePosition();
    return {
      success: true,
      output: `Cursor at (${pos.x}, ${pos.y})`,
      data: pos,
    };
  }

  private async wait(input: ComputerControlInput): Promise<ToolResult> {
    const seconds = this.toFiniteNumber(input.seconds, null);
    const duration = this.toFiniteNumber(input.duration, null);
    const msFromSeconds = seconds === null ? undefined : seconds * 1000;
    const rawMs = msFromSeconds ?? duration ?? 1000;
    const ms = Math.max(0, Math.min(Math.round(rawMs), 60_000));
    await this.delay(ms);

    return {
      success: true,
      output: `Waited ${ms}ms`,
      data: { durationMs: ms },
    };
  }

  // ============================================================================
  // Keyboard Actions
  // ============================================================================

  private async typeText(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.text) {
      return { success: false, error: 'Text is required' };
    }

    await this.automation.type(input.text, { delay: 30 });

    return {
      success: true,
      output: `Typed: "${input.text.slice(0, 50)}${input.text.length > 50 ? '...' : ''}"`,
    };
  }

  private async pressKey(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.key) {
      return { success: false, error: 'Key is required' };
    }

    await this.automation.keyPress(input.key, {
      modifiers: input.modifiers as ModifierKey[] | undefined,
    });

    return {
      success: true,
      output: `Pressed key: ${input.modifiers?.join('+') || ''}${input.modifiers?.length ? '+' : ''}${input.key}`,
    };
  }

  private async hotkey(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.key) {
      return { success: false, error: 'Key is required' };
    }

    // Build keys array: modifiers first, then the main key
    const keys: KeyCode[] = [...(input.modifiers || []), input.key];
    await this.automation.hotkey(...keys);

    return {
      success: true,
      output: `Hotkey: ${input.modifiers?.length ? input.modifiers.join('+') + '+' : ''}${input.key}`,
    };
  }

  private async keyDown(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.key) {
      return { success: false, error: 'Key is required' };
    }

    await this.automation.keyDown(input.key);
    return {
      success: true,
      output: `Key down: ${input.key}`,
    };
  }

  private async keyUp(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.key) {
      return { success: false, error: 'Key is required' };
    }

    await this.automation.keyUp(input.key);
    return {
      success: true,
      output: `Key up: ${input.key}`,
    };
  }

  // ============================================================================
  // Window Actions
  // ============================================================================

  private async getWindows(): Promise<ToolResult> {
    const windows = await this.automation.getWindows();

    const output = windows
      .map(w => `- "${w.title}" (${w.processName}, PID: ${w.pid})${w.focused ? ' [focused]' : ''}`)
      .join('\n');

    return {
      success: true,
      output: `Found ${windows.length} windows:\n${output}`,
      data: { windows },
    };
  }

  private async getWindow(input: ComputerControlInput): Promise<ToolResult> {
    if (input.windowTitleRegex && !this.parseTitleRegex(input)) {
      return { success: false, error: `Invalid windowTitleRegex: ${input.windowTitleRegex}` };
    }

    const candidates = await this.findWindowCandidatesFromInput(input);
    const uniqueErr = this.buildUniqueWindowError(candidates, input);
    if (uniqueErr) {
      return { success: false, error: uniqueErr };
    }
    const window = this.selectWindowCandidate(candidates, input);

    if (!window) {
      return {
        success: false,
        error: `No window found matching: ${this.describeWindowMatcher(input)}`,
      };
    }

    return {
      success: true,
      output: `Window: "${window.title}" (${window.processName}, PID: ${window.pid})`,
      data: { window, matchedCount: candidates.length, ranked: this.getRankedWindowCandidates(candidates, input) },
    };
  }

  private async listWindowMatches(input: ComputerControlInput): Promise<ToolResult> {
    if (!this.hasWindowMatcher(input)) {
      return { success: false, error: 'windowTitle, windowTitleRegex, processName, or windowHandle is required' };
    }
    if (input.windowTitleRegex && !this.parseTitleRegex(input)) {
      return { success: false, error: `Invalid windowTitleRegex: ${input.windowTitleRegex}` };
    }

    const candidates = await this.findWindowCandidatesFromInput(input);
    const selected = this.selectWindowCandidate(candidates, input);
    const ranked = this.getRankedWindowCandidates(candidates, input);

    const outputLines = ranked.slice(0, 20).map(r => {
      const w = r.window;
      const area = Math.max(0, w.bounds.width) * Math.max(0, w.bounds.height);
      return `- [score=${r.score}] "${w.title}" (${w.processName}, PID: ${w.pid}, handle: ${w.handle}, focused: ${w.focused}, area: ${area})`;
    });

    return {
      success: true,
      output: [
        `Matched ${candidates.length} window(s) for: ${this.describeWindowMatcher(input)}`,
        selected ? `Selected by strategy "${input.windowMatchStrategy ?? 'first'}": ${selected.handle}` : 'No selection',
        ...outputLines,
      ].join('\n'),
      data: {
        matchedCount: candidates.length,
        selectedHandle: selected?.handle ?? null,
        windows: candidates,
        ranked,
      },
    };
  }

  private async focusWindow(input: ComputerControlInput): Promise<ToolResult> {
    if (input.windowHandle) {
      await this.automation.focusWindow(input.windowHandle);
      return {
        success: true,
        output: `Focused window handle: "${input.windowHandle}"`,
      };
    }

    const win = await this.findWindowFromInput(input);
    if (!win) {
      return {
        success: false,
        error: this.lastWindowMatchError ?? `No window found matching: ${this.describeWindowMatcher(input)}`,
      };
    }

    await this.automation.focusWindow(win.handle);

    return {
      success: true,
      output: `Focused window: "${win.title}"`,
    };
  }

  private async waitForWindow(input: ComputerControlInput): Promise<ToolResult> {
    if (!this.hasWindowMatcher(input)) {
      return { success: false, error: 'windowTitle, windowTitleRegex, processName, or windowHandle is required' };
    }
    if (input.windowTitleRegex && !this.parseTitleRegex(input)) {
      return { success: false, error: `Invalid windowTitleRegex: ${input.windowTitleRegex}` };
    }

    const win = await this.waitForWindowFromInput(input);

    if (!win) {
      return {
        success: false,
        error: this.lastWindowMatchError ??
          `No window found matching: ${this.describeWindowMatcher(input)} within ${input.timeoutMs ?? 10000}ms`,
      };
    }

    return {
      success: true,
      output: `Window found: "${win.title}" (${win.processName}, PID: ${win.pid})`,
      data: { window: win },
    };
  }

  private async closeWindow(input: ComputerControlInput): Promise<ToolResult> {
    if (input.windowHandle) {
      await this.automation.closeWindow(input.windowHandle);
      return {
        success: true,
        output: `Closed window handle: "${input.windowHandle}"`,
      };
    }

    const win = await this.findWindowFromInput(input);
    if (!win) {
      return {
        success: false,
        error: this.lastWindowMatchError ?? `No window found matching: ${this.describeWindowMatcher(input)}`,
      };
    }

    await this.automation.closeWindow(win.handle);

    return {
      success: true,
      output: `Closed window: "${win.title}"`,
    };
  }

  private async getActiveWindow(): Promise<ToolResult> {
    const window = await this.automation.getActiveWindow();
    if (!window) {
      return {
        success: true,
        output: 'No active window found',
        data: { window: null },
      };
    }

    return {
      success: true,
      output: `Active window: "${window.title}" (${window.processName}, PID: ${window.pid})`,
      data: { window },
    };
  }

  private async minimizeWindow(input: ComputerControlInput): Promise<ToolResult> {
    const handle = await this.resolveWindowHandle(input);
    if (!handle) {
      return {
        success: false,
        error: this.lastWindowMatchError ?? `No window found matching: ${this.describeWindowMatcher(input)}`,
      };
    }

    await this.automation.minimizeWindow(handle);
    return {
      success: true,
      output: `Minimized window: "${handle}"`,
    };
  }

  private async maximizeWindow(input: ComputerControlInput): Promise<ToolResult> {
    const handle = await this.resolveWindowHandle(input);
    if (!handle) {
      return {
        success: false,
        error: this.lastWindowMatchError ?? `No window found matching: ${this.describeWindowMatcher(input)}`,
      };
    }

    await this.automation.maximizeWindow(handle);
    return {
      success: true,
      output: `Maximized window: "${handle}"`,
    };
  }

  private async restoreWindow(input: ComputerControlInput): Promise<ToolResult> {
    const handle = await this.resolveWindowHandle(input);
    if (!handle) {
      return {
        success: false,
        error: this.lastWindowMatchError ?? `No window found matching: ${this.describeWindowMatcher(input)}`,
      };
    }

    await this.automation.restoreWindow(handle);
    return {
      success: true,
      output: `Restored window: "${handle}"`,
    };
  }

  private async moveWindow(input: ComputerControlInput): Promise<ToolResult> {
    const x = this.toFiniteNumber(input.x, null);
    const y = this.toFiniteNumber(input.y, null);
    if (x === null || y === null) {
      return { success: false, error: 'x and y are required for move_window' };
    }

    const handle = await this.resolveWindowHandle(input);
    if (!handle) {
      return {
        success: false,
        error: this.lastWindowMatchError ?? `No window found matching: ${this.describeWindowMatcher(input)}`,
      };
    }

    await this.automation.moveWindow(handle, x, y);
    return {
      success: true,
      output: `Moved window "${handle}" to (${x}, ${y})`,
    };
  }

  private async resizeWindow(input: ComputerControlInput): Promise<ToolResult> {
    const width = this.toFiniteNumber(input.width, null);
    const height = this.toFiniteNumber(input.height, null);
    if (width === null || height === null) {
      return { success: false, error: 'width and height are required for resize_window' };
    }
    if (width <= 0 || height <= 0) {
      return { success: false, error: 'width and height must be greater than 0 for resize_window' };
    }

    const handle = await this.resolveWindowHandle(input);
    if (!handle) {
      return {
        success: false,
        error: this.lastWindowMatchError ?? `No window found matching: ${this.describeWindowMatcher(input)}`,
      };
    }

    await this.automation.resizeWindow(handle, width, height);
    return {
      success: true,
      output: `Resized window "${handle}" to ${width}x${height}`,
    };
  }

  private async setWindow(input: ComputerControlInput): Promise<ToolResult> {
    const handle = await this.resolveWindowHandle(input);
    if (!handle) {
      return {
        success: false,
        error: this.lastWindowMatchError ?? `No window found matching: ${this.describeWindowMatcher(input)}`,
      };
    }

    const setOptions: { position?: { x: number; y: number }; size?: { width: number; height: number }; focus?: boolean } = {};
    let hasSetOptions = false;

    if (input.x !== undefined || input.y !== undefined) {
      const x = this.toFiniteNumber(input.x, null);
      const y = this.toFiniteNumber(input.y, null);
      if (x === null || y === null) {
        return { success: false, error: 'Both x and y are required when setting window position' };
      }
      setOptions.position = { x, y };
      hasSetOptions = true;
    }

    if (input.width !== undefined || input.height !== undefined) {
      const width = this.toFiniteNumber(input.width, null);
      const height = this.toFiniteNumber(input.height, null);
      if (width === null || height === null) {
        return { success: false, error: 'Both width and height are required when setting window size' };
      }
      if (width <= 0 || height <= 0) {
        return { success: false, error: 'width and height must be greater than 0 when setting window size' };
      }
      setOptions.size = { width, height };
      hasSetOptions = true;
    }

    if (typeof input.focus === 'boolean') {
      setOptions.focus = input.focus;
      hasSetOptions = true;
    }

    if (!hasSetOptions && !input.windowState) {
      return {
        success: false,
        error: 'set_window requires at least one of: x/y, width/height, focus, windowState',
      };
    }

    if (hasSetOptions) {
      await this.automation.setWindow(handle, setOptions);
    }

    if (input.windowState === 'minimized') {
      await this.automation.minimizeWindow(handle);
    } else if (input.windowState === 'maximized') {
      await this.automation.maximizeWindow(handle);
    } else if (input.windowState === 'normal') {
      await this.automation.restoreWindow(handle);
    }

    return {
      success: true,
      output: `Updated window "${handle}"`,
    };
  }

  private async actOnBestWindow(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.bestWindowAction) {
      return {
        success: false,
        error: 'bestWindowAction is required (focus|close|minimize|maximize|restore|move|resize|set)',
      };
    }
    if (!this.hasWindowMatcher(input)) {
      return { success: false, error: 'windowTitle, windowTitleRegex, processName, or windowHandle is required' };
    }
    if (input.windowTitleRegex && !this.parseTitleRegex(input)) {
      return { success: false, error: `Invalid windowTitleRegex: ${input.windowTitleRegex}` };
    }

    const candidates = await this.findWindowCandidatesFromInput(input);
    const uniqueErr = this.buildUniqueWindowError(candidates, input);
    if (uniqueErr) {
      return { success: false, error: uniqueErr };
    }

    const selected = this.selectWindowCandidate(candidates, input);
    if (!selected) {
      return { success: false, error: `No window found matching: ${this.describeWindowMatcher(input)}` };
    }

    const selectedInput: ComputerControlInput = { ...input, windowHandle: selected.handle };
    let result: ToolResult;

    switch (input.bestWindowAction) {
      case 'focus':
        result = await this.focusWindow(selectedInput);
        break;
      case 'close':
        result = await this.closeWindow(selectedInput);
        break;
      case 'minimize':
        result = await this.minimizeWindow(selectedInput);
        break;
      case 'maximize':
        result = await this.maximizeWindow(selectedInput);
        break;
      case 'restore':
        result = await this.restoreWindow(selectedInput);
        break;
      case 'move':
        result = await this.moveWindow(selectedInput);
        break;
      case 'resize':
        result = await this.resizeWindow(selectedInput);
        break;
      case 'set':
        result = await this.setWindow(selectedInput);
        break;
      default:
        return { success: false, error: `Unsupported bestWindowAction: ${input.bestWindowAction}` };
    }

    return {
      ...result,
      data: {
        ...(result.data as Record<string, unknown> | undefined),
        selectedWindow: selected,
        matchedCount: candidates.length,
      },
    };
  }

  private async getAuditLog(input: ComputerControlInput): Promise<ToolResult> {
    const limitRaw = this.toFiniteNumber(input.auditLimit, 50);
    const limit = Math.max(1, Math.min(500, Math.round(limitRaw)));
    const entries = this.actionAuditLog.slice(-limit).reverse();

    return {
      success: true,
      output: `Audit entries: ${entries.length} (latest first)`,
      data: { entries },
    };
  }

  private async clearAuditLog(): Promise<ToolResult> {
    const count = this.actionAuditLog.length;
    this.actionAuditLog = [];
    return {
      success: true,
      output: `Cleared ${count} audit entries`,
      data: { cleared: count },
    };
  }

  private async exportAuditLog(input: ComputerControlInput): Promise<ToolResult> {
    const now = new Date();
    const fileName = `computer-control-audit-${now.toISOString().replace(/[:.]/g, '-')}.json`;
    const outputPath = input.exportAuditPath
      ? path.resolve(input.exportAuditPath)
      : path.resolve('.codebuddy', 'audit', fileName);

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      JSON.stringify(
        {
          exportedAt: now.toISOString(),
          count: this.actionAuditLog.length,
          entries: this.actionAuditLog,
        },
        null,
        2
      ),
      'utf-8'
    );

    return {
      success: true,
      output: `Exported ${this.actionAuditLog.length} audit entries to ${outputPath}`,
      data: { path: outputPath, count: this.actionAuditLog.length },
    };
  }

  private async setPilotMode(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.pilotMode) {
      return { success: false, error: 'pilotMode is required (cautious|normal|fast)' };
    }
    if (!['cautious', 'normal', 'fast'].includes(input.pilotMode)) {
      return { success: false, error: 'Invalid pilotMode. Use cautious, normal, or fast.' };
    }

    this.pilotMode = input.pilotMode;
    return {
      success: true,
      output: `Pilot mode set to "${this.pilotMode}"`,
      data: { pilotMode: this.pilotMode },
    };
  }

  private async getPilotMode(): Promise<ToolResult> {
    return {
      success: true,
      output: `Current pilot mode: "${this.pilotMode}"`,
      data: { pilotMode: this.pilotMode },
    };
  }

  // ============================================================================
  // System Actions
  // ============================================================================

  private async getVolume(): Promise<ToolResult> {
    const volume = await this.systemControl.getVolume();

    return {
      success: true,
      output: `Volume: ${volume.level}%${volume.muted ? ' (muted)' : ''}`,
      data: volume,
    };
  }

  private async setVolume(input: ComputerControlInput): Promise<ToolResult> {
    if (input.level !== undefined) {
      await this.systemControl.setVolume(input.level);
    }
    if (input.muted !== undefined) {
      await this.systemControl.setMute(input.muted);
    }

    const volume = await this.systemControl.getVolume();

    return {
      success: true,
      output: `Volume set to: ${volume.level}%${volume.muted ? ' (muted)' : ''}`,
      data: volume,
    };
  }

  private async getBrightness(): Promise<ToolResult> {
    const brightness = await this.systemControl.getBrightness();

    return {
      success: true,
      output: `Brightness: ${brightness.level}%`,
      data: brightness,
    };
  }

  private async setBrightness(input: ComputerControlInput): Promise<ToolResult> {
    if (input.level === undefined) {
      return { success: false, error: 'Brightness level is required' };
    }

    await this.systemControl.setBrightness(input.level);
    const brightness = await this.systemControl.getBrightness();

    return {
      success: true,
      output: `Brightness set to: ${brightness.level}%`,
      data: brightness,
    };
  }

  private async sendNotification(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.title || !input.body) {
      return { success: false, error: 'Title and body are required' };
    }

    const result = await this.systemControl.notify({
      title: input.title,
      body: input.body,
    });

    return {
      success: result.sent,
      output: result.sent ? `Notification sent: "${input.title}"` : `Failed: ${result.error}`,
      data: result,
    };
  }

  private async lockScreen(): Promise<ToolResult> {
    await this.systemControl.lock();

    return {
      success: true,
      output: 'Screen locked',
    };
  }

  private async sleepSystem(): Promise<ToolResult> {
    await this.systemControl.sleep();

    return {
      success: true,
      output: 'System going to sleep',
    };
  }

  // ============================================================================
  // Recording Actions
  // ============================================================================

  private async startRecording(input: ComputerControlInput): Promise<ToolResult> {
    const recording = await this.screenRecorder.start({
      format: input.format || 'mp4',
      fps: input.fps || 30,
      audio: input.audio || false,
    });

    return {
      success: true,
      output: `Recording started: ${recording.outputPath}`,
      data: recording,
    };
  }

  private async stopRecording(): Promise<ToolResult> {
    const result = await this.screenRecorder.stop();

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      output: `Recording saved: ${result.outputPath} (${Math.round(result.duration || 0)}s, ${this.formatBytes(result.fileSize || 0)})`,
      data: result,
    };
  }

  private async getRecordingStatus(): Promise<ToolResult> {
    const status = this.screenRecorder.getStatus();

    if (!status) {
      return {
        success: true,
        output: 'No recording in progress',
        data: { recording: false },
      };
    }

    return {
      success: true,
      output: `Recording: ${status.state} - ${Math.round(status.duration)}s`,
      data: status,
    };
  }

  // ============================================================================
  // Info Actions
  // ============================================================================

  private async getSystemInfo(): Promise<ToolResult> {
    const info = await this.systemControl.getSystemInfo();

    const output = [
      `Hostname: ${info.hostname}`,
      `Platform: ${info.platform} (${info.arch})`,
      `Uptime: ${Math.round(info.uptime / 3600)} hours`,
      `CPU: ${info.cpu.model} (${info.cpu.cores} cores)`,
      `Memory: ${this.formatBytes(info.memory.used)} / ${this.formatBytes(info.memory.total)}`,
    ].join('\n');

    return {
      success: true,
      output,
      data: info,
    };
  }

  private async getBatteryInfo(): Promise<ToolResult> {
    const battery = await this.systemControl.getBattery();

    if (!battery.present) {
      return {
        success: true,
        output: 'No battery detected (desktop computer)',
        data: battery,
      };
    }

    return {
      success: true,
      output: `Battery: ${battery.level}%${battery.charging ? ' (charging)' : ''}`,
      data: battery,
    };
  }

  private async getNetworkInfo(): Promise<ToolResult> {
    const network = await this.systemControl.getNetworkStatus();

    if (!network.connected) {
      return {
        success: true,
        output: 'Network: Disconnected',
        data: network,
      };
    }

    const output = [
      `Network: Connected (${network.type})`,
      network.ip ? `IP: ${network.ip}` : '',
      network.gateway ? `Gateway: ${network.gateway}` : '',
      network.ssid ? `SSID: ${network.ssid}` : '',
    ].filter(Boolean).join('\n');

    return {
      success: true,
      output,
      data: network,
    };
  }

  private async checkPermission(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.permission) {
      return { success: false, error: 'Permission type is required' };
    }

    const result = await this.permissions.check(input.permission as PermissionType);
    const info = this.permissions.getInstructions(input.permission as PermissionType);

    return {
      success: true,
      output: `${result.message}${!result.granted && info.instructions ? `\n\nTo grant: ${info.instructions}` : ''}`,
      data: { ...result, instructions: info.instructions },
    };
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private async resolvePoint(input: ComputerControlInput): Promise<{ x: number; y: number; browserError?: string } | null> {
    // If ref is provided, use element center
    if (input.ref !== undefined) {
      const element = this.snapshotManager.getElement(input.ref);
      if (element) {
        // Check if this is a browser-sourced element with zero coordinates
        if (element.attributes?.source === 'browser-accessibility' &&
            element.center.x === 0 && element.center.y === 0) {
          return {
            x: 0, y: 0,
            browserError: `Element [${input.ref}] is a browser element (from accessibility tree). ` +
              `Use the browser tool with action=click and ref=${input.ref} instead of computer_control.`,
          };
        }
        return element.center;
      }
    }

    // If x,y are provided, use them directly
    if (input.x !== undefined && input.y !== undefined) {
      return { x: input.x, y: input.y };
    }

    return null;
  }

  /**
   * Translate technical errors into AI-friendly messages (OpenClaw-inspired)
   */
  private toAIFriendlyError(error: string, action: ComputerAction): string {
    const lower = error.toLowerCase();

    // Snapshot expired or invalid
    if (lower.includes('snapshot expired') || lower.includes('snapshot') && lower.includes('invalid')
        || lower.includes('no valid snapshot')) {
      return 'Take a new snapshot before interacting — the UI may have changed.';
    }

    // Element not found
    const elemMatch = error.match(/element\s*\[?(\d+)\]?\s*not found/i);
    if (elemMatch) {
      return `Element [${elemMatch[1]}] not found. Take a new snapshot to get updated refs.`;
    }
    if (lower.includes('not found') && lower.includes('element')) {
      return 'Element not found. Take a new snapshot to get updated refs.';
    }

    // Automation not initialized
    if (lower.includes('not initialized') || lower.includes('automation') && lower.includes('init')) {
      return 'Call snapshot first to initialize desktop automation.';
    }

    // Permission errors
    if (lower.includes('permission') || lower.includes('access denied') || lower.includes('not permitted')
        || lower.includes('eacces')) {
      const platform = process.platform;
      if (platform === 'darwin') {
        return `Permission denied. Grant accessibility access in System Preferences → Security & Privacy → Privacy → Accessibility.`;
      } else if (platform === 'linux') {
        return `Permission denied. Ensure AT-SPI is enabled and the user has accessibility permissions. Try: gsettings set org.gnome.desktop.interface toolkit-accessibility true`;
      }
      return `Permission denied for action "${action}". Check that the required accessibility/screen permissions are granted.`;
    }

    // Timeout errors
    if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('etimedout')) {
      return `Action "${action}" timed out. The element may not be interactable — try scrolling or closing overlays.`;
    }

    // Connection/process errors
    if (lower.includes('econnrefused') || lower.includes('enoent') || lower.includes('spawn')) {
      return `Failed to execute action "${action}". A required system tool may not be installed or available.`;
    }

    // Return original if no match
    return error;
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private hasWindowMatcher(input: ComputerControlInput): boolean {
    return Boolean(input.windowHandle || input.windowTitle || input.windowTitleRegex || input.processName);
  }

  private describeWindowMatcher(input: ComputerControlInput): string {
    const parts: string[] = [];
    if (input.windowHandle) parts.push(`handle "${input.windowHandle}"`);
    if (input.windowTitleRegex) parts.push(`title regex /${input.windowTitleRegex}/i`);
    if (input.windowTitle) parts.push(`title "${input.windowTitle}"`);
    if (input.windowTitleMatch) parts.push(`titleMatch "${input.windowTitleMatch}"`);
    if (input.processName) parts.push(`process "${input.processName}"`);
    if (input.processNameMatch) parts.push(`processMatch "${input.processNameMatch}"`);
    if (input.windowMatchStrategy) parts.push(`strategy "${input.windowMatchStrategy}"`);
    if (input.requireUniqueWindowMatch) parts.push('requireUnique=true');
    if (parts.length > 0) return parts.join(', ');
    return 'provided criteria';
  }

  private parseTitleRegex(input: ComputerControlInput): RegExp | null {
    if (!input.windowTitleRegex) return null;
    try {
      return new RegExp(input.windowTitleRegex, 'i');
    } catch {
      return null;
    }
  }

  private async findWindowFromInput(input: ComputerControlInput): Promise<WindowInfo | null> {
    const candidates = await this.findWindowCandidatesFromInput(input);
    const uniqueErr = this.buildUniqueWindowError(candidates, input);
    if (uniqueErr) {
      this.lastWindowMatchError = uniqueErr;
      return null;
    }
    return this.selectWindowCandidate(candidates, input);
  }

  private async findWindowCandidatesFromInput(input: ComputerControlInput): Promise<WindowInfo[]> {
    const regex = this.parseTitleRegex(input);
    if (input.windowTitleRegex && !regex) return [];

    // Handle can be combined with title/process constraints; validate all provided matchers.
    if (input.windowHandle) {
      const byHandle = await this.automation.getWindow(input.windowHandle);
      if (byHandle && this.matchesWindowInput(byHandle, input, regex)) {
        return [byHandle];
      }
      return [];
    }

    const wins = await this.automation.getWindows({ includeHidden: false });
    return wins.filter(w => this.matchesWindowInput(w, input, regex));
  }

  private async waitForWindowFromInput(input: ComputerControlInput): Promise<WindowInfo | null> {
    const timeout = Math.max(0, Math.min(120_000, Math.round(this.toFiniteNumber(input.timeoutMs, 10000))));
    const poll = Math.max(25, Math.min(5_000, Math.round(this.toFiniteNumber(input.pollIntervalMs, 250))));
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeout) {
      const candidates = await this.findWindowCandidatesFromInput(input);
      const uniqueErr = this.buildUniqueWindowError(candidates, input);
      if (uniqueErr) {
        this.lastWindowMatchError = uniqueErr;
        return null;
      }
      const win = this.selectWindowCandidate(candidates, input);
      if (win) {
        return win;
      }
      await this.delay(poll);
    }

    return null;
  }

  private async resolveWindowHandle(input: ComputerControlInput): Promise<string | null> {
    if (input.windowHandle) {
      return input.windowHandle;
    }

    const win = await this.findWindowFromInput(input);
    return win?.handle ?? null;
  }

  private matchesWindowInput(
    window: WindowInfo | null,
    input: ComputerControlInput,
    regex: RegExp | null
  ): boolean {
    if (!window) return false;

    if (
      input.processName &&
      !this.matchesString(window.processName, input.processName, input.processNameMatch ?? 'equals')
    ) {
      return false;
    }

    if (
      input.windowTitle &&
      !this.matchesString(window.title, input.windowTitle, input.windowTitleMatch ?? 'contains')
    ) {
      return false;
    }

    if (regex && !regex.test(window.title)) {
      return false;
    }

    return true;
  }

  private selectWindowCandidate(
    candidates: WindowInfo[],
    input: ComputerControlInput
  ): WindowInfo | null {
    return this.getRankedWindowCandidates(candidates, input)[0]?.window ?? null;
  }

  private matchesString(value: string, query: string, mode: 'contains' | 'equals'): boolean {
    const a = value.toLowerCase();
    const b = query.toLowerCase();
    return mode === 'equals' ? a === b : a.includes(b);
  }

  private toFiniteNumber(value: unknown, fallback: number): number;
  private toFiniteNumber(value: unknown, fallback: null): number | null;
  private toFiniteNumber(value: unknown, fallback: number | null): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return fallback;
  }

  private buildUniqueWindowError(candidates: WindowInfo[], input: ComputerControlInput): string | null {
    if (!input.requireUniqueWindowMatch || candidates.length <= 1) {
      return null;
    }

    const examples = candidates
      .slice(0, 5)
      .map(w => `"${w.title}" (${w.processName}, PID: ${w.pid}, handle: ${w.handle})`)
      .join('; ');

    return (
      `Multiple windows matched (${candidates.length}). Refine criteria or set requireUniqueWindowMatch=false. ` +
      `Candidates: ${examples}`
    );
  }

  private getRankedWindowCandidates(
    candidates: WindowInfo[],
    input: ComputerControlInput
  ): Array<{ window: WindowInfo; score: number; reasons: string[] }> {
    if (candidates.length === 0) return [];

    const strategy = input.windowMatchStrategy ?? 'first';
    const withIndex = candidates.map((w, idx) => ({ w, idx }));
    const maxArea = Math.max(
      ...withIndex.map(({ w }) => Math.max(0, w.bounds.width) * Math.max(0, w.bounds.height)),
      1
    );
    const maxPid = Math.max(...withIndex.map(({ w }) => w.pid), 1);

    const ranked = withIndex.map(({ w, idx }) => {
      let score = 0;
      const reasons: string[] = [];

      const area = Math.max(0, w.bounds.width) * Math.max(0, w.bounds.height);
      const areaNorm = area / maxArea;
      const pidNorm = w.pid / maxPid;

      if (input.windowTitle) {
        const mode = input.windowTitleMatch ?? 'contains';
        if (this.matchesString(w.title, input.windowTitle, mode)) {
          score += mode === 'equals' ? 40 : 20;
          reasons.push(mode === 'equals' ? 'title-exact' : 'title-contains');
        }
      }

      if (input.processName) {
        const mode = input.processNameMatch ?? 'equals';
        if (this.matchesString(w.processName, input.processName, mode)) {
          score += mode === 'equals' ? 30 : 15;
          reasons.push(mode === 'equals' ? 'process-exact' : 'process-contains');
        }
      }

      if (input.windowTitleRegex) {
        score += 20;
        reasons.push('title-regex');
      }

      if (w.focused) {
        score += 8;
        reasons.push('focused');
      }

      score += Math.round(areaNorm * 5);
      score += Math.round(pidNorm * 3);

      if (strategy === 'focused' && w.focused) {
        score += 100;
        reasons.push('strategy-focused');
      } else if (strategy === 'largest') {
        score += Math.round(areaNorm * 100);
        reasons.push('strategy-largest');
      } else if (strategy === 'newest') {
        score += Math.round(pidNorm * 100);
        reasons.push('strategy-newest');
      } else {
        score += Math.max(0, 100 - idx);
        reasons.push('strategy-first');
      }

      return { window: w, score, reasons };
    });

    ranked.sort((a, b) => b.score - a.score || a.window.pid - b.window.pid);
    return ranked;
  }

  private enforceSafetyPolicy(input: ComputerControlInput): string | null {
    const policy = this.resolveActionPolicy(input);
    if (policy === 'allow') return null;
    if (policy === 'block') {
      return `Action "${input.action}" is blocked by safety policy.`;
    }
    if (policy === 'confirm' && !input.confirmDangerous) {
      return (
        `Action "${input.action}" requires explicit confirmation. ` +
        `Set confirmDangerous=true to proceed intentionally.`
      );
    }
    return null;
  }

  private applyPilotDefaults(input: ComputerControlInput): ComputerControlInput {
    const mode = input.pilotMode ?? this.pilotMode;
    const out: ComputerControlInput = { ...input, pilotMode: mode };

    if (mode === 'cautious') {
      out.safetyProfile = out.safetyProfile ?? 'strict';
      out.requireUniqueWindowMatch = out.requireUniqueWindowMatch ?? true;
      out.windowMatchStrategy = out.windowMatchStrategy ?? 'focused';
    } else if (mode === 'fast') {
      out.safetyProfile = out.safetyProfile ?? 'balanced';
      out.requireUniqueWindowMatch = out.requireUniqueWindowMatch ?? false;
      out.windowMatchStrategy = out.windowMatchStrategy ?? 'newest';
    } else {
      out.safetyProfile = out.safetyProfile ?? 'balanced';
      out.windowMatchStrategy = out.windowMatchStrategy ?? 'first';
    }

    return out;
  }

  private isDangerousAction(action: ComputerAction, input: ComputerControlInput): boolean {
    const dangerous = new Set<ComputerAction>([
      'close_window',
      'lock',
      'sleep',
      'start_recording',
      'stop_recording',
      'set_window',
      'act_on_best_window',
      'export_audit_log',
    ]);

    if (!dangerous.has(action)) {
      return false;
    }

    if (action === 'act_on_best_window') {
      return ['close', 'set'].includes(input.bestWindowAction || '');
    }

    return true;
  }

  private resolveActionPolicy(input: ComputerControlInput): 'allow' | 'block' | 'confirm' {
    const override = input.policyOverrides?.[input.action];
    if (override === 'allow' || override === 'block' || override === 'confirm') {
      return override;
    }

    const profile = input.safetyProfile ?? 'balanced';
    if (profile === 'strict' && this.isDangerousAction(input.action, input)) {
      return 'confirm';
    }

    return 'allow';
  }

  private isMutatingAction(action: ComputerAction, input: ComputerControlInput): boolean {
    const mutating = new Set<ComputerAction>([
      'click', 'left_click', 'middle_click', 'double_click', 'right_click', 'move_mouse', 'drag', 'scroll',
      'type', 'key', 'key_down', 'key_up', 'hotkey',
      'focus_window', 'close_window', 'minimize_window', 'maximize_window', 'restore_window',
      'move_window', 'resize_window', 'set_window', 'act_on_best_window',
      'set_volume', 'set_brightness', 'notify', 'lock', 'sleep',
      'start_recording', 'stop_recording',
      'clear_audit_log',
    ]);

    if (action === 'act_on_best_window' && input.bestWindowAction) {
      return true;
    }

    return mutating.has(action);
  }

  private finalizeActionResult(
    action: ComputerAction,
    input: ComputerControlInput,
    result: ToolResult,
    startedAtMs: number,
    simulated: boolean
  ): ToolResult {
    const safetyProfile = input.safetyProfile ?? 'balanced';
    const entry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      action,
      success: Boolean(result.success),
      durationMs: Math.max(0, Date.now() - startedAtMs),
      safetyProfile,
      dangerous: this.isDangerousAction(action, input),
      simulated,
      error: result.success ? undefined : result.error,
    };

    this.actionAuditLog.push(entry);
    if (this.actionAuditLog.length > 1000) {
      this.actionAuditLog = this.actionAuditLog.slice(-1000);
    }

    return {
      ...result,
      data: {
        ...(result.data as Record<string, unknown> | undefined),
        audit: {
          id: entry.id,
          action: entry.action,
          success: entry.success,
          durationMs: entry.durationMs,
          safetyProfile: entry.safetyProfile,
          dangerous: entry.dangerous,
          simulated: entry.simulated,
        },
      },
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let computerControlInstance: ComputerControlTool | null = null;

export function getComputerControlTool(): ComputerControlTool {
  if (!computerControlInstance) {
    computerControlInstance = new ComputerControlTool();
  }
  return computerControlInstance;
}

export function resetComputerControlTool(): void {
  computerControlInstance = null;
}

export default ComputerControlTool;
