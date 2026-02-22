/**
 * Tests for Computer Use Tool Adapters
 *
 * Tests the new ITool adapters added to misc-tools.ts:
 * - BrowserExecuteTool (rewired to browser-automation module)
 * - ComputerControlExecuteTool
 * - ScreenshotExecuteTool
 * - createMiscTools() factory
 */

import {
  BrowserExecuteTool,
  ComputerControlExecuteTool,
  ScreenshotExecuteTool,
  ReasoningExecuteTool,
  createMiscTools,
  resetMiscInstances,
} from '../../../src/tools/registry/misc-tools.js';

// Mock browser-automation module
jest.mock('../../../src/browser-automation/index.js', () => ({
  BrowserTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, output: 'Browser result' }),
    close: jest.fn(),
  })),
  getBrowserTool: jest.fn(),
  resetBrowserTool: jest.fn(),
}));

// Mock computer-control-tool
jest.mock('../../../src/tools/computer-control-tool.js', () => ({
  getComputerControlTool: jest.fn().mockReturnValue({
    execute: jest.fn().mockResolvedValue({ success: true, output: 'Computer control result' }),
  }),
  ComputerControlTool: jest.fn(),
}));

// Mock screenshot-tool
jest.mock('../../../src/tools/screenshot-tool.js', () => ({
  ScreenshotTool: jest.fn().mockImplementation(() => ({
    capture: jest.fn().mockResolvedValue({
      success: true,
      output: 'Screenshot captured',
      data: { path: '/tmp/screenshot.png' },
    }),
  })),
}));

// Mock reasoning-tool (already used in tests)
jest.mock('../../../src/tools/reasoning-tool.js', () => ({
  ReasoningTool: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({ success: true, output: 'Reasoning result' }),
  })),
}));

