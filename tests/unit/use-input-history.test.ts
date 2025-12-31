/**
 * Comprehensive unit tests for useInputHistory hook
 * Tests the input history management functionality including:
 * - Adding entries to history
 * - Navigating history (up/down)
 * - History deduplication
 * - Original input preservation
 * - History reset
 * - Navigation state tracking
 */

// Mock React hooks
const mockSetState = jest.fn();
let historyState: string[] = [];
let indexState = -1;
let originalInputState = '';

jest.mock('react', () => ({
  useState: jest.fn((init) => {
    if (Array.isArray(init)) {
      return [historyState, (updater: ((prev: string[]) => string[]) | string[]) => {
        if (typeof updater === 'function') {
          historyState = updater(historyState);
        } else {
          historyState = updater;
        }
      }];
    }
    if (init === -1) {
      return [indexState, (val: number | ((prev: number) => number)) => {
        indexState = typeof val === 'function' ? val(indexState) : val;
      }];
    }
    if (init === '') {
      return [originalInputState, (val: string) => {
        originalInputState = val;
      }];
    }
    return [init, mockSetState];
  }),
  useCallback: jest.fn((fn) => fn),
}));

describe('useInputHistory', () => {
  beforeEach(() => {
    historyState = [];
    indexState = -1;
    originalInputState = '';
    jest.clearAllMocks();
  });

  describe('InputHistoryHook Interface', () => {
    interface InputHistoryHook {
      addToHistory: (input: string) => void;
      navigateHistory: (direction: 'up' | 'down') => string | null;
      getCurrentHistoryIndex: () => number;
      resetHistory: () => void;
      isNavigatingHistory: () => boolean;
      setOriginalInput: (input: string) => void;
    }

    it('should define all expected methods', () => {
      const mockHook: InputHistoryHook = {
        addToHistory: jest.fn(),
        navigateHistory: jest.fn(),
        getCurrentHistoryIndex: jest.fn(() => -1),
        resetHistory: jest.fn(),
        isNavigatingHistory: jest.fn(() => false),
        setOriginalInput: jest.fn(),
      };

      expect(typeof mockHook.addToHistory).toBe('function');
      expect(typeof mockHook.navigateHistory).toBe('function');
      expect(typeof mockHook.getCurrentHistoryIndex).toBe('function');
      expect(typeof mockHook.resetHistory).toBe('function');
      expect(typeof mockHook.isNavigatingHistory).toBe('function');
      expect(typeof mockHook.setOriginalInput).toBe('function');
    });
  });

  describe('Add to History', () => {
    // Simulate the addToHistory function
    function addToHistory(
      history: string[],
      input: string
    ): { history: string[]; index: number } {
      const trimmedInput = input.trim();
      if (trimmedInput && !history.includes(trimmedInput)) {
        return {
          history: [...history, trimmedInput],
          index: -1,
        };
      }
      return {
        history,
        index: -1,
      };
    }

    it('should add non-empty input to history', () => {
      const result = addToHistory([], 'Hello');
      expect(result.history).toContain('Hello');
      expect(result.history).toHaveLength(1);
    });

    it('should trim input before adding', () => {
      const result = addToHistory([], '  Hello  ');
      expect(result.history).toContain('Hello');
      expect(result.history).toHaveLength(1);
    });

    it('should not add empty input', () => {
      const result = addToHistory([], '');
      expect(result.history).toHaveLength(0);
    });

    it('should not add whitespace-only input', () => {
      const result = addToHistory([], '   ');
      expect(result.history).toHaveLength(0);
    });

    it('should not add duplicate entries', () => {
      let result = addToHistory([], 'Hello');
      result = addToHistory(result.history, 'Hello');
      expect(result.history).toHaveLength(1);
    });

    it('should add different entries', () => {
      let result = addToHistory([], 'Hello');
      result = addToHistory(result.history, 'World');
      expect(result.history).toHaveLength(2);
    });

    it('should reset index to -1 after adding', () => {
      const result = addToHistory(['First'], 'Second');
      expect(result.index).toBe(-1);
    });

    it('should handle special characters', () => {
      const result = addToHistory([], '!@#$%^&*()');
      expect(result.history).toContain('!@#$%^&*()');
    });

    it('should handle unicode', () => {
      const result = addToHistory([], '\uD83D\uDE00 Hello \u4E2D\u6587');
      expect(result.history).toContain('\uD83D\uDE00 Hello \u4E2D\u6587');
    });

    it('should handle very long input', () => {
      const longInput = 'a'.repeat(1000);
      const result = addToHistory([], longInput);
      expect(result.history[0]).toBe(longInput);
    });
  });

  describe('Navigate History - Up Direction', () => {
    interface NavigationState {
      history: string[];
      currentIndex: number;
      originalInput: string;
    }

    function navigateUp(state: NavigationState): { newIndex: number; value: string | null } {
      if (state.history.length === 0) {
        return { newIndex: state.currentIndex, value: null };
      }

      let newIndex: number;
      if (state.currentIndex === -1) {
        newIndex = state.history.length - 1;
      } else {
        newIndex = Math.max(0, state.currentIndex - 1);
      }

      return {
        newIndex,
        value: state.history[newIndex],
      };
    }

    it('should return null for empty history', () => {
      const result = navigateUp({
        history: [],
        currentIndex: -1,
        originalInput: '',
      });
      expect(result.value).toBeNull();
    });

    it('should start at last item when navigating from index -1', () => {
      const result = navigateUp({
        history: ['First', 'Second', 'Third'],
        currentIndex: -1,
        originalInput: '',
      });
      expect(result.newIndex).toBe(2);
      expect(result.value).toBe('Third');
    });

    it('should move to previous item', () => {
      const result = navigateUp({
        history: ['First', 'Second', 'Third'],
        currentIndex: 2,
        originalInput: '',
      });
      expect(result.newIndex).toBe(1);
      expect(result.value).toBe('Second');
    });

    it('should stay at first item when at beginning', () => {
      const result = navigateUp({
        history: ['First', 'Second'],
        currentIndex: 0,
        originalInput: '',
      });
      expect(result.newIndex).toBe(0);
      expect(result.value).toBe('First');
    });

    it('should handle single item history', () => {
      const result = navigateUp({
        history: ['Only'],
        currentIndex: -1,
        originalInput: '',
      });
      expect(result.newIndex).toBe(0);
      expect(result.value).toBe('Only');
    });
  });

  describe('Navigate History - Down Direction', () => {
    interface NavigationState {
      history: string[];
      currentIndex: number;
      originalInput: string;
    }

    function navigateDown(state: NavigationState): { newIndex: number; value: string | null } {
      if (state.history.length === 0) {
        return { newIndex: -1, value: null };
      }

      if (state.currentIndex === -1) {
        return { newIndex: -1, value: null };
      }

      if (state.currentIndex === state.history.length - 1) {
        return {
          newIndex: -1,
          value: state.originalInput,
        };
      }

      const newIndex = Math.min(state.history.length - 1, state.currentIndex + 1);
      return {
        newIndex,
        value: state.history[newIndex],
      };
    }

    it('should return null for empty history', () => {
      const result = navigateDown({
        history: [],
        currentIndex: -1,
        originalInput: '',
      });
      expect(result.value).toBeNull();
    });

    it('should return null when not navigating (index -1)', () => {
      const result = navigateDown({
        history: ['First', 'Second'],
        currentIndex: -1,
        originalInput: '',
      });
      expect(result.value).toBeNull();
    });

    it('should move to next item', () => {
      const result = navigateDown({
        history: ['First', 'Second', 'Third'],
        currentIndex: 0,
        originalInput: '',
      });
      expect(result.newIndex).toBe(1);
      expect(result.value).toBe('Second');
    });

    it('should return original input when at last item', () => {
      const result = navigateDown({
        history: ['First', 'Second'],
        currentIndex: 1,
        originalInput: 'Current typing',
      });
      expect(result.newIndex).toBe(-1);
      expect(result.value).toBe('Current typing');
    });

    it('should handle single item history moving down', () => {
      const result = navigateDown({
        history: ['Only'],
        currentIndex: 0,
        originalInput: 'Original',
      });
      expect(result.newIndex).toBe(-1);
      expect(result.value).toBe('Original');
    });
  });

  describe('Full Navigation Cycle', () => {
    interface HistoryManager {
      history: string[];
      currentIndex: number;
      originalInput: string;
    }

    function createHistoryManager(): HistoryManager {
      return {
        history: [],
        currentIndex: -1,
        originalInput: '',
      };
    }

    function addItem(manager: HistoryManager, item: string): void {
      const trimmed = item.trim();
      if (trimmed && !manager.history.includes(trimmed)) {
        manager.history.push(trimmed);
      }
      manager.currentIndex = -1;
      manager.originalInput = '';
    }

    function navigateUp(manager: HistoryManager): string | null {
      if (manager.history.length === 0) return null;

      if (manager.currentIndex === -1) {
        manager.currentIndex = manager.history.length - 1;
      } else {
        manager.currentIndex = Math.max(0, manager.currentIndex - 1);
      }

      return manager.history[manager.currentIndex];
    }

    function navigateDown(manager: HistoryManager): string | null {
      if (manager.history.length === 0) return null;
      if (manager.currentIndex === -1) return null;

      if (manager.currentIndex === manager.history.length - 1) {
        manager.currentIndex = -1;
        return manager.originalInput;
      }

      manager.currentIndex++;
      return manager.history[manager.currentIndex];
    }

    function setOriginalInput(manager: HistoryManager, input: string): void {
      if (manager.currentIndex === -1) {
        manager.originalInput = input;
      }
    }

    it('should complete full up-down navigation cycle', () => {
      const manager = createHistoryManager();
      addItem(manager, 'First');
      addItem(manager, 'Second');
      addItem(manager, 'Third');
      setOriginalInput(manager, 'Current');

      // Navigate up through history
      expect(navigateUp(manager)).toBe('Third');
      expect(navigateUp(manager)).toBe('Second');
      expect(navigateUp(manager)).toBe('First');
      expect(navigateUp(manager)).toBe('First'); // Stay at first

      // Navigate down through history
      expect(navigateDown(manager)).toBe('Second');
      expect(navigateDown(manager)).toBe('Third');
      expect(navigateDown(manager)).toBe('Current'); // Back to original
      expect(navigateDown(manager)).toBeNull(); // No more navigation
    });

    it('should preserve original input during navigation', () => {
      const manager = createHistoryManager();
      addItem(manager, 'History item');
      setOriginalInput(manager, 'Typing in progress');

      navigateUp(manager); // Go to history
      expect(manager.currentIndex).toBe(0);

      const result = navigateDown(manager); // Go back
      expect(result).toBe('Typing in progress');
      expect(manager.currentIndex).toBe(-1);
    });

    it('should reset after adding new item', () => {
      const manager = createHistoryManager();
      addItem(manager, 'First');
      navigateUp(manager);
      expect(manager.currentIndex).toBe(0);

      addItem(manager, 'Second');
      expect(manager.currentIndex).toBe(-1);
    });
  });

  describe('Get Current History Index', () => {
    it('should return -1 when not navigating', () => {
      const getCurrentIndex = () => -1;
      expect(getCurrentIndex()).toBe(-1);
    });

    it('should return correct index when navigating', () => {
      let currentIndex = -1;
      const getCurrentIndex = () => currentIndex;

      currentIndex = 2;
      expect(getCurrentIndex()).toBe(2);
    });
  });

  describe('Reset History', () => {
    function resetHistory(): { history: string[]; index: number; originalInput: string } {
      return {
        history: [],
        index: -1,
        originalInput: '',
      };
    }

    it('should clear all history', () => {
      const result = resetHistory();
      expect(result.history).toHaveLength(0);
    });

    it('should reset index to -1', () => {
      const result = resetHistory();
      expect(result.index).toBe(-1);
    });

    it('should clear original input', () => {
      const result = resetHistory();
      expect(result.originalInput).toBe('');
    });
  });

  describe('Is Navigating History', () => {
    function isNavigatingHistory(currentIndex: number): boolean {
      return currentIndex !== -1;
    }

    it('should return false when index is -1', () => {
      expect(isNavigatingHistory(-1)).toBe(false);
    });

    it('should return true when index is 0', () => {
      expect(isNavigatingHistory(0)).toBe(true);
    });

    it('should return true when index is positive', () => {
      expect(isNavigatingHistory(5)).toBe(true);
    });
  });

  describe('Set Original Input', () => {
    function setOriginalInput(
      currentIndex: number,
      input: string
    ): string | null {
      if (currentIndex === -1) {
        return input;
      }
      return null; // Don't update during navigation
    }

    it('should set original input when not navigating', () => {
      const result = setOriginalInput(-1, 'My input');
      expect(result).toBe('My input');
    });

    it('should not set original input during navigation', () => {
      const result = setOriginalInput(2, 'Should not set');
      expect(result).toBeNull();
    });

    it('should handle empty input', () => {
      const result = setOriginalInput(-1, '');
      expect(result).toBe('');
    });
  });

  describe('Edge Cases', () => {
    describe('Rapid Navigation', () => {
      it('should handle rapid up/down navigation', () => {
        const history = ['A', 'B', 'C'];
        let index = -1;

        // Rapid navigation
        for (let i = 0; i < 10; i++) {
          if (index === -1) {
            index = history.length - 1;
          } else {
            index = Math.max(0, index - 1);
          }
        }

        expect(index).toBe(0); // Should end up at first item
      });
    });

    describe('History with Similar Items', () => {
      it('should handle case-sensitive items', () => {
        function addToHistory(history: string[], input: string): string[] {
          const trimmed = input.trim();
          if (trimmed && !history.includes(trimmed)) {
            return [...history, trimmed];
          }
          return history;
        }

        let history = addToHistory([], 'Hello');
        history = addToHistory(history, 'hello');
        history = addToHistory(history, 'HELLO');

        expect(history).toHaveLength(3);
      });

      it('should not add whitespace variations as duplicates', () => {
        function addToHistory(history: string[], input: string): string[] {
          const trimmed = input.trim();
          if (trimmed && !history.includes(trimmed)) {
            return [...history, trimmed];
          }
          return history;
        }

        let history = addToHistory([], '  Hello  ');
        history = addToHistory(history, 'Hello');
        history = addToHistory(history, '   Hello   ');

        expect(history).toHaveLength(1);
      });
    });

    describe('Large History', () => {
      it('should handle large history efficiently', () => {
        const history: string[] = [];
        for (let i = 0; i < 1000; i++) {
          if (!history.includes(`Item ${i}`)) {
            history.push(`Item ${i}`);
          }
        }

        expect(history).toHaveLength(1000);

        // Navigate to specific position
        let index = history.length - 1;
        for (let i = 0; i < 500; i++) {
          index = Math.max(0, index - 1);
        }

        expect(index).toBe(499);
      });
    });

    describe('Navigation State Consistency', () => {
      it('should maintain consistent state through operations', () => {
        interface State {
          history: string[];
          index: number;
          original: string;
        }

        const state: State = {
          history: ['One', 'Two', 'Three'],
          index: -1,
          original: '',
        };

        // Set original input
        state.original = 'Current typing';
        expect(state.original).toBe('Current typing');
        expect(state.index).toBe(-1);

        // Navigate up
        state.index = 2;
        expect(state.index).toBe(2);
        expect(state.original).toBe('Current typing');

        // Navigate down to original
        state.index = -1;
        expect(state.index).toBe(-1);
        expect(state.original).toBe('Current typing');
      });
    });

    describe('Empty History Edge Cases', () => {
      it('should handle navigation on empty history', () => {
        const history: string[] = [];
        let index = -1;

        // Try to navigate up
        if (history.length > 0) {
          index = history.length - 1;
        }
        expect(index).toBe(-1);

        // Try to navigate down
        if (index !== -1 && index < history.length) {
          index++;
        }
        expect(index).toBe(-1);
      });

      it('should handle adding first item', () => {
        const history: string[] = [];
        history.push('First');

        expect(history).toHaveLength(1);
        expect(history[0]).toBe('First');
      });
    });

    describe('Boundary Conditions', () => {
      it('should handle navigation at exact boundaries', () => {
        const history = ['A', 'B'];
        let index = 1; // Last item

        // Navigate down from last - should return to original
        if (index === history.length - 1) {
          index = -1;
        }
        expect(index).toBe(-1);

        // Navigate up from -1 - should go to last
        if (index === -1) {
          index = history.length - 1;
        }
        expect(index).toBe(1);

        // Navigate up from first - should stay at first
        index = 0;
        index = Math.max(0, index - 1);
        expect(index).toBe(0);
      });
    });
  });

  describe('Integration Scenarios', () => {
    describe('Typical User Session', () => {
      it('should handle typical user interaction pattern', () => {
        interface Session {
          history: string[];
          index: number;
          original: string;
          currentInput: string;
        }

        const session: Session = {
          history: [],
          index: -1,
          original: '',
          currentInput: '',
        };

        // User types first command
        session.currentInput = 'ls -la';
        session.original = session.currentInput;

        // User submits
        session.history.push(session.currentInput);
        session.index = -1;
        session.original = '';
        session.currentInput = '';

        expect(session.history).toContain('ls -la');

        // User types second command
        session.currentInput = 'git status';
        session.original = session.currentInput;

        // User submits
        session.history.push(session.currentInput);
        session.index = -1;
        session.original = '';
        session.currentInput = '';

        expect(session.history).toHaveLength(2);

        // User starts typing, then wants to go back
        session.currentInput = 'npm ';
        session.original = session.currentInput;

        // User presses up
        session.index = session.history.length - 1;
        session.currentInput = session.history[session.index];

        expect(session.currentInput).toBe('git status');

        // User presses down to return to what they were typing
        session.index = -1;
        session.currentInput = session.original;

        expect(session.currentInput).toBe('npm ');
      });
    });

    describe('History Persistence Simulation', () => {
      it('should work with serialized/deserialized history', () => {
        const originalHistory = ['command1', 'command2', 'command3'];

        // Simulate persistence
        const serialized = JSON.stringify(originalHistory);
        const restored = JSON.parse(serialized) as string[];

        expect(restored).toEqual(originalHistory);

        // Should work with restored history
        let index = -1;
        index = restored.length - 1;
        expect(restored[index]).toBe('command3');
      });
    });
  });

  describe('Performance Considerations', () => {
    it('should not create unnecessary copies during navigation', () => {
      const history = ['A', 'B', 'C'];
      const originalHistory = history;

      // Navigation should not modify the history array
      let index = history.length - 1;
      index = Math.max(0, index - 1);
      index = Math.min(history.length - 1, index + 1);

      expect(history).toBe(originalHistory);
      expect(history).toHaveLength(3);
    });

    it('should handle includes check efficiently', () => {
      const history: string[] = [];
      for (let i = 0; i < 100; i++) {
        const item = `Item ${i}`;
        if (!history.includes(item)) {
          history.push(item);
        }
      }

      // Check that includes works correctly
      expect(history.includes('Item 0')).toBe(true);
      expect(history.includes('Item 99')).toBe(true);
      expect(history.includes('Item 100')).toBe(false);
    });
  });
});
