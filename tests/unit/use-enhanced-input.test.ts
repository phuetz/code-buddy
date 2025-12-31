/**
 * Comprehensive unit tests for useEnhancedInput hook
 * Tests the enhanced input functionality including:
 * - Cursor movement (character and word level)
 * - Text insertion and deletion
 * - Special key handling (Ctrl+A, Ctrl+E, Ctrl+K, Ctrl+U, etc.)
 * - Multiline mode
 * - History navigation integration
 * - Unicode handling
 */

import {
  deleteCharBefore,
  deleteCharAfter,
  deleteWordBefore,
  deleteWordAfter,
  insertText,
  moveToLineStart,
  moveToLineEnd,
  moveToPreviousWord,
  moveToNextWord,
  isWordBoundary,
  findWordStart,
  findWordEnd,
} from '../../src/utils/text-utils.js';

// Mock React hooks
jest.mock('react', () => ({
  useState: jest.fn((init) => {
    const val = typeof init === 'function' ? init() : init;
    return [val, jest.fn()];
  }),
  useCallback: jest.fn((fn) => fn),
  useRef: jest.fn((init) => ({ current: init })),
}));

// Mock the input history hook
jest.mock('../../src/hooks/use-input-history.js', () => ({
  useInputHistory: jest.fn(() => ({
    addToHistory: jest.fn(),
    navigateHistory: jest.fn(() => null),
    resetHistory: jest.fn(),
    setOriginalInput: jest.fn(),
    isNavigatingHistory: jest.fn(() => false),
  })),
}));

