/**
 * Tests for Browser Screenshot Annotator
 *
 * Tests:
 * - Returns original buffer when Sharp is not available
 * - Filters out invisible elements (only annotates visible + boundingBox)
 * - Supports 'circle' and 'pill' badge styles
 * - Accepts custom AnnotationOptions (color, textColor, fontSize)
 * - Returns original buffer on composite failure
 * - Handles empty element arrays
 * - Clamps badge positions to image bounds
 */

import type { WebElement } from '../../src/browser-automation/types.js';

// ---------------------------------------------------------------------------
// Mocks – declared before any import that touches the annotator
// ---------------------------------------------------------------------------

// Chainable Sharp instance mock
const mockSharpInstance: Record<string, jest.Mock> = {
  metadata: jest.fn(),
  composite: jest.fn(),
  png: jest.fn(),
  toBuffer: jest.fn(),
};

const mockSharpDefault = jest.fn().mockReturnValue(mockSharpInstance);

// Flag to control whether sharp import should fail
let sharpUnavailable = false;

// Mock sharp module – the source uses `await import('sharp')` then `sharp.default(buffer)`
// When sharpUnavailable is true, the factory throws to simulate a missing module.
jest.mock('sharp', () => {
  if (sharpUnavailable) {
    throw new Error('Cannot find module \'sharp\'');
  }
  return {
    __esModule: true,
    default: mockSharpDefault,
  };
});

jest.mock('../../src/utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Import after mocks are set up (this import uses the non-throwing sharp mock)
import { annotateScreenshot } from '../../src/browser-automation/screenshot-annotator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Minimal 1x1 transparent PNG (base64)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQIHWNgAAIABQABNjN9GQAAAAlFTkSuQmCC',
  'base64'
);

function makeElement(overrides: Partial<WebElement> = {}): WebElement {
  return {
    ref: 1,
    tagName: 'button',
    role: 'button',
    name: 'Test Button',
    text: 'Click me',
    boundingBox: { x: 100, y: 100, width: 80, height: 30 },
    center: { x: 140, y: 115 },
    visible: true,
    interactive: true,
    focused: false,
    disabled: false,
    ...overrides,
  };
}

/**
 * Load the annotator module fresh with sharp set to fail.
 * Uses jest.resetModules + require to get a fresh module instance
 * where the sharp mock factory throws.
 */
