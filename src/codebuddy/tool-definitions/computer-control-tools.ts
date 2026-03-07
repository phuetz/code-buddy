/**
 * Computer Control Tool Definitions
 *
 * OpenClaw-inspired unified computer control for AI agents.
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
- snapshot: Take UI snapshot, returns element list with refs
- snapshot_with_screenshot: Take snapshot + capture normalized screenshot (returns text + base64 image)
- get_element: Get details of element by ref
- find_elements: Search elements by role/name
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
- start_recording: Start screen recording
- stop_recording: Stop and save recording
- system_info: Get system information
- battery_info: Get battery status
- network_info: Get network status`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'snapshot',
            'snapshot_with_screenshot',
            'get_element',
            'find_elements',
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
          description: 'Safety profile for action gating (strict blocks dangerous actions unless confirmed)',
        },
        pilotMode: {
          type: 'string',
          enum: ['cautious', 'normal', 'fast'],
          description: 'High-level piloting preset for default safety + matching behavior',
        },
        confirmDangerous: {
          type: 'boolean',
          description: 'Required in strict profile for dangerous actions',
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
        policyOverrides: {
          type: 'object',
          description: 'Per-action safety overrides: { "close_window": "confirm|allow|block", ... }',
        },
        ref: {
          type: 'number',
          description: 'Element reference number from snapshot (e.g., 1, 2, 3)',
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
          description: 'Text to type',
        },
        key: {
          type: 'string',
          description: 'Key to press (enter, tab, escape, backspace, delete, up, down, left, right, f1-f12, etc.)',
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