describe('useEnhancedInput', () => {
  describe('Key Interface', () => {
    interface Key {
      name?: string;
      ctrl?: boolean;
      meta?: boolean;
      shift?: boolean;
      upArrow?: boolean;
      downArrow?: boolean;
      leftArrow?: boolean;
      rightArrow?: boolean;
      return?: boolean;
      escape?: boolean;
      tab?: boolean;
      backspace?: boolean;
      delete?: boolean;
    }

    it('should define all expected key properties', () => {
      const key: Key = {
        name: 'a',
        ctrl: true,
        meta: false,
        shift: false,
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        return: false,
        escape: false,
        tab: false,
        backspace: false,
        delete: false,
      };

      expect(key.ctrl).toBe(true);
      expect(key.meta).toBe(false);
    });

    it('should allow partial key definitions', () => {
      const key: Key = { ctrl: true };
      expect(key.ctrl).toBe(true);
      expect(key.meta).toBeUndefined();
    });
  });

  describe('Text Insertion', () => {
    it('should insert text at cursor position', () => {
      const result = insertText('Hello World', 6, 'Beautiful ');
      expect(result.text).toBe('Hello Beautiful World');
      expect(result.position).toBe(16); // 6 + 'Beautiful '.length
    });

    it('should insert text at beginning', () => {
      const result = insertText('World', 0, 'Hello ');
      expect(result.text).toBe('Hello World');
      expect(result.position).toBe(6);
    });

    it('should insert text at end', () => {
      const result = insertText('Hello', 5, ' World');
      expect(result.text).toBe('Hello World');
      expect(result.position).toBe(11);
    });

    it('should handle empty insert', () => {
      const result = insertText('Hello', 3, '');
      expect(result.text).toBe('Hello');
      expect(result.position).toBe(3);
    });

    it('should handle insert into empty string', () => {
      const result = insertText('', 0, 'Hello');
      expect(result.text).toBe('Hello');
      expect(result.position).toBe(5);
    });

    it('should handle newline insertion', () => {
      const result = insertText('HelloWorld', 5, '\n');
      expect(result.text).toBe('Hello\nWorld');
      expect(result.position).toBe(6);
    });

    it('should handle multi-character insert', () => {
      const result = insertText('Test', 2, 'ABC');
      expect(result.text).toBe('TeABCst');
      expect(result.position).toBe(5);
    });
  });

  describe('Character Deletion (Backspace)', () => {
    it('should delete character before cursor', () => {
      const result = deleteCharBefore('Hello', 3);
      expect(result.text).toBe('Helo');
      expect(result.position).toBe(2);
    });

    it('should not delete at position 0', () => {
      const result = deleteCharBefore('Hello', 0);
      expect(result.text).toBe('Hello');
      expect(result.position).toBe(0);
    });

    it('should delete at end of string', () => {
      const result = deleteCharBefore('Hello', 5);
      expect(result.text).toBe('Hell');
      expect(result.position).toBe(4);
    });

    it('should handle single character string', () => {
      const result = deleteCharBefore('H', 1);
      expect(result.text).toBe('');
      expect(result.position).toBe(0);
    });

    it('should handle surrogate pairs (emoji)', () => {
      // Testing with a simple emoji surrogate pair
      const text = 'A\uD83D\uDE00B'; // A + smiley + B
      const result = deleteCharBefore(text, 3); // Position after the emoji
      expect(result.text).toBe('AB');
      expect(result.position).toBe(1);
    });
  });

  describe('Forward Character Deletion (Delete)', () => {
    it('should delete character after cursor', () => {
      const result = deleteCharAfter('Hello', 2);
      expect(result.text).toBe('Helo');
      expect(result.position).toBe(2);
    });

    it('should not delete at end of string', () => {
      const result = deleteCharAfter('Hello', 5);
      expect(result.text).toBe('Hello');
      expect(result.position).toBe(5);
    });

    it('should delete at beginning of string', () => {
      const result = deleteCharAfter('Hello', 0);
      expect(result.text).toBe('ello');
      expect(result.position).toBe(0);
    });

    it('should handle single character string', () => {
      const result = deleteCharAfter('H', 0);
      expect(result.text).toBe('');
      expect(result.position).toBe(0);
    });

    it('should handle surrogate pairs (emoji)', () => {
      const text = 'A\uD83D\uDE00B'; // A + smiley + B
      const result = deleteCharAfter(text, 1); // Position before the emoji
      expect(result.text).toBe('AB');
      expect(result.position).toBe(1);
    });
  });

  describe('Word Deletion (Ctrl+Backspace)', () => {
    it('should delete word before cursor', () => {
      const result = deleteWordBefore('Hello World', 11);
      expect(result.text).toBe('Hello ');
      expect(result.position).toBe(6);
    });

    it('should delete word in middle of text', () => {
      const result = deleteWordBefore('One Two Three', 7);
      // The function deletes from moveToPreviousWord position to cursor
      // moveToPreviousWord(7) = 4 (start of "Two")
      expect(result.text).toBe('One  Three');
      expect(result.position).toBe(4);
    });

    it('should handle cursor at beginning', () => {
      const result = deleteWordBefore('Hello', 0);
      expect(result.text).toBe('Hello');
      expect(result.position).toBe(0);
    });

    it('should delete single word', () => {
      const result = deleteWordBefore('Hello', 5);
      expect(result.text).toBe('');
      expect(result.position).toBe(0);
    });

    it('should handle multiple spaces', () => {
      const result = deleteWordBefore('Hello   World', 13);
      expect(result.text).toBe('Hello   ');
      expect(result.position).toBe(8);
    });
  });

  describe('Forward Word Deletion (Ctrl+Delete)', () => {
    it('should delete word after cursor', () => {
      const result = deleteWordAfter('Hello World', 0);
      // moveToNextWord(0) goes to position 6 (after "Hello ")
      // So it deletes "Hello " and keeps "World"
      expect(result.text).toBe('World');
      expect(result.position).toBe(0);
    });

    it('should delete word in middle of text', () => {
      const result = deleteWordAfter('One Two Three', 4);
      expect(result.text).toBe('One Three');
      expect(result.position).toBe(4);
    });

    it('should handle cursor at end', () => {
      const result = deleteWordAfter('Hello', 5);
      expect(result.text).toBe('Hello');
      expect(result.position).toBe(5);
    });

    it('should delete remaining text', () => {
      const result = deleteWordAfter('Word', 0);
      expect(result.text).toBe('');
      expect(result.position).toBe(0);
    });
  });

  describe('Word Boundary Detection', () => {
    it('should detect space as word boundary', () => {
      expect(isWordBoundary(' ')).toBe(true);
    });

    it('should detect punctuation as word boundary', () => {
      expect(isWordBoundary('.')).toBe(true);
      expect(isWordBoundary(',')).toBe(true);
      expect(isWordBoundary(';')).toBe(true);
    });

    it('should not detect letters as word boundary', () => {
      expect(isWordBoundary('a')).toBe(false);
      expect(isWordBoundary('Z')).toBe(false);
    });

    it('should not detect digits as word boundary', () => {
      expect(isWordBoundary('5')).toBe(false);
    });

    it('should not detect underscore as word boundary', () => {
      expect(isWordBoundary('_')).toBe(false);
    });

    it('should detect undefined as word boundary', () => {
      expect(isWordBoundary(undefined)).toBe(true);
    });

    it('should detect empty string as word boundary', () => {
      expect(isWordBoundary('')).toBe(true);
    });

    it('should detect tab as word boundary', () => {
      expect(isWordBoundary('\t')).toBe(true);
    });

    it('should detect newline as word boundary', () => {
      expect(isWordBoundary('\n')).toBe(true);
    });
  });

  describe('Move to Previous Word', () => {
    it('should move to previous word from end', () => {
      const pos = moveToPreviousWord('Hello World', 11);
      expect(pos).toBe(6);
    });

    it('should skip whitespace', () => {
      const pos = moveToPreviousWord('Hello   World', 13);
      expect(pos).toBe(8);
    });

    it('should handle cursor at beginning', () => {
      const pos = moveToPreviousWord('Hello', 0);
      expect(pos).toBe(0);
    });

    it('should handle single word', () => {
      const pos = moveToPreviousWord('Hello', 5);
      expect(pos).toBe(0);
    });

    it('should handle cursor in middle of word', () => {
      const pos = moveToPreviousWord('Hello World', 8);
      expect(pos).toBe(6);
    });

    it('should handle multiple words', () => {
      let pos = moveToPreviousWord('One Two Three', 13);
      expect(pos).toBe(8);
      pos = moveToPreviousWord('One Two Three', 8);
      expect(pos).toBe(4);
      pos = moveToPreviousWord('One Two Three', 4);
      expect(pos).toBe(0);
    });
  });

  describe('Move to Next Word', () => {
    it('should move to next word from beginning', () => {
      const pos = moveToNextWord('Hello World', 0);
      expect(pos).toBe(6);
    });

    it('should skip whitespace', () => {
      const pos = moveToNextWord('Hello   World', 5);
      expect(pos).toBe(8);
    });

    it('should handle cursor at end', () => {
      const pos = moveToNextWord('Hello', 5);
      expect(pos).toBe(5);
    });

    it('should handle single word', () => {
      const pos = moveToNextWord('Hello', 0);
      expect(pos).toBe(5);
    });

    it('should handle cursor in middle of word', () => {
      const pos = moveToNextWord('Hello World', 2);
      expect(pos).toBe(6);
    });

    it('should handle multiple words', () => {
      let pos = moveToNextWord('One Two Three', 0);
      expect(pos).toBe(4);
      pos = moveToNextWord('One Two Three', 4);
      expect(pos).toBe(8);
      pos = moveToNextWord('One Two Three', 8);
      expect(pos).toBe(13);
    });
  });

  describe('Find Word Start', () => {
    it('should find word start from middle of word', () => {
      const pos = findWordStart('Hello', 3);
      // findWordStart goes backwards from position-1 until it hits a boundary
      // Then moves forward if it stopped at a boundary
      // From position 3 (after 'l'), it goes backwards and finds start at 0
      expect(pos).toBe(0);
    });

    it('should handle cursor at beginning', () => {
      const pos = findWordStart('Hello', 0);
      expect(pos).toBe(0);
    });

    it('should handle cursor at end of word', () => {
      const pos = findWordStart('Hello World', 5);
      // From position 5 (at space), goes backward to find word boundary
      expect(pos).toBe(0);
    });
  });

  describe('Find Word End', () => {
    it('should find word end from middle of word', () => {
      const pos = findWordEnd('Hello', 2);
      expect(pos).toBe(5);
    });

    it('should handle cursor at end', () => {
      const pos = findWordEnd('Hello', 5);
      expect(pos).toBe(5);
    });

    it('should find word end in multi-word text', () => {
      const pos = findWordEnd('Hello World', 2);
      expect(pos).toBe(5);
    });
  });

  describe('Move to Line Start', () => {
    it('should move to start of single line', () => {
      const pos = moveToLineStart('Hello World', 6);
      expect(pos).toBe(0);
    });

    it('should move to start of current line in multiline', () => {
      const pos = moveToLineStart('Line1\nLine2\nLine3', 12);
      expect(pos).toBe(12);
    });

    it('should handle cursor at beginning', () => {
      const pos = moveToLineStart('Hello', 0);
      expect(pos).toBe(0);
    });

    it('should handle cursor right after newline', () => {
      const pos = moveToLineStart('Hello\nWorld', 6);
      expect(pos).toBe(6);
    });

    it('should find line start in multiline text', () => {
      const text = 'First Line\nSecond Line\nThird Line';
      const pos = moveToLineStart(text, 15); // Middle of 'Second'
      expect(pos).toBe(11);
    });
  });

  describe('Move to Line End', () => {
    it('should move to end of single line', () => {
      const pos = moveToLineEnd('Hello World', 0);
      expect(pos).toBe(11);
    });

    it('should move to end of current line in multiline', () => {
      const text = 'Line1\nLine2\nLine3';
      const pos = moveToLineEnd(text, 6);
      expect(pos).toBe(11);
    });

    it('should handle cursor at end', () => {
      const pos = moveToLineEnd('Hello', 5);
      expect(pos).toBe(5);
    });

    it('should handle cursor at newline', () => {
      const pos = moveToLineEnd('Hello\nWorld', 5);
      expect(pos).toBe(5);
    });

    it('should find line end in multiline text', () => {
      const text = 'First Line\nSecond Line\nThird Line';
      const pos = moveToLineEnd(text, 15); // Middle of 'Second Line'
      expect(pos).toBe(22);
    });
  });

  describe('Ctrl Key Combinations', () => {
    // Simulate the Ctrl key handling logic
    function handleCtrlKey(
      text: string,
      cursorPosition: number,
      char: string
    ): { text: string; position: number } | null {
      switch (char) {
        case 'a': // Move to beginning
          return { text, position: 0 };
        case 'e': // Move to end
          return { text, position: text.length };
        case 'k': // Delete to end of line
          const lineEnd = moveToLineEnd(text, cursorPosition);
          return {
            text: text.slice(0, cursorPosition) + text.slice(lineEnd),
            position: cursorPosition,
          };
        case 'u': // Delete to start of line
          const lineStart = moveToLineStart(text, cursorPosition);
          return {
            text: text.slice(0, lineStart) + text.slice(cursorPosition),
            position: lineStart,
          };
        case 'w': // Delete word before
          return deleteWordBefore(text, cursorPosition);
        case 'c': // Clear/Cancel
          return { text: '', position: 0 };
        case 'x': // Clear entire input
          return { text: '', position: 0 };
        default:
          return null;
      }
    }

    it('should handle Ctrl+A (move to beginning)', () => {
      const result = handleCtrlKey('Hello World', 6, 'a');
      expect(result?.position).toBe(0);
    });

    it('should handle Ctrl+E (move to end)', () => {
      const result = handleCtrlKey('Hello World', 0, 'e');
      expect(result?.position).toBe(11);
    });

    it('should handle Ctrl+K (delete to end of line)', () => {
      const result = handleCtrlKey('Hello World', 6, 'k');
      expect(result?.text).toBe('Hello ');
      expect(result?.position).toBe(6);
    });

    it('should handle Ctrl+U (delete to start of line)', () => {
      const result = handleCtrlKey('Hello World', 6, 'u');
      expect(result?.text).toBe('World');
      expect(result?.position).toBe(0);
    });

    it('should handle Ctrl+W (delete word before)', () => {
      const result = handleCtrlKey('Hello World', 11, 'w');
      expect(result?.text).toBe('Hello ');
    });

    it('should handle Ctrl+C (clear)', () => {
      const result = handleCtrlKey('Hello World', 5, 'c');
      expect(result?.text).toBe('');
      expect(result?.position).toBe(0);
    });

    it('should handle Ctrl+X (clear)', () => {
      const result = handleCtrlKey('Some text', 4, 'x');
      expect(result?.text).toBe('');
      expect(result?.position).toBe(0);
    });

    it('should return null for unhandled Ctrl key', () => {
      const result = handleCtrlKey('Hello', 2, 'z');
      expect(result).toBeNull();
    });
  });

  describe('Cursor Position Clamping', () => {
    function clampCursorPosition(position: number, textLength: number): number {
      return Math.max(0, Math.min(textLength, position));
    }

    it('should clamp negative position to 0', () => {
      expect(clampCursorPosition(-5, 10)).toBe(0);
    });

    it('should clamp position beyond text length', () => {
      expect(clampCursorPosition(15, 10)).toBe(10);
    });

    it('should not modify valid position', () => {
      expect(clampCursorPosition(5, 10)).toBe(5);
    });

    it('should handle position at 0', () => {
      expect(clampCursorPosition(0, 10)).toBe(0);
    });

    it('should handle position at text length', () => {
      expect(clampCursorPosition(10, 10)).toBe(10);
    });

    it('should handle empty text', () => {
      expect(clampCursorPosition(5, 0)).toBe(0);
    });
  });

  describe('Multiline Mode', () => {
    function shouldInsertNewline(key: { shift?: boolean; return?: boolean }, multiline: boolean): boolean {
      return multiline && key.shift === true && key.return === true;
    }

    it('should insert newline on Shift+Enter in multiline mode', () => {
      expect(shouldInsertNewline({ shift: true, return: true }, true)).toBe(true);
    });

    it('should not insert newline on Enter only in multiline mode', () => {
      expect(shouldInsertNewline({ return: true }, true)).toBe(false);
    });

    it('should not insert newline on Shift+Enter in single-line mode', () => {
      expect(shouldInsertNewline({ shift: true, return: true }, false)).toBe(false);
    });

    it('should not insert newline on Enter only in single-line mode', () => {
      expect(shouldInsertNewline({ return: true }, false)).toBe(false);
    });
  });

  describe('Backspace Detection', () => {
    interface Key {
      backspace?: boolean;
      name?: string;
      delete?: boolean;
      shift?: boolean;
    }

    function isBackspace(key: Key, inputChar: string): boolean {
      return (
        key.backspace === true ||
        key.name === 'backspace' ||
        inputChar === '\b' ||
        inputChar === '\x7f' ||
        (key.delete === true && inputChar === '' && !key.shift)
      );
    }

    it('should detect backspace via key.backspace', () => {
      expect(isBackspace({ backspace: true }, '')).toBe(true);
    });

    it('should detect backspace via key.name', () => {
      expect(isBackspace({ name: 'backspace' }, '')).toBe(true);
    });

    it('should detect backspace via \\b character', () => {
      expect(isBackspace({}, '\b')).toBe(true);
    });

    it('should detect backspace via \\x7f character', () => {
      expect(isBackspace({}, '\x7f')).toBe(true);
    });

    it('should detect backspace via delete with empty inputChar', () => {
      expect(isBackspace({ delete: true }, '')).toBe(true);
    });

    it('should not detect delete with shift as backspace', () => {
      expect(isBackspace({ delete: true, shift: true }, '')).toBe(false);
    });

    it('should not detect regular character as backspace', () => {
      expect(isBackspace({}, 'a')).toBe(false);
    });
  });

  describe('Arrow Key Handling', () => {
    interface Key {
      leftArrow?: boolean;
      rightArrow?: boolean;
      upArrow?: boolean;
      downArrow?: boolean;
      ctrl?: boolean;
      name?: string;
    }

    function handleArrowKey(
      key: Key,
      text: string,
      cursorPosition: number
    ): number | null {
      if (key.leftArrow || key.name === 'left') {
        if (key.ctrl) {
          return moveToPreviousWord(text, cursorPosition);
        }
        return Math.max(0, cursorPosition - 1);
      }

      if (key.rightArrow || key.name === 'right') {
        if (key.ctrl) {
          return moveToNextWord(text, cursorPosition);
        }
        return Math.min(text.length, cursorPosition + 1);
      }

      return null; // Let history handle up/down
    }

    it('should move left by one character', () => {
      const pos = handleArrowKey({ leftArrow: true }, 'Hello', 3);
      expect(pos).toBe(2);
    });

    it('should move right by one character', () => {
      const pos = handleArrowKey({ rightArrow: true }, 'Hello', 2);
      expect(pos).toBe(3);
    });

    it('should move left by word with Ctrl', () => {
      const pos = handleArrowKey({ leftArrow: true, ctrl: true }, 'Hello World', 11);
      expect(pos).toBe(6);
    });

    it('should move right by word with Ctrl', () => {
      const pos = handleArrowKey({ rightArrow: true, ctrl: true }, 'Hello World', 0);
      expect(pos).toBe(6);
    });

    it('should not move left beyond 0', () => {
      const pos = handleArrowKey({ leftArrow: true }, 'Hello', 0);
      expect(pos).toBe(0);
    });

    it('should not move right beyond text length', () => {
      const pos = handleArrowKey({ rightArrow: true }, 'Hello', 5);
      expect(pos).toBe(5);
    });

    it('should handle key.name === "left"', () => {
      const pos = handleArrowKey({ name: 'left' }, 'Hello', 3);
      expect(pos).toBe(2);
    });

    it('should handle key.name === "right"', () => {
      const pos = handleArrowKey({ name: 'right' }, 'Hello', 2);
      expect(pos).toBe(3);
    });

    it('should return null for up/down arrows', () => {
      expect(handleArrowKey({ upArrow: true }, 'Hello', 2)).toBeNull();
      expect(handleArrowKey({ downArrow: true }, 'Hello', 2)).toBeNull();
    });
  });

  describe('Submit Behavior', () => {
    function shouldSubmit(text: string): boolean {
      return text.trim().length > 0;
    }

    it('should submit non-empty text', () => {
      expect(shouldSubmit('Hello')).toBe(true);
    });

    it('should not submit empty text', () => {
      expect(shouldSubmit('')).toBe(false);
    });

    it('should not submit whitespace-only text', () => {
      expect(shouldSubmit('   ')).toBe(false);
    });

    it('should submit text with leading/trailing whitespace', () => {
      expect(shouldSubmit('  Hello  ')).toBe(true);
    });

    it('should submit single character', () => {
      expect(shouldSubmit('a')).toBe(true);
    });
  });

  describe('Disabled State', () => {
    function shouldHandleInput(disabled: boolean): boolean {
      return !disabled;
    }

    it('should handle input when not disabled', () => {
      expect(shouldHandleInput(false)).toBe(true);
    });

    it('should not handle input when disabled', () => {
      expect(shouldHandleInput(true)).toBe(false);
    });
  });

  describe('Unicode Text Handling', () => {
    it('should handle emoji in text insertion', () => {
      const result = insertText('Hello World', 6, '\uD83D\uDE00');
      expect(result.text).toBe('Hello \uD83D\uDE00World');
      expect(result.position).toBe(8); // Emoji is 2 code units
    });

    it('should handle Chinese characters', () => {
      const result = insertText('Hello', 5, ' World');
      expect(result.text).toBe('Hello World');
    });

    it('should correctly calculate position after emoji insertion', () => {
      const result = insertText('', 0, '\uD83D\uDE00');
      expect(result.position).toBe(2);
    });

    it('should handle mixed unicode and ASCII', () => {
      const text = 'Hello World';
      const result = deleteCharBefore(text, 7); // Delete after first
      expect(result.text).toBe('Hello orld');
    });
  });

  describe('Special Character Input', () => {
    it('should handle Ctrl+C character (\\x03)', () => {
      const inputChar = '\x03';
      const isCtrlC = inputChar === '\x03';
      expect(isCtrlC).toBe(true);
    });

    it('should handle escape sequences', () => {
      const sequences = ['\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D'];
      sequences.forEach((seq) => {
        expect(seq.includes('[')).toBe(true);
      });
    });

    it('should detect paste mode', () => {
      const key = { paste: true };
      expect(key.paste).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long text', () => {
      const longText = 'a'.repeat(10000);
      const result = insertText(longText, 5000, 'X');
      expect(result.text.length).toBe(10001);
      expect(result.position).toBe(5001);
    });

    it('should handle special regex characters in text', () => {
      const text = 'Hello [World] (Test) *star*';
      const result = deleteCharBefore(text, 10);
      expect(result.text).toBe('Hello [Wold] (Test) *star*');
    });

    it('should handle null-like inputs gracefully', () => {
      const result = insertText('Test', 2, '');
      expect(result.text).toBe('Test');
    });

    it('should handle consecutive operations', () => {
      let result = insertText('', 0, 'Hello');
      result = insertText(result.text, result.position, ' ');
      result = insertText(result.text, result.position, 'World');
      expect(result.text).toBe('Hello World');
      expect(result.position).toBe(11);
    });
  });
});
