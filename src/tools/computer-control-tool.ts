/**
 * Computer Control Tool
 *
 * Enterprise-grade unified interface for AI agents to control the computer.
 * Integrates:
 * - Smart Snapshot for element detection
 * - Mouse/keyboard automation
 * - System control (volume, brightness)
 * - Screen recording
 * - Permission management
 */

import { ToolResult } from '../types/index.js';
import { execFile } from 'child_process';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import {
  buildComputerControlHarnessBundle,
  buildComputerControlProofArtifact,
  type ComputerControlAuditEntry,
} from './computer-control-harness.js';
import {
  listApplicationProfiles,
  resolveApplicationProfile,
  type ApplicationProfile,
} from './application-profiles.js';
import { getActiveRunStore } from '../observability/run-store.js';
import { getPermissionModeManager } from '../security/permission-modes.js';
import { logger } from '../utils/logger.js';
import {
  getDesktopAutomation,
  getPermissionManager,
  getSystemControl,
  getSmartSnapshotManager,
  getScreenRecorder,
  type UIElement,
  type ElementRole,
  type ModifierKey,
  type KeyCode,
  type PermissionType,
  type WindowInfo,
} from '../desktop-automation/index.js';
import { OmniParserRunner } from "../desktop-automation/omniparser-runner.js";

const execFileAsync = promisify(execFile);

// ============================================================================
// Vision Grounding Fallback (Set-of-Marks)
// ============================================================================

export interface VisionGroundingRequest {
  imageBase64: string;
  intent: string;
  roleHint?: string;
  candidates: { ref: number; role: string; name: string }[];
}

export type VisionGroundingProvider = (req: VisionGroundingRequest) => Promise<number | { x: number; y: number } | null>;

let visionGroundingProvider: VisionGroundingProvider | null = null;

export function setVisionGroundingProvider(p: VisionGroundingProvider | null): void {
  visionGroundingProvider = p;
}

/**
 * Convert a vision-grounding result expressed in the normalised 0–1000 space to
 * absolute screen pixels. Returns null for non-finite or out-of-contract values
 * so a misbehaving grounding provider (e.g. a model emitting `1200` or `NaN`)
 * can never be turned into an off-screen or invalid click target.
 */
export function resolveGroundingCoordinatesToAbsolute(
  rel: { x: number; y: number },
  screenSize?: { width?: number; height?: number },
): { x: number; y: number } | null {
  const { x, y } = rel;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || x > 1000 || y < 0 || y > 1000) return null;
  const width = screenSize?.width && screenSize.width > 0 ? screenSize.width : 1920;
  const height = screenSize?.height && screenSize.height > 0 ? screenSize.height : 1080;
  return {
    x: Math.round((x / 1000) * width),
    y: Math.round((y / 1000) * height),
  };
}

// ============================================================================
// Types
// ============================================================================

export type ComputerAction =
  // Snapshot actions
  | 'snapshot'
  | 'snapshot_with_screenshot'
  | 'get_element'
  | 'find_elements'
  | 'click_element_by_name'
  | 'click_button'
  | 'click_link'
  | 'fill_text_field'
  | 'clear_and_type'
  | 'select_dropdown_option'
  | 'select_radio'
  | 'activate_tab'
  | 'select_list_item'
  | 'open_menu_item'
  | 'toggle_checkbox'
  | 'set_slider_value'
  | 'select_tree_item'
  | 'expand_tree_item'
  | 'collapse_tree_item'
  | 'assert_text_visible'
  | 'assert_element_visible'
  | 'inspect_dialog'
  | 'click_dialog_button'
  | 'handle_dialog'
  | 'list_app_profiles'
  | 'get_app_profile'
  | 'open_app'
  | 'focus_app'
  | 'read_app_text'
  | 'save_app_document'
  | 'excel_open_workbook'
  | 'excel_set_cell'
  | 'excel_get_cell'
  | 'excel_save_workbook'
  | 'powerpoint_open_presentation'
  | 'powerpoint_add_slide'
  | 'powerpoint_set_text'
  | 'powerpoint_save_presentation'
  | 'word_open_document'
  | 'word_type_text'
  | 'word_save_document'
  | 'use_app_workflow'
  | 'macro'
  | 'click_text'
  | 'save_macro'
  | 'play_macro'
  | 'list_macros'
  | 'delete_macro'
  | 'wait_for_text'
  | 'speak'
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
  useOmniParser?: boolean;
  // Element params
  ref?: number;
  role?: string;
  name?: string;
  appName?: string;
  filePath?: string;
  saveAsPath?: string;
  sheetName?: string;
  cell?: string;
  value?: string | number | boolean | null;
  slideIndex?: number;
  shapeIndex?: number;
  layoutIndex?: number;
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
  clearFirst?: boolean;
  option?: string;
  checked?: boolean;
  expanded?: boolean;
  exactName?: boolean;
  visualContext?: boolean;
  dialogIntent?: 'accept' | 'cancel' | 'save' | 'dont_save' | 'discard' | 'retry' | 'continue' | 'close' | 'yes' | 'no' | 'ok' | 'custom';
  dialogText?: string;
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
  // Macro params
  steps?: ComputerControlInput[];
  macroName?: string;
  macroDescription?: string;
  // OCR params
}

interface TargetFocusProof {
  focused?: Pick<WindowInfo, 'handle' | 'title' | 'pid' | 'processName'>;
  foreground?: Pick<WindowInfo, 'handle' | 'title' | 'pid' | 'processName'>;
  matched?: Pick<WindowInfo, 'handle' | 'title' | 'pid' | 'processName'>;
  verifiedBy: 'window-list' | 'foreground-window' | 'foreground-title-correlation';
}

interface VisualContextProof {
  screenshotPath?: string;
  ocrText?: string;
  ocrError?: string;
  snapshotText?: string;
  snapshotError?: string;
}

type DialogButtonRisk = 'safe' | 'caution' | 'destructive';

interface DialogButtonEvidence {
  name: string;
  role: string;
  enabled: boolean;
  risk: DialogButtonRisk;
  bounds?: { x: number; y: number; width: number; height: number };
  ref?: number;
}

interface DialogInspection {
  source: 'snapshot' | 'windows-uia';
  title: string;
  processName?: string;
  pid?: number;
  text: string[];
  buttons: DialogButtonEvidence[];
  suggestedButton?: DialogButtonEvidence;
  suggestionReason?: string;
  clickedButton?: DialogButtonEvidence;
  clickSource?: string;
}

interface AppTextReadResult {
  success: true;
  text: string;
  source: string;
  role?: string;
  name?: string;
  windowTitle: string;
  processName?: string;
  pid?: number;
}

// ============================================================================
// Computer Control Tool
// ============================================================================

export class ComputerControlTool {
  private automation = getDesktopAutomation();
  private automationInitialized = false;
  private lastWindowMatchError: string | null = null;
  private pilotMode: 'cautious' | 'normal' | 'fast' = 'normal';
  private actionAuditLog: ComputerControlAuditEntry[] = [];
  private permissions = getPermissionManager();
  private systemControl = getSystemControl();
  private snapshotManager = getSmartSnapshotManager();
  private screenRecorder = getScreenRecorder();
  private omniParser = new OmniParserRunner();
  private lastTargetFocusProof: TargetFocusProof | null = null;
  private lastVisualContextProof: VisualContextProof | null = null;

