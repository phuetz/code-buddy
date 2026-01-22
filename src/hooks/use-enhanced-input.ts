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
  insertAtCursor: (text: string) => void;
  resetHistory: () => void;
  handleInput: (inputChar: string, key: Key) => void;
}

interface UseEnhancedInputProps {
  onSubmit?: (text: string) => void;
  onEscape?: () => void;
  onSpecialKey?: (key: Key) => boolean; // Return true to prevent default handling
  disabled?: boolean;
  multiline?: boolean;
}

export function useEnhancedInput({
  onSubmit,
  onEscape,
  onSpecialKey,
  disabled = false,
  multiline = false,
}: UseEnhancedInputProps = {}): EnhancedInputHook {
  const [input, setInputState] = useState("");
  const [cursorPosition, setCursorPositionState] = useState(0);
  const [isReverseSearchActive, setIsReverseSearchActive] = useState(false);
  const [reverseSearchPrompt, setReverseSearchPrompt] = useState("");
  const isMultilineRef = useRef(multiline);
  const historyManager = getHistoryManager();

  const {
    addToHistory,
    navigateHistory,
    resetHistory,
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
    setCursorPositionState(Math.max(0, Math.min(input.length, position)));
  }, [input.length]);

  const clearInput = useCallback(() => {
    setInputState("");
    setCursorPositionState(0);
    setOriginalInput("");
  }, [setOriginalInput]);

  const insertAtCursor = useCallback((text: string) => {
    const result = insertText(input, cursorPosition, text);
    setInputState(result.text);
    setCursorPositionState(result.position);
    setOriginalInput(result.text);
  }, [input, cursorPosition, setOriginalInput]);

  const handleSubmit = useCallback(() => {
    if (input.trim()) {
      addToHistory(input);
      onSubmit?.(input);
      clearInput();
    }
  }, [input, addToHistory, onSubmit, clearInput]);

  const handleInput = useCallback((inputChar: string, key: Key) => {
    if (disabled) return;

    // Handle Ctrl+C - check multiple ways it could be detected
    if ((key.ctrl && inputChar === "c") || inputChar === "\x03") {
      setInputState("");
      setCursorPositionState(0);
      setOriginalInput("");
      return;
    }

    // Allow special key handler to override default behavior
    if (onSpecialKey?.(key)) {
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
        setCursorPositionState(originalInput.length);
        setIsReverseSearchActive(false);
        setReverseSearchPrompt("");
        return;
      }

      // Enter accepts the match
      if (key.return) {
        const selectedText = historyManager.acceptReverseSearch();
        setInputState(selectedText);
        setCursorPositionState(selectedText.length);
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
        setIsReverseSearchActive(false);
        setReverseSearchPrompt("");
        // Continue to handle the key normally
      }
    }

    // Handle regular character input
    if (inputChar && !key.ctrl && !key.meta) {
      const result = insertText(input, cursorPosition, inputChar);
      setInputState(result.text);
      setCursorPositionState(result.position);
      setOriginalInput(result.text);
    }
  }, [disabled, onSpecialKey, input, cursorPosition, multiline, handleSubmit, navigateHistory, setOriginalInput, isReverseSearchActive, historyManager]);

  return {
    input,
    cursorPosition,
    isMultiline: isMultilineRef.current,
    isReverseSearchActive,
    reverseSearchPrompt,
    setInput,
    setCursorPosition,
    clearInput,
    insertAtCursor,
    resetHistory,
    handleInput,
  };
}