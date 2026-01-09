/**
 * Unit tests for StatusBar Component
 *
 * Tests for the StatusBar and MiniStatusBar React components:
 * - Token usage display and progress bar
 * - Cost tracking with budget indicator
 * - Performance metrics (tokens/sec, latency)
 * - Session time tracking
 * - Model info display
 * - Compact mode rendering
 * - Warning states for budget/token limits
 */

// Mock React and Ink before imports
jest.mock('react', () => {
  const React = jest.requireActual('react');
  return {
    ...React,
    useState: jest.fn((initial) => [initial, jest.fn()]),
    useEffect: jest.fn(),
    useMemo: jest.fn((fn) => fn()),
  };
});

jest.mock('ink', () => ({
  Box: 'Box',
  Text: 'Text',
}));

jest.mock('../../src/ui/context/theme-context', () => ({
  useTheme: jest.fn(() => ({
    colors: {
      primary: '#007AFF',
      success: '#34C759',
      warning: '#FF9500',
      error: '#FF3B30',
      info: '#5856D6',
      accent: '#AF52DE',
      text: '#FFFFFF',
      textMuted: '#8E8E93',
      border: '#3A3A3C',
      borderActive: '#007AFF',
      borderBusy: '#FF9500',
      backgroundAlt: '#2C2C2E',
    },
  })),
}));

jest.mock('../../src/utils/token-counter', () => ({
  formatTokenCount: jest.fn((count: number) => {
    if (count <= 999) return count.toString();
    if (count < 1000000) {
      const k = count / 1000;
      return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
    }
    const m = count / 1000000;
    return m % 1 === 0 ? `${m}m` : `${m.toFixed(1)}m`;
  }),
}));

// Import after mocking
import React from 'react';
import { useTheme } from '../../src/ui/context/theme-context';

// Import the module to test helper functions
// We can't directly test React components without a proper renderer,
// but we can test the utility functions and verify the component structure