  /**
   * Execute a computer control action
   */
  async execute(input: ComputerControlInput): Promise<ToolResult> {
    const enrichedInput = this.applyPilotDefaults(input);
    const { action } = enrichedInput;
    this.lastWindowMatchError = null;
    this.lastTargetFocusProof = null;
    this.lastVisualContextProof = null;
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
        case 'click_element_by_name':
          return run(() => this.clickElementByName(enrichedInput));
        case 'click_button':
          return run(() => this.clickNamedRole(enrichedInput, ['button'], 'click_button', 'Clicked button'));
        case 'click_link':
          return run(() => this.clickNamedRole(enrichedInput, ['link'], 'click_link', 'Clicked link'));
        case 'fill_text_field':
          return run(() => this.fillTextField(enrichedInput));
        case 'clear_and_type':
          return run(() => this.clearAndType(enrichedInput));
        case 'select_dropdown_option':
          return run(() => this.selectDropdownOption(enrichedInput));
        case 'select_radio':
          return run(() => this.clickNamedRole(enrichedInput, ['radio'], 'select_radio', 'Selected radio'));
        case 'activate_tab':
          return run(() => this.clickNamedRole(enrichedInput, ['tab'], 'activate_tab', 'Activated tab'));
        case 'select_list_item':
          return run(() => this.clickNamedRole(enrichedInput, ['list-item'], 'select_list_item', 'Selected list item'));
        case 'open_menu_item':
          return run(() => this.clickNamedRole(enrichedInput, ['menu-item', 'menu'], 'open_menu_item', 'Opened menu item'));
        case 'toggle_checkbox':
          return run(() => this.toggleCheckbox(enrichedInput));
        case 'set_slider_value':
          return run(() => this.setSliderValue(enrichedInput));
        case 'select_tree_item':
          return run(() => this.clickNamedRole(enrichedInput, ['tree-item'], 'select_tree_item', 'Selected tree item'));
        case 'expand_tree_item':
          return run(() => this.setTreeItemExpansion(enrichedInput, true));
        case 'collapse_tree_item':
          return run(() => this.setTreeItemExpansion(enrichedInput, false));
        case 'assert_text_visible':
          return run(() => this.assertTextVisible(enrichedInput));
        case 'assert_element_visible':
          return run(() => this.assertElementVisible(enrichedInput));
        case 'inspect_dialog':
          return run(() => this.inspectDialog(enrichedInput));
        case 'click_dialog_button':
          return run(() => this.clickDialogButton(enrichedInput));
        case 'handle_dialog':
          return run(() => this.handleDialog(enrichedInput));
        case 'list_app_profiles':
          return run(() => this.listAppProfiles());
        case 'get_app_profile':
          return run(() => this.getAppProfile(enrichedInput));
        case 'open_app':
          return run(() => this.openApp(enrichedInput));
        case 'focus_app':
          return run(() => this.focusApp(enrichedInput));
        case 'read_app_text':
          return run(() => this.readAppText(enrichedInput));
        case 'save_app_document':
          return run(() => this.saveAppDocument(enrichedInput));
        case 'excel_open_workbook':
          return run(() => this.excelOpenWorkbook(enrichedInput));
        case 'excel_set_cell':
          return run(() => this.excelSetCell(enrichedInput));
        case 'excel_get_cell':
          return run(() => this.excelGetCell(enrichedInput));
        case 'excel_save_workbook':
          return run(() => this.excelSaveWorkbook(enrichedInput));
        case 'powerpoint_open_presentation':
          return run(() => this.powerpointOpenPresentation(enrichedInput));
        case 'powerpoint_add_slide':
          return run(() => this.powerpointAddSlide(enrichedInput));
        case 'powerpoint_set_text':
          return run(() => this.powerpointSetText(enrichedInput));
        case 'powerpoint_save_presentation':
          return run(() => this.powerpointSavePresentation(enrichedInput));
        case 'word_open_document':
          return run(() => this.wordOpenDocument(enrichedInput));
        case 'word_type_text':
          return run(() => this.wordTypeText(enrichedInput));
        case 'word_save_document':
          return run(() => this.wordSaveDocument(enrichedInput));
        case 'use_app_workflow':
        case 'macro':
          return run(() => this.executeMacro(enrichedInput));
        case 'click_text':
          return run(() => this.clickText(enrichedInput));
        case 'save_macro':
          return run(() => this.saveMacro(enrichedInput));
        case 'play_macro':
          return run(() => this.playMacro(enrichedInput));
        case 'list_macros':
          return run(() => this.listMacros());
        case 'delete_macro':
          return run(() => this.deleteMacro(enrichedInput));
        case 'wait_for_text':
          return run(() => this.waitForText(enrichedInput));
        case 'speak':
          return run(() => this.speakText(enrichedInput));

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
      
      // Phase 7: Rétroaction Vocale sur Erreur
      try {
        const { exec } = await import('child_process');
        const script = `Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Speak("Patrice, j'ai rencontré une erreur inattendue sur l'action ${action.replace(/_/g, ' ')}")`;
        exec(`powershell -NoProfile -Command "${script}"`); // fire and forget
      } catch (e) {
        logger.debug('Failed to speak error', { error: e });
      }
      
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
      'click_element_by_name',
      'click_button',
      'click_link',
      'fill_text_field',
      'clear_and_type',
      'select_dropdown_option',
      'select_radio',
      'activate_tab',
      'select_list_item',
      'open_menu_item',
      'toggle_checkbox',
      'set_slider_value',
      'select_tree_item',
      'expand_tree_item',
      'collapse_tree_item',
      'assert_text_visible',
      'assert_element_visible',
      'inspect_dialog',
      'click_dialog_button',
      'handle_dialog',
      'focus_app',
      'read_app_text',
      'save_app_document',
      'use_app_workflow',
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
      'macro',
      'click_text',
      'play_macro',
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
    if (this.hasWindowMatcher(input)) {
      const focusResult = await this.focusWindow(input);
      if (!focusResult.success) return focusResult;
      await this.delay(150);
    }

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
    if (this.hasWindowMatcher(input)) {
      const focusResult = await this.focusWindow(input);
      if (!focusResult.success) return focusResult;
      await this.delay(150);
    }

    // Take snapshot first
    const snapshot = await this.snapshotManager.takeSnapshot({
      interactiveOnly: input.interactiveOnly ?? true,
    });

    let textRepresentation = this.snapshotManager.toTextRepresentation(snapshot);

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

    // Apply OmniParser if requested and screenshot was successful
    if (input.useOmniParser && screenshotData.base64) {
      const omniResult = await this.omniParser.parseScreen(screenshotData.base64, {
        width: screenshotData.width,
        height: screenshotData.height,
      });

      if (omniResult.elements.length > 0) {
        // Override screenshot with the annotated (Set-of-Marks) image whose numbers match the ids below.
        screenshotData.base64 = omniResult.annotatedImageBase64;

        const unit = omniResult.elements[0]?.normalized ? 'ratio 0-1' : 'px';
        const parsedText = omniResult.elements
          .map(
            (e) =>
              `[${e.id}] ${e.type}${e.interactable ? ' (interactive)' : ''} "${e.content}" center=(${e.center[0]},${e.center[1]})`,
          )
          .join('\n');
        textRepresentation += `\n\n[OmniParser Elements] (coords in ${unit}; use 'click' at an element center to act):\n${parsedText}`;
      } else {
        // No elements => server down/misconfigured or empty parse. Keep the original snapshot, don't add noise.
        logger.debug('OmniParser returned no elements; keeping original screenshot and snapshot text');
      }
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

  private async clickElementByName(input: ComputerControlInput): Promise<ToolResult> {
    const match = await this.resolveElementForIntent(input, {
      roles: input.role ? [input.role as ElementRole] : undefined,
      query: input.name ?? input.text,
      intent: 'click_element_by_name',
      requireInteractive: input.interactiveOnly ?? true,
      exactName: input.exactName,
    });
    if (!match.element) {
      const direct = await this.tryWindowsActivateNamedRole(
        input,
        ['checkbox'],
        input.checked === undefined
          ? 'Toggled checkbox'
          : `Set checkbox to ${input.checked ? 'checked' : 'unchecked'}`
      );
      if (direct.success) return direct;
      return {
        success: false,
        error: `${match.error} UIAutomation fallback: ${direct.error ?? direct.output ?? 'unavailable'}`,
      };
    }

    const clicked = await this.click({ ...input, ref: match.element.ref });
    if (!clicked.success) return clicked;

    return {
      success: true,
      output: `Clicked ${this.describeElement(match.element)}`,
      data: { element: match.element, refreshedSnapshot: match.refreshed },
    };
  }

  private async clickNamedRole(
    input: ComputerControlInput,
    roles: ElementRole[],
    intent: string,
    successVerb: string,
  ): Promise<ToolResult> {
    if (this.hasWindowMatcher(input)) {
      const direct = await this.tryWindowsActivateNamedRole(input, roles, successVerb);
      if (direct.success) return direct;
    }

    const match = await this.resolveElementForIntent(input, {
      roles,
      query: input.name ?? input.text,
      intent,
      requireInteractive: true,
      exactName: input.exactName,
    });
    if (!match.element) return { success: false, error: match.error };

    const clicked = await this.click({ ...input, ref: match.element.ref });
    if (!clicked.success) return clicked;

    return {
      success: true,
      output: `${successVerb} ${this.describeElement(match.element)}`,
      data: { element: match.element, refreshedSnapshot: match.refreshed },
    };
  }

  private async fillTextField(input: ComputerControlInput): Promise<ToolResult> {
    if (input.text === undefined) {
      return { success: false, error: 'text is required for fill_text_field action' };
    }

    const match = await this.resolveElementForIntent(input, {
      roles: ['text-field'],
      associatedRoles: ['text-field'],
      query: input.name,
      intent: 'fill_text_field',
      requireInteractive: true,
      exactName: input.exactName,
    });
    if (!match.element) {
      const direct = await this.tryWindowsSetFocusedText(input, input.text);
      if (direct.success) {
        return {
          ...direct,
          output: `${direct.output} (targeted UIAutomation fallback used after snapshot lookup failed)`,
        };
      }
      return { success: false, error: match.error };
    }

    const clicked = await this.click({ ...input, ref: match.element.ref });
    if (!clicked.success) return clicked;

    if (input.clearFirst ?? true) {
      await this.selectFocusedText();
    }

    await this.automation.type(input.text, { delay: 30 });

    return {
      success: true,
      output: `Filled ${this.describeElement(match.element)} with ${input.text.length} character(s)`,
      data: {
        element: match.element,
        textLength: input.text.length,
        cleared: input.clearFirst ?? true,
        refreshedSnapshot: match.refreshed,
      },
    };
  }

  private async clearAndType(input: ComputerControlInput): Promise<ToolResult> {
    if (input.text === undefined) {
      return { success: false, error: 'text is required for clear_and_type action' };
    }

    let element: UIElement | undefined;
    let refreshed = false;

    if (input.ref !== undefined || input.name) {
      const match = await this.resolveElementForIntent(input, {
        roles: input.role ? [input.role as ElementRole] : ['text-field'],
        associatedRoles: input.role ? [input.role as ElementRole] : ['text-field'],
        query: input.name,
        intent: 'clear_and_type',
        requireInteractive: true,
        exactName: input.exactName,
      });
      if (!match.element) return { success: false, error: match.error };
      element = match.element;
      refreshed = match.refreshed;

      const clicked = await this.click({ ...input, ref: element.ref });
      if (!clicked.success) return clicked;
    } else if (this.hasWindowMatcher(input)) {
      const focusError = await this.focusAndVerifyTarget(input);
      if (focusError) {
        const direct = await this.tryWindowsSetFocusedText(input, input.text);
        if (direct.success) {
          return {
            ...direct,
            output: `${direct.output} (targeted UIAutomation path used after foreground verification failed)`,
            data: {
              ...(direct.data as Record<string, unknown> | undefined),
              targetFocusWarning: focusError.error,
              globalKeyboardFallbackUsed: false,
            },
          };
        }
        return focusError;
      }
      const direct = await this.tryWindowsSetFocusedText(input, input.text);
      if (direct.success) return direct;
      return {
        success: false,
        error: `Refusing fallback typing because targeted text entry could not be verified: ${direct.error ?? 'unknown UIAutomation failure'}`,
      };
    }

    await this.selectFocusedText();
    await this.automation.type(input.text, { delay: 30 });

    return {
      success: true,
      output: element
        ? `Cleared and typed into ${this.describeElement(element)}`
        : `Cleared current focus and typed ${input.text.length} character(s)`,
      data: {
        element,
        textLength: input.text.length,
        refreshedSnapshot: refreshed,
        ...this.buildTargetProofData(),
      },
    };
  }

  private async selectDropdownOption(input: ComputerControlInput): Promise<ToolResult> {
    const option = input.option ?? input.text;
    if (!option) {
      return { success: false, error: 'option or text is required for select_dropdown_option action' };
    }

    if (this.hasWindowMatcher(input)) {
      const focusResult = await this.focusWindow(input);
      if (!focusResult.success) return focusResult;
      await this.delay(100);
    }

    const direct = await this.tryWindowsSelectDropdownOption(input, option);
    if (direct.success) return direct;

    if (input.ref !== undefined || input.name) {
      const dropdown = await this.resolveElementForIntent(input, {
        roles: ['dropdown'],
        associatedRoles: ['dropdown', 'text', 'container'],
        query: input.name,
        intent: 'select_dropdown_option',
        requireInteractive: true,
        exactName: input.exactName,
      });
      if (!dropdown.element) return { success: false, error: dropdown.error };

      const opened = await this.click({ ...input, ref: dropdown.element.ref });
      if (!opened.success) return opened;
      await this.automation.keyPress('down', { modifiers: ['alt'] });
      await this.delay(150);
    }

    const optionMatch = await this.resolveElementForIntent(
      { ...input, name: option, ref: undefined },
      {
        roles: ['list-item', 'menu-item', 'button', 'text', 'dropdown', 'container'],
        query: option,
        intent: 'select_dropdown_option option',
        requireInteractive: false,
        exactName: input.exactName,
        forceRefresh: true,
      },
    );

    if (optionMatch.element) {
      const selected = await this.click({ ...input, ref: optionMatch.element.ref });
      if (!selected.success) return selected;
      return {
        success: true,
        output: `Selected option "${option}" via ${this.describeElement(optionMatch.element)}`,
        data: { option, element: optionMatch.element, source: 'snapshot' },
      };
    }

    try {
      const firstKey = option.trim().charAt(0);
      if (firstKey) {
        await this.automation.keyPress(firstKey);
        await this.delay(100);
      }
      await this.delay(100);
      await this.automation.keyPress('enter');
      return {
        success: true,
        output: `Selected option "${option}" via keyboard fallback`,
        data: { option, source: 'keyboard' },
      };
    } catch (err) {
      logger.debug('Dropdown keyboard fallback failed, trying OCR', {
        option,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const clickedText = await this.clickText({ ...input, text: option });
    if (!clickedText.success) return clickedText;

    return {
      success: true,
      output: `Selected option "${option}" via OCR text match`,
      data: { option, source: 'ocr', click: clickedText.data },
    };
  }

  private async toggleCheckbox(input: ComputerControlInput): Promise<ToolResult> {
    const match = await this.resolveElementForIntent(input, {
      roles: ['checkbox'],
      query: input.name ?? input.text,
      intent: 'toggle_checkbox',
      requireInteractive: true,
      exactName: input.exactName,
    });
    if (!match.element) {
      const direct = await this.tryWindowsActivateNamedRole(
        input,
        ['checkbox'],
        input.checked === undefined
          ? 'Toggled checkbox'
          : `Set checkbox to ${input.checked ? 'checked' : 'unchecked'}`
      );
      if (direct.success) return direct;
      return {
        success: false,
        error: `${match.error} UIAutomation fallback: ${direct.error ?? direct.output ?? 'unavailable'}`,
      };
    }

    const currentState = this.getElementCheckedState(match.element);
    if (input.checked !== undefined && currentState === input.checked) {
      return {
        success: true,
        output: `${this.describeElement(match.element)} already ${input.checked ? 'checked' : 'unchecked'}`,
        data: { element: match.element, checked: currentState, changed: false },
      };
    }

    const clicked = await this.click({ ...input, ref: match.element.ref });
    if (!clicked.success) return clicked;

    return {
      success: true,
      output: input.checked === undefined
        ? `Toggled ${this.describeElement(match.element)}`
        : `Set ${this.describeElement(match.element)} to ${input.checked ? 'checked' : 'unchecked'}`,
      data: {
        element: match.element,
        previousChecked: currentState,
        requestedChecked: input.checked,
        changed: true,
      },
    };
  }

  private async setSliderValue(input: ComputerControlInput): Promise<ToolResult> {
    const value = this.parseNumericControlValue(input, 'set_slider_value');
    if (value === undefined) {
      return { success: false, error: 'value or level is required for set_slider_value action' };
    }

    const direct = await this.tryWindowsSetRangeValue(input, value);
    if (direct.success) return direct;

    const match = await this.resolveElementForIntent(input, {
      roles: ['slider'],
      query: input.name ?? input.text,
      intent: 'set_slider_value',
      requireInteractive: true,
      exactName: input.exactName,
    });
    if (!match.element) return { success: false, error: match.error };

    const min = this.getNumericAttribute(match.element, ['minimum', 'min', 'rangeMinimum']) ?? 0;
    const max = this.getNumericAttribute(match.element, ['maximum', 'max', 'rangeMaximum']) ?? 100;
    const boundedValue = Math.min(max, Math.max(min, value));
    const span = Math.max(1, max - min);
    const ratio = (boundedValue - min) / span;
    const x = Math.round(match.element.bounds.x + Math.max(1, match.element.bounds.width) * ratio);
    const y = Math.round(match.element.center.y);

    await this.automation.click(x, y, { button: 'left' });

    return {
      success: true,
      output: `Set ${this.describeElement(match.element)} to ${boundedValue} via slider coordinate`,
      data: {
        element: match.element,
        requestedValue: value,
        appliedValue: boundedValue,
        min,
        max,
        source: 'snapshot-coordinate',
      },
    };
  }

  private async setTreeItemExpansion(input: ComputerControlInput, expanded: boolean): Promise<ToolResult> {
    const direct = await this.tryWindowsSetTreeItemExpansion(input, expanded);
    if (direct.success) return direct;

    const match = await this.resolveElementForIntent(input, {
      roles: ['tree-item'],
      query: input.name ?? input.text,
      intent: expanded ? 'expand_tree_item' : 'collapse_tree_item',
      requireInteractive: true,
      exactName: input.exactName,
    });
    if (!match.element) return { success: false, error: match.error };

    const currentExpanded = this.getElementExpandedState(match.element);
    if (currentExpanded === expanded) {
      return {
        success: true,
        output: `${this.describeElement(match.element)} already ${expanded ? 'expanded' : 'collapsed'}`,
        data: { element: match.element, expanded: currentExpanded, changed: false },
      };
    }

    const x = Math.round(match.element.bounds.x + Math.min(14, Math.max(4, match.element.bounds.width / 4)));
    const y = Math.round(match.element.center.y);
    await this.automation.click(x, y, { button: 'left' });

    return {
      success: true,
      output: `${expanded ? 'Expanded' : 'Collapsed'} ${this.describeElement(match.element)} via tree expander coordinate`,
      data: {
        element: match.element,
        previousExpanded: currentExpanded,
        requestedExpanded: expanded,
        source: 'snapshot-coordinate',
      },
    };
  }

  private async assertTextVisible(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.text) {
      return { success: false, error: 'text is required for assert_text_visible action' };
    }

    const match = await this.resolveElementForIntent(input, {
      query: input.text,
      intent: 'assert_text_visible',
      requireInteractive: false,
      exactName: input.exactName,
      forceRefresh: !this.snapshotManager.getCurrentSnapshot(),
    });

    if (match.element) {
      return {
        success: true,
        output: `Text "${input.text}" is visible in ${this.describeElement(match.element)}`,
        data: { text: input.text, element: match.element, source: 'snapshot' },
      };
    }

    const timeoutMs = input.timeoutMs ?? 1;
    const ocrResult = await this.waitForText({ ...input, timeoutMs, pollIntervalMs: Math.min(timeoutMs, 250) });
    if (ocrResult.success) {
      return {
        success: true,
        output: `Text "${input.text}" is visible`,
        data: { text: input.text, source: (ocrResult.data as { source?: string } | undefined)?.source ?? 'ocr' },
      };
    }

    return {
      success: false,
      error: `Text "${input.text}" is not visible in the current desktop state.`,
    };
  }

  private async assertElementVisible(input: ComputerControlInput): Promise<ToolResult> {
    const match = await this.resolveElementForIntent(input, {
      roles: input.role ? [input.role as ElementRole] : undefined,
      query: input.name ?? input.text,
      intent: 'assert_element_visible',
      requireInteractive: false,
      exactName: input.exactName,
      forceRefresh: !this.snapshotManager.getCurrentSnapshot(),
    });

    if (!match.element) return { success: false, error: match.error };

    return {
      success: true,
      output: `Element is visible: ${this.describeElement(match.element)}`,
      data: { element: match.element, refreshedSnapshot: match.refreshed },
    };
  }

  private async inspectDialog(input: ComputerControlInput): Promise<ToolResult> {
    const inspection = await this.getDialogInspection(input);
    if (!inspection) {
      return {
        success: false,
        error: 'No actionable dialog was detected. Try snapshot_with_screenshot or provide windowTitle/processName.',
      };
    }

    return {
      success: true,
      output: this.formatDialogInspection(inspection),
      data: { dialog: inspection },
    };
  }

  private async clickDialogButton(input: ComputerControlInput): Promise<ToolResult> {
    const inspection = await this.getDialogInspection(input);
    if (!inspection) {
      return {
        success: false,
        error: 'No actionable dialog was detected. Refusing to click without dialog evidence.',
      };
    }

    const selection = this.selectDialogButton(inspection, input, { allowSafeDefault: false });
    if (!selection) {
      return {
        success: false,
        error: `No dialog button matched the requested choice. Available: ${inspection.buttons.map((button) => `"${button.name}"`).join(', ') || 'none'}.`,
        data: { dialog: inspection },
      };
    }

    if (selection.button.risk !== 'safe' && !input.confirmDangerous) {
      return {
        success: false,
        error: (
          `Dialog button "${selection.button.name}" is ${selection.button.risk}. ` +
          'Use inspect_dialog first, or set confirmDangerous=true when this is the intended action.'
        ),
        data: { dialog: inspection, selectedButton: selection.button, reason: selection.reason },
      };
    }

    let clickedInspection: DialogInspection | null = null;
    if (inspection.source === 'windows-uia') {
      clickedInspection = await this.inspectWindowsDialog(input, selection.button.name);
      if (!clickedInspection?.clickedButton) {
        if (!selection.button.bounds) {
          return {
            success: false,
            error: `Dialog button "${selection.button.name}" was identified but could not be invoked.`,
            data: { dialog: inspection, selectedButton: selection.button },
          };
        }
        const { x, y, width, height } = selection.button.bounds;
        await this.automation.click(
          Math.round(x + width / 2),
          Math.round(y + height / 2),
          { button: 'left' },
        );
        clickedInspection = {
          ...inspection,
          clickedButton: selection.button,
          clickSource: 'uia-bounds-click-fallback',
        };
      }
    } else if (selection.button.ref !== undefined) {
      const clicked = await this.click({ ...input, ref: selection.button.ref });
      if (!clicked.success) return clicked;
      clickedInspection = {
        ...inspection,
        clickedButton: selection.button,
        clickSource: 'snapshot-click',
      };
    } else if (selection.button.bounds) {
      const { x, y, width, height } = selection.button.bounds;
      await this.automation.click(
        Math.round(x + width / 2),
        Math.round(y + height / 2),
        { button: 'left' },
      );
      clickedInspection = {
        ...inspection,
        clickedButton: selection.button,
        clickSource: 'snapshot-bounds-click',
      };
    }

    if (!clickedInspection) {
      return {
        success: false,
        error: `Dialog button "${selection.button.name}" has no invokable target.`,
        data: { dialog: inspection, selectedButton: selection.button },
      };
    }

    return {
      success: true,
      output: `Clicked dialog button "${selection.button.name}" (${selection.reason})`,
      data: {
        dialog: clickedInspection,
        selectedButton: selection.button,
        reason: selection.reason,
      },
    };
  }

  private async handleDialog(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.dialogIntent && !input.name && !input.option && !input.text) {
      const inspection = await this.getDialogInspection(input);
      return {
        success: false,
        error: 'handle_dialog requires dialogIntent, name, option, or text. Use inspect_dialog to review available choices first.',
        data: inspection ? { dialog: inspection } : undefined,
      };
    }

    return this.clickDialogButton(input);
  }

  private async getDialogInspection(input: ComputerControlInput): Promise<DialogInspection | null> {
    const currentSnapshot = this.snapshotManager.getCurrentSnapshot();
    if (currentSnapshot) {
      const snapshotDialog = this.inspectSnapshotDialog(input);
      if (snapshotDialog) return snapshotDialog;
    }

    const windowsDialog = await this.inspectWindowsDialog(input);
    if (windowsDialog) return windowsDialog;

    if (input.simulateOnly) return null;

    try {
      await this.snapshotManager.takeSnapshot({ interactiveOnly: false });
      return this.inspectSnapshotDialog(input);
    } catch (err) {
      logger.debug('Dialog snapshot fallback failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private inspectSnapshotDialog(input: ComputerControlInput): DialogInspection | null {
    const snapshot = this.snapshotManager.getCurrentSnapshot();
    if (!snapshot) return null;

    const visible = snapshot.elements.filter((element) => element.visible);
    const buttons = visible
      .filter((element) => ['button', 'link', 'menu-item'].includes(element.role) && element.enabled)
      .map((element) => this.toDialogButtonEvidence(element));
    const text = visible
      .filter((element) => ['text', 'text-field', 'window'].includes(element.role))
      .map((element) => [element.name, element.value, element.description].filter(Boolean).join(' '))
      .filter((value, index, all): value is string => Boolean(value?.trim()) && all.indexOf(value) === index)
      .slice(0, 20);
    const title = visible.find((element) => element.role === 'window')?.name ?? snapshot.source;

    if (input.dialogText && !this.dialogTextMatches(title, text, input.dialogText)) {
      return null;
    }

    if (buttons.length === 0 && text.length === 0) return null;

    const inspection: DialogInspection = {
      source: 'snapshot',
      title,
      text,
      buttons,
    };
    const selection = this.selectDialogButton(inspection, input, { allowSafeDefault: true });
    if (selection) {
      inspection.suggestedButton = selection.button;
      inspection.suggestionReason = selection.reason;
    }
    return inspection;
  }

  private toDialogButtonEvidence(element: UIElement): DialogButtonEvidence {
    return {
      name: element.name || element.value || `ref-${element.ref}`,
      role: element.role,
      enabled: element.enabled,
      risk: this.classifyDialogButtonRisk(element.name || element.value || ''),
      bounds: element.bounds,
      ref: element.ref,
    };
  }

  private async inspectWindowsDialog(input: ComputerControlInput, clickButtonName?: string): Promise<DialogInspection | null> {
    if (process.platform !== 'win32') return null;

    const payload = Buffer.from(JSON.stringify({
      windowTitle: input.windowTitle,
      windowTitleMatch: input.windowTitleMatch ?? 'contains',
      processName: input.processName,
      processNameMatch: input.processNameMatch ?? 'contains',
      dialogText: input.dialogText,
      clickButtonName,
      exactName: input.exactName ?? false,
    }), 'utf8').toString('base64');
    const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CodeBuddyDialogMouse {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
  [DllImport("user32.dll")]
  public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);
}
'@
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$windowTitle = [string]$payload.windowTitle
$windowTitleMatch = [string]$payload.windowTitleMatch
$processName = [string]$payload.processName
$processNameMatch = [string]$payload.processNameMatch
$dialogText = [string]$payload.dialogText
$clickButtonName = [string]$payload.clickButtonName
$exactName = [bool]$payload.exactName
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

function Normalize([string]$value) {
  if ($null -eq $value) { return '' }
  return ($value.Trim() -replace '\\s+', ' ').ToLowerInvariant()
}

function Text-Matches([string]$candidate, [string]$query, [string]$mode) {
  $c = Normalize $candidate
  $q = Normalize $query
  if ([string]::IsNullOrWhiteSpace($q)) { return $true }
  if ($mode -eq 'equals') { return $c -eq $q }
  return $c.Contains($q)
}

function Choice-Matches([string]$candidate, [string]$query, [bool]$exact) {
  $c = Normalize $candidate
  $q = Normalize $query
  if ([string]::IsNullOrWhiteSpace($q)) { return $false }
  if ($exact) { return $c -eq $q }
  return $c -eq $q -or $c.Contains($q) -or $q.Contains($c)
}

function Get-Nodes($element, [int]$depth) {
  if ($null -eq $element -or $depth -gt 8) { return @() }
  $results = @()
  try {
    $rect = $element.Current.BoundingRectangle
    $value = ''
    try {
      $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $value = [string]$valuePattern.Current.Value
    } catch {}
    $results += [pscustomobject]@{
      Element = $element
      Name = [string]$element.Current.Name
      Value = $value
      Role = [string]$element.Current.ControlType.ProgrammaticName
      X = [double]$rect.X
      Y = [double]$rect.Y
      Width = [double]$rect.Width
      Height = [double]$rect.Height
      Enabled = [bool]$element.Current.IsEnabled
      Offscreen = [bool]$element.Current.IsOffscreen
      ProcessId = [int]$element.Current.ProcessId
    }
    $child = $walker.GetFirstChild($element)
    while ($null -ne $child) {
      $results += Get-Nodes $child ($depth + 1)
      $child = $walker.GetNextSibling($child)
    }
  } catch {}
  return $results
}

function Resolve-Window {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = @(Get-Nodes $root 0 | Where-Object { $_.Role -eq 'ControlType.Window' -and -not $_.Offscreen -and $_.Width -gt 0 -and $_.Height -gt 0 })
  if ($windowTitle) {
    $matches = @($windows | Where-Object { Text-Matches $_.Name $windowTitle $windowTitleMatch })
    if ($matches.Count -gt 0) {
      return ($matches | Sort-Object @{ Expression = { $_.Width * $_.Height } } -Descending | Select-Object -First 1).Element
    }
  }
  if ($processName) {
    foreach ($node in $windows) {
      try {
        $proc = Get-Process -Id $node.ProcessId -ErrorAction SilentlyContinue
        if ($proc -and (Text-Matches $proc.ProcessName $processName $processNameMatch)) {
          return $node.Element
        }
      } catch {}
    }
  }
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  $window = $focused
  while ($null -ne $window -and $window.Current.ControlType.ProgrammaticName -ne 'ControlType.Window') {
    $window = $walker.GetParent($window)
  }
  if ($null -ne $window) { return $window }
  if ($windows.Count -gt 0) {
    return ($windows | Sort-Object @{ Expression = { $_.Width * $_.Height } } -Descending | Select-Object -First 1).Element
  }
  return $null
}

$window = Resolve-Window
if ($null -eq $window) { '{}' | Write-Output; exit 0 }
$nodes = @(Get-Nodes $window 0)
$texts = @($nodes | Where-Object {
  -not $_.Offscreen -and
  ($_.Role -in @('ControlType.Text', 'ControlType.Edit', 'ControlType.Document')) -and
  (-not [string]::IsNullOrWhiteSpace($_.Name + $_.Value))
} | Select-Object -First 30 | ForEach-Object { (($_.Name, $_.Value) -join ' ').Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

if ($dialogText) {
  $haystack = (($window.Current.Name, ($texts -join ' ')) -join ' ')
  if (-not (Text-Matches $haystack $dialogText 'contains')) { '{}' | Write-Output; exit 0 }
}

$buttonNodes = @($nodes | Where-Object {
  $_.Enabled -and
  -not $_.Offscreen -and
  $_.Width -gt 0 -and
  $_.Height -gt 0 -and
  ($_.Role -in @('ControlType.Button', 'ControlType.Hyperlink', 'ControlType.MenuItem')) -and
  -not [string]::IsNullOrWhiteSpace($_.Name)
})

$windowTitleValue = [string]$window.Current.Name
$windowPidValue = [int]$window.Current.ProcessId
$proc = Get-Process -Id $windowPidValue -ErrorAction SilentlyContinue
$processNameValue = if ($proc) { [string]$proc.ProcessName } else { '' }
$textRecords = @($texts)
$buttonRecords = @($buttonNodes | Select-Object -First 30 | ForEach-Object {
  [pscustomobject]@{
    name = [string]$_.Name
    role = [string]$_.Role
    enabled = [bool]$_.Enabled
    bounds = [pscustomobject]@{ x = $_.X; y = $_.Y; width = $_.Width; height = $_.Height }
  }
})

$clicked = $null
$clickedRecord = $null
$clickSource = $null
if ($clickButtonName) {
  $target = $buttonNodes | Where-Object { Choice-Matches $_.Name $clickButtonName $exactName } | Select-Object -First 1
  if ($null -ne $target) {
    $clickedRecord = [pscustomobject]@{
      name = [string]$target.Name
      role = [string]$target.Role
      enabled = [bool]$target.Enabled
      bounds = [pscustomobject]@{ x = $target.X; y = $target.Y; width = $target.Width; height = $target.Height }
    }
    try {
      $invoke = $target.Element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $invoke.Invoke()
      $clicked = $target
      $clickSource = 'uia-invoke'
    } catch {
      $cx = [int]($target.X + ($target.Width / 2))
      $cy = [int]($target.Y + ($target.Height / 2))
      [CodeBuddyDialogMouse]::SetCursorPos($cx, $cy) | Out-Null
      Start-Sleep -Milliseconds 50
      [CodeBuddyDialogMouse]::mouse_event(0x0002, 0, 0, 0, 0)
      [CodeBuddyDialogMouse]::mouse_event(0x0004, 0, 0, 0, 0)
      $clicked = $target
      $clickSource = 'uia-mouse'
    }
  }
}

[pscustomobject]@{
  source = 'windows-uia'
  title = $windowTitleValue
  processName = $processNameValue
  pid = $windowPidValue
  text = @($textRecords)
  buttons = @($buttonRecords)
  clickedButton = if ($clicked) { $clickedRecord } else { $null }
  clickSource = $clickSource
} | ConvertTo-Json -Depth 8 -Compress
`;

    try {
      const stdout = await this.runPowerShellEncoded(script, 10000);
      const data = JSON.parse(stdout || '{}') as {
        source?: string;
        title?: string;
        processName?: string;
        pid?: number;
        text?: string[];
        buttons?: Array<{
          name?: string;
          role?: string;
          enabled?: boolean;
          bounds?: { x: number; y: number; width: number; height: number };
        }>;
        clickedButton?: {
          name?: string;
          role?: string;
          enabled?: boolean;
          bounds?: { x: number; y: number; width: number; height: number };
        } | null;
        clickSource?: string | null;
      };
      if (!data.source || (!data.buttons?.length && !data.text?.length)) return null;

      const buttons = (data.buttons ?? []).map((button) => ({
        name: button.name ?? '',
        role: button.role ?? 'button',
        enabled: button.enabled ?? true,
        risk: this.classifyDialogButtonRisk(button.name ?? ''),
        bounds: button.bounds,
      }));
      const inspection: DialogInspection = {
        source: 'windows-uia',
        title: data.title ?? '',
        processName: data.processName,
        pid: data.pid,
        text: data.text ?? [],
        buttons,
      };
      const selection = this.selectDialogButton(inspection, input, { allowSafeDefault: true });
      if (selection) {
        inspection.suggestedButton = selection.button;
        inspection.suggestionReason = selection.reason;
      }
      if (data.clickedButton?.name) {
        inspection.clickedButton = {
          name: data.clickedButton.name,
          role: data.clickedButton.role ?? 'button',
          enabled: data.clickedButton.enabled ?? true,
          risk: this.classifyDialogButtonRisk(data.clickedButton.name),
          bounds: data.clickedButton.bounds,
        };
        inspection.clickSource = data.clickSource ?? undefined;
      }
      return inspection;
    } catch (err) {
      logger.debug('Windows UIAutomation dialog inspection failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private selectDialogButton(
    inspection: DialogInspection,
    input: ComputerControlInput,
    options: { allowSafeDefault: boolean },
  ): { button: DialogButtonEvidence; reason: string } | null {
    const explicitChoice = (input.name ?? input.option ?? (input.dialogIntent === 'custom' ? input.text : undefined))?.trim();
    if (explicitChoice) {
      const byName = this.findDialogButtonByQuery(inspection.buttons, explicitChoice, input.exactName);
      if (byName) return { button: byName, reason: `matched requested button "${explicitChoice}"` };
    }

    const intentCandidates = this.dialogIntentCandidates(input.dialogIntent);
    for (const candidate of intentCandidates) {
      const byIntent = this.findDialogButtonByQuery(inspection.buttons, candidate, false);
      if (byIntent) return { button: byIntent, reason: `matched dialogIntent "${input.dialogIntent}"` };
    }

    if (!explicitChoice && !input.dialogIntent && input.text) {
      const byText = this.findDialogButtonByQuery(inspection.buttons, input.text, input.exactName);
      if (byText) return { button: byText, reason: `matched text "${input.text}"` };
    }

    if (options.allowSafeDefault) {
      const safe = inspection.buttons.find((button) => button.risk === 'safe');
      if (safe) return { button: safe, reason: 'safe default fallback' };
    }

    return null;
  }

  private findDialogButtonByQuery(
    buttons: DialogButtonEvidence[],
    query: string,
    exactName?: boolean,
  ): DialogButtonEvidence | undefined {
    const normalizedQuery = this.normalizeDialogText(query);
    const scored = buttons
      .map((button) => {
        const name = this.normalizeDialogText(button.name);
        let score = 0;
        if (exactName ? name === normalizedQuery : name === normalizedQuery) score += 100;
        if (!exactName && (name.includes(normalizedQuery) || normalizedQuery.includes(name))) score += 50;
        if (button.enabled) score += 10;
        if (button.risk === 'safe') score += 2;
        return { button, score };
      })
      .filter((item) => item.score >= 50)
      .sort((a, b) => b.score - a.score);
    return scored[0]?.button;
  }

  private dialogIntentCandidates(intent: ComputerControlInput['dialogIntent']): string[] {
    switch (intent) {
      case 'accept':
        return ['ok', 'yes', 'accept', 'allow', 'authorize', 'continue', 'oui', 'autoriser', 'continuer'];
      case 'cancel':
        return ['cancel', 'no', 'close', 'dismiss', 'later', 'annuler', 'non', 'fermer'];
      case 'save':
        return ['save', 'save as', 'enregistrer'];
      case 'dont_save':
        return ['dont save', "don't save", 'do not save', 'ne pas enregistrer'];
      case 'discard':
        return ['discard', 'delete', 'remove', 'overwrite', 'replace', 'supprimer', 'ecraser', 'remplacer'];
      case 'retry':
        return ['retry', 'try again', 'ressayer'];
      case 'continue':
        return ['continue', 'next', 'proceed', 'continuer', 'suivant'];
      case 'close':
        return ['close', 'dismiss', 'fermer'];
      case 'yes':
        return ['yes', 'oui'];
      case 'no':
        return ['no', 'non'];
      case 'ok':
        return ['ok'];
      default:
        return [];
    }
  }

  private classifyDialogButtonRisk(name: string): DialogButtonRisk {
    const normalized = this.normalizeDialogText(name);
    if (!normalized) return 'caution';

    const destructive = [
      'delete',
      'remove',
      'discard',
      'overwrite',
      'replace',
      'run',
      'execute',
      'install',
      'uninstall',
      'allow',
      'authorize',
      'supprimer',
      'effacer',
      'ecraser',
      'remplacer',
      'executer',
      'installer',
      'autoriser',
    ];
    if (destructive.some((token) => normalized.includes(token))) return 'destructive';

    const safe = [
      'cancel',
      'no',
      'close',
      'dismiss',
      'later',
      'annuler',
      'non',
      'fermer',
      'ignorer',
    ];
    if (safe.some((token) => normalized === token || normalized.includes(token))) return 'safe';

    return 'caution';
  }

  private formatDialogInspection(inspection: DialogInspection): string {
    const lines = [
      `Dialog: "${inspection.title || 'untitled'}" (${inspection.source})`,
    ];
    if (inspection.processName) lines.push(`Process: ${inspection.processName}${inspection.pid ? `, PID ${inspection.pid}` : ''}`);
    if (inspection.text.length) {
      lines.push('Text:');
      lines.push(...inspection.text.slice(0, 8).map((text) => `- ${text}`));
    }
    if (inspection.buttons.length) {
      lines.push('Buttons:');
      lines.push(...inspection.buttons.map((button) => `- "${button.name}" [${button.risk}]`));
    }
    if (inspection.suggestedButton) {
      lines.push(`Suggested: "${inspection.suggestedButton.name}" (${inspection.suggestionReason})`);
    }
    return lines.join('\n');
  }

  private dialogTextMatches(title: string, text: string[], query: string): boolean {
    const haystack = this.normalizeDialogText([title, ...text].join(' '));
    return haystack.includes(this.normalizeDialogText(query));
  }

  private normalizeDialogText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/[’']/g, '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private async listAppProfiles(): Promise<ToolResult> {
    const profiles = listApplicationProfiles();
    return {
      success: true,
      output: profiles.map((profile) => {
        return `- ${profile.id}: ${profile.name} (${profile.capabilities.join(', ')})`;
      }).join('\n'),
      data: { profiles },
    };
  }

  private async getAppProfile(input: ComputerControlInput): Promise<ToolResult> {
    const profile = this.resolveAppProfileFromInput(input);
    if (!profile) {
      return { success: false, error: `Unknown app profile: ${input.appName ?? input.name ?? ''}` };
    }
    return {
      success: true,
      output: `${profile.name}: ${profile.capabilities.join(', ')}`,
      data: { profile },
    };
  }

  private async openApp(input: ComputerControlInput): Promise<ToolResult> {
    const profile = this.resolveAppProfileFromInput(input);
    if (!profile) {
      return { success: false, error: `Unknown app profile: ${input.appName ?? input.name ?? ''}` };
    }

    const args = input.filePath ? [input.filePath] : [];
    const script = this.buildStartProcessScript(profile.launchCommand, args);
    await this.runPowerShellEncoded(script, 10000);

    return {
      success: true,
      output: `Opened ${profile.name}${input.filePath ? ` with ${input.filePath}` : ''}`,
      data: { profile, filePath: input.filePath },
    };
  }

  private async focusApp(input: ComputerControlInput): Promise<ToolResult> {
    const profile = this.resolveAppProfileFromInput(input);
    if (!profile) {
      return { success: false, error: `Unknown app profile: ${input.appName ?? input.name ?? ''}` };
    }

    const targetInput = this.withDerivedAppWindowTarget(input, profile);
    const selected = await this.waitForAppWindowFromInput(profile, targetInput);
    if (!selected) {
      return { success: false, error: `No visible window found for ${profile.name}. Try open_app first.` };
    }

    await this.automation.focusWindow(selected.handle);
    const matches = await this.findAppWindowCandidatesFromInput(profile, targetInput);
    return {
      success: true,
      output: `Focused ${profile.name}: "${selected.title}"`,
      data: { profile, window: selected, matchedCount: Math.max(1, matches.length) },
    };
  }

  private withDerivedAppWindowTarget(input: ComputerControlInput, profile: ApplicationProfile): ComputerControlInput {
    const next: ComputerControlInput = { ...input };
    if (profile.id === 'notepad' && input.filePath && !next.windowTitle && !next.windowTitleRegex) {
      next.windowTitle = this.basenameForWindowTitle(input.filePath);
      next.windowTitleMatch = 'contains';
    }
    return next;
  }

  private async findAppWindowCandidatesFromInput(
    profile: ApplicationProfile,
    input: ComputerControlInput
  ): Promise<WindowInfo[]> {
    const regex = this.parseTitleRegex(input);
    if (input.windowTitleRegex && !regex) return [];

    const wins = await this.automation.getWindows({ includeHidden: false });
    return wins.filter((win) => {
      return this.matchesApplicationProfileWindow(win, profile)
        && this.matchesWindowInput(win, input, regex);
    });
  }

  private async waitForAppWindowFromInput(
    profile: ApplicationProfile,
    input: ComputerControlInput
  ): Promise<WindowInfo | null> {
    const timeout = Math.max(0, Math.min(120_000, Math.round(this.toFiniteNumber(input.timeoutMs, 10000))));
    const poll = Math.max(25, Math.min(5_000, Math.round(this.toFiniteNumber(input.pollIntervalMs, 250))));
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeout) {
      const candidates = await this.findAppWindowCandidatesFromInput(profile, input);
      const uniqueErr = this.buildUniqueWindowError(candidates, input);
      if (uniqueErr) {
        this.lastWindowMatchError = uniqueErr;
        return null;
      }

      const selected = this.selectWindowCandidate(candidates, input);
      if (selected) {
        return selected;
      }

      await this.delay(poll);
    }

    return null;
  }

  private matchesApplicationProfileWindow(window: WindowInfo, profile: ApplicationProfile): boolean {
    const process = window.processName.toLowerCase();
    const title = window.title.toLowerCase();
    return profile.processNames.some((name) => {
      const normalized = name.toLowerCase();
      return process === normalized || process.includes(normalized);
    }) || profile.titleHints.some((hint) => title.includes(hint.toLowerCase()));
  }

  private async readAppText(input: ComputerControlInput): Promise<ToolResult> {
    const targetInput = this.withDerivedTextDocumentTarget(input);
    const textResult = await this.readWindowsEditableText(targetInput);
    if (!this.isAppTextReadResult(textResult)) return textResult;

    return {
      success: true,
      output: `Read ${textResult.text.length} character(s) from ${textResult.windowTitle}`,
      data: textResult,
    };
  }

  private async saveAppDocument(input: ComputerControlInput): Promise<ToolResult> {
    const profile = this.resolveAppProfileFromInput(input);
    if (profile?.id !== 'notepad') {
      return {
        success: false,
        error: 'save_app_document currently supports the notepad profile. Use Excel-specific save actions for spreadsheets.',
      };
    }
    if (!input.filePath) {
      return { success: false, error: 'filePath is required for save_app_document.' };
    }

    const targetInput = this.withDerivedTextDocumentTarget(input);
    const textResult = await this.readWindowsEditableText(targetInput);
    if (!this.isAppTextReadResult(textResult)) return textResult;

    await mkdir(path.dirname(input.filePath), { recursive: true });
    await writeFile(input.filePath, textResult.text, 'utf8');

    return {
      success: true,
      output: `Saved ${textResult.text.length} character(s) from ${textResult.windowTitle} to ${input.filePath}`,
      data: {
        ...textResult,
        filePath: input.filePath,
        profile,
      },
    };
  }

  private withDerivedTextDocumentTarget(input: ComputerControlInput): ComputerControlInput {
    const next: ComputerControlInput = { ...input };
    const profile = this.resolveAppProfileFromInput(input);
    if (profile && !next.processName) {
      const [processName] = profile.processNames;
      if (processName) {
        next.processName = processName;
        next.processNameMatch = 'contains';
      }
    }
    if (profile?.id === 'notepad' && input.filePath && !next.windowTitle && !next.windowTitleRegex) {
      next.windowTitle = this.basenameForWindowTitle(input.filePath);
      next.windowTitleMatch = 'contains';
    }
    return next;
  }

  private basenameForWindowTitle(filePath: string): string {
    return filePath.includes('\\') ? path.win32.basename(filePath) : path.basename(filePath);
  }

  private async excelOpenWorkbook(input: ComputerControlInput): Promise<ToolResult> {
    const result = await this.runExcelAutomation({
      operation: 'open',
      filePath: input.filePath,
      sheetName: input.sheetName,
    });
    return {
      success: true,
      output: `Excel workbook ready: ${result.workbookName ?? result.filePath ?? 'new workbook'}`,
      data: result,
    };
  }

  private async excelSetCell(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.cell) {
      return { success: false, error: 'cell is required for excel_set_cell, e.g. A1' };
    }

    const result = await this.runExcelAutomation({
      operation: 'setCell',
      filePath: input.filePath,
      sheetName: input.sheetName,
      cell: input.cell,
      value: input.value ?? input.text ?? '',
    });

    return {
      success: true,
      output: `Excel ${result.sheetName}!${input.cell} set to "${String(input.value ?? input.text ?? '')}"`,
      data: result,
    };
  }

  private async excelGetCell(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.cell) {
      return { success: false, error: 'cell is required for excel_get_cell, e.g. A1' };
    }

    const result = await this.runExcelAutomation({
      operation: 'getCell',
      filePath: input.filePath,
      sheetName: input.sheetName,
      cell: input.cell,
    });

    return {
      success: true,
      output: `Excel ${result.sheetName}!${input.cell} = ${String(result.value ?? '')}`,
      data: result,
    };
  }

  private async excelSaveWorkbook(input: ComputerControlInput): Promise<ToolResult> {
    const result = await this.runExcelAutomation({
      operation: 'save',
      filePath: input.filePath,
      saveAsPath: input.saveAsPath,
      sheetName: input.sheetName,
    });

    return {
      success: true,
      output: `Excel workbook saved${result.filePath ? `: ${result.filePath}` : ''}`,
      data: result,
    };
  }

  private async powerpointOpenPresentation(input: ComputerControlInput): Promise<ToolResult> {
    const result = await this.runPowerpointAutomation({
      operation: 'open',
      filePath: input.filePath,
    });
    return {
      success: true,
      output: `PowerPoint presentation ready: ${result.presentationName ?? result.filePath ?? 'new presentation'}`,
      data: result,
    };
  }

  private async powerpointAddSlide(input: ComputerControlInput): Promise<ToolResult> {
    const result = await this.runPowerpointAutomation({
      operation: 'addSlide',
      filePath: input.filePath,
      layoutIndex: input.layoutIndex,
    });
    return {
      success: true,
      output: `PowerPoint slide added (index ${result.slideIndex})`,
      data: result,
    };
  }

  private async powerpointSetText(input: ComputerControlInput): Promise<ToolResult> {
    if (input.slideIndex === undefined || input.shapeIndex === undefined) {
      return { success: false, error: 'slideIndex and shapeIndex are required' };
    }
    const result = await this.runPowerpointAutomation({
      operation: 'setText',
      filePath: input.filePath,
      slideIndex: input.slideIndex,
      shapeIndex: input.shapeIndex,
      value: input.value ?? input.text ?? '',
    });
    return {
      success: true,
      output: `PowerPoint slide ${input.slideIndex} shape ${input.shapeIndex} text set.`,
      data: result,
    };
  }

  private async powerpointSavePresentation(input: ComputerControlInput): Promise<ToolResult> {
    const result = await this.runPowerpointAutomation({
      operation: 'save',
      filePath: input.filePath,
      saveAsPath: input.saveAsPath,
    });
    return {
      success: true,
      output: `PowerPoint presentation saved${result.filePath ? `: ${result.filePath}` : ''}`,
      data: result,
    };
  }

  private async wordOpenDocument(input: ComputerControlInput): Promise<ToolResult> {
    const result = await this.runWordAutomation({
      operation: 'open',
      filePath: input.filePath,
    });
    return {
      success: true,
      output: `Word document ready: ${result.documentName ?? result.filePath ?? 'new document'}`,
      data: result,
    };
  }

  private async wordTypeText(input: ComputerControlInput): Promise<ToolResult> {
    const value = input.value ?? input.text;
    if (value === undefined || value === null) {
      return { success: false, error: 'value (or text) is required for word_type_text' };
    }
    const result = await this.runWordAutomation({
      operation: 'typeText',
      filePath: input.filePath,
      value,
    });
    return {
      success: true,
      output: `Word document text appended.`,
      data: result,
    };
  }

  private async wordSaveDocument(input: ComputerControlInput): Promise<ToolResult> {
    const result = await this.runWordAutomation({
      operation: 'save',
      filePath: input.filePath,
      saveAsPath: input.saveAsPath,
    });
    return {
      success: true,
      output: `Word document saved${result.filePath ? `: ${result.filePath}` : ''}`,
      data: result,
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

    let bufferBefore: Buffer | null = null;
    if (input.visualContext) {
      bufferBefore = await this.captureScreenBuffer();
    }

    await this.automation.click(point.x, point.y, { button: input.button || 'left' });

    let changeNotice = '';
    if (input.visualContext) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const bufferAfter = await this.captureScreenBuffer();
      if (bufferBefore && bufferAfter) {
        const changed = !bufferBefore.equals(bufferAfter);
        changeNotice = changed ? ' (visual change verified)' : ' (WARNING: no visual change detected)';
      }
    }

    return {
      success: true,
      output: `Clicked at (${point.x}, ${point.y})${changeNotice}`,
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

    let bufferBefore: Buffer | null = null;
    if (input.visualContext) {
      bufferBefore = await this.captureScreenBuffer();
    }

    await this.automation.doubleClick(point.x, point.y, 'left');

    let changeNotice = '';
    if (input.visualContext) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const bufferAfter = await this.captureScreenBuffer();
      if (bufferBefore && bufferAfter) {
        const changed = !bufferBefore.equals(bufferAfter);
        changeNotice = changed ? ' (visual change verified)' : ' (WARNING: no visual change detected)';
      }
    }

    return {
      success: true,
      output: `Double-clicked at (${point.x}, ${point.y})${changeNotice}`,
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

    let bufferBefore: Buffer | null = null;
    if (input.visualContext) {
      bufferBefore = await this.captureScreenBuffer();
    }

    await this.automation.rightClick(point.x, point.y);

    let changeNotice = '';
    if (input.visualContext) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const bufferAfter = await this.captureScreenBuffer();
      if (bufferBefore && bufferAfter) {
        const changed = !bufferBefore.equals(bufferAfter);
        changeNotice = changed ? ' (visual change verified)' : ' (WARNING: no visual change detected)';
      }
    }

    return {
      success: true,
      output: `Right-clicked at (${point.x}, ${point.y})${changeNotice}`,
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

    if (this.hasWindowMatcher(input)) {
      const focusError = await this.focusAndVerifyTarget(input);
      if (focusError) return focusError;
    }

    await this.automation.type(input.text, { delay: 30 });

    return {
      success: true,
      output: `Typed: "${input.text.slice(0, 50)}${input.text.length > 50 ? '...' : ''}"`,
      data: this.buildTargetProofData(),
    };
  }

  private async pressKey(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.key) {
      return { success: false, error: 'Key is required' };
    }

    if (this.hasWindowMatcher(input)) {
      const focusError = await this.focusAndVerifyTarget(input);
      if (focusError) return focusError;
    }

    await this.automation.keyPress(input.key, {
      modifiers: input.modifiers as ModifierKey[] | undefined,
    });

    return {
      success: true,
      output: `Pressed key: ${input.modifiers?.join('+') || ''}${input.modifiers?.length ? '+' : ''}${input.key}`,
      data: this.buildTargetProofData(),
    };
  }

  private async hotkey(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.key) {
      return { success: false, error: 'Key is required' };
    }

    if (this.hasWindowMatcher(input)) {
      const focusError = await this.focusAndVerifyTarget(input);
      if (focusError) return focusError;
    }

    // Build keys array: modifiers first, then the main key
    const keys: KeyCode[] = [...(input.modifiers || []), input.key];
    await this.automation.hotkey(...keys);

    return {
      success: true,
      output: `Hotkey: ${input.modifiers?.length ? input.modifiers.join('+') + '+' : ''}${input.key}`,
      data: this.buildTargetProofData(),
    };
  }

  private async keyDown(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.key) {
      return { success: false, error: 'Key is required' };
    }

    if (this.hasWindowMatcher(input)) {
      const focusError = await this.focusAndVerifyTarget(input);
      if (focusError) return focusError;
    }

    await this.automation.keyDown(input.key);
    return {
      success: true,
      output: `Key down: ${input.key}`,
      data: this.buildTargetProofData(),
    };
  }

  private async keyUp(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.key) {
      return { success: false, error: 'Key is required' };
    }

    if (this.hasWindowMatcher(input)) {
      const focusError = await this.focusAndVerifyTarget(input);
      if (focusError) return focusError;
    }

    await this.automation.keyUp(input.key);
    return {
      success: true,
      output: `Key up: ${input.key}`,
      data: this.buildTargetProofData(),
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
    await this.tryWindowsForceForeground(win);

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
    let rawPoint: { x: number; y: number } | null = null;

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
        rawPoint = element.center;
      }
    }

    // If x,y are provided, use them directly
    if (!rawPoint && input.x !== undefined && input.y !== undefined) {
      rawPoint = { x: input.x, y: input.y };
    }

    if (!rawPoint) {
      return null;
    }

    let targetX = rawPoint.x;
    let targetY = rawPoint.y;

    // Get screen info from desktop automation for bounds and scaling
    try {
      const screens = await this.automation.getScreens();
      const primaryScreen = screens.find(s => s.primary) || screens[0];

      const width = primaryScreen?.bounds?.width || 1920;
      const height = primaryScreen?.bounds?.height || 1080;
      const scaleFactor = primaryScreen?.scaleFactor || 1;

      // Coordinate scaling logic (relative 0-1000 scale)
      // Check if coordinates look normalized / relative
      const isRelative = input.x !== undefined && input.y !== undefined &&
        input.x >= 0 && input.x <= 1000 &&
        input.y >= 0 && input.y <= 1000 &&
        !(width <= 1000 && height <= 1000);

      if (isRelative && input.x !== undefined && input.y !== undefined) {
        targetX = Math.round((input.x / 1000) * width);
        targetY = Math.round((input.y / 1000) * height);
        logger.info(`Mapped relative coordinates (${input.x}, ${input.y}) to absolute (${targetX}, ${targetY}) on primary screen of size ${width}x${height}`);
      }

      // Adjust coordinates by scaleFactor if coordinates represent physical pixels (e.g. from screenshot)
      if (scaleFactor !== 1) {
        const targetScreen = screens.find(s =>
          targetX >= s.bounds.x && targetX <= s.bounds.x + s.bounds.width &&
          targetY >= s.bounds.y && targetY <= s.bounds.y + s.bounds.height
        ) || primaryScreen || screens[0];

        const targetScaleFactor = targetScreen?.scaleFactor || 1;
        if (targetScaleFactor !== 1) {
          logger.info(`Applying DPI scale factor of ${targetScaleFactor} to absolute coordinates (${targetX}, ${targetY})`);
          targetX = Math.round(targetX / targetScaleFactor);
          targetY = Math.round(targetY / targetScaleFactor);
        }
      }
    } catch (err) {
      logger.debug('Failed to get screen info for coordinate scaling', { error: err });
    }

    return { x: targetX, y: targetY };
  }

  /**
   * Capture screenshot buffer for visual verification loops
   */
  private async captureScreenBuffer(): Promise<Buffer | null> {
    try {
      const { ScreenshotTool } = await import('./screenshot-tool.js');
      const screenshotTool = new ScreenshotTool();
      const captureResult = await screenshotTool.capture({ fullscreen: true, format: 'png' });
      const captureData = captureResult.data as Record<string, unknown> | undefined;
      if (captureResult.success && captureData?.path) {
        const filePath = captureData.path as string;
        const fs = await import('fs/promises');
        return await fs.readFile(filePath);
      }
    } catch (err) {
      logger.debug('Failed to capture screen buffer', { error: err });
    }
    return null;
  }

  private resolveAppProfileFromInput(input: ComputerControlInput): ApplicationProfile | undefined {
    const appName = input.appName ?? input.name;
    if (!appName) return undefined;
    return resolveApplicationProfile(appName);
  }

  private buildStartProcessScript(command: string, args: string[]): string {
    const payload = Buffer.from(JSON.stringify({ command, args }), 'utf8').toString('base64');
    return `
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
if ($payload.args -and $payload.args.Count -gt 0) {
  Start-Process -FilePath $payload.command -ArgumentList @($payload.args)
} else {
  Start-Process -FilePath $payload.command
}
`;
  }

  private async runPowerShellEncoded(script: string, timeoutMs = 15000): Promise<string> {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const result = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-EncodedCommand',
      encoded,
    ], {
      timeout: timeoutMs,
      windowsHide: true,
    }) as { stdout: string | Buffer; stderr: string | Buffer };
    return String(result.stdout).trim();
  }

  private async runExcelAutomation(payload: {
    operation: 'open' | 'setCell' | 'getCell' | 'save';
    filePath?: string;
    saveAsPath?: string;
    sheetName?: string;
    cell?: string;
    value?: string | number | boolean | null;
  }): Promise<Record<string, unknown>> {
    if (process.platform !== 'win32') {
      throw new Error('Excel application profile currently requires Windows COM automation.');
    }

    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const script = `
$ErrorActionPreference = 'Stop'
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPayload}')) | ConvertFrom-Json

function Get-ExcelApplication {
  try {
    return [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application')
  } catch {
    return New-Object -ComObject Excel.Application
  }
}

function Resolve-Workbook($excel, $filePath) {
  if ($filePath) {
    $fullPath = [System.IO.Path]::GetFullPath([string]$filePath)
    foreach ($book in @($excel.Workbooks)) {
      try {
        if ($book.FullName -eq $fullPath) { return $book }
      } catch {}
    }
    if (Test-Path -LiteralPath $fullPath) {
      return $excel.Workbooks.Open($fullPath)
    }
    $book = $excel.Workbooks.Add()
    $book.SaveAs($fullPath)
    return $book
  }

  if ($excel.Workbooks.Count -gt 0) {
    return $excel.ActiveWorkbook
  }
  return $excel.Workbooks.Add()
}

function Resolve-Sheet($workbook, $sheetName) {
  if ($sheetName) {
    foreach ($sheet in @($workbook.Worksheets)) {
      if ($sheet.Name -eq [string]$sheetName) { return $sheet }
    }
    throw "Worksheet '$sheetName' not found."
  }
  return $workbook.ActiveSheet
}

$excel = Get-ExcelApplication
$excel.Visible = $true
if ($payload.operation -eq 'getCell' -and -not $payload.filePath -and $excel.Workbooks.Count -eq 0) {
  throw 'No active Excel workbook to read. Provide filePath or open a workbook first.'
}
$workbook = Resolve-Workbook $excel $payload.filePath
$worksheet = Resolve-Sheet $workbook $payload.sheetName
$operation = [string]$payload.operation
$cell = [string]$payload.cell
$value = $null

switch ($operation) {
  'open' {
    $value = $null
  }
  'setCell' {
    if (-not $cell) { throw 'cell is required' }
    $worksheet.Range($cell).Value2 = $payload.value
    $value = $worksheet.Range($cell).Value2
  }
  'getCell' {
    if (-not $cell) { throw 'cell is required' }
    $value = $worksheet.Range($cell).Value2
  }
  'save' {
    if ($payload.saveAsPath) {
      $savePath = [System.IO.Path]::GetFullPath([string]$payload.saveAsPath)
      $workbook.SaveAs($savePath)
    } elseif ($payload.filePath) {
      $workbook.Save()
    } elseif ($workbook.Path) {
      $workbook.Save()
    } else {
      throw 'saveAsPath is required for an unsaved workbook.'
    }
    $value = $null
  }
  default {
    throw "Unknown Excel operation '$operation'"
  }
}

[pscustomobject]@{
  operation = $operation
  filePath = $workbook.FullName
  workbookName = $workbook.Name
  sheetName = $worksheet.Name
  cell = $cell
  value = $value
  visible = $excel.Visible
} | ConvertTo-Json -Compress
`;

    const stdout = await this.runPowerShellEncoded(script, 30000);
    return JSON.parse(stdout || '{}') as Record<string, unknown>;
  }

  private async runPowerpointAutomation(payload: {
    operation: 'open' | 'addSlide' | 'setText' | 'save';
    filePath?: string;
    saveAsPath?: string;
    slideIndex?: number;
    shapeIndex?: number;
    layoutIndex?: number;
    value?: string | number | boolean | null;
  }): Promise<Record<string, unknown>> {
    if (process.platform !== 'win32') {
      throw new Error('PowerPoint application profile currently requires Windows COM automation.');
    }

    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const script = `
$ErrorActionPreference = 'Stop'
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPayload}')) | ConvertFrom-Json

function Get-PowerPointApplication {
  try {
    return [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
  } catch {
    return New-Object -ComObject PowerPoint.Application
  }
}

function Resolve-Presentation($ppt, $filePath) {
  if ($filePath) {
    $fullPath = [System.IO.Path]::GetFullPath([string]$filePath)
    foreach ($pres in @($ppt.Presentations)) {
      try {
        if ($pres.FullName -eq $fullPath) { return $pres }
      } catch {}
    }
    if (Test-Path -LiteralPath $fullPath) {
      return $ppt.Presentations.Open($fullPath)
    }
    $pres = $ppt.Presentations.Add()
    $pres.SaveAs($fullPath)
    return $pres
  }

  if ($ppt.Presentations.Count -gt 0) {
    return $ppt.ActivePresentation
  }
  return $ppt.Presentations.Add()
}

$ppt = Get-PowerPointApplication
$ppt.Visible = 1
$presentation = Resolve-Presentation $ppt $payload.filePath
$operation = [string]$payload.operation
$slideIndex = $payload.slideIndex
$shapeIndex = $payload.shapeIndex
$value = $null

switch ($operation) {
  'open' {
    $value = $null
  }
  'addSlide' {
    $layoutIndex = 1
    if ($null -ne $payload.layoutIndex) { $layoutIndex = $payload.layoutIndex }
    # ppLayoutText = 2, ppLayoutTitle = 1
    $slideCount = $presentation.Slides.Count
    $slide = $presentation.Slides.Add($slideCount + 1, $layoutIndex)
    $slideIndex = $slide.SlideIndex
  }
  'setText' {
    if ($null -eq $slideIndex -or $null -eq $shapeIndex) { throw 'slideIndex and shapeIndex are required' }
    $slide = $presentation.Slides.Item([int]$slideIndex)
    $shape = $slide.Shapes.Item([int]$shapeIndex)
    if ($shape.HasTextFrame) {
      $shape.TextFrame.TextRange.Text = $payload.value
    } else {
      throw 'Shape does not have a text frame'
    }
    $value = $payload.value
  }
  'save' {
    if ($payload.saveAsPath) {
      $savePath = [System.IO.Path]::GetFullPath([string]$payload.saveAsPath)
      $presentation.SaveAs($savePath)
    } elseif ($payload.filePath) {
      $presentation.Save()
    } elseif ($presentation.Path) {
      $presentation.Save()
    } else {
      throw 'saveAsPath is required for an unsaved presentation.'
    }
    $value = $null
  }
  default {
    throw "Unknown PowerPoint operation '$operation'"
  }
}

[pscustomobject]@{
  operation = $operation
  filePath = $presentation.FullName
  presentationName = $presentation.Name
  slideIndex = $slideIndex
  value = $value
} | ConvertTo-Json -Compress
`;

    const stdout = await this.runPowerShellEncoded(script, 30000);
    return JSON.parse(stdout || '{}') as Record<string, unknown>;
  }

  private async runWordAutomation(payload: {
    operation: 'open' | 'typeText' | 'save';
    filePath?: string;
    saveAsPath?: string;
    value?: string | number | boolean | null;
  }): Promise<Record<string, unknown>> {
    if (process.platform !== 'win32') {
      throw new Error('Word application profile currently requires Windows COM automation.');
    }

    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const script = `
$ErrorActionPreference = 'Stop'
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPayload}')) | ConvertFrom-Json

function Get-WordApplication {
  try {
    return [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
  } catch {
    return New-Object -ComObject Word.Application
  }
}

function Resolve-Document($word, $filePath) {
  if ($filePath) {
    $fullPath = [System.IO.Path]::GetFullPath([string]$filePath)
    foreach ($doc in @($word.Documents)) {
      try {
        if ($doc.FullName -eq $fullPath) { return $doc }
      } catch {}
    }
    if (Test-Path -LiteralPath $fullPath) {
      return $word.Documents.Open($fullPath)
    }
    $doc = $word.Documents.Add()
    $doc.SaveAs([string]$fullPath)
    return $doc
  }

  if ($word.Documents.Count -gt 0) {
    return $word.ActiveDocument
  }
  return $word.Documents.Add()
}

$word = Get-WordApplication
$word.Visible = 1
$document = Resolve-Document $word $payload.filePath
$operation = [string]$payload.operation
$value = $null

switch ($operation) {
  'open' {
    $value = $null
  }
  'typeText' {
    $document.Content.InsertAfter([string]$payload.value)
    $value = $payload.value
  }
  'save' {
    if ($payload.saveAsPath) {
      $savePath = [System.IO.Path]::GetFullPath([string]$payload.saveAsPath)
      $document.SaveAs([string]$savePath)
    } elseif ($payload.filePath) {
      $document.Save()
    } elseif ($document.Path) {
      $document.Save()
    } else {
      throw 'saveAsPath is required for an unsaved document.'
    }
    $value = $null
  }
  default {
    throw "Unknown Word operation '$operation'"
  }
}

[pscustomobject]@{
  operation = $operation
  filePath = $document.FullName
  documentName = $document.Name
  value = $value
} | ConvertTo-Json -Compress
`;

    const stdout = await this.runPowerShellEncoded(script, 30000);
    return JSON.parse(stdout || '{}') as Record<string, unknown>;
  }

  private async tryWindowsSelectDropdownOption(
    input: ComputerControlInput,
    option: string,
  ): Promise<ToolResult> {
    if (process.platform !== 'win32' || !input.name) {
      return { success: false, error: 'Windows UIAutomation direct path unavailable' };
    }

    const payload = Buffer.from(JSON.stringify({
      label: input.name,
      option,
      exactName: input.exactName ?? false,
      windowTitle: input.windowTitle,
      windowTitleMatch: input.windowTitleMatch ?? 'contains',
      processName: input.processName,
    }), 'utf8').toString('base64');
    const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class CodeBuddyDropdownMouse {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
}
'@
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$label = [string]$payload.label
$option = [string]$payload.option
$exactName = [bool]$payload.exactName
$windowTitle = [string]$payload.windowTitle
$windowTitleMatch = [string]$payload.windowTitleMatch
$processName = [string]$payload.processName
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

function Normalize([string]$value) {
  if ($null -eq $value) { return '' }
  return ($value.Trim() -replace '\\s+', ' ').ToLowerInvariant()
}

function Matches([string]$candidate, [string]$query, [bool]$exact) {
  $c = Normalize $candidate
  $q = Normalize $query
  if ($exact) { return $c -eq $q }
  return $c -eq $q -or $c.Contains($q)
}

function Get-Nodes($element, [int]$depth) {
  if ($null -eq $element -or $depth -gt 7) { return @() }
  $results = @()
  try {
    $rect = $element.Current.BoundingRectangle
    $results += [pscustomobject]@{
      Element = $element
      Name = [string]$element.Current.Name
      Role = [string]$element.Current.ControlType.ProgrammaticName
      X = [double]$rect.X
      Y = [double]$rect.Y
      Width = [double]$rect.Width
      Height = [double]$rect.Height
      Enabled = [bool]$element.Current.IsEnabled
    }
    $child = $walker.GetFirstChild($element)
    while ($null -ne $child) {
      $results += Get-Nodes $child ($depth + 1)
      $child = $walker.GetNextSibling($child)
    }
  } catch {}
  return $results
}

function Resolve-Window {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = @(Get-Nodes $root 0 | Where-Object { $_.Role -eq 'ControlType.Window' })
  if ($windowTitle) {
    $matches = @($windows | Where-Object {
      if ($windowTitleMatch -eq 'equals') { (Normalize $_.Name) -eq (Normalize $windowTitle) }
      else { (Normalize $_.Name).Contains((Normalize $windowTitle)) }
    })
    if ($matches.Count -gt 0) {
      return ($matches | Sort-Object @{ Expression = { $_.Width * $_.Height } } -Descending | Select-Object -First 1).Element
    }
  }
  if ($processName) {
    foreach ($node in $windows) {
      try {
        $proc = Get-Process -Id $node.Element.Current.ProcessId -ErrorAction SilentlyContinue
        if ($proc -and (Normalize $proc.ProcessName).Contains((Normalize $processName))) {
          return $node.Element
        }
      } catch {}
    }
  }
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  $window = $focused
  while ($null -ne $window -and $window.Current.ControlType.ProgrammaticName -ne 'ControlType.Window') {
    $window = $walker.GetParent($window)
  }
  return $window
}

$window = Resolve-Window
if ($null -eq $window) { throw 'No focused window for dropdown selection.' }

$nodes = @(Get-Nodes $window 0)
$labels = @($nodes | Where-Object { Matches $_.Name $label $exactName })
if ($labels.Count -eq 0) { throw "No label found matching '$label'." }

$comboNodes = @($nodes | Where-Object {
  $_.Enabled -and (
    $_.Role -eq 'ControlType.ComboBox' -or
    ($_.Role -eq 'ControlType.Pane' -and $_.Width -ge 80 -and $_.Height -le 40)
  )
})
if ($comboNodes.Count -eq 0) { throw 'No combo-like control found.' }

$best = $null
$bestScore = [double]::PositiveInfinity
foreach ($labelNode in $labels) {
  foreach ($candidate in $comboNodes) {
    if ($candidate.Element -eq $labelNode.Element) { continue }
    $dy = $candidate.Y - $labelNode.Y
    if ($dy -lt -8) { continue }
    $dx = [Math]::Abs(($candidate.X + $candidate.Width / 2) - ($labelNode.X + $labelNode.Width / 2))
    $score = $dy + ($dx * 0.35)
    if (Matches $candidate.Name $label $exactName) { $score -= 1000 }
    if ($score -lt $bestScore) {
      $bestScore = $score
      $best = $candidate
    }
  }
}
if ($null -eq $best) { throw "No dropdown associated with '$label'." }

$best.Element.SetFocus()
Start-Sleep -Milliseconds 100
$cx = [int]($best.X + ($best.Width / 2))
$cy = [int]($best.Y + ($best.Height / 2))
[CodeBuddyDropdownMouse]::SetCursorPos($cx, $cy) | Out-Null
Start-Sleep -Milliseconds 50
[CodeBuddyDropdownMouse]::mouse_event(0x0002, 0, 0, 0, 0)
[CodeBuddyDropdownMouse]::mouse_event(0x0004, 0, 0, 0, 0)
Start-Sleep -Milliseconds 100

try {
  $expand = $best.Element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
  $expand.Expand()
  Start-Sleep -Milliseconds 150
} catch {}

$rootNodes = @(Get-Nodes ([System.Windows.Automation.AutomationElement]::RootElement) 0)
$optionNodes = @($rootNodes | Where-Object {
  $_.Enabled -and
  ($_.Role -in @('ControlType.ListItem', 'ControlType.MenuItem', 'ControlType.Text', 'ControlType.Pane')) -and
  (Matches $_.Name $option $exactName)
})

if ($optionNodes.Count -gt 0) {
  $target = $optionNodes | Sort-Object @{ Expression = { [Math]::Abs($_.Y - $best.Y) + [Math]::Abs($_.X - $best.X) * 0.1 } } | Select-Object -First 1
  try {
    $select = $target.Element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $select.Select()
    '{"source":"uia-selection","selected":true}' | Write-Output
    exit 0
  } catch {}
  try {
    $invoke = $target.Element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
    '{"source":"uia-invoke","selected":true}' | Write-Output
    exit 0
  } catch {}
}

$first = $option.Substring(0, 1)
[System.Windows.Forms.SendKeys]::SendWait('{F4}')
Start-Sleep -Milliseconds 100
if ($first.Length -gt 0) {
  [System.Windows.Forms.SendKeys]::SendWait($first)
  Start-Sleep -Milliseconds 100
}
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
'{"source":"uia-sendkeys","selected":true}' | Write-Output
`;

    try {
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-EncodedCommand',
        encoded,
      ], { timeout: 10000 });
      const data = JSON.parse(String(stdout).trim() || '{}') as { source?: string };
      return {
        success: true,
        output: `Selected option "${option}" via ${data.source ?? 'uia'}`,
        data: { option, source: data.source ?? 'uia' },
      };
    } catch (err) {
      logger.debug('Windows UIAutomation dropdown selection failed', {
        option,
        label: input.name,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async tryWindowsActivateNamedRole(
    input: ComputerControlInput,
    roles: ElementRole[],
    successVerb: string,
  ): Promise<ToolResult> {
    const targetName = input.name ?? input.text;
    if (process.platform !== 'win32' || !targetName) {
      return { success: false, error: 'Windows UIAutomation direct path unavailable' };
    }

    const controlTypes = this.mapRolesToWindowsControlTypes(roles);
    if (controlTypes.length === 0) {
      return { success: false, error: 'No Windows UIAutomation role mapping for this action.' };
    }

    const payload = Buffer.from(JSON.stringify({
      targetName,
      exactName: input.exactName ?? false,
      requestedChecked: input.checked,
      windowTitle: input.windowTitle,
      windowTitleMatch: input.windowTitleMatch ?? 'contains',
      processName: input.processName,
      controlTypes,
    }), 'utf8').toString('base64');
    const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CodeBuddyMouse {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
}
'@
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$targetName = [string]$payload.targetName
$exactName = [bool]$payload.exactName
$hasRequestedChecked = $null -ne $payload.requestedChecked
$requestedChecked = if ($hasRequestedChecked) { [bool]$payload.requestedChecked } else { $false }
$windowTitle = [string]$payload.windowTitle
$windowTitleMatch = [string]$payload.windowTitleMatch
$processName = [string]$payload.processName
$controlTypes = @($payload.controlTypes | ForEach-Object { [string]$_ })
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

function Normalize([string]$value) {
  if ($null -eq $value) { return '' }
  return ($value.Trim() -replace '\\s+', ' ').ToLowerInvariant()
}

function Matches([string]$candidate, [string]$query, [bool]$exact) {
  $c = Normalize $candidate
  $q = Normalize $query
  if ($exact) { return $c -eq $q }
  return $c -eq $q -or $c.Contains($q)
}

function Get-Nodes($element, [int]$depth) {
  if ($null -eq $element -or $depth -gt 18) { return @() }
  $results = @()
  try {
    $rect = $element.Current.BoundingRectangle
    $results += [pscustomobject]@{
      Element = $element
      Name = [string]$element.Current.Name
      Role = [string]$element.Current.ControlType.ProgrammaticName
      X = [double]$rect.X
      Y = [double]$rect.Y
      Width = [double]$rect.Width
      Height = [double]$rect.Height
      Enabled = [bool]$element.Current.IsEnabled
      Offscreen = [bool]$element.Current.IsOffscreen
    }
    $child = $walker.GetFirstChild($element)
    while ($null -ne $child) {
      $results += Get-Nodes $child ($depth + 1)
      $child = $walker.GetNextSibling($child)
    }
  } catch {}
  return $results
}

function Resolve-Window {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = @(Get-Nodes $root 0 | Where-Object { $_.Role -eq 'ControlType.Window' -and -not $_.Offscreen })
  if ($windowTitle) {
    $matches = @($windows | Where-Object {
      if ($windowTitleMatch -eq 'equals') { (Normalize $_.Name) -eq (Normalize $windowTitle) }
      else { (Normalize $_.Name).Contains((Normalize $windowTitle)) }
    })
    if ($matches.Count -gt 0) {
      return ($matches | Sort-Object @{ Expression = { $_.Width * $_.Height } } -Descending | Select-Object -First 1).Element
    }
  }
  if ($processName) {
    foreach ($node in $windows) {
      try {
        $proc = Get-Process -Id $node.Element.Current.ProcessId -ErrorAction SilentlyContinue
        if ($proc -and (Normalize $proc.ProcessName).Contains((Normalize $processName))) {
          return $node.Element
        }
      } catch {}
    }
  }
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  $window = $focused
  while ($null -ne $window -and $window.Current.ControlType.ProgrammaticName -ne 'ControlType.Window') {
    $window = $walker.GetParent($window)
  }
  return $window
}

$window = Resolve-Window
if ($null -eq $window) { throw 'No target window found for semantic activation.' }
try {
  $hwndValue = [int64]$window.Current.NativeWindowHandle
  if ($hwndValue -ne 0) {
    $hwnd = [IntPtr]::new($hwndValue)
    [void][CodeBuddyMouse]::ShowWindowAsync($hwnd, 9)
    Start-Sleep -Milliseconds 80
    [void][CodeBuddyMouse]::BringWindowToTop($hwnd)
    [void][CodeBuddyMouse]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 120
  }
} catch {}
$nodes = @(Get-Nodes $window 0)
$candidates = @($nodes | Where-Object {
  $_.Enabled -and
  -not $_.Offscreen -and
  $_.Width -gt 0 -and
  $_.Height -gt 0 -and
  ($controlTypes -contains $_.Role) -and
  (Matches $_.Name $targetName $exactName)
})
function Make-Node($el) {
  try {
    $rect = $el.Current.BoundingRectangle
    return [pscustomobject]@{
      Element = $el
      Name = [string]$el.Current.Name
      Role = [string]$el.Current.ControlType.ProgrammaticName
      X = [double]$rect.X
      Y = [double]$rect.Y
      Width = [double]$rect.Width
      Height = [double]$rect.Height
      Enabled = [bool]$el.Current.IsEnabled
      Offscreen = [bool]$el.Current.IsOffscreen
    }
  } catch { return $null }
}

function Find-ItemContainers($element, [int]$depth) {
  if ($null -eq $element -or $depth -gt 8) { return @() }
  $results = @()
  try {
    if ([bool]$element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsItemContainerPatternAvailableProperty)) {
      $results += $element
    }
  } catch {}
  try {
    $child = $walker.GetFirstChild($element)
    while ($null -ne $child) {
      $results += Find-ItemContainers $child ($depth + 1)
      $child = $walker.GetNextSibling($child)
    }
  } catch {}
  return $results
}

function Find-VScroll($element, [int]$depth) {
  if ($null -eq $element -or $depth -gt 8) { return $null }
  try {
    if ([bool]$element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsScrollPatternAvailableProperty)) {
      $sp = $element.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern)
      if ($null -ne $sp -and $sp.Current.VerticallyScrollable) { return $element }
    }
  } catch {}
  try {
    $child = $walker.GetFirstChild($element)
    while ($null -ne $child) {
      $r = Find-VScroll $child ($depth + 1)
      if ($null -ne $r) { return $r }
      $child = $walker.GetNextSibling($child)
    }
  } catch {}
  return $null
}

function Realize-VirtualItem($root, [string]$name, [bool]$exact, $types) {
  # Primary path: ItemContainerPattern.FindItemByProperty (exact Name) -> Realize -> ScrollIntoView.
  foreach ($c in (Find-ItemContainers $root 0)) {
    try {
      $icp = $c.GetCurrentPattern([System.Windows.Automation.ItemContainerPattern]::Pattern)
      $found = $icp.FindItemByProperty($null, [System.Windows.Automation.AutomationElement]::NameProperty, $name)
      if ($null -ne $found) {
        try { $found.GetCurrentPattern([System.Windows.Automation.VirtualizedItemPattern]::Pattern).Realize() } catch {}
        Start-Sleep -Milliseconds 130
        try { $found.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView() } catch {}
        Start-Sleep -Milliseconds 130
        $node = Make-Node $found
        if ($null -ne $node -and ($types -contains $node.Role)) { return $node }
      }
    } catch {}
  }
  # Universal fallback: scroll the vertically-scrollable container top-to-bottom, re-walking
  # ONLY that container's subtree each page (cheap, avoids whole-window walk timeout). Diag to
  # %TEMP%\\cb-realize-diag.txt: VerticalScrollPercent per page => timeout vs scroll-no-op in one run.
  $scrollEl = Find-VScroll $root 0
  if ($null -ne $scrollEl) {
    $sp = $null
    try { $sp = $scrollEl.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern) } catch {}
    if ($null -ne $sp) {
      $diagPath = Join-Path $env:TEMP 'cb-realize-diag.txt'
      try { Set-Content -Path $diagPath -Value "target=$name" -ErrorAction SilentlyContinue } catch {}
      try { $sp.SetScrollPercent([System.Windows.Automation.ScrollPattern]::NoScroll, 0); Start-Sleep -Milliseconds 150 } catch {}
      $lastPct = -999.0
      for ($p = 0; $p -lt 200; $p++) {
        $nodes2 = @(Get-Nodes $scrollEl 0)
        $hit = @($nodes2 | Where-Object {
          $_.Enabled -and -not $_.Offscreen -and $_.Width -gt 0 -and $_.Height -gt 0 -and ($types -contains $_.Role) -and (Matches $_.Name $name $exact)
        })
        $vpct = -1.0
        try { $vpct = [double]$sp.Current.VerticalScrollPercent } catch {}
        try { Add-Content -Path $diagPath -Value "p=$p vpct=$([int]$vpct) nodes=$($nodes2.Count) hit=$($hit.Count)" -ErrorAction SilentlyContinue } catch {}
        if ($hit.Count -gt 0) { return ($hit | Select-Object -First 1) }
        if ($vpct -ge 100) { break }
        if ([Math]::Abs($vpct - $lastPct) -lt 0.01 -and $p -gt 0) { break }
        $lastPct = $vpct
        try { $sp.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, [System.Windows.Automation.ScrollAmount]::LargeIncrement) } catch { break }
        Start-Sleep -Milliseconds 150
      }
    }
  }
  return $null
}

if ($candidates.Count -eq 0) {
  $realized = Realize-VirtualItem $window $targetName $exactName $controlTypes
  if ($null -ne $realized) {
    $candidates = @($realized)
  } else {
    $available = @($nodes | Where-Object { $controlTypes -contains $_.Role } | Select-Object -First 12 | ForEach-Object { "$($_.Role):$($_.Name)" })
    throw "No semantic target '$targetName'. Available: $($available -join '; ')"
  }
}

$target = $candidates | Sort-Object @{ Expression = { [Math]::Abs($_.X) + [Math]::Abs($_.Y) } } | Select-Object -First 1
$source = 'uia'
try {
  $target.Element.SetFocus()
  Start-Sleep -Milliseconds 80
} catch {}

try {
  if ($target.Role -eq 'ControlType.CheckBox') {
    $toggle = $target.Element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    $before = [string]$toggle.Current.ToggleState
    $isChecked = $before -eq 'On'
    if ((-not $hasRequestedChecked) -or ($isChecked -ne $requestedChecked)) {
      $toggle.Toggle()
    }
    $source = 'uia-toggle'
  } else {
    $select = $target.Element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    $select.Select()
    $source = 'uia-selection'
    if ($target.Role -eq 'ControlType.ListItem') {
      $cx = [int]($target.X + ($target.Width / 2))
      $cy = [int]($target.Y + ($target.Height / 2))
      [CodeBuddyMouse]::SetCursorPos($cx, $cy) | Out-Null
      Start-Sleep -Milliseconds 50
      [CodeBuddyMouse]::mouse_event(0x0002, 0, 0, 0, 0)
      [CodeBuddyMouse]::mouse_event(0x0004, 0, 0, 0, 0)
      $source = 'uia-selection-mouse'
    }
  }
} catch {
  try {
    $invoke = $target.Element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
    $source = 'uia-invoke'
  } catch {
    try {
      $legacy = $target.Element.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
      $legacy.DoDefaultAction()
      $source = 'uia-legacy'
    } catch {
      try {
        $controlHwndValue = [int64]$target.Element.Current.NativeWindowHandle
        if ($controlHwndValue -eq 0) { throw 'Target has no native window handle.' }
        $controlHwnd = [IntPtr]::new($controlHwndValue)
        [void][CodeBuddyMouse]::SendMessage($controlHwnd, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
        $source = 'win32-bm-click'
      } catch {
        $cx = [int]($target.X + ($target.Width / 2))
        $cy = [int]($target.Y + ($target.Height / 2))
        [CodeBuddyMouse]::SetCursorPos($cx, $cy) | Out-Null
        Start-Sleep -Milliseconds 50
        [CodeBuddyMouse]::mouse_event(0x0002, 0, 0, 0, 0)
        [CodeBuddyMouse]::mouse_event(0x0004, 0, 0, 0, 0)
        $source = 'uia-mouse'
      }
    }
  }
}

[pscustomobject]@{
  source = $source
  name = $target.Name
  role = $target.Role
  bounds = [pscustomobject]@{
    x = $target.X
    y = $target.Y
    width = $target.Width
    height = $target.Height
  }
} | ConvertTo-Json -Compress
`;

    try {
      const stdout = await this.runPowerShellEncoded(script, 30000);
      const data = JSON.parse(stdout || '{}') as {
        source?: string;
        name?: string;
        role?: string;
        bounds?: unknown;
      };
      return {
        success: true,
        output: `${successVerb} ${data.role ?? 'element'} "${data.name ?? targetName}" via ${data.source ?? 'uia'}`,
        data: {
          source: data.source ?? 'uia',
          element: {
            name: data.name ?? targetName,
            role: data.role,
            bounds: data.bounds,
          },
        },
      };
    } catch (err) {
      logger.debug('Windows UIAutomation semantic activation failed', {
        targetName,
        roles,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async tryWindowsSetRangeValue(input: ComputerControlInput, value: number): Promise<ToolResult> {
    const targetName = input.name ?? input.text;
    if (process.platform !== 'win32' || !targetName) {
      return { success: false, error: 'Windows UIAutomation direct path unavailable' };
    }

    const payload = Buffer.from(JSON.stringify({
      targetName,
      value,
      exactName: input.exactName ?? false,
      windowTitle: input.windowTitle,
      windowTitleMatch: input.windowTitleMatch ?? 'contains',
      processName: input.processName,
    }), 'utf8').toString('base64');
    const script = `
Add-Type -AssemblyName UIAutomationClient
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$targetName = [string]$payload.targetName
$value = [double]$payload.value
$exactName = [bool]$payload.exactName
$windowTitle = [string]$payload.windowTitle
$windowTitleMatch = [string]$payload.windowTitleMatch
$processName = [string]$payload.processName
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

function Normalize([string]$value) {
  if ($null -eq $value) { return '' }
  return ($value.Trim() -replace '\\s+', ' ').ToLowerInvariant()
}

function Matches([string]$candidate, [string]$query, [bool]$exact) {
  $c = Normalize $candidate
  $q = Normalize $query
  if ($exact) { return $c -eq $q }
  return $c -eq $q -or $c.Contains($q)
}

function Get-Nodes($element, [int]$depth) {
  if ($null -eq $element -or $depth -gt 18) { return @() }
  $results = @()
  try {
    $rect = $element.Current.BoundingRectangle
    $results += [pscustomobject]@{
      Element = $element
      Name = [string]$element.Current.Name
      Role = [string]$element.Current.ControlType.ProgrammaticName
      X = [double]$rect.X
      Y = [double]$rect.Y
      Width = [double]$rect.Width
      Height = [double]$rect.Height
      Enabled = [bool]$element.Current.IsEnabled
      Offscreen = [bool]$element.Current.IsOffscreen
    }
    $child = $walker.GetFirstChild($element)
    while ($null -ne $child) {
      $results += Get-Nodes $child ($depth + 1)
      $child = $walker.GetNextSibling($child)
    }
  } catch {}
  return $results
}

function Resolve-Window {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = @(Get-Nodes $root 0 | Where-Object { $_.Role -eq 'ControlType.Window' -and -not $_.Offscreen })
  if ($windowTitle) {
    $matches = @($windows | Where-Object {
      if ($windowTitleMatch -eq 'equals') { (Normalize $_.Name) -eq (Normalize $windowTitle) }
      else { (Normalize $_.Name).Contains((Normalize $windowTitle)) }
    })
    if ($matches.Count -gt 0) {
      return ($matches | Sort-Object @{ Expression = { $_.Width * $_.Height } } -Descending | Select-Object -First 1).Element
    }
  }
  if ($processName) {
    foreach ($node in $windows) {
      try {
        $proc = Get-Process -Id $node.Element.Current.ProcessId -ErrorAction SilentlyContinue
        if ($proc -and (Normalize $proc.ProcessName).Contains((Normalize $processName))) {
          return $node.Element
        }
      } catch {}
    }
  }
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  $window = $focused
  while ($null -ne $window -and $window.Current.ControlType.ProgrammaticName -ne 'ControlType.Window') {
    $window = $walker.GetParent($window)
  }
  return $window
}

$window = Resolve-Window
if ($null -eq $window) { throw 'No target window found for slider action.' }
$nodes = @(Get-Nodes $window 0)
$candidates = @($nodes | Where-Object {
  $_.Enabled -and
  -not $_.Offscreen -and
  $_.Role -eq 'ControlType.Slider' -and
  (Matches $_.Name $targetName $exactName)
})
if ($candidates.Count -eq 0) { throw "No slider found matching '$targetName'." }

$target = $candidates | Select-Object -First 1
$range = $target.Element.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern)
$current = $range.Current
if ($current.IsReadOnly) { throw "Slider '$($target.Name)' is read-only." }
if ($value -lt $current.Minimum -or $value -gt $current.Maximum) {
  throw "Slider value $value outside range $($current.Minimum)-$($current.Maximum)."
}
$range.SetValue($value)

[pscustomobject]@{
  source = 'uia-range'
  name = $target.Name
  role = $target.Role
  value = $value
  minimum = $current.Minimum
  maximum = $current.Maximum
} | ConvertTo-Json -Compress
`;

    try {
      const stdout = await this.runPowerShellEncoded(script, 10000);
      const data = JSON.parse(stdout || '{}') as {
        source?: string;
        name?: string;
        role?: string;
        value?: number;
        minimum?: number;
        maximum?: number;
      };
      return {
        success: true,
        output: `Set slider "${data.name ?? targetName}" to ${data.value ?? value} via ${data.source ?? 'uia'}`,
        data: {
          source: data.source ?? 'uia',
          element: { name: data.name ?? targetName, role: data.role },
          value: data.value ?? value,
          min: data.minimum,
          max: data.maximum,
        },
      };
    } catch (err) {
      logger.debug('Windows UIAutomation slider action failed', {
        targetName,
        value,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async tryWindowsSetTreeItemExpansion(input: ComputerControlInput, expanded: boolean): Promise<ToolResult> {
    const targetName = input.name ?? input.text;
    if (process.platform !== 'win32' || !targetName) {
      return { success: false, error: 'Windows UIAutomation direct path unavailable' };
    }

    const payload = Buffer.from(JSON.stringify({
      targetName,
      expanded,
      exactName: input.exactName ?? false,
      windowTitle: input.windowTitle,
      windowTitleMatch: input.windowTitleMatch ?? 'contains',
      processName: input.processName,
    }), 'utf8').toString('base64');
    const script = `
Add-Type -AssemblyName UIAutomationClient
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$targetName = [string]$payload.targetName
$expanded = [bool]$payload.expanded
$exactName = [bool]$payload.exactName
$windowTitle = [string]$payload.windowTitle
$windowTitleMatch = [string]$payload.windowTitleMatch
$processName = [string]$payload.processName
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

function Normalize([string]$value) {
  if ($null -eq $value) { return '' }
  return ($value.Trim() -replace '\\s+', ' ').ToLowerInvariant()
}

function Matches([string]$candidate, [string]$query, [bool]$exact) {
  $c = Normalize $candidate
  $q = Normalize $query
  if ($exact) { return $c -eq $q }
  return $c -eq $q -or $c.Contains($q)
}

function Get-Nodes($element, [int]$depth) {
  if ($null -eq $element -or $depth -gt 18) { return @() }
  $results = @()
  try {
    $rect = $element.Current.BoundingRectangle
    $results += [pscustomobject]@{
      Element = $element
      Name = [string]$element.Current.Name
      Role = [string]$element.Current.ControlType.ProgrammaticName
      X = [double]$rect.X
      Y = [double]$rect.Y
      Width = [double]$rect.Width
      Height = [double]$rect.Height
      Enabled = [bool]$element.Current.IsEnabled
      Offscreen = [bool]$element.Current.IsOffscreen
    }
    $child = $walker.GetFirstChild($element)
    while ($null -ne $child) {
      $results += Get-Nodes $child ($depth + 1)
      $child = $walker.GetNextSibling($child)
    }
  } catch {}
  return $results
}

function Resolve-Window {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = @(Get-Nodes $root 0 | Where-Object { $_.Role -eq 'ControlType.Window' -and -not $_.Offscreen })
  if ($windowTitle) {
    $matches = @($windows | Where-Object {
      if ($windowTitleMatch -eq 'equals') { (Normalize $_.Name) -eq (Normalize $windowTitle) }
      else { (Normalize $_.Name).Contains((Normalize $windowTitle)) }
    })
    if ($matches.Count -gt 0) {
      return ($matches | Sort-Object @{ Expression = { $_.Width * $_.Height } } -Descending | Select-Object -First 1).Element
    }
  }
  if ($processName) {
    foreach ($node in $windows) {
      try {
        $proc = Get-Process -Id $node.Element.Current.ProcessId -ErrorAction SilentlyContinue
        if ($proc -and (Normalize $proc.ProcessName).Contains((Normalize $processName))) {
          return $node.Element
        }
      } catch {}
    }
  }
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  $window = $focused
  while ($null -ne $window -and $window.Current.ControlType.ProgrammaticName -ne 'ControlType.Window') {
    $window = $walker.GetParent($window)
  }
  return $window
}

$window = Resolve-Window
if ($null -eq $window) { throw 'No target window found for tree action.' }
$nodes = @(Get-Nodes $window 0)
$candidates = @($nodes | Where-Object {
  $_.Enabled -and
  -not $_.Offscreen -and
  $_.Role -eq 'ControlType.TreeItem' -and
  (Matches $_.Name $targetName $exactName)
})
if ($candidates.Count -eq 0) { throw "No tree item found matching '$targetName'." }

$target = $candidates | Select-Object -First 1
$pattern = $target.Element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
$before = [string]$pattern.Current.ExpandCollapseState
if ($expanded) {
  if ($before -ne 'Expanded' -and $before -ne 'LeafNode') { $pattern.Expand() }
} else {
  if ($before -ne 'Collapsed' -and $before -ne 'LeafNode') { $pattern.Collapse() }
}
$after = [string]$pattern.Current.ExpandCollapseState

[pscustomobject]@{
  source = 'uia-expand-collapse'
  name = $target.Name
  role = $target.Role
  before = $before
  after = $after
} | ConvertTo-Json -Compress
`;

    try {
      const stdout = await this.runPowerShellEncoded(script, 10000);
      const data = JSON.parse(stdout || '{}') as {
        source?: string;
        name?: string;
        role?: string;
        before?: string;
        after?: string;
      };
      return {
        success: true,
        output: `${expanded ? 'Expanded' : 'Collapsed'} tree item "${data.name ?? targetName}" via ${data.source ?? 'uia'}`,
        data: {
          source: data.source ?? 'uia',
          element: { name: data.name ?? targetName, role: data.role },
          before: data.before,
          after: data.after,
        },
      };
    } catch (err) {
      logger.debug('Windows UIAutomation tree action failed', {
        targetName,
        expanded,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private mapRolesToWindowsControlTypes(roles: ElementRole[]): string[] {
    const mapped = roles.flatMap((role) => {
      switch (role) {
        case 'button':
          return ['ControlType.Button'];
        case 'link':
          return ['ControlType.Hyperlink'];
        case 'radio':
          return ['ControlType.RadioButton'];
        case 'tab':
          return ['ControlType.TabItem'];
        case 'list-item':
          return ['ControlType.ListItem'];
        case 'slider':
          return ['ControlType.Slider'];
        case 'checkbox':
          return ['ControlType.CheckBox'];
        case 'tree':
          return ['ControlType.Tree'];
        case 'tree-item':
          return ['ControlType.TreeItem'];
        case 'menu':
        case 'menu-item':
          return ['ControlType.MenuItem'];
        default:
          return [];
      }
    });
    return [...new Set(mapped)];
  }

  private async readWindowsEditableText(input: ComputerControlInput): Promise<AppTextReadResult | ToolResult> {
    if (process.platform !== 'win32') {
      return { success: false, error: 'read_app_text/save_app_document are currently available on Windows only.' };
    }
    if (!this.hasWindowMatcher(input)) {
      return { success: false, error: 'A window matcher or app profile is required to read app text.' };
    }

    const payload = Buffer.from(JSON.stringify({
      windowTitle: input.windowTitle,
      windowTitleMatch: input.windowTitleMatch ?? 'contains',
      processName: input.processName,
      processNameMatch: input.processNameMatch ?? 'contains',
    }), 'utf8').toString('base64');
    const script = `
Add-Type -AssemblyName UIAutomationClient
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$windowTitle = [string]$payload.windowTitle
$windowTitleMatch = [string]$payload.windowTitleMatch
$processName = [string]$payload.processName
$processNameMatch = [string]$payload.processNameMatch
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

function Normalize([string]$value) {
  if ($null -eq $value) { return '' }
  return ($value.Trim() -replace '\\s+', ' ').ToLowerInvariant()
}

function Text-Matches([string]$candidate, [string]$query, [string]$mode) {
  $c = Normalize $candidate
  $q = Normalize $query
  if ([string]::IsNullOrWhiteSpace($q)) { return $true }
  if ($mode -eq 'equals') { return $c -eq $q }
  return $c.Contains($q)
}

function Get-Nodes($element, [int]$depth) {
  if ($null -eq $element -or $depth -gt 18) { return @() }
  $results = @()
  try {
    $rect = $element.Current.BoundingRectangle
    $results += [pscustomobject]@{
      Element = $element
      Name = [string]$element.Current.Name
      Role = [string]$element.Current.ControlType.ProgrammaticName
      X = [double]$rect.X
      Y = [double]$rect.Y
      Width = [double]$rect.Width
      Height = [double]$rect.Height
      Enabled = [bool]$element.Current.IsEnabled
      Offscreen = [bool]$element.Current.IsOffscreen
      ProcessId = [int]$element.Current.ProcessId
    }
    $child = $walker.GetFirstChild($element)
    while ($null -ne $child) {
      $results += Get-Nodes $child ($depth + 1)
      $child = $walker.GetNextSibling($child)
    }
  } catch {}
  return $results
}

function Resolve-Window {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = @(Get-Nodes $root 0 | Where-Object { $_.Role -eq 'ControlType.Window' -and -not $_.Offscreen -and $_.Width -gt 0 -and $_.Height -gt 0 })
  $matches = $windows
  if ($windowTitle) {
    $matches = @($matches | Where-Object { Text-Matches $_.Name $windowTitle $windowTitleMatch })
  }
  if ($processName) {
    $matches = @($matches | Where-Object {
      try {
        $proc = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
        $proc -and (Text-Matches $proc.ProcessName $processName $processNameMatch)
      } catch { $false }
    })
  }
  if ($matches.Count -gt 0) {
    return ($matches | Sort-Object @{ Expression = { $_.Width * $_.Height } } -Descending | Select-Object -First 1).Element
  }
  return $null
}

$window = Resolve-Window
if ($null -eq $window) { throw 'No matching text document window found.' }
$nodes = @(Get-Nodes $window 0)
$editable = @($nodes | Where-Object {
  $_.Enabled -and
  -not $_.Offscreen -and
  $_.Width -gt 0 -and
  $_.Height -gt 0 -and
  ($_.Role -in @('ControlType.Edit', 'ControlType.Document'))
} | Sort-Object @{ Expression = { $_.Width * $_.Height } } -Descending | Select-Object -First 1)
if ($editable.Count -eq 0) { throw 'No editable document control found in target window.' }

$target = $editable[0]
$text = ''
$source = 'uia-value-pattern'
try {
  $value = $target.Element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $text = [string]$value.Current.Value
} catch {
  try {
    $textPattern = $target.Element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
    $text = [string]$textPattern.DocumentRange.GetText(-1)
    $source = 'uia-text-pattern'
  } catch {
    throw 'Target editable control exposes neither ValuePattern nor TextPattern.'
  }
}

$proc = Get-Process -Id $window.Current.ProcessId -ErrorAction SilentlyContinue
[pscustomobject]@{
  source = $source
  text = $text
  role = $target.Role
  name = $target.Name
  windowTitle = [string]$window.Current.Name
  processName = if ($proc) { [string]$proc.ProcessName } else { '' }
  pid = [int]$window.Current.ProcessId
} | ConvertTo-Json -Compress
`;

    try {
      const stdout = await this.runPowerShellEncoded(script, 10000);
      const data = JSON.parse(stdout || '{}') as {
        source?: string;
        text?: string;
        role?: string;
        name?: string;
        windowTitle?: string;
        processName?: string;
        pid?: number;
      };
      return {
        success: true,
        text: data.text ?? '',
        source: data.source ?? 'uia',
        role: data.role,
        name: data.name,
        windowTitle: data.windowTitle ?? input.windowTitle ?? 'target window',
        processName: data.processName,
        pid: data.pid,
      };
    } catch (err) {
      logger.debug('Windows UIAutomation text read failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private isAppTextReadResult(result: AppTextReadResult | ToolResult): result is AppTextReadResult {
    return result.success === true
      && typeof (result as { text?: unknown }).text === 'string'
      && typeof (result as { windowTitle?: unknown }).windowTitle === 'string';
  }

  private async tryWindowsSetFocusedText(
    input: ComputerControlInput,
    text: string,
  ): Promise<ToolResult> {
    if (process.platform !== 'win32' || !this.hasWindowMatcher(input)) {
      return { success: false, error: 'Windows UIAutomation text set unavailable' };
    }

    const payload = Buffer.from(JSON.stringify({
      text,
      targetName: input.name,
      exactName: input.exactName,
      windowTitle: input.windowTitle,
      windowTitleMatch: input.windowTitleMatch ?? 'contains',
      processName: input.processName,
      processNameMatch: input.processNameMatch ?? 'contains',
    }), 'utf8').toString('base64');
    const script = `
Add-Type -AssemblyName UIAutomationClient
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$targetText = [string]$payload.text
$targetName = [string]$payload.targetName
$targetNameMatch = if ([bool]$payload.exactName) { 'equals' } else { 'contains' }
$windowTitle = [string]$payload.windowTitle
$windowTitleMatch = [string]$payload.windowTitleMatch
$processName = [string]$payload.processName
$processNameMatch = [string]$payload.processNameMatch
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

function Normalize([string]$value) {
  if ($null -eq $value) { return '' }
  return ($value.Trim() -replace '\\s+', ' ').ToLowerInvariant()
}

function Text-Matches([string]$candidate, [string]$query, [string]$mode) {
  $c = Normalize $candidate
  $q = Normalize $query
  if ($mode -eq 'equals') { return $c -eq $q }
  return $c.Contains($q)
}

function Get-Nodes($element, [int]$depth) {
  if ($null -eq $element -or $depth -gt 18) { return @() }
  $results = @()
  try {
    $rect = $element.Current.BoundingRectangle
    $results += [pscustomobject]@{
      Element = $element
      Name = [string]$element.Current.Name
      Role = [string]$element.Current.ControlType.ProgrammaticName
      X = [double]$rect.X
      Y = [double]$rect.Y
      Width = [double]$rect.Width
      Height = [double]$rect.Height
      Enabled = [bool]$element.Current.IsEnabled
      Offscreen = [bool]$element.Current.IsOffscreen
      ProcessId = [int]$element.Current.ProcessId
    }
    $child = $walker.GetFirstChild($element)
    while ($null -ne $child) {
      $results += Get-Nodes $child ($depth + 1)
      $child = $walker.GetNextSibling($child)
    }
  } catch {}
  return $results
}

function Resolve-Window {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = @(Get-Nodes $root 0 | Where-Object { $_.Role -eq 'ControlType.Window' -and -not $_.Offscreen })
  if ($windowTitle) {
    $matches = @($windows | Where-Object { Text-Matches $_.Name $windowTitle $windowTitleMatch })
    if ($matches.Count -gt 0) {
      return ($matches | Sort-Object @{ Expression = { $_.Width * $_.Height } } -Descending | Select-Object -First 1).Element
    }
  }
  if ($processName) {
    foreach ($node in $windows) {
      try {
        $proc = Get-Process -Id $node.ProcessId -ErrorAction SilentlyContinue
        if ($proc -and (Text-Matches $proc.ProcessName $processName $processNameMatch)) {
          return $node.Element
        }
      } catch {}
    }
  }
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  $window = $focused
  while ($null -ne $window -and $window.Current.ControlType.ProgrammaticName -ne 'ControlType.Window') {
    $window = $walker.GetParent($window)
  }
  return $window
}

$window = Resolve-Window
if ($null -eq $window) { throw 'No target window found for text entry.' }
$nodes = @(Get-Nodes $window 0)
$allEditable = @($nodes | Where-Object {
  $_.Enabled -and
  -not $_.Offscreen -and
  $_.Width -gt 0 -and
  $_.Height -gt 0 -and
  ($_.Role -in @('ControlType.Edit', 'ControlType.Document'))
})
if ($targetName) {
  $editable = @($allEditable | Where-Object { Text-Matches $_.Name $targetName $targetNameMatch } | Sort-Object @{ Expression = { $_.Width * $_.Height } } -Descending | Select-Object -First 1)
} else {
  $editable = @($allEditable | Sort-Object @{ Expression = { $_.Width * $_.Height } } -Descending | Select-Object -First 1)
}
if ($editable.Count -eq 0) { throw 'No editable control found in target window.' }

$target = $editable[0]
$target.Element.SetFocus()
Start-Sleep -Milliseconds 100
$value = $target.Element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$value.SetValue($targetText)

[pscustomobject]@{
  source = 'uia-value-pattern'
  role = $target.Role
  name = $target.Name
  textLength = $targetText.Length
} | ConvertTo-Json -Compress
`;

    try {
      const stdout = await this.runPowerShellEncoded(script, 10000);
      const data = JSON.parse(stdout || '{}') as {
        source?: string;
        role?: string;
        name?: string;
        textLength?: number;
      };
      return {
        success: true,
        output: `Set focused text via ${data.source ?? 'uia'} (${data.textLength ?? text.length} character(s))`,
        data: {
          source: data.source ?? 'uia',
          element: {
            role: data.role,
            name: data.name,
          },
          textLength: data.textLength ?? text.length,
        },
      };
    } catch (err) {
      logger.debug('Windows UIAutomation direct text set failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async resolveElementForIntent(
    input: ComputerControlInput,
    options: {
      roles?: ElementRole[];
      associatedRoles?: ElementRole[];
      query?: string;
      intent: string;
      requireInteractive: boolean;
      exactName?: boolean;
      forceRefresh?: boolean;
    },
  ): Promise<{ element?: UIElement; error?: string; refreshed: boolean }> {
    const hasTargetWindow = this.hasWindowMatcher(input);
    if (hasTargetWindow) {
      const focusResult = await this.focusWindow(input);
      if (!focusResult.success) {
        return {
          error: focusResult.error ?? focusResult.output ?? `Could not focus target window for ${options.intent}.`,
          refreshed: false,
        };
      }
      await this.delay(150);
    }

    if (input.ref !== undefined) {
      const element = this.snapshotManager.getElement(input.ref);
      if (!element) {
        return {
          error: `Element [${input.ref}] not found. Take a new snapshot first.`,
          refreshed: false,
        };
      }
      if (options.roles && !options.roles.includes(element.role)) {
        return {
          error: `Element [${input.ref}] is ${element.role}, expected ${options.roles.join(' or ')}.`,
          refreshed: false,
        };
      }
      return { element, refreshed: false };
    }

    const query = options.query?.trim();
    if (!query) {
      return {
        error: `${options.intent} requires ref, name, or text to identify the target element.`,
        refreshed: false,
      };
    }

    let refreshed = false;
    let elements = this.findElementsByIntent(query, options);
    let associated = elements.length === 0 ? this.findAssociatedElement(query, options) : undefined;
    if (associated) {
      return {
        element: associated,
        refreshed,
      };
    }

    if ((options.forceRefresh || hasTargetWindow || elements.length === 0) && !input.simulateOnly) {
      await this.snapshotManager.takeSnapshot({
        interactiveOnly: input.interactiveOnly ?? options.requireInteractive,
      });
      refreshed = true;
      elements = this.findElementsByIntent(query, options);
      associated = elements.length === 0 ? this.findAssociatedElement(query, options) : undefined;
      if (associated) {
        return {
          element: associated,
          refreshed,
        };
      }

      for (let attempt = 0; hasTargetWindow && elements.length === 0 && attempt < 2; attempt++) {
        const focusResult = await this.focusWindow(input);
        if (!focusResult.success) {
          return {
            error: focusResult.error ?? focusResult.output ?? `Could not refocus target window for ${options.intent}.`,
            refreshed,
          };
        }
        await this.delay(250 + attempt * 250);
        await this.snapshotManager.takeSnapshot({
          interactiveOnly: input.interactiveOnly ?? options.requireInteractive,
        });
        refreshed = true;
        elements = this.findElementsByIntent(query, options);
        associated = elements.length === 0 ? this.findAssociatedElement(query, options) : undefined;
        if (associated) {
          return {
            element: associated,
            refreshed,
          };
        }
      }
    }

    if (elements.length === 0) {
      // Try Visual Grounding Fallback if enabled and registered
      const isGroundingEnabled = process.env.CODEBUDDY_VISION_GROUNDING === '1' || process.env.CODEBUDDY_REAL_COMPUTER_USE === '1';
      if (isGroundingEnabled && visionGroundingProvider && !input.simulateOnly) {
        try {
          logger.info('Attempting visual grounding fallback for query', { query });
          const currentSnap = this.snapshotManager.getCurrentSnapshot();
          const candidates = (currentSnap?.elements ?? [])
            .filter((e) => e.interactive)
            .map((e) => ({
              ref: e.ref,
              role: e.role,
              name: e.name,
            }));

          const ann = await this.snapshotManager.toAnnotatedScreenshot({
            interactiveOnly: candidates.length > 0,
            crop: candidates.length > 0,
          });

          if (ann && ann.image) {
            const matchedRef = await visionGroundingProvider({
              imageBase64: ann.image,
              intent: query,
              roleHint: options.roles?.[0],
              candidates,
            });

            if (matchedRef !== null && matchedRef !== undefined) {
              if (typeof matchedRef === 'object' && 'x' in matchedRef && 'y' in matchedRef) {
                // The provider returned raw coordinates (e.g. from coordinates-based grounding).
                // Convert the normalised 0-1000 space to absolute pixels, rejecting
                // non-finite or out-of-range values so we never click off-screen.
                const absolute = resolveGroundingCoordinatesToAbsolute(matchedRef, currentSnap?.screenSize);
                if (absolute) {
                  const virtualEl: UIElement = {
                    ref: -999, // special virtual ref ID
                    role: options.roles?.[0] || 'unknown',
                    name: query,
                    bounds: { x: absolute.x, y: absolute.y, width: 0, height: 0 },
                    center: { x: absolute.x, y: absolute.y },
                    interactive: true,
                    focused: false,
                    enabled: true,
                    visible: true,
                    attributes: { source: 'visual-coordinates-grounding' }
                  };

                  if (currentSnap) {
                    currentSnap.elementMap.set(-999, virtualEl);
                  }

                  logger.info('Visual grounding fallback successfully matched direct coordinates', { x: absolute.x, y: absolute.y });
                  return {
                    element: virtualEl,
                    refreshed,
                  };
                }

                logger.warn('Visual grounding returned out-of-range coordinates; ignoring to avoid an off-screen click', {
                  matchedRef,
                });
              } else {
                const matchedEl = this.snapshotManager.getElement(matchedRef);
                if (matchedEl) {
                  // Validate matched element role if options.roles is specified
                  if (options.roles && !options.roles.includes(matchedEl.role)) {
                    logger.warn('Visual grounding matched element with invalid role', {
                      matchedRef,
                      matchedRole: matchedEl.role,
                      expectedRoles: options.roles,
                    });
                  } else {
                    logger.info('Visual grounding fallback successfully matched element', { matchedRef, name: matchedEl.name });
                    return {
                      element: matchedEl,
                      refreshed,
                    };
                  }
                }
              }
            }
          }
        } catch (err) {
          logger.error('Failed executing visual grounding fallback', { error: err });
        }
      }

      const roleHint = options.roles?.length ? ` with role ${options.roles.join('|')}` : '';
      return {
        error: `No element${roleHint} found matching "${query}".`,
        refreshed,
      };
    }

    return {
      element: this.rankElementMatch(elements, query, options),
      refreshed,
    };
  }

  private findElementsByIntent(
    query: string,
    options: {
      roles?: ElementRole[];
      associatedRoles?: ElementRole[];
      requireInteractive: boolean;
      exactName?: boolean;
    },
  ): UIElement[] {
    const snapshot = this.snapshotManager.getCurrentSnapshot();
    if (!snapshot) return [];

    const normalizedQuery = this.normalizeElementText(query);
    return snapshot.elements.filter((element) => {
      if (options.roles && !options.roles.includes(element.role)) return false;
      if (!element.visible) return false;
      if (options.requireInteractive && (!element.interactive || !element.enabled)) return false;

      const candidates = [
        element.name,
        element.description,
        element.value,
        element.placeholder,
      ].filter((value): value is string => typeof value === 'string' && value.length > 0);

      return candidates.some((candidate) => {
        const normalizedCandidate = this.normalizeElementText(candidate);
        if (options.exactName) return normalizedCandidate === normalizedQuery;
        return normalizedCandidate === normalizedQuery || normalizedCandidate.includes(normalizedQuery);
      });
    });
  }

  private findAssociatedElement(
    query: string,
    options: {
      roles?: ElementRole[];
      associatedRoles?: ElementRole[];
      requireInteractive: boolean;
      exactName?: boolean;
    },
  ): UIElement | undefined {
    const snapshot = this.snapshotManager.getCurrentSnapshot();
    if (!snapshot) return undefined;

    const labels = this.findElementsByIntent(query, {
      roles: undefined,
      requireInteractive: false,
      exactName: options.exactName,
    }).filter((element) => !(options.roles ?? []).includes(element.role));

    const candidateRoles = options.associatedRoles ?? options.roles ?? [];
    if (labels.length === 0 || candidateRoles.length === 0) return undefined;

    const candidates = snapshot.elements.filter((element) => {
      if (!candidateRoles.includes(element.role)) return false;
      if (!element.visible) return false;
      if (options.requireInteractive && !element.enabled) return false;
      return true;
    });

    const ranked: Array<{ element: UIElement; score: number }> = [];
    for (const label of labels) {
      for (const element of candidates) {
        if (element.ref === label.ref) continue;
        const vertical = element.center.y - label.center.y;
        if (vertical < -8) continue;
        const horizontal = Math.abs(element.center.x - label.center.x);
        ranked.push({
          element,
          score: vertical + horizontal * 0.35 + element.ref * 0.001,
        });
      }
    }

    ranked.sort((a, b) => a.score - b.score);
    return ranked[0]?.element;
  }

  private rankElementMatch(
    elements: UIElement[],
    query: string,
    options: { roles?: ElementRole[] },
  ): UIElement {
    const normalizedQuery = this.normalizeElementText(query);
    const scored = elements.map((element) => {
      const normalizedName = this.normalizeElementText(element.name);
      let score = 0;
      if (normalizedName === normalizedQuery) score += 100;
      if (normalizedName.startsWith(normalizedQuery)) score += 40;
      if (element.interactive) score += 20;
      if (options.roles?.[0] === element.role) score += 10;
      if (element.focused) score += 5;
      return { element, score };
    });

    scored.sort((a, b) => b.score - a.score || a.element.ref - b.element.ref);
    return scored[0]!.element;
  }

  private async selectFocusedText(): Promise<void> {
    const modifier: ModifierKey = process.platform === 'darwin' ? 'meta' : 'ctrl';
    await this.automation.keyPress('a', { modifiers: [modifier] });
    await this.delay(50);
  }

  private getElementCheckedState(element: UIElement): boolean | null {
    const attrs = element.attributes ?? {};
    const candidates = [
      element.value,
      attrs.checked,
      attrs['aria-checked'],
      attrs.toggleState,
      attrs.ToggleState,
      attrs['Toggle.ToggleState'],
      attrs.IsChecked,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'boolean') return candidate;
      if (typeof candidate === 'number') return candidate > 0;
      if (typeof candidate !== 'string') continue;

      const value = candidate.toLowerCase();
      if (['true', 'checked', 'on', '1', 'yes'].includes(value)) return true;
      if (['false', 'unchecked', 'off', '0', 'no'].includes(value)) return false;
    }

    return null;
  }

  private getElementExpandedState(element: UIElement): boolean | null {
    const attrs = element.attributes ?? {};
    const candidates = [
      element.value,
      attrs.expanded,
      attrs['aria-expanded'],
      attrs.expandCollapseState,
      attrs.ExpandCollapseState,
      attrs['ExpandCollapse.ExpandCollapseState'],
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'boolean') return candidate;
      if (typeof candidate === 'number') return candidate > 0;
      if (typeof candidate !== 'string') continue;

      const value = candidate.toLowerCase();
      if (['true', 'expanded', 'leafnode', '1', 'yes'].includes(value)) return true;
      if (['false', 'collapsed', '0', 'no'].includes(value)) return false;
    }

    return null;
  }

  private parseNumericControlValue(input: ComputerControlInput, action: string): number | undefined {
    const raw = input.value ?? input.level ?? input.text;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim() !== '') {
      const value = Number(raw);
      if (Number.isFinite(value)) return value;
    }
    logger.debug('Numeric control action missing numeric value', { action, raw });
    return undefined;
  }

  private getNumericAttribute(element: UIElement, keys: string[]): number | undefined {
    const attrs = element.attributes ?? {};
    for (const key of keys) {
      const value = attrs[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return undefined;
  }

  private describeElement(element: UIElement): string {
    return `[${element.ref}] ${element.role} "${element.name}"`;
  }

  private normalizeElementText(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private async executeMacro(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.steps || !Array.isArray(input.steps) || input.steps.length === 0) {
      return { success: false, error: 'Macro requires a non-empty array of steps' };
    }

    const results: Array<{ action: ComputerAction; result: ToolResult }> = [];
    let allSuccess = true;

    for (const step of input.steps) {
      const stepInput = this.enrichWorkflowStep(input, step);
      // Do not allow nested macros
      if (stepInput.action === 'macro' || stepInput.action === 'use_app_workflow') {
        return { success: false, error: 'Nested macros are not allowed' };
      }

      // We need to execute the step using the main entry point to ensure
      // logging, auditing, and pilot modes apply to each step individually
      const stepResult = await this.execute(stepInput);
      results.push({ action: stepInput.action, result: stepResult });

      if (!stepResult.success) {
        allSuccess = false;
        break; // Stop on first failure
      }
    }

    const failedIndex = results.findIndex((entry) => !entry.result.success);
    const failed = failedIndex >= 0 ? results[failedIndex] : undefined;

    return {
      success: allSuccess,
      output: allSuccess
        ? `Executed macro with ${results.length} steps. Success: true`
        : `Executed macro with ${results.length} steps. Failed at step ${failedIndex + 1} (${failed?.action ?? 'unknown'}).`,
      error: failed
        ? `Step ${failedIndex + 1} (${failed.action}) failed: ${failed.result.error ?? failed.result.output ?? 'unknown error'}`
        : undefined,
      data: {
        macroResults: results,
        failedStep: failed ? {
          index: failedIndex + 1,
          action: failed.action,
          error: failed.result.error,
          output: failed.result.output,
        } : undefined,
      },
    };
  }

  private enrichWorkflowStep(parent: ComputerControlInput, step: ComputerControlInput): ComputerControlInput {
    if (!parent.appName) return step;

    const profile = resolveApplicationProfile(parent.appName);
    if (!profile) return step;

    const next: ComputerControlInput = { ...step };
    if (parent.visualContext && next.visualContext === undefined) {
      next.visualContext = parent.visualContext;
    }

    if ((next.action === 'open_app' || next.action === 'focus_app' || next.action === 'read_app_text' || next.action === 'save_app_document') && !next.appName) {
      next.appName = parent.appName;
    }
    if ((next.action === 'focus_app' || next.action === 'read_app_text' || next.action === 'save_app_document') && !next.filePath && parent.filePath) {
      next.filePath = parent.filePath;
    }

    if (!this.stepCanUseProfileWindow(next.action) || this.hasWindowMatcher(next)) {
      return next;
    }

    const [processName] = profile.processNames;
    const [titleHint] = profile.titleHints;
    if (processName) {
      next.processName = processName;
      next.processNameMatch = 'contains';
    } else if (titleHint) {
      next.windowTitle = titleHint;
      next.windowTitleMatch = 'contains';
    }

    return next;
  }

  private stepCanUseProfileWindow(action: ComputerAction): boolean {
    return new Set<ComputerAction>([
      'click_element_by_name',
      'click_button',
      'click_link',
      'fill_text_field',
      'clear_and_type',
      'select_dropdown_option',
      'select_radio',
      'activate_tab',
      'select_list_item',
      'open_menu_item',
      'toggle_checkbox',
      'assert_text_visible',
      'assert_element_visible',
      'inspect_dialog',
      'click_dialog_button',
      'handle_dialog',
      'read_app_text',
      'save_app_document',
      'click_text',
      'wait_for_text',
      'type',
      'key',
      'key_down',
      'key_up',
      'hotkey',
    ]).has(action);
  }

  // ============================================================================
  // Macro / Record Actions
  // ============================================================================

  private async saveMacro(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.macroName || !input.steps) {
      return { success: false, error: 'macroName and steps are required for save_macro' };
    }
    const { MacroManager } = await import('./macro-manager.js');
    await MacroManager.getInstance().saveMacro(input.macroName, input.steps, input.macroDescription);
    return {
      success: true,
      output: `Macro "${input.macroName}" saved successfully with ${input.steps.length} steps.`,
    };
  }

  private async playMacro(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.macroName) {
      return { success: false, error: 'macroName is required for play_macro' };
    }
    const { MacroManager } = await import('./macro-manager.js');
    const macro = await MacroManager.getInstance().loadMacro(input.macroName);
    if (!macro) {
      return { success: false, error: `Macro "${input.macroName}" not found.` };
    }

    logger.debug(`Playing macro: ${input.macroName} (${macro.steps.length} steps)`);
    // Re-use executeMacro logic by passing the loaded steps
    return this.executeMacro({ ...input, action: 'macro', steps: macro.steps });
  }

  private async listMacros(): Promise<ToolResult> {
    const { MacroManager } = await import('./macro-manager.js');
    const macros = await MacroManager.getInstance().listMacros();
    
    if (macros.length === 0) {
      return { success: true, output: 'No macros found.' };
    }

    const output = macros.map(m => `- ${m.name} (${m.steps.length} steps): ${m.description || 'No description'}`).join('\n');
    return {
      success: true,
      output: `Found ${macros.length} macros:\n${output}`,
      data: { macros }
    };
  }

  private async deleteMacro(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.macroName) {
      return { success: false, error: 'macroName is required for delete_macro' };
    }
    const { MacroManager } = await import('./macro-manager.js');
    const deleted = await MacroManager.getInstance().deleteMacro(input.macroName);
    
    if (!deleted) {
      return { success: false, error: `Macro "${input.macroName}" not found.` };
    }
    
    return { success: true, output: `Macro "${input.macroName}" deleted.` };
  }

  // ============================================================================
  // OCR Actions
  // ============================================================================

  private async waitForText(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.text) {
      return { success: false, error: 'text is required for wait_for_text action' };
    }

    const timeoutMs = input.timeoutMs || 30000;
    const pollIntervalMs = input.pollIntervalMs || 2000;
    const startTime = Date.now();

    logger.debug(`Starting visual polling for text: "${input.text}" (timeout: ${timeoutMs}ms)`);

    while (Date.now() - startTime < timeoutMs) {
      // 1. Try CDP Fast-Path (Temporarily disabled due to missing SystemControl.getActiveWindow)
      /*
      try {
        const activeWindow = (await this.systemControl as any).getActiveWindow?.();
        if (activeWindow && (activeWindow.title.includes('Google Chrome') || activeWindow.title.includes('Edge'))) {
          const { BrowserTool } = await import('./browser/playwright-tool.js');
          const pwTool = BrowserTool.getInstance();
          await pwTool.connectToExistingBrowser('http://localhost:9222');
          
          const found = await pwTool.evaluate(`!!document.body.innerText.includes(${JSON.stringify(input.text)})`);
          if (found) {
             return {
               success: true,
               output: `Detected text "${input.text}" via CDP after ${Date.now() - startTime}ms`,
               data: { text: input.text, source: 'cdp', durationMs: Date.now() - startTime }
             };
          }
        }
      } catch (err) {
         logger.debug('CDP polling failed', { error: err });
      }
      */

      try {
        const { UnifiedVfsRouter } = await import('../services/vfs/unified-vfs-router.js');
        const path = await import('path');
        const tempDir = path.join(process.cwd(), '.codebuddy', 'temp');
        try { await UnifiedVfsRouter.Instance.ensureDir(tempDir); } catch { /* best-effort */ }
        const snapshotPath = path.join(tempDir, `ocr_snapshot_${Date.now()}.png`);
        
        const { ScreenshotTool } = await import('./screenshot-tool.js');
        const screenshotTool = new ScreenshotTool();
        await screenshotTool.capture({ outputPath: snapshotPath });
        
        const { OCRTool } = await import('./ocr-tool.js');
        const ocr = new OCRTool();
        const ocrResult = await ocr.extractText(snapshotPath);
        
        try { await UnifiedVfsRouter.Instance.remove(snapshotPath); } catch { /* best-effort cleanup */ }

        const ocrData = ocrResult.data as { text?: string } | undefined;
        if (ocrResult.success && ocrData?.text?.toLowerCase().includes(input.text.toLowerCase())) {
           return {
             success: true,
             output: `Detected text "${input.text}" via OCR after ${Date.now() - startTime}ms`,
             data: { text: input.text, source: 'ocr', durationMs: Date.now() - startTime }
           };
        }
      } catch (err) {
         logger.debug('OCR check failed during polling', { error: err });
      }

      await this.delay(pollIntervalMs);
    }

    return {
      success: false,
      error: `Timeout: text "${input.text}" did not appear after ${timeoutMs}ms.`
    };
  }

  // ============================================================================
  // Voice Actions
  // ============================================================================

  private async speakText(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.text) {
      return { success: false, error: 'text is required for speak action' };
    }
    
    try {
      const { exec } = await import('child_process');
      const script = `Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Speak("${input.text.replace(/"/g, '""')}")`;
      
      await new Promise<void>((resolve, reject) => {
        exec(`powershell -NoProfile -Command "${script}"`, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      
      return { success: true, output: `Spoke: "${input.text}"` };
    } catch (err) {
      return { success: false, error: `Failed to speak text: ${err}` };
    }
  }

  private async clickText(input: ComputerControlInput): Promise<ToolResult> {
    if (!input.text) {
      return { success: false, error: 'text is required for click_text action' };
    }

    // Phase 4: CDP / Web DOM Fast-Path (Temporarily disabled due to missing SystemControl.getActiveWindow)
    /*
    try {
      const activeWindow = (await this.systemControl as any).getActiveWindow?.();
      if (activeWindow && (activeWindow.title.includes('Google Chrome') || activeWindow.title.includes('Edge'))) {
        const { BrowserTool } = await import('./browser/playwright-tool.js');
        const pwTool = BrowserTool.getInstance();
        
        await pwTool.connectToExistingBrowser('http://localhost:9222');
        await pwTool.findAndClickText(input.text);
        
        return {
          success: true,
          output: `Clicked text "${input.text}" via CDP (Playwright)`,
          data: { click: { text: input.text, source: 'cdp' } }
        };
      }
    } catch (err) {
      logger.debug('CDP connect/click failed, falling back to OCR', { error: err });
    }
    */

    // Phase 3: OCR Fallback
    // 1. Take snapshot
    const { UnifiedVfsRouter } = await import('../services/vfs/unified-vfs-router.js');
    const path = await import('path');
    const tempDir = path.join(process.cwd(), '.codebuddy', 'temp');
    try { await UnifiedVfsRouter.Instance.ensureDir(tempDir); } catch { /* best-effort */ }
    const snapshotPath = path.join(tempDir, `ocr_snapshot_${Date.now()}.png`);
    const { ScreenshotTool } = await import('./screenshot-tool.js');
    const screenshotTool = new ScreenshotTool();
    const screenshotResult = await screenshotTool.capture({ outputPath: snapshotPath });
    
    if (!screenshotResult.success) {
      return { success: false, error: `Failed to take screenshot for OCR: ${screenshotResult.error}` };
    }

    // 2. Run OCR
    const { OCRTool } = await import('./ocr-tool.js');
    const ocrTool = new OCRTool();
    const ocrResult = await ocrTool.extractText(snapshotPath);
    
    // Clean up
    try { await UnifiedVfsRouter.Instance.remove(snapshotPath); } catch { /* best-effort cleanup */ }

    if (!ocrResult.success || !ocrResult.data) {
      return { success: false, error: `OCR failed: ${ocrResult.error || 'No data returned'}` };
    }

    const ocrData = ocrResult.data as import('./ocr-tool.js').OCRResult;
    if (!ocrData.blocks) {
      return { success: false, error: `No text blocks found on screen.` };
    }

    // 3. Find matching text (case insensitive, partial match, supporting multi-word sequences)
    const target = input.text.toLowerCase().trim();
    const targetWords = target.split(/\s+/).filter(Boolean);

    let matchBox: { x: number; y: number; width: number; height: number } | null = null;

    if (targetWords.length > 1) {
      // Look for a sequence of blocks that match the target words in order
      for (let i = 0; i <= ocrData.blocks.length - targetWords.length; i++) {
        let isMatch = true;
        const candidateBlocks: typeof ocrData.blocks = [];

        for (let j = 0; j < targetWords.length; j++) {
          const word = targetWords[j];
          const block = ocrData.blocks[i + j];
          if (!word || !block || !block.text || !block.text.toLowerCase().includes(word)) {
            isMatch = false;
            break;
          }
          candidateBlocks.push(block);
        }

        const firstBox = candidateBlocks[0]?.boundingBox;
        if (isMatch && firstBox && candidateBlocks.every(b => b.boundingBox)) {
          // Check if they are approximately on the same line (y coordinates similar)
          const sameLine = candidateBlocks.every(b => {
            const dy = Math.abs(b.boundingBox!.y - firstBox.y);
            // Allow vertical alignment error up to 70% of the box height
            return dy <= firstBox.height * 0.7;
          });

          if (sameLine) {
            // Merge bounding boxes
            const minX = Math.min(...candidateBlocks.map(b => b.boundingBox!.x));
            const minY = Math.min(...candidateBlocks.map(b => b.boundingBox!.y));
            const maxX = Math.max(...candidateBlocks.map(b => b.boundingBox!.x + b.boundingBox!.width));
            const maxY = Math.max(...candidateBlocks.map(b => b.boundingBox!.y + b.boundingBox!.height));

            matchBox = {
              x: minX,
              y: minY,
              width: maxX - minX,
              height: maxY - minY
            };
            break;
          }
        }
      }
    } else if (targetWords.length === 1) {
      const targetWord = targetWords[0];
      const match = targetWord
        ? ocrData.blocks.find(b => b.text && b.text.toLowerCase().includes(targetWord))
        : undefined;
      if (match && match.boundingBox) {
        matchBox = match.boundingBox;
      }
    }

    if (!matchBox) {
      return { success: false, error: `Text "${input.text}" not found on screen.` };
    }

    // 4. Calculate center and click
    const centerX = matchBox.x + Math.round(matchBox.width / 2);
    const centerY = matchBox.y + Math.round(matchBox.height / 2);

    const resolved = await this.resolvePoint({ action: 'click_text', x: centerX, y: centerY });
    if (resolved) {
      await this.automation.moveMouse(resolved.x, resolved.y);
      await this.automation.click(undefined, undefined, { button: 'left' });
      return { 
        success: true, 
        output: `Clicked text "${input.text}" at ${centerX}, ${centerY}`,
        data: { click: { x: centerX, y: centerY } }
      };
    }

    return { success: false, error: 'Could not resolve point' };
  }

  /**
   * Translate technical errors into AI-friendly messages (Enterprise-grade)
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

  private async focusAndVerifyTarget(input: ComputerControlInput): Promise<ToolResult | null> {
    this.lastTargetFocusProof = null;
    this.lastVisualContextProof = null;
    const focusResult = await this.focusWindow(input);
    if (!focusResult.success) return focusResult;
    await this.delay(150);

    const windows = await this.automation.getWindows();
    const titleRegex = this.parseTitleRegex(input);
    const focused = windows.find(window => window.focused);

    if (this.matchesWindowInput(focused ?? null, input, titleRegex)) {
      this.lastTargetFocusProof = {
        focused: focused ? this.windowProof(focused) : undefined,
        verifiedBy: 'window-list',
      };
      await this.collectVisualContextIfRequested(input);
      return null;
    }

    const foreground = await this.getWindowsForegroundWindow();
    if (this.matchesWindowInput(foreground, input, titleRegex)) {
      this.lastTargetFocusProof = {
        focused: focused ? this.windowProof(focused) : undefined,
        foreground: foreground ? this.windowProof(foreground) : undefined,
        verifiedBy: 'foreground-window',
      };
      await this.collectVisualContextIfRequested(input);
      return null;
    }

    const matched = windows.find(window => this.matchesWindowInput(window, input, titleRegex));
    if (matched) {
      await this.tryWindowsForceForeground(matched);
      await this.delay(250);
      const forcedForeground = await this.getWindowsForegroundWindow();
      if (this.matchesWindowInput(forcedForeground, input, titleRegex)) {
        this.lastTargetFocusProof = {
          focused: focused ? this.windowProof(focused) : undefined,
          foreground: forcedForeground ? this.windowProof(forcedForeground) : undefined,
          matched: this.windowProof(matched),
          verifiedBy: 'foreground-window',
        };
        await this.collectVisualContextIfRequested(input);
        return null;
      }
      if (this.windowTitlesCorrelate(forcedForeground, matched)) {
        this.lastTargetFocusProof = {
          focused: focused ? this.windowProof(focused) : undefined,
          foreground: forcedForeground ? this.windowProof(forcedForeground) : undefined,
          matched: this.windowProof(matched),
          verifiedBy: 'foreground-title-correlation',
        };
        await this.collectVisualContextIfRequested(input);
        return null;
      }
    }

    return {
      success: false,
      error: (
        `Refusing keyboard/text action because target focus was not verified. ` +
        `Expected ${this.describeWindowMatcher(input)}; ` +
        `focused=${focused ? `"${focused.title}" (${focused.processName})` : 'none'}; ` +
        `foreground=${foreground ? `"${foreground.title}" (${foreground.processName})` : 'unknown'}; ` +
        `matched=${matched ? `"${matched.title}" (${matched.processName})` : 'none'}.`
      ),
    };
  }

  private async tryWindowsForceForeground(window: WindowInfo): Promise<void> {
    if (process.platform !== 'win32' || !window.handle) return;

    const payload = Buffer.from(JSON.stringify({
      handle: window.handle,
      pid: window.pid,
    }), 'utf8').toString('base64');
    const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CodeBuddyForceForeground {
  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("kernel32.dll")]
  public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
}
'@
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$raw = [string]$payload.handle
$handleValue = 0L
if ($raw.StartsWith('0x')) {
  $handleValue = [Convert]::ToInt64($raw.Substring(2), 16)
} else {
  [void][Int64]::TryParse($raw, [ref]$handleValue)
}
if ($handleValue -eq 0 -and $payload.pid) {
  $proc = Get-Process -Id ([int]$payload.pid) -ErrorAction SilentlyContinue
  if ($proc) { $handleValue = [int64]$proc.MainWindowHandle }
}
if ($handleValue -eq 0) { exit 0 }
$hwnd = [IntPtr]::new($handleValue)
[void][CodeBuddyForceForeground]::ShowWindowAsync($hwnd, 9)
Start-Sleep -Milliseconds 80
$foreground = [CodeBuddyForceForeground]::GetForegroundWindow()
$foregroundPid = [uint32]0
$targetPid = [uint32]0
$foregroundThread = if ($foreground -ne [IntPtr]::Zero) {
  [CodeBuddyForceForeground]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
} else { 0 }
$targetThread = [CodeBuddyForceForeground]::GetWindowThreadProcessId($hwnd, [ref]$targetPid)
$currentThread = [CodeBuddyForceForeground]::GetCurrentThreadId()
if ($foregroundThread -ne 0) { [void][CodeBuddyForceForeground]::AttachThreadInput($currentThread, $foregroundThread, $true) }
if ($targetThread -ne 0) { [void][CodeBuddyForceForeground]::AttachThreadInput($currentThread, $targetThread, $true) }
try {
  [void][CodeBuddyForceForeground]::BringWindowToTop($hwnd)
  [void][CodeBuddyForceForeground]::SetActiveWindow($hwnd)
  [void][CodeBuddyForceForeground]::SetFocus($hwnd)
  [void][CodeBuddyForceForeground]::SetForegroundWindow($hwnd)
} finally {
  if ($targetThread -ne 0) { [void][CodeBuddyForceForeground]::AttachThreadInput($currentThread, $targetThread, $false) }
  if ($foregroundThread -ne 0) { [void][CodeBuddyForceForeground]::AttachThreadInput($currentThread, $foregroundThread, $false) }
}
`;

    try {
      await this.runPowerShellEncoded(script, 5000);
    } catch (err) {
      logger.debug('Failed to force Windows foreground window', {
        title: window.title,
        processName: window.processName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private windowProof(window: WindowInfo): Pick<WindowInfo, 'handle' | 'title' | 'pid' | 'processName'> {
    return {
      handle: window.handle,
      title: window.title,
      pid: window.pid,
      processName: window.processName,
    };
  }

  private windowTitlesCorrelate(foreground: WindowInfo | null, matched: WindowInfo | null): boolean {
    if (!foreground || !matched) return false;
    const a = this.normalizeWindowTitleForCorrelation(foreground.title);
    const b = this.normalizeWindowTitleForCorrelation(matched.title);
    if (!a || !b) return false;
    return a === b || a.includes(b) || b.includes(a);
  }

  private normalizeWindowTitleForCorrelation(value: string): string {
    return value
      .trim()
      .replace(/[–—]/g, '-')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private async collectVisualContextIfRequested(input: ComputerControlInput): Promise<void> {
    if (!input.visualContext) return;

    const proof: VisualContextProof = {};

    try {
      const snapshot = await this.snapshotManager.takeSnapshot({ interactiveOnly: false });
      proof.snapshotText = this.snapshotManager.toTextRepresentation(snapshot);
    } catch (err) {
      proof.snapshotError = err instanceof Error ? err.message : String(err);
    }

    try {
      const { ScreenshotTool } = await import('./screenshot-tool.js');
      const screenshotTool = new ScreenshotTool();
      const screenshot = await screenshotTool.capture({ fullscreen: true, format: 'png' });
      const screenshotData = screenshot.data as { path?: string } | undefined;
      if (!screenshot.success || !screenshotData?.path) {
        proof.ocrError = screenshot.error ?? 'Screenshot did not return a path.';
      } else {
        proof.screenshotPath = screenshotData.path;
        const { OCRTool } = await import('./ocr-tool.js');
        const ocr = new OCRTool();
        const ocrResult = await ocr.extractText(screenshotData.path, { psm: 6 });
        const ocrData = ocrResult.data as { text?: string } | undefined;
        if (ocrResult.success && ocrData?.text) {
          proof.ocrText = ocrData.text.slice(0, 2000);
        } else {
          proof.ocrError = ocrResult.error ?? 'OCR returned no text.';
        }
      }
    } catch (err) {
      proof.ocrError = err instanceof Error ? err.message : String(err);
    }

    this.lastVisualContextProof = proof;
  }

  private async getWindowsForegroundWindow(): Promise<WindowInfo | null> {
    if (process.platform !== 'win32') return null;

    const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CodeBuddyForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
$handle = [CodeBuddyForegroundWindow]::GetForegroundWindow()
if ($handle -eq [IntPtr]::Zero) { '{}' | Write-Output; exit 0 }
$text = New-Object System.Text.StringBuilder 1024
[void][CodeBuddyForegroundWindow]::GetWindowText($handle, $text, $text.Capacity)
$pid = [uint32]0
[void][CodeBuddyForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$pid)
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
[pscustomobject]@{
  handle = [string]$handle.ToInt64()
  title = [string]$text.ToString()
  pid = [int]$pid
  processName = if ($proc) { [string]$proc.ProcessName } else { '' }
} | ConvertTo-Json -Compress
`;

    try {
      const stdout = await this.runPowerShellEncoded(script, 5000);
      const data = JSON.parse(stdout || '{}') as {
        handle?: string;
        title?: string;
        pid?: number;
        processName?: string;
      };
      if (!data.handle) return null;
      return {
        handle: data.handle,
        title: data.title ?? '',
        pid: data.pid ?? 0,
        processName: data.processName ?? '',
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        focused: true,
        visible: true,
        minimized: false,
        maximized: false,
        fullscreen: false,
      };
    } catch (err) {
      logger.debug('Failed to inspect Windows foreground window', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private buildTargetProofData(): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    if (this.lastTargetFocusProof) data.targetFocus = this.lastTargetFocusProof;
    if (this.lastVisualContextProof) data.visualContext = this.lastVisualContextProof;
    return data;
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
    // policy === 'confirm'
    if (input.simulateOnly) return null; // a dry-run applies no system changes

    // S5: give the confirmation real teeth via the active permission mode instead
    // of trusting the model-set `confirmDangerous` flag alone (a prompt-injected
    // model can set it). A read-only posture (plan mode) must NEVER mutate the
    // desktop; full-auto postures (bypass/dontAsk) pre-approve; otherwise the
    // agent must at least assert intent with confirmDangerous.
    const mode = getPermissionModeManager().getMode();
    if (mode === 'plan') {
      return `Action "${input.action}" is blocked: only read-only actions are allowed in plan mode.`;
    }
    if (mode === 'bypassPermissions' || mode === 'dontAsk') {
      return null;
    }
    if (!input.confirmDangerous) {
      return (
        `Action "${input.action}" requires explicit confirmation. ` +
        `Use simulateOnly=true for a dry-run or set confirmDangerous=true to proceed intentionally.`
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
      'excel_save_workbook',
      'start_recording',
      'stop_recording',
      'set_window',
      'act_on_best_window',
      'export_audit_log',
    ]);

    if (action === 'macro' || action === 'use_app_workflow') {
      return (input.steps || []).some(step => this.isDangerousAction(step.action, step));
    }

    if (this.requiresApplicationConfirmation(input)) {
      return true;
    }

    if (this.requiresDialogConfirmation(input)) {
      return true;
    }

    if (!dangerous.has(action)) {
      // Phase 1: Filter dangerous keystrokes
      if (action === 'hotkey' || action === 'key' || action === 'key_down') {
        const key = String(input.key || '').toLowerCase();
        const mods = (input.modifiers || []).map(m => String(m).toLowerCase());
        
        if (key === 'f4' && (mods.includes('alt') || mods.includes('alt_l') || mods.includes('alt_r'))) return true;
        if (key === 'w' && (mods.includes('control') || mods.includes('ctrl') || mods.includes('command') || mods.includes('meta'))) return true;
        if (key === 'delete') return true;
        if (key === 'backspace' && (mods.includes('control') || mods.includes('ctrl') || mods.includes('command'))) return true;
      }
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
    if (this.requiresApplicationConfirmation(input)) {
      return 'confirm';
    }

    if (this.requiresDialogConfirmation(input)) {
      return 'confirm';
    }

    // S5: dangerous actions (close_window, lock, sleep, alt+f4, ctrl+w, delete,
    // …) require confirmation under EVERY safety profile. Previously only
    // `strict` gated them, so the DEFAULT `balanced` profile let them through
    // with no gate at all. `strict` still differs by requiring unique window
    // matches / stricter matching elsewhere; the danger gate is now baseline.
    void profile;
    if (this.isDangerousAction(input.action, input)) {
      return 'confirm';
    }

    return 'allow';
  }

  private requiresApplicationConfirmation(input: ComputerControlInput): boolean {
    if (input.simulateOnly) return false;

    if (input.action.startsWith('excel_') || input.action.startsWith('powerpoint_') || input.action.startsWith('word_')) {
      return ['excel_open_workbook', 'excel_set_cell', 'excel_save_workbook', 'powerpoint_open_presentation', 'powerpoint_add_slide', 'powerpoint_set_text', 'powerpoint_save_presentation', 'word_open_document', 'word_type_text', 'word_save_document'].includes(input.action);
    }

    if (input.action === 'save_app_document') {
      return true;
    }

    if (input.action === 'open_app' || input.action === 'focus_app') {
      const profile = this.resolveAppProfileFromInput(input);
      if (!profile) return false;
      return profile.defaultPolicy === 'confirm' && input.action === 'open_app';
    }

    if (input.action === 'use_app_workflow' && input.appName) {
      const profile = resolveApplicationProfile(input.appName);
      if (!profile || profile.defaultPolicy !== 'confirm') return false;
      return (input.steps || []).some(step => this.isMutatingAction(step.action, step));
    }

    return false;
  }

  private requiresDialogConfirmation(input: ComputerControlInput): boolean {
    if (input.simulateOnly) return false;
    if (input.action !== 'click_dialog_button' && input.action !== 'handle_dialog') return false;

    const explicitChoice = input.name ?? input.option ?? input.text ?? input.dialogIntent ?? '';
    if (!explicitChoice) return true;
    return this.classifyDialogButtonRisk(explicitChoice) !== 'safe';
  }

  private isMutatingAction(action: ComputerAction, input: ComputerControlInput): boolean {
    const mutating = new Set<ComputerAction>([
      'click_element_by_name', 'click_button', 'click_link',
      'fill_text_field', 'clear_and_type', 'select_dropdown_option',
      'select_radio', 'activate_tab', 'select_list_item', 'open_menu_item', 'toggle_checkbox',
      'set_slider_value', 'select_tree_item', 'expand_tree_item', 'collapse_tree_item',
      'click_dialog_button', 'handle_dialog',
      'open_app', 'focus_app', 'save_app_document', 'excel_open_workbook', 'excel_set_cell', 'excel_save_workbook',
      'powerpoint_open_presentation', 'powerpoint_add_slide', 'powerpoint_set_text', 'powerpoint_save_presentation',
      'word_open_document', 'word_type_text', 'word_save_document',
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

    if (action === 'macro' || action === 'use_app_workflow') {
      return (input.steps || []).some(step => this.isMutatingAction(step.action, step));
    }

    if (action === 'click_text') {
      return true; // it clicks
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
    const entry: ComputerControlAuditEntry = {
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

    const store = getActiveRunStore();
    const runId = store?.getCurrentRunId() ?? undefined;
    const artifactName = runId ? `${entry.id}.computer-control.json` : undefined;
    const harness = buildComputerControlHarnessBundle({
      audit: entry,
      input,
      result,
      runId,
      artifactRef: artifactName,
    });
    let artifactPath: string | undefined;

    if (store && runId && artifactName) {
      try {
        artifactPath = store.saveArtifact(
          runId,
          artifactName,
          `${JSON.stringify(buildComputerControlProofArtifact({
            audit: entry,
            command: input,
            result,
            harness,
          }), null, 2)}\n`,
        );
        store.emit(runId, {
          type: result.success ? 'tool_result' : 'error',
          data: {
            tool: 'computer_control',
            action,
            auditId: entry.id,
            proof: harness.proof,
            artifact: artifactName,
            success: result.success,
            simulated,
          },
        });
      } catch (err) {
        logger.debug('Computer control proof artifact save failed', {
          action,
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
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
        harness,
        ...(artifactPath ? { proofArtifactPath: artifactPath } : {}),
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
