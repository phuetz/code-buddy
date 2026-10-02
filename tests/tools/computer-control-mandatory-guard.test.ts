import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ComputerControlTool, type ComputerControlInput } from '../../src/tools/computer-control-tool.js';
import { COMPUTER_CONTROL_TOOL } from '../../src/codebuddy/tool-definitions/computer-control-tools.js';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import { getPermissionModeManager, resetPermissionModeManager } from '../../src/security/permission-modes.js';

vi.mock('../../src/desktop-automation/index.js', () => ({
  getDesktopAutomation: () => ({ initialize: vi.fn(), getActiveWindow: async () => null }),
  getPermissionManager: () => ({}), getSystemControl: () => ({}),
  getSmartSnapshotManager: () => ({}), getScreenRecorder: () => ({}),
}));

// Review inventory: a frozen fixture, not derived from the implementation under test.
const inventory: [ComputerControlInput['action'], string, boolean][] = [
  ['act', 'semanticAct', true],
  [
    "snapshot",
    "takeSnapshot",
    false
  ],
  [
    "snapshot_with_screenshot",
    "snapshotWithScreenshot",
    false
  ],
  [
    "get_element",
    "getElement",
    false
  ],
  [
    "find_elements",
    "findElements",
    false
  ],
  [
    "click_element_by_name",
    "clickElementByName",
    true
  ],
  [
    "click_button",
    "clickNamedRole",
    true
  ],
  [
    "click_link",
    "clickNamedRole",
    true
  ],
  [
    "fill_text_field",
    "fillTextField",
    true
  ],
  [
    "clear_and_type",
    "clearAndType",
    true
  ],
  [
    "select_dropdown_option",
    "selectDropdownOption",
    true
  ],
  [
    "select_radio",
    "clickNamedRole",
    true
  ],
  [
    "activate_tab",
    "clickNamedRole",
    true
  ],
  [
    "select_list_item",
    "clickNamedRole",
    true
  ],
  [
    "open_menu_item",
    "clickNamedRole",
    true
  ],
  [
    "toggle_checkbox",
    "toggleCheckbox",
    true
  ],
  [
    "set_slider_value",
    "setSliderValue",
    true
  ],
  [
    "select_tree_item",
    "clickNamedRole",
    true
  ],
  [
    "expand_tree_item",
    "setTreeItemExpansion",
    true
  ],
  [
    "collapse_tree_item",
    "setTreeItemExpansion",
    true
  ],
  [
    "assert_text_visible",
    "assertTextVisible",
    false
  ],
  [
    "assert_element_visible",
    "assertElementVisible",
    false
  ],
  [
    "inspect_dialog",
    "inspectDialog",
    false
  ],
  [
    "click_dialog_button",
    "clickDialogButton",
    true
  ],
  [
    "handle_dialog",
    "handleDialog",
    true
  ],
  [
    "list_app_profiles",
    "listAppProfiles",
    false
  ],
  [
    "get_app_profile",
    "getAppProfile",
    false
  ],
  [
    "open_app",
    "openApp",
    true
  ],
  [
    "focus_app",
    "focusApp",
    true
  ],
  [
    "read_app_text",
    "readAppText",
    false
  ],
  [
    "save_app_document",
    "saveAppDocument",
    true
  ],
  [
    "excel_open_workbook",
    "excelOpenWorkbook",
    true
  ],
  [
    "excel_set_cell",
    "excelSetCell",
    true
  ],
  [
    "excel_get_cell",
    "excelGetCell",
    true
  ],
  [
    "excel_save_workbook",
    "excelSaveWorkbook",
    true
  ],
  [
    "powerpoint_open_presentation",
    "powerpointOpenPresentation",
    true
  ],
  [
    "powerpoint_add_slide",
    "powerpointAddSlide",
    true
  ],
  [
    "powerpoint_set_text",
    "powerpointSetText",
    true
  ],
  [
    "powerpoint_save_presentation",
    "powerpointSavePresentation",
    true
  ],
  [
    "word_open_document",
    "wordOpenDocument",
    true
  ],
  [
    "word_type_text",
    "wordTypeText",
    true
  ],
  [
    "word_save_document",
    "wordSaveDocument",
    true
  ],
  [
    "use_app_workflow",
    "executeMacro",
    true
  ],
  [
    "macro",
    "executeMacro",
    true
  ],
  [
    "click_text",
    "clickText",
    true
  ],
  [
    "save_macro",
    "saveMacro",
    true
  ],
  [
    "play_macro",
    "playMacro",
    true
  ],
  [
    "list_macros",
    "listMacros",
    false
  ],
  [
    "delete_macro",
    "deleteMacro",
    true
  ],
  [
    "wait_for_text",
    "waitForText",
    false
  ],
  [
    "speak",
    "speakText",
    true
  ],
  [
    "click",
    "click",
    true
  ],
  [
    "left_click",
    "click",
    true
  ],
  [
    "middle_click",
    "click",
    true
  ],
  [
    "double_click",
    "doubleClick",
    true
  ],
  [
    "right_click",
    "rightClick",
    true
  ],
  [
    "move_mouse",
    "moveMouse",
    true
  ],
  [
    "drag",
    "drag",
    true
  ],
  [
    "scroll",
    "scroll",
    true
  ],
  [
    "cursor_position",
    "getCursorPosition",
    false
  ],
  [
    "wait",
    "wait",
    false
  ],
  [
    "type",
    "typeText",
    true
  ],
  [
    "key",
    "pressKey",
    true
  ],
  [
    "key_down",
    "keyDown",
    true
  ],
  [
    "key_up",
    "keyUp",
    true
  ],
  [
    "hotkey",
    "hotkey",
    true
  ],
  [
    "get_windows",
    "getWindows",
    false
  ],
  [
    "get_window",
    "getWindow",
    false
  ],
  [
    "list_window_matches",
    "listWindowMatches",
    false
  ],
  [
    "wait_for_window",
    "waitForWindow",
    false
  ],
  [
    "focus_window",
    "focusWindow",
    true
  ],
  [
    "close_window",
    "closeWindow",
    true
  ],
  [
    "get_active_window",
    "getActiveWindow",
    false
  ],
  [
    "minimize_window",
    "minimizeWindow",
    true
  ],
  [
    "maximize_window",
    "maximizeWindow",
    true
  ],
  [
    "restore_window",
    "restoreWindow",
    true
  ],
  [
    "move_window",
    "moveWindow",
    true
  ],
  [
    "resize_window",
    "resizeWindow",
    true
  ],
  [
    "set_window",
    "setWindow",
    true
  ],
  [
    "act_on_best_window",
    "actOnBestWindow",
    true
  ],
  [
    "get_audit_log",
    "getAuditLog",
    false
  ],
  [
    "clear_audit_log",
    "clearAuditLog",
    true
  ],
  [
    "export_audit_log",
    "exportAuditLog",
    true
  ],
  [
    "set_pilot_mode",
    "setPilotMode",
    true
  ],
  [
    "get_pilot_mode",
    "getPilotMode",
    false
  ],
  [
    "get_volume",
    "getVolume",
    false
  ],
  [
    "set_volume",
    "setVolume",
    true
  ],
  [
    "get_brightness",
    "getBrightness",
    false
  ],
  [
    "set_brightness",
    "setBrightness",
    true
  ],
  [
    "notify",
    "sendNotification",
    true
  ],
  [
    "lock",
    "lockScreen",
    true
  ],
  [
    "sleep",
    "sleepSystem",
    true
  ],
  [
    "start_recording",
    "startRecording",
    true
  ],
  [
    "stop_recording",
    "stopRecording",
    true
  ],
  [
    "recording_status",
    "getRecordingStatus",
    false
  ],
  [
    "system_info",
    "getSystemInfo",
    false
  ],
  [
    "battery_info",
    "getBatteryInfo",
    false
  ],
  [
    "network_info",
    "getNetworkInfo",
    false
  ],
  [
    "check_permission",
    "checkPermission",
    false
  ]
];
interface Access {
  enforceSafetyPolicy(input: ComputerControlInput): Promise<string | null>;
  ensureAutomationInitialized(): Promise<void>;
}