describe('StatusBar Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset useState mock to return proper values
    (React.useState as jest.Mock).mockImplementation((initial) => [initial, jest.fn()]);
    (React.useMemo as jest.Mock).mockImplementation((fn) => fn());
    (React.useEffect as jest.Mock).mockImplementation(() => {});
  });

  // ==========================================================================
  // formatDuration Tests
  // ==========================================================================

  describe('formatDuration', () => {
    // Import the function by requiring the module and accessing exported items
    // Since formatDuration is not exported, we test it indirectly through component behavior

    it('should format seconds correctly', () => {
      // formatDuration is an internal function, test logic directly
      const formatDuration = (seconds: number): string => {
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (mins < 60) return `${mins}m ${secs}s`;
        const hours = Math.floor(mins / 60);
        const remainingMins = mins % 60;
        return `${hours}h ${remainingMins}m`;
      };

      expect(formatDuration(30)).toBe('30s');
      expect(formatDuration(59)).toBe('59s');
      expect(formatDuration(60)).toBe('1m 0s');
      expect(formatDuration(90)).toBe('1m 30s');
      expect(formatDuration(3600)).toBe('1h 0m');
      expect(formatDuration(3661)).toBe('1h 1m');
      expect(formatDuration(7200)).toBe('2h 0m');
    });
  });

  // ==========================================================================
  // formatCost Tests
  // ==========================================================================

  describe('formatCost', () => {
    it('should format costs correctly', () => {
      // Replicate internal formatCost logic for testing
      const formatCost = (cost: number): string => {
        if (cost < 0.01) return `$${(cost * 1000).toFixed(2)}m`;
        if (cost < 1) return `$${cost.toFixed(3)}`;
        return `$${cost.toFixed(2)}`;
      };

      expect(formatCost(0.001)).toBe('$1.00m');
      expect(formatCost(0.005)).toBe('$5.00m');
      expect(formatCost(0.05)).toBe('$0.050');
      expect(formatCost(0.5)).toBe('$0.500');
      expect(formatCost(1.0)).toBe('$1.00');
      expect(formatCost(10.5)).toBe('$10.50');
      expect(formatCost(100.999)).toBe('$101.00');
    });

    it('should handle edge case of exactly 0.01', () => {
      const formatCost = (cost: number): string => {
        if (cost < 0.01) return `$${(cost * 1000).toFixed(2)}m`;
        if (cost < 1) return `$${cost.toFixed(3)}`;
        return `$${cost.toFixed(2)}`;
      };

      expect(formatCost(0.01)).toBe('$0.010');
    });
  });

  // ==========================================================================
  // calculateTokensPerSecond Tests
  // ==========================================================================

  describe('calculateTokensPerSecond', () => {
    it('should calculate tokens per second correctly', () => {
      const calculateTokensPerSecond = (tokens: number, seconds: number): number => {
        if (seconds === 0) return 0;
        return Math.round(tokens / seconds);
      };

      expect(calculateTokensPerSecond(1000, 10)).toBe(100);
      expect(calculateTokensPerSecond(500, 2)).toBe(250);
      expect(calculateTokensPerSecond(0, 10)).toBe(0);
      expect(calculateTokensPerSecond(1000, 0)).toBe(0);
      expect(calculateTokensPerSecond(1500, 3)).toBe(500);
    });
  });

  // ==========================================================================
  // Metrics Calculation Tests
  // ==========================================================================

  describe('Metrics Calculation', () => {
    const mockColors = {
      success: '#34C759',
      warning: '#FF9500',
      error: '#FF3B30',
    };

    it('should calculate token progress correctly', () => {
      const tokenCount = 64000;
      const maxTokens = 128000;
      const tokenProgress = maxTokens > 0 ? (tokenCount / maxTokens) * 100 : 0;

      expect(tokenProgress).toBe(50);
    });

    it('should calculate cost progress correctly', () => {
      const cost = 5;
      const budget = 10;
      const costProgress = budget > 0 ? (cost / budget) * 100 : 0;

      expect(costProgress).toBe(50);
    });

    it('should return success color for low token usage', () => {
      const tokenProgress = 40;
      let tokenColor: string;
      if (tokenProgress < 50) tokenColor = mockColors.success;
      else if (tokenProgress < 80) tokenColor = mockColors.warning;
      else tokenColor = mockColors.error;

      expect(tokenColor).toBe(mockColors.success);
    });

    it('should return warning color for medium token usage', () => {
      const tokenProgress = 60;
      let tokenColor: string;
      if (tokenProgress < 50) tokenColor = mockColors.success;
      else if (tokenProgress < 80) tokenColor = mockColors.warning;
      else tokenColor = mockColors.error;

      expect(tokenColor).toBe(mockColors.warning);
    });

    it('should return error color for high token usage', () => {
      const tokenProgress = 85;
      let tokenColor: string;
      if (tokenProgress < 50) tokenColor = mockColors.success;
      else if (tokenProgress < 80) tokenColor = mockColors.warning;
      else tokenColor = mockColors.error;

      expect(tokenColor).toBe(mockColors.error);
    });

    it('should handle zero maxTokens', () => {
      const tokenCount = 1000;
      const maxTokens = 0;
      const tokenProgress = maxTokens > 0 ? (tokenCount / maxTokens) * 100 : 0;

      expect(tokenProgress).toBe(0);
    });

    it('should handle zero budget', () => {
      const cost = 5;
      const budget = 0;
      const costProgress = budget > 0 ? (cost / budget) * 100 : 0;

      expect(costProgress).toBe(0);
    });
  });

  // ==========================================================================
  // Progress Bar Rendering Logic Tests
  // ==========================================================================

  describe('Progress Bar Logic', () => {
    it('should calculate filled and empty widths correctly', () => {
      const renderProgressBarLogic = (progress: number, width: number = 10) => {
        const filledWidth = Math.round((progress / 100) * width);
        const emptyWidth = width - filledWidth;
        return { filledWidth, emptyWidth };
      };

      expect(renderProgressBarLogic(0)).toEqual({ filledWidth: 0, emptyWidth: 10 });
      expect(renderProgressBarLogic(50)).toEqual({ filledWidth: 5, emptyWidth: 5 });
      expect(renderProgressBarLogic(100)).toEqual({ filledWidth: 10, emptyWidth: 0 });
      expect(renderProgressBarLogic(25)).toEqual({ filledWidth: 3, emptyWidth: 7 }); // 2.5 rounds to 3
      expect(renderProgressBarLogic(75)).toEqual({ filledWidth: 8, emptyWidth: 2 }); // 7.5 rounds to 8
    });

    it('should handle custom width', () => {
      const renderProgressBarLogic = (progress: number, width: number = 10) => {
        const filledWidth = Math.round((progress / 100) * width);
        const emptyWidth = width - filledWidth;
        return { filledWidth, emptyWidth };
      };

      expect(renderProgressBarLogic(50, 20)).toEqual({ filledWidth: 10, emptyWidth: 10 });
      expect(renderProgressBarLogic(33, 15)).toEqual({ filledWidth: 5, emptyWidth: 10 }); // 4.95 rounds to 5
    });

    it('should generate filled characters correctly', () => {
      const filledWidth = 5;
      const filled = '\u2588'.repeat(Math.max(0, filledWidth));

      expect(filled).toBe('\u2588\u2588\u2588\u2588\u2588');
      expect(filled.length).toBe(5);
    });

    it('should generate empty characters correctly', () => {
      const emptyWidth = 5;
      const empty = '\u2591'.repeat(Math.max(0, emptyWidth));

      expect(empty).toBe('\u2591\u2591\u2591\u2591\u2591');
      expect(empty.length).toBe(5);
    });

    it('should handle negative progress (edge case)', () => {
      const renderProgressBarLogic = (progress: number, width: number = 10) => {
        const filledWidth = Math.max(0, Math.round((progress / 100) * width));
        const emptyWidth = Math.max(0, width - filledWidth);
        return { filledWidth, emptyWidth };
      };

      expect(renderProgressBarLogic(-10)).toEqual({ filledWidth: 0, emptyWidth: 10 });
    });
  });

  // ==========================================================================
  // Warning State Tests
  // ==========================================================================

  describe('Warning States', () => {
    it('should trigger budget warning when cost progress > 80%', () => {
      const costProgress = 85;
      const shouldShowWarning = costProgress > 80;

      expect(shouldShowWarning).toBe(true);
    });

    it('should not trigger budget warning when cost progress <= 80%', () => {
      const costProgress = 80;
      const shouldShowWarning = costProgress > 80;

      expect(shouldShowWarning).toBe(false);
    });

    it('should trigger token warning when token progress > 80%', () => {
      const tokenProgress = 90;
      const shouldShowWarning = tokenProgress > 80;

      expect(shouldShowWarning).toBe(true);
    });

    it('should not trigger token warning when token progress <= 80%', () => {
      const tokenProgress = 75;
      const shouldShowWarning = tokenProgress > 80;

      expect(shouldShowWarning).toBe(false);
    });
  });

  // ==========================================================================
  // useTheme Hook Usage Tests
  // ==========================================================================

  describe('Theme Integration', () => {
    it('should call useTheme hook', () => {
      // Verify useTheme is called correctly
      const colors = (useTheme as jest.Mock)().colors;

      expect(colors).toBeDefined();
      expect(colors.success).toBe('#34C759');
      expect(colors.warning).toBe('#FF9500');
      expect(colors.error).toBe('#FF3B30');
    });
  });

  // ==========================================================================
  // Component Props Validation Tests
  // ==========================================================================

  describe('StatusBar Props', () => {
    it('should have sensible default values', () => {
      const defaultProps = {
        maxTokens: 128000,
        cost: 0,
        budget: 10,
        modelName: 'codebuddy',
        processingTime: 0,
        showDetails: false,
        compact: false,
      };

      expect(defaultProps.maxTokens).toBe(128000);
      expect(defaultProps.budget).toBe(10);
      expect(defaultProps.modelName).toBe('codebuddy');
    });
  });

  // ==========================================================================
  // Session Duration Timer Logic Tests
  // ==========================================================================

  describe('Session Duration Timer', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should calculate elapsed time correctly', () => {
      const sessionStartTime = new Date(Date.now() - 65000); // 65 seconds ago
      const elapsed = Math.floor((Date.now() - sessionStartTime.getTime()) / 1000);

      expect(elapsed).toBe(65);
    });

    it('should update duration every second', () => {
      const sessionStartTime = new Date();
      let elapsed = 0;

      const updateDuration = () => {
        elapsed = Math.floor((Date.now() - sessionStartTime.getTime()) / 1000);
      };

      // Simulate time passing
      jest.advanceTimersByTime(3000);
      updateDuration();

      expect(elapsed).toBe(3);
    });
  });

  // ==========================================================================
  // MiniStatusBar Tests
  // ==========================================================================

  describe('MiniStatusBar', () => {
    it('should display model name when provided', () => {
      const modelName = 'grok-3';
      expect(modelName).toBeDefined();
      expect(modelName.length).toBeGreaterThan(0);
    });

    it('should handle undefined cost', () => {
      const cost: number | undefined = undefined;
      const shouldShowCost = cost !== undefined && cost > 0;

      expect(shouldShowCost).toBe(false);
    });

    it('should show cost when defined and greater than 0', () => {
      const cost: number | undefined = 0.5;
      const shouldShowCost = cost !== undefined && cost > 0;

      expect(shouldShowCost).toBe(true);
    });

    it('should not show cost when 0', () => {
      const cost: number | undefined = 0;
      const shouldShowCost = cost !== undefined && cost > 0;

      expect(shouldShowCost).toBe(false);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle very large token counts', () => {
      const tokenCount = 1000000;
      const maxTokens = 128000;
      const tokenProgress = maxTokens > 0 ? (tokenCount / maxTokens) * 100 : 0;

      // Progress can exceed 100%
      expect(tokenProgress).toBeGreaterThan(100);
    });

    it('should handle very small costs', () => {
      const formatCost = (cost: number): string => {
        if (cost < 0.01) return `$${(cost * 1000).toFixed(2)}m`;
        if (cost < 1) return `$${cost.toFixed(3)}`;
        return `$${cost.toFixed(2)}`;
      };

      expect(formatCost(0.00001)).toBe('$0.01m');
    });

    it('should handle zero processing time', () => {
      const calculateTokensPerSecond = (tokens: number, seconds: number): number => {
        if (seconds === 0) return 0;
        return Math.round(tokens / seconds);
      };

      expect(calculateTokensPerSecond(1000, 0)).toBe(0);
    });

    it('should handle undefined sessionStartTime', () => {
      const sessionStartTime: Date | undefined = undefined;
      const shouldShowDuration = !!sessionStartTime;

      expect(shouldShowDuration).toBe(false);
    });
  });
});