async function loadAnnotatorWithoutSharp(): Promise<typeof annotateScreenshot> {
  sharpUnavailable = true;
  jest.resetModules();
  // Re-mock logger for the fresh module load
  jest.mock('../../src/utils/logger', () => ({
    logger: {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  }));
   
  const mod = require('../../src/browser-automation/screenshot-annotator');
  return mod.annotateScreenshot;
}

// ============================================================================
// Test suite
// ============================================================================

describe('annotateScreenshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sharpUnavailable = false;

    // Reset chainable mock behaviour
    mockSharpInstance.metadata.mockResolvedValue({ width: 1280, height: 720 });
    mockSharpInstance.composite.mockReturnValue(mockSharpInstance);
    mockSharpInstance.png.mockReturnValue(mockSharpInstance);
    mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from('annotated-png'));
  });

  // --------------------------------------------------------------------------
  // Sharp available - basic operation
  // --------------------------------------------------------------------------

  describe('when Sharp is available', () => {
    it('should return an annotated buffer', async () => {
      const elements = [makeElement({ ref: 1 })];
      const result = await annotateScreenshot(TINY_PNG, elements);

      expect(result).toEqual(Buffer.from('annotated-png'));
      expect(mockSharpDefault).toHaveBeenCalled();
      expect(mockSharpInstance.composite).toHaveBeenCalledTimes(1);
      expect(mockSharpInstance.png).toHaveBeenCalledTimes(1);
      expect(mockSharpInstance.toBuffer).toHaveBeenCalledTimes(1);
    });

    it('should pass an SVG overlay to composite', async () => {
      const elements = [makeElement({ ref: 42 })];
      await annotateScreenshot(TINY_PNG, elements);

      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      expect(compositeCall).toHaveLength(1);
      expect(compositeCall[0].top).toBe(0);
      expect(compositeCall[0].left).toBe(0);

      const svgContent = compositeCall[0].input.toString('utf-8');
      expect(svgContent).toContain('<svg');
      expect(svgContent).toContain('42'); // ref label
    });

    it('should handle empty element array', async () => {
      const result = await annotateScreenshot(TINY_PNG, []);

      expect(result).toEqual(Buffer.from('annotated-png'));
      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      const svgContent = compositeCall[0].input.toString('utf-8');
      expect(svgContent).toContain('<svg');
      expect(svgContent).not.toContain('<circle');
      expect(svgContent).not.toContain('<rect');
    });
  });

  // --------------------------------------------------------------------------
  // Filtering: visible + boundingBox
  // --------------------------------------------------------------------------

  describe('element filtering', () => {
    it('should filter out invisible elements', async () => {
      const elements = [
        makeElement({ ref: 1, visible: true }),
        makeElement({ ref: 2, visible: false }),
        makeElement({ ref: 3, visible: true }),
      ];

      await annotateScreenshot(TINY_PNG, elements);

      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      const svgContent = compositeCall[0].input.toString('utf-8');

      expect(svgContent).toContain('>1<');
      expect(svgContent).toContain('>3<');
      expect(svgContent).not.toContain('>2<');
    });

    it('should only annotate elements with a truthy boundingBox', async () => {
      const noBBox = makeElement({ ref: 5 });
      (noBBox as any).boundingBox = null;

      const withBBox = makeElement({ ref: 6 });

      await annotateScreenshot(TINY_PNG, [noBBox, withBBox]);

      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      const svgContent = compositeCall[0].input.toString('utf-8');

      expect(svgContent).toContain('>6<');
      expect(svgContent).not.toContain('>5<');
    });
  });

  // --------------------------------------------------------------------------
  // Badge styles
  // --------------------------------------------------------------------------

  describe('badge styles', () => {
    it('should render circle badges by default', async () => {
      const elements = [makeElement({ ref: 1 })];
      await annotateScreenshot(TINY_PNG, elements);

      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      const svgContent = compositeCall[0].input.toString('utf-8');

      expect(svgContent).toContain('<circle');
      expect(svgContent).not.toContain('<rect');
    });

    it('should render circle badges when style is explicitly "circle"', async () => {
      const elements = [makeElement({ ref: 1 })];
      await annotateScreenshot(TINY_PNG, elements, { style: 'circle' });

      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      const svgContent = compositeCall[0].input.toString('utf-8');

      expect(svgContent).toContain('<circle');
    });

    it('should render pill badges when style is "pill"', async () => {
      const elements = [makeElement({ ref: 1 })];
      await annotateScreenshot(TINY_PNG, elements, { style: 'pill' });

      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      const svgContent = compositeCall[0].input.toString('utf-8');

      expect(svgContent).toContain('<rect');
      expect(svgContent).toContain('rx="10"');
      expect(svgContent).toContain('ry="10"');
      expect(svgContent).not.toContain('<circle');
    });
  });

  // --------------------------------------------------------------------------
  // Custom AnnotationOptions
  // --------------------------------------------------------------------------

  describe('custom options', () => {
    it('should apply custom color', async () => {
      const elements = [makeElement({ ref: 1 })];
      await annotateScreenshot(TINY_PNG, elements, { color: '#00FF00' });

      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      const svgContent = compositeCall[0].input.toString('utf-8');

      expect(svgContent).toContain('fill="#00FF00"');
    });

    it('should apply custom text color', async () => {
      const elements = [makeElement({ ref: 1 })];
      await annotateScreenshot(TINY_PNG, elements, { textColor: '#000000' });

      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      const svgContent = compositeCall[0].input.toString('utf-8');

      expect(svgContent).toContain('fill="#000000"');
    });

    it('should apply custom font size', async () => {
      const elements = [makeElement({ ref: 1 })];
      await annotateScreenshot(TINY_PNG, elements, { fontSize: 18 });

      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      const svgContent = compositeCall[0].input.toString('utf-8');

      expect(svgContent).toContain('font-size="18"');
    });

    it('should use default options when none provided', async () => {
      const elements = [makeElement({ ref: 1 })];
      await annotateScreenshot(TINY_PNG, elements);

      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      const svgContent = compositeCall[0].input.toString('utf-8');

      // Defaults: color=#FF6B6B, textColor=#FFFFFF, fontSize=12
      expect(svgContent).toContain('fill="#FF6B6B"');
      expect(svgContent).toContain('fill="#FFFFFF"');
      expect(svgContent).toContain('font-size="12"');
    });
  });

  // --------------------------------------------------------------------------
  // Position clamping
  // --------------------------------------------------------------------------

  describe('position clamping', () => {
    it('should clamp badge x to not exceed image width', async () => {
      const elements = [
        makeElement({
          ref: 1,
          boundingBox: { x: 1300, y: 100, width: 50, height: 30 },
        }),
      ];

      await annotateScreenshot(TINY_PNG, elements);

      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      const svgContent = compositeCall[0].input.toString('utf-8');

      // x should be clamped to imgWidth - 30 = 1250
      expect(svgContent).toContain('<circle');
      // The clamped x is 1250, radius = max(12, 1*5+6) = 12, so cx = 1250 + 12 = 1262
      expect(svgContent).toContain('cx="1262"');
    });

    it('should clamp badge y to not go below zero', async () => {
      const elements = [
        makeElement({
          ref: 1,
          boundingBox: { x: 100, y: 5, width: 50, height: 30 },
        }),
      ];

      await annotateScreenshot(TINY_PNG, elements);

      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      const svgContent = compositeCall[0].input.toString('utf-8');

      // y = max(5 - 10, 0) = 0, radius = 12, so cy = 0 + 12 = 12
      expect(svgContent).toContain('cy="12"');
    });
  });

  // --------------------------------------------------------------------------
  // Error handling: composite failure
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    it('should return original buffer when composite fails', async () => {
      mockSharpInstance.toBuffer.mockRejectedValueOnce(new Error('Composite failed'));

      const input = Buffer.from(TINY_PNG);
      const elements = [makeElement({ ref: 1 })];

      const result = await annotateScreenshot(input, elements);
      expect(result).toBe(input);
    });

    it('should use fallback dimensions when metadata has no width/height', async () => {
      mockSharpInstance.metadata.mockResolvedValueOnce({});

      const elements = [makeElement({ ref: 1 })];
      const result = await annotateScreenshot(TINY_PNG, elements);

      expect(result).toEqual(Buffer.from('annotated-png'));

      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      const svgContent = compositeCall[0].input.toString('utf-8');
      expect(svgContent).toContain('width="1280"');
      expect(svgContent).toContain('height="720"');
    });
  });

  // --------------------------------------------------------------------------
  // Multiple elements
  // --------------------------------------------------------------------------

  describe('multiple elements', () => {
    it('should render badges for all visible elements', async () => {
      const elements = [
        makeElement({ ref: 1, boundingBox: { x: 10, y: 10, width: 80, height: 30 } }),
        makeElement({ ref: 2, boundingBox: { x: 200, y: 50, width: 100, height: 40 } }),
        makeElement({ ref: 3, boundingBox: { x: 400, y: 100, width: 60, height: 25 } }),
      ];

      await annotateScreenshot(TINY_PNG, elements);

      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      const svgContent = compositeCall[0].input.toString('utf-8');

      expect(svgContent).toContain('>1<');
      expect(svgContent).toContain('>2<');
      expect(svgContent).toContain('>3<');
    });

    it('should render pill badges with appropriate width for multi-digit refs', async () => {
      const elements = [
        makeElement({ ref: 100, boundingBox: { x: 10, y: 10, width: 80, height: 30 } }),
      ];

      await annotateScreenshot(TINY_PNG, elements, { style: 'pill' });

      const compositeCall = mockSharpInstance.composite.mock.calls[0][0];
      const svgContent = compositeCall[0].input.toString('utf-8');

      // pill width = max(24, "100".length * 10 + 12) = max(24, 42) = 42
      expect(svgContent).toContain('width="42"');
      expect(svgContent).toContain('>100<');
    });
  });

  // --------------------------------------------------------------------------
  // Sharp unavailable (requires fresh module load with throwing mock)
  // --------------------------------------------------------------------------

  describe('when Sharp is not available', () => {
    it('should return the original buffer unchanged', async () => {
      const annotateNoSharp = await loadAnnotatorWithoutSharp();

      const input = Buffer.from(TINY_PNG);
      const result = await annotateNoSharp(input, [makeElement()]);
      expect(result).toBe(input);
    });

    it('should not throw even with multiple elements', async () => {
      const annotateNoSharp = await loadAnnotatorWithoutSharp();

      const elements = [
        makeElement({ ref: 1 }),
        makeElement({ ref: 2, boundingBox: { x: 200, y: 200, width: 60, height: 20 } }),
      ];
      const result = await annotateNoSharp(TINY_PNG, elements);
      expect(result).toBe(TINY_PNG);
    });

    afterEach(() => {
      // Restore sharp availability for subsequent tests
      sharpUnavailable = false;
    });
  });
});