describe('Grok exhaustive desktop action boundary', () => {
  const service = ConfirmationService.getInstance();
  const human = vi.fn();
  let directory: string;
  beforeEach(() => {
    resetPermissionModeManager(); service.resetSession();
    human.mockReset().mockResolvedValue({ confirmed: false });
    service.setInteractiveBridge(human);
    directory = mkdtempSync(path.join(tmpdir(), 'desktop-guard-'));
    mkdirSync(path.join(directory, '.codebuddy'));
    writeFileSync(path.join(directory, '.codebuddy', 'settings.json'), JSON.stringify({
      permissions: { allow: ['computer_control', 'gui_control', 'office_macro_execute', 'Bash(xdotool *)'] },
    }));
  });
  afterEach(() => {
    service.setInteractiveBridge(null); resetPermissionModeManager();
    vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
  });
  it('inventory equals the exposed action schema', () => {
    const schema = COMPUTER_CONTROL_TOOL.function.parameters as { properties: { action: { enum: string[] } } };
    expect(inventory.map(([a]) => a).sort()).toEqual([...schema.properties.action.enum].sort());
  });
  it.each(inventory)('Grok action %s (%s): mandatory=%s', async (action, handler, mandatory) => {
    getPermissionModeManager().setMode('dontAsk');
    vi.stubEnv('CODEBUDDY_AUTO_CONFIRM', 'true'); service.setSessionFlag('allOperations', true);
    const tool = new ComputerControlTool();
    const access = tool as unknown as Access;
    const effect = vi.spyOn(tool as unknown as Record<string, () => Promise<unknown>>, handler)
      .mockResolvedValue({ success: true });
    const init = vi.spyOn(access, 'ensureAutomationInitialized').mockResolvedValue(undefined);
    const input = { action, key: 'y', modifiers: ['alt'], text: 'approve', appName: 'notepad',
      name: 'Cancel', steps: [{ action: 'drag', x: 10, y: 10, toX: 10, toY: 10 }] } as ComputerControlInput;
    const result = await tool.execute(input);
    if (mandatory) {
      expect({ effects: effect.mock.calls.length, initializations: init.mock.calls.length, success: result.success })
        .toEqual({ effects: 0, initializations: 0, success: false });
      expect(human).toHaveBeenCalledTimes(1);
      expect(human.mock.calls[0]?.[0]).toMatchObject({ forcePrompt: true, riskLevel: expect.any(String) });
    } else {
      expect(result.success).toBe(true); expect(effect).toHaveBeenCalledTimes(1);
      expect(human).not.toHaveBeenCalled();
    }
  });
  it.each(['default', 'dontAsk', 'bypassPermissions'] as const)('Grok cloned-project rule in %s cannot authorize drag', async mode => {
    getPermissionModeManager().setMode(mode);
    const outer = await service.requestConfirmation({ operation: 'Execute tool: computer_control',
      filename: 'drag', toolName: 'computer_control', toolArgs: { action: 'drag' }, detail: { cwd: directory } }, 'tool');
    expect(outer.confirmed).toBe(true); expect(human).not.toHaveBeenCalled();
    const tool = new ComputerControlTool();
    const effect = vi.spyOn(tool as unknown as Record<string, () => Promise<unknown>>, 'drag').mockResolvedValue({ success: true });
    vi.spyOn(tool as unknown as Access, 'ensureAutomationInitialized').mockResolvedValue(undefined);
    expect((await tool.execute({ action: 'drag', x: 10, y: 10, toX: 10, toY: 10 })).success).toBe(false);
    expect(effect).not.toHaveBeenCalled(); expect(human).toHaveBeenCalledTimes(1);
  });
  it.each(inventory.filter(([, , mandatory]) => !mandatory).map(([action]) => action))(
    'Grok targeted observation %s cannot focus before approval', async action => {
      const tool = new ComputerControlTool();
      expect(await (tool as unknown as Access).enforceSafetyPolicy({ action, windowHandle: '123' })).toMatch(/human confirmation/);
      expect(human.mock.calls[0]?.[0]).toMatchObject({ forcePrompt: true });
    });
  it('Grok preparation never looks up a model-supplied handle before human approval', async () => {
    const tool = new ComputerControlTool();
    const lookup = vi.spyOn(tool as unknown as Record<string, () => Promise<unknown>>, 'findWindowFromInput').mockResolvedValue(null);
    await tool.execute({ action: 'close_window', windowHandle: '123; injected-command' });
    expect(lookup).not.toHaveBeenCalled(); expect(human).toHaveBeenCalledTimes(1);
    expect(human.mock.calls[0]?.[0].content).toContain('not verified');
  });
  it('approved drag reaches the action exactly once', async () => {
    human.mockResolvedValue({ confirmed: true }); const tool = new ComputerControlTool();
    const effect = vi.spyOn(tool as unknown as Record<string, () => Promise<unknown>>, 'drag').mockResolvedValue({ success: true });
    vi.spyOn(tool as unknown as Access, 'ensureAutomationInitialized').mockResolvedValue(undefined);
    expect((await tool.execute({ action: 'drag', x: 10, y: 10, toX: 10, toY: 10 })).success).toBe(true);
    expect(effect).toHaveBeenCalledTimes(1); expect(human).toHaveBeenCalledTimes(1);
  });
});
