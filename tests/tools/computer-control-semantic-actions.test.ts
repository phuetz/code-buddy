import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmationService } from '../../src/utils/confirmation-service.js';
import type { Snapshot, UIElement } from '../../src/desktop-automation/smart-snapshot.js';

const {
  mockAutomation,
  mockSnapshotManager,
  setCurrentSnapshot,
  makeElement,
  makeSnapshot,
} = vi.hoisted(() => {
  type TestElement = {
    ref: number;
    role: string;
    name: string;
    bounds: { x: number; y: number; width: number; height: number };
    center: { x: number; y: number };
    interactive: boolean;
    focused: boolean;
    enabled: boolean;
    visible: boolean;
    value?: string;
    placeholder?: string;
    attributes?: Record<string, unknown>;
  };
  type TestSnapshot = {
    id: string;
    timestamp: Date;
    source: string;
    elements: TestElement[];
    elementMap: Map<number, TestElement>;
    screenSize: { width: number; height: number };
    ttl: number;
    valid: boolean;
  };

  let currentSnapshot: TestSnapshot | null = null;

  const makeElement = (overrides: Partial<TestElement> & Pick<TestElement, 'ref' | 'role' | 'name'>): TestElement => {
    const bounds = overrides.bounds ?? {
      x: overrides.ref * 10,
      y: overrides.ref * 10,
      width: 100,
      height: 24,
    };
    return {
      bounds,
      center: overrides.center ?? {
        x: bounds.x + Math.round(bounds.width / 2),
        y: bounds.y + Math.round(bounds.height / 2),
      },
      interactive: overrides.interactive ?? true,
      focused: overrides.focused ?? false,
      enabled: overrides.enabled ?? true,
      visible: overrides.visible ?? true,
      ...overrides,
    };
  };

  const makeSnapshot = (elements: TestElement[], id = 'snap-1'): TestSnapshot => ({
    id,
    timestamp: new Date(),
    source: 'test-window',
    elements,
    elementMap: new Map(elements.map((element) => [element.ref, element])),
    screenSize: { width: 1280, height: 720 },
    ttl: 5000,
    valid: true,
  });

  const mockAutomation = {
    initialize: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    doubleClick: vi.fn().mockResolvedValue(undefined),
    rightClick: vi.fn().mockResolvedValue(undefined),
    moveMouse: vi.fn().mockResolvedValue(undefined),
    drag: vi.fn().mockResolvedValue(undefined),
    scroll: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    keyPress: vi.fn().mockResolvedValue(undefined),
    keyDown: vi.fn().mockResolvedValue(undefined),
    keyUp: vi.fn().mockResolvedValue(undefined),
    hotkey: vi.fn().mockResolvedValue(undefined),
    getMousePosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
    getWindows: vi.fn().mockResolvedValue([]),
    focusWindow: vi.fn().mockResolvedValue(undefined),
    getScreenSize: vi.fn().mockResolvedValue({ width: 1280, height: 720 }),
  };

  const mockSnapshotManager = {
    takeSnapshot: vi.fn().mockImplementation(async () => currentSnapshot),
    getElement: vi.fn().mockImplementation((ref: number) => currentSnapshot?.elementMap.get(ref)),
    getCurrentSnapshot: vi.fn().mockImplementation(() => currentSnapshot),
    toTextRepresentation: vi.fn(),
    findElements: vi.fn(),
    toAnnotatedScreenshot: vi.fn(),
  };

  return {
    mockAutomation,
    mockSnapshotManager,
    setCurrentSnapshot: (snapshot: TestSnapshot | null) => {
      currentSnapshot = snapshot;
    },
    makeElement,
    makeSnapshot,
  };
});

vi.mock('../../src/desktop-automation/index.js', () => ({
  getDesktopAutomation: vi.fn().mockReturnValue(mockAutomation),
  getPermissionManager: vi.fn().mockReturnValue({
    check: vi.fn(),
    getInstructions: vi.fn(),
  }),
  getSystemControl: vi.fn().mockReturnValue({}),
  getSmartSnapshotManager: vi.fn().mockReturnValue(mockSnapshotManager),
  getScreenRecorder: vi.fn().mockReturnValue({
    start: vi.fn(),
    stop: vi.fn(),
    getStatus: vi.fn(),
  }),
}));

