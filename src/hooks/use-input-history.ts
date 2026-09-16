import { useState, useCallback } from "react";

export interface InputHistoryHook {
  addToHistory: (input: string) => void;
  navigateHistory: (direction: "up" | "down") => string | null;
  getCurrentHistoryIndex: () => number;
  resetHistory: () => void;
  isNavigatingHistory: () => boolean;
  setOriginalInput: (input: string) => void;
}

export function useInputHistory(): InputHistoryHook {
  const [history, setHistory] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [originalInput, setOriginalInput] = useState("");

  const addToHistory = useCallback((input: string) => {
    if (input.trim() && !history.includes(input.trim())) {
      setHistory(prev => [...prev, input.trim()]);
    }
    setCurrentIndex(-1);
    setOriginalInput("");
  }, [history]);

  const navigateHistory = useCallback((direction: "up" | "down"): string | null => {
    if (history.length === 0) return null;

    let newIndex: number;
    
    if (direction === "up") {
      if (currentIndex === -1) {
        newIndex = history.length - 1;
      } else {
        newIndex = Math.max(0, currentIndex - 1);
      }
    } else {
      if (currentIndex === -1) {
        return null;
      } else if (currentIndex === history.length - 1) {
        newIndex = -1;
        setCurrentIndex(-1);
        return originalInput;
      } else {
        newIndex = Math.min(history.length - 1, currentIndex + 1);
      }
    }

    setCurrentIndex(newIndex);
    // newIndex is provably in-bounds here (0..history.length-1), so `?? null`
    // never fires at runtime; it only satisfies noUncheckedIndexedAccess
    // while matching the function's existing `string | null` contract.
    return newIndex === -1 ? originalInput : (history[newIndex] ?? null);
  }, [history, currentIndex, originalInput]);

  const getCurrentHistoryIndex = useCallback(() => currentIndex, [currentIndex]);
  
  const resetHistory = useCallback(() => {
    setHistory([]);
    setCurrentIndex(-1);
    setOriginalInput("");
  }, []);

  const isNavigatingHistory = useCallback(() => currentIndex !== -1, [currentIndex]);

  const setOriginalInputCallback = useCallback((input: string) => {
    if (currentIndex === -1) {
      setOriginalInput(input);
    }
  }, [currentIndex]);

  return {
    addToHistory,
    navigateHistory,
    getCurrentHistoryIndex,
    resetHistory,
    isNavigatingHistory,
    setOriginalInput: setOriginalInputCallback,
  };
}