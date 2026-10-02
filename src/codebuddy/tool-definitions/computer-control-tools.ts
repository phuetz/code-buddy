/**
 * Computer Control Tool Definitions
 *
 * Enterprise-grade unified computer control for AI agents.
 */

import { CodeBuddyTool } from './types.js';

/**
 * Computer Control Tool
 *
 * Unified interface for controlling the computer:
 * - UI element detection via Smart Snapshot
 * - Mouse/keyboard automation
 * - System control (volume, brightness, notifications)
 * - Screen recording
 */
export const COMPUTER_CONTROL_TOOL: CodeBuddyTool = {
  type: 'function',
  function: {
    name: 'computer_control',
    description: `Control the computer with mouse, keyboard, and system actions.

WORKFLOW:
1. First call 'snapshot' action to detect UI elements
2. Elements are assigned numeric references [1], [2], [3], etc.
3. Use these refs in click/type actions instead of coordinates

ACTIONS:
- act: Execute instruction with required expectedText using locally trusted semantic recordings; every desktop activation still requires fresh human approval, no password or blind-coordinate replay
- snapshot: Take UI snapshot, returns element list with refs
- snapshot_with_screenshot: Take snapshot + capture normalized screenshot (returns text + base64 image)
- get_element: Get details of element by ref
- find_elements: Search elements by role/name
- click_element_by_name: Find and click an element by accessible name/text
- click_button: Find and click a button by label
- click_link: Find and click a link by label
- fill_text_field: Focus a text field and type text, clearing first by default
- clear_and_type: Clear current focus or target field, then type text
- select_dropdown_option: Open a dropdown/listbox and select an option by label
- select_radio: Select a radio button by label
- activate_tab: Activate a tab by label
- select_list_item: Select a list item by label
- open_menu_item: Open a menu or menu item by label
- toggle_checkbox: Toggle or set a checkbox to checked/unchecked
- set_slider_value: Set a slider/range control by label
- select_tree_item: Select a tree item by label
- expand_tree_item: Expand a tree item by label
- collapse_tree_item: Collapse a tree item by label
- assert_text_visible: Verify text is visible in the desktop state
- assert_element_visible: Verify an element by name/role is visible
- inspect_dialog: Read the active/target dialog, its text, buttons, risks, and suggested safe choice
- click_dialog_button: Click a named dialog button after dialog evidence is collected
- handle_dialog: Choose a dialog button by intent (cancel/save/discard/continue/etc.)
- list_app_profiles: List known application profiles
- get_app_profile: Describe one application profile
- open_app: Open a known app profile, optionally with filePath
- focus_app: Focus a known app profile window
- read_app_text: Read text from a targeted app document via UIAutomation
- save_app_document: Save a targeted text document without global keyboard shortcuts
- excel_open_workbook: Open or create an Excel workbook via Windows COM
- excel_set_cell: Set an Excel cell value via Windows COM
- excel_get_cell: Read an Excel cell value via Windows COM
- excel_save_workbook: Save or Save As an Excel workbook via Windows COM
- powerpoint_open_presentation: Open or create a PowerPoint presentation via Windows COM
- powerpoint_add_slide: Add a slide (layoutIndex optional) via Windows COM
- powerpoint_set_text: Set text of a shape (slideIndex + shapeIndex) via Windows COM
- powerpoint_save_presentation: Save or Save As a PowerPoint presentation via Windows COM
- word_open_document: Open or create a Word document via Windows COM
- word_type_text: Append text (value) to a Word document via Windows COM
- word_save_document: Save or Save As a Word document via Windows COM
- use_app_workflow: Execute a short sequence of computer_control steps
- click_text: Click visible text using OCR fallback
- click: Click at position or element ref
- left_click: Left click shortcut (Claude-compatible alias)
- middle_click: Middle click shortcut (Claude-compatible alias)
- double_click: Double-click at position or element ref
- right_click: Right-click at position or element ref
- move_mouse: Move mouse to position or element ref
- drag: Drag from current position to target
- scroll: Scroll vertically/horizontally
- cursor_position: Get current mouse cursor position (Claude-compatible alias)
- wait: Pause execution (Claude-compatible action)
- type: Type text at current focus
- key: Press a single key (enter, tab, escape, etc.)
- key_down: Press and hold a key
- key_up: Release a key
- hotkey: Press key combination (ctrl+c, alt+tab, etc.)
- get_windows: List all open windows
- get_window: Get a specific window by title or handle
- list_window_matches: Preview all windows matching criteria before acting
- wait_for_window: Wait until a window appears by title, regex, process, or handle
- focus_window: Focus window by title, regex, process, or handle
- close_window: Close window by title, regex, process, or handle
- windowMatchStrategy: for multiple matches choose first|focused|largest|newest
- get_active_window: Get the currently focused window
- minimize_window: Minimize a target window
- maximize_window: Maximize a target window
- restore_window: Restore a minimized/maximized window
- move_window: Move window to x,y
- resize_window: Resize window to width,height
- set_window: Atomically set window position/size/focus/state
- act_on_best_window: Pick best matching window then run focus/close/minimize/maximize/restore/move/resize/set
- get_audit_log: Read recent action audit entries
- clear_audit_log: Clear action audit entries
- export_audit_log: Export audit entries to a JSON file
- set_pilot_mode: Set piloting preset (cautious|normal|fast)
- get_pilot_mode: Read current piloting preset
- get_volume: Get current volume level
- set_volume: Set volume level (0-100)
- get_brightness: Get current brightness
- set_brightness: Set brightness (0-100)
- notify: Send system notification
- wait_for_text: Wait until text appears using OCR fallback
- start_recording: Start screen recording
- stop_recording: Stop and save recording
- system_info: Get system information
- battery_info: Get battery status
- network_info: Get network status`,
    parameters: {
      type: 'object',
      properties: {
        instruction: { type: 'string', description: 'Natural-language act/assert instruction. act records and replays a verified semantic sequence.' },
        values: { type: 'object', description: 'Fresh named typing parameters; values are never persisted in recordings. Password replay is refused.' },
        expectedText: { type: 'string', description: 'Required deterministic final oracle for act' },
        action: {
          type: 'string',
          enum: [
            'act',
            'snapshot',
            'snapshot_with_screenshot',
            'get_element',
            'find_elements',
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
            'list_app_profiles',
            'get_app_profile',
            'open_app',
            'focus_app',
            'read_app_text',
            'save_app_document',
            'excel_open_workbook',
            'excel_set_cell',
            'excel_get_cell',
            'excel_save_workbook',
            'powerpoint_open_presentation',
            'powerpoint_add_slide',
            'powerpoint_set_text',
            'powerpoint_save_presentation',
            'word_open_document',
            'word_type_text',
            'word_save_document',
            'use_app_workflow',
            'macro',
            'click_text',
            'save_macro',
            'play_macro',
            'list_macros',
            'delete_macro',
            'wait_for_text',
            'speak',
            'click',
            'left_click',
            'middle_click',
            'double_click',
            'right_click',
            'move_mouse',
            'drag',
            'scroll',
            'cursor_position',
            'wait',
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
            'get_audit_log',
            'clear_audit_log',
            'export_audit_log',
            'set_pilot_mode',
            'get_pilot_mode',
            'get_volume',
            'set_volume',
            'get_brightness',
            'set_brightness',
            'notify',
            'lock',
            'sleep',
            'start_recording',
            'stop_recording',
            'recording_status',
            'system_info',
            'battery_info',
            'network_info',
            'check_permission',
          ],
          description: 'The action to perform',
        },
        safetyProfile: {
          type: 'string',
          enum: ['balanced', 'strict'],
          description: 'Safety preset for matching; sensitive actions require human confirmation in every profile',
        },
        pilotMode: {
          type: 'string',
          enum: ['cautious', 'normal', 'fast'],
          description: 'High-level piloting preset for default safety + matching behavior',
        },
        simulateOnly: {
          type: 'boolean',
          description: 'If true, do a dry-run for mutating actions without applying changes',
        },
        auditLimit: {
          type: 'number',
          description: 'Number of audit entries to return for get_audit_log (1-500)',
        },
        exportAuditPath: {
          type: 'string',
          description: 'Optional output path for export_audit_log JSON file',
        },
        ref: {
          type: 'number',
          description: 'Element reference number from snapshot (e.g., 1, 2, 3)',
        },
        appName: {
          type: 'string',
          description: 'Application profile id/name, e.g. excel, notepad, calculator, browser, vscode',
        },
        filePath: {
          type: 'string',
          description: 'File/folder path for app launch or Office document path (Excel workbook, PowerPoint presentation, Word document)',
        },
        saveAsPath: {
          type: 'string',
          description: 'Save-as path for an Office document (Excel/PowerPoint/Word)',
        },
        slideIndex: {
          type: 'number',
          description: 'PowerPoint 1-based slide index for powerpoint_set_text',
        },
        shapeIndex: {
          type: 'number',
          description: 'PowerPoint 1-based shape index on the slide for powerpoint_set_text',
        },
        layoutIndex: {
          type: 'number',
          description: 'PowerPoint slide layout index for powerpoint_add_slide (e.g. 1=title, 2=text); defaults to 1',
        },
        sheetName: {
          type: 'string',
          description: 'Excel worksheet name',
        },
        cell: {
          type: 'string',
          description: 'Excel cell/range address, e.g. A1',
        },
        value: {
          type: 'string',
          description: 'Value for app-specific and range actions such as excel_set_cell or set_slider_value',
        },
        x: {
          type: 'number',
          description: 'X coordinate for mouse actions',
        },
        y: {
          type: 'number',
          description: 'Y coordinate for mouse actions',
        },
        width: {
          type: 'number',
          description: 'Window width (for resize_window)',
        },
        height: {
          type: 'number',
          description: 'Window height (for resize_window)',
        },
        text: {
          type: 'string',
          description: 'Text to type, click by OCR, or assert visible depending on action',
        },
        key: {
          type: 'string',
          description: 'Key to press (enter, tab, escape, backspace, delete, up, down, left, right, f1-f12, etc.)',
        },
        clearFirst: {
          type: 'boolean',
          description: 'Clear existing focused/target text before typing (fill_text_field and clear_and_type)',
        },
        option: {
          type: 'string',
          description: 'Option label for select_dropdown_option',
        },
        checked: {
          type: 'boolean',
          description: 'Desired checked state for toggle_checkbox',
        },
        expanded: {
          type: 'boolean',
          description: 'Desired expanded state for tree-item actions',
        },
        exactName: {
          type: 'boolean',
          description: 'Prefer exact accessible-name matching for semantic element actions',
        },
        visualContext: {
          type: 'boolean',
          description: 'For targeted keyboard/text actions, capture snapshot + screenshot OCR evidence after focus is verified',
        },
        dialogIntent: {
          type: 'string',
          enum: ['accept', 'cancel', 'save', 'dont_save', 'discard', 'retry', 'continue', 'close', 'yes', 'no', 'ok', 'custom'],
          description: 'Desired dialog decision for handle_dialog/click_dialog_button. Risky affirmative choices require human confirmation.',
        },
        dialogText: {
          type: 'string',
          description: 'Expected text/title inside the dialog; used to verify the correct dialog before clicking',
        },
        seconds: {
          type: 'number',
          description: 'Wait duration in seconds (for wait action)',
        },
        modifiers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Modifier keys (ctrl, alt, shift, meta/command)',
        },
        button: {
          type: 'string',
          enum: ['left', 'right', 'middle'],
          description: 'Mouse button',
        },
        deltaX: {
          type: 'number',
          description: 'Horizontal scroll amount (negative = left)',
        },
        deltaY: {
          type: 'number',
          description: 'Vertical scroll amount (negative = down)',
        },
        windowTitle: {
          type: 'string',
          description: 'Window title to find/focus',
        },
        windowTitleRegex: {
          type: 'string',
          description: 'Case-insensitive regex pattern for window title matching',
        },
        windowTitleMatch: {
          type: 'string',
          enum: ['contains', 'equals'],
          description: 'Window title matching mode',
        },
        processName: {
          type: 'string',
          description: 'Process name to find/focus (e.g. Discord, chrome, msedge)',
        },
        processNameMatch: {
          type: 'string',
          enum: ['equals', 'contains'],
          description: 'Process name matching mode',
        },
        windowHandle: {
          type: 'string',
          description: 'Window handle to focus/close directly',
        },
        windowMatchStrategy: {
          type: 'string',
          enum: ['first', 'focused', 'largest', 'newest'],
          description: 'When multiple windows match, choose first, focused, largest, or newest',
        },
        requireUniqueWindowMatch: {
          type: 'boolean',
          description: 'If true, fail when multiple windows match instead of auto-selecting one',
        },
        focus: {
          type: 'boolean',
          description: 'Whether to focus window (for set_window)',
        },
        windowState: {
          type: 'string',
          enum: ['normal', 'minimized', 'maximized'],
          description: 'Target state for set_window',
        },
        bestWindowAction: {
          type: 'string',
          enum: ['focus', 'close', 'minimize', 'maximize', 'restore', 'move', 'resize', 'set'],
          description: 'Action used by act_on_best_window',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in milliseconds for wait_for_window',
        },
        pollIntervalMs: {
          type: 'number',
          description: 'Polling interval in milliseconds for wait_for_window',
        },
        level: {
          type: 'number',
          description: 'Volume or brightness level (0-100)',
        },
        muted: {
          type: 'boolean',
          description: 'Mute state',
        },
        title: {
          type: 'string',
          description: 'Notification title',
        },
        body: {
          type: 'string',
          description: 'Notification body',
        },
        role: {
          type: 'string',
          description: 'Element role to find (button, link, text-field, checkbox, etc.)',
        },
        name: {
          type: 'string',
          description: 'Element name to search for',
        },
        interactiveOnly: {
          type: 'boolean',
          description: 'Only include interactive elements in snapshot',
        },
        useOmniParser: {
          type: 'boolean',
          description: 'For snapshot_with_screenshot: route the screenshot through a self-hosted OmniParser v2 server (set OMNIPARSER_API_URL) to overlay numbered bounding boxes and append parsed elements with clickable center coordinates. No-op (original snapshot) when the server is unavailable.',
        },
        steps: {
          type: 'array',
          items: { type: 'object' },
          description: 'Workflow/macro steps for macro or use_app_workflow',
        },
        macroName: {
          type: 'string',
          description: 'Saved macro name for save_macro/play_macro/delete_macro',
        },
        macroDescription: {
          type: 'string',
          description: 'Saved macro description for save_macro',
        },
        format: {
          type: 'string',
          enum: ['mp4', 'webm', 'gif'],
          description: 'Recording format',
        },
        fps: {
          type: 'number',
          description: 'Recording frame rate',
        },
        audio: {
          type: 'boolean',
          description: 'Include audio in recording',
        },
        permission: {
          type: 'string',
          description: 'Permission to check (screen-recording, accessibility, camera, microphone)',
        },
      },
      required: ['action'],
    },
  },
};

/**
 * All computer control tools
 */
export const COMPUTER_CONTROL_TOOLS: CodeBuddyTool[] = [
  COMPUTER_CONTROL_TOOL,
];

export default COMPUTER_CONTROL_TOOLS;
