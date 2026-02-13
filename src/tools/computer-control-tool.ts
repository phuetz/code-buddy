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
  | 'double_click'
  | 'right_click'
  | 'move_mouse'
  | 'drag'
  | 'scroll'
  // Keyboard actions
  | 'type'
  | 'key'
  | 'hotkey'
  // Window actions
  | 'get_windows'
  | 'focus_window'
  | 'close_window'
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
  // Snapshot params
  interactiveOnly?: boolean;
  // Element params
  ref?: number;
  role?: string;
  name?: string;
  // Mouse params
  x?: number;
  y?: number;
  button?: 'left' | 'right' | 'middle';
  duration?: number;
  // Keyboard params
  text?: string;
  key?: string;
  modifiers?: string[];
  // Scroll params
  deltaX?: number;
  deltaY?: number;
  // Window params
  windowTitle?: string;
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
  private permissions = getPermissionManager();
  private systemControl = getSystemControl();
  private snapshotManager = getSmartSnapshotManager();
  private screenRecorder = getScreenRecorder();

  /**
   * Execute a computer control action
   */
  async execute(input: ComputerControlInput): Promise<ToolResult> {
    const { action } = input;

    logger.debug('Computer control action', { action, input });

    try {
      switch (action) {
        // Snapshot actions
        case 'snapshot':
          return this.takeSnapshot(input);
        case 'snapshot_with_screenshot':
          return this.snapshotWithScreenshot(input);
        case 'get_element':
          return this.getElement(input);
        case 'find_elements':
          return this.findElements(input);

        // Mouse actions
        case 'click':
          return this.click(input);
        case 'double_click':
          return this.doubleClick(input);
        case 'right_click':
          return this.rightClick(input);
        case 'move_mouse':
          return this.moveMouse(input);
        case 'drag':
          return this.drag(input);
        case 'scroll':
          return this.scroll(input);

        // Keyboard actions
        case 'type':
          return this.typeText(input);
        case 'key':
          return this.pressKey(input);
        case 'hotkey':
          return this.hotkey(input);

        // Window actions
        case 'get_windows':
          return this.getWindows();
        case 'focus_window':
          return this.focusWindow(input);
        case 'close_window':
          return this.closeWindow(input);

        // System actions
        case 'get_volume':
          return this.getVolume();
        case 'set_volume':
          return this.setVolume(input);
        case 'get_brightness':
          return this.getBrightness();
        case 'set_brightness':
          return this.setBrightness(input);
        case 'notify':
          return this.sendNotification(input);
        case 'lock':
          return this.lockScreen();
        case 'sleep':
          return this.sleepSystem();

        // Recording actions
        case 'start_recording':
          return this.startRecording(input);
        case 'stop_recording':
          return this.stopRecording();
        case 'recording_status':
          return this.getRecordingStatus();

        // Info actions
        case 'system_info':
          return this.getSystemInfo();
        case 'battery_info':
          return this.getBatteryInfo();
        case 'network_info':
          return this.getNetworkInfo();
        case 'check_permission':
          return this.checkPermission(input);

        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Computer control error', { action, error: errorMessage });
      return {
        success: false,
        error: this.toAIFriendlyError(errorMessage, action),
      };
    }
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
      role: input.role as any,
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
    await this.automation.scroll({
      deltaX: input.deltaX || 0,
      deltaY: input.deltaY || -3, // Default scroll down
    });

    return {
      success: true,
      output: `Scrolled (${input.deltaX || 0}, ${input.deltaY || -3})`,
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
      modifiers: input.modifiers as any,
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
    const keys: string[] = [...(input.modifiers || []), input.key];
    await this.automation.hotkey(...(keys as any));

    return {
      success: true,
      output: `Hotkey: ${input.modifiers?.length ? input.modifiers.join('+') + '+' : ''}${input.key}`,
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

  private async focusWindow(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.windowTitle) {
      return { success: false, error: 'Window title is required' };
    }

    const windows = await this.automation.getWindows({ title: input.windowTitle });
    if (windows.length === 0) {
      return { success: false, error: `No window found matching: ${input.windowTitle}` };
    }

    await this.automation.focusWindow(windows[0].handle);

    return {
      success: true,
      output: `Focused window: "${windows[0].title}"`,
    };
  }

  private async closeWindow(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.windowTitle) {
      return { success: false, error: 'Window title is required' };
    }

    const windows = await this.automation.getWindows({ title: input.windowTitle });
    if (windows.length === 0) {
      return { success: false, error: `No window found matching: ${input.windowTitle}` };
    }

    await this.automation.closeWindow(windows[0].handle);

    return {
      success: true,
      output: `Closed window: "${windows[0].title}"`,
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

    const result = await this.permissions.check(input.permission as any);
    const info = this.permissions.getInstructions(input.permission as any);

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
