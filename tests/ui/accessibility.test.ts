/**
 * Tests for accessibility pure-logic utilities
 *
 * Only tests exported pure functions — no React hooks.
 */

import {
  calculateContrastRatio,
  checkContrast,
  getHighContrastColor,
  generateAriaLabel,
  getAnimationDuration,
} from '../../src/ui/utils/accessibility';

describe('Accessibility utilities', () => {
  // --------------------------------------------------------------------------
  // calculateContrastRatio()
  // --------------------------------------------------------------------------

  describe('calculateContrastRatio()', () => {
    it('should return 21:1 for black on white', () => {
      const ratio = calculateContrastRatio('#000000', '#ffffff');
      expect(ratio).toBeCloseTo(21, 0);
    });

    it('should return 1:1 for identical colors', () => {
      expect(calculateContrastRatio('#ff0000', '#ff0000')).toBeCloseTo(1, 1);
    });

    it('should return 1 for invalid hex colors', () => {
      expect(calculateContrastRatio('not-a-color', '#ffffff')).toBe(1);
      expect(calculateContrastRatio('#fff', '#000')).toBe(1); // 3-char hex not supported
    });

    it('should be symmetric (order-independent)', () => {
      const ab = calculateContrastRatio('#336699', '#ffffff');
      const ba = calculateContrastRatio('#ffffff', '#336699');
      expect(ab).toBeCloseTo(ba, 5);
    });

    it('should handle colors without # prefix', () => {
      const ratio = calculateContrastRatio('000000', 'ffffff');
      expect(ratio).toBeCloseTo(21, 0);
    });
  });

  // --------------------------------------------------------------------------
  // checkContrast()
  // --------------------------------------------------------------------------

  describe('checkContrast()', () => {
    it('should pass AA and AAA for black on white (normal text)', () => {
      const result = checkContrast('#000000', '#ffffff');
      expect(result.isAA).toBe(true);
      expect(result.isAAA).toBe(true);
      expect(result.ratio).toBeCloseTo(21, 0);
    });

    it('should fail AA for low-contrast pair (normal text)', () => {
      // Light gray on white — ratio ~1.5
      const result = checkContrast('#cccccc', '#ffffff');
      expect(result.isAA).toBe(false);
      expect(result.isAAA).toBe(false);
    });

    it('should use large text thresholds (3:1 AA, 4.5:1 AAA)', () => {
      // Medium gray on white — ratio ~4.0
      const result = checkContrast('#767676', '#ffffff', true);
      expect(result.isAA).toBe(true);
      // 4.0 < 4.5 — fails AAA for large text
    });

    it('should round ratio to 2 decimals', () => {
      const result = checkContrast('#000000', '#ffffff');
      const decimals = result.ratio.toString().split('.')[1] || '';
      expect(decimals.length).toBeLessThanOrEqual(2);
    });
  });

  // --------------------------------------------------------------------------
  // getHighContrastColor()
  // --------------------------------------------------------------------------

  describe('getHighContrastColor()', () => {
    it('should return original color if already meets target', () => {
      const result = getHighContrastColor('#000000', '#ffffff');
      expect(result).toBe('#000000');
    });

    it('should darken color on light background', () => {
      // Light gray on white — needs darkening
      const result = getHighContrastColor('#cccccc', '#ffffff');
      const newRatio = calculateContrastRatio(result, '#ffffff');
      expect(newRatio).toBeGreaterThanOrEqual(4.5);
    });

    it('should lighten color on dark background', () => {
      // Dark gray on black — needs lightening
      const result = getHighContrastColor('#333333', '#000000');
      const newRatio = calculateContrastRatio(result, '#000000');
      expect(newRatio).toBeGreaterThanOrEqual(4.5);
    });

    it('should return original for invalid colors', () => {
      expect(getHighContrastColor('invalid', '#ffffff')).toBe('invalid');
      expect(getHighContrastColor('#aabbcc', 'invalid')).toBe('#aabbcc');
    });

    it('should respect custom targetRatio', () => {
      const result = getHighContrastColor('#999999', '#ffffff', 7.0);
      const newRatio = calculateContrastRatio(result, '#ffffff');
      expect(newRatio).toBeGreaterThanOrEqual(7.0);
    });
  });

  // --------------------------------------------------------------------------
  // generateAriaLabel()
  // --------------------------------------------------------------------------

  describe('generateAriaLabel()', () => {
    it('should return just label when no context', () => {
      expect(generateAriaLabel('Submit')).toBe('Submit');
    });

    it('should append role', () => {
      expect(generateAriaLabel('Submit', { role: 'button' })).toBe('Submit, button');
    });

    it('should append index/total', () => {
      const label = generateAriaLabel('Item', { index: 2, total: 5 });
      expect(label).toBe('Item, 3 of 5');
    });

    it('should append state', () => {
      const label = generateAriaLabel('Menu', { state: 'expanded' });
      expect(label).toBe('Menu, expanded');
    });

    it('should combine all context parts', () => {
      const label = generateAriaLabel('Tab', {
        role: 'tab',
        index: 0,
        total: 3,
        state: 'selected',
      });
      expect(label).toBe('Tab, tab, 1 of 3, selected');
    });
  });

  // --------------------------------------------------------------------------
  // getAnimationDuration()
  // --------------------------------------------------------------------------

  describe('getAnimationDuration()', () => {
    it('should return default when reducedMotion is false', () => {
      expect(getAnimationDuration(300, false)).toBe(300);
    });

    it('should return 0 when reducedMotion is true', () => {
      expect(getAnimationDuration(300, true)).toBe(0);
      expect(getAnimationDuration(1000, true)).toBe(0);
    });
  });
});
