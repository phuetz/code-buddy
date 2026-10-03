import { useState, useCallback, useRef } from "react";
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
} from "../utils/text-utils.js";
import { useInputHistory } from "./use-input-history.js";
import { getHistoryManager } from "../utils/history-manager.js";

export interface Key {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  paste?: boolean;
  sequence?: string;
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

export interface EnhancedInputHook {
  input: string;
  cursorPosition: number;
  isMultiline: boolean;
  isReverseSearchActive: boolean;
  reverseSearchPrompt: string;
  setInput: (text: string) => void;
  setCursorPosition: (position: number) => void;
  clearInput: () => void;
  discardCancelledDraft: () => void;
  insertAtCursor: (text: string) => void;
  resetHistory: () => void;
  handleInput: (inputChar: string, key: Key) => void;
}

interface UseEnhancedInputProps {
  onSubmit?: (text: string) => void;
  onEscape?: () => void;
  onEmptyInterrupt?: () => void;
  onSpecialKey?: (key: Key) => boolean; // Return true to prevent default handling
  disabled?: boolean;
  multiline?: boolean;
}

export function useEnhancedInput({
  onSubmit,
  onEscape,
  onEmptyInterrupt,
  onSpecialKey,
  disabled = false,
  multiline = false,
}: UseEnhancedInputProps = {}): EnhancedInputHook {
  const [input, updateInput] = useState('');
  const inputRef = useRef('');
  // Never put cancelled input in history or persistent storage.
  const cancelledDraftRef = useRef<string | null>(null);
  const restoredDraftRef = useRef(false);
  const setInputState = useCallback((text: string) => {
    restoredDraftRef.current = false;
    inputRef.current = text;
    updateInput(text);
  }, []);
  const [cursorPosition, updateCursor] = useState(0);
  const cursorRef = useRef(0);
  const setCursorPositionState = useCallback((position: number) => {
    restoredDraftRef.current = false;
    cursorRef.current = position;
    updateCursor(position);
  }, []);
  const [isReverseSearchActive, updateReverseSearchActive] = useState(false);
  const reverseSearchActiveRef = useRef(false);
  const reverseSearchSnapshotRef = useRef({ cursorPosition: 0, restoredDraft: false });
  const setIsReverseSearchActive = useCallback((active: boolean) => {
    reverseSearchActiveRef.current = active;
    updateReverseSearchActive(active);
  }, []);
  const [reverseSearchPrompt, setReverseSearchPrompt] = useState("");
  const isMultilineRef = useRef(multiline);
  const historyManager = getHistoryManager();

  const {
    addToHistory,
    navigateHistory,
    resetHistory,
    resetNavigation,
    setOriginalInput,
    isNavigatingHistory,
  } = useInputHistory();

  const setInput = useCallback((text: string) => {
    setInputState(text);
    setCursorPositionState(Math.min(text.length, cursorPosition));
    if (!isNavigatingHistory()) {
      setOriginalInput(text);
    }
  }, [cursorPosition, isNavigatingHistory, setOriginalInput]);

  const setCursorPosition = useCallback((position: number) => {
    setCursorPositionState(Math.max(0, Math.min(inputRef.current.length, position)));
  }, [input.length]);

  const clearInput = useCallback(() => {
    setInputState("");
    setCursorPositionState(0);
    setOriginalInput("");
  }, [setOriginalInput]);

  const discardCancelledDraft = useCallback(() => {
    cancelledDraftRef.current = null;
  }, []);

  const insertAtCursor = useCallback((text: string) => {
    const result = insertText(inputRef.current, cursorRef.current, text);
    setInputState(result.text);
    setCursorPositionState(result.position);
    setOriginalInput(result.text);
  }, [input, cursorPosition, setOriginalInput]);

  const handleSubmit = useCallback(() => {
    const input = inputRef.current;
    if (input.trim()) {
      discardCancelledDraft();
      addToHistory(input);
      onSubmit?.(input);
      clearInput();
    }
  }, [input, addToHistory, onSubmit, clearInput, discardCancelledDraft]);

  const handleInput: EnhancedInputHook['handleInput'] = useCallback((inputChar: string, key: Key): void => {
    if (disabled) return;
    // Ink can deliver a paste and the following Ctrl+C in the same stdin chunk.
    if (inputChar.length > 1 && inputChar.includes('\x03')) {
      const parts = inputChar.split('\x03');
      parts.forEach((part, index) => {
        if (part) handleInput(part, {});
        if (index < parts.length - 1) handleInput('\x03', {});
      });
      return;
    }
    // Read synchronously updated refs: multiple events may arrive before React
    // commits a render (fast typing, Windows Terminal and pasted input).
    let input = inputRef.current;
    let cursorPosition = cursorRef.current;
    const isReverseSearchActive = reverseSearchActiveRef.current;
    // Ink 4 parses CRLF as Ctrl+M, and LF (Ctrl+J) as literal text.
    // Normalize Enter without executing embedded newlines in pasted content.
    if (inputChar === '\r\n' || (key.ctrl && inputChar === 'm')) {
      key = { ...key, return: true };
    }
    if (inputChar === '\n' || (key.ctrl && inputChar === 'j')) {
      const result = insertText(input, cursorPosition, '\n');
      setInputState(result.text);
      setCursorPositionState(result.position);
      setOriginalInput(result.text);
      return;
    }
    if (inputChar.length > 1 && !key.ctrl && !key.meta) {
      inputChar = inputChar.replace(/\r\n?/g, '\n');
    }

    // Handle Ctrl+C - check multiple ways it could be detected
    if ((key.ctrl && inputChar === "c") || inputChar === "\x03") {
      if (isReverseSearchActive) {
        const originalInput = historyManager.cancelReverseSearch();
        setInputState(originalInput);
        setCursorPositionState(Math.min(reverseSearchSnapshotRef.current.cursorPosition, originalInput.length));
        setOriginalInput(originalInput);
        restoredDraftRef.current = reverseSearchSnapshotRef.current.restoredDraft;
        setIsReverseSearchActive(false);
        setReverseSearchPrompt("");
        return;
      }
      if (input.length > 0) {
        cancelledDraftRef.current = input;
        resetNavigation();
        clearInput();
      } else {
        onEmptyInterrupt?.();
      }
      return;
    }

    // Handle Ctrl+R: Reverse search (bash-like)
    if (key.ctrl && inputChar === "r") {
      if (isReverseSearchActive) {
        // Already in search mode - go to next match
        const nextMatch = historyManager.reverseSearchNext();
        if (nextMatch) {
          setInputState(nextMatch.text);
          setCursorPositionState(nextMatch.text.length);
        }
        setReverseSearchPrompt(historyManager.formatReverseSearchPrompt());
      } else {
        // Start reverse search mode
        reverseSearchSnapshotRef.current = { cursorPosition, restoredDraft: restoredDraftRef.current };
        historyManager.startReverseSearch(input);
        setIsReverseSearchActive(true);
        setReverseSearchPrompt(historyManager.formatReverseSearchPrompt());
      }
      return;
    }

    // Handle Ctrl+S: Forward search (when in reverse search mode)
    if (key.ctrl && inputChar === "s" && isReverseSearchActive) {
      const prevMatch = historyManager.reverseSearchPrev();
      if (prevMatch) {
        setInputState(prevMatch.text);
        setCursorPositionState(prevMatch.text.length);
      }
      setReverseSearchPrompt(historyManager.formatReverseSearchPrompt());
      return;
    }

    // Handle input during reverse search mode
    if (isReverseSearchActive) {
      // Escape cancels search
      if (key.escape) {
        const originalInput = historyManager.cancelReverseSearch();
        setInputState(originalInput);
        setCursorPositionState(Math.min(reverseSearchSnapshotRef.current.cursorPosition, originalInput.length));
        setOriginalInput(originalInput);
        restoredDraftRef.current = reverseSearchSnapshotRef.current.restoredDraft;
        setIsReverseSearchActive(false);
        setReverseSearchPrompt("");
        return;
      }

      // Enter accepts the match
      if (key.return) {
        const selectedText = historyManager.acceptReverseSearch();
        setInputState(selectedText);
        setCursorPositionState(selectedText.length);
        setOriginalInput(selectedText);
        setIsReverseSearchActive(false);
        setReverseSearchPrompt("");
        return;
      }

      // Backspace removes last char from search query
      const isBackspaceInSearch = key.backspace ||
                                  key.name === 'backspace' ||
                                  inputChar === '\b' ||
                                  inputChar === '\x7f';
      if (isBackspaceInSearch) {
        const state = historyManager.getReverseSearchState();
        if (state.query.length > 0) {
          const newQuery = state.query.slice(0, -1);
          const match = historyManager.updateReverseSearch(newQuery);
          if (match) {
            setInputState(match.text);
            setCursorPositionState(match.text.length);
          }
          setReverseSearchPrompt(historyManager.formatReverseSearchPrompt());
        }
        return;
      }

      // Regular characters update the search query
      if (inputChar && !key.ctrl && !key.meta && inputChar.length === 1) {
        const state = historyManager.getReverseSearchState();
        const newQuery = state.query + inputChar;
        const match = historyManager.updateReverseSearch(newQuery);
        if (match) {
          setInputState(match.text);
          setCursorPositionState(match.text.length);
        }
        setReverseSearchPrompt(historyManager.formatReverseSearchPrompt());
        return;
      }

      // Any other key exits search mode but keeps the match
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
        const selectedText = historyManager.acceptReverseSearch();
        setInputState(selectedText);
        setCursorPositionState(selectedText.length);
        setOriginalInput(selectedText);
        setIsReverseSearchActive(false);
        setReverseSearchPrompt("");
        // Continue using the accepted text, not the pre-search snapshot.
        input = selectedText;
        cursorPosition = selectedText.length;
      }
    }

    const historyUp = (key.upArrow || key.name === 'up') && !key.ctrl && !key.meta;
    if (historyUp && input.length === 0 && cancelledDraftRef.current !== null) {
      const draft = cancelledDraftRef.current;
      discardCancelledDraft();
      setInputState(draft);
      setCursorPositionState(draft.length);
      setOriginalInput(draft);
      // The next Up enters history even when the restored text is multiline.
      restoredDraftRef.current = true;
      return;
    }

    // Allow special key handler to override default behavior
    if (!(historyUp && restoredDraftRef.current) && onSpecialKey?.(key)) {
      return;
    }

    // Handle Escape
    if (key.escape) {
      onEscape?.();
      return;
    }

    // Handle Enter/Return
    if (key.return) {
      if (multiline && key.shift) {
        // Shift+Enter in multiline mode inserts newline
        const result = insertText(input, cursorPosition, "\n");
        setInputState(result.text);
        setCursorPositionState(result.position);
        setOriginalInput(result.text);
      } else {
        handleSubmit();
      }
      return;
    }

    // In a multiline draft, arrows move within the draft instead of replacing
    // it with history. History remains available on a single-line prompt.
    if (input.includes('\n') && !(historyUp && restoredDraftRef.current) && !isNavigatingHistory() && (key.upArrow || key.downArrow) && !key.ctrl && !key.meta) {
      // Only an actual cursor move disarms the next-Up history shortcut.
      const before = input.slice(0, cursorPosition).split('\n');
      const row = before.length - 1;
      const column = before[row]?.length ?? 0;
      const lines = input.split('\n');
      const target = row + (key.upArrow ? -1 : 1);
      if (target >= 0 && target < lines.length) {
        const offset = lines.slice(0, target).reduce((sum, line) => sum + line.length + 1, 0);
        setCursorPositionState(offset + Math.min(column, lines[target]?.length ?? 0));
      }
      return;
    }

    // Handle history navigation
    if ((key.upArrow || key.name === 'up') && !key.ctrl && !key.meta) {
      const historyInput = navigateHistory("up");
      if (historyInput !== null) {
        setInputState(historyInput);
        setCursorPositionState(historyInput.length);
      }
      return;
    }

    if ((key.downArrow || key.name === 'down') && !key.ctrl && !key.meta) {
      const historyInput = navigateHistory("down");
      if (historyInput !== null) {
        setInputState(historyInput);
        setCursorPositionState(historyInput.length);
      }
      return;
    }

    // Handle cursor movement - ignore meta flag for arrows as it's unreliable in terminals
    // Only do word movement if ctrl is pressed AND no arrow escape sequence is in inputChar
    if ((key.leftArrow || key.name === 'left') && key.ctrl && !inputChar.includes('[')) {
      const newPos = moveToPreviousWord(input, cursorPosition);
      setCursorPositionState(newPos);
      return;
    }

    if ((key.rightArrow || key.name === 'right') && key.ctrl && !inputChar.includes('[')) {
      const newPos = moveToNextWord(input, cursorPosition);
      setCursorPositionState(newPos);
      return;
    }

    // Handle regular cursor movement - single character (ignore meta flag)
    if (key.leftArrow || key.name === 'left') {
      const newPos = Math.max(0, cursorPosition - 1);
      setCursorPositionState(newPos);
      return;
    }

    if (key.rightArrow || key.name === 'right') {
      const newPos = Math.min(input.length, cursorPosition + 1);
      setCursorPositionState(newPos);
      return;
    }

    // Handle Home/End keys or Ctrl+A/E
    if ((key.ctrl && inputChar === "a") || key.name === "home") {
      setCursorPositionState(0); // Simple start of input
      return;
    }

    if ((key.ctrl && inputChar === "e") || key.name === "end") {
      setCursorPositionState(input.length); // Simple end of input
      return;
    }

    // Handle deletion - check multiple ways backspace might be detected
    // Backspace can be detected in different ways depending on terminal
    // In some terminals, backspace shows up as delete:true with empty inputChar
    const isBackspace = key.backspace || 
                       key.name === 'backspace' || 
                       inputChar === '\b' || 
                       inputChar === '\x7f' ||
                       (key.delete && inputChar === '' && !key.shift);
                       
    if (isBackspace) {
      if (key.ctrl || key.meta) {
        // Ctrl/Cmd + Backspace: Delete word before cursor
        const result = deleteWordBefore(input, cursorPosition);
        setInputState(result.text);
        setCursorPositionState(result.position);
        setOriginalInput(result.text);
      } else {
        // Regular backspace
        const result = deleteCharBefore(input, cursorPosition);
        setInputState(result.text);
        setCursorPositionState(result.position);
        setOriginalInput(result.text);
      }
      return;
    }

    // Handle forward delete (Del key) - but not if it was already handled as backspace above
    if ((key.delete && inputChar !== '') || (key.ctrl && inputChar === "d")) {
      if (key.ctrl || key.meta) {
        // Ctrl/Cmd + Delete: Delete word after cursor
        const result = deleteWordAfter(input, cursorPosition);
        setInputState(result.text);
        setCursorPositionState(result.position);
        setOriginalInput(result.text);
      } else {
        // Regular delete
        const result = deleteCharAfter(input, cursorPosition);
        setInputState(result.text);
        setCursorPositionState(result.position);
        setOriginalInput(result.text);
      }
      return;
    }

    // Handle Ctrl+K: Delete from cursor to end of line
    if (key.ctrl && inputChar === "k") {
      const lineEnd = moveToLineEnd(input, cursorPosition);
      const newText = input.slice(0, cursorPosition) + input.slice(lineEnd);
      setInputState(newText);
      setOriginalInput(newText);
      return;
    }

    // Handle Ctrl+U: Delete from cursor to start of line
    if (key.ctrl && inputChar === "u") {
      const lineStart = moveToLineStart(input, cursorPosition);
      const newText = input.slice(0, lineStart) + input.slice(cursorPosition);
      setInputState(newText);
      setCursorPositionState(lineStart);
      setOriginalInput(newText);
      return;
    }

    // Handle Ctrl+W: Delete word before cursor
    if (key.ctrl && inputChar === "w") {
      const result = deleteWordBefore(input, cursorPosition);
      setInputState(result.text);
      setCursorPositionState(result.position);
      setOriginalInput(result.text);
      return;
    }

    // Handle Ctrl+X: Clear entire input
    if (key.ctrl && inputChar === "x") {
      setInputState("");
      setCursorPositionState(0);
      setOriginalInput("");
      return;
    }

    // Handle regular character input
    if (inputChar && !key.ctrl && !key.meta) {
      const result = insertText(input, cursorPosition, inputChar);
      setInputState(result.text);
      setCursorPositionState(result.position);
      setOriginalInput(result.text);
    }
  }, [disabled, onSpecialKey, onEmptyInterrupt, input, cursorPosition, multiline, handleSubmit, navigateHistory, resetNavigation, clearInput, discardCancelledDraft, setOriginalInput, isReverseSearchActive, historyManager]);

  return {
    input,
    cursorPosition,
    isMultiline: isMultilineRef.current,
    isReverseSearchActive,
    reverseSearchPrompt,
    setInput,
    setCursorPosition,
    clearInput,
    discardCancelledDraft,
    insertAtCursor,
    resetHistory,
    handleInput,
  };
}