describe('Computer Use Tool Adapters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMiscInstances();
  });

  // ============================================================================
  // BrowserExecuteTool
  // ============================================================================

  describe('BrowserExecuteTool', () => {
    let tool: BrowserExecuteTool;

    beforeEach(() => {
      tool = new BrowserExecuteTool();
    });

    it('should have correct name and description', () => {
      expect(tool.name).toBe('browser');
      expect(tool.description).toContain('accessibility');
    });

    describe('getSchema', () => {
      it('should return valid schema with all browser actions', () => {
        const schema = tool.getSchema();
        expect(schema.name).toBe('browser');
        expect(schema.parameters.required).toEqual(['action']);

        const actionEnum = schema.parameters.properties!.action.enum;
        expect(actionEnum).toContain('launch');
        expect(actionEnum).toContain('snapshot');
        expect(actionEnum).toContain('click');
        expect(actionEnum).toContain('navigate');
        expect(actionEnum).toContain('fill');
        expect(actionEnum).toContain('type');
        expect(actionEnum).toContain('screenshot');
        expect(actionEnum).toContain('evaluate');
        expect(actionEnum).toContain('get_element');
        expect(actionEnum).toContain('find_elements');
      });

      it('should include ref parameter for element-based actions', () => {
        const schema = tool.getSchema();
        expect(schema.parameters.properties!.ref).toBeDefined();
        expect(schema.parameters.properties!.ref.type).toBe('number');
      });

      it('should include all interaction parameters', () => {
        const schema = tool.getSchema();
        const props = schema.parameters.properties!;
        expect(props.text).toBeDefined();
        expect(props.key).toBeDefined();
        expect(props.url).toBeDefined();
        expect(props.expression).toBeDefined();
        expect(props.fields).toBeDefined();
      });
    });

    describe('validate', () => {
      it('should accept valid input', () => {
        const result = tool.validate({ action: 'navigate', url: 'https://example.com' });
        expect(result.valid).toBe(true);
      });

      it('should reject non-object input', () => {
        const result = tool.validate('not an object');
        expect(result.valid).toBe(false);
      });

      it('should reject missing action', () => {
        const result = tool.validate({ url: 'https://example.com' });
        expect(result.valid).toBe(false);
      });

      it('should reject unknown action', () => {
        const result = tool.validate({ action: 'fly_to_moon' });
        expect(result.valid).toBe(false);
        expect(result.errors?.[0]).toContain('Unknown action');
      });

      it('should accept all valid actions', () => {
        const actions = [
          'launch', 'connect', 'close',
          'snapshot', 'click', 'navigate', 'type', 'fill',
          'go_back', 'go_forward', 'reload',
          'screenshot', 'pdf', 'evaluate',
        ];
        for (const action of actions) {
          expect(tool.validate({ action }).valid).toBe(true);
        }
      });
    });

    describe('getMetadata', () => {
      it('should return correct metadata', () => {
        const meta = tool.getMetadata();
        expect(meta.category).toBe('web');
        expect(meta.keywords).toContain('accessibility');
        expect(meta.requiresConfirmation).toBe(true);
        expect(meta.makesNetworkRequests).toBe(true);
      });
    });

    describe('execute', () => {
      it('should forward input to browser-automation BrowserTool', async () => {
        const result = await tool.execute({ action: 'navigate', url: 'https://example.com' });
        expect(result.success).toBe(true);
        expect(result.output).toBe('Browser result');
      });
    });

    it('should be available', () => {
      expect(tool.isAvailable()).toBe(true);
    });
  });

  // ============================================================================
  // ComputerControlExecuteTool
  // ============================================================================

  describe('ComputerControlExecuteTool', () => {
    let tool: ComputerControlExecuteTool;

    beforeEach(() => {
      tool = new ComputerControlExecuteTool();
    });

    it('should have correct name and description', () => {
      expect(tool.name).toBe('computer_control');
      expect(tool.description).toContain('mouse');
      expect(tool.description).toContain('keyboard');
    });

    describe('getSchema', () => {
      it('should return valid schema with all actions', () => {
        const schema = tool.getSchema();
        expect(schema.name).toBe('computer_control');
        expect(schema.parameters.required).toEqual(['action']);

        const actionEnum = schema.parameters.properties!.action.enum;
        expect(actionEnum).toContain('snapshot');
        expect(actionEnum).toContain('snapshot_with_screenshot');
        expect(actionEnum).toContain('click');
        expect(actionEnum).toContain('type');
        expect(actionEnum).toContain('key');
        expect(actionEnum).toContain('hotkey');
        expect(actionEnum).toContain('get_windows');
        expect(actionEnum).toContain('focus_window');
        expect(actionEnum).toContain('system_info');
      });

      it('should include ref and coordinate parameters', () => {
        const schema = tool.getSchema();
        const props = schema.parameters.properties!;
        expect(props.ref).toBeDefined();
        expect(props.x).toBeDefined();
        expect(props.y).toBeDefined();
        expect(props.ref.type).toBe('number');
      });
    });

    describe('validate', () => {
      it('should accept valid input', () => {
        expect(tool.validate({ action: 'click', ref: 5 }).valid).toBe(true);
      });

      it('should reject non-object input', () => {
        expect(tool.validate(null).valid).toBe(false);
      });

      it('should reject empty action', () => {
        expect(tool.validate({ action: '' }).valid).toBe(false);
      });

      it('should reject unknown action', () => {
        const result = tool.validate({ action: 'teleport' });
        expect(result.valid).toBe(false);
      });
    });

    describe('getMetadata', () => {
      it('should return correct metadata', () => {
        const meta = tool.getMetadata();
        expect(meta.category).toBe('utility');
        expect(meta.keywords).toContain('computer');
        expect(meta.keywords).toContain('desktop');
        expect(meta.requiresConfirmation).toBe(true);
        expect(meta.makesNetworkRequests).toBe(false);
      });
    });

    describe('execute', () => {
      it('should forward input to ComputerControlTool', async () => {
        const result = await tool.execute({ action: 'snapshot' });
        expect(result.success).toBe(true);
        expect(result.output).toBe('Computer control result');
      });
    });

    it('should be available', () => {
      expect(tool.isAvailable()).toBe(true);
    });
  });

  // ============================================================================
  // ScreenshotExecuteTool
  // ============================================================================

  describe('ScreenshotExecuteTool', () => {
    let tool: ScreenshotExecuteTool;

    beforeEach(() => {
      tool = new ScreenshotExecuteTool();
    });

    it('should have correct name and description', () => {
      expect(tool.name).toBe('screenshot');
      expect(tool.description).toContain('screenshot');
    });

    describe('getSchema', () => {
      it('should return valid schema', () => {
        const schema = tool.getSchema();
        expect(schema.name).toBe('screenshot');

        const props = schema.parameters.properties!;
        expect(props.fullscreen).toBeDefined();
        expect(props.window).toBeDefined();
        expect(props.region).toBeDefined();
        expect(props.format).toBeDefined();
        expect(props.forLLM).toBeDefined();
      });

      it('should not require any parameters', () => {
        const schema = tool.getSchema();
        expect(schema.parameters.required).toEqual([]);
      });
    });

    describe('validate', () => {
      it('should accept empty object', () => {
        expect(tool.validate({}).valid).toBe(true);
      });

      it('should accept valid options', () => {
        expect(tool.validate({ fullscreen: true, format: 'png' }).valid).toBe(true);
      });

      it('should reject non-object input', () => {
        expect(tool.validate('string').valid).toBe(false);
        expect(tool.validate(null).valid).toBe(false);
      });
    });

    describe('getMetadata', () => {
      it('should return correct metadata', () => {
        const meta = tool.getMetadata();
        expect(meta.category).toBe('utility');
        expect(meta.keywords).toContain('screenshot');
        expect(meta.requiresConfirmation).toBe(false);
        expect(meta.modifiesFiles).toBe(true);
      });
    });

    describe('execute', () => {
      it('should forward options to ScreenshotTool.capture', async () => {
        const result = await tool.execute({ fullscreen: true, forLLM: true });
        expect(result.success).toBe(true);
        expect(result.output).toBe('Screenshot captured');
      });
    });

    it('should be available', () => {
      expect(tool.isAvailable()).toBe(true);
    });
  });

  // ============================================================================
  // createMiscTools Factory
  // ============================================================================

  describe('createMiscTools', () => {
    it('should return all tool types', () => {
      const tools = createMiscTools();
      expect(tools).toHaveLength(6);

      const names = tools.map(t => t.name);
      expect(names).toContain('browser');
      expect(names).toContain('computer_control');
      expect(names).toContain('screenshot');
      expect(names).toContain('reason');
    });

    it('should return ITool-compliant instances', () => {
      const tools = createMiscTools();
      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(tool.description).toBeDefined();
        expect(typeof tool.execute).toBe('function');
        expect(typeof tool.getSchema).toBe('function');
        expect(typeof tool.validate).toBe('function');
        expect(typeof tool.getMetadata).toBe('function');
        expect(typeof tool.isAvailable).toBe('function');
      }
    });
  });
});