vi.mock('../../src/tools/screenshot-tool.js', () => {
  return {
    ScreenshotTool: class {
      capture = vi.fn().mockResolvedValue({ success: true, data: { path: 'mock-screenshot.png' } });
    }
  };
});

vi.mock('../../src/tools/ocr-tool.js', () => {
  return {
    OCRTool: class {
      extractText = vi.fn().mockResolvedValue({
        success: true,
        data: {
          text: 'mocked text Save As',
          blocks: [
            { text: 'mocked', boundingBox: { x: 10, y: 20, width: 50, height: 15 } },
            { text: 'text', boundingBox: { x: 70, y: 20, width: 30, height: 15 } },
            { text: 'Save', boundingBox: { x: 110, y: 20, width: 40, height: 15 } },
            { text: 'As', boundingBox: { x: 160, y: 20, width: 20, height: 15 } },
          ],
        },
      });
    }
  };
});

afterEach(() => ConfirmationService.getInstance().setInteractiveBridge(null));

describe('ComputerControlTool semantic actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentSnapshot(null);
  });

  it('fills a named text field by focusing, clearing, and typing', async () => {
    const field = makeElement({ ref: 1, role: 'text-field', name: 'Search' }) as UIElement;
    setCurrentSnapshot(makeSnapshot([field]) as Snapshot);

    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();
    const result = await tool.execute({
      action: 'fill_text_field',
      name: 'Search',
      text: 'Code Buddy Studio',
    });

    expect(result.success).toBe(true);
    expect(mockAutomation.click).toHaveBeenCalledWith(field.center.x, field.center.y, { button: 'left' });
    expect(mockAutomation.keyPress).toHaveBeenCalledWith('a', {
      modifiers: [process.platform === 'darwin' ? 'meta' : 'ctrl'],
    });
    expect(mockAutomation.type).toHaveBeenCalledWith('Code Buddy Studio', { delay: 30 });
  });

  it('refreshes the snapshot after verifying a targeted window for text entry', async () => {
    const stale = makeElement({ ref: 9, role: 'button', name: 'Unrelated' }) as UIElement;
    const field = makeElement({ ref: 10, role: 'text-field', name: 'Message' }) as UIElement;
    const freshSnapshot = makeSnapshot([field], 'fresh-target') as Snapshot;
    setCurrentSnapshot(makeSnapshot([stale], 'stale-window') as Snapshot);
    mockSnapshotManager.takeSnapshot.mockImplementationOnce(async () => {
      setCurrentSnapshot(freshSnapshot);
      return freshSnapshot;
    });

    const targetWindow = {
      handle: 'fixture-window',
      title: 'CodeBuddy Computer Use Fixture',
      pid: 99,
      processName: 'powershell',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      focused: false,
      visible: true,
      minimized: false,
      maximized: false,
      fullscreen: false,
    };
    mockAutomation.getWindows
      .mockResolvedValueOnce([targetWindow]);

    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();
    const result = await tool.execute({
      action: 'fill_text_field',
      name: 'Message',
      text: 'Bonjour reel Computer Use',
      exactName: true,
      windowTitle: 'CodeBuddy Computer Use Fixture',
      windowTitleMatch: 'contains',
    });

    expect(result.success).toBe(true);
    expect(mockSnapshotManager.takeSnapshot).toHaveBeenCalledWith({ interactiveOnly: true });
    expect(mockAutomation.focusWindow).toHaveBeenCalledWith('fixture-window');
    expect(mockAutomation.click).toHaveBeenCalledWith(field.center.x, field.center.y, { button: 'left' });
    expect(mockAutomation.type).toHaveBeenCalledWith('Bonjour reel Computer Use', { delay: 30 });
  });

  it('opens a dropdown and selects an option by label', async () => {
    const dropdown = makeElement({ ref: 2, role: 'dropdown', name: 'Country' }) as UIElement;
    const option = makeElement({ ref: 3, role: 'list-item', name: 'France' }) as UIElement;
    const closedSnapshot = makeSnapshot([dropdown], 'closed') as Snapshot;
    const openSnapshot = makeSnapshot([dropdown, option], 'open') as Snapshot;

    setCurrentSnapshot(closedSnapshot);
    mockSnapshotManager.takeSnapshot.mockImplementationOnce(async () => {
      setCurrentSnapshot(openSnapshot);
      return openSnapshot;
    });

    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();
    const result = await tool.execute({
      action: 'select_dropdown_option',
      name: 'Country',
      option: 'France',
    });

    expect(result.success).toBe(true);
    expect(mockAutomation.click).toHaveBeenNthCalledWith(1, dropdown.center.x, dropdown.center.y, { button: 'left' });
    expect(mockAutomation.click).toHaveBeenNthCalledWith(2, option.center.x, option.center.y, { button: 'left' });
  });

  it('does not click a checkbox that already matches the desired state', async () => {
    const checkbox = makeElement({
      ref: 4,
      role: 'checkbox',
      name: 'Enable companion mode',
      attributes: { checked: true },
    }) as UIElement;
    setCurrentSnapshot(makeSnapshot([checkbox]) as Snapshot);

    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();
    const result = await tool.execute({
      action: 'toggle_checkbox',
      name: 'Enable companion',
      checked: true,
    });

    expect(result.success).toBe(true);
    expect(mockAutomation.click).not.toHaveBeenCalled();
    expect(result.output).toContain('already checked');
  });

  it('asserts visible text from the current snapshot without mutating the desktop', async () => {
    const label = makeElement({
      ref: 5,
      role: 'text',
      name: 'Ready to launch',
      interactive: false,
      enabled: false,
    }) as UIElement;
    setCurrentSnapshot(makeSnapshot([label]) as Snapshot);

    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();
    const result = await tool.execute({
      action: 'assert_text_visible',
      text: 'Ready to launch',
    });

    expect(result.success).toBe(true);
    expect(mockAutomation.click).not.toHaveBeenCalled();
    expect(mockAutomation.type).not.toHaveBeenCalled();
  });

  it('uses role-specific semantic actions for buttons, radios, tabs, and list items', async () => {
    ConfirmationService.getInstance().setInteractiveBridge(vi.fn().mockResolvedValue({ confirmed: true }));
    const button = makeElement({ ref: 6, role: 'button', name: 'Apply' }) as UIElement;
    const radio = makeElement({ ref: 7, role: 'radio', name: 'Expert mode' }) as UIElement;
    const tab = makeElement({ ref: 8, role: 'tab', name: 'Advanced' }) as UIElement;
    const item = makeElement({ ref: 9, role: 'list-item', name: 'Blue' }) as UIElement;
    setCurrentSnapshot(makeSnapshot([button, radio, tab, item]) as Snapshot);

    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();

    await expect(tool.execute({ action: 'click_button', name: 'Apply', exactName: true })).resolves.toMatchObject({ success: true });
    await expect(tool.execute({ action: 'select_radio', name: 'Expert mode', exactName: true })).resolves.toMatchObject({ success: true });
    await expect(tool.execute({ action: 'activate_tab', name: 'Advanced', exactName: true })).resolves.toMatchObject({ success: true });
    await expect(tool.execute({ action: 'select_list_item', name: 'Blue', exactName: true })).resolves.toMatchObject({ success: true });

    expect(mockAutomation.click).toHaveBeenCalledWith(button.center.x, button.center.y, { button: 'left' });
    expect(mockAutomation.click).toHaveBeenCalledWith(radio.center.x, radio.center.y, { button: 'left' });
    expect(mockAutomation.click).toHaveBeenCalledWith(tab.center.x, tab.center.y, { button: 'left' });
    expect(mockAutomation.click).toHaveBeenCalledWith(item.center.x, item.center.y, { button: 'left' });
  });

  it('uses semantic actions for sliders and tree items', async () => {
    const slider = makeElement({
      ref: 30,
      role: 'slider',
      name: 'Zoom',
      bounds: { x: 100, y: 20, width: 200, height: 30 },
      attributes: { minimum: 0, maximum: 100 },
    }) as UIElement;
    const collapsedTreeItem = makeElement({
      ref: 31,
      role: 'tree-item',
      name: 'Projects',
      bounds: { x: 40, y: 70, width: 180, height: 24 },
      attributes: { expanded: false },
    }) as UIElement;
    const expandedTreeItem = makeElement({
      ref: 32,
      role: 'tree-item',
      name: 'Archive',
      bounds: { x: 40, y: 100, width: 180, height: 24 },
      attributes: { expanded: true },
    }) as UIElement;
    setCurrentSnapshot(makeSnapshot([slider, collapsedTreeItem, expandedTreeItem]) as Snapshot);

    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();

    await expect(tool.execute({ action: 'set_slider_value', ref: 30, value: 75 })).resolves.toMatchObject({ success: true });
    await expect(tool.execute({ action: 'expand_tree_item', ref: 31 })).resolves.toMatchObject({ success: true });
    await expect(tool.execute({ action: 'collapse_tree_item', ref: 32 })).resolves.toMatchObject({ success: true });
    await expect(tool.execute({ action: 'select_tree_item', name: 'Archive', exactName: true })).resolves.toMatchObject({ success: true });

    expect(mockAutomation.click).toHaveBeenCalledWith(250, slider.center.y, { button: 'left' });
    expect(mockAutomation.click).toHaveBeenCalledWith(54, collapsedTreeItem.center.y, { button: 'left' });
    expect(mockAutomation.click).toHaveBeenCalledWith(54, expandedTreeItem.center.y, { button: 'left' });
    expect(mockAutomation.click).toHaveBeenCalledWith(expandedTreeItem.center.x, expandedTreeItem.center.y, { button: 'left' });
  });

  it('inspects dialogs and suggests the safe cancel choice without clicking', async () => {
    const dialog = makeElement({
      ref: 10,
      role: 'window',
      name: 'Unsaved changes',
      interactive: false,
    }) as UIElement;
    const prompt = makeElement({
      ref: 11,
      role: 'text',
      name: 'Do you want to save changes?',
      interactive: false,
    }) as UIElement;
    const save = makeElement({ ref: 12, role: 'button', name: 'Save' }) as UIElement;
    const cancel = makeElement({ ref: 13, role: 'button', name: 'Cancel' }) as UIElement;
    setCurrentSnapshot(makeSnapshot([dialog, prompt, save, cancel]) as Snapshot);

    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();
    const result = await tool.execute({
      action: 'inspect_dialog',
      dialogText: 'save changes',
      dialogIntent: 'cancel',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Unsaved changes');
    expect(result.output).toContain('"Cancel" [safe]');
    expect(result.output).toContain('Suggested: "Cancel"');
    expect(mockAutomation.click).not.toHaveBeenCalled();
  });

  it('clicks a safe dialog button by intent', async () => {
    const prompt = makeElement({
      ref: 14,
      role: 'text',
      name: 'Operation failed',
      interactive: false,
    }) as UIElement;
    const close = makeElement({ ref: 15, role: 'button', name: 'Close' }) as UIElement;
    setCurrentSnapshot(makeSnapshot([prompt, close]) as Snapshot);

    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();
    const result = await tool.execute({
      action: 'click_dialog_button',
      dialogIntent: 'close',
    });

    expect(result.success).toBe(true);
    expect(mockAutomation.click).toHaveBeenCalledWith(close.center.x, close.center.y, { button: 'left' });
  });

  it('requires confirmation before clicking destructive dialog choices', async () => {
    const warning = makeElement({
      ref: 16,
      role: 'text',
      name: 'This will permanently delete the item.',
      interactive: false,
    }) as UIElement;
    const deleteButton = makeElement({ ref: 17, role: 'button', name: 'Delete' }) as UIElement;
    setCurrentSnapshot(makeSnapshot([warning, deleteButton]) as Snapshot);

    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();

    const blocked = await tool.execute({
      action: 'click_dialog_button',
      name: 'Delete',
    });
    expect(blocked.success).toBe(false);
    expect(blocked.error).toContain('requires explicit human confirmation');
    expect(mockAutomation.click).not.toHaveBeenCalled();

    ConfirmationService.getInstance().setInteractiveBridge(async () => ({ confirmed: true }));
    const confirmed = await tool.execute({
      action: 'handle_dialog',
      dialogIntent: 'discard',
      confirmDangerous: true,
    });
    expect(confirmed.success).toBe(true);
    expect(mockAutomation.click).toHaveBeenCalledWith(deleteButton.center.x, deleteButton.center.y, { button: 'left' });
  });

  it.each([
    { action: 'handle_dialog', dialogIntent: 'yes', confirmDangerous: true },
    { action: 'click_dialog_button', name: 'Delete', policyOverrides: { click_dialog_button: 'allow' } },
    // Fuzzy matching must judge the actual button, even with a safe-looking request.
    { action: 'click_dialog_button', name: 'Cancel' },
  ] as import('../../src/tools/computer-control-tool.js').ComputerControlInput[])(
    'requires human approval for the observed affirmative/destructive button: %j', async (input) => {
      const button = makeElement({ ref: 17, role: 'button', name: 'Cancel and Delete' }) as UIElement;
      setCurrentSnapshot(makeSnapshot([button]) as Snapshot);
      // For explicit Yes/Delete use matching observed choices.
      if (input.dialogIntent === 'yes') button.name = 'Yes';
      if (input.name === 'Delete') button.name = 'Delete';
      const human = vi.fn().mockResolvedValue({ confirmed: false });
      ConfirmationService.getInstance().setInteractiveBridge(human);
      const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
      const result = await new ComputerControlTool().execute(input);
      expect(result.success).toBe(false);
      expect(human).toHaveBeenCalledTimes(1);
      expect(human.mock.calls[0]?.[0]).toMatchObject({
        forcePrompt: true, riskLevel: 'high',
        operation: expect.stringContaining(button.name),
      });
      expect(mockAutomation.click).not.toHaveBeenCalled();
    });

  it.each([
    { action: 'click_button', name: 'Delete' },
    { action: 'click_element_by_name', name: 'Delete' },
    { action: 'click_link', name: 'Delete' },
    { action: 'select_list_item', name: 'Delete' },
    { action: 'click', ref: 81 },
    { action: 'click', x: 150, y: 112 },
    { action: 'left_click', x: 150, y: 112 },
    { action: 'double_click', x: 150, y: 112 },
    { action: 'right_click', x: 150, y: 112 },
    { action: 'middle_click', x: 150, y: 112 },
    { action: 'open_menu_item', name: 'Delete' },
    { action: 'hotkey', key: 'enter' },
    { action: 'key_down', key: 'space' },
    { action: 'key', key: 'enter' },
  ] as import('../../src/tools/computer-control-tool.js').ComputerControlInput[])(
    'B1: every activation route requires a human for observed Delete: %j', async (input) => {
      const role = input.action === 'click_link' ? 'link' : input.action === 'select_list_item' ? 'list-item' : input.action === 'open_menu_item' ? 'menu-item' : 'button';
      const button = makeElement({ ref: 81, role, name: 'Delete', focused: true,
        bounds: { x: 100, y: 100, width: 100, height: 24 } }) as UIElement;
      setCurrentSnapshot(makeSnapshot([button]) as Snapshot);
      const human = vi.fn().mockResolvedValue({ confirmed: false });
      ConfirmationService.getInstance().setInteractiveBridge(human);
      const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
      const result = await new ComputerControlTool().execute({
        ...input, confirmDangerous: true, policyOverrides: { [input.action]: 'allow' },
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/human confirmation/i);
      expect(human).toHaveBeenCalledTimes(1);
      expect(human.mock.calls[0]?.[0].operation).toContain('Delete');
      expect(mockAutomation.click).not.toHaveBeenCalled();
      expect(mockAutomation.doubleClick).not.toHaveBeenCalled();
      expect(mockAutomation.rightClick).not.toHaveBeenCalled();
      expect(mockAutomation.keyPress).not.toHaveBeenCalled();
      expect(mockAutomation.hotkey).not.toHaveBeenCalled();
      expect(mockAutomation.keyDown).not.toHaveBeenCalled();
    });

  it.each([
    { name: 'Continue now', role: 'button' },
    { name: 'OK', role: 'list-item' },
  ])('B1: affirmative controls cannot look like safe cancellation: %j', async ({ name, role }) => {
    setCurrentSnapshot(makeSnapshot([makeElement({ ref: 81, role, name })]));
    const human = vi.fn().mockResolvedValue({ confirmed: false });
    ConfirmationService.getInstance().setInteractiveBridge(human);
    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    expect((await new ComputerControlTool().execute({ action: 'click_element_by_name', ref: 81 })).success).toBe(false);
    expect(human).toHaveBeenCalledTimes(1);
    expect(mockAutomation.click).not.toHaveBeenCalled();
  });

  it.each(['missing', 'expired', 'invalid'] as const)('B1: %s target evidence requires a human', async (state) => {
    if (state !== 'missing') {
      const snapshot = makeSnapshot([makeElement({ ref: 81, role: 'text-field', name: 'Search',
        bounds: { x: 100, y: 100, width: 100, height: 24 } })]);
      if (state === 'expired') snapshot.timestamp = new Date(0);
      else snapshot.valid = false;
      setCurrentSnapshot(snapshot);
    }
    const human = vi.fn().mockResolvedValue({ confirmed: false });
    ConfirmationService.getInstance().setInteractiveBridge(human);
    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    expect((await new ComputerControlTool().execute({ action: 'click', x: 150, y: 112 })).success).toBe(false);
    expect(human).toHaveBeenCalledTimes(1);
    expect(mockAutomation.click).not.toHaveBeenCalled();
  });

  it('B1: a benign ref cannot hide an overlapping destructive target', async () => {
    const bounds = { x: 100, y: 100, width: 100, height: 24 };
    setCurrentSnapshot(makeSnapshot([
      makeElement({ ref: 81, role: 'text-field', name: 'Search', bounds }),
      makeElement({ ref: 82, role: 'button', name: 'Delete', bounds }),
    ]));
    const human = vi.fn().mockResolvedValue({ confirmed: false });
    ConfirmationService.getInstance().setInteractiveBridge(human);
    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    expect((await new ComputerControlTool().execute({ action: 'click', ref: 81 })).success).toBe(false);
    expect(human.mock.calls[0]?.[0].operation).toContain('Delete');
    expect(mockAutomation.click).not.toHaveBeenCalled();
  });

  it('B1: safe cancellation and observed text fields remain autonomous', async () => {
    const human = vi.fn().mockResolvedValue({ confirmed: false });
    ConfirmationService.getInstance().setInteractiveBridge(human);
    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();
    for (const element of [makeElement({ ref: 81, role: 'button', name: 'Cancel' }),
      makeElement({ ref: 82, role: 'text-field', name: 'Search' })]) {
      setCurrentSnapshot(makeSnapshot([element]));
      expect((await tool.execute({ action: 'click', ref: element.ref })).success).toBe(true);
    }
    expect(human).not.toHaveBeenCalled();
    expect(mockAutomation.click).toHaveBeenCalledTimes(2);
  });

  it.each(['click_button', 'select_dropdown_option', 'set_slider_value', 'expand_tree_item'] as const)(
    'B1: direct Windows %s cannot execute its combined UIA script after refusal', async (action) => {
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        const human = vi.fn().mockResolvedValue({ confirmed: false });
        ConfirmationService.getInstance().setInteractiveBridge(human);
        mockAutomation.getWindows.mockResolvedValue([{ id: 'window', title: 'Fixture', processName: 'fixture', pid: 1, focused: true }]);
        const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
        const tool = new ComputerControlTool();
        const native = vi.spyOn(tool as unknown as { runPowerShellEncoded: () => Promise<string> }, 'runPowerShellEncoded')
          .mockResolvedValue('{"success":true}');
        const result = await tool.execute({ action, name: 'Delete', processName: action === 'click_button' ? 'fixture' : undefined, option: 'Delete', value: 1 });
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/human confirmation/i);
        expect(human).toHaveBeenCalledTimes(1);
        expect(native).not.toHaveBeenCalled();
        expect(mockAutomation.click).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(process, 'platform', platform);
      }
    });

  it('B1: OCR activation requires a human instead of bypassing dialog evidence', async () => {
    const human = vi.fn().mockResolvedValue({ confirmed: false });
    ConfirmationService.getInstance().setInteractiveBridge(human);
    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const result = await new ComputerControlTool().execute({ action: 'click_text', text: 'Save' });
    expect(result.success).toBe(false);
    expect(human).toHaveBeenCalledTimes(1);
    expect(mockAutomation.click).not.toHaveBeenCalled();
    expect(mockAutomation.moveMouse).not.toHaveBeenCalled();
  });

  it('lists app profiles and exposes Excel as a known application profile', async () => {
    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();

    const listResult = await tool.execute({ action: 'list_app_profiles' });
    expect(listResult.success).toBe(true);
    expect(listResult.output).toContain('excel');

    const profileResult = await tool.execute({ action: 'get_app_profile', appName: 'excel' });
    expect(profileResult.success).toBe(true);
    expect(profileResult.output).toContain('Microsoft Excel');
  });

  it('dry-runs mutating app profile and Excel actions with harness metadata', async () => {
    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();

    const result = await tool.execute({
      action: 'excel_set_cell',
      cell: 'A1',
      value: 'hello',
      simulateOnly: true,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('[SIMULATED]');
    const data = result.data as { harness: { sensitiveAction: { id: string } } };
    expect(data.harness.sensitiveAction.id).toBe('codebuddy.computer_control.excel_set_cell');
  });

  it('requires explicit confirmation for live high-risk app profile actions', async () => {
    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();

    const terminalResult = await tool.execute({
      action: 'open_app',
      appName: 'terminal',
    });
    expect(terminalResult.success).toBe(false);
    expect(terminalResult.error).toContain('requires explicit human confirmation');

    const excelResult = await tool.execute({
      action: 'excel_set_cell',
      cell: 'A1',
      value: 'protected',
    });
    expect(excelResult.success).toBe(false);
    expect(excelResult.error).toContain('requires explicit human confirmation');

    const notepadSaveResult = await tool.execute({
      action: 'save_app_document',
      appName: 'notepad',
      filePath: 'C:\\temp\\codebuddy-notepad.txt',
    });
    expect(notepadSaveResult.success).toBe(false);
    expect(notepadSaveResult.error).toContain('requires explicit human confirmation');
  });

  it('applies app profile safety and window context to workflows', async () => {
    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();

    const terminalResult = await tool.execute({
      action: 'use_app_workflow',
      appName: 'terminal',
      steps: [{ action: 'type', text: 'dir' }],
    });
    expect(terminalResult.success).toBe(false);
    expect(terminalResult.error).toContain('requires explicit human confirmation');

    const notepadWindow = {
      handle: 'notepad-window',
      title: 'codebuddy-notepad-test.txt - Notepad',
      pid: 42,
      processName: 'notepad',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      focused: false,
      visible: true,
      minimized: false,
      maximized: false,
      fullscreen: false,
    };
    mockAutomation.getWindows
      .mockResolvedValueOnce([{ ...notepadWindow, focused: false }])
      .mockResolvedValue([{ ...notepadWindow, focused: true }]);

    const notepadResult = await tool.execute({
      action: 'use_app_workflow',
      appName: 'notepad',
      steps: [{ action: 'type', text: 'profile workflow' }],
    });
    expect(notepadResult.success).toBe(true);
    expect(mockAutomation.focusWindow).toHaveBeenCalledWith('notepad-window');
    expect(mockAutomation.type).toHaveBeenCalledWith('profile workflow', { delay: 30 });
  });

  it('waits for an app profile window to appear before focusing it', async () => {
    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();

    const notepadWindow = {
      handle: 'notepad-window',
      title: 'codebuddy-notepad-test.txt - Notepad',
      pid: 42,
      processName: 'notepad',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      focused: false,
      visible: true,
      minimized: false,
      maximized: false,
      fullscreen: false,
    };
    mockAutomation.getWindows
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([notepadWindow])
      .mockResolvedValueOnce([notepadWindow]);

    const result = await tool.execute({
      action: 'focus_app',
      appName: 'notepad',
      filePath: 'C:\\temp\\codebuddy-notepad-test.txt',
      timeoutMs: 500,
      pollIntervalMs: 25,
    });

    expect(result.success).toBe(true);
    expect(mockAutomation.getWindows.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mockAutomation.focusWindow).toHaveBeenCalledWith('notepad-window');
  });

  it('reports the failing step when a workflow stops early', async () => {
    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();

    const result = await tool.execute({
      action: 'macro',
      steps: [
        { action: 'wait', seconds: 0 },
        { action: 'click_button', name: 'Missing button' },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Step 2 (click_button) failed');
    expect(result.output).toContain('Failed at step 2');
  });

  it('clicks a single word on the screen using OCR text matching', async () => {
    ConfirmationService.getInstance().setInteractiveBridge(vi.fn().mockResolvedValue({ confirmed: true }));
    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();

    const result = await tool.execute({
      action: 'click_text',
      text: 'text',
    });

    expect(result.success).toBe(true);
    expect(mockAutomation.moveMouse).toHaveBeenCalledWith(85, 28); // center of box { x: 70, y: 20, width: 30, height: 15 }
    expect(mockAutomation.click).toHaveBeenCalledWith(undefined, undefined, { button: 'left' });
  });

  it('clicks a multi-word phrase on the screen using sequential horizontal OCR blocks matching', async () => {
    ConfirmationService.getInstance().setInteractiveBridge(vi.fn().mockResolvedValue({ confirmed: true }));
    const { ComputerControlTool } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();

    const result = await tool.execute({
      action: 'click_text',
      text: 'Save As',
    });

    expect(result.success).toBe(true);
    // Combined bounding box for "Save" and "As":
    // minX = 110, minY = 20, maxX = 160 + 20 = 180, maxY = 20 + 15 = 35.
    // Width = 180 - 110 = 70. Height = 35 - 20 = 15.
    // Center = 110 + 35 = 145, 20 + 8 = 28 (rounded).
    expect(mockAutomation.moveMouse).toHaveBeenCalledWith(145, 28);
    expect(mockAutomation.click).toHaveBeenCalledWith(undefined, undefined, { button: 'left' });
  });

  it('triggers visual grounding fallback when UIA fails to match the element name', async () => {
    ConfirmationService.getInstance().setInteractiveBridge(vi.fn().mockResolvedValue({ confirmed: true }));
    const { ComputerControlTool, setVisionGroundingProvider } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();

    // Enable grounding fallback
    process.env.CODEBUDDY_VISION_GROUNDING = '1';

    // Mock annotated screenshot
    mockSnapshotManager.toAnnotatedScreenshot.mockResolvedValue({ image: 'fake-base64-data' });

    // Set up snapshot with an interactive element that UIA will not match by name
    const element = makeElement({ ref: 99, role: 'button', name: 'Unmatched Button', interactive: true });
    setCurrentSnapshot(makeSnapshot([element]));

    // Register a stub grounding provider returning ref 99
    const groundingProviderSpy = vi.fn().mockResolvedValue(99);
    setVisionGroundingProvider(groundingProviderSpy);

    const result = await tool.execute({
      action: 'click_button',
      name: 'Virtual Button', // Query name doesn't match 'Unmatched Button' in UIA
    });

    expect(result.success).toBe(true);
    expect(groundingProviderSpy).toHaveBeenCalledWith(expect.objectContaining({
      imageBase64: 'fake-base64-data',
      intent: 'Virtual Button',
      roleHint: 'button',
      candidates: [
        { ref: 99, role: 'button', name: 'Unmatched Button' }
      ]
    }));

    // Verify click succeeded on the grounding-matched element
    expect(mockAutomation.click).toHaveBeenCalledWith(element.center.x, element.center.y, { button: 'left' });

    // Clean up
    setVisionGroundingProvider(null);
    delete process.env.CODEBUDDY_VISION_GROUNDING;
  });

  it('triggers visual grounding coordinate fallback when UIA is empty', async () => {
    ConfirmationService.getInstance().setInteractiveBridge(vi.fn().mockResolvedValue({ confirmed: true }));
    const { ComputerControlTool, setVisionGroundingProvider } = await import('../../src/tools/computer-control-tool.js');
    const tool = new ComputerControlTool();

    // Enable grounding fallback
    process.env.CODEBUDDY_VISION_GROUNDING = '1';

    // Mock annotated screenshot
    mockSnapshotManager.toAnnotatedScreenshot.mockResolvedValue({ image: 'fake-base64-data' });

    // Set up snapshot with no elements
    setCurrentSnapshot(makeSnapshot([]));

    // Register a stub grounding provider returning coordinates { x: 500, y: 600 }
    const groundingProviderSpy = vi.fn().mockResolvedValue({ x: 500, y: 600 });
    setVisionGroundingProvider(groundingProviderSpy);

    const result = await tool.execute({
      action: 'click_button',
      name: 'Virtual Button',
    });

    expect(result.success).toBe(true);
    expect(groundingProviderSpy).toHaveBeenCalledWith(expect.objectContaining({
      imageBase64: 'fake-base64-data',
      intent: 'Virtual Button',
      roleHint: 'button',
      candidates: []
    }));

    // Center coordinates scale 500/1000 and 600/1000 relative to screen size (1280x720 in the test snapshot)
    // 500/1000 * 1280 = 640
    // 600/1000 * 720 = 432
    expect(mockAutomation.click).toHaveBeenCalledWith(640, 432, { button: 'left' });

    // Clean up
    setVisionGroundingProvider(null);
    delete process.env.CODEBUDDY_VISION_GROUNDING;
  });
});
